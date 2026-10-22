// 試合の記録（DESIGN.md §7）。1試合1ファイル: data/matches/YYYY-MM-DD_NNN.json
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Usage } from '../claude/session.js';

export interface DamageObservation {
  turn: number;
  /** 'dealt' = 自分が与えた, 'taken' = 自分が受けた */
  dir: 'dealt' | 'taken';
  attacker: string;
  defender: string;
  move?: string;
  /** 自分が受けた側は実数（HP の数字が見える）、与えた側は HP バーの割合（%） */
  before: number;
  after: number;
  unit: 'hp' | 'pct';
}

export interface TurnLog {
  turn: number;
  at: string;
  myActive?: string;
  myHp?: { cur: number; max: number };
  oppActive?: string;
  oppHpPct?: number;
  advice?: { label: string; prob: number; reason: string }[];
  oppPrediction?: { label: string; prob: number }[];
  claude?: string;
  /** 画面の文で読めた行動（「○○の ××！」） */
  events: { side: 'mine' | 'opp' | 'unknown'; species?: string; move: string }[];
}

export interface MatchLog {
  id: string;
  started_at: string;
  ended_at?: string;
  format: 'singles';
  team: string;
  oppTeam: string[];
  myPick: string[];
  oppSeen: string[];
  selectionAdvice?: string[];
  turns: TurnLog[];
  damage: DamageObservation[];
  result?: 'win' | 'lose' | 'draw' | 'unknown';
  tokens: Record<string, Usage>;
}

const DIR = 'data/matches';

export function newMatchId(date = new Date()): string {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const day = date.toLocaleDateString('sv-SE'); // YYYY-MM-DD（ローカル時刻）
  const n = readdirSync(DIR).filter((f) => f.startsWith(day)).length + 1;
  return `${day}_${String(n).padStart(3, '0')}`;
}

export function newMatch(team: string): MatchLog {
  return {
    id: newMatchId(),
    started_at: new Date().toISOString(),
    format: 'singles',
    team,
    oppTeam: [],
    myPick: [],
    oppSeen: [],
    turns: [],
    damage: [],
    tokens: {},
  };
}

export function saveMatch(m: MatchLog): string {
  const path = `${DIR}/${m.id}.json`;
  writeFileSync(path, JSON.stringify(m, null, 1) + '\n');
  return path;
}

export function loadMatches(): MatchLog[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as MatchLog);
}
