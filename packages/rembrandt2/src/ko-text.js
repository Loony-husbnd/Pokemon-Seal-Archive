/**
 * 배틀 로그 한국어 문구 표. 변환기(events.js)가 쓴다.
 * 표에 없는 효과는 이름만 한국어로 바꿔 일반 문구로 나가고, 변환기가 '미변환'으로 기록한다.
 */
import { koName, lookupName, toID } from './ko.js';

export const STAT_KO = { atk: '공격', def: '방어', spa: '특수공격', spd: '특수방어', spe: '스피드', accuracy: '명중률', evasion: '회피율' };
export const STATUS_KO = { slp: '잠듦', par: '마비', brn: '화상', psn: '독', tox: '맹독', frz: '얼음' };

export const STATUS_START = { slp: '잠들어 버렸다!', par: '마비되어 기술이 나오기 어려워졌다!', brn: '화상을 입었다!', psn: '독에 걸렸다!', tox: '맹독에 걸렸다!', frz: '얼어붙었다!' };
export const STATUS_CURE = { slp: '잠에서 깼다!', par: '마비가 풀렸다!', brn: '화상이 나았다!', psn: '독이 사라졌다!', tox: '독이 사라졌다!', frz: '얼음이 녹았다!' };
export const CANT = { par: '몸이 저려서 움직일 수 없다!', slp: '깊이 잠들어 있다!', frz: '얼어붙어서 움직일 수 없다!', flinch: '풀이 죽어 움직일 수 없었다!', recharge: '반동으로 움직일 수 없다!', Attract: '헤롱헤롱해서 움직일 수 없다!', attract: '헤롱헤롱해서 움직일 수 없다!' };

export const WEATHER = {
  Snowscape: ['눈이 내리기 시작했다!', '눈이 내리고 있다!', '눈이 그쳤다!'], RainDance: ['비가 내리기 시작했다!', '비가 계속 내리고 있다!', '비가 그쳤다!'], Sandstorm: ['모래바람이 불기 시작했다!', '모래바람이 몰아치고 있다!', '모래바람이 가라앉았다!'],
  SunnyDay: ['햇살이 강해졌다!', '햇살이 강하다!', '햇살이 원래대로 돌아왔다!'], Hail: ['싸라기눈이 내리기 시작했다!', '싸라기눈이 내리고 있다!', '싸라기눈이 그쳤다!'],
  Snow: ['눈이 내리기 시작했다!', '눈이 내리고 있다!', '눈이 그쳤다!'], DesolateLand: ['햇살이 매우 강해졌다!', '햇살이 매우 강하다!', '햇살이 원래대로 돌아왔다!'],
  PrimordialSea: ['굉장한 비가 내리기 시작했다!', '굉장한 비가 내리고 있다!', '비가 그쳤다!'], DeltaStream: ['수상한 바람이 불기 시작했다!', '수상한 바람이 불고 있다!', '수상한 바람이 멈췄다!'],
};
export const WEATHER_KO = { Snowscape: '눈', RainDance: '비', Sandstorm: '모래바람', SunnyDay: '쾌청', Hail: '싸라기눈', Snow: '눈', DesolateLand: '끝의땅', PrimordialSea: '시초의바다', DeltaStream: '난기류' };

/** 필드·방·진영 효과 이름 (프로토콜 이름 → 한국어). 기술 이름이면 이름표에서 가져온다 */
const SIDE_COND = { 'Stealth Rock': '뾰족한바위', Spikes: '압정', 'Toxic Spikes': '독압정', 'Sticky Web': '끈적끈적네트', Reflect: '리플렉터', 'Light Screen': '빛의장막', 'Aurora Veil': '오로라베일', Tailwind: '순풍', Safeguard: '신비의부적', Mist: '흰안개', 'Lucky Chant': '행운의주문', 'G-Max Steelsurge': '거다이맥스' };
const SIDE_START = { 'Stealth Rock': '주변에 뾰족한 바위가 흩뿌려졌다!', Spikes: '발밑에 압정이 흩뿌려졌다!', 'Toxic Spikes': '발밑에 독압정이 흩뿌려졌다!', 'Sticky Web': '발밑에 끈적끈적한 그물이 펼쳐졌다!', Reflect: '리플렉터로 물리 공격에 강해졌다!', 'Light Screen': '빛의장막으로 특수 공격에 강해졌다!', 'Aurora Veil': '오로라베일로 공격에 강해졌다!', Tailwind: '순풍이 불기 시작했다!', Safeguard: '신비의부적으로 보호받기 시작했다!', Mist: '흰안개에 감싸였다!' };
const SIDE_END = { Reflect: '리플렉터의 효과가 끝났다!', 'Light Screen': '빛의장막의 효과가 끝났다!', 'Aurora Veil': '오로라베일의 효과가 끝났다!', Tailwind: '순풍이 멈췄다!', Safeguard: '신비의부적의 효과가 끝났다!', Mist: '흰안개가 사라졌다!', 'Stealth Rock': '뾰족한 바위가 사라졌다!', Spikes: '압정이 사라졌다!', 'Toxic Spikes': '독압정이 사라졌다!', 'Sticky Web': '끈적끈적한 그물이 사라졌다!' };
const FIELD_START = { 'Electric Terrain': '발밑에 전기가 흐르기 시작했다!', 'Grassy Terrain': '발밑에 풀이 무성해졌다!', 'Misty Terrain': '주변에 안개가 자욱해졌다!', 'Psychic Terrain': '발밑이 기묘해졌다!', 'Trick Room': '시공이 뒤틀렸다!', Gravity: '중력이 강해졌다!', 'Wonder Room': '방어와 특수방어가 뒤바뀌었다!', 'Magic Room': '도구의 효과가 사라졌다!', 'Mud Sport': '전기가 약해졌다!', 'Water Sport': '불꽃이 약해졌다!', 'Fairy Lock': '다음 턴 도망칠 수 없다!' };
const FIELD_END = { 'Electric Terrain': '전기가 사라졌다!', 'Grassy Terrain': '풀이 사라졌다!', 'Misty Terrain': '안개가 걷혔다!', 'Psychic Terrain': '기묘함이 사라졌다!', 'Trick Room': '뒤틀린 시공이 원래대로 돌아왔다!', Gravity: '중력이 원래대로 돌아왔다!', 'Wonder Room': '방어와 특수방어가 원래대로 돌아왔다!', 'Magic Room': '도구의 효과가 돌아왔다!' };
export const FIELD_KIND = { 'Electric Terrain': 'terrain', 'Grassy Terrain': 'terrain', 'Misty Terrain': 'terrain', 'Psychic Terrain': 'terrain' };

/** 포켓몬 한 마리에 걸리는 임시 상태: [시작 문구, 끝 문구]. {m} 은 포켓몬 이름(조사 포함은 변환기가 처리) */
export const VOLATILE = {
  confusion: ['혼란에 빠졌다!', '혼란이 풀렸다!'], Substitute: ['대타를 만들어 냈다!', '대타가 쓰러졌다!'], 'Leech Seed': ['씨앗이 심어졌다!', ''], Taunt: ['도발당했다!', '도발의 효과가 풀렸다!'],
  Encore: ['앙코르를 받았다!', '앙코르의 효과가 풀렸다!'], Torment: ['괴롭힘을 당하고 있다!', '괴롭힘이 풀렸다!'], Disable: ['기술을 봉인당했다!', '기술의 봉인이 풀렸다!'], Yawn: ['졸음이 몰려오고 있다!', ''],
  Flinch: ['', ''], 'Focus Energy': ['기합을 모았다!', ''], 'Aqua Ring': ['물의 베일에 감싸였다!', ''], Ingrain: ['땅에 뿌리를 내렸다!', ''], Attract: ['헤롱헤롱해졌다!', '헤롱헤롱이 풀렸다!'],
  Curse: ['저주를 받았다!', ''], Nightmare: ['악몽을 꾸기 시작했다!', ''], 'Perish Song': ['', ''], 'Heal Block': ['회복을 봉인당했다!', '회복봉인이 풀렸다!'], Embargo: ['도구를 쓸 수 없게 되었다!', '도구를 다시 쓸 수 있게 되었다!'],
  'Magnet Rise': ['전자기로 떠올랐다!', '전자기의 부양이 풀렸다!'], Telekinesis: ['공중에 떠올랐다!', '염동력에서 풀려났다!'], 'Smack Down': ['땅으로 떨어졌다!', ''], 'Salt Cure': ['소금에 절여졌다!', ''], 'Syrup Bomb': ['시럽에 뒤덮였다!', ''],
  'Octolock': ['문어조임에 붙잡혔다!', ''], 'Throat Chop': ['목을 맞아 소리 나는 기술을 쓸 수 없다!', '목이 나았다!'], protect: ['', ''], Protect: ['', ''],
  'Dynamax': ['', ''], 'typechange': ['', ''], 'perish0': ['', ''],
};
export const PROTECT = { Protect: '공격으로부터 몸을 지켰다!', Detect: '공격으로부터 몸을 지켰다!', 'King\'s Shield': '공격으로부터 몸을 지켰다!', 'Spiky Shield': '공격으로부터 몸을 지켰다!', 'Baneful Bunker': '공격으로부터 몸을 지켰다!', Endure: '공격을 버텨냈다!', 'Wide Guard': '전체 공격으로부터 몸을 지켰다!', 'Quick Guard': '선제 공격으로부터 몸을 지켰다!', 'Mat Block': '공격으로부터 몸을 지켰다!', 'Obstruct': '공격으로부터 몸을 지켰다!', 'Silk Trap': '공격으로부터 몸을 지켰다!', 'Burning Bulwark': '공격으로부터 몸을 지켰다!' };

/** 프로토콜의 효과 이름 → 한국어. 'ability: X' / 'item: X' / 'move: X' 형태와 맨 이름 둘 다 받는다 */
/** 프로토콜이 기술·특성·도구가 아닌 내부 이름으로 보내는 효과 */
const INTERNAL = { recoil: '반동', drain: '흡수', trapped: '붙잡힘', stockpile1: '비축', stockpile2: '비축', stockpile3: '비축', Snowscape: '설경', snowscape: '설경', partiallytrapped: '조이기', psn: '독', tox: '맹독', brn: '화상', slp: '수면', par: '마비', frz: '얼음', confusion: '혼란', Sandstorm: '모래바람', Hail: '싸라기눈', Weather: '날씨' };
export function effectKo(raw) {
  const s = String(raw || '').trim();
  let m = /^(ability|item|move): (.*)$/.exec(s);
  if (m) return koName(m[1], m[2]);
  if (SIDE_COND[s]) return SIDE_COND[s];
  if (WEATHER_KO[s]) return WEATHER_KO[s];
  if (STATUS_KO[s]) return STATUS_KO[s];
  if (s === 'confusion') return '혼란';
  if (INTERNAL[s] || INTERNAL[toID(s)]) return INTERNAL[s] || INTERNAL[toID(s)];
  // 이름만 온 경우: 기술 → 특성 → 도구 순으로 찾는다 (없으면 영문 그대로)
  for (const kind of ['move', 'ability', 'item']) { const v = lookupName(kind, s); if (v) return v; }
  return s;
}
export const sideStart = n => SIDE_START[n], sideEnd = n => SIDE_END[n], fieldStart = n => FIELD_START[n], fieldEnd = n => FIELD_END[n];
export const hasKo = (kind, name) => { const v = koName(kind, name); return v !== name; };
export { toID };
