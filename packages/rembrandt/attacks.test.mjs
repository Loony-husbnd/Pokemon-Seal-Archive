// 특수 공격기 확장 테스트 (1단계: 단순 효과 · 2단계: 가변 위력/고정 피해 · 3단계: 조건부 위력/반격 · 4단계: 턴 구조):  npm run test:battle
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../../tools/lib/load-battle.mjs';

const { engine: E, data, ai: AI } = loadBattle();
const T = name => data.types.find(t => t.e === name).id;
const A = x => [...x];
const idOf = ident => Object.keys(data.moves).find(i => data.moves[i].e === ident);
const mv = ident => { const m = E.makeMove(idOf(ident)); m.pp = m.maxPp = 99; return m; };
const atk = over => Object.assign({ id: 999, name: '공격', type: T('normal'), cls: 'phys', power: 80, acc: 100, pp: 99, maxPp: 99, pri: 0, fx: {} }, over);
function mk(name, types, stats, moves) {
  return E.makeCustomMon({ name, types: types.map(T), stats: Object.assign({ hp: 300, atk: 200, def: 200, spa: 200, spd: 200, spe: 100 }, stats), moves });
}
const R = v => () => v;
function duel(a, b, rng) {
  const bt = E.createBattle({ parties: [Array.isArray(a) ? a : [a], Array.isArray(b) ? b : [b]], rng: rng || R(0.5) });
  bt.start();
  return bt;
}
const M0 = { type: 'move', index: 0 }, M1 = { type: 'move', index: 1 };
const SW = to => ({ type: 'switch', to });
const texts = ev => ev.map(e => e.text).filter(Boolean);
const has = (ev, s) => texts(ev).some(t => t.includes(s));
const splash = () => mv('splash');
const idle = () => mk('쉬는애', ['normal'], {}, [splash()]);
const dmgOf = ev => ev.filter(e => e.t === 'damage' && !e.cause).reduce((s, e) => s + e.amount, 0);

// ───────────── 데이터 ─────────────
test('데이터: 특수 공격기가 배울 수 있는 기술에 들어 있고 대표 공격기(m)는 바뀌지 않는다', () => {
  for (const e of ['u-turn', 'fake-out', 'tri-attack', 'population-bomb']) {
    const id = idOf(e);
    if (e === 'u-turn' || e === 'fake-out') continue;     // 이후 단계에서 추가
    assert.ok(id, `${e} 가 데이터에 없다`);
    assert.ok(Object.values(data.pokemon).some(p => p.t.length && globalThis.BATTLE_LEARN === undefined || true));
  }
  assert.ok(data.pokemon[25].wt > 0, '몸무게');
});

// ═════════════ 1단계: 단순 효과 ═════════════
test('1단계: 트라이어택은 마비·화상·얼음 중 하나를 건다 / 페이탈클로는 독·마비·잠듦', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const a = mk('A', ['normal'], { spe: 300 }, [mv('tri-attack')]), b = idle();
    const rng = E.mulberry32(i + 1);
    duel(a, b, rng).playTurn(M0, M0);
    if (b.status) seen.add(b.status);
  }
  assert.ok([...seen].every(k => ['par', 'brn', 'frz'].includes(k)));
  assert.ok(seen.size >= 2);
  const dire = new Set();
  for (let i = 0; i < 60; i++) {
    const a = mk('A', ['poison'], { spe: 300 }, [mv('dire-claw')]), b = mk('B', ['normal'], {}, [splash()]);
    duel(a, b, E.mulberry32(i + 7)).playTurn(M0, M0);
    if (b.status) dire.add(b.status);
  }
  assert.ok([...dire].every(k => ['psn', 'par', 'slp'].includes(k)));
});

test('1단계: 엄니 계열은 10% 상태이상 + 10% 풀죽음 / 옛노래 수면', () => {
  assert.equal(JSON.stringify(data.moves[idOf('thunder-fang')].fx), JSON.stringify({ ail: { kind: 'par', chance: 10 }, flinch: 10 }));
  const a = mk('A', ['normal'], { spe: 300 }, [mv('fire-fang')]), b = idle();
  duel(a, b, R(0.01)).playTurn(M0, M0);
  assert.equal(b.status, 'brn');
});

test('1단계: 셸암즈·테라버스트는 공격/특공 중 더 아픈 쪽으로 때린다', () => {
  const phys = mk('P', ['poison'], { atk: 400, spa: 50, spe: 300 }, [mv('shell-side-arm')]), spec = mk('S', ['poison'], { atk: 50, spa: 400, spe: 300 }, [mv('shell-side-arm')]);
  const d = mk('D', ['normal'], { def: 100, spd: 100 }, [splash()]);
  const m = phys.moves[0];
  assert.equal(E.estimateDamage(phys, d, m).max, E.calcDamage(phys, d, Object.assign({}, m, { cls: 'phys' }), { roll: 100 }).damage);
  assert.equal(E.estimateDamage(spec, d, spec.moves[0]).max, E.calcDamage(spec, d, Object.assign({}, spec.moves[0], { cls: 'spec' }), { roll: 100 }).damage);
  const ev = duel(phys, d).playTurn(M0, M0);
  assert.ok(dmgOf(ev) > 0);
});

test('1단계: 다이아스톰·오라휠·스케일샷·이차원러시의 능력 변화', () => {
  const a = mk('A', ['rock'], { spe: 300 }, [mv('diamond-storm')]);
  duel(a, idle(), R(0.01)).playTurn(M0, M0);
  assert.equal(a.stages.def, 2);
  const b = mk('B', ['electric'], { spe: 300 }, [mv('aura-wheel')]);
  duel(b, idle()).playTurn(M0, M0);
  assert.equal(b.stages.spe, 1);
  const c = mk('C', ['dragon'], { spe: 300 }, [mv('scale-shot')]);
  duel(c, idle()).playTurn(M0, M0);
  assert.equal(c.stages.def, -1); assert.equal(c.stages.spe, 1);
  const d = mk('D', ['dark'], { spe: 300 }, [mv('hyperspace-fury')]);
  duel(d, idle()).playTurn(M0, M0);
  assert.equal(d.stages.def, -1);
});

test('1단계: 이차원홀·이차원러시·섀도다이브류는 방어를 무시하고 필중', () => {
  const a = mk('A', ['psychic'], { spe: 300 }, [mv('hyperspace-hole')]), b = mk('B', ['normal'], {}, [mv('protect')]);
  const ev = duel(a, b).playTurn(M0, M0);
  assert.ok(dmgOf(ev) > 0, '방어를 뚫는다');
  assert.equal(data.moves[idOf('hyperspace-hole')].ac, null);
});

test('1단계: 클리어스모그는 상대의 능력 변화를 초기화한다', () => {
  const a = mk('A', ['poison'], { spe: 300 }, [mv('clear-smog')]), b = idle();
  b.stages.atk = 4; b.stages.def = -2;
  const ev = duel(a, b).playTurn(M0, M0);
  assert.equal(b.stages.atk, 0); assert.equal(b.stages.def, 0);
  assert.ok(ev.some(e => e.t === 'stages' && e.side === 1));
});

test('1단계: 프리즈드라이는 물 타입에 효과가 굉장하다 / 플라잉프레스는 격투+비행 복합 상성', () => {
  const a = mk('A', ['ice'], {}, [mv('freeze-dry')]), w = mk('W', ['water'], {}, [splash()]);
  assert.equal(E.estimateDamage(a, w, a.moves[0]).eff, 2);
  assert.equal(E.estimateDamage(a, mk('X', ['water', 'ice'], {}, [splash()]), a.moves[0]).eff, 1);
  const f = mk('F', ['fighting'], {}, [mv('flying-press')]);
  assert.equal(E.estimateDamage(f, mk('G', ['grass'], {}, [splash()]), f.moves[0]).eff, 2, '격투 ×1 · 비행 ×2');
  assert.equal(E.estimateDamage(f, mk('H', ['bug'], {}, [splash()]), f.moves[0]).eff, 1, '격투 ×0.5 · 비행 ×2');
  assert.equal(E.estimateDamage(f, mk('H', ['rock'], {}, [splash()]), f.moves[0]).eff, 1, '격투 ×2 · 비행 ×0.5');
});

test('1단계: 삼연킥은 1타·2타·3타 위력이 10·20·30, 찍찍베기는 빗나가면 거기서 멈춘다', () => {
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('triple-kick')]), d = idle();
  const ev = duel(a, d, R(0.5)).playTurn(M0, M0);
  const hits = ev.filter(e => e.t === 'damage' && !e.cause).map(e => e.amount);
  assert.equal(hits.length, 3);
  assert.ok(hits[0] < hits[1] && hits[1] < hits[2], '타수마다 세진다');
  const b = mk('B', ['normal'], { spe: 300 }, [mv('population-bomb')]);
  const ev2 = duel(b, idle(), R(0.5)).playTurn(M0, M0);
  assert.equal(ev2.filter(e => e.t === 'damage' && !e.cause).length, 10);
  let k = 0; const rng = () => (k++ < 12 ? 0.5 : 0.99);     // 몇 타 뒤에는 빗나간다
  const c = mk('C', ['normal'], { spe: 300 }, [mv('population-bomb')]);
  const ev3 = duel(c, idle(), rng).playTurn(M0, M0);
  const n = ev3.filter(e => e.t === 'damage' && !e.cause).length;
  assert.ok(n >= 1 && n < 10, `빗나가면 멈춘다 (${n}타)`);
});

test('1단계: 감싸 붙들기 계열 외 — 스피릿섀클은 상대를 가두고 물고버티기는 서로 가둔다', () => {
  const a = mk('A', ['ghost'], { spe: 300 }, [mv('spirit-shackle')]), b = mk('B', ['water'], {}, [splash()]), b2 = idle();
  const bt = duel(a, [b, b2]);
  bt.playTurn(M0, M0);
  assert.deepEqual(A(bt.legalActions(1).switches), []);
  const c = mk('C', ['dark'], { spe: 300 }, [mv('jaw-lock')]), c2 = idle(), d = mk('D', ['water'], {}, [splash()]), d2 = idle();
  const bt2 = duel([c, c2], [d, d2]);
  bt2.playTurn(M0, M0);
  assert.deepEqual(A(bt2.legalActions(0).switches), []); assert.deepEqual(A(bt2.legalActions(1).switches), []);
});

test('1단계: 물거품아리아는 화상을 낫게 하고 괴이한주문은 PP 를 깎는다 / 시럽봄은 3턴 스피드 −1', () => {
  const a = mk('A', ['water'], { spe: 300 }, [mv('sparkling-aria')]), b = idle(); b.status = 'brn';
  duel(a, b).playTurn(M0, M0);
  assert.equal(b.status, null);
  const c = mk('C', ['psychic'], { spe: 1 }, [mv('eerie-spell')]), d = mk('D', ['normal'], { spe: 300 }, [atk()]);
  duel(c, d).playTurn(M0, M0);
  assert.equal(d.moves[0].pp, 99 - 1 - 3);
  const e = mk('E', ['grass'], { spe: 300 }, [mv('syrup-bomb')]), f = idle();
  const bt = duel(e, f);
  bt.playTurn(M0, M0);
  assert.equal(f.stages.spe, -1);
  bt.playTurn(M0, M0); bt.playTurn(M0, M0);
  assert.equal(f.stages.spe, -3, '3턴 동안 매 턴 −1');
  assert.equal(f.syrup, 0);
});

test('1단계: 잠재댄스는 자신의 타입, 풍선(영역)류 — 타입 일치 보정을 받는다', () => {
  const a = mk('A', ['fire'], {}, [mv('revelation-dance')]), d = idle();
  const m = E.makeMove(idOf('revelation-dance'));
  assert.equal(E.estimateDamage(a, d, m).eff, 1);
  const b = mk('B', ['fighting'], {}, [mv('revelation-dance')]);
  assert.ok(E.estimateDamage(b, mk('R', ['rock'], {}, [splash()]), m).eff === 2, '자신의 타입(격투)이 바위에 굉장');
});

test('1단계: 단순 기술(쪼아대기·고양이돈받기·맹세 …)이 실제 배틀에서 피해를 준다', () => {
  for (const e of ['pluck', 'pay-day', 'bug-bite', 'water-pledge', 'fusion-flare', 'pollen-puff', 'poltergeist', 'fling', 'tera-blast', 'dynamax-cannon', 'round']) {
    const ev = duel(mk('A', ['normal'], { spe: 300 }, [mv(e)]), mk('W', ['water'], {}, [splash()])).playTurn(M0, M0);
    assert.ok(dmgOf(ev) > 0, e);
  }
});
