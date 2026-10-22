// ポケモン1匹の型（自分の構築・相手の推定型の共通の形）と、計算用の Pokemon への変換
import { Pokemon } from '@smogon/calc';
import { readFileSync } from 'node:fs';
import { gen, type StatPoints, type StatID } from './gen.js';

export interface MonSet {
  species: string;
  item?: string;
  ability?: string;
  nature: string;
  sp: StatPoints;
  moves: string[];
  /** メガシンカ後の種（持ち物でメガシンカする場合） */
  megaSpecies?: string;
  megaAbility?: string;
}

export interface Team {
  name: string;
  source: string;
  fetched_at: string;
  members: (MonSet & { role?: string })[];
  selection: { vs: string; pick: string[] | string; plan: string }[];
  threats: { species: string; note: string }[];
}

export function loadTeam(path: string): Team {
  return JSON.parse(readFileSync(path, 'utf8')) as Team;
}

export interface BattleCondition {
  /** HP の割合 0〜1。未指定は満タン */
  hpFraction?: number;
  boosts?: Partial<Record<Exclude<StatID, 'hp'>, number>>;
  status?: '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
  mega?: boolean;
  /** 持ち物が消費・はたき落とされた */
  itemLost?: boolean;
  /** ばけのかわが剥がれた等、特性の状態を外から変える場合 */
  abilityOn?: boolean;
}

export function toCalcPokemon(set: MonSet, cond: BattleCondition = {}): Pokemon {
  const mega = cond.mega && set.megaSpecies;
  const p = new Pokemon(gen, mega ? set.megaSpecies! : set.species, {
    nature: set.nature,
    evs: set.sp,
    ability: mega ? (set.megaAbility ?? set.ability) : set.ability,
    item: cond.itemLost ? undefined : set.item,
    boosts: cond.boosts,
    status: cond.status || undefined,
    abilityOn: cond.abilityOn,
  });
  if (cond.hpFraction !== undefined) {
    p.originalCurHP = Math.max(1, Math.round(p.maxHP() * cond.hpFraction));
  }
  return p;
}

/** SP の合計・上限を確かめる（構築データの入力ミスを見つける用） */
export function validateSp(sp: StatPoints): string[] {
  const errors: string[] = [];
  const total = Object.values(sp).reduce((a, b) => a + b, 0);
  if (total > 66) errors.push(`SP の合計が ${total}（上限 66）`);
  for (const [k, v] of Object.entries(sp)) if (v > 32 || v < 0) errors.push(`${k} の SP が ${v}（0〜32）`);
  return errors;
}
