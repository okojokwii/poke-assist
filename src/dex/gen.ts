// チャンピオンズの世代データ。@smogon/calc では gen.num = 0 がチャンピオンズ
import { Generations } from '@smogon/calc';

export const gen = Generations.get(0);

export const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type StatID = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export const STAT_IDS: readonly StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
/** 能力ポイント（SP）。1能力 最大32、合計66 */
export type StatPoints = Record<StatID, number>;
