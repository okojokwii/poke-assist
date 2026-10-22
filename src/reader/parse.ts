// 文字認識の結果から、画面の種類と盤面を読み取る（DESIGN.md §3）。
// 実機の画面の位置がまだ分からないので、決まった位置に頼らず「何の名前が読めたか」で判断する。
// 位置の目安は config/layout.json（実機で調整する）。
import { readFileSync } from 'node:fs';
import { jaToEn } from '../dex/names.js';
import type { OcrBox, Rect } from './screen.js';

export interface Layout {
  verified: boolean;
  oppSideMaxY: number;
  hpBarFromName: { dx: number; dy: number; w: number; h: number };
  resultKeywords: string[];
  previewMinSpecies: number;
  moveSelectMinMoves: number;
}

export function loadLayout(path = 'config/layout.json'): Layout {
  return JSON.parse(readFileSync(path, 'utf8')) as Layout;
}

export type ScreenKind = 'preview' | 'move_select' | 'result' | 'battle' | 'other';

export interface NamedBox {
  en: string;
  box: OcrBox;
}

export interface ReadResult {
  kind: ScreenKind;
  species: NamedBox[];
  moves: NamedBox[];
  /** 「123/215」の形の HP 表示（自分の側に出る） */
  hpNumbers: { cur: number; max: number; box: OcrBox }[];
  resultText?: string;
}

const HP_RE = /(\d{1,3})\s*[/／]\s*(\d{2,3})/;

export function readBoxes(boxes: OcrBox[], layout: Layout, myMoves: string[]): ReadResult {
  const species: NamedBox[] = [];
  const moves: NamedBox[] = [];
  const hpNumbers: ReadResult['hpNumbers'] = [];
  let resultText: string | undefined;
  for (const box of boxes) {
    const t = box.text.trim();
    const hp = HP_RE.exec(t);
    if (hp) hpNumbers.push({ cur: Number(hp[1]), max: Number(hp[2]), box });
    if (layout.resultKeywords.some((k) => t.includes(k))) resultText = t;
    // 「メガルカリオ Lv.50」のような付き物を落としてから引く
    const name = t.replace(/Lv\.?\s*\d+/i, '').replace(/[♂♀]/g, '').trim();
    const sp = jaToEn('species', name);
    if (sp) {
      species.push({ en: sp, box });
      continue;
    }
    const mv = jaToEn('moves', name);
    if (mv) moves.push({ en: mv, box });
  }
  const myMoveHits = moves.filter((m) => myMoves.includes(m.en)).length;
  let kind: ScreenKind = 'other';
  if (resultText) kind = 'result';
  else if (myMoveHits >= layout.moveSelectMinMoves) kind = 'move_select';
  else if (species.length >= layout.previewMinSpecies) kind = 'preview';
  else if (species.length >= 1 || hpNumbers.length) kind = 'battle';
  return { kind, species, moves, hpNumbers, resultText };
}

/** 相手側（画面の上）と自分側に名前を分ける */
export function splitSides(r: ReadResult, layout: Layout): { mine: NamedBox[]; opp: NamedBox[] } {
  const opp = r.species.filter((s) => s.box.y < layout.oppSideMaxY);
  const mine = r.species.filter((s) => s.box.y >= layout.oppSideMaxY);
  return { mine, opp };
}

/** 名前の位置から HP バーの位置を推定する */
export function hpBarRegion(name: OcrBox, layout: Layout): Rect {
  const o = layout.hpBarFromName;
  return { x: name.x + o.dx, y: name.y + name.h + o.dy, w: o.w, h: o.h };
}
