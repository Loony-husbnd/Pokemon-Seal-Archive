/**
 * Match — Showdown 배틀 한 판을 감싸는 층.
 *
 *   const m = createMatch({ teams: [setsA, setsB], seed: [1, 2, 3, 4] });
 *   m.request(0)               → 나(0번)의 요청 (내 정보만 들어 있다)
 *   m.choices(0)               → 합법 선택지 목록
 *   m.submit([c0, c1])         → 양쪽 선택을 한꺼번에 넣어 한 턴 진행 (대기 중인 쪽은 null)
 *   m.view(0) / m.view(1)      → 각 플레이어 시점의 프로토콜 줄 (상대 정보는 가려져 있다)
 *   m.omniscient()             → 전지적 시점 (디버그·테스트용, AI 는 쓰지 않는다)
 *   m.clone(seed)              → 깊은 복사 + 난수 시드 교체 (탐색용)
 *
 * 복제에 관한 두 가지 약속 (spike/showdown 시험에서 확인):
 *   1) JSON 문자열로 깊은 복사한다. fromJSON(toJSON()) 만 쓰면 원본과 내부 객체를 공유해 원본이 오염된다.
 *   2) 복제본은 난수 시드를 새로 받는다. 시드를 그대로 두면 AI 가 급소·빗나감을 미리 보는 반칙이 된다.
 */
import { Battle, PRNG, Pokemon, extractChannelMessages } from '@pkmn/sim';
import { FORMAT_ID } from './format.js';
import { legalChoices, requestKind, toChoiceString } from './choices.js';

const CHANNELS = [-1, 0, 1, 2];     // -1 전지적, 0 관전자(공개), 1 p1, 2 p2
const SIDE = ['p1', 'p2'];

function wrap(battle, logs) {
  const match = {
    battle,
    get ended() { return battle.ended; },
    get winner() { return battle.ended ? (battle.winner === battle.p1.name ? 0 : battle.winner === battle.p2.name ? 1 : -1) : null; },
    get turn() { return battle.turn; },

    request(side) { return battle[SIDE[side]].activeRequest || null; },
    kind(side) { return requestKind(match.request(side)); },
    choices(side) { return legalChoices(match.request(side)); },

    /**
     * 양쪽 선택을 넣는다. 대기 중이거나 이번에 고를 필요 없는 쪽은 null.
     * 잘못된 선택이면 아무것도 진행하지 않고 오류를 던진다.
     */
    submit(picks) {
      const strs = picks.map(c => (c == null ? null : toChoiceString(c)));
      for (let s = 0; s < 2; s++) {
        if (strs[s] === null) continue;
        if (match.kind(s) === 'wait') throw new Error(`${SIDE[s]} 는 지금 선택할 수 없다 (대기 중)`);
      }
      for (let s = 0; s < 2; s++) {
        if (strs[s] === null) continue;
        if (!battle.choose(SIDE[s], strs[s])) {
          for (const t of SIDE) battle.undoChoice && battle.undoChoice(t);      // 앞서 넣은 선택을 되돌려 다음 시도에 영향이 없게 한다
          throw new Error(`${SIDE[s]} 의 선택이 올바르지 않다: ${strs[s]}`);
        }
      }
      battle.sendUpdates();         // Battle 은 스트림 없이 쓰면 직접 내보내야 새 로그가 view 에 쌓인다
    },

    /**
     * 선택을 고르는 함수(pickFn(match) → [선택0, 선택1])로 제출한다. 거부되면 선택지를 다시 읽고 고쳐서 다시 시도한다(기본 3번).
     * 상대의 특성(그림자밟기 등)으로 교체가 막혀도 요청에는 '막혔을 수도 있음'(maybeTrapped)으로만 나오고, 시도해 봐야 막힌 것이 드러난다.
     * 그래서 교체가 거부될 수 있고, 그때는 선택지가 갱신되므로 다시 고르면 된다. 이것은 오류가 아니라 정상 흐름이다.
     */
    submitWith(pickFn, tries = 3) {
      let last;
      for (let i = 0; i < tries; i++) {
        try { return match.submit(pickFn(match, i)); } catch (e) { last = e; if (!/올바르지 않다/.test(e.message)) throw e; }
      }
      throw last;
    },

    /** 플레이어별 프로토콜 줄. since 를 주면 그 이후 줄만 */
    view(side, since = 0) { return logs.chan[side + 1].slice(since); },
    omniscient(since = 0) { return logs.chan[0].slice(since); },
    spectator(since = 0) { return logs.chan[3].slice(since); },
    /** 시점별 현재 줄 수 (since 로 쓴다) */
    mark(side) { return logs.chan[side === 'omni' ? 0 : side + 1].length; },

    /**
     * '가려진 세계': 내 쪽은 그대로(정확), 상대 쪽의 숨은 정보(기술·특성·도구·능력치)는 추정값(guess)으로 바꾼 복제 배틀.
     * AI 는 진짜 배틀 대신 이것만 들여다본다. 공개된 정보(체력 퍼센트·상태이상·능력 변화·누가 나와 있는지)만 진짜에서 옮겨 온다.
     *   guess: { 이름(셋의 name): PokemonSet }  상대 파티 전원의 추정 셋. 이름은 프로토콜에 나오는 이름(공개 정보)이다.
     * 돌려주는 world 는 match 와 같은 모양(choices/submit/clone/ended/winner)에 sideState() 가 더해진다.
     */
    world(side, guess, seed) {
      const copy = Battle.fromJSON(JSON.parse(JSON.stringify(battle.toJSON())));
      copy.prng = new PRNG(seed);
      const foe = copy.sides[1 - side];
      foe.pokemon.forEach((real, i) => {
        const set = guess[real.name];
        if (!set) throw new Error(`추정 셋이 없다: ${real.name}`);
        const fresh = new Pokemon(Object.assign({}, set, { name: real.name }), foe);
        const pct = real.fainted ? 0 : Math.max(1, Math.ceil(real.hp * 100 / real.maxhp));      // 상대 체력은 퍼센트만 공개된다
        fresh.hp = real.fainted ? 0 : Math.max(1, Math.round(pct / 100 * fresh.maxhp));
        fresh.fainted = real.fainted; fresh.faintQueued = real.faintQueued;
        fresh.status = real.status; fresh.statusState = real.status ? { id: real.status, target: fresh, time: real.status === 'slp' ? 2 : undefined, stage: real.status === 'tox' ? (real.statusState.stage || 1) : undefined } : { id: '', effectOrder: 0 };
        fresh.boosts = Object.assign({}, real.boosts);
        fresh.position = real.position; fresh.isActive = real.isActive; fresh.isStarted = real.isStarted; fresh.activeTurns = real.activeTurns;
        fresh.newlySwitched = real.newlySwitched; fresh.previouslySwitchedIn = real.previouslySwitchedIn;
        fresh.itemKnockedOff = real.itemKnockedOff; if (real.item === '' && set.item) { fresh.item = ''; }
        // side.team 은 복제(직렬화) 때 다시 읽히는 진짜 셋 목록이다. 숨은 정보가 되살아나지 않도록 추정 셋으로 바꾼다.
        const ti = foe.team.indexOf(real.set); if (ti >= 0) foe.team[ti] = fresh.set;
        foe.pokemon[i] = fresh;
        if (foe.active[0] === real) foe.active[0] = fresh;
      });
      for (const k of ['log', 'inputLog', 'messageLog']) if (Array.isArray(copy[k])) copy[k] = [];
      copy.makeRequest(copy.requestState);
      return wrap(copy, { chan: [[], [], [], []] });
    },

    /**
     * 플레이어 시점의 창구. AI 와 화면은 진짜 배틀(battle)이 아니라 이것만 받는다.
     * 보이는 것: 내 선택지, 이 시점의 공개 로그, 그리고 world()(상대 숨은 정보를 추정으로 바꾼 복제).
     */
    player(side) {
      return {
        side,
        kind: () => match.kind(side),
        choices: () => match.choices(side),
        lines: since => match.view(side, since),
        world: (guess, seed) => match.world(side, guess, seed),
        /** 내 쪽 요청에서 읽는 내 파티 정보 (정확한 체력·기술·특성·도구) — 상대 정보는 없다 */
        team: () => { const q = match.request(side); return q ? q.side.pokemon.map((p, i) => { const m = /^(\d+)(?:\/(\d+))?(?: (\w+))?/.exec(p.condition); return { index: i, ident: p.ident.split(': ')[1], species: p.details.split(',')[0], hp: Number(m[1]), maxHp: Number(m[2] || m[1]), status: m[3] && m[3] !== 'fnt' ? m[3] : null, fainted: / fnt$/.test(p.condition) || p.condition === '0 fnt', active: p.active, moves: p.moves, ability: p.baseAbility, item: p.item }; }) : []; },
        /** 이번 턴 내 기술 칸 정보 (PP·막힘) 와 메가진화 가능 여부 */
        moves: () => { const q = match.request(side); if (!q || !q.active) return null; const a = q.active[0]; return { moves: a.moves.map((mv, i) => ({ index: i, id: mv.id, name: mv.move, pp: mv.pp, maxpp: mv.maxpp, disabled: !!mv.disabled })), canMega: !!a.canMegaEvo, trapped: !!a.trapped, locked: a.moves.length === 1 && a.moves[0].pp == null }; },      // locked: 반동·충전·난동·발버둥처럼 선택지가 하나로 고정된 턴(요청에 PP 정보가 없다)
      };
    },

    /** 탐색용 복제. seed 는 [a, b, c, d] 숫자 4개 */
    clone(seed) {
      const copy = Battle.fromJSON(JSON.parse(JSON.stringify(battle.toJSON())));
      copy.prng = new PRNG(seed);
      return wrap(copy, { chan: [[], [], [], []] });
    },
    /** 한 번 직렬화해 두고 여러 번 복원한다 (같은 상태에서 후보 여러 개를 굴릴 때 복제 비용이 약 1/3). 복원할 때마다 시드를 새로 준다 */
    snapshot() {
      const json = JSON.stringify(battle.toJSON());
      return { restore(seed) { const copy = Battle.fromJSON(JSON.parse(json)); copy.prng = new PRNG(seed); return wrap(copy, { chan: [[], [], [], []] }); } };
    },
  };
  return match;
}

export function createMatch(o) {
  const logs = { chan: [[], [], [], []] };     // [전지적, p1, p2, 관전자]
  const battle = new Battle({
    formatid: o.format || FORMAT_ID,
    seed: o.seed || [1, 2, 3, 4],
    p1: { name: 'p1', team: o.teams[0] },
    p2: { name: 'p2', team: o.teams[1] },
    send: (type, data) => {
      if (type !== 'update') return;
      const by = extractChannelMessages(Array.isArray(data) ? data.join('\n') : data, CHANNELS);
      // 채널 번호 -1,0,1,2 → 저장 위치 0,3,1,2
      const put = (ch, idx) => { const lines = by[ch]; if (lines && lines.length) logs.chan[idx].push(...lines.filter(Boolean)); };
      put(-1, 0); put(1, 1); put(2, 2); put(0, 3);
    },
  });
  battle.sendUpdates();
  const match = wrap(battle, logs);
  if (o.skipPreview !== false) match.submit([{ type: 'default' }, { type: 'default' }]);      // 팀 미리보기는 기본 순서로 넘긴다
  return match;
}
