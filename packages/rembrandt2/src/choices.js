/**
 * Showdown 요청(request) → 합법 선택지 목록. AI 와 화면은 요청을 직접 읽지 않고 이 목록만 쓴다.
 *
 *   선택지: { type:'move', index, mega?:true, name, usable } | { type:'switch', to, name } | { type:'default' }
 *   index/to 는 0부터 시작(화면·AI 기준). 선택 문자열(`move 2 mega`)은 toChoiceString 으로 만든다.
 */

/** 이 요청에서 나는 지금 행동해야 하는가 */
export function needsAction(request) {
  return !!request && !request.wait;
}

/** 요청의 종류: 'preview' | 'switch' | 'move' | 'wait' */
export function requestKind(request) {
  if (!request || request.wait) return 'wait';
  if (request.teamPreview) return 'preview';
  if (request.forceSwitch) return 'switch';
  return 'move';
}

const alive = p => !p.active && !/ fnt$/.test(p.condition) && p.condition !== '0 fnt';

/** 교체해 들어올 수 있는 포켓몬 */
function switchOptions(request) {
  return request.side.pokemon.map((p, i) => ({ p, i })).filter(({ p }) => alive(p)).map(({ p, i }) => ({ type: 'switch', to: i, name: p.details.split(',')[0] }));
}

/** 합법 선택지 전체. 대기 중이면 빈 배열 */
export function legalChoices(request) {
  const kind = requestKind(request);
  if (kind === 'wait') return [];
  if (kind === 'preview') return [{ type: 'default' }];
  if (kind === 'switch') return switchOptions(request);
  const act = request.active[0], out = [];
  act.moves.forEach((m, index) => {
    if (m.disabled) return;
    out.push({ type: 'move', index, name: m.move, usable: true });
    if (act.canMegaEvo) out.push({ type: 'move', index, mega: true, name: m.move, usable: true });
  });
  if (!act.trapped && !act.maybeTrapped) out.push(...switchOptions(request));
  else if (act.maybeTrapped && !act.trapped) out.push(...switchOptions(request));
  return out;
}

/** 선택지 → Showdown 선택 문자열 */
export function toChoiceString(c) {
  if (typeof c === 'string') return c;
  if (c.type === 'move') return `move ${c.index + 1}${c.mega ? ' mega' : ''}`;
  if (c.type === 'switch') return `switch ${c.to + 1}`;
  return 'default';
}
