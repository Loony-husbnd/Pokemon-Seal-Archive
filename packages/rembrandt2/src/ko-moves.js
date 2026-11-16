/**
 * 기술의 한국어 짧은 설명 (선택 화면용). Showdown 데이터의 필드에서 만든다 — 모든 효과를 다 설명하지는 않고 핵심만 적는다.
 */
import { dex } from './ai/calc.js';
import { koName } from './ko.js';

const AIL = { slp: '수면', par: '마비', brn: '화상', psn: '독', tox: '맹독', frz: '얼음' };
const STAT = { atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드', accuracy: '명중', evasion: '회피' };
const SIDE = { stealthrock: '스텔스록', spikes: '압정', toxicspikes: '독압정', stickyweb: '끈적끈적네트', reflect: '리플렉터', lightscreen: '빛의장막', auroraveil: '오로라베일', tailwind: '순풍', safeguard: '신비의부적', mist: '흰안개' };
const WEATHER = { RainDance: '비', SunnyDay: '쾌청', Sandstorm: '모래바람', Snow: '눈', Hail: '싸라기눈' };
const boostText = b => Object.entries(b).map(([k, n]) => `${STAT[k] || k} ${n > 0 ? '+' : ''}${n}`).join(' ');

export function describeMove(idOrMove) {
  const m = typeof idOrMove === 'string' ? dex.moves.get(idOrMove) : idOrMove;
  const out = [];
  if (m.priority > 0) out.push('선제공격'); else if (m.priority < 0) out.push('후공');
  if (m.multihit) out.push(Array.isArray(m.multihit) ? `${m.multihit[0]}~${m.multihit[1]}회` : `${m.multihit}회`);
  if (m.drain) out.push(`흡수 ${Math.round(100 * m.drain[0] / m.drain[1])}%`);
  if (m.recoil) out.push(`반동 ${Math.round(100 * m.recoil[0] / m.recoil[1])}%`);
  if (m.ohko) out.push('일격필살');
  if (m.selfSwitch) out.push('때린 뒤 교체');
  if (m.flags && m.flags.charge) out.push('1턴 모음');
  if (m.flags && m.flags.recharge) out.push('다음 턴 반동');
  if (m.willCrit) out.push('반드시 급소'); else if (m.critRatio > 1) out.push('급소 높음');
  if (m.damage === 'level') out.push('레벨만큼 피해'); else if (typeof m.damage === 'number') out.push(`${m.damage} 고정 피해`);
  if (m.status) out.push(`${AIL[m.status] || m.status}${m.category === 'Status' ? '' : ''}`);
  if (m.volatileStatus === 'confusion') out.push('혼란');
  if (m.secondary && m.secondary.chance) {
    const s = m.secondary, bits = [];
    if (s.status) bits.push(AIL[s.status]); if (s.volatileStatus === 'flinch') bits.push('풀죽음'); if (s.volatileStatus === 'confusion') bits.push('혼란');
    if (s.boosts) bits.push(boostText(s.boosts)); if (s.self && s.self.boosts) bits.push('자신 ' + boostText(s.self.boosts));
    if (bits.length) out.push(`${s.chance}% ${bits.join('·')}`);
  }
  if (m.self && m.self.boosts) out.push('자신 ' + boostText(m.self.boosts));
  if (m.boosts && m.category === 'Status') out.push((m.target === 'self' ? '자신 ' : '상대 ') + boostText(m.boosts));
  if (m.heal) out.push(`체력 ${Math.round(100 * m.heal[0] / m.heal[1])}% 회복`);
  if (m.sideCondition && SIDE[m.sideCondition.toLowerCase()]) out.push(SIDE[m.sideCondition.toLowerCase()]);
  if (m.weather && WEATHER[m.weather]) out.push(`날씨: ${WEATHER[m.weather]}`);
  if (m.terrain) out.push('필드 전개');
  if (m.pseudoWeather === 'Trick Room') out.push('트릭룸');
  if (m.stallingMove) out.push('공격을 막는다');
  if (m.forceSwitch) out.push('상대를 교체시킨다');
  if (m.id === 'substitute') out.push('대타 생성');
  if (m.id === 'leechseed') out.push('씨뿌리기');
  return out.join(' · ');
}
export const moveKo = id => koName('move', id);
