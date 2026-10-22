// 選出画面の相手の6匹は、名前の文字が無くアイコンだけで出る。アイコンの見た目で種を見分ける。
// 見分け方: 前に本人が名前を付けたアイコンの特徴（data/icons/library.json）と比べ、一番近いものを採る。
// 最初は空なので、助言の窓で本人が名前を入れる → 次からは自動で分かる、という形で育てる。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Layout } from './parse.js';
import type { Rect } from './screen.js';

const BIN = fileURLToPath(new URL('../../tools/screen/pa-screen', import.meta.url));
const LIB = 'data/icons/library.json';
/** これより遠ければ「知らないアイコン」とする（1画素・1色あたりの平均の差。実機で調整する） */
const MATCH_THRESHOLD = 18;

interface Entry {
  species: string;
  sig: number[];
  added_at: string;
}

export interface SlotGuess {
  slot: number;
  species?: string;
  distance?: number;
  sig: number[];
}

export function slotRects(layout: Layout): { sprite: Rect; types: Rect }[] {
  const s = layout.oppIconSlots;
  return Array.from({ length: 6 }, (_, i) => {
    const y = s.top + s.step * i;
    return {
      sprite: { x: s.spriteX, y, w: s.spriteW, h: s.h },
      types: { x: s.typesX, y, w: s.typesW, h: s.typesH },
    };
  });
}

const arg = (r: Rect) => [r.x, r.y, r.w, r.h].map((v) => v.toFixed(4)).join(',');

/** 6枠の特徴（絵＋タイプのアイコン。性別の印は個体で変わるので入れない） */
export function slotSignatures(png: string, layout: Layout): number[][] {
  const rects = slotRects(layout).flatMap((r) => [arg(r.sprite), arg(r.types)]);
  const sigs = JSON.parse(execFileSync(BIN, ['sig', png, ...rects], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as number[][];
  return Array.from({ length: 6 }, (_, i) => [...sigs[i * 2]!, ...sigs[i * 2 + 1]!]);
}

/** 6枠を切り出して保存する（助言の窓で本人に見せる用） */
export function saveSlotImages(png: string, layout: Layout, dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  slotRects(layout).forEach((r, i) => {
    const whole = { x: r.sprite.x, y: r.sprite.y, w: r.types.x + r.types.w - r.sprite.x, h: r.sprite.h };
    execFileSync(BIN, ['crop', png, arg(whole), `${dir}/slot${i}.png`], { stdio: 'ignore' });
  });
}

function load(): Entry[] {
  return existsSync(LIB) ? (JSON.parse(readFileSync(LIB, 'utf8')) as Entry[]) : [];
}

function distance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - (b[i] ?? 0));
  return d / a.length;
}

export function identify(sigs: number[][]): SlotGuess[] {
  const lib = load();
  return sigs.map((sig, slot) => {
    let best: { species: string; d: number } | undefined;
    for (const e of lib) {
      const d = distance(sig, e.sig);
      if (!best || d < best.d) best = { species: e.species, d };
    }
    return best && best.d <= MATCH_THRESHOLD ? { slot, species: best.species, distance: best.d, sig } : { slot, distance: best?.d, sig };
  });
}

/** 本人が付けた名前を覚える。同じ種は5件まで（背景の違いを吸収するため数件持つ） */
export function learn(pairs: { species: string; sig: number[] }[]): void {
  const lib = load();
  for (const p of pairs) {
    const same = lib.filter((e) => e.species === p.species);
    if (same.some((e) => distance(e.sig, p.sig) < 3)) continue; // ほぼ同じものは足さない
    if (same.length >= 5) lib.splice(lib.indexOf(same[0]!), 1);
    lib.push({ species: p.species, sig: p.sig, added_at: new Date().toISOString().slice(0, 10) });
  }
  if (!existsSync('data/icons')) mkdirSync('data/icons', { recursive: true });
  writeFileSync(LIB, JSON.stringify(lib) + '\n');
}
