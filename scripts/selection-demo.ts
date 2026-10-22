// 選出の助言の動作確認。使い方: npm run -s selection -- 相手6匹（日本語可）
import { loadTeam } from '../src/dex/sets.js';
import { likelySets, loadLatestUsage, usageRanking } from '../src/usage/usage.js';
import { adviseSelection } from '../src/engine/selection.js';
import { jaToEn, enToJa } from '../src/dex/names.js';

const team = loadTeam('data/team/s6_umeda.json');
const db = loadLatestUsage()!;
const names = process.argv.slice(2).length ? process.argv.slice(2).map((n) => jaToEn('species', n) ?? n) : usageRanking(db, 6).map((u) => u.species);
const t = Date.now();
const r = adviseSelection(team, names.map((n) => likelySets(db, n, 2)));
console.log(`相手: ${names.map((n) => enToJa('species', n)).join('・')}（${Date.now() - t}ms）`);
for (const p of r.picks) console.log(`  ${p.mons.map((m) => enToJa('species', m)).join('・')} 先発 ${enToJa('species', p.lead)} (${p.score.toFixed(3)})`);
console.log('  不利:', r.dangers.map((d) => enToJa('species', d)).join('・') || 'なし');
for (const n of r.articleNotes) console.log('  ' + n);
