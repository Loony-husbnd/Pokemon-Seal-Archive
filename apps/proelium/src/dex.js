// 포켓몬·기술 데이터 도우미 — Rembrandt 2(packages/rembrandt2)를 화면에서 쓰기 좋게 가공한다.
// 엔진은 크기가 커서(약 1MB gzip) 처음 화면을 그린 뒤 불러온다: main.js 가 loadEngine() 을 기다린 다음 화면을 연다.
let R = null, DX = null;
export async function loadEngine() {
  if (!R) { R = await import('rembrandt2'); DX = R.createDex(); }
  return R;
}
export const R2 = () => R;
export const DEX = () => DX;

// ───────── 타입 (화면은 1~18 번호로 색·글리프를 찾는다) ─────────
export const TYPE_NAMES = ['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy'];
export const typeId = name => TYPE_NAMES.indexOf(name) + 1;
export const TYPE_HEX = ['', '#aab4c8', '#ff6a3d', '#7fb2ff', '#b45cff', '#d9a441', '#b8a266', '#9ccc2a', '#7a5cc7', '#7fb6c9',
  '#ff5a2a', '#2f8cff', '#35c759', '#ffd60a', '#ff4f9a', '#5ee7ff', '#5a4bff', '#7b6a66', '#ff8fd0'];
export const TYPE_GLYPH = ['', '⭐', '🥊', '🕊️', '☠️', '⛰️', '🪨', '🐛', '👻', '⚙️', '🔥', '💧', '🌿', '⚡', '🔮', '❄️', '🐉', '🌑', '✨'];
const lum = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
export const isLite = t => lum(TYPE_HEX[t]) > 0.62;
export const typeName = t => R.koName('type', TYPE_NAMES[t - 1]);
export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const typeChip = t => `<span class="chip${isLite(t) ? ' lite' : ''}" style="--c:${TYPE_HEX[t]}">${TYPE_GLYPH[t]} ${esc(typeName(t))}</span>`;

// ───────── 포켓몬 ─────────
export const row = id => DX.get(id);
/** 타입 번호들. 메가·젠 모드처럼 로스터에 없는 폼도 엔진에서 읽는다 (모르면 노말) */
export const monTypes = id => { const r = row(id); const t = r ? r.types : R.speciesTypes(id); return (t.length ? t : ['Normal']).map(typeId); };
export const formLabel = id => (row(id) ? row(id).ko : R.koName('species', id));
export const stat6 = id => { const b = row(id).baseStats; return [b.hp, b.atk, b.def, b.spa, b.spd, b.spe]; };
export const STAT_LABEL = ['HP', '공격', '방어', '특공', '특방', '스피드'];

/** 그림 번호: 폼은 PokeAPI 포켓몬 번호(ART), 기본형은 도감번호. 모르면 도감번호 */
export const artId = id => { const r = row(id); const key = typeof id === 'string' ? id.toLowerCase().replace(/[^a-z0-9]/g, '') : id; return (R.ART && R.ART[key]) || (r ? r.num : 0); };
export const artUrl = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${artId(id)}.png`;
/** 이미지 태그. 불러오지 못하면 main.js 의 전역 error 처리기가 도감번호 자리표시로 바꾼다 */
export const monImg = (id, cls) => `<img class="mon-img ${cls || ''}" src="${artUrl(id)}" alt="" loading="lazy" decoding="async" data-id="${esc(id)}">`;

// ───────── 전체 목록 / 검색 ─────────
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = s => [...s].map(c => { const n = c.charCodeAt(0) - 0xAC00; return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c; }).join('');
let _all = null;
export function allMons() {
  if (_all) return _all;
  _all = DX.roster().map(r => ({ id: r.id, row: r, label: r.ko, dex: r.num, isForm: !!r.forme, types: r.types.map(typeId), bst: r.bst, leg: r.legendary, hay: `${r.ko} ${r.name} ${r.id} ${r.num}`.toLowerCase(), cho: chosung(r.ko) }));
  return _all;
}
export function searchMons({ q = '', type = 0, kind = 'all', sort = 'dex' }) {
  q = q.trim().toLowerCase();
  const isCho = q && [...q].every(c => CHO.includes(c));
  let list = allMons().filter(m => {
    if (type && !m.types.includes(type)) return false;
    if (kind === 'base' && m.isForm) return false;
    if (kind === 'form' && !m.isForm) return false;
    if (kind === 'legend' && !m.leg) return false;
    if (q) return isCho ? m.cho.includes(q) : m.hay.includes(q);
    return true;
  });
  if (sort === 'bst') list = list.slice().sort((a, b) => b.bst - a.bst || a.dex - b.dex);
  else if (sort === 'name') list = list.slice().sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  return list;
}

// ───────── 기술 ─────────
const CLS = { Physical: 'phys', Special: 'spec', Status: 'status' };
const _mv = new Map();
export function moveInfo(id, fallbackName) {
  if (_mv.has(id)) return _mv.get(id);
  const m = DX.moveInfo(id);
  if (!m) return { id, name: fallbackName || id, type: 1, cls: 'status', power: 0, varPower: false, acc: null, pp: null, pri: 0, desc: '' };      // 모르는 기술도 화면이 죽지 않게
  const cls = CLS[m.category];
  const info = { id: m.id, name: m.ko, type: typeId(m.type), cls, power: m.power, varPower: cls !== 'status' && !m.power, acc: m.accuracy, pp: m.pp, pri: m.priority, desc: m.pseudo ? '이번 턴은 움직일 수 없어요' : R.describeMove(m.id), pseudo: !!m.pseudo };
  _mv.set(id, info); return info;
}
const _pool = new Map();
/** 이 포켓몬이 고를 수 있는 기술 전체 */
export function movePool(id) {
  if (_pool.has(id)) return _pool.get(id);
  const r = row(id), ids = new Set(DX.learnable(id)); if (r && r.fixedMove) ids.add(R.toID(r.fixedMove));
  const list = [...ids].map(moveInfo).sort((a, b) => (a.cls === 'status') - (b.cls === 'status') || b.power - a.power || a.name.localeCompare(b.name, 'ko'));
  _pool.set(id, list);
  return list;
}

// ───────── 세트 (기술 · 특성 · 도구) ─────────
/** 이 포켓몬에게 어울리는 기본 세트. seed 를 주면 같은 결과, variety 를 올리면 다양하게 */
export function defaultSet(id, seed, variety = 0) {
  const set = R.bestSet(DX, id, { rng: seed === undefined ? Math.random : R.mulberry(seed), variety });
  return { id, moves: set.moves.map(R.toID), ability: set.ability, item: set.item };
}
export const recommendMoves = (id, seed) => defaultSet(id, seed === undefined ? 1 : seed, seed === undefined ? 0 : 1).moves;
export const abilityKo = name => R.koName('ability', name);
export const itemKo = name => (name ? R.koName('item', name) : '없음');
export const abilityList = id => row(id).abilitySlots.map(a => ({ name: a.name, ko: abilityKo(a.name), hidden: a.slot === 'H' }));

/** 저장된 팀 항목 → Showdown 셋 */
export const toSet = t => DX.makeSet({ species: row(t.id).name, moves: t.moves, ability: t.ability, item: t.item });
export const toSets = team => team.map(toSet);
/** 셋 → 팀 항목 (종 id 는 셋의 종 이름에서) */
export const fromSet = s => ({ id: R.toID(s.species), moves: s.moves.map(R.toID), ability: s.ability, item: s.item });
export function validateTeam(team) { return team.every(Boolean) ? DX.validateTeam(toSets(team)) : { ok: false, errors: ['포켓몬을 모두 골라 주세요'] }; }
export const isValidTeam = team => validateTeam(team).ok;
export const megaOf = t => { const it = t.item && R.toID(t.item); return DX.megaStonesOf(t.id).find(s => s.item === it) || null; };
