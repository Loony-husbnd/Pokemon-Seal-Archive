// 배틀 엔진 테스트:  node --test battle/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../tools/lib/load-battle.mjs';

const { engine: E, data, createEngine } = loadBattle();
const T = name => data.types.find(t => t.e === name).id;

/** 테스트용 포켓몬 (기본 능력치 hp300 / 공200 방200 특공200 특방200 스100) */
function mk(name, types, stats, moves) {
  return E.makeCustomMon({
    name, types: types.map(T),
    stats: Object.assign({ hp: 300, atk: 200, def: 200, spa: 200, spd: 200, spe: 100 }, stats),
    moves: moves || [mv()],
  });
}
function mv(over) {
  return Object.assign({ id: 999, name: '테스트기', type: T('normal'), cls: 'phys', power: 80, acc: 100, pp: 10, maxPp: 10, pri: 0, fx: {} }, over);
}
const A = x => [...x];                          // vm 샌드박스 배열 → 일반 배열 (deepEqual 용)
const R = v => () => v;                         // 항상 같은 값을 돌려주는 난수
const GHOST_NOOP = () => mv({ name: '무효기', type: T('ghost'), power: 50 }); // 노말에게 무효 → 데미지 0
function battle(a, b, rng, extra) {
  const bt = E.createBattle(Object.assign({ parties: [Array.isArray(a) ? a : [a], Array.isArray(b) ? b : [b]], rng: rng || R(0.999) }, extra));
  bt.start();
  return bt;
}
const M = { type: 'move', index: 0 };
const dmgEvents = (ev, side) => ev.filter(e => e.t === 'damage' && e.side === side && !e.cause);

test('조사(은/는, 이/가, 을/를, 으로/로)', () => {
  assert.equal(E.josa('리자몽', '은/는'), '리자몽은');
  assert.equal(E.josa('피카츄', '은/는'), '피카츄는');
  assert.equal(E.josa('뮤츠', '을/를'), '뮤츠를');
  assert.equal(E.josa('공격', '이/가'), '공격이');
  assert.equal(E.josa('스피드', '이/가'), '스피드가');
  assert.equal(E.josa('칼', '으로/로'), '칼로');
});

test('상성: 4배 / 반감 / 무효 / 무속성', () => {
  const chart = (atk, ...defs) => E.typeMultiplier(T(atk), defs.map(T));
  assert.equal(chart('fire', 'grass', 'steel'), 4);
  assert.equal(chart('fire', 'water'), 0.5);
  assert.equal(chart('ground', 'flying'), 0);
  assert.equal(chart('ground', 'flying', 'steel'), 0);
  assert.equal(chart('electric', 'water', 'flying'), 4);
  assert.equal(E.typeMultiplier(0, [T('ghost')]), 1);
});

test('데미지 공식: 기준값 / 자속 / 상성 / 급소 / 난수 / 화상', () => {
  const att = mk('A', ['fire'], { spa: 200, atk: 200 });
  const def = mk('B', ['water'], { spd: 100, def: 100 });
  const spec = mv({ cls: 'spec', power: 100, type: T('normal') });
  assert.equal(E.calcDamage(att, def, spec, { roll: 100 }).damage, 170);         // floor(floor(42*100*200/100)/50)+2
  assert.equal(E.calcDamage(att, def, spec, { roll: 85 }).damage, 144);
  assert.equal(E.calcDamage(att, def, spec, { roll: 100, crit: true }).damage, 255);
  assert.equal(E.calcDamage(att, def, Object.assign({}, spec, { type: T('electric') }), { roll: 100 }).damage, 340); // 2배
  assert.equal(E.calcDamage(att, def, Object.assign({}, spec, { type: T('fire') }), { roll: 100 }).damage, 127);   // floor(170*1.5)=255 → floor(255*0.5)=127
  const stab = mk('S', ['normal'], { spa: 200 });
  assert.equal(E.calcDamage(stab, def, spec, { roll: 100 }).damage, 255);
  const phys = mv({ cls: 'phys', power: 100 });
  assert.equal(E.calcDamage(att, def, phys, { roll: 100 }).damage, 170);
  att.status = 'brn';
  assert.equal(E.calcDamage(att, def, phys, { roll: 100 }).damage, 85);           // 물리: 화상 절반
  assert.equal(E.calcDamage(att, def, spec, { roll: 100 }).damage, 170);          // 특수: 영향 없음
});

test('급소는 공격측 불리한 단계와 방어측 유리한 단계를 무시', () => {
  const att = mk('A', ['fire'], { atk: 200 });
  const def = mk('B', ['water'], { def: 100 });
  const phys = mv({ cls: 'phys', power: 100 });
  att.stages.atk = -2;
  assert.equal(E.calcDamage(att, def, phys, { roll: 100 }).damage, 86);
  assert.equal(E.calcDamage(att, def, phys, { roll: 100, crit: true }).damage, 255);
  att.stages.atk = 0; def.stages.def = 2;
  assert.equal(E.calcDamage(att, def, phys, { roll: 100 }).damage, 86);
  assert.equal(E.calcDamage(att, def, phys, { roll: 100, crit: true }).damage, 255);
});

test('useDef 기술은 특수기지만 상대의 방어로 계산', () => {
  const att = mk('A', ['fire'], { spa: 200 });
  const def = mk('B', ['water'], { def: 100, spd: 400 });
  const shock = mv({ cls: 'spec', power: 100, fx: { useDef: true } });
  assert.equal(E.calcDamage(att, def, shock, { roll: 100 }).damage, 170);
  assert.equal(E.calcDamage(att, def, mv({ cls: 'spec', power: 100 }), { roll: 100 }).damage, 44);
});

test('무효 타입은 데미지 0 + 메시지', () => {
  const a = mk('땅몬', ['ground'], {}, [mv({ type: T('ground') })]);
  const b = mk('비행몬', ['flying']);
  const bt = battle(a, b);
  const ev = bt.playTurn(M, M);
  assert.equal(bt.snapshot().sides[1].party[0].hp, 300);
  assert.ok(ev.some(e => e.t === 'effective' && e.eff === 0 && /효과가 없는/.test(e.text)));
});

test('행동 순서: 스피드 / 우선도 / 마비', () => {
  const noDamage = () => [GHOST_NOOP()];
  let bt = battle(mk('느림', ['normal'], { spe: 50 }, noDamage()), mk('빠름', ['normal'], { spe: 150 }, noDamage()));
  let ev = bt.playTurn(M, M);
  assert.deepEqual(A(ev.filter(e => e.t === 'move').map(e => e.side)), [1, 0]);

  bt = battle(mk('느림', ['normal'], { spe: 50 }, [mv({ pri: 1, type: T('ghost') })]), mk('빠름', ['normal'], { spe: 150 }, noDamage()));
  ev = bt.playTurn(M, M);
  assert.deepEqual(A(ev.filter(e => e.t === 'move').map(e => e.side)), [0, 1]);       // 우선도 +1

  const par = mk('마비', ['normal'], { spe: 200 }, noDamage()); par.status = 'par';
  bt = battle(par, mk('보통', ['normal'], { spe: 150 }, noDamage()), R(0.5));      // 마비: 200→100 < 150
  ev = bt.playTurn(M, M);
  assert.deepEqual(A(ev.filter(e => e.t === 'move').map(e => e.side)), [1, 0]);
});

test('교체는 공격보다 먼저, 공격은 교체한 포켓몬이 받는다', () => {
  const a1 = mk('A1', ['normal'], { spe: 10 }), a2 = mk('A2', ['normal'], { hp: 500, spe: 10 });
  const b = mk('B', ['fighting'], { spe: 200 }, [mv({ type: T('fighting') })]);
  const bt = battle([a1, a2], b);
  const ev = bt.playTurn({ type: 'switch', to: 1 }, M);
  assert.equal(ev.filter(e => e.t !== 'turn')[0].t, 'switch');
  const hit = dmgEvents(ev, 0)[0];
  assert.equal(hit.maxHp, 500);                       // 새로 나온 A2 가 맞았다
  assert.equal(bt.sides[0].active, 1);
});

test('기절: 느린 쪽 행동 취소 → 교체 선택 → 다음 턴', () => {
  const fast = mk('빠름', ['normal'], { spe: 200 }, [mv({ power: 200 })]);
  const slow = mk('느림', ['normal'], { spe: 10, hp: 1 }), reserve = mk('후보', ['normal']);
  const bt = battle(fast, [slow, reserve]);
  const ev = bt.playTurn(M, M);
  assert.equal(ev.filter(e => e.t === 'move').length, 1);       // 쓰러진 쪽은 행동하지 못했다
  assert.ok(ev.some(e => e.t === 'faint' && e.side === 1));
  assert.equal(bt.phase, 'switch');
  assert.deepEqual(A(bt.pending), [1]);
  assert.throws(() => bt.playTurn(M, M), /진행할 수 없/);
  assert.throws(() => bt.replace(0, 0), /차례가 아닙니다/);
  bt.replace(1, 1);
  assert.equal(bt.phase, 'move');
  assert.equal(bt.sides[1].active, 1);
});

test('승패: 마지막 포켓몬이 쓰러지면 종료', () => {
  const bt = battle(mk('A', ['normal'], { spe: 200 }, [mv({ power: 200 })]), mk('B', ['normal'], { hp: 1 }));
  const ev = bt.playTurn(M, M);
  assert.equal(bt.phase, 'ended');
  assert.equal(bt.winner, 0);
  assert.ok(ev.some(e => e.t === 'end' && e.winner === 0));
  assert.throws(() => bt.playTurn(M, M), /진행할 수 없/);
});

test('반동으로 양쪽이 동시에 쓰러지면 기술 사용자가 패배', () => {
  const a = mk('A', ['normal'], { hp: 1, spe: 200 }, [mv({ power: 200, fx: { recoil: 100 } })]);
  const b = mk('B', ['normal'], { hp: 1 });
  const bt = battle(a, b);
  bt.playTurn(M, M);
  assert.equal(bt.phase, 'ended');
  assert.equal(bt.winner, 1);
});

test('흡수/반동 수치', () => {
  const a = mk('A', ['normal'], { hp: 300 }, [mv({ power: 60, fx: { recoil: 33 } })]); // 반동 33%
  const bt = battle(a, mk('B', ['normal'], { hp: 999, spe: 1 }));
  const ev = bt.playTurn(M, { type: 'move', index: 0 });
  const dealt = dmgEvents(ev, 1).reduce((s, e) => s + e.amount, 0);
  const recoil = ev.find(e => e.t === 'damage' && e.cause === 'recoil');
  assert.equal(recoil.amount, Math.floor(dealt * 33 / 100));

  const d = mk('D', ['normal'], { hp: 300 }, [mv({ power: 60, fx: { drain: 50 } })]);
  d.hp = 100;
  const bt2 = battle(d, mk('E', ['normal'], { hp: 999, spe: 1 }));
  const ev2 = bt2.playTurn(M, M);
  const dealt2 = dmgEvents(ev2, 1).reduce((s, e) => s + e.amount, 0);
  assert.equal(ev2.find(e => e.t === 'heal').amount, Math.floor(dealt2 * 50 / 100));
});

test('다단 히트: 지정 횟수만큼 맞고 hits 이벤트 발행', () => {
  const a = mk('A', ['normal'], {}, [mv({ power: 20, fx: { hits: [3, 3] } })]);
  const bt = battle(a, mk('B', ['normal'], { hp: 999, spe: 1 }));
  const ev = bt.playTurn(M, M);
  assert.equal(dmgEvents(ev, 1).length, 3);
  assert.equal(ev.find(e => e.t === 'hits').count, 3);
});

test('명중 판정과 미스 이벤트', () => {
  const mkb = r => battle(mk('A', ['normal'], {}, [mv({ acc: 70 })]), mk('B', ['normal'], { spe: 1 }), R(r));
  assert.ok(mkb(0.99).playTurn(M, M).some(e => e.t === 'miss'));
  assert.ok(!mkb(0.5).playTurn(M, M).some(e => e.t === 'miss'));
  const sure = battle(mk('A', ['normal'], {}, [mv({ acc: null, fx: { neverMiss: true } })]), mk('B', ['normal']), R(0.999));
  assert.ok(!sure.playTurn(M, M).some(e => e.t === 'miss'));
});

test('능력 단계: 상승/하락 메시지와 ±6 한계', () => {
  const up = mv({ power: 10, fx: { self: [{ stat: 'atk', change: 2, chance: 100 }] } });
  const a = mk('A', ['normal'], { spe: 200 }, [up]);
  const bt = battle(a, mk('B', ['normal'], { spe: 1, hp: 9999 }, [GHOST_NOOP()]));
  let ev = bt.playTurn(M, M);
  assert.ok(ev.some(e => e.t === 'stage' && e.change === 2 && /공격이 크게 올라갔다/.test(e.text)));
  bt.playTurn(M, M); bt.playTurn(M, M);
  assert.equal(a.stages.atk, 6);
  ev = bt.playTurn(M, M);
  assert.ok(ev.some(e => /더 이상 올라가지 않는다/.test(e.text)));
  assert.equal(a.stages.atk, 6);
});

test('교체하면 능력 단계와 혼란이 초기화', () => {
  const a1 = mk('A1', ['normal']), a2 = mk('A2', ['normal']);
  a1.stages.atk = 3; a1.confusion = 3;
  const bt = battle([a1, a2], mk('B', ['normal'], {}, [GHOST_NOOP()]));
  bt.playTurn({ type: 'switch', to: 1 }, M);
  assert.equal(a1.stages.atk, 0);
  assert.equal(a1.confusion, 0);
});

test('상태이상 타입 면역', () => {
  const cases = [['par', 'electric'], ['brn', 'fire'], ['frz', 'ice'], ['psn', 'poison'], ['psn', 'steel'], ['tox', 'steel']];
  for (const [kind, type] of cases) {
    const bt = battle(mk('A', ['normal'], {}, [mv({ fx: { ail: { kind, chance: 100 } } })]), mk('B', [type], { spe: 1 }, [GHOST_NOOP()]));
    bt.playTurn(M, M);
    assert.equal(bt.sides[1].party[0].status, null, `${type} 은(는) ${kind} 면역`);
  }
  const ok = battle(mk('A', ['normal'], {}, [mv({ fx: { ail: { kind: 'brn', chance: 100 } } })]), mk('B', ['normal'], { spe: 1 }, [GHOST_NOOP()]));
  ok.playTurn(M, M);
  assert.equal(ok.sides[1].party[0].status, 'brn');
});

test('턴 종료 데미지: 화상 1/16, 독 1/8, 맹독 누적', () => {
  const mkb = status => {
    const a = mk('A', ['normal'], {}, [GHOST_NOOP()]); a.status = status; if (status === 'tox') a.toxCount = 1;
    return { a, bt: battle(a, mk('B', ['normal'], {}, [GHOST_NOOP()])) };
  };
  let { a, bt } = mkb('brn'); bt.playTurn(M, M); assert.equal(a.hp, 300 - 18);
  ({ a, bt } = mkb('psn')); bt.playTurn(M, M); assert.equal(a.hp, 300 - 37);
  ({ a, bt } = mkb('tox')); bt.playTurn(M, M); bt.playTurn(M, M);
  assert.equal(a.hp, 300 - 18 - 37);                   // 1/16, 2/16
});

test('잠듦: 1~3턴 행동 불가 후 기상', () => {
  const a = mk('A', ['normal'], {}, [GHOST_NOOP()]); a.status = 'slp'; a.sleepTurns = 2;
  const bt = battle(a, mk('B', ['normal'], {}, [GHOST_NOOP()]));
  let ev = bt.playTurn(M, M);
  assert.ok(!ev.some(e => e.t === 'move' && e.side === 0));
  ev = bt.playTurn(M, M);
  assert.ok(ev.some(e => e.t === 'status' && e.kind === 'wake'));
  assert.ok(ev.some(e => e.t === 'move' && e.side === 0));
});

test('얼음: 20% 확률로 녹음, 불꽃 기술에 맞으면 녹음', () => {
  const mkf = () => { const a = mk('A', ['normal'], {}, [GHOST_NOOP()]); a.status = 'frz'; return a; };
  let a = mkf(), bt = battle(a, mk('B', ['normal'], {}, [GHOST_NOOP()]), R(0.1));
  assert.ok(bt.playTurn(M, M).some(e => e.kind === 'thaw'));
  a = mkf(); bt = battle(a, mk('B', ['normal'], {}, [GHOST_NOOP()]), R(0.5));
  assert.ok(!bt.playTurn(M, M).some(e => e.t === 'move' && e.side === 0));
  assert.equal(a.status, 'frz');
  a = mkf(); bt = battle(a, mk('B', ['normal'], { spe: 200 }, [mv({ type: T('fire') })]), R(0.5));
  bt.playTurn(M, M);
  assert.equal(a.status, null);
});

test('마비: 25% 확률로 행동 불가', () => {
  const a = mk('A', ['normal'], {}, [GHOST_NOOP()]); a.status = 'par';
  const bt = battle(a, mk('B', ['normal'], {}, [GHOST_NOOP()]), R(0.1));
  assert.ok(!bt.playTurn(M, M).some(e => e.t === 'move' && e.side === 0));
});

test('풀죽음: 먼저 움직일 때만 상대 행동을 막는다', () => {
  const flincher = spe => mk('F', ['normal'], { spe }, [mv({ fx: { flinch: 100 } })]);
  const normal = spe => mk('N', ['normal'], { spe, hp: 999 }, [mv({ type: T('ghost') })]);
  let ev = battle(flincher(200), normal(50)).playTurn(M, M);
  assert.deepEqual(A(ev.filter(e => e.t === 'move').map(e => e.side)), [0]);   // 상대는 행동 못함 (풀죽음 메시지만)
  assert.ok(ev.some(e => /풀이 죽어/.test(e.text)));
  ev = battle(flincher(50), normal(200)).playTurn(M, M);
  assert.deepEqual(A(ev.filter(e => e.t === 'move').map(e => e.side)), [1, 0]);   // 상대가 먼저 움직였으므로 영향 없음
});

test('혼란: 자해 데미지와 해제', () => {
  const a = mk('A', ['normal'], {}, [GHOST_NOOP()]); a.confusion = 2;
  const bt = battle(a, mk('B', ['normal'], {}, [GHOST_NOOP()]), R(0.1));          // 1/3 미만 → 자해
  const ev = bt.playTurn(M, M);
  assert.ok(ev.some(e => e.t === 'damage' && e.cause === 'confusion' && e.side === 0));
  assert.ok(!ev.some(e => e.t === 'move' && e.side === 0));
  assert.ok(a.hp < 300);
  const ev2 = bt.playTurn(M, M);                                                  // confusion 1 → 0: 해제 후 행동
  assert.ok(ev2.some(e => e.kind === 'cnfEnd'));
  assert.ok(ev2.some(e => e.t === 'move' && e.side === 0));
});

test('PP 소진 → 발버둥(반동 1/4 최대 HP)', () => {
  const a = mk('A', ['normal'], {}, [mv({ pp: 1, maxPp: 1 })]);
  const bt = battle(a, mk('B', ['normal'], { hp: 999, spe: 1 }, [GHOST_NOOP()]));
  bt.playTurn(M, M);
  assert.equal(a.moves[0].pp, 0);
  const la = bt.legalActions(0);
  assert.ok(la.mustStruggle);
  const ev = bt.playTurn(M, M);
  assert.ok(ev.some(e => e.t === 'move' && e.name === '발버둥'));
  assert.equal(ev.find(e => e.t === 'damage' && e.cause === 'recoil').amount, 75);
});

test('잘못된 행동은 예외', () => {
  const bt = battle(mk('A', ['normal']), mk('B', ['normal']));
  assert.throws(() => bt.playTurn({ type: 'move', index: 7 }, M));
  assert.throws(() => bt.playTurn({ type: 'switch', to: 0 }, M));     // 이미 나와 있음
  assert.throws(() => bt.playTurn({ type: 'dance' }, M));
});

test('같은 시드 → 같은 결과, 다른 시드 → 다른 결과', () => {
  const run = seed => {
    const bt = E.createBattle({ parties: [[E.makeMon(6), E.makeMon(25)], [E.makeMon(9), E.makeMon(3)]], seed });
    bt.start();
    let log = [];
    for (let i = 0; i < 6 && bt.phase !== 'ended'; i++) {
      if (bt.phase === 'switch') bt.pending.slice().forEach(s => bt.replace(s, bt.sides[s].party.findIndex(m => !m.fainted)));
      else log = log.concat(bt.playTurn({ type: 'move', index: i % 4 }, { type: 'move', index: (i + 1) % 4 }));
    }
    return JSON.stringify(log);
  };
  assert.equal(run(42), run(42));
  assert.notEqual(run(1), run(2));
});

test('estimateDamage: min ≤ avg ≤ max, expected ≤ avg', () => {
  const a = E.makeMon(6), b = E.makeMon(3);
  for (const m of a.moves) {
    const d = E.estimateDamage(a, b, m);
    assert.ok(d.min <= d.avg + 1e-9 && d.avg <= d.max + 1e-9 && d.expected <= d.avg + 1e-9, m.name);
  }
});

test('모든 데이터 포켓몬으로 생성 가능, 능력치·기술이 유효', () => {
  for (const id of Object.keys(data.pokemon)) {
    const m = E.makeMon(id);
    assert.ok(m.maxHp > 0 && m.moves.length >= 1 && m.moves.length <= 4, `#${id}`);
    for (const mv_ of m.moves) assert.ok(mv_.power > 0 && mv_.pp > 1 && mv_.type >= 1 && mv_.type <= 18, `#${id} ${mv_.name}`);
  }
});

test('무작위 배틀 퍼즈: 불변식 유지·반드시 종료', () => {
  const ids = Object.keys(data.pokemon).filter(i => Number(i) <= 1025);
  const rnd = E.mulberry32(2024);
  const pick = () => Number(ids[Math.floor(rnd() * ids.length)]);
  for (let n = 0; n < 150; n++) {
    const bt = E.createBattle({ parties: [[pick(), pick(), pick()].map(i => E.makeMon(i)), [pick(), pick(), pick()].map(i => E.makeMon(i))], seed: n });
    bt.start();
    let guard = 0;
    while (bt.phase !== 'ended') {
      assert.ok(++guard < 1000, `배틀 ${n} 이 끝나지 않음`);
      if (bt.phase === 'switch') {
        for (const s of bt.pending.slice()) bt.replace(s, bt.sides[s].party.findIndex(m => !m.fainted));
        continue;
      }
      const act = si => {
        const la = bt.legalActions(si);
        const usable = la.moves.filter(m => m.usable);
        const roll = rnd();
        if (la.switches.length && (roll < 0.15 || (!usable.length && !la.mustStruggle))) return { type: 'switch', to: la.switches[Math.floor(rnd() * la.switches.length)] };
        return { type: 'move', index: usable.length ? usable[Math.floor(rnd() * usable.length)].index : 0 };
      };
      bt.playTurn(act(0), act(1));
      for (const s of bt.sides) for (const m of s.party) {
        assert.ok(Number.isInteger(m.hp) && m.hp >= 0 && m.hp <= m.maxHp, `HP 범위 (${m.name})`);
        assert.equal(m.fainted, m.hp === 0);
        for (const k of Object.keys(m.stages)) assert.ok(m.stages[k] >= -6 && m.stages[k] <= 6);
        for (const mvv of m.moves) assert.ok(mvv.pp >= 0 && mvv.pp <= mvv.maxPp);
      }
    }
    assert.ok([0, 1, 'draw'].includes(bt.winner));
  }
});

test('엔진 팩토리: 데이터 주입 가능', () => {
  const E2 = createEngine(data);
  assert.equal(typeof E2.createBattle, 'function');
});
