// 試合の記録のダメージが、計算の範囲に入っているかを照らす（DESIGN.md §4「検証」）。
// 外れが続く組み合わせは、チャンピオンズの仕様が本編と違う箇所の手がかりになる。
// 使い方: npm run verify
// 注意: 相手の型は使用率からの推定なので、外れても仕様違いとは限らない（相手が珍しい型の場合がある）。
//       急所・定数ダメージ（砂・ステロ等）が混ざった観測も外れとして出る。
import { loadMatches } from '../src/match/log.js';
import { loadTeam, toCalcPokemon, type MonSet } from '../src/dex/sets.js';
import { damage } from '../src/calc/damage.js';
import { likelySets, loadLatestUsage } from '../src/usage/usage.js';
import { enToJa } from '../src/dex/names.js';

const team = loadTeam(process.env.PA_TEAM ?? 'data/team/s6_umeda.json');
const db = loadLatestUsage();
const mine = (sp: string) => team.members.find((m) => m.species === sp);
// HP バーの読み取りの誤差（割合）。バーの幅の画素数で決まるので、実機で確かめて直す
const BAR_TOLERANCE_PCT = 1.5;

let inRange = 0;
const misses: string[] = [];
let skipped = 0;

function ranges(att: MonSet, def: MonSet, move: string, attMega: boolean, defMega: boolean, hpFrac: number) {
  return damage(toCalcPokemon(att, { mega: attMega }), toCalcPokemon(def, { mega: defMega, hpFraction: hpFrac }), move);
}

for (const m of loadMatches()) {
  for (const o of m.damage) {
    if (o.dir === 'taken') {
      const me = mine(o.defender);
      if (!me || !o.move) {
        skipped++;
        continue;
      }
      const dealt = o.before - o.after;
      const sets = likelySets(db, o.attacker, 5).map((w) => w.set);
      const ok = sets.some((s) =>
        [false, true].some((am) => [false, true].some((dm) => {
          const r = ranges(s, me, o.move!, am && !!s.megaSpecies, dm && !!me.megaSpecies, o.before / toCalcPokemon(me).maxHP());
          return dealt >= r.min && dealt <= r.max;
        })),
      );
      if (ok) inRange++;
      else misses.push(`${m.id} T${o.turn}: ${enToJa('species', o.attacker)}の${enToJa('moves', o.move)} → ${enToJa('species', o.defender)} ${dealt}ダメージ（計算の範囲外）`);
    } else {
      const me = mine(o.attacker);
      if (!me) {
        skipped++;
        continue;
      }
      const dealtPct = o.before - o.after;
      const sets = likelySets(db, o.defender, 5).map((w) => w.set);
      const ok = me.moves.some((mv) =>
        sets.some((s) =>
          [false, true].some((am) => {
            const r = ranges(me, s, mv, am && !!me.megaSpecies, !!s.megaSpecies, o.before / 100);
            return dealtPct >= r.minPct - BAR_TOLERANCE_PCT && dealtPct <= r.maxPct + BAR_TOLERANCE_PCT;
          }),
        ),
      );
      if (ok) inRange++;
      else misses.push(`${m.id} T${o.turn}: ${enToJa('species', o.attacker)} → ${enToJa('species', o.defender)} ${dealtPct.toFixed(1)}%（どの技の範囲にも入らない）`);
    }
  }
}

console.log(`範囲内 ${inRange} / 範囲外 ${misses.length} / 照らせない ${skipped}`);
for (const l of misses) console.log('  ' + l);
