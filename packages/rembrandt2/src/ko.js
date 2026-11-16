/**
 * 한국어 이름과 조사. 이름표는 data/ko-names.js (tools/build-ko-names.mjs 가 생성).
 * 이름표에 없으면 영문 이름을 그대로 쓰고(화면이 비지 않게), `missing()` 으로 어떤 것이 빠졌는지 알 수 있다.
 */
import { KO } from '../data/ko-names.js';

export const toID = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const missed = new Map();     // kind → Set(영문 이름)

/** kind: 'species' | 'move' | 'ability' | 'item' | 'type' | 'nature' */
export function koName(kind, nameOrId) {
  const table = KO[{ species: 'species', move: 'moves', ability: 'abilities', item: 'items', type: 'types', nature: 'natures' }[kind]];
  const k = toID(nameOrId);
  const v = table && table[k];
  if (v) return v;
  if (!missed.has(kind)) missed.set(kind, new Set());
  missed.get(kind).add(String(nameOrId));
  return String(nameOrId);
}
/** 이름표에서 찾기만 한다(없어도 기록하지 않는다). 종류를 모를 때 여러 표를 훑어보는 용도 */
export function lookupName(kind, nameOrId) {
  const table = KO[{ species: 'species', move: 'moves', ability: 'abilities', item: 'items', type: 'types', nature: 'natures' }[kind]];
  return table && table[toID(nameOrId)];
}
/** 지금까지 이름표에 없어 영문으로 나간 것들 { kind: [이름…] } */
export function missing() { return Object.fromEntries([...missed].map(([k, v]) => [k, [...v]])); }
export function resetMissing() { missed.clear(); }

// ── 조사: 마지막 글자의 받침으로 고른다 ──
const hasBatchim = ch => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c <= 11171 ? c % 28 !== 0 : null; };
const lastHangul = s => { for (let i = s.length - 1; i >= 0; i--) { const b = hasBatchim(s[i]); if (b !== null) return { b, ch: s[i] }; if (/[0-9a-zA-Z]/.test(s[i])) return { b: /[013678lmnLMN]/.test(s[i]) , ch: s[i] }; } return { b: false, ch: '' }; };

/** josa('리자몽', '은/는') → '리자몽은', josa('피카츄','을/를') → '피카츄를', '으로/로' 는 ㄹ 받침을 '로' 로 처리 */
export function josa(word, pair) {
  if (!pair.includes('/')) return word + pair;          // '의', '에게' 처럼 받침에 따라 바뀌지 않는 조사
  const { b, ch } = lastHangul(String(word));
  const [withB, noB] = pair.split('/');
  if (pair === '으로/로') { const rieul = hasBatchim(ch) && (ch.charCodeAt(0) - 0xac00) % 28 === 8; return word + (b && !rieul ? '으로' : '로'); }
  return word + (b ? withB : noB);
}
