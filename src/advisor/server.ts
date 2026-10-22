// 助言の窓。手元だけで開く小さな web ページ（127.0.0.1 のみ）。
// メニューバーの代わりに、一時停止・軽量モード・Claude の入切・選出の入力をここに置く。
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { Advice } from '../engine/explain.js';

export interface View {
  status: string;
  paused: boolean;
  /** 軽量モード: 読みを浅く（1ターン）し、選出時の Claude を呼ばない（DESIGN.md §8） */
  light: boolean;
  useClaude: boolean;
  screenKind?: string;
  team: { species: string; ja: string }[];
  selection?: { picks: { mons: string[]; lead: string; score: number }[]; dangers: string[]; notes: string[] };
  board?: { mine: string; opp: string; turn: number; ms: number; depth: number };
  advice?: Advice[];
  oppPrediction?: { label: string; prob: number }[];
  claudeNote?: string;
  /** 選出画面の相手の6枠。known=false はアイコンを知らず、本人の入力待ち */
  oppSlots?: { ja: string; known: boolean }[];
  slotVersion?: number;
  log: string[];
}

export interface Handlers {
  onPick: (species: string[]) => void;
  onNewMatch: () => void;
  /** 相手の6匹の名前（日本語）。問題があればその説明を返す */
  onOppNames: (names: string[]) => string | undefined;
  slotDir: string;
  speciesNames: string[];
}

const PORT = Number(process.env.PA_PORT ?? 8765);

export function startServer(view: View, h: Handlers) {
  const clients = new Set<ServerResponse>();
  const push = () => {
    const data = `data: ${JSON.stringify(view)}\n\n`;
    for (const c of clients) c.write(data);
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res);
      res.write(`data: ${JSON.stringify(view)}\n\n`);
      req.on('close', () => clients.delete(res));
      return;
    }
    const slot = /^\/slot\/(\d)\.png$/.exec(url.pathname);
    if (slot) {
      const f = `${h.slotDir}/slot${slot[1]}.png`;
      if (!existsSync(f)) return void res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(readFileSync(f));
      return;
    }
    if (url.pathname === '/names.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(h.speciesNames));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/opp') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const err = h.onOppNames((JSON.parse(body) as { names: string[] }).names);
        res.writeHead(err ? 400 : 204, { 'Content-Type': 'text/plain; charset=utf-8' }).end(err ?? '');
        push();
      });
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const p = body ? (JSON.parse(body) as { species?: string[] }) : {};
        if (url.pathname === '/pause') view.paused = !view.paused;
        else if (url.pathname === '/light') view.light = !view.light;
        else if (url.pathname === '/claude') view.useClaude = !view.useClaude;
        else if (url.pathname === '/pick') h.onPick(p.species ?? []);
        else if (url.pathname === '/new') h.onNewMatch();
        res.writeHead(204).end();
        push();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`助言の窓: http://127.0.0.1:${PORT}`));
  return { push };
}

const PAGE = /* html */ `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>poke-assist</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#2563eb;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c;--accent:#60a5fa;--warn:#fbbf24}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"Hiragino Sans",sans-serif}
main{max-width:520px;margin:0 auto;padding:12px 16px}
.bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
button{font:inherit;padding:3px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);cursor:pointer}
button.on{border-color:var(--accent);color:var(--accent)}
.status{color:var(--muted);font-size:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0}
h2{font-size:12px;color:var(--muted);margin:0 0 6px;font-weight:600}
.cand{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:6px 0}
.cand b{font-size:16px}.prob{color:var(--accent);font-variant-numeric:tabular-nums}
.reason{grid-column:1/-1;color:var(--muted);font-size:12px}
.warn{color:var(--warn)}
.log{font-size:11px;color:var(--muted);white-space:pre-wrap;max-height:120px;overflow:auto}
label{margin-right:8px;white-space:nowrap}
.slot{display:flex;align-items:center;gap:8px;margin:2px 0}.slot input{font:inherit;width:9em;padding:2px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.slot input.need{border-color:var(--warn)}
</style></head><body><main>
<div class="bar">
 <button id="pause">一時停止</button><button id="light">軽量モード</button><button id="claude">Claude</button><button id="new">試合を区切る</button>
</div>
<div class="status" id="status"></div>
<section id="oppbox" hidden><h2>相手の6匹（知らないアイコンは名前を入れて「決定」。次からは自動で分かる）</h2><div id="opp"></div>
<button id="oppok">決定</button> <span id="opperr" class="warn"></span></section>
<datalist id="names"></datalist>
<div id="body"></div>
<section><h2>選んだ3匹（控えの計算に使う）</h2><div id="pick"></div></section>
<section><h2>記録</h2><div class="log" id="log"></div></section>
</main>
<script>
const $=id=>document.getElementById(id);
const post=(p,b)=>fetch(p,{method:'POST',body:b?JSON.stringify(b):undefined});
$('pause').onclick=()=>post('/pause');$('light').onclick=()=>post('/light');$('claude').onclick=()=>post('/claude');$('new').onclick=()=>post('/new');
let pickBuilt=false,slotVer=0;
fetch('/names.json').then(r=>r.json()).then(ns=>{$('names').innerHTML=ns.map(n=>'<option value="'+n+'">').join('')});
$('oppok').onclick=async()=>{const names=[...document.querySelectorAll('#opp input')].map(i=>i.value);
 const r=await fetch('/opp',{method:'POST',body:JSON.stringify({names})});$('opperr').textContent=r.ok?'':await r.text();};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function render(v){
 $('pause').classList.toggle('on',v.paused);$('light').classList.toggle('on',v.light);$('claude').classList.toggle('on',v.useClaude);
 $('status').textContent=v.status+(v.screenKind?' / 画面: '+v.screenKind:'');
 if(!pickBuilt){$('pick').innerHTML=v.team.map(t=>'<label><input type=checkbox value="'+esc(t.species)+'"> '+esc(t.ja)+'</label>').join('');
  $('pick').onchange=()=>post('/pick',{species:[...document.querySelectorAll('#pick input:checked')].map(i=>i.value)});pickBuilt=true;}
 if(v.oppSlots){$('oppbox').hidden=false;
  if(v.slotVersion!==slotVer){slotVer=v.slotVersion;
   $('opp').innerHTML=v.oppSlots.map((o,i)=>'<div class=slot><img src="/slot/'+i+'.png?v='+slotVer+'" height=40> <input list=names value="'+esc(o.ja)+'" placeholder="名前"'+(o.known?'':' class=need')+'></div>').join('');}
 } else $('oppbox').hidden=true;
 let h='';
 if(v.board){h+='<section><h2>ターン '+v.board.turn+'（'+v.board.depth+'手先・'+v.board.ms+'ms）</h2>'+esc(v.board.mine)+' ／ 相手 '+esc(v.board.opp)+'</section>';}
 if(v.advice){h+='<section><h2>候補（決めるのは本人）</h2>'+v.advice.map(a=>'<div class=cand><b>'+esc(a.label)+'</b><span class=prob>'+Math.round(a.prob*100)+'%</span><span class=reason>'+esc(a.reason)+'</span></div>').join('')+'</section>';}
 if(v.oppPrediction){h+='<section><h2>相手の手の予想</h2>'+v.oppPrediction.map(p=>esc(p.label)+' <span class=prob>'+Math.round(p.prob*100)+'%</span>').join(' ／ ')+'</section>';}
 if(v.selection){const s=v.selection;h+='<section><h2>選出の候補</h2>'+s.picks.map(p=>'<div>'+esc(p.mons.join('・'))+' <span class=reason>先発 '+esc(p.lead)+'</span></div>').join('')+(s.dangers.length?'<div class=warn>誰も有利を取れない: '+esc(s.dangers.join('・'))+'</div>':'')+s.notes.map(n=>'<div class=reason>'+esc(n)+'</div>').join('')+'</section>';}
 if(v.claudeNote){h+='<section><h2>Claude</h2><div style="white-space:pre-wrap">'+esc(v.claudeNote)+'</div></section>';}
 $('body').innerHTML=h;$('log').textContent=v.log.join('\\n');
}
const es=new EventSource('/events');es.onmessage=e=>render(JSON.parse(e.data));
</script></body></html>`;
