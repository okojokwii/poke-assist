// 探索エンジンが扱う盤面。シングル 3vs3 を前提にする。
// 本物のシミュレータ（Showdown）ほど細かくはなく、判断に効く要素だけを持つ（下の「扱わないもの」参照）。
import type { MonSet } from '../dex/sets.js';

export type Status = '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
export type Boosts = { atk: number; def: number; spa: number; spd: number; spe: number };

export interface MonState {
  set: MonSet;
  /** HP の割合 0〜1。0 はひんし */
  hp: number;
  status: Status;
  /** ねむりの経過ターン（チャンピオンズ: 1回目必ず行動不能、2回目 1/3 で回復、3回目必ず回復） */
  sleepTurns: number;
  /** あくびの残り。受けたターンに 2、ターン終わりごとに 1 減り、0 になった時に眠る */
  drowsy: number;
  /** ギルガルドのブレードフォルムなど、型の種とは別の今の形態 */
  form?: string;
  boosts: Boosts;
  megaEvolved: boolean;
  itemLost: boolean;
  /** ばけのかわ（ミミッキュ）が残っているか */
  disguise: boolean;
  /** こだわり系で固定された技 */
  choiceLock?: string;
  /** 相手から見えている技（相手側の推定で使う） */
  revealedMoves: string[];
}

export interface SideState {
  mons: MonState[];
  active: number;
  stealthRock: boolean;
  /** このチームでメガシンカを使ったか（1試合1回） */
  megaUsed: boolean;
}

export interface BattleState {
  sides: [SideState, SideState]; // 0 = 自分, 1 = 相手
  weather?: { kind: 'Sand' | 'Sun' | 'Rain' | 'Snow'; turns: number };
  turn: number;
}

export type Action =
  | { kind: 'move'; move: string; mega: boolean }
  | { kind: 'switch'; to: number };

// 扱わないもの（今後必要なら足す）: 急所、命中の外れ（期待値で扱う）、こんらん、まひの行動不能
// （期待値で扱う）、壁、フィールド、トリックルーム、みがわり、アンコール、ちょうはつ、PP 切れ。

export const emptyBoosts = (): Boosts => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

export function newMon(set: MonSet, hp = 1): MonState {
  return {
    set,
    hp,
    status: '',
    sleepTurns: 0,
    drowsy: 0,
    boosts: emptyBoosts(),
    megaEvolved: false,
    itemLost: false,
    disguise: set.ability === 'Disguise',
    revealedMoves: [],
  };
}

export function cloneState(s: BattleState): BattleState {
  return structuredClone(s);
}

export const activeMon = (side: SideState): MonState => side.mons[side.active]!;
export const alive = (m: MonState) => m.hp > 0;
export const aliveCount = (side: SideState) => side.mons.filter(alive).length;
