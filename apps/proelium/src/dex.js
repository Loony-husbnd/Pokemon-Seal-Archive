// 포켓몬·기술 데이터 도우미 (Rembrandt 의 전역 BATTLE_DATA 를 화면에서 쓰기 좋게 가공한다)
export const D = () => window.BATTLE_DATA;
export const E = () => window.BattleEngine;
export const PT = () => window.BattleParty;
export const LEARN = () => window.BATTLE_LEARN || {};

export const TYPE_HEX = ['', '#aab4c8', '#ff6a3d', '#7fb2ff', '#b45cff', '#d9a441', '#b8a266', '#9ccc2a', '#7a5cc7', '#7fb6c9',
  '#ff5a2a', '#2f8cff', '#35c759', '#ffd60a', '#ff4f9a', '#5ee7ff', '#5a4bff', '#7b6a66', '#ff8fd0'];
export const TYPE_GLYPH = ['', '⭐', '🥊', '🕊️', '☠️', '⛰️', '🪨', '🐛', '👻', '⚙️', '🔥', '💧', '🌿', '⚡', '🔮', '❄️', '🐉', '🌑', '✨'];
const lum = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
export const isLite = t => lum(TYPE_HEX[t]) > 0.62;
export const typeName = t => D().types[t - 1].k;
export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const typeChip = t => `<span class="chip${isLite(t) ? ' lite' : ''}" style="--c:${TYPE_HEX[t]}">${TYPE_GLYPH[t]} ${esc(typeName(t))}</span>`;

export const artUrl = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
/** 이미지 태그. 불러오지 못하면 main.js 의 전역 error 처리기가 도감번호 자리표시로 바꾼다 */
export const monImg = (id, cls) => `<img class="mon-img ${cls || ''}" src="${artUrl(id)}" alt="" loading="lazy" decoding="async" data-id="${id}">`;

// ───────── 이름 / 폼 ─────────
const FORM_KO = { mega: '메가', 'mega-x': '메가', 'mega-y': '메가', gmax: '거다이맥스', alola: '알로라', galar: '가라르', hisui: '히스이', paldea: '팔데아', primal: '원시',
  origin: '오리진', therian: '영물', incarnate: '화신', black: '블랙', white: '화이트', attack: '어택', defense: '디펜스', speed: '스피드', sunny: '선샤인', rainy: '레이니', snowy: '스노우',
  heat: '히트', wash: '워시', frost: '프로스트', fan: '스핀', mow: '컷', sandy: '샌드', trash: '쓰레기', zen: '달마', blade: '블레이드', school: '군집', unbound: '해방', complete: '퍼펙트',
  busted: '들킨', crowned: '검왕/방패왕', eternamax: '무한다이맥스', 'low-key': '로우', amped: '하이', female: '암컷', male: '수컷', small: '작은', large: '큰', super: '특대' };
export function formLabel(id) {
  const p = D().pokemon[id];
  if (id <= 1025) return p.k;
  const mega = /-mega(?:-([xyz]))?$/.exec(p.e);
  if (mega) return `메가${p.k}${mega[1] ? ' ' + mega[1].toUpperCase() : ''}`;
  const region = /-(alola|galar|hisui|paldea)(?:-|$)/.exec(p.e);
  if (region) return `${FORM_KO[region[1]]} ${p.k}`;
  const base = D().pokemon[p.sp];
  let suffix = base && p.e.startsWith(base.e + '-') ? p.e.slice(base.e.length + 1) : '';
  suffix = suffix.split('-').map(t => FORM_KO[t] || t).join(' ');
  return suffix ? `${p.k} (${suffix})` : p.k;
}

// ───────── 전체 목록 / 검색 ─────────
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = s => [...s].map(c => { const n = c.charCodeAt(0) - 0xAC00; return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c; }).join('');
let _all = null;
export function allMons() {
  if (_all) return _all;
  _all = Object.keys(D().pokemon).map(Number).map(id => {
    const p = D().pokemon[id], label = formLabel(id);
    return { id, p, label, dex: p.sp, isForm: id > 1025, types: p.t, bst: p.bst, leg: p.leg, hay: (label + ' ' + p.e + ' ' + p.sp).toLowerCase(), cho: chosung(label) };
  }).sort((a, b) => a.dex - b.dex || a.id - b.id);
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
export function moveInfo(id) {
  const m = D().moves[id];
  const cls = m.c === 'p' ? 'phys' : m.c === 'n' ? 'status' : 'spec';
  return { id: Number(id), name: m.k, type: m.t, cls, power: m.pw, acc: m.ac, pp: m.pp, pri: m.pr, fx: m.fx, desc: cls === 'status' ? E().describeEffect({ fx: m.fx }) : fxNote(m) };
}
function fxNote(m) {
  const f = m.fx, out = [];
  if (f.hits) out.push(`${f.hits[0]}~${f.hits[1]}회`);
  if (f.drain) out.push(`흡수 ${f.drain}%`);
  if (f.recoil) out.push(`반동 ${f.recoil}%`);
  if (f.ail) out.push(`${f.ail.chance}% ${{ par: '마비', brn: '화상', psn: '독', tox: '맹독', slp: '수면', frz: '얼음', cnf: '혼란' }[f.ail.kind]}`);
  if (f.flinch) out.push(`${f.flinch}% 풀죽음`);
  if (f.crit) out.push('급소 높음');
  if (m.pr > 0) out.push('선제공격');
  return out.join(' · ');
}
const _pool = new Map();
/** 이 포켓몬이 고를 수 있는 기술 전체 (배우는 공격기 + 대표 공격기 + 변화기) */
export function movePool(id) {
  if (_pool.has(id)) return _pool.get(id);
  const p = D().pokemon[id];
  const ids = new Set([...(LEARN()[id] || []), ...p.m, ...p.sm]);
  const list = [...ids].filter(i => D().moves[i]).map(moveInfo)
    .sort((a, b) => (a.cls === 'status') - (b.cls === 'status') || b.power - a.power || a.name.localeCompare(b.name, 'ko'));
  _pool.set(id, list);
  return list;
}
/** 추천 기술 4개 (같은 포켓몬이면 항상 같은 결과) / 무작위 4개 */
export function recommendMoves(id, seed) {
  const rng = E().mulberry32(seed === undefined ? id * 2654435761 : seed);
  return [...PT().create(D()).pickMoveset(id, rng)];
}
export const stat6 = id => D().pokemon[id].b;       // [HP, 공, 방, 특공, 특방, 스피드]
export const STAT_LABEL = ['HP', '공격', '방어', '특공', '특방', '스피드'];
export const isValidTeam = team => team.every(Boolean) && new Set(team.map(t => D().pokemon[t.id].sp)).size === team.length;
