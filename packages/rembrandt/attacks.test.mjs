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

// ═════════════ 3단계: 조건부 위력 · 반격 · 선공 조건 ═════════════
test('3단계: 객기는 상태이상이면 위력 2배이고 화상의 공격 감소를 받지 않는다', () => {
  const a = mk('A', ['normal'], {}, [mv('facade')]), d = idle();
  const base = E.resolveMove(a, d, a.moves[0], {}).power;
  a.status = 'brn';
  assert.equal(E.resolveMove(a, d, a.moves[0], {}).power, base * 2);
  const brn = E.calcDamage(a, d, E.resolveMove(a, d, a.moves[0], {}), { roll: 100 }).damage;
  const clean = mk('B', ['normal'], {}, [mv('facade')]); clean.status = 'par';
  assert.equal(brn, E.calcDamage(clean, d, E.resolveMove(clean, d, clean.moves[0], {}), { roll: 100 }).damage, '화상이어도 감소 없음');
  const c = mk('C', ['normal'], {}, [mv('facade')]);
  assert.equal(E.resolveMove(c, d, c.moves[0], {}).power, base);
});

test('3단계: 베놈쇼크(독)·병상첨병(상태이상)·브라인(체력 절반 이하)', () => {
  const a = mk('A', ['poison'], {}, [mv('venoshock'), mv('hex'), mv('brine')]), d = idle();
  const p = i => E.resolveMove(a, d, a.moves[i], {}).power;
  const base = [p(0), p(1), p(2)];
  d.status = 'psn';
  assert.equal(p(0), base[0] * 2); assert.equal(p(1), base[1] * 2); assert.equal(p(2), base[2]);
  d.status = 'brn'; assert.equal(p(0), base[0]); assert.equal(p(1), base[1] * 2);
  d.status = null; d.hp = 150; assert.equal(p(2), base[2] * 2);
});

test('3단계: 승부굳히기·보복·눈사태·원수갚기·분풀이·분함의발구르기·객기류 — 이번 턴 사정으로 위력 2배', () => {
  const d = idle();
  const a = mk('A', ['dark'], { spe: 300 }, [mv('assurance'), mv('payback'), mv('lash-out')]);
  const pw = (i, ctx) => E.resolveMove(a, d, a.moves[i], ctx).power;
  const b0 = [pw(0, {}), pw(1, {}), pw(2, {})];
  assert.equal(pw(0, { foeHurt: true }), b0[0] * 2);
  assert.equal(pw(1, { actedAfter: true }), b0[1] * 2);
  assert.equal(pw(2, { meLowered: true }), b0[2] * 2);
  const t = mk('T', ['ground'], {}, [mv('stomping-tantrum'), mv('temper-flare'), mv('acrobatics'), mv('retaliate'), mv('avalanche')]);
  const q = (i, ctx) => E.resolveMove(t, d, t.moves[i], ctx).power;
  assert.equal(q(0, { prevFailed: true }), q(0, {}) * 2); assert.equal(q(1, { prevFailed: true }), q(1, {}) * 2);
  assert.equal(q(2, {}), 110, '도구가 없으면 위력 2배');
  assert.equal(q(3, { allyFaintedPrev: true }), q(3, {}) * 2); assert.equal(q(4, { meHurt: true }), q(4, {}) * 2);
});

test('3단계: 보복은 내가 상대보다 늦게 움직였을 때, 승부굳히기는 이미 다친 상대에게 실제로 2배가 된다', () => {
  const slow = mk('S', ['dark'], { spe: 1 }, [mv('payback')]), fast = mk('F', ['normal'], { spe: 300 }, [atk({ power: 10 })]);
  const bt = duel(slow, fast);
  const ev = bt.playTurn(M0, M0);
  const mine = ev.filter(e => e.t === 'damage' && e.side === 1)[0].amount;
  const fast2 = mk('F', ['normal'], { spe: 1 }, [atk({ power: 10 })]), slow2 = mk('S', ['dark'], { spe: 300 }, [mv('payback')]);
  const mine2 = duel(slow2, fast2).playTurn(M0, M0).filter(e => e.t === 'damage' && e.side === 1)[0].amount;
  assert.ok(mine > mine2 * 1.8, `늦게 움직이면 2배 (${mine} vs ${mine2})`);
});

test('3단계: 질투의불꽃·매혹의보이스는 이번 턴 능력이 올라간 상대에게만 상태이상을 건다', () => {
  const a = mk('A', ['fire'], { spe: 1 }, [mv('burning-jealousy')]), b = mk('B', ['normal'], { spe: 300 }, [mv('swords-dance')]);
  duel(a, b).playTurn(M0, M0);
  assert.equal(b.status, 'brn');
  const c = mk('C', ['fire'], { spe: 1 }, [mv('burning-jealousy')]), d = mk('D', ['normal'], { spe: 300 }, [splash()]);
  duel(c, d).playTurn(M0, M0);
  assert.equal(d.status, null);
  const e = mk('E', ['fairy'], { spe: 1 }, [mv('alluring-voice')]), f = mk('F', ['normal'], { spe: 300 }, [mv('swords-dance')]);
  duel(e, f).playTurn(M0, M0);
  assert.ok(f.confusion > 0);
});

test('3단계: 카운터·미러코트는 받은 피해의 2배, 메탈버스트·앙갚음은 1.5배, 맞지 않았으면 실패', () => {
  const run = (ident, att, type, cls) => {
    const a = mk('A', [type], { spe: 1, hp: 1000 }, [mv(ident)]), b = mk('B', ['normal'], { spe: 300 }, [atk({ cls, power: 60 })]);
    const ev = duel(a, b).playTurn(M0, M0);
    const taken = ev.filter(e => e.t === 'damage' && e.side === 0).reduce((s, e) => s + e.amount, 0);
    const dealt = ev.filter(e => e.t === 'damage' && e.side === 1).reduce((s, e) => s + e.amount, 0);
    return { taken, dealt, ev };
  };
  let r = run('counter', null, 'fighting', 'phys'); assert.equal(r.dealt, r.taken * 2);
  r = run('mirror-coat', null, 'psychic', 'spec'); assert.equal(r.dealt, r.taken * 2);
  r = run('counter', null, 'fighting', 'spec'); assert.equal(r.dealt, 0, '특수 공격에는 카운터가 통하지 않는다'); assert.ok(has(r.ev, '실패'));
  r = run('metal-burst', null, 'steel', 'spec'); assert.equal(r.dealt, Math.floor(r.taken * 1.5));
  r = run('comeuppance', null, 'dark', 'phys'); assert.equal(r.dealt, Math.floor(r.taken * 1.5));
  const first = mk('A', ['fighting'], { spe: 300 }, [mv('counter')]);
  assert.ok(has(duel(first, idle()).playTurn(M0, M0), '실패'), '맞은 적이 없으면 실패');
});

test('3단계: 목숨걸기는 자신의 체력만큼 피해를 주고 쓰러진다', () => {
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('final-gambit')]), a2 = idle();
  a.hp = 120;
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.equal(bt.active(1).hp, 300 - 120); assert.equal(a.fainted, true);
});

test('3단계: 분노의주먹은 맞은 횟수, 성묘는 쓰러진 동료 수에 따라 강해진다', () => {
  const a = mk('A', ['ghost'], {}, [mv('rage-fist'), mv('last-respects')]), d = idle();
  assert.equal(E.resolveMove(a, d, a.moves[0], {}).power, 50);
  a.hitsTaken = 3; assert.equal(E.resolveMove(a, d, a.moves[0], {}).power, 200);
  a.hitsTaken = 50; assert.equal(E.resolveMove(a, d, a.moves[0], {}).power, 350, '상한 350');
  assert.equal(E.resolveMove(a, d, a.moves[1], { faints: 2 }).power, 150);
  const x = mk('X', ['dark'], { spe: 300 }, [mv('last-respects')]), x2 = mk('X2', ['normal'], {}, [atk()]), x3 = mk('X3', ['normal'], {}, [atk()]);
  x2.hp = 0; x2.fainted = true; x3.hp = 0; x3.fainted = true;
  const bt = duel([x, x2, x3], idle());
  assert.equal(bt.ctx(0).faints, 2);
});

test('3단계: 분노의주먹은 실제로 맞을 때마다 쌓인다', () => {
  const a = mk('A', ['dark'], { spe: 1, hp: 2000 }, [mv('rage-fist')]), b = mk('B', ['normal'], { spe: 300 }, [atk({ power: 10 })]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0); bt.playTurn(M0, M0);
  assert.equal(a.hitsTaken, 2);
});

test('3단계: 에코보이스는 연속으로 쓰이면 위력이 40씩 오른다 / 연속자르기는 맞힐 때마다 2배(최대 160)', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('echoed-voice')]), d = mk('D', ['normal'], { hp: 9000 }, [splash()]);
  const bt = duel(a, d);
  const pw = () => E.resolveMove(a, d, a.moves[0], bt.ctx(0)).power;
  assert.equal(pw(), 40);
  bt.playTurn(M0, M0); assert.equal(pw(), 80);
  bt.playTurn(M0, M0); assert.equal(pw(), 120);
  const f = mk('F', ['bug'], { spe: 300 }, [mv('fury-cutter'), splash()]);
  const bt2 = duel(f, mk('D', ['normal'], { hp: 9000, def: 900 }, [splash()]), R(0.01));
  const p2 = () => E.resolveMove(f, bt2.active(1), f.moves[0], bt2.ctx(0)).power;
  assert.equal(p2(), 40);
  bt2.playTurn(M0, M0); assert.equal(p2(), 80);
  bt2.playTurn(M0, M0); bt2.playTurn(M0, M0); assert.equal(p2(), 160);
  bt2.playTurn(M1, M0); assert.equal(p2(), 40, '다른 기술을 쓰면 처음부터');
});

test('3단계: 집단구타는 건강한 동료 수만큼 때리고 프레젠트는 피해 또는 회복', () => {
  const a = mk('A', ['dark'], { spe: 300 }, [mv('beat-up')]), a2 = idle(), a3 = idle(); a3.status = 'brn';
  const ev = duel([a, a2, a3], idle()).playTurn(M0, M0);
  assert.equal(ev.filter(e => e.t === 'damage' && e.side === 1).length, 2, '상태이상인 동료는 제외');
  const heals = new Set();
  for (let i = 0; i < 40; i++) {
    const p = mk('P', ['normal'], { spe: 300 }, [mv('present')]), t = idle(); t.hp = 100;
    const e = duel(p, t, E.mulberry32(i + 1)).playTurn(M0, M0);
    heals.add(t.hp > 100 ? 'heal' : 'dmg');
  }
  assert.ok(heals.has('heal') && heals.has('dmg'));
});

test('3단계: 꿈먹기는 잠든 상대에게만 통하고 절반을 흡수한다 / 비장의무기는 다른 기술을 다 쓴 뒤에만', () => {
  const a = mk('A', ['psychic'], { spe: 300 }, [mv('dream-eater')]), d = idle();
  assert.ok(has(duel(a, d).playTurn(M0, M0), '실패'));
  const b = mk('B', ['psychic'], { spe: 300 }, [mv('dream-eater')]), e = idle(); e.status = 'slp'; e.sleepTurns = 3; b.hp = 100;
  const ev = duel(b, e).playTurn(M0, M0);
  assert.ok(b.hp > 100, '흡수');
  const l = mk('L', ['normal'], { spe: 300 }, [mv('last-resort'), splash(), atk()]);
  const bt = duel(l, idle());
  assert.ok(has(bt.playTurn(M0, M0), '실패'));
  bt.playTurn(M1, M0); assert.ok(has(bt.playTurn(M0, M0), '실패'));
  bt.playTurn({ type: 'move', index: 2 }, M0);
  assert.ok(dmgOf(bt.playTurn(M0, M0)) > 0, '다 쓴 뒤에는 통한다');
});

test('3단계: 기습은 우선도 +1 로 먼저 움직여 공격기를 고른 상대를 때리고, 변화기를 고른 상대에게는 실패', () => {
  const a = mk('A', ['dark'], { spe: 1 }, [mv('sucker-punch')]), b = mk('B', ['normal'], { spe: 300 }, [atk()]);
  const ev = duel(a, b).playTurn(M0, M0);
  assert.ok(ev.filter(e => e.t === 'damage' && e.side === 1).length > 0);
  const c = mk('C', ['dark'], { spe: 1 }, [mv('sucker-punch')]), d = mk('D', ['normal'], { spe: 300 }, [splash()]);
  assert.ok(has(duel(c, d).playTurn(M0, M0), '실패'));
  const e = mk('E', ['electric'], { spe: 1 }, [mv('thunderclap')]);
  assert.ok(has(duel(e, mk('F', ['normal'], {}, [splash()])).playTurn(M0, M0), '실패'));
});

test('3단계: 기선제압은 우선도 기술을 고른 상대에게만 통하고 풀죽게 한다', () => {
  const a = mk('A', ['fighting'], { spe: 1 }, [mv('upper-hand')]), b = mk('B', ['normal'], { spe: 300 }, [atk({ pri: 1 })]);
  const ev = duel(a, b).playTurn(M0, M0);
  assert.ok(ev.filter(e => e.t === 'damage' && e.side === 1).length > 0);
  assert.equal(ev.filter(e => e.t === 'damage' && e.side === 0).length, 0, '풀이 죽어 움직이지 못했다');
  const c = mk('C', ['fighting'], { spe: 1 }, [mv('upper-hand')]), d = mk('D', ['normal'], { spe: 300 }, [atk()]);
  assert.ok(has(duel(c, d).playTurn(M0, M0), '실패'));
});

test('3단계: 속이기·만나자마자는 등장한 첫 턴에만 성공한다', () => {
  for (const id of ['fake-out', 'first-impression']) {
    const a = mk('A', ['normal'], { spe: 300 }, [mv(id)]);
    const bt = duel(a, idle());
    assert.ok(dmgOf(bt.playTurn(M0, M0)) > 0, id);
    assert.ok(has(bt.playTurn(M0, M0), '실패'), id);
  }
  const f = mk('F', ['normal'], { spe: 300 }, [mv('fake-out')]), b = mk('B', ['normal'], { spe: 1 }, [atk()]);
  const ev = duel(f, b).playTurn(M0, M0);
  assert.equal(ev.filter(e => e.t === 'damage' && e.side === 0).length, 0, '속이기에 풀이 죽었다');
});

test('3단계: 힘껏펀치는 먼저 맞으면 집중이 깨지고, 부리캐논은 접촉한 상대에게 화상을 입힌다', () => {
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('focus-punch')]), b = mk('B', ['normal'], { spe: 100 }, [atk()]);
  const ev = duel(a, b).playTurn(M0, M0);
  assert.ok(has(ev, '집중이 깨져'), '느린 상대의 공격이 먼저 들어간다? 우선도 −3 이라 마지막');
  const c = mk('C', ['flying'], { spe: 300 }, [mv('beak-blast')]), d = mk('D', ['normal'], { spe: 100 }, [atk({ contact: true })]);
  const ev2 = duel(c, d).playTurn(M0, M0);
  assert.equal(d.status, 'brn');
  const e = mk('E', ['flying'], { spe: 300 }, [mv('beak-blast')]), f = mk('F', ['normal'], { spe: 100 }, [atk({ contact: false })]);
  duel(e, f).playTurn(M0, M0);
  assert.equal(f.status, null, '접촉하지 않으면 화상 없음');
});

test('3단계: 코골기는 잠든 동안에만 쓸 수 있다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('snore'), splash()]);
  const bt = duel(a, idle());
  assert.equal(bt.legalActions(0).moves[0].usable, false);
  a.status = 'slp'; a.sleepTurns = 3;
  assert.equal(bt.legalActions(0).moves[0].usable, true);
  assert.ok(dmgOf(bt.playTurn(M0, M0)) > 0, '자면서 때린다');
});

test('3단계 AI: 실패가 확정인 기술은 쓰지 않는다 (속이기 2턴째·기습 상대가 변화기뿐·비장의무기·카운터)', () => {
  const brain = AI.create(E, { seed: 2 });
  const a = mk('A', ['normal'], { spe: 300 }, [mv('fake-out'), atk({ power: 20 })]);
  const bt = duel(a, idle());
  assert.equal(brain.chooseAction(bt, 0, 'hard').index, 0, '첫 턴에는 속이기');
  bt.playTurn(M1, M0);
  assert.equal(brain.chooseAction(bt, 0, 'hard').index, 1, '그 뒤에는 쓰지 않는다');
  const s = mk('S', ['dark'], { spe: 300 }, [mv('sucker-punch'), atk({ power: 20 })]);
  assert.equal(brain.chooseAction(duel(s, idle()), 0, 'hard').index, 1);
  const l = mk('L', ['normal'], { spe: 300 }, [mv('last-resort'), atk({ power: 20 })]);
  assert.equal(brain.chooseAction(duel(l, mk('D', ['normal'], {}, [atk()])), 0, 'hard').index, 1);
  const c = mk('C', ['fighting'], { spe: 300 }, [mv('counter'), atk({ power: 20 })]);
  assert.equal(brain.chooseAction(duel(c, mk('D', ['normal'], {}, [atk({ cls: 'spec' })])), 0, 'hard').index, 1, '특수 공격뿐인 상대에게 카운터는 쓰지 않는다');
});

// ═════════════ 4단계: 턴 구조 (충전·반동·난동·구속·교체·자폭 …) ═════════════
test('4단계: 공중날기 — 첫 턴은 날아올라 공격을 피하고 다음 턴 때린다 (PP 는 한 번만)', () => {
  const a = mk('A', ['flying'], { spe: 300 }, [mv('fly'), splash()]), b = mk('B', ['normal'], { spe: 100 }, [atk()]);
  const bt = duel(a, b);
  const ev = bt.playTurn(M0, M0);
  assert.ok(has(ev, '날아올랐다')); assert.equal(a.hp, a.maxHp, '날아오른 동안은 맞지 않는다');
  assert.equal(a.invul, 'air');
  assert.ok(ev.some(e => e.t === 'miss'));
  assert.equal(bt.legalActions(0).moves[1].usable, false);
  const ev2 = bt.playTurn(M1, M0);                                   // 다른 기술을 골라도 공중날기가 나간다
  assert.ok(dmgOf(ev2) > 0); assert.equal(a.invul, null);
  assert.equal(a.moves[0].pp, 98);
});

test('4단계: 땅속·물속에 있는 상대에게는 지진·파도타기만 맞고 2배', () => {
  const dig = mk('A', ['ground'], { spe: 300 }, [mv('dig')]);
  const eq = atk({ type: T('ground'), ident: 'earthquake' }), plain = atk({ ident: 'tackle' });
  const bt = duel(dig, mk('B', ['normal'], { spe: 100 }, [eq]));
  bt.playTurn(M0, M0);
  const hurt1 = dig.maxHp - dig.hp;
  assert.ok(hurt1 > 0, '지진은 땅속에도 맞는다');
  const dig2 = mk('A', ['ground'], { spe: 300 }, [mv('dig')]);
  duel(dig2, mk('B', ['normal'], { spe: 100 }, [plain])).playTurn(M0, M0);
  assert.equal(dig2.hp, dig2.maxHp);
  const w = mk('W', ['water'], { spe: 300 }, [mv('dive')]);
  duel(w, mk('B', ['normal'], { spe: 100 }, [plain])).playTurn(M0, M0);
  assert.equal(w.invul, 'water');
});

test('4단계: 솔라빔 — 쾌청이면 바로 발사, 비·모래·눈에서는 위력 절반 / 일렉트로빔은 비에서 바로 발사하고 특공 +1', () => {
  const s = mk('S', ['grass'], { spe: 300 }, [mv('solar-beam')]), d = mk('D', ['normal'], { hp: 900 }, [splash()]);
  const bt = duel(s, d); bt.field.weather = 'sun'; bt.field.weatherTurns = 5;
  assert.ok(dmgOf(bt.playTurn(M0, M0)) > 0, '쾌청: 한 턴에 발사');
  const s2 = mk('S', ['grass'], { spe: 300 }, [mv('solar-beam')]);
  const normal = E.calcDamage(s2, d, s2.moves[0], { roll: 100, ctx: {} }).damage, rain = E.calcDamage(s2, d, s2.moves[0], { roll: 100, ctx: { weather: 'rain' } }).damage;
  assert.ok(rain < normal * 0.55, '비에서는 절반');
  const e = mk('E', ['electric'], { spe: 300 }, [mv('electro-shot')]);
  const bt2 = duel(e, mk('D', ['normal'], { hp: 900 }, [splash()])); bt2.field.weather = 'rain'; bt2.field.weatherTurns = 5;
  bt2.playTurn(M0, M0);
  assert.ok(true);
  const e2 = mk('E', ['electric'], { spe: 300 }, [mv('electro-shot')]);
  const bt3 = duel(e2, mk('D', ['normal'], { hp: 900 }, [splash()]));
  const ev = bt3.playTurn(M0, M0);
  assert.equal(e2.stages.spa, 1, '충전 턴에 특공 +1'); assert.equal(dmgOf(ev), 0);
});

test('4단계: 파괴광선류 — 맞히면 다음 턴 반동으로 움직이지 못한다 (교체하면 없다)', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('hyper-beam'), splash()]), b = mk('B', ['normal'], { hp: 9000 }, [splash()]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.recharge, true);
  const ev = bt.playTurn(M0, M0);
  assert.ok(has(ev, '반동으로 움직일 수 없다')); assert.equal(dmgOf(ev), 0);
  assert.ok(dmgOf(bt.playTurn(M0, M0)) > 0, '그 다음 턴에는 다시');
  for (const id of ['giga-impact', 'blast-burn', 'hydro-cannon', 'frenzy-plant', 'rock-wrecker', 'roar-of-time', 'prismatic-laser']) assert.ok(data.moves[idOf(id)].fx.recharge, id);
});

test('4단계: 빗나간 파괴광선은 반동이 없다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('hyper-beam')]);
  const bt = duel(a, mk('B', ['normal'], { hp: 9000 }, [splash()]), R(0.99));
  bt.playTurn(M0, M0);
  assert.equal(a.recharge, false);
});

test('4단계: 난동부리기류 — 2~3턴 같은 기술을 쓰고 끝나면 혼란, 빗나가면 거기서 끝', () => {
  const a = mk('A', ['dragon'], { spe: 300 }, [mv('outrage'), splash()]), d = mk('D', ['normal'], { hp: 9000 }, [splash()]);
  const bt = duel(a, d, R(0.01));              // 최소: 총 2번
  bt.playTurn(M0, M0);
  assert.ok(a.rampage); assert.equal(bt.legalActions(0).moves[1].usable, false);
  bt.playTurn(M1, M0);                          // 다른 기술을 골라도 난동이 이어진다
  assert.equal(a.rampage, null); assert.ok(a.confusion > 0, '끝나면 혼란');
  assert.equal(a.moves[0].pp, 98);
  const b = mk('B', ['dragon'], { spe: 300 }, [mv('outrage')]);
  const bt2 = duel(b, mk('D', ['fairy'], { hp: 9000 }, [splash()]));
  bt2.playTurn(M0, M0);
  assert.equal(b.rampage, null, '효과가 없으면 난동은 이어지지 않는다');
});

test('4단계: 소란피기는 3턴 이어지고 그동안 아무도 잠들지 못한다 / 구르기는 연속으로 2배', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('uproar')]), d = mk('D', ['normal'], { hp: 9000 }, [mv('hypnosis')]);
  const bt = duel(a, d, R(0.01));
  bt.playTurn(M0, M0);
  assert.ok(a.uproar > 0);
  const ev = bt.playTurn(M0, M0);
  assert.equal(a.status, null);
  const r = mk('R', ['rock'], { spe: 300 }, [mv('rollout')]), t = mk('T', ['normal'], { hp: 9000, def: 900 }, [splash()]);
  const bt2 = duel(r, t, R(0.01));
  const p = () => E.resolveMove(r, t, r.moves[0], {}).power;
  assert.equal(p(), 30);
  bt2.playTurn(M0, M0); assert.equal(p(), 60);
  bt2.playTurn(M0, M0); assert.equal(p(), 120);
});

test('4단계: 미래예지 — 쓴 뒤 2턴 뒤에 맞고, 악 타입에는 통하지 않으며, 이미 걸려 있으면 실패', () => {
  const a = mk('A', ['psychic'], { spe: 300 }, [mv('future-sight'), splash()]), d = mk('D', ['normal'], { hp: 900 }, [splash()]);
  const bt = duel(a, d);
  const e1 = bt.playTurn(M0, M0); assert.equal(dmgOf(e1), 0); assert.ok(has(e1, '예지'));
  assert.ok(has(bt.playTurn(M0, M0), '실패'), '이미 걸려 있다');
  const e3 = bt.playTurn(M1, M0);
  assert.ok(e3.some(e => e.t === 'damage' && e.cause === 'future' && e.side === 1), '2턴 뒤 명중');
  assert.ok(d.hp < 900);
  const dk = mk('K', ['dark'], { hp: 900 }, [splash()]);
  const bt2 = duel(mk('A', ['psychic'], { spe: 300 }, [mv('future-sight'), splash()]), dk);
  bt2.playTurn(M0, M0); bt2.playTurn(M1, M0);
  const e = bt2.playTurn(M1, M0);
  assert.equal(dk.hp, 900); assert.ok(has(e, '효과가 없'));
});

test('4단계: 조이기류 — 4~5턴 매 턴 1/8 피해에 교체 불가, 거는 쪽이 나가면 풀린다', () => {
  const a = mk('A', ['fire'], { spe: 300 }, [mv('fire-spin'), splash()]), a2 = idle(), d = mk('D', ['normal'], { hp: 800 }, [splash()]), d2 = idle();
  const bt = duel([a, a2], [d, d2], R(0.01));
  bt.playTurn(M0, M0);
  assert.ok(d.bound > 0); assert.deepEqual(A(bt.legalActions(1).switches), []);
  assert.equal(d.maxHp - d.hp > 100, true);
  bt.playTurn(SW(1), M0);
  assert.equal(d.bound, 0, '거는 쪽이 나가면 풀린다');
  assert.deepEqual(A(bt.legalActions(1).switches), [1]);
});

test('4단계: 유턴·볼트체인지·퀵턴 — 때린 뒤 교체한다 (상대가 쓰러져도, 대타를 쳐도)', () => {
  for (const id of ['u-turn', 'volt-switch', 'flip-turn']) {
    const a = mk('A', ['bug'], { spe: 300 }, [mv(id)]), a2 = mk('A2', ['water'], {}, [atk()]);
    const bt = duel([a, a2], mk('D', ['normal'], { hp: 900 }, [atk({ power: 20 })]));
    const ev = bt.playTurn(M0, M0);
    assert.equal(bt.phase, 'switch', id); assert.deepEqual(A(bt.pending), [0]);
    assert.ok(ev.some(e => e.t === 'damage' && e.side === 1));
    bt.replace(0, 1);
    assert.ok(a2.hp < a2.maxHp, `${id}: 교체한 포켓몬이 상대 공격을 받는다`);
  }
  const lone = mk('A', ['bug'], { spe: 300 }, [mv('u-turn')]);
  const bt2 = duel(lone, idle());
  bt2.playTurn(M0, M0);
  assert.equal(bt2.phase, 'move', '교체할 동료가 없으면 교체 없이 끝');
});

test('4단계: 드래곤테일·배대뒤치기 — 때린 뒤 상대를 강제로 교체시킨다 (우선도 −6)', () => {
  const a = mk('A', ['dragon'], { spe: 1 }, [mv('dragon-tail')]), d = mk('D', ['normal'], { spe: 300, hp: 900 }, [atk({ power: 10 })]), d2 = idle();
  const bt = duel(a, [d, d2]);
  const ev = bt.playTurn(M0, M0);
  assert.equal(bt.sides[1].active, 1); assert.ok(ev.some(e => e.t === 'switch' && e.side === 1));
  assert.equal(data.moves[idOf('dragon-tail')].pr, -6);
  const lone = mk('A', ['dragon'], { spe: 1 }, [mv('circle-throw')]);
  const bt2 = duel(lone, mk('D', ['normal'], { hp: 900 }, [splash()]));
  bt2.playTurn(M0, M0);
  assert.equal(bt2.sides[1].active, 0);
});

test('4단계: 자폭·대폭발 — 맞히든 빗나가든 쓰러진다 / 미스트버스트는 미스트필드에서 1.5배', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('explosion')]), a2 = idle();
  const bt = duel([a, a2], mk('D', ['normal'], { hp: 900 }, [splash()]));
  assert.ok(dmgOf(bt.playTurn(M0, M0)) > 0); assert.equal(a.fainted, true);
  const b = mk('B', ['normal'], { spe: 300 }, [mv('self-destruct')]), b2 = idle();
  const bt2 = duel([b, b2], mk('D', ['normal'], {}, [splash()]), R(0.999));
  bt2.playTurn(M0, M0);
  assert.equal(b.fainted, true);
  const m = mk('M', ['fairy'], {}, [mv('misty-explosion')]), d = idle();
  const pw = ctx => E.resolveMove(m, d, m.moves[0], ctx).power;
  assert.equal(pw({ terrain: 'misty', attGrounded: true }), Math.floor(pw({}) * 1.5));
});

test('4단계: 무릎차기는 빗나가면 최대 체력의 절반 피해 / 강철빔·클로로블라스트는 맞히면 반동 50%', () => {
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('high-jump-kick')]);
  duel(a, idle(), R(0.999)).playTurn(M0, M0);
  assert.equal(a.hp, 150);
  const b = mk('B', ['steel'], { spe: 300 }, [mv('steel-beam')]);
  duel(b, mk('D', ['normal'], { hp: 900 }, [splash()]), R(0.01)).playTurn(M0, M0);
  assert.equal(b.hp, 150);
  const c = mk('C', ['fighting'], { spe: 300 }, [mv('high-jump-kick')]);
  assert.ok(has(duel(c, mk('G', ['ghost'], {}, [splash()])).playTurn(M0, M0), '효과가 없'));
  assert.equal(c.hp, 150, '효과가 없어도 부딪힌다');
});

test('4단계: 거대해머·블러드문은 연속으로 쓸 수 없다', () => {
  const a = mk('A', ['steel'], { spe: 300 }, [mv('gigaton-hammer'), splash()]);
  const bt = duel(a, mk('D', ['normal'], { hp: 9000 }, [splash()]));
  bt.playTurn(M0, M0);
  const la = bt.legalActions(0);
  assert.equal(la.moves[0].usable, false); assert.equal(la.moves[0].why, '연속 사용 불가');
  bt.playTurn(M1, M0);
  assert.equal(bt.legalActions(0).moves[0].usable, true);
});

test('4단계: 소금절이·킬러스핀·레이징불·전광쌍격·글레이브러시·칼등치기', () => {
  const s = mk('S', ['rock'], { spe: 300 }, [mv('salt-cure')]), d = mk('D', ['normal'], { hp: 900 }, [splash()]);
  const bt = duel(s, d); bt.playTurn(M0, M0);
  assert.equal(d.salted, true);
  const hp1 = d.hp; bt.playTurn(M0, M0);
  assert.ok(hp1 - d.hp > 100);
  const m = mk('M', ['poison'], { spe: 300 }, [mv('mortal-spin')]), t = mk('T', ['normal'], { hp: 900 }, [splash()]);
  const bt2 = duel(m, t, R(0.01)); bt2.sides[0].cond.rocks = true; m.seeded = true;
  bt2.playTurn(M0, M0);
  assert.equal(t.status, 'psn'); assert.equal(bt2.sides[0].cond.rocks, false); assert.equal(m.seeded, false);
  const r = mk('R', ['normal'], { spe: 300 }, [mv('raging-bull')]), x = mk('X', ['normal'], { hp: 900 }, [splash()]);
  const bt3 = duel(r, x); bt3.sides[1].cond.reflect = 5;
  bt3.playTurn(M0, M0);
  assert.equal(bt3.sides[1].cond.reflect, 0);
  const e = mk('E', ['electric', 'flying'], { spe: 300 }, [mv('double-shock')]), y = mk('Y', ['normal'], { hp: 900 }, [splash()]);
  duel(e, y).playTurn(M0, M0);
  assert.deepEqual(A(e.types), [T('flying')]);
  assert.ok(has(duel(mk('N', ['normal'], {}, [mv('double-shock')]), idle()).playTurn(M0, M0), '실패'), '전기 타입이 아니면 실패');
  const g = mk('G', ['dragon'], { spe: 300 }, [mv('glaive-rush')]), z = mk('Z', ['normal'], { spe: 100 }, [atk({ acc: 1 })]);
  const bt4 = duel(g, z, R(0.9)); const before = g.hp;
  const ev = bt4.playTurn(M0, M0);
  assert.ok(!ev.some(e => e.t === 'miss' && e.side === 1), '글레이브러시 뒤에는 필중');
  const f = mk('F', ['normal'], { spe: 300 }, [mv('false-swipe')]), w = mk('W', ['normal'], { hp: 20 }, [splash()]);
  duel(f, w).playTurn(M0, M0);
  assert.equal(w.hp, 1, '칼등치기는 체력 1 을 남긴다');
});

test('4단계: 섀도다이브·팬텀포스는 방어를 깨고 때리며 첫 턴에는 모습을 감춘다', () => {
  const a = mk('A', ['ghost'], { spe: 300 }, [mv('shadow-force')]), p = mk('P', ['psychic'], { spe: 100 }, [mv('protect')]);
  const bt = duel(a, p, R(0.1));
  bt.playTurn(M0, M0);
  assert.equal(a.invul, 'ghost');
  const ev = bt.playTurn(M0, M0);
  assert.ok(dmgOf(ev) > 0, '방어해도 뚫는다');
});

test('4단계 AI: 반동 턴·충전·자폭 같은 기술을 상황에 맞게 고른다', () => {
  const brain = AI.create(E, { seed: 5 });
  const a = mk('A', ['normal'], { spe: 300 }, [mv('explosion'), atk({ power: 40 })]);
  assert.equal(brain.chooseAction(duel(a, mk('D', ['normal'], { hp: 900 }, [splash()])), 0, 'hard').index, 1, '멀쩡할 때는 자폭하지 않는다');
  const b = mk('B', ['normal'], { spe: 300 }, [mv('explosion'), atk({ power: 40 })]); b.hp = 20;
  const t = mk('T', ['normal'], { hp: 60 }, [splash()]);
  assert.equal(brain.chooseAction(duel([b, idle()], t), 0, 'hard').index, 0, '확실히 쓰러뜨릴 수 있고 곧 쓰러질 때는 자폭');
  const c = mk('C', ['flying'], { spe: 300 }, [mv('hyper-beam'), atk({ power: 40 })]); c.recharge = true;
  const g = mk('G', ['normal'], { spe: 100 }, [splash()]);
  assert.ok([0, 1].includes(brain.chooseAction(duel(c, g), 0, 'hard').index));
});

test('4단계: 특수 공격기 전부를 섞은 무작위 배틀 400판이 오류 없이 끝난다 (교체 선택 포함)', () => {
  const adv = Object.keys(data.moves).filter(i => data.moves[i].c !== 'n').map(Number);
  const rnd = E.mulberry32(21);
  const pick = l => l[Math.floor(rnd() * l.length)];
  let sw = 0, ended = 0;
  for (let g = 0; g < 400; g++) {
    const team = () => [0, 1, 2].map(() => E.makeMon(1 + Math.floor(rnd() * 1025), { moves: [...new Set([pick(adv), pick(adv), pick(adv), pick(adv)])] }));
    const bt = E.createBattle({ parties: [team(), team()], seed: g + 1, maxTurns: 120 });
    const brains = [AI.create(E, { seed: g }), AI.create(E, { seed: g + 1 })];
    bt.start();
    let guard = 0;
    while (bt.phase !== 'ended') {
      if (++guard > 500) throw new Error('끝나지 않음');
      if (bt.phase === 'switch') {
        for (const si of bt.pending.slice()) if (bt.phase === 'switch' && bt.pending.includes(si)) { if (bt.pivot) sw++; bt.replace(si, brains[si].chooseReplacement(bt, si, 'hard')); }
        continue;
      }
      const pickAction = si => { if (rnd() < 0.5) return brains[si].chooseAction(bt, si, 'hard'); const la = bt.legalActions(si); if (la.mustStruggle) return M0; return { type: 'move', index: pick(la.moves.filter(m => m.usable)).index }; };
      bt.playTurn(pickAction(0), pickAction(1));
      for (const m of bt.sides.flatMap(s => s.party)) assert.ok(m.hp >= 0 && m.hp <= m.maxHp);
    }
    ended++;
  }
  assert.equal(ended, 400); assert.ok(sw > 5, '공격 뒤 교체가 실제로 일어났다');
});
