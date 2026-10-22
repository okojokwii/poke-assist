// 画面の読み取り結果を試合の流れとして積み上げ、探索エンジンへ渡す盤面を作る。
// 画面の読み取りは1枚ごとに抜けや誤りがあるので、見えたものだけで上書きし、見えなかったものは前の値を残す。
import type { Team } from '../dex/sets.js';
import { likelySets, type UsageDB, type WeightedSet } from '../usage/usage.js';
import { emptyBoosts, newMon, type BattleState, type Boosts, type MonState } from '../engine/state.js';
import { moveInfo } from '../engine/moves.js';
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
  /** ステルスロックが撒かれているか。[自分の場, 相手の場] */
  private rocks: [boolean, boolean] = [false, false];

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
    this.rocks = [false, false];
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
        // 交代したら、引っ込んだ側の能力変化は元に戻る
        if (this.myActive && this.myActive.species !== key) this.clearOnSwitch(this.myMons.get(this.myActive.species));
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
      const isMega = /-Mega(-[XYZ])?$/.test(opp);
      const base = opp.replace(/-Mega(-[XYZ])?$/, '');
      if (this.oppActive && this.oppActive.species !== base) this.clearOnSwitch(this.oppMons.get(this.oppActive.species));
      if (!this.oppMons.has(base)) this.oppMons.set(base, newMon(this.oppSets(base)[0]!.set));
      if (!this.match.oppSeen.includes(base)) this.match.oppSeen.push(base);
      const st = this.oppMons.get(base)!;
      if (isMega && !st.megaEvolved) {
        // メガシンカが見えたら、型の候補をそのメガの集計に絞り直す
        st.set = { ...(this.oppSets(opp)[0]?.set ?? st.set), megaSpecies: opp };
        st.megaEvolved = true;
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

  private clearOnSwitch(m: MonState | undefined) {
    if (!m) return;
    m.boosts = emptyBoosts();
    m.drowsy = 0;
    m.choiceLock = undefined;
  }

  private activeState(side: 'mine' | 'opp'): MonState | undefined {
    const v = side === 'mine' ? this.myActive : this.oppActive;
    return v ? (side === 'mine' ? this.myMons : this.oppMons).get(v.species) : undefined;
  }

  /**
   * 画面の文から読めた技。能力変化（わるだくみ・りゅうせいぐん等）とステルスロックを盤面に反映し、
   * 相手の技は型の推定に足す。外れた・失敗した場合も反映してしまうので、「様子を見る」の画面で上書きして直す。
   */
  onMoveSeen(side: 'mine' | 'opp', move: string) {
    if (side === 'opp') this.lastOppMove = move;
    const user = this.activeState(side);
    const target = this.activeState(side === 'mine' ? 'opp' : 'mine');
    if (side === 'opp' && user && !user.revealedMoves.includes(move)) user.revealedMoves.push(move);
    const info = moveInfo(move);
    if (info.selfBoosts && user) addBoosts(user, info.selfBoosts);
    if (info.boosts && !info.targetsSelf && target) addBoosts(target, info.boosts);
    if (info.sideCondition === 'stealthrock') this.rocks[side === 'mine' ? 1 : 0] = true;
  }

  /** 「様子を見る」の画面で読めた能力変化で上書きする（こちらが正しい） */
  onStatusScreen(side: 'mine' | 'opp', boosts: Boosts) {
    const m = this.activeState(side);
    if (m) m.boosts = { ...boosts };
  }

  /** 今の場の能力変化（助言の窓に出す用） */
  boostsOf(side: 'mine' | 'opp'): Boosts | undefined {
    return this.activeState(side)?.boosts;
  }

  get oppHasRocks() {
    return this.rocks[1];
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
      stealthRock: this.rocks[0],
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
      stealthRock: this.rocks[1],
      megaUsed: this.megaUsed[1],
    };
    if (mySide.active < 0 || oppSide.active < 0) return undefined;
    return { sides: [mySide, oppSide], turn: this.turn };
  }

  oppActiveSets(): WeightedSet[] | undefined {
    if (!this.oppActive) return undefined;
    const st = this.oppMons.get(this.oppActive.species);
    // メガ後ならそのメガの型だけ、メガ前ならメガする型・しない型を混ぜたまま
    if (st?.megaEvolved && st.set.megaSpecies) return this.oppSets(st.set.megaSpecies);
    // 相手がもうメガを使った（別のポケモンで）なら、この子はメガしない型だけ
    const sets = this.oppSets(this.oppActive.species);
    if (this.megaUsed[1]) {
      const plain = sets.filter((w) => !w.set.megaSpecies);
      if (plain.length) return plain;
    }
    return sets;
  }
}

function addBoosts(m: MonState, b: Record<string, number>) {
  for (const [k, v] of Object.entries(b)) {
    if (k in m.boosts) {
      const key = k as keyof Boosts;
      m.boosts[key] = Math.max(-6, Math.min(6, m.boosts[key] + v));
    }
  }
}
