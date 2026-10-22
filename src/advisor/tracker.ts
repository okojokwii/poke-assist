// 画面の読み取り結果を試合の流れとして積み上げ、探索エンジンへ渡す盤面を作る。
// 画面の読み取りは1枚ごとに抜けや誤りがあるので、見えたものだけで上書きし、見えなかったものは前の値を残す。
import type { Team } from '../dex/sets.js';
import { likelySets, type UsageDB, type WeightedSet } from '../usage/usage.js';
import { newMon, type BattleState, type MonState } from '../engine/state.js';
import { newMatch, type MatchLog } from '../match/log.js';

export interface SideView {
  species: string;
  /** 自分は実数、相手は割合で見える */
  hpFrac: number;
  hpRaw?: { cur: number; max: number };
}

export class Tracker {
  match: MatchLog;
  phase: 'idle' | 'preview' | 'battle' | 'ended' = 'idle';
  turn = 0;
  myActive?: SideView;
  oppActive?: SideView;
  private myMons = new Map<string, MonState>();
  private oppMons = new Map<string, MonState>();
  private megaUsed: [boolean, boolean] = [false, false];
  private oppSetCache = new Map<string, WeightedSet[]>();
  private lastOppMove?: string;

  constructor(
    readonly team: Team,
    readonly usage: UsageDB | undefined,
  ) {
    this.match = newMatch(team.name);
  }

  reset() {
    this.match = newMatch(this.team.name);
    this.phase = 'idle';
    this.turn = 0;
    this.myActive = this.oppActive = undefined;
    this.myMons.clear();
    this.oppMons.clear();
    this.megaUsed = [false, false];
    this.lastOppMove = undefined;
  }

  oppSets(species: string): WeightedSet[] {
    let s = this.oppSetCache.get(species);
    if (!s) {
      s = likelySets(this.usage, species, 3);
      this.oppSetCache.set(species, s);
    }
    return s;
  }

  onPreview(oppSpecies: string[]) {
    if (this.phase === 'battle' || this.phase === 'ended') this.reset();
    this.phase = 'preview';
    if (oppSpecies.length > this.match.oppTeam.length) this.match.oppTeam = oppSpecies;
  }

  private myMember(species: string) {
    // メガ後の名前でも元の型を引けるように
    return this.team.members.find((m) => m.species === species || m.megaSpecies === species || (m as { bladeSpecies?: string }).bladeSpecies === species);
  }

  /** 戦闘中の画面1枚分。名前・HP が読めたものだけ更新する */
  onBattleFrame(mine: string | undefined, opp: string | undefined, myHp: { cur: number; max: number } | undefined, oppHpFrac: number | undefined) {
    if (this.phase !== 'battle') {
      this.phase = 'battle';
      this.turn = 0;
    }
    if (mine) {
      const member = this.myMember(mine);
      if (member) {
        const key = member.species;
        if (!this.myMons.has(key)) this.myMons.set(key, newMon(member));
        if (!this.match.myPick.includes(key)) this.match.myPick.push(key);
        const st = this.myMons.get(key)!;
        if (mine === member.megaSpecies) {
          st.megaEvolved = true;
          this.megaUsed[0] = true;
        }
        if (myHp && myHp.max > 0) {
          // HP の数字が減ったら「受けたダメージ」として記録する（答え合わせ用。急所・定数ダメージも混ざる）
          const prev = this.myActive?.species === key ? this.myActive.hpRaw : undefined;
          if (prev && myHp.cur < prev.cur && this.oppActive) {
            this.match.damage.push({
              turn: this.turn, dir: 'taken', attacker: this.oppActive.species, defender: key,
              move: this.lastOppMove, before: prev.cur, after: myHp.cur, unit: 'hp',
            });
          }
          st.hp = myHp.cur / myHp.max;
        }
        this.myActive = { species: key, hpFrac: st.hp, hpRaw: myHp };
      }
    }
    if (opp) {
      const base = opp.endsWith('-Mega') ? opp.slice(0, -5) : opp;
      if (!this.oppMons.has(base)) {
        const set = this.oppSets(opp.endsWith('-Mega') ? base : opp)[0]!.set;
        this.oppMons.set(base, newMon(set));
      }
      if (!this.match.oppSeen.includes(base)) this.match.oppSeen.push(base);
      const st = this.oppMons.get(base)!;
      if (opp.endsWith('-Mega')) {
        st.megaEvolved = true;
        st.set = { ...st.set, megaSpecies: st.set.megaSpecies ?? opp };
        this.megaUsed[1] = true;
      }
      if (oppHpFrac !== undefined) {
        if (this.oppActive?.species === base && oppHpFrac < st.hp - 0.005 && this.myActive) {
          this.match.damage.push({
            turn: this.turn, dir: 'dealt', attacker: this.myActive.species, defender: base,
            before: Math.round(st.hp * 1000) / 10, after: Math.round(oppHpFrac * 1000) / 10, unit: 'pct',
          });
        }
        st.hp = oppHpFrac;
      }
      this.oppActive = { species: base, hpFrac: st.hp };
    }
  }

  /** 選出した3匹（助言の窓で本人が押す）。控えの計算に使う */
  setMyPick(species: string[]) {
    this.match.myPick = species;
    for (const sp of species) {
      const m = this.myMember(sp);
      if (m && !this.myMons.has(m.species)) this.myMons.set(m.species, newMon(m));
    }
  }

  /** 画面の文から読めた技（相手の技は型の推定に足す） */
  onMoveSeen(side: 'mine' | 'opp', move: string) {
    if (side === 'opp') this.lastOppMove = move;
    if (side === 'opp' && this.oppActive) {
      const st = this.oppMons.get(this.oppActive.species);
      if (st && !st.revealedMoves.includes(move)) st.revealedMoves.push(move);
    }
  }

  onTurnStart() {
    this.turn++;
  }

  /** 探索エンジンに渡す盤面。場のポケモンが両方わかっている時だけ作れる */
  battleState(): BattleState | undefined {
    if (!this.myActive || !this.oppActive) return undefined;
    // 自分の控え: 助言の窓で選んだ3匹＋試合中に場に出たもの
    const myList = [...this.myMons.values()];
    const oppList = [...this.oppMons.values()];
    const mySide = {
      mons: myList,
      active: myList.findIndex((m) => m.set.species === this.myActive!.species),
      stealthRock: false,
      megaUsed: this.megaUsed[0],
    };
    // 相手の控えのうちまだ見ていない分は、選出画面の6匹のうち使用率の高い順に仮に足す（3匹になるまで）
    const seen = new Set(this.oppMons.keys());
    const usageOf = (sp: string) => this.usage?.chaos.data[sp]?.usage ?? 0;
    const unseen = this.match.oppTeam.filter((s) => !seen.has(s)).sort((a, b) => usageOf(b) - usageOf(a));
    const filler = unseen.slice(0, Math.max(0, 3 - oppList.length)).map((s) => newMon(this.oppSets(s)[0]!.set));
    const oppSide = {
      mons: [...oppList, ...filler],
      active: oppList.findIndex((m) => (m.set.species === this.oppActive!.species) || m.set.species.startsWith(this.oppActive!.species)),
      stealthRock: false,
      megaUsed: this.megaUsed[1],
    };
    if (mySide.active < 0 || oppSide.active < 0) return undefined;
    return { sides: [mySide, oppSide], turn: this.turn };
  }

  oppActiveSets(): WeightedSet[] | undefined {
    if (!this.oppActive) return undefined;
    const st = this.oppMons.get(this.oppActive.species);
    return this.oppSets(this.oppActive.species).map((w) => ({
      ...w,
      set: { ...w.set, megaSpecies: st?.megaEvolved ? st.set.megaSpecies : w.set.megaSpecies },
    }));
  }
}
