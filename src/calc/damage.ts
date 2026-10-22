// ダメージ計算。中身は @smogon/calc（チャンピオンズ対応）。ここでは結果を使いやすい形に直すだけ。
import { calculate, Field, Move, type Pokemon } from '@smogon/calc';
import { gen } from '../dex/gen.js';

export interface FieldInput {
  weather?: 'Sun' | 'Rain' | 'Sand' | 'Snow';
  terrain?: 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  /** 防御側の場のステルスロック等（交代時の計算用） */
  defenderStealthRock?: boolean;
  defenderReflect?: boolean;
  defenderLightScreen?: boolean;
}

export interface DamageResult {
  move: string;
  /** 16通りの乱数のダメージ（急所なし）。変化技や無効なら [0] */
  rolls: number[];
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  defenderHP: number;
  /** 今の HP から1発で倒せる確率（乱数のみ。急所・命中は含めない） */
  ohkoChance: number;
  /** 「確定2発」などの説明。計算ライブラリの文をそのまま */
  desc: string;
}

export function toField(f: FieldInput = {}): Field {
  return new Field({
    weather: f.weather,
    terrain: f.terrain,
    defenderSide: {
      isSR: f.defenderStealthRock,
      isReflect: f.defenderReflect,
      isLightScreen: f.defenderLightScreen,
    },
  });
}

export function damage(
  attacker: Pokemon,
  defender: Pokemon,
  moveName: string,
  field: FieldInput = {},
  opts: { crit?: boolean } = {},
): DamageResult {
  const move = new Move(gen, moveName, { isCrit: opts.crit });
  const r = calculate(gen, attacker, defender, move, toField(field));
  const raw = r.damage;
  // 多段技は [[...],[...]] の形で返る。1回あたりを足し合わせて16通りに畳む
  const rolls: number[] =
    typeof raw === 'number'
      ? [raw]
      : Array.isArray(raw[0])
        ? (raw[0] as number[]).map((_, i) => (raw as number[][]).reduce((a, hits) => a + (hits[i] ?? 0), 0))
        : (raw as number[]);
  const hp = defender.curHP();
  const max = Math.max(...rolls);
  const min = Math.min(...rolls);
  let desc = '';
  try {
    desc = r.desc();
  } catch {
    desc = max === 0 ? '効果なし／変化技' : '';
  }
  return {
    move: move.name,
    rolls,
    min,
    max,
    minPct: (min / defender.maxHP()) * 100,
    maxPct: (max / defender.maxHP()) * 100,
    defenderHP: hp,
    ohkoChance: rolls.filter((d) => d >= hp).length / rolls.length,
    desc,
  };
}

/** 受けた・与えたダメージが計算の範囲に入っているか（記録での答え合わせ用） */
export function isWithinRange(result: DamageResult, observed: number, crit = false): boolean {
  if (crit) return true; // 急所は別に計算し直す側で扱う
  return observed >= result.min && observed <= result.max;
}
