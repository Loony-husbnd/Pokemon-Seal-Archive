// '지옥' 난이도 테스트: 파티 강화·능력치 배율·행동 읽기·실제로 이길 수 없는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../../tools/lib/load-battle.mjs';

const { engine: E, data, ai: AI, party: PT } = loadBattle();
const P = PT.create(data);
const T = n => data.types.find(t => t.e === n).id;
const idOf = i => Object.keys(data.moves).find(k => data.moves[k].e === i);
const mv = i => { const m = E.makeMove(idOf(i)); m.pp = m.maxPp = 99; return m; };
const atk = o => Object.assign({ id: 999, name: '공격', type: T('normal'), cls: 'phys', power: 80, acc: 100, pp: 99, maxPp: 99, pri: 0, fx: {} }, o);
const mk = (n, t, s, m) => E.makeCustomMon({ name: n, types: t.map(T), stats: Object.assign({ hp: 300, atk: 200, def: 200, spa: 200, spd: 200, spe: 100 }, s), moves: m });
const duel = (a, b, o) => { const bt = E.createBattle(Object.assign({ parties: [[a], [b]], rng: () => 0.5 }, o)); bt.start(); return bt; };

test('지옥: 난이도 설정이 있고 상대 능력치 배율이 1.5배다', () => {
  assert.ok(AI.LEVELS.hell && AI.LEVELS.hell.peek);
  assert.deepEqual([...PT.statMult('hell')], [1, 1.5]);
  assert.deepEqual([...PT.statMult('hard')], [1, 1]);
});

test('지옥: 능력치 배율은 지정한 쪽의 모든 능력치와 체력에 적용된다', () => {
  const a = mk('A', ['normal'], {}, [atk()]), b = mk('B', ['normal'], {}, [atk()]);
  duel(a, b, { statMult: [1, 1.5] });
  assert.equal(a.maxHp, 300); assert.equal(b.maxHp, 450); assert.equal(b.hp, 450);
  assert.equal(b.stats.atk, 300); assert.equal(b.stats.spe, 150);
});

test('지옥: 상대 파티는 전설을 포함한 가장 강한 조합이고 일반 난이도보다 훨씬 강하다', () => {
  const rnd = E.mulberry32(3);
  const mine = [1, 4, 7];
  const hell = P.generateOpponent({ playerIds: mine, level: 'hell', rng: rnd }), hard = P.generateOpponent({ playerIds: mine, level: 'hard', rng: rnd });
  const sum = ids => ids.reduce((s, id) => s + data.pokemon[id].bst, 0);
  assert.ok(sum(hell) > sum(hard) + 600, `${sum(hell)} vs ${sum(hard)}`);
  assert.ok(hell.some(id => data.pokemon[id].leg), '전설 포함');
  assert.equal(new Set(hell.map(id => data.pokemon[id].sp)).size, 3);
});

test('지옥: 플레이어가 방어·교체를 고른 것을 읽는다', () => {
  const brain = AI.create(E, { seed: 1 });
  const boss = mk('B', ['normal'], { spe: 300 }, [atk({ power: 60 }), mv('protect')]), foe = mk('F', ['normal'], {}, [atk({ power: 90 })]);
  const bt = duel(foe, boss);
  // 플레이어(0)가 큰 공격을 고르면 상대(1)는 방어를 선택해 피한다
  const a = brain.chooseAction(bt, 1, 'hell', { type: 'move', index: 0 });
  assert.equal(a.type, 'move'); assert.equal(a.index, 1, '공격을 읽고 방어');
  // 플레이어가 변화기만 고르면 방어는 헛수고 → 공격
  const idleFoe = mk('F', ['normal'], {}, [mv('splash')]);
  const b = brain.chooseAction(duel(idleFoe, boss), 1, 'hell', { type: 'move', index: 0 });
  assert.equal(b.index, 0, '공격하지 않는 상대에게 방어하지 않는다');
});

test('지옥: 플레이어가 먼저 쓰러뜨릴 공격을 고르면 방어/교체로 피한다', () => {
  const brain = AI.create(E, { seed: 2 });
  const boss = mk('B', ['normal'], { spe: 1, hp: 50 }, [atk({ power: 60 }), mv('protect')]), boss2 = mk('B2', ['normal'], {}, [atk()]);
  const foe = mk('F', ['normal'], { spe: 300 }, [atk({ power: 150 })]);
  const bt = E.createBattle({ parties: [[foe], [boss, boss2]], rng: () => 0.5 }); bt.start();
  const a = brain.chooseAction(bt, 1, 'hell', { type: 'move', index: 0 });
  assert.ok((a.type === 'move' && a.index === 1) || a.type === 'switch', JSON.stringify(a));
});

test('지옥: 어려움 AI 로 최강 팀을 굴려도 이기지 못한다 (60판)', () => {
  const rnd = E.mulberry32(11);
  const pool = Object.keys(data.pokemon).map(Number).filter(id => id <= 1025);
  const best = [...pool].sort((a, b) => data.pokemon[b].bst - data.pokemon[a].bst);
  let wins = 0;
  for (let g = 0; g < 60; g++) {
    const mine = g % 2 ? [best[0], best[5], best[10]] : [pool[Math.floor(rnd() * pool.length)], pool[Math.floor(rnd() * pool.length)], pool[Math.floor(rnd() * pool.length)]];
    if (new Set(mine.map(i => data.pokemon[i].sp)).size < 3) continue;
    const opp = P.generateOpponent({ playerIds: mine, level: 'hell', rng: rnd });
    const bt = E.createBattle({ parties: [mine.map(id => E.makeMon(id)), opp.map(id => E.makeMon(id))], seed: g + 5, statMult: PT.statMult('hell'), maxTurns: 200 });
    const player = AI.create(E, { seed: g }), boss = AI.create(E, { seed: g + 9 });
    bt.start();
    let guard = 0;
    while (bt.phase !== 'ended' && ++guard < 600) {
      if (bt.phase === 'switch') { for (const si of bt.pending.slice()) if (bt.phase === 'switch' && bt.pending.includes(si)) bt.replace(si, (si ? boss : player).chooseReplacement(bt, si, si ? 'hell' : 'hard')); continue; }
      const pa = player.chooseAction(bt, 0, 'hard'); delete pa.reason;
      bt.playTurn(pa, boss.chooseAction(bt, 1, 'hell', pa));
    }
    if (bt.winner === 0) wins++;
  }
  assert.equal(wins, 0, `지옥에서 ${wins}판을 이겼다`);
});
