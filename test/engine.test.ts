import { describe, expect, it } from 'vitest';
import { solveNash } from '../src/engine/nash.js';
import { newMon, activeMon, type BattleState, type Action } from '../src/engine/state.js';
import { resolveTurn, moveOrder } from '../src/engine/turn.js';
import { evaluate } from '../src/engine/evaluate.js';
import { loadTeam } from '../src/dex/sets.js';

const team = loadTeam('data/team/s6_umeda.json');
const pick = (s: string) => team.members.find((m) => m.species === s)!;
const mv = (move: string, mega = false): Action => ({ kind: 'move', move, mega });

function duel(a: string[], b: string[]): BattleState {
  return {
    sides: [
      { mons: a.map((s) => newMon(pick(s))), active: 0, stealthRock: false, megaUsed: false },
      { mons: b.map((s) => newMon(pick(s))), active: 0, stealthRock: false, megaUsed: false },
    ],
    turn: 1,
  };
}

describe('ナッシュ均衡', () => {
  it('じゃんけんは 1/3 ずつ', () => {
    const r = solveNash([[0, -1, 1], [1, 0, -1], [-1, 1, 0]], 5000);
    for (const p of r.row) expect(p).toBeCloseTo(1 / 3, 1);
    expect(r.value).toBeCloseTo(0, 2);
  });
  it('支配される手は選ばない', () => {
    const r = solveNash([[1, 1], [0, 0]]);
    expect(r.row[0]).toBeGreaterThan(0.99);
  });
});

describe('1ターンの進行', () => {
  it('ばけのかわは最初の攻撃を 1/8 に変える', () => {
    const s = duel(['Mimikyu'], ['Basculegion']);
    const next = resolveTurn(s, [mv('Swords Dance'), mv('Wave Crash')], evaluate);
    expect(activeMon(next.sides[0]).hp).toBeCloseTo(7 / 8, 2);
    expect(activeMon(next.sides[0]).disguise).toBe(false);
  });
  it('きあいのタスキは満タンから1発では倒れない', () => {
    const s = duel(['Basculegion'], ['Aegislash-Shield']);
    // スカーフイダイトウのウェーブタックルはブレードのギルガルドに効果抜群級。ギルガルドは剣の舞（シールドのまま）
    const next = resolveTurn(s, [mv('Last Respects'), mv('Shadow Sneak')], evaluate);
    const g = activeMon(next.sides[1]);
    expect(g.hp).toBeGreaterThan(0);
    expect(g.itemLost).toBe(true);
  });
  it('あくびは次のターンの終わりに眠らせる', () => {
    let s = duel(['Hippowdon'], ['Lucario']);
    s = resolveTurn(s, [mv('Yawn'), mv('Nasty Plot')], evaluate);
    expect(activeMon(s.sides[1]).status).toBe('');
    s = resolveTurn(s, [mv('Stealth Rock'), mv('Nasty Plot')], evaluate);
    expect(activeMon(s.sides[1]).status).toBe('slp');
  });
  it('先制技は素早さより先', () => {
    const s = duel(['Hippowdon'], ['Mimikyu']);
    expect(moveOrder(s, [mv('Earthquake'), mv('Shadow Sneak')])).toEqual([1, 0]);
  });
  it('スカーフイダイトウ（S214）はメガルカリオZ（S201）より先', () => {
    const s = duel(['Lucario'], ['Basculegion']);
    expect(moveOrder(s, [mv('Flash Cannon', true), mv('Wave Crash')])).toEqual([1, 0]);
  });
  it('砂はカバルドンの特性で始まり、鋼・地面以外を削る', () => {
    const s = duel(['Mimikyu', 'Hippowdon'], ['Basculegion']);
    const next = resolveTurn(s, [{ kind: 'switch', to: 1 }, mv('Aqua Jet')], evaluate);
    expect(next.weather?.kind).toBe('Sand');
    expect(activeMon(next.sides[1]).hp).toBeCloseTo(1 - 1 / 16, 3);
  });
});
