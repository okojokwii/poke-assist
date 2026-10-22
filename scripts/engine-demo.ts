// 探索エンジンの動作確認。自分（カバルドン・ルカリオ・ミミッキュ）vs 相手（使用率上位の型）
import { loadTeam } from '../src/dex/sets.js';
import { likelySets, loadLatestUsage } from '../src/usage/usage.js';
import { newMon, type BattleState } from '../src/engine/state.js';
import { search } from '../src/engine/search.js';

const team = loadTeam('data/team/s6_umeda.json');
const db = loadLatestUsage();
const pick = (s: string) => team.members.find((m) => m.species === s)!;
const opp = (process.argv.slice(2).length ? process.argv.slice(2) : ['Primarina', 'Hippowdon', 'Salamence-Mega']).map((s) => likelySets(db, s, 1)[0]!.set);
const state: BattleState = {
  sides: [
    { mons: [pick('Mimikyu'), pick('Hippowdon'), pick('Lucario')].map((s) => newMon(s)), active: 0, stealthRock: false, megaUsed: false },
    { mons: opp.map((s) => newMon(s)), active: 0, stealthRock: false, megaUsed: false },
  ],
  turn: 1,
};
for (const depth of [1, 2]) {
  const t = Date.now();
  const r = search(state, { depth, oppActiveSets: likelySets(db, opp[0]!.species, 3), timeLimitMs: 20000 });
  console.log(`depth ${r.depthReached}: ${Date.now() - t}ms value=${r.value.toFixed(3)}`);
  for (const c of r.candidates.slice(0, 4)) console.log('  ', JSON.stringify(c.action), (c.prob * 100).toFixed(0) + '%', c.value.toFixed(3), 'worst', c.worst.toFixed(3), JSON.stringify(c.worstReply));
}
