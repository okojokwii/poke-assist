// 探索（DESIGN.md §5-2〜4）。手の組み合わせを数ターン先まで進め、各局面で損得の表を作って均衡を解く。
// 相手の型が見えない分は、相手の場のポケモンについて「ありそうな型」を何通りか入れ替えて計算し、重みで合わせる。
import { evaluate } from './evaluate.js';
import { solveNash } from './nash.js';
import { legalActions, resolveTurn } from './turn.js';
import { activeMon, aliveCount, cloneState, type Action, type BattleState } from './state.js';
import type { WeightedSet } from '../usage/usage.js';

export interface SearchOptions {
  /** 何ターン先まで読むか。2 で 1 局面あたり 0.5〜数秒 */
  depth: number;
  /** 相手の場のポケモンの型の候補（無ければ盤面の型だけで読む） */
  oppActiveSets?: WeightedSet[];
  /** 打ち切りの時間（ミリ秒）。超えたら浅い読みの結果を返す */
  timeLimitMs?: number;
}

export interface Candidate {
  action: Action;
  /** 均衡での選ぶ確率 */
  prob: number;
  /** 相手の均衡の手に対するこの手の期待値 */
  value: number;
  /** この手に対して相手が一番嫌な手を選んだ時の値 */
  worst: number;
  worstReply: Action;
}

export interface SearchResult {
  myActions: Action[];
  oppActions: Action[];
  matrix: number[][];
  myStrategy: number[];
  oppStrategy: number[];
  value: number;
  candidates: Candidate[];
  depthReached: number;
}

function nodeValue(state: BattleState, depth: number, deadline: number): number {
  if (depth <= 0 || aliveCount(state.sides[0]) === 0 || aliveCount(state.sides[1]) === 0 || Date.now() > deadline) {
    return evaluate(state);
  }
  const mine = legalActions(state, 0);
  const theirs = legalActions(state, 1);
  if (!mine.length || !theirs.length) return evaluate(state);
  const m = mine.map((a) => theirs.map((b) => nodeValue(resolveTurn(state, [a, b], evaluate), depth - 1, deadline)));
  return solveNash(m, 400).value;
}

function buildMatrix(state: BattleState, mine: Action[], theirs: Action[], depth: number, deadline: number): number[][] {
  return mine.map((a) => theirs.map((b) => nodeValue(resolveTurn(state, [a, b], evaluate), depth - 1, deadline)));
}

/** 型の候補ごとの表を重みで足し合わせる。相手の手は「技の名前」で揃える（型によって技が違うため和集合を取る） */
function expectedMatrix(state: BattleState, depth: number, opts: SearchOptions, deadline: number) {
  const variants: { state: BattleState; weight: number }[] = [];
  if (opts.oppActiveSets?.length) {
    for (const ws of opts.oppActiveSets) {
      const s = cloneState(state);
      const m = activeMon(s.sides[1]);
      // 見えている情報（HP・状態・能力変化・見えた技）は残し、型だけ入れ替える
      const revealed = m.revealedMoves;
      m.set = { ...ws.set, moves: [...new Set([...revealed, ...ws.set.moves])].slice(0, 4) };
      m.disguise = m.disguise && ws.set.ability === 'Disguise';
      variants.push({ state: s, weight: ws.weight });
    }
  } else {
    variants.push({ state, weight: 1 });
  }
  const mine = legalActions(state, 0);
  const keyOf = (a: Action) => (a.kind === 'move' ? `m:${a.move}` : `s:${a.to}`);
  const oppAll = new Map<string, Action>();
  for (const v of variants) for (const a of legalActions(v.state, 1)) oppAll.set(keyOf(a), a);
  const theirs = [...oppAll.values()];
  const matrix = mine.map(() => theirs.map(() => 0));
  const weightSum = mine.map(() => theirs.map(() => 0));
  for (const v of variants) {
    const local = legalActions(v.state, 1);
    const sub = buildMatrix(v.state, mine, local, depth, deadline);
    local.forEach((b, lj) => {
      const j = theirs.findIndex((t) => keyOf(t) === keyOf(b));
      for (let i = 0; i < mine.length; i++) {
        matrix[i]![j] = matrix[i]![j]! + sub[i]![lj]! * v.weight;
        weightSum[i]![j] = weightSum[i]![j]! + v.weight;
      }
    });
  }
  // その型では持っていない技の列は、持っている型だけの平均で埋める
  for (let i = 0; i < mine.length; i++)
    for (let j = 0; j < theirs.length; j++) matrix[i]![j] = weightSum[i]![j]! > 0 ? matrix[i]![j]! / weightSum[i]![j]! : 0;
  return { mine, theirs, matrix };
}

export function search(state: BattleState, opts: SearchOptions): SearchResult {
  const deadline = Date.now() + (opts.timeLimitMs ?? 8000);
  let result: SearchResult | undefined;
  // 浅い読みから順に深くし、時間切れなら直前の深さの結果を使う
  for (let d = 1; d <= opts.depth; d++) {
    const { mine, theirs, matrix } = expectedMatrix(state, d, opts, d === 1 ? Infinity : deadline);
    if (d > 1 && Date.now() > deadline) break;
    const nash = solveNash(matrix);
    const candidates: Candidate[] = mine.map((action, i) => {
      const row = matrix[i]!;
      const value = row.reduce((a, v, j) => a + v * nash.col[j]!, 0);
      const wj = row.indexOf(Math.min(...row));
      return { action, prob: nash.row[i]!, value, worst: row[wj]!, worstReply: theirs[wj]! };
    });
    candidates.sort((a, b) => b.prob - a.prob || b.value - a.value);
    result = {
      myActions: mine,
      oppActions: theirs,
      matrix,
      myStrategy: nash.row,
      oppStrategy: nash.col,
      value: nash.value,
      candidates,
      depthReached: d,
    };
  }
  return result!;
}

