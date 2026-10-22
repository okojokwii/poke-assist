// 選出の画面での助言。自分の6匹から3匹 × 相手の6匹、の相性を計算で出す。
// 1対1の相性: 両者満タンから数ターン、均衡の手で殴り合わせた後の「自分の残りHP − 相手の残りHP」（-1〜1）。
// 勝ち負けだけでなく、どれだけ余裕を持って勝つかを見るため evaluate ではなく HP の差を使う。
import type { MonSet, Team } from '../dex/sets.js';
import { enToJa } from '../dex/names.js';
import type { WeightedSet } from '../usage/usage.js';
import { evaluate } from './evaluate.js';
import { newMon, type BattleState } from './state.js';
import { search } from './search.js';
import { resolveTurn } from './turn.js';

function duelValue(me: MonSet, opp: MonSet, turns = 4): number {
  let s: BattleState = {
    sides: [
      { mons: [newMon(me)], active: 0, stealthRock: false, megaUsed: false },
      { mons: [newMon(opp)], active: 0, stealthRock: false, megaUsed: false },
    ],
    turn: 1,
  };
  for (let t = 0; t < turns; t++) {
    if (s.sides[0].mons[0]!.hp <= 0 || s.sides[1].mons[0]!.hp <= 0) break;
    const r = search(s, { depth: 1 });
    // 均衡で一番選ばれる手どうしで1ターン進める
    const i = r.myStrategy.indexOf(Math.max(...r.myStrategy));
    const j = r.oppStrategy.indexOf(Math.max(...r.oppStrategy));
    const a = r.myActions[i];
    const b = r.oppActions[j];
    if (!a || !b) break;
    s = resolveTurn(s, [a, b], evaluate);
  }
  return s.sides[0].mons[0]!.hp - s.sides[1].mons[0]!.hp;
}

export interface SelectionAdvice {
  picks: { mons: string[]; lead: string; score: number }[];
  /** 自分の誰も有利を取れない相手 */
  dangers: string[];
  /** 構築記事の選出方針のうち、相手の並びに当てはまるもの */
  articleNotes: string[];
  matrix: { me: string; opp: string; value: number }[];
}

function combinations<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  return xs.flatMap((x, i) => combinations(xs.slice(i + 1), k - 1).map((c) => [x, ...c]));
}

export function adviseSelection(team: Team, oppSets: WeightedSet[][]): SelectionAdvice {
  const me = team.members;
  const opp = oppSets.map((ws) => ws[0]!.set);
  // M[i][j]: 自分 i と相手 j の1対1。メガ枠は2匹いるので、メガした前提で測る（実際は1試合1匹）
  const M = me.map((m) => opp.map((o) => duelValue(m, o)));
  const matrix = me.flatMap((m, i) => opp.map((o, j) => ({ me: m.species, opp: o.species, value: M[i]![j]! })));

  const oppTriples = combinations(opp.map((_, j) => j), 3);
  const scored = combinations(me.map((_, i) => i), 3).map((pick) => {
    // メガは1匹だけ。メガ枠が2匹入る選出は少し割り引く
    const megas = pick.filter((i) => me[i]!.megaSpecies).length;
    // 相手の3匹ごとに、(a) 誰かが勝てるか（対応力）と (b) 3対3で1匹ずつ当てた時の一番良い組み合わせ（数の勝負）を半々で見る
    const per = oppTriples.map((tri) => {
      const coverage = tri.reduce((a, j) => a + Math.max(...pick.map((i) => M[i]![j]!)), 0) / 3;
      const assign = Math.max(...permutations(pick).map((p) => p.reduce((a, i, k) => a + M[i]![tri[k]!]!, 0) / 3));
      return 0.5 * coverage + 0.5 * assign;
    });
    const avg = per.reduce((a, b) => a + b, 0) / per.length;
    const worst = Math.min(...per);
    const score = 0.7 * avg + 0.3 * worst - (megas > 1 ? 0.05 : 0);
    // 先発: 相手全体への平均が一番良い1匹
    const lead = pick.reduce((b, i) => (avgRow(M[i]!) > avgRow(M[b]!) ? i : b), pick[0]!);
    return { mons: pick.map((i) => me[i]!.species), lead: me[lead]!.species, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const dangers = opp.filter((_, j) => Math.max(...me.map((_, i) => M[i]![j]!)) < 0).map((o) => o.species);
  const oppNames = new Set(opp.map((o) => o.species));
  const articleNotes = [
    ...team.threats.filter((t) => oppNames.has(t.species)).map((t) => `${enToJa('species', t.species)}: ${t.note}`),
    ...team.selection
      .filter((s) => SELECTION_TRIGGERS.some(([re, sp]) => re.test(s.vs) && sp.some((x) => oppNames.has(x))))
      .map((s) => `記事の方針（${s.vs}）: ${s.plan}`),
  ];
  return { picks: scored.slice(0, 3), dangers, articleNotes, matrix };
}

// 構築記事の選出方針を出す条件（方針の見出しの言葉 → 相手にいれば出すポケモン）
const SELECTION_TRIGGERS: [RegExp, string[]][] = [
  [/アシレーヌ/, ['Primarina']],
  [/カバルドン/, ['Hippowdon']],
  [/アーマーガア|ゲンガー|ブラッキー/, ['Corviknight', 'Gengar', 'Umbreon']],
  [/ミミッキュ|リザードン|ブリジュラス/, ['Mimikyu', 'Charizard', 'Archaludon']],
  [/ルカリオ/, ['Lucario']],
];

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

const avgRow = (r: number[]) => r.reduce((a, b) => a + b, 0) / r.length;
