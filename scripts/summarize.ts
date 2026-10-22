// 試合の記録を集計し、環境メモ（data/meta_summary.md）を作る（DESIGN.md §6・§7）。その日の終わりに1回。
//   npm run summarize            集計だけ（Claude を呼ばない）
//   npm run summarize -- --claude   集計を Sonnet に渡して「環境メモ」の文章を書き直してもらう
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadMatches } from '../src/match/log.js';
import { enToJa } from '../src/dex/names.js';
import { askOnce } from '../src/claude/session.js';

const matches = loadMatches();
const ja = (s: string) => enToJa('species', s);
const count = <T extends string>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const results = count(matches.map((m) => m.result ?? 'unknown'));
const oppTeams = count(matches.flatMap((m) => m.oppTeam));
const oppLeads = count(matches.map((m) => m.oppSeen[0]).filter((x): x is string => !!x));
const myPicks = count(matches.map((m) => [...m.myPick].sort().map(ja).join('・')).filter(Boolean));
const tokens = matches.reduce(
  (acc, m) => {
    for (const [model, u] of Object.entries(m.tokens)) {
      acc[model] ??= 0;
      acc[model] += u.input + u.output + u.cacheCreate;
    }
    return acc;
  },
  {} as Record<string, number>,
);
const winRateBy = (pred: (m: (typeof matches)[number]) => boolean) => {
  const xs = matches.filter(pred).filter((m) => m.result === 'win' || m.result === 'lose');
  return xs.length ? `${xs.filter((m) => m.result === 'win').length}/${xs.length}` : '-';
};

const table = (rows: [string, number][], n = 15) => rows.slice(0, n).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
const stats = [
  `## 集計（${new Date().toLocaleDateString('sv-SE')}・${matches.length}試合）`,
  '',
  `結果: ${results.map(([k, v]) => `${k} ${v}`).join(' / ')}`,
  '',
  '### 相手の6匹によく入るポケモン（見せ合い）',
  '| ポケモン | 回数 |',
  '|---|---|',
  table(oppTeams.map(([k, v]) => [`${ja(k)}（勝率 ${winRateBy((m) => m.oppTeam.includes(k))}）`, v])),
  '',
  '### 相手の先発',
  '| ポケモン | 回数 |',
  '|---|---|',
  table(oppLeads.map(([k, v]) => [ja(k), v])),
  '',
  '### 自分の選出',
  '| 選出 | 回数 |',
  '|---|---|',
  table(myPicks),
  '',
  `使ったトークン: ${Object.entries(tokens).map(([k, v]) => `${k} ${v}`).join(' / ') || 'なし'}`,
  '',
  '※ 自分の記録は数が少なく、自分のレート帯に偏る。50試合ほどまでは使用率（data/usage/）を主にする。',
].join('\n');

const path = 'data/meta_summary.md';
let memo = '';
if (process.argv.includes('--claude') && matches.length > 0) {
  const prev = existsSync(path) ? readFileSync(path, 'utf8').split('## 集計')[0] : '';
  const reply = await askOnce(
    'sonnet',
    'ポケモンチャンピオンズ（シングル 3vs3）の環境メモを書く。数の少ない記録から言い過ぎない。日本語で、見出し「## 環境メモ」の下に箇条書き10行以内。',
    `前回の環境メモ:\n${prev || '（なし）'}\n\n今回の集計:\n${stats}`,
  );
  memo = reply.text.trim() + '\n\n';
  console.log(`Sonnet: ${reply.usage.input + reply.usage.output} トークン`);
} else if (existsSync(path)) {
  memo = readFileSync(path, 'utf8').split('## 集計')[0] ?? '';
}
writeFileSync(path, `# 環境メモ\n\nClaude が読むのはこのファイルだけ（DESIGN.md §7）。\n\n${memo.replace(/^# 環境メモ\n\nClaude が読むのはこのファイルだけ（DESIGN.md §7）。\n\n/, '')}${stats}\n`);
console.log(`書きました: ${path}`);
