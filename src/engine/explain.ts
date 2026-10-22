// 探索の結果を「候補3つ＋理由1行ずつ」（DESIGN.md §2）の文にする。
// 理由は計算で出せる事実（与える・受けるダメージ、行動順、相手の一番嫌な返し）だけで組み、推測は書かない。
import { damage } from '../calc/damage.js';
import { enToJa } from '../dex/names.js';
import { calcMon, effectiveSpeed } from './turn.js';
import { moveInfo } from './moves.js';
import { activeMon, type Action, type BattleState } from './state.js';
import type { Candidate, SearchResult } from './search.js';

export interface Advice {
  label: string;
  prob: number;
  reason: string;
}

const pct = (n: number) => `${Math.round(n)}%`;

export function actionLabel(state: BattleState, side: 0 | 1, a: Action): string {
  if (a.kind === 'switch') return `${enToJa('species', state.sides[side].mons[a.to]!.set.species)}に交代`;
  return `${a.mega ? 'メガ＋' : ''}${enToJa('moves', a.move)}`;
}

function reasonFor(state: BattleState, c: Candidate): string {
  const me = activeMon(state.sides[0]);
  const opp = activeMon(state.sides[1]);
  const parts: string[] = [];
  const a = c.action;
  if (a.kind === 'move') {
    const att = calcMon({ ...me, megaEvolved: me.megaEvolved || a.mega });
    const info = moveInfo(a.move);
    if (info.category !== 'Status') {
      const r = damage(att, calcMon(opp), a.move);
      if (r.max > 0) {
        const hpPct = opp.hp * 100;
        const ko = r.ohkoChance >= 1 ? '確1' : r.ohkoChance > 0 ? `乱1(${pct(r.ohkoChance * 100)})` : '';
        parts.push(`${pct(r.minPct)}〜${pct(r.maxPct)}（残り${pct(hpPct)}）${ko}`);
      } else {
        parts.push('効果なし');
      }
    } else {
      parts.push(statusMoveNote(a.move));
    }
    const mySpe = effectiveSpeed({ ...me, megaEvolved: me.megaEvolved || a.mega });
    const oppSpe = effectiveSpeed(opp);
    if (info.priority > 0) parts.push('先制技');
    else parts.push(mySpe > oppSpe ? '上から' : mySpe === oppSpe ? '同速' : '下から');
  }
  const reply = actionLabel(state, 1, c.worstReply);
  parts.push(`一番嫌な返し: ${reply}`);
  return parts.join(' / ');
}

function statusMoveNote(move: string): string {
  const i = moveInfo(move);
  if (i.selfBoosts) return '積み';
  if (i.heal) return '回復';
  if (i.sideCondition) return '設置';
  if (i.status || i.volatile === 'yawn') return '状態異常';
  if (i.volatile === 'protect') return '様子見';
  return '変化技';
}

/** 候補の上位3つ。確率が0の手でも、点数が近ければ載せる（均衡の近似の揺れで消えることがあるため） */
export function explain(state: BattleState, r: SearchResult, n = 3): Advice[] {
  return r.candidates.slice(0, n).map((c) => ({
    label: actionLabel(state, 0, c.action),
    prob: c.prob,
    reason: reasonFor(state, c),
  }));
}

/** 相手の手の予想（均衡での確率の上位） */
export function predictOpponent(state: BattleState, r: SearchResult, n = 3): { label: string; prob: number }[] {
  return r.oppActions
    .map((a, j) => ({ label: actionLabel(state, 1, a), prob: r.oppStrategy[j]! }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, n);
}
