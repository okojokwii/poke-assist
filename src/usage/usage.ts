// 使用率（Smogon の chaos 形式 JSON）を読み、相手の「ありそうな型」を作る。
// 出どころ: https://www.smogon.com/stats/ （Showdown 上の集計。ゲーム内のランクとは別の母集団）
import { readFileSync, readdirSync } from 'node:fs';
import type { MonSet } from '../dex/sets.js';
import { gen, toID, type StatPoints } from '../dex/gen.js';

interface ChaosEntry {
  'Raw count': number;
  usage: number;
  Abilities: Record<string, number>;
  Items: Record<string, number>;
  Spreads: Record<string, number>;
  Moves: Record<string, number>;
  Teammates: Record<string, number>;
}
export interface Chaos {
  info: { metagame: string; cutoff: number; 'number of battles': number };
  data: Record<string, ChaosEntry>;
}

export interface UsageDB {
  file: string;
  chaos: Chaos;
}

/** data/usage/ にある一番新しい JSON を読む */
export function loadLatestUsage(dir = 'data/usage'): UsageDB | undefined {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const file = files.at(-1);
  if (!file) return undefined;
  return { file, chaos: JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as Chaos };
}

function topN(rec: Record<string, number>, n: number): [string, number][] {
  const total = Object.values(rec).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => [k, v / total]);
}

const nameOf = {
  item: (id: string): string | undefined => gen.items.get(id as never)?.name,
  ability: (id: string): string | undefined => gen.abilities.get(id as never)?.name,
  move: (id: string): string | undefined => gen.moves.get(id as never)?.name,
};

function parseSpread(s: string): { nature: string; sp: StatPoints } | undefined {
  const [nature, nums] = s.split(':');
  const v = nums?.split('/').map(Number);
  if (!nature || !v || v.length !== 6) return undefined;
  const [hp, atk, def, spa, spd, spe] = v as [number, number, number, number, number, number];
  return { nature, sp: { hp, atk, def, spa, spd, spe } };
}

export interface WeightedSet {
  set: MonSet;
  weight: number;
}

/**
 * 種ごとに「ありそうな型」を k 通り作る。
 * 配分・持ち物・特性はそれぞれ上位を、技は採用率の上位4つを組む（技は配分と独立に扱う簡略化）。
 * 選出画面ではメガかどうか分からないので、元の種の名前で引くと、メガ前・メガ後（X/Y/Z を含む）の
 * 集計を使用率の比で混ぜて返す。メガの名前（Salamence-Mega など）で引けばその形だけ。
 */
export function likelySets(db: UsageDB | undefined, species: string, k = 3): WeightedSet[] {
  const data = db?.chaos.data ?? {};
  const resolved = data[species] ? species : (gen.species.get(toID(species) as never)?.name ?? species);
  const isMegaName = /-Mega(-[XYZ])?$/.test(resolved);
  const base = resolved.replace(/-Mega(-[XYZ])?$/, '');
  const forms = isMegaName
    ? [resolved].filter((f) => data[f])
    : Object.keys(data).filter((f) => f === base || /^.+-Mega(-[XYZ])?$/.test(f) && f.replace(/-Mega(-[XYZ])?$/, '') === base);
  if (!forms.length) return [fallbackSet(isMegaName ? base : species)];
  const totalUsage = forms.reduce((a, f) => a + data[f]!.usage, 0) || 1;
  const baseAbility = gen.species.get(toID(base) as never)?.abilities?.[0];
  const all: WeightedSet[] = [];
  for (const form of forms) {
    const e = data[form]!;
    const share = e.usage / totalUsage;
    const isMega = form !== base;
    const spreads = topN(e.Spreads, k);
    const items = topN(e.Items, k);
    const ability = topN(e.Abilities, 1)[0]?.[0];
    const moves = topN(e.Moves, 8)
      .map(([id]) => nameOf.move(id))
      .filter((m): m is string => !!m)
      .slice(0, 4);
    for (let i = 0; i < Math.max(spreads.length, 1); i++) {
      const sp = spreads[i] ? parseSpread(spreads[i]![0]) : undefined;
      const item = nameOf.item(items[Math.min(i, items.length - 1)]?.[0] ?? '');
      const ab = ability ? nameOf.ability(ability) : undefined;
      all.push({
        weight: share * (spreads[i]?.[1] ?? 1),
        set: {
          species: base,
          nature: sp?.nature ?? 'Hardy',
          sp: sp?.sp ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          item,
          // メガの集計の特性はメガ後のもの。メガ前は図鑑の最初の特性で仮置きする
          ability: isMega ? baseAbility : ab,
          moves,
          ...(isMega ? { megaSpecies: form, megaAbility: ab } : {}),
        },
      });
    }
  }
  const top = all.sort((a, b) => b.weight - a.weight).slice(0, k);
  const sum = top.reduce((a, b) => a + b.weight, 0) || 1;
  return top.map((w) => ({ ...w, weight: w.weight / sum }));
}

/** 使用率に無い種は、無振り・技なしの型で仮置きする（技は画面で見えたものを足す） */
function fallbackSet(species: string): WeightedSet {
  return {
    weight: 1,
    set: { species, nature: 'Hardy', sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, moves: [] },
  };
}

export function usageRanking(db: UsageDB, n = 30): { species: string; usage: number }[] {
  return Object.entries(db.chaos.data)
    .map(([species, e]) => ({ species, usage: e.usage }))
    .sort((a, b) => b.usage - a.usage)
    .slice(0, n);
}

export function topTeammates(db: UsageDB, species: string, n = 5): string[] {
  const e = db.chaos.data[species];
  return e ? topN(e.Teammates, n).map(([k]) => k) : [];
}
