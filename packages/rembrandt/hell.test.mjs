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

test('지옥: 난이도 설정이 있다', () => { assert.ok(AI.LEVELS.hell && AI.LEVELS.hell.peek && AI.LEVELS.hell.search); });

test('지옥: 상대 파티는 전설을 포함한 가장 강한 조합이고 일반 난이도보다 훨씬 강하다', () => {
  const rnd = E.mulberry32(3);
  const mine = [1, 4, 7];
  const hell = P.generateOpponent({ playerIds: mine, level: 'hell', rng: rnd }), hard = P.generateOpponent({ playerIds: mine, level: 'hard', rng: rnd });
  const sum = ids => ids.reduce((s, id) => s + data.pokemon[id].bst, 0);
  assert.ok(sum(hell) > sum(hard) + 600, `${sum(hell)} vs ${sum(hard)}`);
  assert.ok(hell.some(id => data.pokemon[id].leg), '전설 포함');
  assert.equal(new Set(hell.map(id => data.pokemon[id].sp)).size, 3);
});

test('지옥: 플레이어가 교체를 고르면 교체해 들어오는 포켓몬을 겨냥한다 (행동 읽기)', () => {
  const brain = AI.create(E, { seed: 1 });
  const mkBoss = () => mk('B', ['normal'], { spe: 300, hp: 400 }, [atk({ type: T('fire'), cls: 'spec', power: 90 }), atk({ type: T('water'), cls: 'spec', power: 90 })]);
  const grass = () => mk('G', ['grass'], { hp: 200 }, [atk({ power: 40 })]), fire = () => mk('F', ['fire'], { hp: 200 }, [atk({ power: 40 })]);
  const mkBt = () => { const bt = E.createBattle({ parties: [[grass(), fire()], [mkBoss()]], rng: () => 0.5 }); bt.start(); return bt; };
  const a = brain.chooseAction(mkBt(), 1, 'hell', { type: 'switch', to: 1 });
  assert.equal(a.index, 1, '불꽃이 나오는 걸 읽고 물 기술');
  const b = brain.chooseAction(mkBt(), 1, 'hell', { type: 'move', index: 0 });
  assert.equal(b.index, 0, '풀이 그대로 있으면 불꽃 기술');
});

test('지옥: 이길 수 있는 확실한 수가 있으면 그것을 고른다', () => {
  const brain = AI.create(E, { seed: 2 });
  const boss = mk('B', ['normal'], { spe: 300 }, [atk({ power: 20 }), atk({ power: 200 })]), foe = mk('F', ['normal'], { hp: 100 }, [atk({ power: 40 })]);
  const bt = E.createBattle({ parties: [[foe], [boss]], rng: () => 0.5 }); bt.start();
  assert.equal(brain.chooseAction(bt, 1, 'hell', { type: 'move', index: 0 }).index, 1);
});

test('복제 배틀: 같은 상태에서 시작하고, 복제본을 굴려도 원본은 변하지 않는다', () => {
  const a = mk('A', ['fire'], { spe: 300 }, [atk({ power: 60 }), mv('swords-dance')]), b = mk('B', ['normal'], {}, [atk()]);
  const bt = duel(a, b);
  bt.playTurn({ type: 'move', index: 1 }, { type: 'move', index: 0 });
  const f = bt.fork(5);
  assert.equal(f.turn, bt.turn); assert.equal(f.phase, 'move');
  assert.equal(f.active(0).stages.atk, 2); assert.equal(f.active(0).hp, bt.active(0).hp);
  f.playTurn({ type: 'move', index: 0 }, { type: 'move', index: 0 });
  assert.equal(bt.turn, 1, '원본은 그대로'); assert.ok(f.turn === 2);
  assert.notStrictEqual(f.active(0), bt.active(0));
  assert.throws(() => { const g = duel(mk('P', ['psychic'], {}, [mv('teleport')]), idle2()); g.sides[0].party.push(mk('Q', ['normal'], {}, [atk()])); g.playTurn({ type: 'move', index: 0 }, { type: 'move', index: 0 }); g.fork(); }, /턴 도중/);
});
const idle2 = () => mk('I', ['normal'], {}, [mv('splash')]);

test('지옥: 탐색 AI 가 동급 무작위 팀에서 어려움 AI 보다 확실히 잘 이긴다 (30판, 같은 능력치)', () => {
  const rnd = E.mulberry32(5);
  const pool = Object.keys(data.pokemon).map(Number).filter(id => id <= 1025);
  let w = 0, n = 0;
  for (let g = 0; g < 30; g++) {
    const ids = () => { const s = new Set(); while (s.size < 3) s.add(pool[Math.floor(rnd() * pool.length)]); return [...s]; };
    const A = ids(), Bt = ids();
    const mkp = l => l.map(id => E.makeMon(id, { moves: P.pickMoveset(id, rnd) }));
    const bt = E.createBattle({ parties: [mkp(A), mkp(Bt)], seed: g + 1, maxTurns: 150 });
    const hard = AI.create(E, { seed: g }), boss = AI.create(E, { seed: g + 7 });
    bt.start(); let guard = 0;
    while (bt.phase !== 'ended' && ++guard < 600) {
      if (bt.phase === 'switch') { for (const si of bt.pending.slice()) if (bt.phase === 'switch' && bt.pending.includes(si)) bt.replace(si, (si ? boss : hard).chooseReplacement(bt, si, si ? 'hell' : 'hard')); continue; }
      const pa = hard.chooseAction(bt, 0, 'hard'); delete pa.reason;
      bt.playTurn(pa, boss.chooseAction(bt, 1, 'hell', pa));
    }
    n++; if (bt.winner === 1) w++;
  }
  assert.ok(w / n >= 0.6, `지옥 AI 승률 ${(w / n * 100).toFixed(0)}%`);
});
