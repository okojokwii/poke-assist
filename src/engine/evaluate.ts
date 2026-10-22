// 盤面の有利さの点数。自分から見て +1 が勝ち確定、-1 が負け確定に近い。
import { activeMon, alive, aliveCount, type BattleState, type MonState, type SideState } from './state.js';

function monValue(m: MonState): number {
  if (!alive(m)) return 0;
  // 生きているだけで価値がある（数的有利）＋ HP の分
  let v = 0.35 + 0.65 * m.hp;
  if (m.status === 'slp') v -= 0.12;
  else if (m.status === 'brn' || m.status === 'par' || m.status === 'tox') v -= 0.07;
  else if (m.status === 'psn') v -= 0.04;
  if (m.disguise) v += 0.05;
  if (m.drowsy > 0) v -= 0.05;
  return v;
}

function sideValue(side: SideState): number {
  let v = side.mons.reduce((a, m) => a + monValue(m), 0);
  const act = activeMon(side);
  if (alive(act)) {
    // 積んだ能力は、場にいる間だけの価値として小さめに数える
    const b = act.boosts;
    v += 0.04 * (Math.max(b.atk, b.spa) + Math.max(0, b.spe) * 0.75) - 0.02 * Math.max(0, -Math.min(b.def, b.spd));
  }
  // ステルスロックは、相手の控えの数だけ効いてくる
  if (side.stealthRock) v -= 0.04 * Math.max(0, aliveCount(side) - 1);
  return v;
}

export function evaluate(state: BattleState): number {
  const [me, opp] = state.sides;
  if (aliveCount(opp) === 0 && aliveCount(me) > 0) return 1;
  if (aliveCount(me) === 0 && aliveCount(opp) > 0) return -1;
  const n = Math.max(me.mons.length, opp.mons.length);
  return Math.max(-1, Math.min(1, (sideValue(me) - sideValue(opp)) / n));
}
