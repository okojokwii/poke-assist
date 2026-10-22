// tools/screen/pa-screen（Swift）を呼ぶ薄い層
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../tools/screen/pa-screen', import.meta.url));

function run<T>(...args: string[]): T {
  return JSON.parse(execFileSync(BIN, args, { encoding: 'utf8', timeout: 15_000 })) as T;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrBox extends Rect {
  text: string;
  conf: number;
}

const rectArg = (r: Rect) => [r.x, r.y, r.w, r.h].map((v) => Math.max(0, Math.min(1, v)).toFixed(4)).join(',');

export const screen = {
  /** ミラーリングの窓があるか */
  findWindow(): Rect | undefined {
    try {
      return run<Rect>('find');
    } catch {
      return undefined;
    }
  },
  capture(out: string): void {
    run('capture', out);
  },
  ocr(png: string, region?: Rect): OcrBox[] {
    return region ? run<OcrBox[]>('ocr', png, rectArg(region)) : run<OcrBox[]>('ocr', png);
  },
  bar(png: string, region: Rect): { fraction: number; color: string } {
    return run('bar', png, rectArg(region));
  },
  hash(png: string): string {
    return run<{ hash: string }>('hash', png).hash;
  },
};

/** 2つの指紋の違うビット数。小さいほど似た画面 */
export function hashDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
