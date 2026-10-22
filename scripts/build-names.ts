// PokeAPI の CSV（data/raw/）から、日本語名 → Showdown の名前 の対応表を作る。
// 出力: data/dex/ja.json。画面の文字認識の結果をこの表で英名に直してから計算に渡す。
// 使い方: 先に data/raw/ へ CSV を置く（README の「データの更新」参照）→ npm run build:names
import { readFileSync, writeFileSync } from 'node:fs';
import { Generations } from '@smogon/calc';

const gen = Generations.get(0);
const RAW = 'data/raw';
// PokeAPI の言語 ID。1 = ja-Hrkt（かな）、11 = ja（漢字まじり）。ゲームの表示設定でどちらも出うる
const JA_LANGS = new Set(['1', '11']);

function parseCsv(path: string): string[][] {
  // PokeAPI の CSV は名前にカンマを含まない列だけを使うので、単純な分割で足りる
  return readFileSync(path, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
}

const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function buildTable(
  idCsv: string,
  namesCsv: string,
  lookup: (id: string) => string | undefined,
): Record<string, string> {
  const identifiers = new Map(parseCsv(`${RAW}/${idCsv}`).map((r) => [r[0]!, r[1]!]));
  const out: Record<string, string> = {};
  for (const r of parseCsv(`${RAW}/${namesCsv}`)) {
    const [id, lang, name] = r;
    if (!id || !lang || !name || !JA_LANGS.has(lang)) continue;
    const ident = identifiers.get(id);
    if (!ident) continue;
    const en = lookup(toID(ident));
    if (en) out[name] = en;
  }
  return out;
}

// 形態違いしか登録がない種（ギルガルド → Aegislash-Shield など）は、最初の形態に寄せる
const allSpecies = [...gen.species];
const FORM_OVERRIDES: Record<string, string> = { aegislash: 'Aegislash-Shield' }; // 場に出る時の形態
const species = buildTable(
  'pokemon_species.csv',
  'pokemon_species_names.csv',
  (id) =>
    FORM_OVERRIDES[id] ?? gen.species.get(id as never)?.name ?? allSpecies.find((s) => toID(s.name).startsWith(id))?.name,
);
// メガシンカ後の名前は「メガ○○」。チャンピオンズにあるメガだけ足す
// X/Y/Z があるものは「メガリザードンY」の形（ゲームの表示で確認: 2026-10-22 時点では未確認）
for (const [ja, en] of Object.entries({ ...species })) {
  for (const suffix of ['', 'X', 'Y', 'Z']) {
    const mega = gen.species.get(toID(`${en}-Mega${suffix ? `-${suffix}` : ''}`) as never);
    if (mega) species[`メガ${ja}${suffix}`] = mega.name;
  }
}

const table = {
  source: 'https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv',
  fetched_at: new Date().toISOString().slice(0, 10),
  species,
  moves: buildTable('moves.csv', 'move_names.csv', (id) => gen.moves.get(id as never)?.name),
  items: buildTable('items.csv', 'item_names.csv', (id) => gen.items.get(id as never)?.name),
  abilities: buildTable('abilities.csv', 'ability_names.csv', (id) => gen.abilities.get(id as never)?.name),
  natures: buildTable('natures.csv', 'nature_names.csv', (id) => gen.natures.get(id as never)?.name),
};
writeFileSync('data/dex/ja.json', JSON.stringify(table, null, 1) + '\n');
for (const k of ['species', 'moves', 'items', 'abilities', 'natures'] as const) {
  console.log(k, Object.keys(table[k]).length);
}
