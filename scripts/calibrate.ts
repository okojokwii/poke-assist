// 読み取りの調整。実機のスクショの文字認識の結果と位置、画面の判定を出す。
// 使い方: npm run calibrate -- captures/xxx.png [さらに png ...]
// 出力を見て config/layout.json（oppInfo・myInfo・各キーワードなど）を直す。
import { screen } from '../src/reader/screen.js';
import { loadLayout, readBoxes } from '../src/reader/parse.js';
import { loadTeam, toCalcPokemon } from '../src/dex/sets.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('使い方: npm run calibrate -- <png> [...]');
  process.exit(1);
}
const layout = loadLayout();
const team = loadTeam(process.env.PA_TEAM ?? 'data/team/s6_umeda.json');
const myMoves = [...new Set(team.members.flatMap((m) => m.moves))];
const maxHpOf = (sp: string) => {
  const m = team.members.find((x) => x.species === sp || x.megaSpecies === sp);
  return m ? toCalcPokemon(m).maxHP() : undefined;
};
const f = (n: number) => n.toFixed(3);
const verbose = files.length === 1;
for (const png of files) {
  const boxes = screen.ocr(png);
  if (verbose) {
    console.log('文字認識（x, y, w, h は窓に対する割合）');
    for (const b of boxes) console.log(`  ${f(b.x)} ${f(b.y)} ${f(b.w)} ${f(b.h)} conf=${b.conf.toFixed(2)}  ${b.text}`);
  }
  const r = readBoxes(boxes, layout, myMoves, maxHpOf);
  const parts = [
    r.kind,
    r.myName && `自分 ${r.myName} ${r.myHp ? `${r.myHp.cur}/${r.myHp.max}` : '?'}`,
    r.oppName && `相手 ${r.oppName} ${r.oppPct ?? '?'}%`,
    r.moves.length && `技 ${r.moves.map((m) => m.en).join(',')}`,
    r.events.length && `行動 ${r.events.map((e) => `${e.side}:${e.species ?? '?'}:${e.move}`).join(',')}`,
    r.myTeamNames.length && `自分の6匹 ${r.myTeamNames.join(',')}`,
    r.resultText && `結果 ${r.resultText}`,
  ].filter(Boolean);
  console.log(`${png.split('/').pop()}: ${parts.join(' / ')}`);
}
