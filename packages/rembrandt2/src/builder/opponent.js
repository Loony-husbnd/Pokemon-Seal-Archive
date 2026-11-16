/**
 * 상대 팀 생성.
 *   쉬움·보통·어려움: 내 파티 종족값 합계에 난이도 보정을 더한 목표에 맞춰 무작위로 뽑고, 각자 쓸 만한 세트를 짠다.
 *   지옥: 내 팀(팀 미리보기로 공개되는 종)을 겨냥해 가장 잘 이기는 3마리와 세트를 시뮬레이션으로 고른다.
 * 지옥도 반칙은 없다: 내 팀의 숨은 정보(기술·특성·도구)는 AI 와 같은 추정(belief)으로만 쓴다.
 */
import { bestSet, teamBst } from './sets.js';
import { createAI } from '../ai/index.js';
import { createMatch } from '../match.js';
import { dex } from '../ai/calc.js';
import { sampleGuess } from '../ai/belief.js';
import { matchup } from '../ai/policy.js';
import { toID } from '../ko.js';

export const OFFSET = { easy: -120, normal: 0, hard: 90 };           // 내 파티 종족값 합계 대비 목표 보정
const LEGEND_FROM = 2000;                                              // 목표가 이보다 높으면 전설·환상도 나올 수 있다
const baseOf = D => id => dex.species.get(id).baseSpecies ? toID(dex.species.get(id).baseSpecies) : id;

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export { mulberry };

/** 무작위 합법 팀 (3마리) — 'powerAround' 를 주면 그 합계 근처로 맞춘다 */
export function pickSpecies(D, { rng, target, allowLegend = true, exclude = new Set() }) {
  const base = baseOf(D);
  const pool = D.roster().filter(r => (allowLegend || !r.legendary) && !exclude.has(base(r.id)));
  const sorted = pool.slice().sort((a, b) => a.bst - b.bst);
  const valid = ids => new Set(ids.map(base)).size === 3 && new Set(ids.map(id => D.get(id).types[0])).size >= 2;
  if (target == null) { for (let t = 0; t < 200; t++) { const ids = [0, 0, 0].map(() => sorted[Math.floor(rng() * sorted.length)].id); if (valid(ids)) return ids; } }
  const avg = target / 3;
  for (const w of [150, 260, 420, 700]) {
    const win = sorted.filter(r => Math.abs(r.bst - avg) <= w); if (win.length < 12) continue;
    for (const tol of [30, 60, 110, 190]) for (let t = 0; t < 1200; t++) {
      const ids = [0, 0, 0].map(() => win[Math.floor(rng() * win.length)].id);
      if (valid(ids) && Math.abs(teamBst(D, ids) - target) <= tol) return ids;
    }
  }
  const top = sorted.slice(-60); let best = null, bd = Infinity;
  for (let t = 0; t < 6000; t++) { const ids = [0, 0, 0].map(() => top[Math.floor(rng() * top.length)].id); if (!valid(ids)) continue; const d = Math.abs(teamBst(D, ids) - (target ?? 1800)); if (d < bd) { bd = d; best = ids; } }
  return best;
}

/** 내가 직접 짜지 않은 자리를 채우는 데도 쓴다: 합법인 3마리 세트 */
export function randomTeam(D, rng = Math.random, o = {}) {
  const ids = pickSpecies(D, { rng, target: o.target, allowLegend: o.allowLegend ?? false });
  return ids.map(id => bestSet(D, id, { rng, variety: 1 }));
}

/** 쉬움·보통·어려움 상대 */
export function generateOpponent(D, { level, playerIds, rng = Math.random }) {
  const off = OFFSET[level];
  if (off === undefined) throw new Error(`알 수 없는 난이도: ${level}`);
  const total = teamBst(D, playerIds), target = Math.max(750, total + off);
  const allowLegend = playerIds.some(id => D.get(id) && D.get(id).legendary) || target > LEGEND_FROM;
  const ids = pickSpecies(D, { rng, target, allowLegend });
  return ids.map(id => bestSet(D, id, { rng, variety: level === 'easy' ? 1 : 0 }));
}

// ───────── 지옥: 정적 상성으로 추리고, 시뮬레이션으로 고르기 ─────────
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tick = () => (typeof setTimeout === 'function' ? new Promise(r => setTimeout(r, 0)) : Promise.resolve());

/** 진화 계열의 뿌리 (같은 계열 두 마리를 한 팀에 넣지 않는다) */
export function familyOf(id) { let sp = dex.species.get(id); const seen = new Set(); while (sp.prevo && !seen.has(sp.id)) { seen.add(sp.id); sp = dex.species.get(sp.prevo); } return toID(sp.baseSpecies && sp.forme ? sp.baseSpecies : sp.name); }

/** 능력치 계산 (Lv.100 기준 일반식, 성격 보정 없음) */
const calcStat = (k, base, iv, ev) => (k === 'hp' ? Math.floor((2 * base + iv + Math.floor(ev / 4)) * 100 / 100) + 100 + 10 : Math.floor((2 * base + iv + Math.floor(ev / 4)) * 100 / 100) + 5);

/** 세트 → 맞대결 계산용 간이 포켓몬 (calc.js 가 읽는 모양) */
export function fakeMon(set) {
  const sp = dex.species.get(set.species), st = {};
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) st[k] = calcStat(k, sp.baseStats[k], 31, (set.evs && set.evs[k]) || 0);
  let types = sp.types.slice(), ability = toID(set.ability), item = toID(set.item);
  const stone = item && dex.items.get(item).megaStone;
  if (stone) { const mega = dex.species.get(Object.values(stone)[0]); for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) st[k] = calcStat(k, mega.baseStats[k], 31, 0); types = mega.types.slice(); ability = toID(Object.values(mega.abilities)[0]); }
  return { species: sp, types, storedStats: st, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }, status: '', ability, item: stone ? '' : item, hp: st.hp, maxhp: st.hp, level: 100,
    moveSlots: set.moves.map(id => ({ id: toID(id) })), volatiles: {}, set };
}
const matchScore = (a, b) => matchup(a, b, {}, null, null);

/** 한 팀이 상대 3마리를 얼마나 잘 상대하는가: 상대마다 우리 팀에서 가장 좋은 맞대결 값의 평균(+ 약점이 겹치지 않는 보너스) */
function comboScore(team, foes) {
  let sum = 0;
  for (const f of foes) { const vals = team.map(t => matchScore(t, f)); sum += Math.max(...vals) + 0.25 * vals.sort((x, y) => y - x)[1]; }
  return sum / foes.length;
}

/** 두 팀을 어려움 AI 끼리 붙여 A 가 이기면 높은 값 (0~1: 이기면 0.75~1, 지면 0~0.25, 체력 보너스) */
function duel(D, teamA, teamB, seed) {
  const m = createMatch({ teams: [teamA, teamB], seed: [seed, 7, 11, 13] });
  const ais = [createAI({ dex: D, seed }), createAI({ dex: D, seed: seed + 5 })], pl = [m.player(0), m.player(1)];
  let t = 0;
  try { while (!m.ended && t++ < 60) m.submitWith(() => [0, 1].map(s => ais[s].choose(pl[s], 'hard').choice)); } catch (e) { return 0.5; }
  const left = s => m.battle.sides[s].pokemon.reduce((a, p) => a + (p.fainted ? 0 : p.hp / p.maxhp), 0);
  if (!m.ended) return 0.5 + 0.1 * (left(0) - left(1)) / 3;
  if (m.winner === 0) return 0.75 + 0.25 * Math.min(1, left(0) / 3);
  if (m.winner === 1) return 0.25 * (1 - Math.min(1, left(1) / 3));
  return 0.5;
}

/**
 * 지옥 상대. 내 팀의 종만 알고(숨은 정보는 AI 와 같은 추정), 전체 포켓몬에서 가장 잘 이기는 3마리와 세트를 고른다.
 *   1) 후보 세트를 만들어 내 팀과의 정적 상성으로 점수화 → 2) 상위 후보의 3마리 조합을 정적 점수로 추림
 *   → 3) 상위 조합을 3대3 시뮬레이션으로 겨루고(남는 예산만큼 더 돌려) 가장 잘 이기는 조합 선택 → 4) 선봉 3가지를 겨뤄 출전 순서 결정
 * @param o { playerIds, rng, budgetMs, onProgress(0~1, 메시지), stats }
 */
export async function buildHell(D, o) {
  const rng = o.rng || Math.random, budget = o.budgetMs ?? 6000, t0 = nowMs(), stats = o.stats || {};
  stats.sims = 0;
  const progress = (p, msg) => { if (o.onProgress) o.onProgress(Math.min(1, p), msg); };
  const timeLeft = () => budget - (nowMs() - t0);

  // 내 팀 추정: 종은 공개, 기술·특성·도구는 AI 와 같은 추정
  const obsLike = { entries: o.playerIds.map(id => { const sp = dex.species.get(id); return { key: sp.baseSpecies || sp.name, species: sp.name, form: sp.name, moves: new Set(), ability: null, item: undefined, itemGone: false, mega: null, renamed: false }; }) };
  const mineGuess = Object.values(sampleGuess(obsLike, D, rng, 0));
  const mineSets = () => mineGuess.map(x => Object.assign({}, x));
  const foes = mineGuess.map(fakeMon);
  const mineFam = new Set(o.playerIds.map(familyOf));

  // 1) 후보: 종족값 상위 + 탐험. 세트(메가 있음/없음)를 만들고 정적 상성으로 점수화
  progress(0.02, '후보 고르는 중');
  const roster = D.roster().filter(r => !mineFam.has(familyOf(r.id)));
  const byBst = roster.slice().sort((a, b) => b.bst - a.bst);
  const poolRows = new Map(byBst.slice(0, 150).map(r => [r.id, r]));
  for (let i = 0; i < 50; i++) { const r = roster[Math.floor(rng() * roster.length)]; poolRows.set(r.id, r); }
  const cands = [];
  for (const row of poolRows.values()) {
    const variants = [bestSet(D, row.id, { rng, variety: 0 })];
    if (D.megaStonesOf(row.id).length) variants.push(bestSet(D, row.id, { rng, variety: 0, mega: false }));
    for (const set of variants) { const fm = fakeMon(set); const st = foes.reduce((a, f) => a + matchScore(fm, f), 0) / foes.length; cands.push({ id: row.id, fam: familyOf(row.id), set, score: st + (row.bst - 500) / 700 }); }
  }
  cands.sort((a, b) => b.score - a.score);
  const top = []; const seen = new Set();
  for (const c of cands) { if (seen.has(c.fam)) continue; seen.add(c.fam); top.push(c); if (top.length >= 9) break; }
  await tick();

  // 2) 조합: 정적 점수로 추리기
  progress(0.15, '조합 고르는 중');
  const combos = [];
  for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) for (let c = b + 1; c < top.length; c++) {
    const team = [top[a], top[b], top[c]]; combos.push({ team, s: comboScore(team.map(t => fakeMon(t.set)), foes) + 0.25 * (team.reduce((x, t) => x + t.score, 0) / 3) });
  }
  combos.sort((a, b) => b.s - a.s);
  const finalists = combos.slice(0, 8);

  // 3) 시뮬레이션: 모든 후보를 한 번씩, 남는 예산은 상위 조합에 더 쓴다
  let round = 0;
  const reserve = Math.min(1200, budget * 0.2);                    // 선봉 비교용으로 남겨 둔다
  for (const f of finalists) { f.sum = 0; f.n = 0; }
  while (round < 12 && (round === 0 || timeLeft() > reserve + 150)) {
    const list = round === 0 ? finalists : finalists.slice().sort((a, b) => b.sum / b.n - a.sum / a.n).slice(0, Math.max(2, 6 - round));
    for (const f of list) {
      if (round > 0 && timeLeft() < reserve + 100) break;
      f.sum += duel(D, f.team.map(t => t.set), mineSets(), 100 + round * 31 + Math.floor(Math.abs(f.s) * 100) % 29); f.n++; stats.sims++;
    }
    round++;
    progress(0.2 + 0.6 * Math.min(1, round / 6), '조합을 겨루는 중'); await tick();
  }
  finalists.sort((a, b) => b.sum / b.n - a.sum / a.n);
  const best = finalists[0];

  // 4) 출전 순서: 선봉 3가지를 겨룬다
  let ordered = best.team.map(t => t.set);
  if (timeLeft() > 200) {
    let bo = null;
    for (let lead = 0; lead < 3 && (lead === 0 || timeLeft() > 100); lead++) {
      const order = [lead, ...[0, 1, 2].filter(i => i !== lead)].map(i => best.team[i].set);
      const sc = duel(D, order, mineSets(), 1500 + lead) + duel(D, order, mineSets(), 1600 + lead); stats.sims += 2;
      if (!bo || sc > bo.score) bo = { score: sc, order };
    }
    ordered = bo.order;
  }
  progress(1, '완료');
  return ordered;
}
