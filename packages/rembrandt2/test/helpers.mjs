// 테스트 공용: 무작위(그러나 합법인) 팀 만들기와 자동 진행
import { createDex } from '../src/index.js';

export const D = createDex();
export function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];

/** 합법인 무작위 세트 3개. 메가스톤을 들 확률을 높여 메가진화도 자주 나오게 한다 */
export function randomTeam(r, opts = {}) {
  const roster = D.roster(), used = new Set(), sets = [];
  while (sets.length < 3) {
    const sp = pick(r, roster); const base = sp.name.split('-')[0];
    if (used.has(base)) continue;
    const can = [...D.learnable(sp.id)]; if (can.length < 4) continue;
    const moves = new Set(); while (moves.size < 4) moves.add(pick(r, can));
    const stones = D.megaStonesOf(sp.id);
    const item = stones.length && r() < (opts.megaRate ?? 0.6) ? pick(r, stones).item : pick(r, D.itemsFor(sp.id)).id;
    used.add(base);
    sets.push(D.makeSet({ species: sp.name, moves: [...moves], ability: pick(r, sp.abilities), item, nature: pick(r, ['Adamant', 'Modest', 'Jolly', 'Timid', 'Bold', 'Calm']), evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 } }));
  }
  return sets;
}
/** 각 쪽이 고를 수 있는 선택(메가진화를 자주) 중 무작위로 끝까지 진행. 교체가 막히면(숨은 특성) 다시 고른다 */
export function playRandom(match, r, hooks = {}) {
  const choose = () => [0, 1].map(s => { const c = match.choices(s); if (!c.length) return null; const megas = c.filter(x => x.mega); return megas.length && r() < 0.7 ? pick(r, megas) : pick(r, c); });
  for (let i = 0; i < 150 && !match.ended; i++) {
    match.submitWith(choose);
    if (hooks.afterTurn) hooks.afterTurn();
  }
}
