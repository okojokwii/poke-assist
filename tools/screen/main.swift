// 画面の取得と読み取りの小さな道具（DESIGN.md §3）。TypeScript 側から子プロセスとして呼ぶ。
// 画像は手元で処理し、外へは送らない。出力はすべて JSON（標準出力）。
//
//   pa-screen find                         iPhone ミラーリングの窓を探す → {"id":…, "x":…, "y":…, "w":…, "h":…, "onscreen":…}
//   pa-screen capture <out.png>            その窓を撮る（窓の影なし）
//   pa-screen ocr <png> [x,y,w,h]          文字認識。範囲は 0〜1 の割合（左上原点）→ [{"text":…, "conf":…, "x":…, "y":…, "w":…, "h":…}]
//   pa-screen bar <png> x,y,w,h            HP バーの残りの割合 → {"fraction":…, "color":"green|yellow|red|none"}
//   pa-screen hash <png>                   画面が変わったかを見るための 64bit の指紋 → {"hash":"…"}
//   pa-screen crop <png> x,y,w,h <out.png> 範囲を切り出して保存（調整用）
//   pa-screen sig <png> x,y,w,h [...]      アイコンの見分け用の特徴（16×16 の RGB、0〜255 の 768 個）。範囲は複数指定できる
//
// ビルド: npm run build:screen（swiftc）。初回の capture で「画面収録」の許可を求められる。

import AppKit
import CoreGraphics
import Foundation
import Vision

func emit(_ obj: Any) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

// ミラーリングのアプリ名は言語設定で変わる
let mirroringOwners = ["iPhone Mirroring", "iPhoneミラーリング", "iPhone ミラーリング"]

func findWindow() -> [String: Any]? {
    // 別のデスクトップ（操作スペース）や最小化中の窓も見つけられるよう、全部の窓から探す。見えているかは onscreen で返す
    guard let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    var hidden: [String: Any]?
    for w in list {
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        let isMirroring = mirroringOwners.contains(owner) || owner.contains("iPhone") || owner.contains("ミラーリング")
        guard isMirroring, (w[kCGWindowLayer as String] as? Int) == 0 else { continue }
        // 初回の案内（「ようこそiPhoneミラーリングへ」）や設定の窓は対象外。iPhone の画面が映った窓だけを見る
        let title = w[kCGWindowName as String] as? String ?? ""
        if title.contains("ようこそ") || title.contains("Welcome") { continue }
        // 大きさは NSNumber の辞書で来るので CGRect に直して読む（[String: CGFloat] への変換は失敗する）
        guard let dict = w[kCGWindowBounds as String] as! CFDictionary?, let r = CGRect(dictionaryRepresentation: dict) else { continue }
        // メニューバーの細い窓（高さ 33 など）を除く
        guard r.width > 200, r.height > 200 else { continue }
        let info: [String: Any] = ["id": w[kCGWindowNumber as String] as? Int ?? 0, "x": r.minX, "y": r.minY, "w": r.width, "h": r.height,
                                   "onscreen": (w[kCGWindowIsOnscreen as String] as? Bool) ?? false]
        if info["onscreen"] as? Bool == true { return info }
        hidden = hidden ?? info
    }
    return hidden
}

func loadImage(_ path: String) -> CGImage {
    guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        fail("画像を読めない: \(path)")
    }
    return cg
}

func parseRect(_ s: String) -> CGRect {
    let v = s.split(separator: ",").compactMap { Double($0) }
    guard v.count == 4 else { fail("範囲は x,y,w,h（0〜1）で指定: \(s)") }
    return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
}

func crop(_ img: CGImage, _ r: CGRect) -> CGImage {
    let W = CGFloat(img.width), H = CGFloat(img.height)
    let px = CGRect(x: r.minX * W, y: r.minY * H, width: r.width * W, height: r.height * H).integral
    guard let c = img.cropping(to: px) else { fail("切り出せない範囲: \(r)") }
    return c
}

/// RGBA8 のピクセル列にする（色を測る用）
func pixels(_ img: CGImage) -> (data: [UInt8], w: Int, h: Int) {
    let w = img.width, h = img.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (data, w, h)
}

func ocr(_ img: CGImage, region: CGRect?) -> [[String: Any]] {
    let target = region.map { crop(img, $0) } ?? img
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["ja-JP", "en-US"]
    req.usesLanguageCorrection = false // ポケモンの名前は辞書に無いので補正しない
    try? VNImageRequestHandler(cgImage: target, options: [:]).perform([req])
    let base = region ?? CGRect(x: 0, y: 0, width: 1, height: 1)
    return (req.results ?? []).compactMap { obs in
        guard let top = obs.topCandidates(1).first else { return nil }
        // Vision の座標は左下原点。左上原点の、画像全体に対する割合に直す
        let b = obs.boundingBox
        return [
            "text": top.string, "conf": top.confidence,
            "x": base.minX + b.minX * base.width, "y": base.minY + (1 - b.maxY) * base.height,
            "w": b.width * base.width, "h": b.height * base.height,
        ]
    }
}

/// HP バーの色。緑・黄・赤のどれかなら「残っている部分」として数える
func barColor(_ r: Int, _ g: Int, _ b: Int) -> String? {
    let mx = max(r, g, b), mn = min(r, g, b)
    guard mx > 90, mx - mn > 60 else { return nil } // 灰色・黒（減った部分や枠）は除く
    if g > r && g > b { return "green" }
    if r > 150 && g > 120 && b < 100 { return "yellow" }
    if r > g && r > b { return "red" }
    return nil
}

func measureBar(_ img: CGImage, _ r: CGRect) -> [String: Any] {
    let (d, w, h) = pixels(crop(img, r))
    // 縦の真ん中あたりの数行で、左から色付きの画素が続く長さを測る
    var best = 0
    var color = "none"
    for row in [h / 2 - 1, h / 2, h / 2 + 1] where row >= 0 && row < h {
        var lastColored = -1
        var counts: [String: Int] = [:]
        for x in 0..<w {
            let i = (row * w + x) * 4
            if let c = barColor(Int(d[i]), Int(d[i + 1]), Int(d[i + 2])) {
                lastColored = x
                counts[c, default: 0] += 1
            }
        }
        if lastColored + 1 > best {
            best = lastColored + 1
            color = counts.max { $0.value < $1.value }?.key ?? "none"
        }
    }
    return ["fraction": w > 0 ? Double(best) / Double(w) : 0, "color": color]
}

/// 差分ハッシュ。9×8 に縮めて隣どうしの明るさを比べる
func dhash(_ img: CGImage) -> String {
    let small = CGContext(data: nil, width: 9, height: 8, bitsPerComponent: 8, bytesPerRow: 9 * 4,
                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    small.interpolationQuality = .medium
    small.draw(img, in: CGRect(x: 0, y: 0, width: 9, height: 8))
    let p = small.data!.bindMemory(to: UInt8.self, capacity: 9 * 8 * 4)
    var bits: UInt64 = 0
    for y in 0..<8 {
        for x in 0..<8 {
            let i = (y * 9 + x) * 4, j = i + 4
            let a = Int(p[i]) + Int(p[i + 1]) + Int(p[i + 2])
            let b = Int(p[j]) + Int(p[j + 1]) + Int(p[j + 2])
            bits = (bits << 1) | (a > b ? 1 : 0)
        }
    }
    return String(format: "%016llx", bits)
}

/// 16×16 に縮めた RGB。同じゲームの同じ表示どうしなら近い値になる（選出画面の相手のアイコンを見分ける用）
func signature(_ img: CGImage) -> [Int] {
    let n = 16
    let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
    let p = ctx.data!.bindMemory(to: UInt8.self, capacity: n * n * 4)
    var out: [Int] = []
    for i in 0..<(n * n) { out += [Int(p[i * 4]), Int(p[i * 4 + 1]), Int(p[i * 4 + 2])] }
    return out
}

func save(_ img: CGImage, _ path: String) {
    let rep = NSBitmapImageRep(cgImage: img)
    guard let png = rep.representation(using: .png, properties: [:]) else { fail("保存できない") }
    try! png.write(to: URL(fileURLWithPath: path))
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("使い方は main.swift の先頭を参照") }

switch args[1] {
case "find":
    guard let w = findWindow() else { fail("iPhone ミラーリングの窓が見つからない") }
    emit(w)
case "capture":
    guard args.count >= 3 else { fail("capture <out.png>") }
    guard let w = findWindow(), let id = w["id"] as? Int else { fail("iPhone ミラーリングの窓が見つからない") }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    p.arguments = ["-x", "-o", "-l", String(id), args[2]]
    try! p.run()
    p.waitUntilExit()
    if p.terminationStatus != 0 { fail("screencapture が失敗（画面収録の許可を確認）") }
    emit(["path": args[2], "window": w])
case "ocr":
    guard args.count >= 3 else { fail("ocr <png> [x,y,w,h]") }
    emit(ocr(loadImage(args[2]), region: args.count >= 4 ? parseRect(args[3]) : nil))
case "bar":
    guard args.count >= 4 else { fail("bar <png> x,y,w,h") }
    emit(measureBar(loadImage(args[2]), parseRect(args[3])))
case "hash":
    guard args.count >= 3 else { fail("hash <png>") }
    emit(["hash": dhash(loadImage(args[2]))])
case "sig":
    guard args.count >= 4 else { fail("sig <png> x,y,w,h [...]") }
    let img = loadImage(args[2])
    emit(args[3...].map { signature(crop(img, parseRect($0))) })
case "crop":
    guard args.count >= 5 else { fail("crop <png> x,y,w,h <out.png>") }
    save(crop(loadImage(args[2]), parseRect(args[3])), args[4])
    emit(["path": args[4]])
default:
    fail("不明なコマンド: \(args[1])")
}
