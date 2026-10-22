import { describe, expect, it } from 'vitest';
import { Tracker } from '../src/advisor/tracker.js';
import { loadTeam } from '../src/dex/sets.js';
import { loadLatestUsage } from '../src/usage/usage.js';
import { multiplierToStage, parseHp } from '../src/reader/parse.js';
import { search } from '../src/engine/search.js';

const team = loadTeam('data/team/s6_umeda.json');
const usage = loadLatestUsage();

describe('読み取り', () => {
  it('倍率から段階', () => {
    expect([1, 1.5, 2, 4, 0.67, 0.5, 0.25].map(multiplierToStage)).toEqual([0, 1, 2, 6, -1, -2, -6]);
  });
  it('HP の「/」の読み違いを最大 HP で直す', () => {
    expect(parseHp('1677215', 215)).toEqual({ cur: 167, max: 215 });
    expect(parseHp('167-215', 215)).toEqual({ cur: 167, max: 215 });
    expect(parseHp('2157215', 215)).toEqual({ cur: 215, max: 215 });
    expect(parseHp('1/149', 149)).toEqual({ cur: 1, max: 149 });
  });
});

describe('試合の流れ', () => {
  function start() {
    const t = new Tracker(team, usage);
    t.onPreview(['Charizard', 'Garchomp', 'Primarina', 'Archaludon', 'Gengar', 'Corviknight']);
    t.setMyPick(['Hippowdon', 'Lucario', 'Mimikyu']);
    t.onBattleFrame('Hippowdon', 'Charizard', { cur: 215, max: 215 }, 1);
    return t;
  }
  it('わるだくみで C+2、交代で戻る', () => {
    const t = start();
    t.onBattleFrame('Lucario', 'Charizard', undefined, undefined);
    t.onMoveSeen('mine', 'Nasty Plot');
    expect(t.boostsOf('mine')?.spa).toBe(2);
    t.onBattleFrame('Hippowdon', 'Charizard', undefined, undefined);
    t.onBattleFrame('Lucario', 'Charizard', undefined, undefined);
    expect(t.boostsOf('mine')?.spa).toBe(0);
  });
  it('相手のりゅうせいぐんで相手の C-2', () => {
    const t = start();
    t.onMoveSeen('opp', 'Draco Meteor');
    expect(t.boostsOf('opp')?.spa).toBe(-2);
  });
  it('様子を見るの画面で上書き', () => {
    const t = start();
    t.onStatusScreen('mine', { atk: 0, def: 1, spa: 0, spd: 0, spe: 0 });
    expect(t.boostsOf('mine')?.def).toBe(1);
  });
  it('ステロの優先: 撒く前は候補の一番上、撒いた後は足さない', () => {
    const t = start();
    const pref = team.preferences![0]!;
    const bonus = () => (a: { kind: string; move?: string }) => (a.kind === 'move' && a.move === pref.move && !t.oppHasRocks ? pref.bonus : 0);
    const r = search(t.battleState()!, { depth: 1, oppActiveSets: t.oppActiveSets(), rowBonus: bonus() as never });
    expect(r.candidates[0]!.action).toMatchObject({ kind: 'move', move: 'Stealth Rock' });
    t.onMoveSeen('mine', 'Stealth Rock');
    expect(t.oppHasRocks).toBe(true);
    expect(t.battleState()!.sides[1].stealthRock).toBe(true);
  });
});
