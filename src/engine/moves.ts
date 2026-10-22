// 技の効果のデータ。Showdown のチャンピオンズ用データ（mod: champions）から引く。
// ダメージの数値は @smogon/calc、命中・追加効果・優先度・PP はこちら。
import ps from 'pokemon-showdown';

const dex = ps.Dex.mod('champions');

export interface MoveInfo {
  name: string;
  category: 'Physical' | 'Special' | 'Status';
  /** 0〜1。必中は 1 */
  accuracy: number;
  priority: number;
  pp: number;
  status?: string;
  volatile?: string;
  boosts?: Record<string, number>;
  selfBoosts?: Record<string, number>;
  heal?: number;
  selfSwitch: boolean;
  sideCondition?: string;
  recoil?: number;
  weather?: string;
  /** 自分に向けた変化技か */
  targetsSelf: boolean;
}

const cache = new Map<string, MoveInfo>();

export function moveInfo(name: string): MoveInfo {
  let m = cache.get(name);
  if (m) return m;
  const x = dex.moves.get(name);
  m = {
    name: x.name,
    category: x.category,
    accuracy: x.accuracy === true ? 1 : x.accuracy / 100,
    priority: x.priority,
    pp: x.pp,
    status: x.status ?? undefined,
    volatile: x.volatileStatus ?? undefined,
    boosts: x.target === 'self' ? undefined : (x.boosts as Record<string, number> | undefined) ?? undefined,
    selfBoosts:
      (x.self?.boosts as Record<string, number> | undefined) ??
      (x.target === 'self' ? ((x.boosts as Record<string, number> | undefined) ?? undefined) : undefined),
    heal: x.heal ? x.heal[0]! / x.heal[1]! : undefined,
    selfSwitch: !!x.selfSwitch,
    sideCondition: x.sideCondition ?? undefined,
    recoil: x.recoil ? x.recoil[0]! / x.recoil[1]! : undefined,
    weather: x.weather ?? undefined,
    targetsSelf: x.target === 'self',
  };
  cache.set(name, m);
  return m;
}

export function speciesTypes(species: string): string[] {
  return [...dex.species.get(species).types];
}
