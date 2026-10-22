// 助言の本体（DESIGN.md §2・§8）。手で起動する版。
//   npm run advise              ミラーリングの窓を見張り、助言の窓（http://127.0.0.1:8765）に出す
//   npm run advise -- --replay <dir>   撮りためたスクショ（png）を順に流す（読み取りの精度を見る用。--record で記録も残す）
//   npm run advise -- --keep           変化した画面を captures/ に残す（読み取りの調整用）
//   npm run advise -- --claude         Claude（Haiku）を読み合いの局面と選出で呼ぶ
//
// 普段は窓があるかを見るだけ。画面が変わった時だけ文字認識をし、技選択の画面で探索を回す。
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { loadTeam, toCalcPokemon } from '../dex/sets.js';
import { loadLatestUsage } from '../usage/usage.js';
import { screen, hashDistance } from '../reader/screen.js';
import { loadLayout, readBoxes } from '../reader/parse.js';
import { search } from '../engine/search.js';
import { explain, predictOpponent, type Advice } from '../engine/explain.js';
import { adviseSelection } from '../engine/selection.js';
import { enToJa, jaToEn } from '../dex/names.js';
import { identify, learn, saveSlotImages, slotSignatures } from '../reader/icons.js';
import { saveMatch } from '../match/log.js';
import { ClaudeSession } from '../claude/session.js';
import { Tracker } from './tracker.js';
import { startServer, type View } from './server.js';

const TEAM_PATH = process.env.PA_TEAM ?? 'data/team/s6_umeda.json';
const CAPTURE_DIR = 'captures';
const POLL_MS = 1500;
const IDLE_MS = 5000;
const REPLAY = process.argv.includes('--replay');

const team = loadTeam(TEAM_PATH);
const usage = loadLatestUsage();
const layout = loadLayout();
const tracker = new Tracker(team, usage);
const myMoves = [...new Set(team.members.flatMap((m) => m.moves))];

const view: View = {
  status: '起動',
  paused: false,
  light: false,
  useClaude: process.argv.includes('--claude'),
  team: team.members.map((m) => ({ species: m.species, ja: enToJa('species', m.species) })),
  log: [],
};
const server = startServer(view, {
  onPick: (species) => tracker.setMyPick(species),
  onNewMatch: () => finishMatch('unknown'),
  onOppNames: (names) => onOppNames(names),
  slotDir: `${CAPTURE_DIR}/slots`,
  speciesNames: Object.keys(JSON.parse(readFileSync('data/dex/ja.json', 'utf8')).species as Record<string, string>),
});

let claude: ClaudeSession | undefined;
function note(msg: string) {
  view.log = [`${new Date().toLocaleTimeString()} ${msg}`, ...view.log].slice(0, 30);
  server.push();
}

function finishMatch(result: 'win' | 'lose' | 'draw' | 'unknown') {
  if (tracker.phase === 'idle') return;
  tracker.match.result = result;
  tracker.match.ended_at = new Date().toISOString();
  if (claude) tracker.match.tokens[claude.model] = { ...claude.usage };
  // 再生（--replay）は読み取りの確認用なので、--record が無ければ記録を残さない
  if (!REPLAY || process.argv.includes('--record')) note(`記録しました: ${saveMatch(tracker.match)}`);
  claude?.close();
  claude = undefined;
  tracker.reset();
  view.selection = view.advice = view.oppPrediction = view.board = undefined;
  view.claudeNote = undefined;
}

// ---- 画面1枚の処理 ----

/** 自分のポケモンの最大 HP（HP の数字の読み間違いを直すのに使う） */
function maxHpOf(species: string): number | undefined {
  const m = team.members.find((x) => x.species === species || x.megaSpecies === species);
  return m ? toCalcPokemon(m).maxHP() : undefined;
}

/** 行動の文を見たら true。次に「たたかう」の画面が出た時に、新しいターンとして助言する */
let awaitingCommand = true;

async function handleFrame(png: string) {
  const boxes = screen.ocr(png);
  const r = readBoxes(boxes, layout, myMoves, maxHpOf);
  view.screenKind = r.kind;

  if (r.kind === 'result') {
    const t = r.resultText ?? '';
    finishMatch(/勝った/.test(t) ? 'win' : /負けた/.test(t) ? 'lose' : /引き分け/.test(t) ? 'draw' : 'unknown');
    return;
  }
  if (r.kind === 'preview') {
    // 前の試合の結果の画面を見逃しても、次の選出画面で区切る
    if (tracker.phase === 'battle') finishMatch('unknown');
    // 選出画面の間は1回だけ処理する（毎回やると、入力中の名前の欄が作り直されて消える）
    if (tracker.phase === 'preview' && view.oppSlots) return;
    // 相手の6匹はアイコンだけなので、見た目で見分ける。知らないアイコンは助言の窓で本人が名前を入れる
    const sigs = slotSignatures(png, layout);
    pendingSigs = sigs;
    const guesses = identify(sigs);
    saveSlotImages(png, layout, `${CAPTURE_DIR}/slots`);
    view.oppSlots = guesses.map((g) => ({ ja: g.species ? enToJa('species', g.species) : '', known: !!g.species }));
    view.slotVersion = Date.now();
    tracker.onPreview([]);
    awaitingCommand = true;
    if (guesses.every((g) => g.species)) runSelection(guesses.map((g) => g.species!));
    else {
      note('相手の6匹のうち知らないアイコンがある。助言の窓で名前を入れてください');
      server.push();
    }
    return;
  }
  if (r.kind === 'other') return;
  if (tracker.phase !== 'battle') view.oppSlots = undefined; // 選出が終わったら入力欄を閉じる
  tracker.onBattleFrame(r.myName, r.oppName, r.myHp, r.oppPct !== undefined ? r.oppPct / 100 : undefined);
  for (const e of r.events) {
    tracker.onMoveSeen(e.side, e.move);
    note(`${e.side === 'opp' ? '相手の' : ''}${e.species ? enToJa('species', e.species) : '?'}の${enToJa('moves', e.move)}`);
    awaitingCommand = true;
  }
  if ((r.kind === 'command' || r.kind === 'move_select') && awaitingCommand) {
    awaitingCommand = false;
    await adviseTurn();
  }
}

let pendingSigs: number[][] = [];

/** 相手の6匹が分かったら選出の助言を出す */
function runSelection(names: string[]) {
  tracker.onPreview(names);
  note(`相手の6匹: ${names.map((n) => enToJa('species', n)).join('・')}`);
  const sel = adviseSelection(team, names.map((n) => tracker.oppSets(n)));
  view.selection = {
    picks: sel.picks.map((p) => ({ mons: p.mons.map((m) => enToJa('species', m)), lead: enToJa('species', p.lead), score: p.score })),
    dangers: sel.dangers.map((d) => enToJa('species', d)),
    notes: sel.articleNotes,
  };
  tracker.match.selectionAdvice = sel.picks.map((p) => `${p.mons.join('/')} 先発${p.lead}`);
  server.push();
  if (view.useClaude && !view.light) void askSelection(names, sel.articleNotes);
}

/** 助言の窓で本人が入れた相手の6匹の名前。覚えて次から自動で見分ける */
function onOppNames(jaNames: string[]): string | undefined {
  const en = jaNames.map((n) => (n.trim() ? jaToEn('species', n) : undefined));
  const bad = jaNames.filter((n, i) => n.trim() && !en[i]);
  if (bad.length) return `名前が分からない: ${bad.join('・')}`;
  if (en.some((x) => !x)) return '6匹すべて入れてください';
  learn(en.map((species, i) => ({ species: species!, sig: pendingSigs[i] ?? [] })).filter((p) => p.sig.length));
  view.oppSlots = en.map((s) => ({ ja: enToJa('species', s!), known: true }));
  runSelection(en as string[]);
  return undefined;
}

async function adviseTurn() {
  const state = tracker.battleState();
  if (!state) {
    view.status = '場のポケモンが読めない（両方の名前が必要）';
    server.push();
    return;
  }
  tracker.onTurnStart();
  const t = Date.now();
  const r = search(state, { depth: view.light ? 1 : 2, oppActiveSets: tracker.oppActiveSets(), timeLimitMs: 6000 });
  // 上位3つだけでなく全部の手を出す（確率 0% の手も、理由を見て本人が選べるように）
  const advice: Advice[] = explain(state, r, r.candidates.length);
  const pred = predictOpponent(state, r);
  view.advice = advice;
  note(`T${tracker.turn} 候補: ${advice.slice(0, 3).map((a) => `${a.label} ${Math.round(a.prob * 100)}%`).join(' / ')}`);
  view.oppPrediction = pred;
  view.board = {
    mine: `${enToJa('species', tracker.myActive!.species)} ${Math.round(tracker.myActive!.hpFrac * 100)}%`,
    opp: `${enToJa('species', tracker.oppActive!.species)} ${Math.round(tracker.oppActive!.hpFrac * 100)}%`,
    turn: tracker.turn,
    ms: Date.now() - t,
    depth: r.depthReached,
  };
  view.claudeNote = undefined;
  tracker.match.turns.push({
    turn: tracker.turn,
    at: new Date().toISOString(),
    myActive: tracker.myActive?.species,
    myHp: tracker.myActive?.hpRaw,
    oppActive: tracker.oppActive?.species,
    oppHpPct: tracker.oppActive ? Math.round(tracker.oppActive.hpFrac * 100) : undefined,
    advice,
    oppPrediction: pred,
    events: [],
  });
  server.push();
  // 読み合いの局面（上位2つの確率が近い、または均衡が混合）だけ Claude を呼ぶ（DESIGN.md §6）
  const top = r.candidates;
  const contested = top.length >= 2 && top[1]!.prob > 0.25;
  if (view.useClaude && contested) void askTurn(advice, pred);
}

// ---- Claude ----

async function askSelection(names: string[], notes: string[]) {
  claude ??= new ClaudeSession('haiku');
  try {
    const sel = view.selection!;
    const reply = await claude.ask(
      [
        `選出画面。相手の6匹: ${names.map((n) => enToJa('species', n)).join('・')}`,
        `自分の6匹: ${team.members.map((m) => `${enToJa('species', m.species)}（${m.role ?? ''}）`).join(' / ')}`,
        `計算での選出候補: ${sel.picks.map((p) => `${p.mons.join('・')}（先発${p.lead}）`).join(' / ')}`,
        notes.length ? `構築記事のメモ: ${notes.join(' / ')}` : '',
        '相手の先発の予想と、選出の注意点を3行以内で。',
      ].join('\n'),
    );
    view.claudeNote = reply.text;
    server.push();
  } catch (e) {
    note(`Claude の呼び出しに失敗: ${(e as Error).message}`);
  }
}

async function askTurn(advice: Advice[], pred: { label: string; prob: number }[]) {
  claude ??= new ClaudeSession('haiku');
  try {
    const reply = await claude.ask(
      [
        `ターン${tracker.turn}。自分: ${view.board?.mine} / 相手: ${view.board?.opp}`,
        `計算の候補: ${advice.map((a) => `${a.label}(${Math.round(a.prob * 100)}%): ${a.reason}`).join(' | ')}`,
        `相手の手の予想: ${pred.map((p) => `${p.label}(${Math.round(p.prob * 100)}%)`).join(' / ')}`,
        '読み合いの観点で一言（2行以内）。',
      ].join('\n'),
    );
    view.claudeNote = reply.text;
    const last = tracker.match.turns.at(-1);
    if (last) last.claude = reply.text;
    server.push();
  } catch (e) {
    note(`Claude の呼び出しに失敗: ${(e as Error).message}`);
  }
}

// ---- ループ ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function liveLoop() {
  if (!existsSync(CAPTURE_DIR)) mkdirSync(CAPTURE_DIR);
  const png = `${CAPTURE_DIR}/latest.png`;
  let lastHash = '';
  let saved = 0;
  for (;;) {
    if (view.paused) {
      view.status = '一時停止中';
      await sleep(IDLE_MS);
      continue;
    }
    // 別のデスクトップにある（画面に出ていない）窓も撮れることを確かめた（2026-10-22）ので、見えているかは問わない
    const win = screen.findWindow();
    if (!win) {
      view.status = 'iPhone ミラーリングの窓を待っています（アプリを開き、iPhone をロックして接続）';
      server.push();
      await sleep(IDLE_MS);
      continue;
    }
    try {
      screen.capture(png);
      const h = screen.hash(png);
      if (lastHash && hashDistance(h, lastHash) <= 3) {
        await sleep(POLL_MS);
        continue;
      }
      lastHash = h;
      // 読み取りの調整用に、変化した画面を残す（captures/ は git に入れない）
      if (process.argv.includes('--keep')) copyFileSync(png, `${CAPTURE_DIR}/${Date.now()}_${saved++}.png`);
      view.status = '対戦を見ています';
      await handleFrame(png);
    } catch (e) {
      view.status = `エラー: ${(e as Error).message.split('\n')[0]}`;
      server.push();
      await sleep(IDLE_MS);
    }
    await sleep(POLL_MS);
  }
}

async function replay(dir: string) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  for (const f of files) {
    view.status = `再生: ${f}`;
    await handleFrame(`${dir}/${f}`);
    if (process.env.PA_REPLAY_VERBOSE) note(`${f}: ${view.screenKind}`);
    await sleep(Number(process.env.PA_REPLAY_MS ?? 800));
  }
  finishMatch('unknown');
  view.status = '再生終了';
  server.push();
}

const ri = process.argv.indexOf('--replay');
if (ri >= 0) await replay(process.argv[ri + 1] ?? CAPTURE_DIR);
else await liveLoop();
