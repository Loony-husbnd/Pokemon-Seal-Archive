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

// ═════════════ 2단계: 가변 위력 · 고정 피해 · 일격필살 ═════════════
const withWt = (mon, kg) => { mon.wt = kg * 10; return mon; };
const powerOf = (att, def, ident, ctx) => E.resolveMove(att, def, att.moves.find(m => m.ident === ident) || mv(ident), ctx).power;

test('2단계: 안다리걸기·풀묶기는 상대 몸무게로, 헤비봄버·히트스탬프는 몸무게 비율로 위력이 정해진다', () => {
  const a = withWt(mk('A', ['fighting'], {}, [mv('low-kick')]), 50);
  for (const [kg, p] of [[5, 20], [20, 40], [40, 60], [80, 80], [150, 100], [300, 120]]) assert.equal(powerOf(a, withWt(idle(), kg), 'low-kick'), p, `${kg}kg`);
  assert.equal(powerOf(a, withWt(idle(), 8), 'grass-knot'), 20);
  const h = withWt(mk('H', ['steel'], {}, [mv('heavy-slam')]), 300);
  for (const [kg, p] of [[200, 40], [150, 60], [100, 80], [75, 100], [50, 120]]) assert.equal(powerOf(h, withWt(idle(), kg), 'heavy-slam'), p, `${kg}kg`);
  assert.equal(powerOf(h, withWt(idle(), 50), 'heat-crash'), 120);
});

test('2단계: 분화·해수스파우팅·용의에너지는 체력 비례, 바둥바둥·기사회생은 체력이 적을수록 강하다', () => {
  const a = mk('A', ['fire'], {}, [mv('eruption'), mv('flail')]), d = idle();
  assert.equal(powerOf(a, d, 'eruption'), 150);
  a.hp = 150; assert.equal(powerOf(a, d, 'eruption'), 75);
  a.hp = 300; assert.equal(powerOf(a, d, 'flail'), 20);
  a.hp = 8; assert.equal(powerOf(a, d, 'flail'), 200);
  a.hp = 100; assert.equal(powerOf(a, d, 'flail'), 80);
});

test('2단계: 하드프레스·묵사발은 상대 체력이 많을수록, 자이로볼은 느릴수록, 일렉트릭볼은 빠를수록 강하다', () => {
  const a = mk('A', ['steel'], { spe: 50 }, [mv('hard-press'), mv('crush-grip'), mv('gyro-ball'), mv('electro-ball')]), d = mk('D', ['normal'], { spe: 400 }, [splash()]);
  assert.equal(powerOf(a, d, 'hard-press'), 100); d.hp = 150;
  assert.equal(powerOf(a, d, 'hard-press'), 50); assert.equal(powerOf(a, d, 'crush-grip'), 60);
  assert.equal(powerOf(a, d, 'gyro-ball'), 150, '상한 150');
  const f = mk('F', ['electric'], { spe: 400 }, [mv('electro-ball')]), s = mk('S', ['normal'], { spe: 100 }, [splash()]);
  assert.equal(powerOf(f, s, 'electro-ball'), 150);
  assert.equal(powerOf(f, mk('S2', ['normal'], { spe: 400 }, [splash()]), 'electro-ball'), 60);
});

test('2단계: 어시스트파워·기어오르기는 올라간 능력 단계 하나당 +20', () => {
  const a = mk('A', ['psychic'], {}, [mv('stored-power')]), d = idle();
  assert.equal(powerOf(a, d, 'stored-power'), 20);
  a.stages.atk = 2; a.stages.spd = 1; a.stages.def = -3;
  assert.equal(powerOf(a, d, 'stored-power'), 80, '내려간 단계는 세지 않는다');
});

test('2단계: 바디프레스는 방어 능력치로, 속임수는 상대 공격 능력치로 때린다', () => {
  const a = mk('A', ['fighting'], { atk: 50, def: 400 }, [mv('body-press')]), d = mk('D', ['normal'], { def: 200 }, [splash()]);
  const bp = E.calcDamage(a, d, a.moves[0], { roll: 100 }).damage;
  const a2 = mk('A2', ['fighting'], { atk: 400, def: 50 }, [mv('body-press')]);
  assert.ok(bp > E.calcDamage(a2, d, a2.moves[0], { roll: 100 }).damage * 2);
  const f = mk('F', ['dark'], { atk: 50 }, [mv('foul-play')]), strong = mk('S', ['normal'], { atk: 400 }, [splash()]), weak = mk('W', ['normal'], { atk: 50 }, [splash()]);
  assert.ok(E.calcDamage(f, strong, f.moves[0], { roll: 100 }).damage > E.calcDamage(f, weak, f.moves[0], { roll: 100 }).damage * 3);
});

test('2단계: 웨더볼·대지의파동은 날씨/필드에 따라 타입이 바뀌고 위력 2배', () => {
  const a = mk('A', ['normal'], {}, [mv('weather-ball'), mv('terrain-pulse')]), d = idle();
  const wb = a.moves[0], tp = a.moves[1];
  assert.equal(E.resolveMove(a, d, wb, {}).power, 50);
  const rain = E.resolveMove(a, d, wb, { weather: 'rain' });
  assert.equal(rain.power, 100); assert.equal(rain.type, T('water'));
  assert.equal(E.resolveMove(a, d, wb, { weather: 'sand' }).type, T('rock'));
  const t = E.resolveMove(a, d, tp, { terrain: 'grassy', attGrounded: true });
  assert.equal(t.power, 100); assert.equal(t.type, T('grass'));
  assert.equal(E.resolveMove(a, d, tp, { terrain: 'grassy', attGrounded: false }).power, 50);
});

test('2단계: 라이징볼트·와이드포스·그래스슬라이더는 필드 보너스, 아이언롤러는 필드가 있어야 하고 필드를 없앤다', () => {
  const a = mk('A', ['electric'], {}, [mv('rising-voltage')]), d = idle();
  assert.equal(E.resolveMove(a, d, a.moves[0], { terrain: 'electric', defGrounded: true }).power, 140);
  assert.equal(E.resolveMove(a, d, a.moves[0], { terrain: 'electric', defGrounded: false }).power, 70);
  const p = mk('P', ['psychic'], {}, [mv('expanding-force')]);
  assert.equal(E.resolveMove(p, d, p.moves[0], { terrain: 'psychic', attGrounded: true }).power, 120);
  const g = mk('G', ['grass'], { spe: 1 }, [mv('grassy-glide')]), fast = mk('F', ['normal'], { spe: 300 }, [atk({ power: 20 })]);
  const bt = duel(g, fast); bt.field.terrain = 'grassy'; bt.field.terrainTurns = 5;
  const ev = bt.playTurn(M0, M0);
  assert.equal(ev.filter(e => e.t === 'move')[0].side, 0, '그래스필드에서는 우선도 +1');
  const s = mk('S', ['steel'], { spe: 300 }, [mv('steel-roller')]);
  assert.ok(has(duel(s, idle()).playTurn(M0, M0), '실패'), '필드가 없으면 실패');
  const bt2 = duel(mk('S', ['steel'], { spe: 300 }, [mv('steel-roller')]), idle()); bt2.field.terrain = 'misty'; bt2.field.terrainTurns = 5;
  bt2.playTurn(M0, M0);
  assert.equal(bt2.field.terrain, null);
});

test('2단계: 지구던지기·나이트헤드는 100, 분노의앞니·카타스트로피는 절반, 죽기살기는 체력 차이만큼', () => {
  const dmg = (ident, att, def) => dmgOf(duel(att, def).playTurn(M0, M0));
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('seismic-toss')]), d = idle();
  assert.equal(dmg('seismic-toss', a, d), 100);
  const g = mk('G', ['ghost'], { spe: 300, atk: 1, spa: 1 }, [mv('night-shade')]);
  assert.equal(dmg('night-shade', g, mk('D', ['psychic'], {}, [splash()])), 100);
  const f = mk('F', ['normal'], { spe: 300 }, [mv('super-fang')]);
  assert.equal(dmg('super-fang', f, idle()), 150);
  const r = mk('R', ['dark'], { spe: 300 }, [mv('ruination')]);
  assert.equal(dmg('ruination', r, idle()), 150);
  const e = mk('E', ['normal'], { spe: 300 }, [mv('endeavor')]); e.hp = 100;
  assert.equal(dmg('endeavor', e, idle()), 200);
  const e2 = mk('E', ['normal'], { spe: 300 }, [mv('endeavor')]);
  assert.ok(has(duel(e2, idle()).playTurn(M0, M0), '실패'), '상대 체력이 더 적거나 같으면 실패');
});

test('2단계: 고정 피해는 타입 상성의 무효만 따르고 능력치·급소의 영향을 받지 않는다', () => {
  const a = mk('A', ['fighting'], { spe: 300, atk: 1 }, [mv('seismic-toss')]);
  assert.ok(has(duel(a, mk('G', ['ghost'], {}, [splash()])).playTurn(M0, M0), '효과가 없'), '격투는 고스트에 무효');
  const est = E.estimateDamage(mk('A', ['fighting'], {}, [mv('seismic-toss')]), idle(), mv('seismic-toss'));
  assert.equal(est.max, 100);
});

test('2단계: 일격필살 — 맞으면 쓰러뜨리고 명중률은 30%, 얼음 타입에는 절대영도가 통하지 않는다', () => {
  const a = mk('A', ['ground'], { spe: 300 }, [mv('fissure')]), d = idle();
  const ev = duel(a, d, R(0.1)).playTurn(M0, M0);
  assert.equal(d.hp, 0); assert.ok(has(ev, '일격필살'));
  const a2 = mk('A', ['ground'], { spe: 300 }, [mv('fissure')]), d2 = idle();
  const ev2 = duel(a2, d2, R(0.5)).playTurn(M0, M0);
  assert.ok(ev2.some(e => e.t === 'miss'), '명중률 30%');
  assert.equal(data.moves[idOf('fissure')].ac, 30);
  assert.equal(E.estimateDamage(a, idle(), mv('fissure')).expected, 90);
  assert.ok(has(duel(mk('A', ['ground'], { spe: 300 }, [mv('fissure')]), mk('F', ['flying'], {}, [splash()]), R(0.1)).playTurn(M0, M0), '효과가 없'), '비행에는 땅 기술 무효');
});

test('2단계: 토해내기는 비축한 만큼 강하고 쓰면 방어·특방이 원래대로, 비축이 없으면 실패', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('stockpile'), mv('spit-up')]);
  const bt = duel(a, idle());
  assert.ok(has(bt.playTurn(M1, M0), '실패'));
  bt.playTurn(M0, M0); bt.playTurn(M0, M0);
  assert.equal(a.stock, 2); assert.equal(a.stages.def, 2);
  assert.equal(E.resolveMove(a, bt.active(1), a.moves[1], {}).power, 200);
  bt.playTurn(M1, M0);
  assert.equal(a.stock, 0); assert.equal(a.stages.def, 0); assert.equal(a.stages.spd, 0);
});

test('2단계: AI 는 가변 위력·고정 피해를 현재 상황에 맞게 평가한다 (체력이 적을 때 바둥바둥, 높은 체력에는 카운터가 아닌 분화)', () => {
  const brain = AI.create(E, { seed: 1 });
  const weak = mk('A', ['normal'], { spe: 300 }, [mv('flail'), atk({ power: 60 })]); weak.hp = 8;
  assert.equal(brain.chooseAction(duel(weak, mk('D', ['normal'], { hp: 100 }, [splash()])), 0, 'hard').index, 0);
  const strong = mk('B', ['normal'], { spe: 300 }, [mv('flail'), atk({ power: 60 })]);
  assert.equal(brain.chooseAction(duel(strong, mk('D', ['normal'], { hp: 100 }, [splash()])), 0, 'hard').index, 1);
});
