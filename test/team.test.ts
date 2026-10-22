// 記事の実数値と計算が合うか。合わなければ構築データの入力ミスか、実数値の式の違い
import { describe, expect, it } from 'vitest';
import { loadTeam, toCalcPokemon, validateSp } from '../src/dex/sets.js';
import { damage } from '../src/calc/damage.js';
import { jaToEn } from '../src/dex/names.js';

const team = loadTeam('data/team/s6_umeda.json');
// 記事の誤記と判断したもの（カバルドンの D: SP17 腕白なら 109。記事は 107）
const KNOWN_TYPOS = new Set(['Hippowdon.spd']);

describe('構築データ', () => {
  for (const m of team.members) {
    const raw = m as unknown as Record<string, Record<string, number> | undefined>;
    it(`${m.species} の SP が上限内`, () => expect(validateSp(m.sp)).toEqual([]));
    const cases: [string, Record<string, number> | undefined, boolean][] = [
      ['通常', raw.statsInArticle, false],
      ['メガ', raw.megaStatsInArticle, true],
    ];
    for (const [label, expected, mega] of cases) {
      if (!expected) continue;
      it(`${m.species}（${label}）の実数値が記事と一致`, () => {
        const p = toCalcPokemon(m, { mega });
        for (const [stat, v] of Object.entries(expected)) {
          if (KNOWN_TYPOS.has(`${m.species}.${stat}`)) continue;
          expect(p.stats[stat as keyof typeof p.stats], `${stat}`).toBe(v);
        }
      });
    }
  }
});

describe('ダメージ計算', () => {
  it('記事の調整: カバルドンは臆病C+2メガルカリオZのラスターカノンを確定耐え', () => {
    const hippo = toCalcPokemon(team.members[0]!);
    // 記事の仮想敵は「臆病 C252 相当」。チャンピオンズでは C32・臆病
    const lucario = toCalcPokemon(
      { species: 'Lucario', item: 'Lucarionite Z', nature: 'Timid', sp: { hp: 0, atk: 0, def: 0, spa: 32, spd: 2, spe: 32 }, moves: [], megaSpecies: 'Lucario-Mega-Z', megaAbility: 'Aura Guard' },
      { mega: true, boosts: { spa: 2 } },
    );
    const r = damage(lucario, hippo, 'Flash Cannon');
    expect(r.max).toBeLessThan(hippo.maxHP());
  });
});

describe('日本語名', () => {
  it('完全一致', () => expect(jaToEn('species', 'カバルドン')).toBe('Hippowdon'));
  it('ひらがなでも引ける', () => expect(jaToEn('moves', 'らすたーかのん')).toBe('Flash Cannon'));
  it('1文字の誤認識を直す', () => expect(jaToEn('moves', 'ラスターカノソ')).toBe('Flash Cannon'));
  it('短い語は誤字を許さない', () => expect(jaToEn('moves', 'はね')).toBeUndefined());
});
