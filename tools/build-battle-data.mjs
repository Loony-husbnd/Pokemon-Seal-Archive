#!/usr/bin/env node
/**
 * 배틀용 데이터 생성 스크립트 (1단계)
 *
 *   node tools/build-battle-data.mjs            # packages/rembrandt/data/battle-data.js 생성
 *   node tools/build-battle-data.mjs --sample   # 대표 포켓몬 검수 표 출력
 *   node tools/build-battle-data.mjs --show 6,25,150   # 지정한 도감번호/폼 ID 출력
 *
 * 입력 : PokeAPI CSV (종족값·타입·기술·습득 기술) + Showdown 랜덤배틀 세트(기술 선정 가중치)
 * 출력 : packages/rembrandt/data/battle-data.js  (window.BATTLE_DATA 로 로드, file:// 에서도 동작)
 *
 * 규칙
 *  - 능력치: Lv100, 개체값 31, 노력치 0, 성격 보정 없음
 *      HP = 2*종족값 + 31 + 110,  그 외 = 2*종족값 + 31 + 5   (껍질몬 HP = 1)
 *  - 기술 : 공격기만, 최대 4개. 자속(STAB) 고위력 + 시그니처 + 커버(상성 범위)로 자동 선정.
 *           변화기/2턴기/반동 턴/자폭/조건부 위력 등 엔진 1차 범위 밖의 기술은 제외한다.
 *
 * 기술 효과(fx) 스키마
 *   hits     [min, max]              다단 히트
 *   crit     1 = 급소 단계 +1, 2 = 반드시 급소
 *   flinch   %                       풀죽음 확률
 *   ail      { kind, chance }        kind: par slp frz brn psn tox cnf
 *   drain    %                       준 데미지 대비 회복
 *   recoil   %                       준 데미지 대비 반동
 *   tgt/self [{ stat, change, chance }]  stat: atk def spa spd spe acc eva
 *   neverMiss true                   필중
 *   useDef   true                    특수기인데 상대의 방어로 계산 (사이코쇼크 등)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
const OUT = path.join(ROOT, 'packages', 'rembrandt', 'data', 'battle-data.js');
const CSV_BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const SETS_URL = 'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/random-battles/gen9/sets.json';
const CSV_FILES = [
  'pokemon', 'pokemon_species', 'pokemon_species_names', 'pokemon_stats', 'pokemon_types',
  'pokemon_moves', 'moves', 'move_names', 'move_meta', 'move_meta_stat_changes', 'type_names',
];

// ───────────────────────── 다운로드 / CSV ─────────────────────────
async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    // 프록시 환경 등에서 fetch 가 막히면 curl 로 재시도
    const r = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', dest, url]);
    if (r.status !== 0) throw new Error(`다운로드 실패: ${url} (${err.message})`);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const num = v => (v === '' || v === undefined || v === null ? null : Number(v));

// ───────────────────────── 상수 ─────────────────────────
const TYPE_IDENT = ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy']; // PokeAPI type_id 1~18
const STAT_KEY = { 1: 'hp', 2: 'atk', 3: 'def', 4: 'spa', 5: 'spd', 6: 'spe', 7: 'acc', 8: 'eva' };
const AILMENT = { 1: 'par', 2: 'slp', 3: 'frz', 4: 'brn', 5: 'psn', 6: 'cnf' };

// 상성표: 공격 타입 → { 2배, 0.5배, 0배 }  (Gen 6+)
const CHART_SRC = {
  normal:   { se: [], nve: ['rock', 'steel'], im: ['ghost'] },
  fighting: { se: ['normal', 'rock', 'steel', 'ice', 'dark'], nve: ['flying', 'poison', 'bug', 'psychic', 'fairy'], im: ['ghost'] },
  flying:   { se: ['fighting', 'bug', 'grass'], nve: ['rock', 'steel', 'electric'], im: [] },
  poison:   { se: ['grass', 'fairy'], nve: ['poison', 'ground', 'rock', 'ghost'], im: ['steel'] },
  ground:   { se: ['poison', 'rock', 'steel', 'fire', 'electric'], nve: ['bug', 'grass'], im: ['flying'] },
  rock:     { se: ['flying', 'bug', 'fire', 'ice'], nve: ['fighting', 'ground', 'steel'], im: [] },
  bug:      { se: ['grass', 'psychic', 'dark'], nve: ['fighting', 'flying', 'poison', 'ghost', 'steel', 'fire', 'fairy'], im: [] },
  ghost:    { se: ['ghost', 'psychic'], nve: ['dark'], im: ['normal'] },
  steel:    { se: ['rock', 'ice', 'fairy'], nve: ['steel', 'fire', 'water', 'electric'], im: [] },
  fire:     { se: ['bug', 'steel', 'grass', 'ice'], nve: ['rock', 'fire', 'water', 'dragon'], im: [] },
  water:    { se: ['ground', 'rock', 'fire'], nve: ['water', 'grass', 'dragon'], im: [] },
  grass:    { se: ['ground', 'rock', 'water'], nve: ['flying', 'poison', 'bug', 'steel', 'fire', 'grass', 'dragon'], im: [] },
  electric: { se: ['flying', 'water'], nve: ['grass', 'electric', 'dragon'], im: ['ground'] },
  psychic:  { se: ['fighting', 'poison'], nve: ['steel', 'psychic'], im: ['dark'] },
  ice:      { se: ['flying', 'ground', 'grass', 'dragon'], nve: ['steel', 'fire', 'water', 'ice'], im: [] },
  dragon:   { se: ['dragon'], nve: ['steel'], im: ['fairy'] },
  dark:     { se: ['ghost', 'psychic'], nve: ['fighting', 'dark', 'fairy'], im: [] },
  fairy:    { se: ['fighting', 'dragon', 'dark'], nve: ['poison', 'steel', 'fire'], im: [] },
};
const CHART = TYPE_IDENT.map(atk => TYPE_IDENT.map(def => {
  const c = CHART_SRC[atk];
  return c.im.includes(def) ? 0 : c.se.includes(def) ? 2 : c.nve.includes(def) ? 0.5 : 1;
}));

// 엔진 1차 범위에서 지원하는 기술 효과(effect_id) 화이트리스트
const SUPPORTED_EFFECTS = new Set([
  1, 104, 379, 406, 150, 258, 148, 208, 411, 18, 79, 381, 224, 189, 106, 187, 130, 288, 304, 393, 290, 342, // 단순 데미지 계열
  269,                  // 심판의뭉치/멀티어택/테크노버스터 (타입 변화 없이 기본 속성으로 취급)
  44, 289,              // 급소
  30, 45, 361, 78,      // 다단 히트
  32, 151, 147,         // 풀죽음
  5, 126, 201, 7, 153, 372, 6, 261, 3, 203, 210, 77, 334, // 상태이상 확률
  4, 349, 346,          // 흡수
  49, 199, 270, 254, 263, // 반동
  73, 71, 74, 70, 72, 69, 396, 397, 331, 21, 297, 358, 469, 470, 272, // 상대 능력 변화
  205, 219, 230, 183, 335, 405, 375, 140, 277, 139, 141, 296,        // 자신 능력 변화
  283,                  // 사이코쇼크류 (상대 방어로 계산)
]);
const NEVER_MISS_EFFECTS = new Set([18, 79, 381, 224]);

// ───────────────────────── 기술 정규화 ─────────────────────────
function buildMoves(raw, overrides) {
  const moves = new Map();
  for (const m of raw.moves) {
    const id = Number(m.id);
    if (id >= 10000 || id === 165) continue;              // 폼 전용/발버둥 제외
    const power = num(m.power), pp = num(m.pp);
    if (!power || power < 10 || !pp || pp <= 1) continue;   // 변화기·가변위력·Z기술 제외
    if (!['2', '3'].includes(m.damage_class_id)) continue;

    const meta = raw.meta.get(id) || {};
    const effectId = num(m.effect_id);
    const fx = {};
    let supported = false;

    if (effectId !== null && SUPPORTED_EFFECTS.has(effectId)) {
      supported = true;
      const hits = [num(meta.min_hits), num(meta.max_hits)];
      if (hits[0] && hits[1]) fx.hits = hits;
      const critRate = num(meta.crit_rate) || 0;
      if (effectId === 289) fx.crit = 2; else if (critRate > 0) fx.crit = 1;
      if (num(meta.flinch_chance) > 0) fx.flinch = num(meta.flinch_chance);
      const ailKind = AILMENT[num(meta.meta_ailment_id)];
      if (ailKind) {
        fx.ail = { kind: effectId === 203 ? 'tox' : ailKind, chance: num(meta.ailment_chance) || 100 };
      }
      const drain = num(meta.drain) || 0;
      if (drain > 0) fx.drain = drain; else if (drain < 0) fx.recoil = -drain;
      const changes = raw.statChanges.get(id) || [];
      if (changes.length) {
        // damage-lower(6) = 상대 능력, damage-raise(7) = 자신 능력(음수 포함)
        const side = num(meta.meta_category_id) === 6 ? 'tgt' : 'self';
        fx[side] = changes.map(c => ({ stat: STAT_KEY[c.stat], change: c.change, chance: num(meta.stat_chance) || 100 }));
      }
      if (NEVER_MISS_EFFECTS.has(effectId) || m.accuracy === '') fx.neverMiss = true;
      if (effectId === 283) fx.useDef = true;
    } else if (overrides[m.identifier]) {
      supported = true;
      Object.assign(fx, structuredClone(overrides[m.identifier].fx));
      if (m.accuracy === '') fx.neverMiss = true;
    }
    if (!supported) continue;

    moves.set(id, {
      id,
      e: m.identifier,
      type: num(m.type_id),
      cls: num(m.damage_class_id) === 2 ? 'phys' : 'spec',
      power,
      acc: num(m.accuracy) || null,   // null = 필중 (CSV 에서 비어 있거나 0)
      pp,
      pri: num(m.priority) || 0,
      fx,
    });
  }
  return moves;
}

// ───────────────────────── 점수 / 선정 ─────────────────────────
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

function movePotential(p, mv, ctx) {
  const fx = mv.fx;
  const hits = fx.hits ? (fx.hits[0] === 2 && fx.hits[1] === 5 ? 3.1 : (fx.hits[0] + fx.hits[1]) / 2) : 1;
  const acc = fx.neverMiss || mv.acc === null ? 1 : mv.acc / 100;
  let mult = 1;
  if (fx.recoil) mult *= 1 - fx.recoil / 100 * 0.4;
  if (fx.drain) mult *= 1 + fx.drain / 100 * 0.25;
  if (fx.self) mult *= 1 + 0.10 * sum(fx.self, s => s.change * s.chance / 100);
  if (fx.tgt) mult *= 1 + 0.02 * sum(fx.tgt, s => -s.change * s.chance / 100);
  if (fx.ail) mult *= 1 + 0.1 * fx.ail.chance / 100;
  if (fx.flinch) mult *= 1 + 0.05 * fx.flinch / 100;
  if (fx.crit === 1) mult *= 1.12; else if (fx.crit === 2) mult *= 1.5;
  mult *= 1 + 0.03 * (mv.pri > 0 ? 1 : 0);

  const atkStat = mv.cls === 'phys' ? p.b[1] : p.b[3];
  const fit = Math.pow(atkStat / Math.max(p.b[1], p.b[3]), 1.5);
  const stab = p.t.includes(mv.type) ? 1.5 : 1;

  let famous = 1 + 0.10 * Math.log(1 + (ctx.globalFame.get(mv.id) || 0)); // 랜덤배틀 전체에서 자주 쓰이는 기술
  const sd = ctx.sdMoves.get(mv.id);
  if (sd) famous *= 1.5 + 0.1 * Math.min(sd, 3);                  // 랜덤배틀 세트에 등장한 기술
  const learners = ctx.learnerCount.get(mv.id) || 0;
  if (learners <= 8) famous *= p.t.includes(mv.type) ? 1.35 : 1.1;  // 소수만 배우는 시그니처 기술

  return mv.power * hits * acc * mult * fit * stab * famous;
}

function coverageOf(types) {
  const covered = new Set();
  for (const t of types) CHART[t - 1].forEach((v, d) => { if (v > 1) covered.add(d); });
  return covered;
}

const EXPLAIN = new Set((process.argv.find(a => a.startsWith('--explain='))?.slice(10) || '').split(',').filter(Boolean).map(Number));
const isStabType = (p, mv) => p.t.includes(mv.type);

function selectMoves(p, candidates, ctx) {
  if (!candidates.length) return [33]; // 몸통박치기
  const scored = candidates
    .map(mv => ({ mv, score: movePotential(p, mv, ctx) }))
    .sort((a, b) => b.score - a.score || a.mv.id - b.mv.id);
  const top = scored[0].score;
  if (EXPLAIN.has(p.id)) {
    console.log(`\n[점수 상세] #${p.id} ${p.e} (후보 ${scored.length}개)`);
    scored.slice(0, 14).forEach(s => console.log(`  ${s.mv.e.padEnd(18)} score=${s.score.toFixed(1)} type=${TYPE_IDENT[s.mv.type - 1]} pw=${s.mv.power} ${s.mv.cls}`));
  }
  const chosen = [];

  // 1~2번 슬롯: 자속기 우선 (실전 세트처럼 자속기 2개 + 커버기 2개가 기본)
  const stabs = scored.filter(s => p.t.includes(s.mv.type));
  const first = stabs[0] || scored[0];
  chosen.push(first);
  if (stabs.length) {
    const otherType = new Set(p.t).size > 1 ? stabs.find(s => s.mv.type !== first.mv.type && s.score >= first.score * 0.35) : null;
    const second = otherType || stabs.find(s => s !== first && s.score >= first.score * 0.35);
    if (second) chosen.push(second);
  }

  while (chosen.length < 4) {
    const covered = coverageOf(chosen.map(c => c.mv.type));
    let best = null, bestAdj = -1;
    for (const s of scored) {
      if (chosen.includes(s)) continue;
      const sameType = chosen.filter(c => c.mv.type === s.mv.type).length;
      const isStab = p.t.includes(s.mv.type);
      let adj = s.score;
      const newCov = [...coverageOf([s.mv.type])].filter(d => !covered.has(d)).length;
      adj *= 1 + 1.5 * newCov / 18;
      if (!isStabType(p, s.mv) && newCov === 0) adj *= 0.75;   // 새 상성 범위를 못 여는 비자속기 억제
      if (sameType === 1) adj *= isStab ? 0.85 : 0.45;       // 자속기 2개까지는 자연스러움
      else if (sameType >= 2) adj *= 0.25;
      if (isStab && sameType === 0) adj *= 1.35;               // 다른 자속 타입 우대
      if (s.score < top * 0.2) adj *= 0.5;                      // 너무 약한 기술 억제
      if (adj > bestAdj) { bestAdj = adj; best = s; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.sort((a, b) => b.score - a.score || a.mv.id - b.mv.id).map(c => c.mv.id);
}

// ───────────────────────── 메인 ─────────────────────────
async function main() {
  const args = process.argv.slice(2);
  for (const f of CSV_FILES) await download(`${CSV_BASE}/${f}.csv`, path.join(CACHE, 'csv', `${f}.csv`));
  await download(SETS_URL, path.join(CACHE, 'showdown-gen9-sets.json'));
  const csv = f => parseCsv(fs.readFileSync(path.join(CACHE, 'csv', `${f}.csv`), 'utf8'));

  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'battle-move-overrides.json'), 'utf8')).moves;
  const speciesRows = csv('pokemon_species');
  const speciesById = new Map(speciesRows.map(s => [Number(s.id), s]));
  const koName = new Map(csv('pokemon_species_names').filter(r => r.local_language_id === '3').map(r => [Number(r.pokemon_species_id), r.name]));
  const moveKo = new Map(csv('move_names').filter(r => r.local_language_id === '3').map(r => [Number(r.move_id), r.name]));
  const typeKo = new Map(csv('type_names').filter(r => r.local_language_id === '3').map(r => [Number(r.type_id), r.name]));

  const meta = new Map(csv('move_meta').map(r => [Number(r.move_id), r]));
  const statChanges = new Map();
  for (const r of csv('move_meta_stat_changes')) {
    const id = Number(r.move_id);
    if (!statChanges.has(id)) statChanges.set(id, []);
    statChanges.get(id).push({ stat: Number(r.stat_id), change: Number(r.change) });
  }
  const moves = buildMoves({ moves: csv('moves'), meta, statChanges }, overrides);

  // 포켓몬 기본 정보
  const baseStats = new Map(), types = new Map();
  for (const r of csv('pokemon_stats')) {
    const id = Number(r.pokemon_id);
    if (!baseStats.has(id)) baseStats.set(id, [0, 0, 0, 0, 0, 0]);
    const si = Number(r.stat_id) - 1;
    if (si >= 0 && si < 6) baseStats.get(id)[si] = Number(r.base_stat);
  }
  for (const r of csv('pokemon_types')) {
    const id = Number(r.pokemon_id);
    if (!types.has(id)) types.set(id, []);
    types.get(id)[Number(r.slot) - 1] = Number(r.type_id);
  }
  const pokeRows = csv('pokemon');
  const defaultOfSpecies = new Map(pokeRows.filter(r => r.is_default === '1').map(r => [Number(r.species_id), Number(r.id)]));

  // 습득 기술 (포켓몬 → 기술 집합), 기술별 습득 종 수
  const learnset = new Map(), learnersBySpecies = new Map();
  const speciesOfPoke = new Map(pokeRows.map(r => [Number(r.id), Number(r.species_id)]));
  for (const r of csv('pokemon_moves')) {
    const pid = Number(r.pokemon_id), mid = Number(r.move_id);
    if (!moves.has(mid)) continue;
    if (!learnset.has(pid)) learnset.set(pid, new Set());
    learnset.get(pid).add(mid);
    if (!learnersBySpecies.has(mid)) learnersBySpecies.set(mid, new Set());
    learnersBySpecies.get(mid).add(speciesOfPoke.get(pid));
  }
  const learnerCount = new Map([...learnersBySpecies].map(([k, v]) => [k, v.size]));

  // Showdown 랜덤배틀 세트: 종(정규화 식별자) → 기술(정규화 식별자) → 등장 세트 수
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const moveByNorm = new Map([...moves.values()].map(m => [norm(m.e), m.id]));
  const sdSets = JSON.parse(fs.readFileSync(path.join(CACHE, 'showdown-gen9-sets.json'), 'utf8'));
  const sdBySpecies = new Map();
  const globalFame = new Map();
  for (const [key, val] of Object.entries(sdSets)) {
    const counts = new Map();
    for (const set of val.sets || []) for (const mvName of set.movepool || []) {
      const mid = moveByNorm.get(norm(mvName));
      if (mid) { counts.set(mid, (counts.get(mid) || 0) + 1); globalFame.set(mid, (globalFame.get(mid) || 0) + 1); }
    }
    sdBySpecies.set(norm(key), counts);
  }

  const pokemon = {};
  const stats = { sd: 0, noSd: 0, fewMoves: [], missingKo: [] };
  for (const r of pokeRows) {
    const id = Number(r.id), speciesId = Number(r.species_id);
    const b = baseStats.get(id), t = (types.get(id) || []).filter(Boolean);
    if (!b || !t.length || t.some(x => x > 18)) continue;

    const sp = speciesById.get(speciesId);
    const isDefault = r.is_default === '1';
    const defId = defaultOfSpecies.get(speciesId);
    const learnIds = learnset.get(id) || learnset.get(defId) || new Set();
    const candidates = [...learnIds].map(mid => moves.get(mid));

    const sdKeyForm = norm(r.identifier), sdKeySpecies = norm(sp.identifier);
    const sdMoves = sdBySpecies.get(sdKeyForm) || (isDefault ? sdBySpecies.get(sdKeySpecies) : null) ||
      sdBySpecies.get(sdKeySpecies) || new Map();
    sdMoves.size ? stats.sd++ : stats.noSd++;

    const p = { id, t, b, e: r.identifier };
    const ctx = { sdMoves, learnerCount, globalFame };
    const picked = selectMoves(p, candidates, ctx);
    if (picked.length < 4) stats.fewMoves.push(id);

    const s = b.map((v, i) => i === 0 ? 2 * v + 31 + 110 : 2 * v + 31 + 5);
    if (speciesId === 292) s[0] = 1; // 껍질몬
    const ko = koName.get(speciesId) || '';
    if (!ko) stats.missingKo.push(id);

    pokemon[id] = {
      k: ko, e: r.identifier, sp: speciesId, t, b, s,
      bst: b.reduce((a, x) => a + x, 0),
      leg: sp.is_mythical === '1' ? 2 : sp.is_legendary === '1' ? 1 : 0,
      m: picked,
    };
  }

  // 사용된 기술만 출력
  const usedMoveIds = new Set(Object.values(pokemon).flatMap(p => p.m));
  const moveOut = {};
  for (const mid of [...usedMoveIds].sort((a, b) => a - b)) {
    const m = moves.get(mid);
    moveOut[mid] = { k: moveKo.get(mid) || m.e, e: m.e, t: m.type, c: m.cls === 'phys' ? 'p' : 's', pw: m.power, ac: m.acc, pp: m.pp, pr: m.pri, fx: m.fx };
  }
  const typeOut = TYPE_IDENT.map((e, i) => ({ id: i + 1, e, k: typeKo.get(i + 1) || e }));

  const data = {
    meta: {
      version: 1,
      level: 100,
      statRule: 'IV31 / EV0 / 성격 보정 없음. HP=2B+141, 그 외=2B+36',
      source: 'PokeAPI csv + Pokemon Showdown gen9 random battle sets',
      pokemonCount: Object.keys(pokemon).length,
      moveCount: Object.keys(moveOut).length,
    },
    types: typeOut,
    chart: CHART,
    moves: moveOut,
    pokemon,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT,
    '/* 자동 생성 파일 — 직접 수정하지 말고 tools/build-battle-data.mjs 를 수정해 다시 생성하세요. */\n' +
    '(function (g) { g.BATTLE_DATA = ' + JSON.stringify(data) + '; })(typeof window !== "undefined" ? window : globalThis);\n');

  console.log(`생성 완료: ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
  console.log(`포켓몬 ${data.meta.pokemonCount}종/폼, 기술 ${data.meta.moveCount}개 (지원 가능 공격기 후보 ${moves.size}개)`);
  console.log(`Showdown 세트 매칭 ${stats.sd} / 미매칭 ${stats.noSd}`);
  console.log(`기술 4개 미만 ${stats.fewMoves.length}종, 한국어 이름 없음 ${stats.missingKo.length}종`);

  checkAgainstApp(pokemon, speciesById, defaultOfSpecies);
  if (stats.fewMoves.length) console.log('  기술 4개 미만: ' + stats.fewMoves.map(id => `${pokemon[id].k}(${pokemon[id].m.length})`).join(', '));
  if (args.includes('--sample')) printSample(data);
  const show = args.find(a => a === '--show');
  if (show) printIds(data, args[args.indexOf('--show') + 1].split(',').map(Number));
}

// 앱(index.html)이 쓰는 폼 ID/이름이 데이터에 모두 있는지 교차 검증
function checkAgainstApp(pokemon, speciesById, defaultOfSpecies) {
  const htmlPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(htmlPath)) return;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const block = name => {
    const i = html.indexOf(`const ${name} = {`);
    return i < 0 ? '' : html.slice(i, html.indexOf('\n    };', i));
  };
  const ids = new Set();
  for (const name of ['REGIONAL_FORMS_MAP', 'MEGA_FORMS_MAP', 'ALT_FORMS_MAP']) {
    for (const m of block(name).matchAll(/formId:\s*(\d+)/g)) ids.add(Number(m[1]));
  }
  for (const m of block('GMAX_FORMS_MAP').matchAll(/^\s*\d+:\s*(\d+)/gm)) ids.add(Number(m[1]));
  const missing = [...ids].filter(id => !pokemon[id]);
  console.log(`[앱 교차검증] 폼 ID ${ids.size}개 중 데이터에 없는 것: ${missing.length}${missing.length ? ' → ' + missing.join(',') : ''}`);

  const nameBlock = block('POKEMON_NAME_MAP');
  let nameMismatch = [], total = 0;
  for (const m of nameBlock.matchAll(/(\d+):\s*"([^"]+)"/g)) {
    total++;
    const id = Number(m[1]);
    const dataName = pokemon[defaultOfSpecies.get(id)]?.k;
    if (dataName !== m[2]) nameMismatch.push(`${id}:${m[2]}≠${dataName}`);
  }
  console.log(`[앱 교차검증] 이름 ${total}개 중 불일치 ${nameMismatch.length}${nameMismatch.length ? ' → ' + nameMismatch.slice(0, 12).join(', ') : ''}`);
}

function fmtMove(data, id) {
  const m = data.moves[id];
  return `${m.k}(${data.types[m.t - 1].k}·${m.c === 'p' ? '물' : '특'}·${m.pw})`;
}
function fmtPoke(data, id) {
  const p = data.pokemon[id];
  if (!p) return `${id}: (없음)`;
  const [hp, at, df, sa, sd, sp] = p.s;
  return `#${id} ${p.k}${id > 10000 ? `[${p.e}]` : ''} ${p.t.map(t => data.types[t - 1].k).join('/')} ` +
    `종족값합 ${p.bst} | Lv100 HP${hp} 공${at} 방${df} 특공${sa} 특방${sd} 스${sp} | ` + p.m.map(m => fmtMove(data, m)).join(', ');
}
function printIds(data, ids) { ids.forEach(id => console.log(fmtPoke(data, id))); }
function printSample(data) {
  // 스타터, 인기, 전설, 특수 능력치, 메가/리전/거다이 폼
  const ids = [1, 4, 7, 25, 6, 9, 94, 130, 131, 133, 143, 149, 150, 151, 197, 212, 248, 249, 282, 292, 350, 376, 384, 445, 448, 449,
    483, 487, 493, 530, 571, 579, 658, 700, 706, 745, 778, 785, 800, 888, 889, 892, 906, 959, 10034, 10091, 10100, 10196, 10008];
  printIds(data, ids);
}

main().catch(e => { console.error(e); process.exit(1); });
