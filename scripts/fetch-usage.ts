// Smogon の使用率（chaos 形式）を取得して data/usage/ に日付付きで置く。週1〜月1回、手で実行する。
// 使い方: npm run fetch:usage -- [YYYY-MM] [形式] [レート下限]
//   既定: 先月・gen9championsbssregmc（シングル3vs3）・1500
// 取得に失敗した場合（サイトのメンテ等）は docs/PENDING_FETCH.md に書く。
import { writeFileSync } from 'node:fs';

const now = new Date();
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const month = process.argv[2] ?? `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
const format = process.argv[3] ?? 'gen9championsbssregmc';
const cutoff = process.argv[4] ?? '1500'; // Smogon の区切りは 0/1500/1630/1760。本人の目安（ゲーム内マスター 1600 前後から）に近い低い方
const url = `https://www.smogon.com/stats/${month}/chaos/${format}-${cutoff}.json`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`取得失敗 ${res.status}: ${url}\n→ docs/PENDING_FETCH.md に追記してください`);
  process.exit(1);
}
const body = await res.text();
const out = `data/usage/${month}_${format}-${cutoff}.json`;
writeFileSync(out, body);
console.log(`保存: ${out}（${(body.length / 1e6).toFixed(1)} MB）`);
