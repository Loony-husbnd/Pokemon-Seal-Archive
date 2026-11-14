// AI / 파티 생성 테스트:  node --test packages/rembrandt/ai.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../../tools/lib/load-battle.mjs';

const { engine: E, data, ai: AI, party: PT } = loadBattle();
const T = name => data.types.find(t => t.e === name).id;
const A = x => [...x];
const R = v => () => v;

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
function battle(a, b) {
  const bt = E.createBattle({ parties: [Array.isArray(a) ? a : [a], Array.isArray(b) ? b : [b]], rng: R(0.999) });
  bt.start();
  return bt;
}
const ai = (seed = 1) => AI.create(E, { seed });

test('AI: 상성이 좋은 강한 기술을 고른다', () => {
  const me = mk('불', ['fire'], {}, [mv({ name: '약한기', power: 40 }), mv({ name: '불꽃', type: T('fire'), cls: 'spec', power: 90 }), mv({ name: '물기술', type: T('water'), power: 90 })]);
  const foe = mk('풀', ['grass'], {}, [mv()]);
  const bt = battle(me, foe);
  for (const lv of ['normal', 'hard']) {
    const a = ai().chooseAction(bt, 0, lv);
    assert.equal(a.type, 'move');
    assert.equal(me.moves[a.index].name, '불꽃', lv);
  }
});

test('AI(어려움): 무효 기술은 쓰지 않는다', () => {
  const me = mk('땅', ['ground'], {}, [mv({ name: '지진', type: T('ground'), power: 100 }), mv({ name: '몸통', power: 40 })]);
  const foe = mk('비행', ['flying']);
  const bt = battle(me, foe);
  for (let seed = 1; seed <= 30; seed++) {
    const a = ai(seed).chooseAction(bt, 0, 'hard');
    assert.equal(me.moves[a.index].name, '몸통');
  }
});

test('AI(어려움): 더 빠른 상대를 우선도 기술로 막타', () => {
  const me = mk('나', ['normal'], { spe: 10 }, [mv({ name: '강타', power: 120 }), mv({ name: '신속', power: 40, pri: 2 })]);
  const foe = mk('상대', ['normal'], { spe: 300 }); foe.hp = 20;                // 우선도 약한 기술로도 KO
  const bt = battle(me, foe);
  const a = ai().chooseAction(bt, 0, 'hard');
  assert.equal(me.moves[a.index].name, '신속');
});

test('AI: 기절 후 상성이 가장 좋은 포켓몬을 내보낸다', () => {
  const foe = mk('불꽃', ['fire'], {}, [mv({ type: T('fire'), power: 100 })]);
  const weak = mk('풀', ['grass'], {}, [mv({ type: T('grass'), power: 80 })]);
  const strong = mk('물', ['water'], {}, [mv({ type: T('water'), power: 80 })]);
  const bt = battle([mk('쓰러짐', ['normal']), weak, strong], foe);
  bt.sides[0].party[0].fainted = true; bt.sides[0].party[0].hp = 0;
  for (let seed = 1; seed <= 10; seed++) assert.equal(ai(seed).chooseReplacement(bt, 0, 'hard'), 2);
});

test('AI: 난이도별 교체 성향 (쉬움은 교체 안 함, 어려움은 상성 불리 시 교체)', () => {
  const mkBt = () => {
    const me = mk('풀', ['grass'], {}, [mv({ type: T('grass'), power: 60 })]);
    const counter = mk('불', ['fire'], { hp: 600 }, [mv({ type: T('fire'), power: 120 })]);
    const foe = mk('불꽃', ['fire'], { spe: 300 }, [mv({ type: T('fire'), power: 120 })]);
    return battle([me, counter], foe);
  };
  // 쉬움은 절대 교체하지 않는다
  for (let s = 1; s <= 20; s++) assert.equal(ai(s).chooseAction(mkBt(), 0, 'easy').type, 'move');
  // 어려움은 불리하면 교체 (불꽃에게 풀이 불리 → 불 포켓몬이 더 낫다고는 할 수 없지만, 풀 입장에서 압도적으로 불리한 경우)
  const me = mk('풀', ['grass'], { hp: 100 }, [mv({ type: T('grass'), power: 60 })]);
  const wall = mk('물', ['water'], { hp: 900, def: 400, spd: 400 }, [mv({ type: T('water'), power: 100 })]);
  const foe = mk('불꽃', ['fire'], { spe: 300 }, [mv({ type: T('fire'), power: 120 })]);
  const bt = battle([me, wall], foe);
  const a = ai().chooseAction(bt, 0, 'hard');
  assert.equal(a.type, 'switch');
  assert.equal(a.to, 1);
});

test('AI: 교체 직후 2턴 동안은 다시 교체하지 않는다 (핑퐁 방지)', () => {
  const me = mk('풀', ['grass'], { hp: 100 }, [mv({ type: T('grass'), power: 60 })]);
  const wall = mk('물', ['water'], { hp: 900, def: 400, spd: 400 }, [mv({ type: T('water'), power: 100 })]);
  const foe = mk('불꽃', ['fire'], { spe: 300 }, [mv({ type: T('fire'), power: 120 })]);
  const bt = battle([me, wall], foe);
  const brain = ai();
  assert.equal(brain.chooseAction(bt, 0, 'hard').type, 'switch');
  assert.equal(brain.chooseAction(bt, 0, 'hard').type, 'move');   // 같은 턴/직후엔 쿨다운
});

test('AI: 난이도별 최선 선택 비율 (쉬움 < 보통 < 어려움)', () => {
  const me = mk('나', ['normal'], {}, [mv({ name: 'A', power: 40 }), mv({ name: 'B', power: 120 }), mv({ name: 'C', power: 60 }), mv({ name: 'D', power: 50 })]);
  const bt = battle(me, mk('상대', ['normal']));
  const rate = level => {
    const brain = ai(7);
    let ok = 0; const n = 2000;
    for (let i = 0; i < n; i++) if (me.moves[brain.chooseAction(bt, 0, level).index].name === 'B') ok++;
    return ok / n;
  };
  const easy = rate('easy'), normal = rate('normal'), hard = rate('hard');
  assert.ok(easy > 0.5 && easy < 0.75, `쉬움 ${easy}`);
  assert.ok(normal > 0.82 && normal < 0.95, `보통 ${normal}`);
  assert.equal(hard, 1);
});

test('AI: 모든 기술이 무효여도 합법적인 행동을 고른다 (회귀)', () => {
  const me = mk('땅', ['ground'], {}, [mv({ type: T('ground') }), mv({ type: T('ground'), power: 60 })]);
  const bt = battle(me, mk('비행', ['flying']));
  for (const lv of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 20; seed++) {
      const a = ai(seed).chooseAction(bt, 0, lv);
      assert.equal(a.type, 'move');
      assert.ok(me.moves[a.index]);
    }
  }
});

test('AI: 선택은 항상 합법적인 행동 (퍼징)', () => {
  const ids = Object.keys(data.pokemon).filter(i => Number(i) <= 1025).map(Number);
  const rnd = E.mulberry32(99);
  const pick = () => ids[Math.floor(rnd() * ids.length)];
  for (let n = 0; n < 60; n++) {
    const bt = E.createBattle({ parties: [[pick(), pick(), pick()].map(i => E.makeMon(i)), [pick(), pick(), pick()].map(i => E.makeMon(i))], seed: n });
    bt.start();
    const brain = ai(n);
    const lv = ['easy', 'normal', 'hard'][n % 3];
    let guard = 0;
    while (bt.phase !== 'ended') {
      assert.ok(++guard < 800);
      if (bt.phase === 'switch') { bt.pending.slice().forEach(s => bt.replace(s, brain.chooseReplacement(bt, s, lv))); continue; }
      bt.playTurn(brain.chooseAction(bt, 0, lv), brain.chooseAction(bt, 1, lv));       // 불법 행동이면 엔진이 예외를 던진다
    }
  }
});

// ───────────── 파티 규칙 / 상대 파티 생성 ─────────────
const P = PT.create(data);

test('파티 검증: 3마리·종 중복 없음·종족값 상한', () => {
  assert.equal(P.validate([25, 133, 7]).ok, true);
  assert.match(P.validate([25, 25, 7]).errors.join(), /같은 종류/);
  assert.match(P.validate([25, 7]).errors.join(), /3마리/);
  assert.match(P.validate([150, 249, 483]).errors.join(), /상한/);
  const sameSpecies = P.validate([6, 10034, 7]);                        // 리자몽 + 메가리자몽X = 같은 종
  assert.equal(sameSpecies.ok, false);
  assert.match(sameSpecies.errors.join(), /같은 종류/);
});

test('표시 이름: 메가/리전폼', () => {
  assert.equal(P.displayName(6), '리자몽');
  assert.equal(P.displayName(10034), '메가리자몽X');
  assert.equal(P.displayName(10035), '메가리자몽Y');
  assert.equal(P.displayName(10091), '알로라 꼬렛');
});

test('상대 파티: 난이도별 종족값 합계 목표·제약 충족', () => {
  const player = [6, 9, 3];                                   // 합계 1589
  const base = P.total(player);
  const rnd = E.mulberry32(11);
  for (let i = 0; i < 80; i++) {
    for (const [level, lo, hi] of [['easy', base - 120 - 60, base - 120 + 60], ['normal', P.cap - 60, P.cap], ['hard', P.cap + 90 - 60, P.cap + 90]]) {
      const ids = P.generateOpponent({ playerIds: player, level, rng: rnd });
      const total = P.total(ids);
      assert.ok(total >= lo - 10 && total <= hi + 10, `${level}: ${total} (기대 ${lo}~${hi})`);
      assert.equal(new Set(ids.map(id => data.pokemon[id].sp)).size, 3, '종 중복');
      assert.ok(new Set(ids.map(id => data.pokemon[id].t[0])).size >= 2, '속성 다양성');
      assert.ok(ids.every(id => !data.pokemon[id].leg), '전설은 플레이어에게 없으면 상대도 없음');
    }
  }
});

test('상대 파티: 플레이어에게 전설이 있으면 상대도 허용, 시드 재현', () => {
  const rnd = E.mulberry32(3);
  let legends = 0;
  for (let i = 0; i < 200; i++) if (P.generateOpponent({ playerIds: [150, 6, 7], level: 'normal', rng: rnd }).some(id => data.pokemon[id].leg)) legends++;
  assert.ok(legends > 0, '전설이 한 번도 나오지 않음');
  const a = P.generateOpponent({ playerIds: [6, 9, 3], level: 'hard', rng: E.mulberry32(5) });
  const b = P.generateOpponent({ playerIds: [6, 9, 3], level: 'hard', rng: E.mulberry32(5) });
  assert.deepEqual(A(a), A(b));
});

test('난이도 강도: 어려움 AI 가 쉬움 AI 를 (근소하게나마 유의미하게) 이긴다', () => {
  const ids = Object.keys(data.pokemon).map(Number).filter(i => i <= 1025 && !data.pokemon[i].leg);
  const rnd = E.mulberry32(77);
  const wins = { hard: 0, easy: 0 };
  for (let n = 0; n < 120; n++) {
    const a = [0, 0, 0].map(() => ids[Math.floor(rnd() * ids.length)]), b = [0, 0, 0].map(() => ids[Math.floor(rnd() * ids.length)]);
    for (const hardSide of [0, 1]) {
      const bt = E.createBattle({ parties: [a.map(i => E.makeMon(i)), b.map(i => E.makeMon(i))], seed: n * 2 + hardSide });
      bt.start();
      const brain = ai(n);
      const lvOf = s => (s === hardSide ? 'hard' : 'easy');
      let guard = 0;
      while (bt.phase !== 'ended' && ++guard < 800) {
        if (bt.phase === 'switch') { bt.pending.slice().forEach(s => bt.replace(s, brain.chooseReplacement(bt, s, lvOf(s)))); continue; }
        bt.playTurn(brain.chooseAction(bt, 0, lvOf(0)), brain.chooseAction(bt, 1, lvOf(1)));
      }
      if (bt.winner === hardSide) wins.hard++; else if (bt.winner === 1 - hardSide) wins.easy++;
    }
  }
  const rate = wins.hard / (wins.hard + wins.easy);
  // 모든 기술이 고위력 공격기라 판단 차이의 영향이 작다(능력치·상성이 지배적). 난이도의 핵심은 상대 파티 종족값 보정.
  assert.ok(rate > 0.54, `어려움 승률 ${(rate * 100).toFixed(1)}%`);
});
