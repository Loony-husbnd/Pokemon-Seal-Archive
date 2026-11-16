// 팀 빌더: 세트 짜기 · 난이도별 상대 생성 · 지옥(시뮬레이션) 상대
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createAI, bestSet, generateOpponent, buildHell, randomTeam, familyOf, teamBst, mulberry, OFFSET } from '../src/index.js';
import { D } from './helpers.mjs';

const idsOf = team => team.map(s => D.roster().find(r => r.name === s.species).id);

test('세트: 모든 로스터 종에 대해 합법인 세트(기술 1~4개·특성·도구)가 나온다', () => {
  const rng = mulberry(1); const bad = [];
  for (const r of D.roster()) {
    const set = bestSet(D, r.id, { rng, variety: r.num % 2 });
    const v = D.validateTeam([set, D.makeSet({ species: 'Pikachu', moves: ['thunderbolt'], ability: 'Static' }), D.makeSet({ species: 'Garchomp', moves: ['earthquake'], ability: 'Rough Skin' })].filter((x, i) => i === 0 || r.id !== 'pikachu'));
    const own = v.errors.filter(e => e.startsWith('1번째'));
    if (own.length) bad.push(`${r.id}: ${own[0]}`);
    if (set.moves.length < Math.min(4, D.learnable(r.id).size)) bad.push(`${r.id}: 기술 ${set.moves.length}개`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `불합격 ${bad.length}종`);
});
test('세트: 특성은 가치가 높은 것을, 공격기는 자기 타입·공격 성향에 맞게 고른다', () => {
  assert.equal(bestSet(D, 'garchomp', {}).ability, 'Rough Skin', '한카리아스');
  assert.equal(bestSet(D, 'azumarill', {}).ability, 'Huge Power', '마릴리');
  const g = bestSet(D, 'garchomp', {}); assert.ok(g.moves.includes('earthquake'), `${g.moves}`);
  const mega = bestSet(D, 'charizard', {}); assert.match(mega.item, /Charizardite/, '메가스톤이 있으면 든다');
  assert.equal(bestSet(D, 'charizard', { mega: false }).item.includes('Charizardite'), false);
  assert.equal(bestSet(D, 'arceusfire', {}).item, 'Flame Plate', '고정 도구');
});
test('상대 생성(쉬움·보통·어려움): 합법이고 종족값 합계가 난이도 순서를 따른다', () => {
  const rng = mulberry(7); const sums = { easy: 0, normal: 0, hard: 0 }; const N = 30;
  for (let g = 0; g < N; g++) {
    const mine = randomTeam(D, rng), ids = idsOf(mine);
    for (const lv of Object.keys(sums)) {
      const opp = generateOpponent(D, { level: lv, playerIds: ids, rng });
      assert.ok(D.validateTeam(opp).ok, `${lv}: ${D.validateTeam(opp).errors}`);
      assert.equal(new Set(idsOf(opp).map(familyOf)).size, 3);
      sums[lv] += teamBst(D, idsOf(opp)) - teamBst(D, ids);
    }
  }
  const avg = k => sums[k] / N;
  console.log(`  상대 종족값 합계 − 내 합계 평균: 쉬움 ${avg('easy').toFixed(0)} · 보통 ${avg('normal').toFixed(0)} · 어려움 ${avg('hard').toFixed(0)}`);
  assert.ok(avg('easy') < avg('normal') && avg('normal') < avg('hard'));
  assert.ok(Math.abs(avg('normal')) < 80 && Math.abs(avg('easy') - OFFSET.easy) < 90 && Math.abs(avg('hard') - OFFSET.hard) < 90);
  assert.throws(() => generateOpponent(D, { level: 'hell', playerIds: [1, 4, 7] }), /알 수 없는 난이도/);
});
test('지옥 상대: 합법이고 내 팀과 계열이 겹치지 않으며 예산 안에 끝난다', async () => {
  const rng = mulberry(11), mine = randomTeam(D, rng), ids = idsOf(mine); const st = {}, prog = [];
  const t0 = performance.now();
  const team = await buildHell(D, { playerIds: ids, rng: mulberry(3), budgetMs: 2500, stats: st, onProgress: p => prog.push(p) });
  const ms = performance.now() - t0;
  console.log(`  지옥 빌드 ${ms.toFixed(0)}ms · 시뮬레이션 ${st.sims}판 · ${team.map(s => `${s.species}/${s.ability}/${s.item}`).join(' | ')}`);
  assert.ok(D.validateTeam(team).ok, D.validateTeam(team).errors.join());
  const fam = new Set(team.map(s => familyOf(D.roster().find(r => r.name === s.species).id)));
  assert.equal(fam.size, 3); for (const id of ids) assert.ok(!fam.has(familyOf(id)), '내 팀과 같은 계열');
  assert.ok(ms < 2500 * 2.5, `${ms}ms`); assert.ok(st.sims >= 10);
  assert.ok(prog.length > 3 && prog.at(-1) === 1 && prog.every((p, i) => i === 0 || p >= prog[i - 1] - 1e-9), '진행률이 단조 증가');
  assert.ok(teamBst(D, idsOf(team)) > teamBst(D, ids) + 300, '지옥은 훨씬 강한 포켓몬을 고른다');
});
test('강도: 지옥 팀 > 어려움 팀 > 쉬움 팀 (같은 내 팀을 상대로, 어려움 AI 끼리 시뮬레이션)', async () => {
  const rng = mulberry(21); const score = { easy: 0, normal: 0, hard: 0, hell: 0 }; const N = 6; let n = 0;
  for (let g = 0; g < N; g++) {
    const mine = randomTeam(D, rng), ids = idsOf(mine);
    const opps = { hell: await buildHell(D, { playerIds: ids, rng: mulberry(g + 1), budgetMs: 1500 }) };
    for (const lv of ['easy', 'normal', 'hard']) opps[lv] = generateOpponent(D, { level: lv, playerIds: ids, rng });
    for (const lv of Object.keys(opps)) for (let k = 0; k < 2; k++) {
      const m = createMatch({ teams: [mine, opps[lv]], seed: [g * 5 + k + 1, 2, 3, 4] });
      const ais = [createAI({ dex: D, seed: g + k }), createAI({ dex: D, seed: g + k + 50 })], pl = [m.player(0), m.player(1)];
      let t = 0; while (!m.ended && t++ < 100) m.submitWith(() => [0, 1].map(s => ais[s].choose(pl[s], 'hard').choice));
      if (m.winner === 1) score[lv]++;       // 상대 팀이 이기면 +1
    }
    n += 2;
  }
  console.log(`  상대 팀의 승률(내 팀 대비): 쉬움 ${(100 * score.easy / n).toFixed(0)}% · 보통 ${(100 * score.normal / n).toFixed(0)}% · 어려움 ${(100 * score.hard / n).toFixed(0)}% · 지옥 ${(100 * score.hell / n).toFixed(0)}%`);
  assert.ok(score.hell > score.hard && score.hell > score.easy, '지옥 팀이 가장 잘 이긴다');
  assert.ok(score.hell / n >= 0.7, `지옥 팀 승률 ${score.hell / n}`);
});
