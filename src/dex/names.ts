// 文字認識の結果（日本語）を Showdown の英名に直す。
// 認識は1〜2文字誤ることがあるので、完全一致がなければ編集距離が近いものを採る。
import { readFileSync } from 'node:fs';

type Kind = 'species' | 'moves' | 'items' | 'abilities' | 'natures';
type Table = Record<Kind, Record<string, string>>;

let table: Table | undefined;
function load(): Table {
  table ??= JSON.parse(readFileSync(new URL('../../data/dex/ja.json', import.meta.url), 'utf8')) as Table;
  return table;
}

/** カタカナ・ひらがなの揺れと空白を吸収する */
export function normalizeJa(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

const normalized = new Map<Kind, Map<string, string>>();
function index(kind: Kind): Map<string, string> {
  let m = normalized.get(kind);
  if (!m) {
    m = new Map(Object.entries(load()[kind]).map(([ja, en]) => [normalizeJa(ja), en]));
    normalized.set(kind, m);
  }
  return m;
}

/**
 * 日本語名を英名に直す。見つからなければ undefined。
 * maxDistance は許す誤字の数。短い名前ほど取り違えやすいので、長さの 1/4 を上限にする。
 */
export function jaToEn(kind: Kind, ja: string, maxDistance = 2): string | undefined {
  const key = normalizeJa(ja);
  if (!key) return undefined;
  const m = index(kind);
  const exact = m.get(key);
  if (exact) return exact;
  const limit = Math.min(maxDistance, Math.floor(key.length / 4));
  let best: { en: string; d: number } | undefined;
  for (const [k, en] of m) {
    if (Math.abs(k.length - key.length) > limit) continue;
    const d = editDistance(key, k);
    if (d <= limit && (!best || d < best.d)) best = { en, d };
  }
  return best?.en;
}
