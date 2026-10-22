// 1ターンの進行。「この盤面で、こちらが A・相手が B を選んだら次はどうなるか」（DESIGN.md §5-1）。
// 乱数は分岐させず期待値で進める（ダメージは16通りの平均、命中・まひは確率を掛ける）。
// 分岐させない分だけ速く、数ターン先まで読める。細かい確率の評価は助言の理由（explain）側で出す。
import { toCalcPokemon } from '../dex/sets.js';
import { damage } from '../calc/damage.js';
import { gen } from '../dex/gen.js';
import { moveInfo, speciesTypes } from './moves.js';
import {
  activeMon,
  alive,
  cloneState,
  emptyBoosts,
  type Action,
  type BattleState,
  type MonState,
  type SideState,
} from './state.js';

// ---- 計算のキャッシュ（同じ組み合わせを何度も計算しないため） ----

const dmgCache = new Map<string, number>();

function monKey(m: MonState): string {
  return [m.form ?? '', m.megaEvolved, m.set.species, m.set.item, m.itemLost, m.set.nature, Object.values(m.set.sp).join('/'),
    Object.values(m.boosts).join('/'), Math.round(m.hp * 100), m.status].join('|');
}

/** 平均ダメージを最大 HP に対する割合で返す */
function avgDamageFraction(att: MonState, def: MonState, move: string, state: BattleState, alliesFainted: number): number {
  const key = `${monKey(att)}>${monKey(def)}>${move}>${state.weather?.kind ?? ''}>${alliesFainted}`;
  const hit = dmgCache.get(key);
  if (hit !== undefined) return hit;
  const a = calcMon(att);
  if (alliesFainted) a.alliesFainted = alliesFainted;
  const d = calcMon(def);
  let frac = 0;
  try {
    const r = damage(a, d, move, { weather: state.weather?.kind });
    frac = r.rolls.reduce((x, y) => x + y, 0) / r.rolls.length / d.maxHP();
  } catch {
    frac = 0; // 計算ライブラリが扱えない技は 0 として扱う
  }
  if (dmgCache.size > 200_000) dmgCache.clear();
  dmgCache.set(key, frac);
  return frac;
}

export function calcMon(m: MonState) {
  const p = toCalcPokemon(m.form ? { ...m.set, species: m.form, megaSpecies: undefined } : m.set, {
    mega: m.megaEvolved,
    boosts: m.boosts,
    status: m.status,
    itemLost: m.itemLost,
    hpFraction: m.hp,
  });
  return p;
}

// ---- 素早さと行動順 ----

export function effectiveSpeed(m: MonState): number {
  let s = calcMon(m).stats.spe;
  const b = m.boosts.spe;
  s = Math.floor((s * (b >= 0 ? 2 + b : 2)) / (b >= 0 ? 2 : 2 - b));
  if (m.set.item === 'Choice Scarf' && !m.itemLost) s = Math.floor(s * 1.5);
  if (m.status === 'par') s = Math.floor(s / 2);
  return s;
}

function priorityOf(m: MonState, action: Action): number {
  if (action.kind === 'switch') return 7;
  return moveInfo(action.move).priority;
}

// ---- 場に出る・交代 ----

export function typeEffectiveness(moveType: string, species: string): number {
  return speciesTypes(species).reduce((x, t) => x * gen.types.get(t.toLowerCase() as never)!.effectiveness[moveType as never]!, 1);
}

export function curSpecies(m: MonState): string {
  if (m.form) return m.form;
  return m.megaEvolved && m.set.megaSpecies ? m.set.megaSpecies : m.set.species;
}

function onSwitchIn(state: BattleState, sideIdx: 0 | 1) {
  const side = state.sides[sideIdx];
  const m = activeMon(side);
  if (side.stealthRock && m.set.item !== 'Heavy-Duty Boots') {
    m.hp = Math.max(0, m.hp - typeEffectiveness('Rock', curSpecies(m)) / 8);
  }
  if (m.set.ability === 'Sand Stream') state.weather = { kind: 'Sand', turns: 5 }; // 仮: 本編準拠（5ターン）
}

function switchTo(state: BattleState, sideIdx: 0 | 1, to: number) {
  const side = state.sides[sideIdx];
  const out = activeMon(side);
  out.boosts = emptyBoosts();
  out.choiceLock = undefined;
  out.drowsy = 0;
  if (out.set.species.startsWith('Aegislash')) out.form = undefined;
  side.active = to;
  onSwitchIn(state, sideIdx);
}

/** ひんし後・とんぼがえり後に出すポケモンを決める。評価が一番良くなるものを選ぶ */
export function chooseReplacement(state: BattleState, sideIdx: 0 | 1, evaluate: (s: BattleState) => number): number | undefined {
  const side = state.sides[sideIdx];
  const options = side.mons.map((m, i) => ({ m, i })).filter(({ m, i }) => alive(m) && i !== side.active);
  let best: { i: number; v: number } | undefined;
  for (const { i } of options) {
    const s = cloneState(state);
    switchTo(s, sideIdx, i);
    const v = evaluate(s) * (sideIdx === 0 ? 1 : -1);
    if (!best || v > best.v) best = { i, v };
  }
  return best?.i;
}

// ---- 技 ----

const STATUS_IMMUNE: Record<string, string[]> = {
  brn: ['Fire'],
  par: ['Electric'],
  psn: ['Poison', 'Steel'],
  tox: ['Poison', 'Steel'],
  frz: ['Ice'],
  slp: [],
};

interface TurnCtx {
  protectedSide: [boolean, boolean];
  evaluate: (s: BattleState) => number;
}

function faintedCount(side: SideState): number {
  return side.mons.filter((m) => !alive(m)).length;
}

function useMove(state: BattleState, atkIdx: 0 | 1, action: Extract<Action, { kind: 'move' }>, ctx: TurnCtx) {
  const atkSide = state.sides[atkIdx];
  const defIdx = (1 - atkIdx) as 0 | 1;
  const defSide = state.sides[defIdx];
  const att = activeMon(atkSide);
  const def = activeMon(defSide);
  if (!alive(att)) return;

  // ねむり・こおり（チャンピオンズ: ねむりは1回目必ず行動不能、2回目 1/3 で回復、3回目必ず回復）
  if (att.status === 'slp') {
    att.sleepTurns++;
    if (att.sleepTurns < 3) return; // 2回目の 1/3 は期待値に入れず、起きない側で読む（慎重側）
    att.status = '';
    att.sleepTurns = 0;
  }
  if (att.status === 'frz') return; // 仮: こおりは解けない側で読む

  const info = moveInfo(action.move);
  // まひの行動不能はチャンピオンズでは 1/8
  const p = info.accuracy * (att.status === 'par' ? 7 / 8 : 1);
  if (att.set.item?.startsWith('Choice') && !att.itemLost) att.choiceLock = action.move;

  if (att.set.species.startsWith('Aegislash')) att.form = info.category === 'Status' ? undefined : 'Aegislash-Blade';

  if (info.targetsSelf || info.category === 'Status') {
    applyStatusMove(state, att, def, defSide, info, p);
  } else {
    if (ctx.protectedSide[defIdx]) return;
    let frac = alive(def) ? avgDamageFraction(att, def, action.move, state, faintedCount(atkSide)) * p : 0;
    if (frac > 0 && def.disguise) {
      def.disguise = false;
      frac = 1 / 8; // ばけのかわ: 攻撃を無効にし、最大 HP の 1/8 を受ける
    }
    if (frac >= def.hp && def.hp === 1 && def.set.item === 'Focus Sash' && !def.itemLost) {
      frac = def.hp - 0.01;
      def.itemLost = true;
    }
    const dealt = Math.min(def.hp, frac);
    def.hp = Math.max(0, def.hp - frac);
    if (info.recoil) att.hp = Math.max(0, att.hp - (dealt * calcMon(def).maxHP() * info.recoil) / calcMon(att).maxHP());
    if (att.set.item === 'Life Orb' && !att.itemLost && dealt > 0) att.hp = Math.max(0, att.hp - 0.1);
    if (info.selfBoosts) applyBoosts(att, info.selfBoosts);
    if (action.move === 'Knock Off' && def.set.item) def.itemLost = true;
    if (info.selfSwitch && alive(att)) {
      const to = chooseReplacement(state, atkIdx, ctx.evaluate);
      if (to !== undefined) switchTo(state, atkIdx, to);
    }
  }
}

function applyBoosts(m: MonState, b: Record<string, number>) {
  for (const [k, v] of Object.entries(b)) {
    if (k in m.boosts) {
      const key = k as keyof typeof m.boosts;
      m.boosts[key] = Math.max(-6, Math.min(6, m.boosts[key] + v));
    }
  }
}

function applyStatusMove(
  state: BattleState,
  att: MonState,
  def: MonState,
  defSide: SideState,
  info: ReturnType<typeof moveInfo>,
  p: number,
) {
  if (info.selfBoosts) applyBoosts(att, info.selfBoosts);
  if (info.heal) att.hp = Math.min(1, att.hp + info.heal * p);
  if (info.sideCondition === 'stealthrock') defSide.stealthRock = true;
  if (info.weather) state.weather = { kind: info.weather as 'Sand', turns: 5 };
  if (!alive(def)) return;
  if (info.boosts) applyBoosts(def, info.boosts);
  // 状態異常は、確率が半分以上なら入った側で読む（期待値で「半分眠る」は表せないため）
  if (p >= 0.5 && def.status === '') {
    const types = speciesTypes(curSpecies(def));
    if (info.status && !STATUS_IMMUNE[info.status]?.some((t) => types.includes(t))) {
      if (!(info.status === 'par' && info.name === 'Thunder Wave' && types.includes('Ground'))) def.status = info.status as MonState['status'];
    }
    if (info.volatile === 'yawn' && def.drowsy === 0) def.drowsy = 2;
  }
}

// ---- ターン終わり ----

function endOfTurn(state: BattleState) {
  for (const side of state.sides) {
    const m = activeMon(side);
    if (!alive(m)) continue;
    const types = speciesTypes(curSpecies(m));
    if (state.weather?.kind === 'Sand' && !types.some((t) => ['Rock', 'Ground', 'Steel'].includes(t)) && m.set.ability !== 'Sand Veil')
      m.hp -= 1 / 16;
    if (m.set.item === 'Leftovers' && !m.itemLost) m.hp += 1 / 16;
    if (m.status === 'brn') m.hp -= 1 / 16;
    if (m.status === 'psn' || m.status === 'tox') m.hp -= 1 / 8; // 仮: もうどくも平均して 1/8
    if (m.drowsy > 0) {
      m.drowsy--;
      if (m.drowsy === 0 && m.status === '') {
        m.status = 'slp';
        m.sleepTurns = 0;
      }
    }
    m.hp = Math.max(0, Math.min(1, m.hp));
  }
  if (state.weather && --state.weather.turns <= 0) state.weather = undefined;
}

// ---- 1ターン ----

export function resolveTurn(
  state: BattleState,
  actions: [Action, Action],
  evaluate: (s: BattleState) => number,
): BattleState {
  const s = cloneState(state);
  const ctx: TurnCtx = { protectedSide: [false, false], evaluate };

  // 交代が先
  for (const i of [0, 1] as const) {
    const a = actions[i];
    if (a.kind === 'switch') switchTo(s, i, a.to);
  }
  // メガシンカ（素早さはメガ後の値で比べる）
  for (const i of [0, 1] as const) {
    const a = actions[i];
    const m = activeMon(s.sides[i]);
    if (a.kind === 'move' && a.mega && m.set.megaSpecies && !s.sides[i].megaUsed) {
      m.megaEvolved = true;
      s.sides[i].megaUsed = true;
    }
  }
  for (const i of [0, 1] as const) {
    const a = actions[i];
    if (a.kind === 'move' && moveInfo(a.move).volatile === 'protect') ctx.protectedSide[i] = true;
  }

  const order = moveOrder(s, actions);
  for (const i of order) {
    const a = actions[i];
    if (a.kind === 'move') useMove(s, i, a, ctx);
  }
  endOfTurn(s);
  // ひんしの交代
  for (const i of [0, 1] as const) {
    if (!alive(activeMon(s.sides[i]))) {
      const to = chooseReplacement(s, i, evaluate);
      if (to !== undefined) switchTo(s, i, to);
    }
  }
  s.turn++;
  return s;
}

/** 技を使う順。同速は自分が先として扱う（同速の読み合いは理由の文で注意を出す） */
export function moveOrder(s: BattleState, actions: [Action, Action]): (0 | 1)[] {
  const p0 = priorityOf(activeMon(s.sides[0]), actions[0]);
  const p1 = priorityOf(activeMon(s.sides[1]), actions[1]);
  if (p0 !== p1) return p0 > p1 ? [0, 1] : [1, 0];
  return effectiveSpeed(activeMon(s.sides[0])) >= effectiveSpeed(activeMon(s.sides[1])) ? [0, 1] : [1, 0];
}

// ---- 選べる手 ----

export function legalActions(state: BattleState, sideIdx: 0 | 1): Action[] {
  const side = state.sides[sideIdx];
  const m = activeMon(side);
  const out: Action[] = [];
  if (alive(m)) {
    const moves = m.choiceLock ? [m.choiceLock] : [...new Set([...m.set.moves, ...m.revealedMoves])].slice(0, 4);
    const canMega = !!m.set.megaSpecies && !side.megaUsed && !m.megaEvolved;
    for (const move of moves) {
      // メガシンカできるなら、する方だけを候補にする（しない理由がある場面は少なく、手の数を半分にできる）
      out.push({ kind: 'move', move, mega: canMega });
    }
  }
  side.mons.forEach((b, i) => {
    if (i !== side.active && alive(b)) out.push({ kind: 'switch', to: i });
  });
  return out;
}
