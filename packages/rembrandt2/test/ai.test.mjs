// AI: 합법성 · 강도 순서 · 정보 가리기(누출 방지) · 속도
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMatch, createAI } from '../src/index.js';
import { D, prng, randomTeam } from './helpers.mjs';

const S = (species, ability, item, moves, evs) => ({ species, ability, item, moves, evs: evs || { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 } });

/** 두 AI 가 한 판. levels = [0번 난이도, 1번 난이도]. 거부된 제출 수도 센다 */
function playGame(teams, seed, levels, o = {}) {
  const m = createMatch({ teams, seed });
  const ais = [createAI({ dex: D, seed: seed[0] * 2 + 1 }), createAI({ dex: D, seed: seed[0] * 2 + 2 })], pl = [m.player(0), m.player(1)];
  let t = 0, tries = 0, submits = 0;
  while (!m.ended && t++ < 120) {
    m.submitWith(() => { tries++; return [0, 1].map(s => ais[s].choose(pl[s], levels[s], o.opts).choice); });
    submits++;
  }
  return { m, tries, submits };
}
/** 같은 팀으로 좌우를 바꿔 가며 겨룬 A 의 승수 */
function versus(A, B, pairs, seed0, o) {
  let a = 0, b = 0, n = 0, tries = 0, submits = 0;
  for (let g = 0; g < pairs; g++) {
    const r = prng(seed0 + g), teams = [randomTeam(r), randomTeam(r)];
    for (const flip of [false, true]) {
      const { m, tries: t, submits: s } = playGame(teams, [g + 1, flip ? 9 : 2, 3, 4], flip ? [B, A] : [A, B], o);
      tries += t; submits += s; n++;
      const aSide = flip ? 1 : 0; if (m.winner === aSide) a++; else if (m.winner === 1 - aSide) b++;
    }
  }
  return { a, b, n, rate: a / n, tries, submits };
}

test('AI: 모든 난이도가 합법인 수만 골라 한 판을 끝낸다 (쉬움·보통·어려움 섞어 40판)', () => {
  const lv = ['easy', 'normal', 'hard'];
  let tries = 0, submits = 0, ended = 0;
  for (let g = 0; g < 40; g++) {
    const r = prng(900 + g), teams = [randomTeam(r), randomTeam(r)];
    const { m, tries: t, submits: s } = playGame(teams, [g + 1, 2, 3, 4], [lv[g % 3], lv[(g + 1) % 3]]);
    tries += t; submits += s; if (m.ended) ended++;
  }
  assert.equal(ended, 40, `끝난 판 ${ended}/40`);
  assert.ok(tries <= submits * 1.05, `거부된 제출이 너무 많다 (시도 ${tries} / 진행 ${submits}) — 숨은 특성으로 교체가 막힌 경우만 있어야 한다`);
});

test('AI: 강도 순서 — 어려움 > 보통 > 쉬움 (같은 팀, 좌우 교대)', () => {
  const he = versus('hard', 'easy', 25, 500), ne = versus('normal', 'easy', 25, 500), hn = versus('hard', 'normal', 25, 500);
  console.log(`  어려움 대 쉬움 ${(100 * he.rate).toFixed(0)}% (${he.a}/${he.n}) · 보통 대 쉬움 ${(100 * ne.rate).toFixed(0)}% (${ne.a}/${ne.n}) · 어려움 대 보통 ${(100 * hn.rate).toFixed(0)}% (${hn.a}/${hn.n})`);
  assert.ok(he.rate >= 0.55, `어려움 대 쉬움 ${he.rate}`);
  assert.ok(ne.rate >= 0.52, `보통 대 쉬움 ${ne.rate}`);
  assert.ok(hn.rate >= 0.5, `어려움 대 보통 ${hn.rate}`);
});

const HELL = { budgetMs: 0, minRounds: 5 };
test('지옥: 확실히 쓰러뜨릴 수 있는 수가 있으면 그것을 고른다', () => {
  const m = createMatch({ teams: [[S('Garchomp', 'Rough Skin', 'Life Orb', ['earthquake', 'swordsdance', 'outrage', 'stealthrock'], { atk: 252, spe: 252, hp: 4 })], [S('Pikachu', 'Static', '', ['thunderbolt', 'surf'], {})]] });
  const ai = createAI({ dex: D, seed: 3 });
  assert.equal(ai.choose(m.player(0), 'hell', HELL).choice.index, 0, '땅 기술로 한 방');
});
test('메가진화: 보통·어려움은 쓸 수 있으면 바로 메가진화한다', () => {
  const m = createMatch({ teams: [[S('Charizard', 'Blaze', 'Charizardite X', ['dragonclaw', 'flareblitz', 'dragondance', 'roost']), S('Garchomp', 'Rough Skin', '', ['earthquake'])], [S('Blissey', 'Natural Cure', '', ['softboiled', 'seismictoss']), S('Toxapex', 'Regenerator', '', ['scald'])]] });
  for (const level of ['normal', 'hard']) assert.equal(createAI({ dex: D, seed: 3 }).choose(m.player(0), level).choice.mega, true, level);
});
test('지옥: 후보를 정해진 횟수만큼 굴려 보고 합법인 수를 고른다 (선택지 중 하나, 메가가 가능하면 메가 쪽 후보만 본다)', () => {
  const m = createMatch({ teams: [[S('Charizard', 'Blaze', 'Charizardite X', ['dragonclaw', 'flareblitz', 'dragondance', 'roost']), S('Garchomp', 'Rough Skin', '', ['earthquake'])], [S('Blissey', 'Natural Cure', '', ['softboiled', 'seismictoss']), S('Toxapex', 'Regenerator', '', ['scald'])]] });
  const trace = [], d = createAI({ dex: D, seed: 3 }).choose(m.player(0), 'hell', { budgetMs: 0, minRounds: 5, trace });
  assert.ok(d.rounds >= 5 && trace.length >= 2);
  assert.ok(m.choices(0).some(c => JSON.stringify(c) === JSON.stringify(d.choice)), '선택지 안의 수');
  assert.ok(trace.filter(t => t.choice.type === 'move').every(t => t.choice.mega), '메가 가능한 포켓몬은 메가 변형만 후보');
});
test('지옥: 탐색 결과가 쉬움보다 나쁘지 않다 (5쌍 10판, 재현 가능한 라운드 수)', () => {
  const r = versus('hell', 'easy', 5, 700, { opts: HELL });
  console.log(`  지옥 대 쉬움 ${(100 * r.rate).toFixed(0)}% (${r.a}/${r.n})`);
  assert.ok(r.rate >= 0.5, `지옥 대 쉬움 ${r.rate}`);
});

// ── 정보 가리기 ──
const mineTeam = () => [S('Garchomp', 'Rough Skin', 'Life Orb', ['earthquake', 'swordsdance', 'outrage']), S('Corviknight', 'Pressure', 'Leftovers', ['bravebird', 'roost'])];
/** 상대의 숨은 정보만 서로 다른 두 판: 활동 중인 상대(드러나지 않은 특성·도구·안 쓴 기술)와 후보 포켓몬(전부) */
const foeA = () => [S('Blissey', 'Natural Cure', 'Safety Goggles', ['softboiled', 'toxic', 'seismictoss', 'thunderwave']), S('Toxapex', 'Regenerator', 'Black Sludge', ['scald', 'recover', 'haze', 'toxicspikes']), S('Dragapult', 'Infiltrator', 'Choice Specs', ['dragondarts', 'shadowball', 'uturn', 'willowisp'], { hp: 4, spa: 252, spe: 252 })];
const foeB = () => [S('Blissey', 'Serene Grace', 'Covert Cloak', ['softboiled', 'toxic', 'icebeam', 'flamethrower']), S('Toxapex', 'Merciless', 'Rocky Helmet', ['scald', 'recover', 'surf', 'knockoff']), S('Dragapult', 'Clear Body', 'Life Orb', ['dragondarts', 'shadowball', 'surf', 'hex'], { hp: 252, atk: 252, def: 4 })];
const publicSummary = w => JSON.stringify(w.battle.sides[1].pokemon.map(p => [p.name, p.species.id, p.fainted, p.status, Math.ceil(p.hp * 100 / p.maxhp), p.isActive, p.boosts]));

test('정보 가리기: 가려진 세계의 상대는 진짜가 아니라 추정값을 가진다', () => {
  const m = createMatch({ teams: [mineTeam(), foeA()] });
  m.submit([{ type: 'move', index: 1 }, { type: 'move', index: 0 }]);
  const guess = { Blissey: S('Blissey', 'Serene Grace', '', ['softboiled', 'icebeam']), Toxapex: S('Toxapex', 'Merciless', '', ['scald']), Dragapult: S('Dragapult', 'Clear Body', '', ['hex']) };
  const w = m.world(0, guess, [1, 2, 3, 4]);
  w.battle.sides[1].pokemon.forEach((p, i) => {
    const real = m.battle.sides[1].pokemon[i];
    assert.notEqual(p.ability, real.ability, `${p.name} 특성이 진짜와 같다`);
    assert.notEqual(p.item, real.item); assert.notDeepEqual(p.moveSlots.map(x => x.id), real.moveSlots.map(x => x.id));
    assert.deepEqual(p.set.moves, guess[p.name].moves, '추정 셋이 들어갔다');
  });
  assert.equal(w.battle.sides[1].team.some(s => s.item === 'safetygoggles' || s.item === 'Safety Goggles' || s.item === 'Choice Specs' || s.item === 'Black Sludge'), false, 'side.team 에 진짜 셋이 남아 있다');
  const c = w.clone([9, 9, 9, 9]);     // 복제(직렬화)를 거쳐도 진짜가 되살아나지 않는다
  c.battle.sides[1].pokemon.forEach(p => assert.equal(p.set.item === 'Safety Goggles' || p.item === 'safetygoggles', false));
  assert.equal(m.battle.sides[1].pokemon[0].ability, 'naturalcure', '진짜 배틀은 그대로');
  assert.equal(w.battle.log.length, 0);
});

for (const level of ['normal', 'hard', 'hell']) {
  test(`정보 가리기: ${level} 의 판단은 상대의 숨은 정보(특성·도구·안 쓴 기술·후보 전원)가 달라도 같다`, () => {
    const opts = { budgetMs: 0, minRounds: 4 };
    const run = () => {
      const out = [];
      for (const foe of [foeA, foeB]) {
        const m = createMatch({ teams: [mineTeam(), foe()], seed: [4, 5, 6, 7] });
        const ai = createAI({ dex: D, seed: 11 }), pl = m.player(0), picks = [];
        // 내 AI 의 선택을 따라가며 두 턴 진행. 상대는 공개 정보가 똑같도록 고정된 행동(1번 기술 = softboiled)만 한다
        for (let t = 0; t < 2 && !m.ended; t++) {
          const d = ai.choose(pl, level, opts); picks.push(JSON.stringify(d.choice));
          m.submitWith(() => [d.choice, m.choices(1).find(c => c.type === 'move' && c.index === 0) || null]);
        }
        const guess = (() => { const o = ai.choose; return null; })();
        out.push(picks.join(' | '));
      }
      return out;
    };
    const [a, b] = run();
    assert.equal(a, b, `상대 정보에 따라 판단이 달라졌다 (정보 누출)\n  A: ${a}\n  B: ${b}`);
  });
}

test('정보 가리기: AI 소스는 진짜 배틀·전지적 로그를 건드리지 않는다 (정적 검사)', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ai');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/createMatch|omniscient\(|spectator\(|\bmatch\.battle|\.request\(/.test(src), `${f} 가 진짜 배틀/전지적 정보에 접근한다`);
  }
});

test('AI: 보통·어려움의 한 번 판단은 빠르다 (평균 50ms 이하)', () => {
  const r = prng(77), m = createMatch({ teams: [randomTeam(r), randomTeam(r)] });
  const ai = createAI({ dex: D, seed: 1 }), pl = m.player(0);
  for (const level of ['normal', 'hard']) {
    const t0 = performance.now(); const N = 30; for (let i = 0; i < N; i++) ai.choose(pl, level);
    const ms = (performance.now() - t0) / N; console.log(`  ${level} 한 번 판단 ${ms.toFixed(1)}ms`); assert.ok(ms < 50, `${level} ${ms}ms`);
  }
});
