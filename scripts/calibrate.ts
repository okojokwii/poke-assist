// 読み取りの調整。実機のスクショ1枚の文字認識の結果と位置、画面の判定、HP バーの測定を出す。
// 使い方: npm run calibrate -- captures/xxx.png
// 出力を見て config/layout.json（oppSideMaxY・hpBarFromName など）を直し、"verified": true にする。
import { screen } from '../src/reader/screen.js';
import { hpBarRegion, loadLayout, readBoxes, splitSides } from '../src/reader/parse.js';
import { loadTeam } from '../src/dex/sets.js';

const png = process.argv[2];
if (!png) {
  console.error('使い方: npm run calibrate -- <png>');
  process.exit(1);
}
const layout = loadLayout();
const team = loadTeam(process.env.PA_TEAM ?? 'data/team/s6_umeda.json');
const boxes = screen.ocr(png);
const f = (n: number) => n.toFixed(3);
console.log('文字認識（x, y, w, h は窓に対する割合）');
for (const b of boxes) console.log(`  ${f(b.x)} ${f(b.y)} ${f(b.w)} ${f(b.h)} conf=${b.conf.toFixed(2)}  ${b.text}`);
const r = readBoxes(boxes, layout, [...new Set(team.members.flatMap((m) => m.moves))]);
const { mine, opp } = splitSides(r, layout);
console.log(`\n画面の判定: ${r.kind}`);
console.log(`  自分側: ${mine.map((m) => m.en).join(', ') || '-'}`);
console.log(`  相手側: ${opp.map((m) => m.en).join(', ') || '-'}`);
console.log(`  技: ${r.moves.map((m) => m.en).join(', ') || '-'}`);
console.log(`  HP の数字: ${r.hpNumbers.map((h) => `${h.cur}/${h.max}`).join(', ') || '-'}`);
for (const o of opp) {
  const region = hpBarRegion(o.box, layout);
  console.log(`  ${o.en} の HP バー（推定位置 ${[region.x, region.y, region.w, region.h].map(f).join(',')}）: ${JSON.stringify(screen.bar(png, region))}`);
}
console.log('\n範囲を切り出して確かめる: tools/screen/pa-screen crop <png> x,y,w,h out.png');
