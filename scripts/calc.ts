// 対戦中に手で引く確定数の表。自分の構築 × 相手（使用率の型）の総当たり。
// 使い方: npm run calc -- <相手の名前（日本語可）> [相手の名前...]
//   例: npm run calc -- アシレーヌ カバルドン
import { loadTeam, toCalcPokemon } from '../src/dex/sets.js';
import { damage } from '../src/calc/damage.js';
import { jaToEn } from '../src/dex/names.js';
import { likelySets, loadLatestUsage } from '../src/usage/usage.js';

const team = loadTeam('data/team/s6_umeda.json');
const db = loadLatestUsage();
const pct = (r: { minPct: number; maxPct: number }) => `${r.minPct.toFixed(1)}-${r.maxPct.toFixed(1)}%`;

for (const arg of process.argv.slice(2)) {
  const species = jaToEn('species', arg) ?? arg;
  const [top] = likelySets(db, species, 1);
  if (!top) continue;
  const opp = top.set;
  console.log(`\n■ ${species}（想定: ${opp.nature} ${JSON.stringify(opp.sp)} @${opp.item ?? '-'} / ${opp.moves.join('・')}）`);
  for (const me of team.members) {
    for (const mega of me.megaSpecies ? [false, true] : [false]) {
      const a = toCalcPokemon(me, { mega });
      const d = toCalcPokemon(opp, { mega: !!opp.megaSpecies });
      const out = me.moves
        .map((m) => damage(a, d, m))
        .filter((r) => r.max > 0)
        .map((r) => `${r.move} ${pct(r)}`);
      const inc = opp.moves
        .map((m) => damage(d, a, m))
        .filter((r) => r.max > 0)
        .map((r) => `${r.move} ${pct(r)}`);
      console.log(`  ${a.name}\n    与: ${out.join(' / ') || '-'}\n    被: ${inc.join(' / ') || '-'}`);
    }
  }
}
