// 지옥 상대 팀 빌더 테스트: 규칙(사람이 할 수 있는 선택만)·다양성·내 팀 반응
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../../tools/lib/load-battle.mjs';

const { engine: E, data, ai: AI, party: PT, boss: BB, learn } = loadBattle();
const P = PT.create(data), B = BB.create({ E, AI, PT, data, learn });
const legal = id => new Set([...(learn[id] || []), ...data.pokemon[id].m, ...data.pokemon[id].sm]);
const teamOf = (ids, rnd) => ids.map(id => ({ id, moves: P.pickMoveset(id, rnd) }));

test('빌더: 서로 다른 3종, 기술 최대 4개, 모두 그 포켓몬이 실제로 배울 수 있는 기술이다', async () => {
  const rnd = E.mulberry32(1);
  for (const ids of [[6, 9, 3], [150, 249, 384], [25, 133, 143]]) {
    const team = await B.build(teamOf(ids, rnd), { rng: rnd, budgetMs: 2500 });
    assert.equal(team.length, 3);
    assert.equal(new Set(team.map(t => data.pokemon[t.id].sp)).size, 3);
    for (const t of team) {
      assert.ok(t.moves.length >= 1 && t.moves.length <= 4);
      assert.equal(new Set(t.moves).size, t.moves.length, '기술 중복 없음');
      const ok = legal(t.id);
      for (const m of t.moves) assert.ok(ok.has(m), `${data.pokemon[t.id].k} 는 ${data.moves[m].k} 를 배우지 못한다`);
    }
  }
});

test('빌더: 능력치 배율 같은 반칙이 없다 (만든 팀은 일반 makeMon 능력치 그대로)', async () => {
  const rnd = E.mulberry32(2);
  const team = await B.build(teamOf([6, 9, 3], rnd), { rng: rnd, budgetMs: 2000 });
  for (const t of team) { const m = E.makeMon(t.id, { moves: t.moves }); assert.deepEqual([...Object.values(m.stats)], [...data.pokemon[t.id].s]); }
});

test('빌더: 내 팀이 다르면 상대 구성도 달라지고, 여러 번 짜면 다양한 포켓몬이 나온다 (단골은 허용)', async () => {
  const rnd = E.mulberry32(3);
  const pool = Object.keys(data.pokemon).map(Number).filter(id => id <= 1025);
  const seen = new Map();
  for (let g = 0; g < 10; g++) {
    const s = new Set(); while (s.size < 3) s.add(pool[Math.floor(rnd() * pool.length)]);
    const team = await B.build(teamOf([...s], rnd), { rng: rnd, budgetMs: 1500 });
    team.forEach(t => seen.set(t.id, (seen.get(t.id) || 0) + 1));
  }
  assert.ok(seen.size >= 12, `서로 다른 포켓몬 ${seen.size}종`);
  assert.ok(Math.max(...seen.values()) <= 7, '한 포켓몬이 지나치게 자주 나오지 않는다');
});

test('빌더: 상대가 물 타입 위주면 풀·전기에 강한 구성을 만들고, 결과 팀이 내 팀보다 대결에서 우세하다', async () => {
  const rnd = E.mulberry32(4);
  const mine = teamOf([9, 130, 134], rnd);                       // 거북왕·갸라도스·샤미드
  const boss = await B.build(mine, { rng: rnd, budgetMs: 3000 });
  const wr = B.winRate(mine, boss, 12, 4000);
  assert.ok(wr >= 0.75, `보스 승률 ${(wr * 100).toFixed(0)}%`);
});

test('빌더: 진행 상황을 알려 주고 예산 안에 끝난다', async () => {
  const rnd = E.mulberry32(5);
  const marks = [];
  const t0 = Date.now();
  await B.build(teamOf([6, 9, 3], rnd), { rng: rnd, budgetMs: 1200, onProgress: f => marks.push(f) });
  assert.ok(marks.length >= 4 && marks[marks.length - 1] === 1);
  assert.ok(Date.now() - t0 < 6000);
});

test('빌더: 사람이 고를 수 있는 모든 포켓몬(무한다이맥스·원시회귀·왕관 폼 등)이 상대 후보에도 있다', () => {
  const cand = new Set(B.candidatePool());
  const selectable = Object.keys(data.pokemon).map(Number);
  assert.equal(JSON.stringify(P.fullPool), JSON.stringify(selectable));
  for (const sp of new Set(selectable.map(id => data.pokemon[id].sp))) {
    const forms = selectable.filter(id => data.pokemon[id].sp === sp).sort((a, b) => data.pokemon[b].bst - data.pokemon[a].bst);
    assert.ok(cand.has(forms[0]), `${data.pokemon[forms[0]].k}(${data.pokemon[forms[0]].e}) 가 후보에 없다`);
  }
  for (const e of ['eternatus-eternamax', 'groudon-primal', 'kyurem-white']) {
    const id = Number(Object.keys(data.pokemon).find(i => data.pokemon[i].e === e));
    assert.ok(cand.has(id), `${e} 는 상대도 쓸 수 있어야 한다`);
  }
});

test('빌더: 사람이 무한다이맥스를 들고 와도 후보로 짠 상대 팀이 유효하다', async () => {
  const rnd = E.mulberry32(5);
  const eter = Number(Object.keys(data.pokemon).find(i => data.pokemon[i].e === 'eternatus-eternamax'));
  const team = await B.build(teamOf([eter, 9, 3], rnd), { rng: rnd, budgetMs: 2500 });
  assert.equal(team.length, 3);
  assert.equal(new Set(team.map(t => data.pokemon[t.id].sp)).size, 3);
});
