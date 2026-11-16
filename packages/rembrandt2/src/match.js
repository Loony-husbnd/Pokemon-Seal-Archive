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
import { Battle, PRNG, extractChannelMessages } from '@pkmn/sim';
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

    /** 플레이어별 프로토콜 줄. since 를 주면 그 이후 줄만 */
    view(side, since = 0) { return logs.chan[side + 1].slice(since); },
    omniscient(since = 0) { return logs.chan[0].slice(since); },
    spectator(since = 0) { return logs.chan[3].slice(since); },
    /** 시점별 현재 줄 수 (since 로 쓴다) */
    mark(side) { return logs.chan[side === 'omni' ? 0 : side + 1].length; },

    /** 탐색용 복제. seed 는 [a, b, c, d] 숫자 4개 */
    clone(seed) {
      const copy = Battle.fromJSON(JSON.parse(JSON.stringify(battle.toJSON())));
      copy.prng = new PRNG(seed);
      return wrap(copy, { chan: [[], [], [], []] });
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
