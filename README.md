# poke-assist

ポケモンチャンピオンズ（シングル）の対戦を、横で判断を助けるための個人用の道具。
操作はすべて本人が行い、この道具は画面を見て「候補の手と理由」を出すだけ。

- 設計の全体: [docs/DESIGN.md](docs/DESIGN.md)
- 守る線（使ってよい場面・いけない場面）: [docs/DESIGN.md §1](docs/DESIGN.md#1-目的と守る線)

## 現状（2026-10-22）

DESIGN.md §9 の 1〜8 を一通り作った。**実機の画面での調整はまだ**（読み取りの位置は仮置き）。

| 段階 | 状態 |
|---|---|
| 1. 調べる | 済（[docs/research/](docs/research/)）。取れなかった情報は [docs/PENDING_FETCH.md](docs/PENDING_FETCH.md) |
| 2. 構築・図鑑 | 済。構築は [data/team/s6_umeda.json](data/team/s6_umeda.json)（記事の実数値と全一致） |
| 3. ダメージ計算 | 済（`@smogon/calc` のチャンピオンズ対応） |
| 4. 盤面の読み取り | 作った。合成画像では動く。実機で `config/layout.json` の調整が要る |
| 5. 試合の記録 | 作った（`data/matches/`） |
| 6. 探索エンジン | 作った（2ターン先・ナッシュ均衡・型の不確かさ） |
| 7. Claude | 作った（選出・読み合いの局面で Haiku、振り返りで Sonnet） |
| 8. 常駐 | 作った（launchd）。読み取りが固まるまでは手で起動する |

## 準備（初回）

```bash
npm install
npm run build:screen      # Swift の読み取り道具をビルド（tools/screen/pa-screen）
```

初回の撮影で macOS が「画面収録」の許可を求める。ターミナル（または VSCode）に許可する。

## 使い方

```bash
npm run advise            # iPhone ミラーリングの窓を見張る。助言は http://127.0.0.1:8765
npm run advise -- --claude --keep   # Claude も使う／変化した画面を captures/ に残す
npm run calc -- アシレーヌ カバルドン   # 確定数の表（自分の6匹 × 相手）
npm run selection -- アシレーヌ カバルドン ボーマンダ アーマーガア イエッサン ガブリアス
npm run summarize         # 記録の集計 → data/meta_summary.md（--claude で Sonnet が環境メモを書く）
npm run verify            # 記録のダメージが計算の範囲に入っているか
```

選出したら、助言の窓の「選んだ3匹」に印を付ける（控えの計算に使う）。

### 実機での調整（最初にやること）

1. `npm run advise -- --keep` で1〜2試合して、`captures/` に画面を溜める
2. `npm run calibrate -- captures/<画像>.png` で文字の位置・画面の判定・HP バーの値を見る
3. `config/layout.json` を直す（相手と自分の境目、HP バーの位置、結果画面の言葉）。合えば `"verified": true`
4. `npm run advise -- --replay captures` で溜めた画面を流して確かめる

### データの更新

```bash
npm run fetch:usage                 # 先月の Smogon 使用率（BSS Reg M-C, 1500+）
# 日本語名の表を作り直す時（PokeAPI の CSV を data/raw/ に置いてから）
npm run build:names
```

### 常駐

```bash
tools/launchd/install.sh            # ログイン時に起動
tools/launchd/install.sh remove     # 外す
```

## 開発

```bash
npm run typecheck && npm test
```
