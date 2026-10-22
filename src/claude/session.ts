// Claude の呼び出し（DESIGN.md §6）。`claude -p` を Pro プランの枠で使う（API キーは使わない）。
// 試合中は stream-json で会話を開いたままにし、差分だけ送る。会話は試合ごとに作り直す。
//
// 余計な文脈を載せないための指定（2026-10-22 に確かめた。既定のままだと1回あたり約2万1千トークン、
// 下の指定で約170トークン）:
//   --system-prompt で既定のシステムプロンプトを置き換える / --tools "" で道具を渡さない /
//   --strict-mcp-config で MCP を読まない / --setting-sources "" で設定・CLAUDE.md を読まない
// --bare は使わない（キーチェーンを読まなくなり、Pro の認証が通らない）。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export type ModelAlias = 'haiku' | 'sonnet' | 'opus';

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface Reply {
  text: string;
  usage: Usage;
}

const SYSTEM = [
  'あなたはポケモンチャンピオンズ（シングル 3vs3、Lv50、能力ポイント制）の対戦の助言役。',
  '計算はすでに済んでいる。渡された計算結果と盤面を前提に、読み合いの観点だけを短く日本語で述べる。',
  '決めるのは本人。断定せず、候補と理由を出す。1項目1行、最大3行。',
].join('\n');

export class ClaudeSession {
  private proc?: ChildProcessWithoutNullStreams;
  private pending?: { resolve: (r: Reply) => void; reject: (e: Error) => void };
  readonly usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

  constructor(
    readonly model: ModelAlias,
    private readonly system = SYSTEM,
  ) {}

  private start() {
    const args = [
      '-p',
      '--model', this.model,
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--system-prompt', this.system,
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', '',
    ];
    // 会話の記録が他の開発のものと並ばないよう、このリポジトリで起動する（DESIGN.md §6）
    const proc = spawn('claude', args, { cwd: new URL('../..', import.meta.url).pathname });
    this.proc = proc;
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg: { type?: string; subtype?: string; result?: string; usage?: Record<string, number> };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type !== 'result' || !this.pending) return;
      const u = msg.usage ?? {};
      const usage: Usage = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0,
      };
      for (const k of Object.keys(usage) as (keyof Usage)[]) this.usage[k] += usage[k];
      const p = this.pending;
      this.pending = undefined;
      if (msg.subtype === 'success') p.resolve({ text: msg.result ?? '', usage });
      else p.reject(new Error(`Claude の応答が失敗: ${msg.subtype}`));
    });
    proc.on('exit', () => {
      this.proc = undefined;
      this.pending?.reject(new Error('claude のプロセスが終了した'));
      this.pending = undefined;
    });
  }

  /** 1通送って返事を待つ。前の返事を待っている間は送らない */
  ask(content: string, timeoutMs = 60_000): Promise<Reply> {
    if (this.pending) return Promise.reject(new Error('前の質問の返事を待っている'));
    if (!this.proc) this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error('Claude の返事が時間切れ'));
      }, timeoutMs);
      this.pending = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.proc!.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    });
  }

  close() {
    this.proc?.stdin.end();
    this.proc = undefined;
  }
}

/** 1回きりの呼び出し（振り返り・環境メモなど） */
export async function askOnce(model: ModelAlias, system: string, content: string, timeoutMs = 300_000): Promise<Reply> {
  const s = new ClaudeSession(model, system);
  try {
    return await s.ask(content, timeoutMs);
  } finally {
    s.close();
  }
}
