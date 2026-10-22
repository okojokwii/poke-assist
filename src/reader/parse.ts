// 文字認識の結果から、画面の種類と盤面を読み取る（DESIGN.md §3）。
// 画面の位置は config/layout.json。2026-10-22 に実機（iPhone 16e のミラーリング）の画面で合わせた:
//   相手: 右上に名前と HP の「%」/ 自分: 左下に名前と HP の「現在/最大」/
//   ターンの始め: 「たたかう」「ポケモン」のボタン / 行動の文: 「相手のリザードンの」「フレアドライブ！」が別の行で出る
import { readFileSync } from 'node:fs';
import { jaToEn } from '../dex/names.js';
import type { OcrBox } from './screen.js';

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Layout {
  verified: boolean;
  /** 結果の画面の言葉。行全体がこの言葉の時だけ結果とみなす（「なまける」の「まけ」等を拾わないため） */
  resultKeywords: string[];
  moveSelectMinMoves: number;
  /** 選出画面に出る言葉（相手の6匹は文字が無いので、この言葉で選出画面と判断する） */
  previewKeywords: string[];
  /** ターンの始めの画面（たたかう・ポケモン）に出る言葉 */
  commandKeywords: string[];
  /** 選出画面で自分の6匹が並ぶ列の右端 */
  mySideMaxX: number;
  oppIconSlots: { top: number; step: number; h: number; spriteX: number; spriteW: number; typesX: number; typesW: number; typesH: number };
  /** 戦闘中の相手・自分の名前と HP が出る範囲 */
  oppInfo: Region;
  myInfo: Region;
}

export function loadLayout(path = 'config/layout.json'): Layout {
  return JSON.parse(readFileSync(path, 'utf8')) as Layout;
}

export type ScreenKind = 'preview' | 'command' | 'move_select' | 'status' | 'result' | 'battle' | 'other';

export interface NamedBox {
  en: string;
  box: OcrBox;
}

export interface MoveEvent {
  side: 'mine' | 'opp';
  species?: string;
  move: string;
}

export interface ReadResult {
  kind: ScreenKind;
  /** 選出画面の自分の列で読めた名前（選出画面のみ） */
  myTeamNames: string[];
  myName?: string;
  /** 自分の HP（数字）。最大値は分かっていれば検証に使う */
  myHp?: { cur: number; max: number };
  oppName?: string;
  /** 相手の HP（%） */
  oppPct?: number;
  /** 技選択の画面に出ている技 */
  moves: NamedBox[];
  /** 「○○の ××！」の文から読めた行動 */
  events: MoveEvent[];
  resultText?: string;
  /** 「様子を見る」の画面: どちらの誰の、能力変化の段階 */
  status?: { side: 'mine' | 'opp'; species?: string; boosts: { atk: number; def: number; spa: number; spd: number; spe: number } };
}

const inside = (b: OcrBox, r: Region) => b.x >= r.x0 && b.x < r.x1 && b.y >= r.y0 && b.y < r.y1;

function cleanName(t: string): string {
  return t.replace(/Lv\.?\s*\d+/i, '').replace(/[♂♀]/g, '').trim();
}

/**
 * 「167/215」を読む。文字認識は「/」を「7」「-」と取り違えることがある（例: 1677215, 167-215）。
 * 最大 HP が分かっていれば、末尾がそれに一致する読み方を採る。
 */
export function parseHp(text: string, knownMax?: number): { cur: number; max: number } | undefined {
  const t = text.replace(/\s/g, '');
  const m = /^(\d{1,3})[/／\-7](\d{2,3})$/.exec(t);
  if (knownMax !== undefined) {
    const digits = t.replace(/[^\d]/g, '');
    const maxStr = String(knownMax);
    if (digits.endsWith(maxStr) && digits.length > maxStr.length + 1) {
      // 区切りの1文字（7 と読まれた / 等）を除いた残りが現在の HP
      const cur = Number(digits.slice(0, digits.length - maxStr.length - (/[/／\-]/.test(t) ? 0 : 1)));
      if (cur <= knownMax) return { cur, max: knownMax };
    }
    if (m && Number(m[2]) === knownMax && Number(m[1]) <= knownMax) return { cur: Number(m[1]), max: knownMax };
    return undefined;
  }
  if (m && Number(m[1]) <= Number(m[2])) return { cur: Number(m[1]), max: Number(m[2]) };
  return undefined;
}

export function readBoxes(
  boxes: OcrBox[],
  layout: Layout,
  myMoves: string[],
  maxHpOf: (species: string) => number | undefined = () => undefined,
): ReadResult {
  const has = (words: string[]) => boxes.some((b) => words.some((k) => b.text.includes(k)));
  const r: ReadResult = { kind: 'other', myTeamNames: [], moves: [], events: [] };

  const result = boxes.find((b) => layout.resultKeywords.includes(b.text.replace(/[\s!！。]/g, '')));
  if (result) {
    r.kind = 'result';
    r.resultText = result.text;
    return r;
  }
  if (has(['めいちゅう']) && has(['かいひ'])) {
    const st = readStatusScreen(boxes);
    if (st) {
      r.kind = 'status';
      r.status = st;
    }
    return r;
  }
  if (has(layout.previewKeywords)) {
    r.kind = 'preview';
    r.myTeamNames = boxes
      .filter((b) => b.x < layout.mySideMaxX)
      .map((b) => jaToEn('species', cleanName(b.text)))
      .filter((s): s is string => !!s);
    return r;
  }

  // 場の名前と HP
  for (const b of boxes) {
    if (inside(b, layout.oppInfo)) {
      const sp = jaToEn('species', cleanName(b.text));
      if (sp) r.oppName ??= sp;
      const pct = /^(\d{1,3})\s*%$/.exec(b.text.trim());
      if (pct && Number(pct[1]) <= 100) r.oppPct = Number(pct[1]);
    }
    if (inside(b, layout.myInfo)) {
      const sp = jaToEn('species', cleanName(b.text));
      if (sp) r.myName ??= sp;
    }
  }
  const myMax = r.myName ? maxHpOf(r.myName) : undefined;
  for (const b of boxes) {
    if (!inside(b, layout.myInfo)) continue;
    const hp = parseHp(b.text, myMax);
    if (hp) r.myHp = hp;
  }

  // 技選択の画面の技、行動の文
  for (let i = 0; i < boxes.length; i++) {
    const t = boxes[i]!.text.trim();
    const mv = jaToEn('moves', t.replace(/[!！]$/, ''));
    if (!mv) continue;
    if (/[!！]$/.test(t)) {
      // 直前の行が「相手の○○の」か「○○の」なら行動の文
      const prev = boxes[i - 1]?.text.trim() ?? '';
      const who = /^(相手の)?(.+)の$/.exec(prev);
      if (who) r.events.push({ side: who[1] ? 'opp' : 'mine', species: jaToEn('species', who[2]!), move: mv });
    } else if (myMoves.includes(mv)) {
      r.moves.push({ en: mv, box: boxes[i]! });
    }
  }

  if (has(layout.commandKeywords)) r.kind = 'command';
  else if (r.moves.length >= layout.moveSelectMinMoves) r.kind = 'move_select';
  else if (r.oppName || r.myName || r.events.length) r.kind = 'battle';
  return r;
}

/** 倍率（×1.5, ×0.67 など）から段階（+1, -1 など）へ */
export function multiplierToStage(m: number): number {
  if (m >= 1) return Math.max(0, Math.min(6, Math.round((m - 1) * 2)));
  return -Math.max(0, Math.min(6, Math.round((1 / m - 1) * 2)));
}

/**
 * 「様子を見る」の画面。左の列に こうげき〜すばやさ の倍率が「×2.0」の形で並び、その下に めいちゅう・かいひ。
 * HP が「1/149」の形なら自分、「%」なら相手（相手側の表示は 2026-10-22 時点で未確認）。
 * 倍率が5つ読めなければ使わない（読み違いで盤面を壊さないため）。
 */
function readStatusScreen(boxes: OcrBox[]): ReadResult['status'] {
  const accY = boxes.find((b) => b.text.includes('めいちゅう'))?.y ?? 1;
  const mults = boxes
    .filter((b) => b.x < 0.5 && b.y < accY - 0.01 && !b.text.includes('倍'))
    .map((b) => ({ b, m: /(\d)\s*[.．]\s*(\d{1,2})\s*$/.exec(b.text) }))
    .filter((x): x is { b: OcrBox; m: RegExpExecArray } => !!x.m && /[xX✕×]/.test(x.b.text))
    .sort((a, c) => a.b.y - c.b.y)
    .map((x) => Number(`${x.m[1]}.${x.m[2]}`));
  if (mults.length < 5) return undefined;
  const [atk, def, spa, spd, spe] = mults.slice(-5).map(multiplierToStage) as [number, number, number, number, number];
  const hpBox = boxes.find((b) => /^\d{1,3}\s*[/／]\s*\d{2,3}$/.test(b.text.trim()) || /^\d{1,3}\s*%$/.test(b.text.trim()));
  const side = hpBox && /%/.test(hpBox.text) ? 'opp' : 'mine';
  // 名前は左上の枠（他の場所の文字を名前と取り違えないよう、位置で絞る）
  const species = boxes.filter((b) => b.y < 0.33 && b.x < 0.5).map((b) => jaToEn('species', cleanName(b.text))).find((x): x is string => !!x);
  return { side, species, boosts: { atk, def, spa, spd, spe } };
}
