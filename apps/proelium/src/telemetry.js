// 배틀 기록 수집 · 전송 (AI 개선용)
//  - 배틀 중에는 recorder 가 시드·파티·턴별 상태·행동·이벤트를 모은다.
//  - 결과 화면에서 사용자가 [한 번 더 / 새 상대 / 팀 수정 / 홈] 중 하나를 누르면 send() 로 한 번만 전송한다.
//  - 전송 주소는 빌드 때 VITE_LOG_ENDPOINT 로 정한다. 비어 있으면 아무것도 보내지 않는다.
//  - 개인 식별 정보(이름·계정·IP 등)는 담지 않는다. 사용자가 결과 화면에서 끄면 전송하지 않는다.
const ENDPOINT = (import.meta.env && import.meta.env.VITE_LOG_ENDPOINT) || '';
const QUEUE_KEY = 'proelium:logqueue';
const QUEUE_MAX = 5;                 // 전송 실패분은 최근 5판까지만 보관 (저장소 용량 보호)
const SCHEMA = 1;

export const telemetryEnabled = () => !!ENDPOINT;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/** 한 판의 기록기. battle.js 가 만들고 결과 화면으로 넘긴다 */
export function createRecorder({ seed, level, mine, opp }) {
  const rec = {
    schema: SCHEMA, id: uid(), at: new Date().toISOString(), seed, level,
    parties: [mine, opp].map(team => team.map(t => ({ id: t.id, moves: t.moves.slice() }))),
    steps: [], result: null,
  };
  const snap = B => ({
    turn: B.turn, field: Object.assign({}, B.field),
    sides: B.sides.map(s => ({
      active: s.active, cond: Object.assign({}, s.cond),
      party: s.party.map(m => ({ hp: m.hp, maxHp: m.maxHp, status: m.status, fainted: m.fainted, pp: m.moves.map(x => x.pp) })),
    })),
  });
  return {
    /** 엔진을 진행시키기 직전 상태를 찍고 run() 을 실행해, 상태·행동·결과 이벤트를 한 단계로 저장한다. run 의 이벤트를 돌려준다 */
    step(kind, B, run, meta) { const state = snap(B), events = run(); rec.steps.push(Object.assign({ k: kind, state, events }, meta)); return events; },
    finish(winner, turns, surrendered) { rec.result = { winner, turns, surrendered: !!surrendered }; return rec; },
    data: rec,
  };
}

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; } };
const writeQueue = q => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch (e) { /* 저장 실패는 무시 */ } };

function post(body) {
  return fetch(ENDPOINT, {
    method: 'POST', body, keepalive: body.length < 60000,       // 화면 이동 중에도 요청이 끊기지 않게 (keepalive 는 64KB 한도)
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },     // 단순 요청이라 CORS 사전요청(preflight)이 필요 없다
  }).then(r => { if (!r.ok) throw new Error(r.status); });
}

/** 기록을 전송한다. 실패하면 대기열에 넣어 다음 기회에 다시 시도한다 */
export async function send(log) {
  if (!ENDPOINT || !log) return;
  const q = readQueue(); q.push(log); writeQueue(q);
  await flush();
}

export async function flush() {
  if (!ENDPOINT) return;
  const q = readQueue();
  for (const item of q) {
    try { await post(JSON.stringify(item)); writeQueue(readQueue().filter(x => x.id !== item.id)); }
    catch (e) { return; }                                          // 오프라인·서버 오류 → 남겨 두고 나중에
  }
}
