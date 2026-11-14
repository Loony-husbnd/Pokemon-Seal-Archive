// 변화기 2단계 테스트 (날씨·필드·함정·벽·지속 효과·보호·대타 …):  npm run test:battle
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../../tools/lib/load-battle.mjs';

const { engine: E, data, ai: AI, party: PT } = loadBattle();
const T = name => data.types.find(t => t.e === name).id;
const A = x => [...x];
const idOf = ident => Object.keys(data.moves).find(i => data.moves[i].e === ident);
/** 실제 데이터의 기술 (PP 는 넉넉하게) */
const mv = ident => { const m = E.makeMove(idOf(ident)); m.pp = m.maxPp = 99; return m; };
const atk = over => Object.assign({ id: 999, name: '공격', type: T('normal'), cls: 'phys', power: 80, acc: 100, pp: 99, maxPp: 99, pri: 0, fx: {} }, over);
function mk(name, types, stats, moves) {
  return E.makeCustomMon({
    name, types: types.map(T),
    stats: Object.assign({ hp: 300, atk: 200, def: 200, spa: 200, spd: 200, spe: 100 }, stats),
    moves,
  });
}
const R = v => () => v;
function duel(a, b, rng) {
  const bt = E.createBattle({ parties: [Array.isArray(a) ? a : [a], Array.isArray(b) ? b : [b]], rng: rng || R(0.5) });
  bt.start();
  return bt;
}
const M0 = { type: 'move', index: 0 }, M1 = { type: 'move', index: 1 }, M2 = { type: 'move', index: 2 };
const SW = to => ({ type: 'switch', to });
const texts = ev => ev.map(e => e.text).filter(Boolean);
const has = (ev, s) => texts(ev).some(t => t.includes(s));
const fx = ident => data.moves[idOf(ident)].fx;

// ───────────── 날씨 ─────────────
test('날씨: 5턴 동안 이어지고 끝나면 그친다. 같은 날씨는 다시 못 건다', () => {
  const a = mk('A', ['normal'], {}, [mv('rain-dance')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  const ev = bt.playTurn(M0, M0);
  assert.equal(bt.field.weather, 'rain');
  assert.ok(ev.some(e => e.t === 'field' && e.weather === 'rain'));
  const ev2 = bt.playTurn(M0, M0);
  assert.ok(has(ev2, '실패'), '이미 비가 오는데 또 비바라기');
  for (let i = 0; i < 3; i++) bt.playTurn(M0, M0);
  assert.equal(bt.field.weather, null, '1+4턴 뒤에는 그친다');
});

test('날씨와 데미지: 비는 물 ×1.5·불꽃 ×0.5, 쾌청은 반대', () => {
  const a = mk('A', ['psychic'], {}, [atk()]), d = mk('D', ['normal'], {}, [atk()]);   // 자속 보정이 없게 에스퍼가 노말을 때린다
  const water = atk({ type: T('water') }), fire = atk({ type: T('fire') });
  const dmg = (m, weather) => E.calcDamage(a, d, m, { roll: 100, ctx: weather ? { weather } : undefined }).damage;
  assert.equal(dmg(water), 69);
  assert.equal(dmg(water, 'rain'), 103);
  assert.equal(dmg(fire, 'rain'), 34);
  assert.equal(dmg(fire, 'sun'), 103);
  assert.equal(dmg(water, 'sun'), 34);
  assert.equal(dmg(atk(), 'rain'), 69, '노말은 영향 없음');
});

test('모래바람: 바위·땅·강철이 아니면 매 턴 1/16 피해, 바위는 특수방어 ×1.5, 눈은 얼음 방어 ×1.5', () => {
  const a = mk('A', ['normal'], {}, [mv('sandstorm')]);
  const b = mk('B', ['normal'], {}, [mv('splash')]), r = mk('R', ['rock'], {}, [mv('splash')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 300 - 18);
  assert.equal(b.hp, 300 - 18);
  const bt2 = duel(mk('A', ['normal'], {}, [mv('sandstorm')]), r);
  bt2.playTurn(M0, M0);
  assert.equal(r.hp, 300, '바위 타입은 모래바람 피해가 없다');
  const att = mk('X', ['psychic'], {}, [atk()]);
  const spec = atk({ cls: 'spec', type: T('dark') });     // 악 기술은 바위·얼음에게 등배
  assert.equal(E.calcDamage(att, r, spec, { roll: 100, ctx: {} }).damage, 69, '날씨 없음 기준');
  assert.equal(E.calcDamage(att, r, spec, { roll: 100, ctx: { weather: 'sand' } }).damage, 46);
  const ice = mk('I', ['ice'], {}, [mv('splash')]);
  assert.equal(E.calcDamage(att, ice, atk({ type: T('dark') }), { roll: 100, ctx: { weather: 'snow' } }).damage, 46);
});

test('달빛·광합성류: 날씨별 회복량 (맑음 2/3, 그 밖의 날씨 1/4, 없음 1/2)', () => {
  const heal = weather => {
    const a = mk('A', ['normal'], {}, [mv('moonlight')]), b = mk('B', ['normal'], {}, [mv('splash')]);
    const bt = duel(a, b);
    if (weather) { bt.field.weather = weather; bt.field.weatherTurns = 9; }
    a.hp = 10;
    bt.playTurn(M0, M0);
    return a.hp - 10 + (weather === 'sand' ? 18 : 0);   // 모래바람 피해 보정
  };
  assert.equal(heal(null), 150);
  assert.equal(heal('sun'), 200);
  assert.equal(heal('rain'), 75);
});

// ───────────── 필드 ─────────────
test('일렉트릭필드: 땅에 있는 포켓몬은 잠들지 않고, 전기 기술이 강해진다', () => {
  const a = mk('A', ['normal'], {}, [mv('electric-terrain'), mv('hypnosis')]);
  const b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(bt.field.terrain, 'electric');
  const ev = bt.playTurn(M1, M0);
  assert.equal(b.status, null);
  assert.ok(has(ev, '일렉트릭필드'));
  const att = mk('X', ['normal'], {}, [atk()]), d = mk('D', ['normal'], {}, [atk()]);
  const elec = atk({ type: T('electric') });
  assert.equal(E.calcDamage(att, d, elec, { roll: 100, ctx: { terrain: 'electric', attGrounded: true } }).damage, 89);
  assert.equal(E.calcDamage(att, d, elec, { roll: 100, ctx: { terrain: 'electric', attGrounded: false } }).damage, 69);
});

test('그래스필드: 땅에 있는 포켓몬이 매 턴 1/16 회복. 날아다니는 포켓몬은 제외', () => {
  const a = mk('A', ['normal'], {}, [mv('grassy-terrain')]), b = mk('B', ['flying'], {}, [mv('splash')]);
  const bt = duel(a, b);
  a.hp = 100; b.hp = 100;
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 100 + 18);
  assert.equal(b.hp, 100);
});

test('미스트필드: 상태이상 방지. 사이코필드: 선제 공격 방지', () => {
  const a = mk('A', ['normal'], {}, [mv('misty-terrain'), mv('toxic')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  bt.playTurn(M1, M0);
  assert.equal(b.status, null);
  const q = mk('Q', ['normal'], {}, [atk({ pri: 1 })]), p = mk('P', ['normal'], {}, [mv('psychic-terrain')]);
  const bt2 = duel(q, p);
  bt2.playTurn(M0, M0);                       // 사이코필드가 깔린 턴: 선제기는 이미 먼저 나갔으므로 피해를 줄 수 있다
  const hp = p.hp;
  const ev = bt2.playTurn(M0, { type: 'move', index: 0 });
  assert.equal(p.hp, hp, '사이코필드가 깔려 있으면 선제기가 막힌다');
  assert.ok(has(ev, '사이코필드'));
});

test('필드는 5턴 뒤 사라지고, 트릭룸은 느린 쪽이 먼저 움직인다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('trick-room'), mv('splash')]), b = mk('B', ['normal'], { spe: 50 }, [mv('splash')]);
  const bt = duel(a, b);
  let ev = bt.playTurn(M1, M0);
  assert.equal(ev.filter(e => e.t === 'move')[0].side, 0, '평소에는 빠른 쪽이 먼저');
  bt.playTurn(M0, M0);                         // 트릭룸 (우선도 −7 이라 마지막)
  assert.equal(bt.field.room, 4);
  ev = bt.playTurn(M1, M0);
  assert.equal(ev.filter(e => e.t === 'move')[0].side, 1, '트릭룸에서는 느린 쪽이 먼저');
  for (let i = 0; i < 3; i++) bt.playTurn(M1, M0);
  assert.equal(bt.field.room, 0);
});

// ───────────── 함정 ─────────────
function hazardDuel(setter, victimTypes, victimHp) {
  const a = mk('A', ['normal'], {}, [mv(setter), mv('splash')]);
  const b0 = mk('B0', ['normal'], {}, [mv('splash')]), b1 = mk('B1', victimTypes || ['normal'], { hp: victimHp || 300 }, [mv('splash')]);
  const bt = duel(a, [b0, b1]);
  return { bt, a, b0, b1 };
}
test('스텔스록: 교체해 나오면 바위 상성만큼 피해 (불꽃은 4배)', () => {
  let { bt, b1 } = hazardDuel('stealth-rock', ['normal']);
  bt.playTurn(M0, M0);
  bt.playTurn(M1, SW(1));
  assert.equal(b1.hp, 300 - 37);
  ({ bt, b1 } = hazardDuel('stealth-rock', ['fire']));
  bt.playTurn(M0, M0);
  bt.playTurn(M1, SW(1));
  assert.equal(b1.hp, 300 - 75, '불꽃은 바위에 2배');
  ({ bt, b1 } = hazardDuel('stealth-rock', ['fire', 'flying']));
  bt.playTurn(M0, M0);
  bt.playTurn(M1, SW(1));
  assert.equal(b1.hp, 300 - 150, '불꽃/비행은 4배');
});

test('압정: 겹칠수록 아프고(1/8, 1/6, 1/4), 날아다니는 포켓몬은 피한다', () => {
  for (const [layers, loss] of [[1, 37], [2, 50], [3, 75]]) {
    const { bt, b1 } = hazardDuel('spikes');
    for (let i = 0; i < layers; i++) bt.playTurn(M0, M0);
    bt.playTurn(M1, SW(1));
    assert.equal(b1.hp, 300 - loss, `${layers}겹`);
  }
  const { bt, b1 } = hazardDuel('spikes', ['flying']);
  bt.playTurn(M0, M0); bt.playTurn(M1, SW(1));
  assert.equal(b1.hp, 300);
});

test('독압정: 1겹 독, 2겹 맹독. 독 타입은 흡수해 없앤다, 강철은 면역', () => {
  let { bt, b1 } = hazardDuel('toxic-spikes');
  bt.playTurn(M0, M0); bt.playTurn(M1, SW(1));
  assert.equal(b1.status, 'psn');
  ({ bt, b1 } = hazardDuel('toxic-spikes'));
  bt.playTurn(M0, M0); bt.playTurn(M0, M0); bt.playTurn(M1, SW(1));
  assert.equal(b1.status, 'tox');
  ({ bt, b1 } = hazardDuel('toxic-spikes', ['poison']));
  bt.playTurn(M0, M0); bt.playTurn(M1, SW(1));
  assert.equal(b1.status, null);
  assert.equal(bt.sides[1].cond.tspikes, 0);
  ({ bt, b1 } = hazardDuel('toxic-spikes', ['steel']));
  bt.playTurn(M0, M0); bt.playTurn(M1, SW(1));
  assert.equal(b1.status, null);
});

test('끈적끈적네트: 스피드 −1. 하얀안개는 함정과 상대의 벽을 날린다', () => {
  const { bt, b1 } = hazardDuel('sticky-web');
  bt.playTurn(M0, M0); bt.playTurn(M1, SW(1));
  assert.equal(b1.stages.spe, -1);
  const a = mk('A', ['normal'], {}, [mv('defog'), mv('splash')]), b = mk('B', ['normal'], {}, [mv('stealth-rock'), mv('reflect'), mv('splash')]);
  const bt2 = duel(a, b);
  bt2.playTurn(M1, M0); bt2.playTurn(M1, M1);
  assert.ok(bt2.sides[0].cond.rocks && bt2.sides[1].cond.reflect > 0);
  bt2.playTurn(M0, M2);
  assert.equal(bt2.sides[0].cond.rocks, false);
  assert.equal(bt2.sides[1].cond.reflect, 0);
});

test('함정에 걸려 쓰러지면 다시 교체를 고른다', () => {
  const a = mk('A', ['normal'], {}, [mv('stealth-rock'), atk()]);
  const b0 = mk('B0', ['normal'], {}, [mv('splash')]), b1 = mk('B1', ['normal'], {}, [mv('splash')]), b2 = mk('B2', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, [b0, b1, b2]);
  bt.playTurn(M0, M0);
  b0.hp = 1; b1.hp = 5;
  bt.playTurn(M1, M0);
  assert.equal(bt.phase, 'switch');
  bt.replace(1, 1);
  assert.ok(b1.fainted, '나오자마자 쓰러졌다');
  assert.equal(bt.phase, 'switch');
  assert.deepEqual(A(bt.pending), [1]);
  bt.replace(1, 2);
  assert.equal(bt.phase, 'move');
});

// ───────────── 벽 · 측면 ─────────────
test('리플렉터: 물리 피해 절반, 특수는 그대로, 급소는 무시, 5턴 뒤 사라짐', () => {
  const a = mk('A', ['normal'], {}, [mv('reflect'), mv('splash')]), b = mk('B', ['psychic'], {}, [atk()]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.ok(bt.sides[0].cond.reflect > 0);
  const phys = atk(), spec = atk({ cls: 'spec' });
  assert.equal(E.calcDamage(b, a, phys, { roll: 100, ctx: bt.ctx(1) }).damage, 34);
  assert.equal(E.calcDamage(b, a, spec, { roll: 100, ctx: bt.ctx(1) }).damage, 69);
  assert.equal(E.calcDamage(b, a, phys, { roll: 100, crit: true, ctx: bt.ctx(1) }).damage, 103);
  for (let i = 0; i < 4; i++) bt.playTurn(M1, M0);
  assert.equal(bt.sides[0].cond.reflect, 0);
});

test('오로라베일은 눈이 올 때만 칠 수 있다', () => {
  const a = mk('A', ['normal'], {}, [mv('aurora-veil'), mv('snowscape')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  assert.ok(has(bt.playTurn(M0, M0), '실패'));
  bt.playTurn(M1, M0);
  bt.playTurn(M0, M0);
  assert.ok(bt.sides[0].cond.veil > 0);
});

test('순풍은 스피드 2배, 신비의부적은 상태이상 방지, 미스트는 능력 하락 방지', () => {
  let a = mk('A', ['normal'], {}, [mv('tailwind')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  let bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(bt.speedOf(0), 200);
  a = mk('A', ['normal'], {}, [mv('safeguard'), mv('splash')]); b = mk('B', ['normal'], {}, [mv('toxic')]);
  bt = duel(a, b);
  bt.playTurn(M0, M0);
  const ev = bt.playTurn(M1, M0);
  assert.equal(a.status, null);
  assert.ok(has(ev, '신비의부적'));
  a = mk('A', ['normal'], {}, [mv('mist'), mv('splash')]); b = mk('B', ['normal'], {}, [mv('growl')]);
  bt = duel(a, b);
  bt.playTurn(M0, M0);
  const ev2 = bt.playTurn(M1, M0);
  assert.equal(a.stages.atk, 0);
  assert.ok(has(ev2, '미스트'));
});

// ───────────── 지속 상태 ─────────────
test('씨뿌리기: 매 턴 1/8 빼앗아 상대가 회복. 풀 타입은 면역, 교체하면 풀림', () => {
  const a = mk('A', ['normal'], {}, [mv('leech-seed')]), b = mk('B', ['normal'], {}, [mv('splash')]), b2 = mk('B2', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, [b, b2]);
  a.hp = 100;
  bt.playTurn(M0, M0);
  assert.equal(b.hp, 300 - 37);
  assert.equal(a.hp, 137);
  bt.playTurn(M0, SW(1));
  assert.equal(b.seeded, false);
  const g = mk('G', ['grass'], {}, [mv('splash')]);
  duel(mk('A', ['normal'], {}, [mv('leech-seed')]), g).playTurn(M0, M0);
  assert.equal(g.seeded, false);
});

test('도발: 변화기를 못 쓰게 하고 3턴 뒤 풀린다', () => {
  const a = mk('A', ['normal'], {}, [mv('taunt'), mv('splash')]), b = mk('B', ['normal'], {}, [mv('splash'), atk()]);
  const bt = duel(a, b);
  bt.playTurn(M0, M1);
  const la = bt.legalActions(1);
  assert.equal(la.moves[0].usable, false);
  assert.equal(la.moves[0].why, '도발');
  assert.equal(la.moves[1].usable, true);
  assert.throws(() => bt.playTurn(M1, M0));
  for (let i = 0; i < 2; i++) bt.playTurn(M1, M1);
  assert.equal(bt.legalActions(1).moves[0].usable, true);
});

test('앙코르·사슬묶기·트집: 마지막에 쓴 기술을 기준으로 행동을 제한한다', () => {
  const slow = moves => mk('A', ['normal'], { spe: 50 }, moves);      // 상대가 먼저 움직여야 '마지막에 쓴 기술'이 생긴다
  const foe = () => mk('B', ['normal'], {}, [mv('splash'), atk(), atk({ name: '공격2' })]);
  let bt = duel(slow([mv('encore')]), foe());
  bt.playTurn(M0, M1);
  assert.ok(bt.legalActions(1).moves.every((m, i) => (i === 1 ? m.usable : !m.usable)), '앙코르: 방금 쓴 기술만');
  assert.equal(bt.legalActions(1).moves[0].why, '앙코르');
  bt = duel(slow([mv('disable')]), foe());
  bt.playTurn(M0, M1);
  assert.equal(bt.legalActions(1).moves[1].usable, false);
  assert.equal(bt.legalActions(1).moves[1].why, '사슬묶기');
  assert.equal(bt.legalActions(1).moves[2].usable, true);
  bt = duel(slow([mv('torment')]), foe());
  bt.playTurn(M0, M1);
  assert.equal(bt.legalActions(1).moves[1].usable, false, '방금 쓴 기술은 연속으로 못 쓴다');
  assert.equal(bt.legalActions(1).moves[2].usable, true);
  // 먼저 움직인 적이 없으면 앙코르는 실패한다
  bt = duel(mk('A', ['normal'], {}, [mv('encore')]), foe());
  assert.ok(has(bt.playTurn(M0, M1), '실패'));
});

test('하품: 2번째 턴 끝에 잠든다', () => {
  const a = mk('A', ['normal'], {}, [mv('yawn')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(b.status, null);
  bt.playTurn(M0, M0);
  assert.equal(b.status, 'slp');
});

test('아쿠아링·뿌리박기는 매 턴 1/16 회복(뿌리박기는 교체도 못 함), 소원은 다음 턴에 절반 회복', () => {
  const a = mk('A', ['normal'], {}, [mv('aqua-ring'), mv('ingrain'), mv('wish'), mv('splash')]);
  const a2 = mk('A2', ['normal'], {}, [mv('splash')]);
  const bt = duel([a, a2], mk('B', ['normal'], {}, [mv('splash')]));
  a.hp = 100;
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 118);
  bt.playTurn(M1, M0);
  assert.equal(bt.legalActions(0).switches.length, 0, '뿌리박기 중에는 교체할 수 없다');
  assert.equal(a.hp, 118 + 36);
  a.hp = 10;
  bt.playTurn(M2, M0);
  assert.equal(a.hp, 10 + 36, '소원은 아직');
  bt.playTurn({ type: 'move', index: 3 }, M0);
  assert.equal(a.hp, 10 + 36 + 150 + 36);
});

test('날개쉬기: 50% 회복하고 턴이 끝나면 비행 타입으로 돌아온다. 모래모으기는 모래바람에서 2/3 회복', () => {
  const a = mk('A', ['flying'], {}, [mv('roost')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  a.hp = 100;
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 250);
  assert.equal(a.roost, false);
  assert.equal(bt.grounded(a), false);
  const x = mk('X', ['rock'], {}, [mv('shore-up')]), y = mk('Y', ['rock'], {}, [mv('splash')]);
  const bt2 = duel(x, y);
  x.hp = 10; bt2.playTurn(M0, M0);
  assert.equal(x.hp, 160, '모래바람 없음: 1/2');
  const x2 = mk('X', ['rock'], {}, [mv('shore-up')]);
  const bt3 = duel(x2, mk('Y', ['rock'], {}, [mv('splash')]));
  bt3.field.weather = 'sand'; bt3.field.weatherTurns = 9;
  x2.hp = 10; bt3.playTurn(M0, M0);
  assert.equal(x2.hp, 210, '모래바람: 2/3');
});

// ───────────── 보호 · 대타 ─────────────
test('방어: 이번 턴 공격을 막고, 연속 사용은 성공률이 떨어진다', () => {
  const a = mk('A', ['normal'], {}, [mv('protect')]), b = mk('B', ['normal'], {}, [atk()]);
  const bt = duel(a, b);
  let ev = bt.playTurn(M0, M0);
  assert.equal(a.hp, 300);
  assert.ok(has(ev, '몸을 지켰다'));
  ev = bt.playTurn(M0, M0);                    // 2번 연속: 성공률 1/3, 난수 0.5 → 실패
  assert.ok(has(ev, '실패'));
  assert.ok(a.hp < 300);
});

test('버티기: 치명타 피해도 체력 1로 버틴다', () => {
  const a = mk('A', ['normal'], { hp: 50 }, [mv('endure')]), b = mk('B', ['normal'], {}, [atk({ power: 250 })]);
  const bt = duel(a, b);
  const ev = bt.playTurn(M0, M0);
  assert.equal(a.hp, 1);
  assert.ok(has(ev, '버텼다'));
});

test('대타출동: 체력 25%로 대타를 만들어 공격과 상태이상을 막는다', () => {
  const a = mk('A', ['normal'], {}, [mv('substitute')]), b = mk('B', ['psychic'], {}, [atk(), mv('hypnosis')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 225);
  assert.equal(a.sub, 75 - 64, '이번 턴 공격(난수 93% → 64)을 대타가 맞았다');
  const ev = bt.playTurn(M0, M1);
  assert.equal(a.status, null);
  assert.ok(has(ev, '실패'));
  bt.playTurn(M0, M0);
  assert.equal(a.sub, 0, '대타가 쓰러졌다');
  assert.equal(a.hp, 225, '본체는 피해를 입지 않았다');
});

// ───────────── 기타 ─────────────
test('아픔나누기·하얀안개 아닌 흑안개(haze)·울부짖기', () => {
  const a = mk('A', ['normal'], {}, [mv('pain-split'), mv('haze'), mv('roar')]), b = mk('B', ['normal'], {}, [mv('splash')]), b2 = mk('B2', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, [b, b2]);
  a.hp = 100;
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 200); assert.equal(b.hp, 200);
  a.stages.atk = 3; b.stages.def = -2;
  bt.playTurn(M1, M0);
  assert.equal(a.stages.atk, 0); assert.equal(b.stages.def, 0);
  bt.playTurn(M2, M0);
  assert.equal(bt.sides[1].active, 1, '울부짖기로 상대가 끌려 나왔다');
});

test('변신: 상대의 타입·능력치·기술을 복사하고, 교체하면 원래대로', () => {
  const dit = mk('D', ['normal'], { atk: 50, spe: 10 }, [mv('transform')]);
  const dit2 = mk('D2', ['normal'], {}, [mv('splash')]);
  const foe = mk('F', ['fire'], { atk: 400, spe: 300 }, [atk({ name: '불꽃', type: T('fire') }), mv('splash')]);
  const bt = duel([dit, dit2], foe);
  bt.playTurn(M0, M1);
  assert.deepEqual(A(dit.types), [T('fire')]);
  assert.equal(dit.stats.atk, 400);
  assert.equal(dit.moves.length, 2);
  assert.equal(dit.moves[0].pp, 5);
  bt.playTurn(SW(1), M1);
  assert.deepEqual(A(dit.types), [T('normal')]);
  assert.equal(dit.stats.atk, 50);
  assert.equal(dit.moves[0].name, '변신');
});

test('멸망의노래: 3턴 뒤 양쪽이 쓰러진다(교체하면 풀린다)', () => {
  const a = mk('A', ['normal'], {}, [mv('perish-song'), mv('splash')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  for (let i = 0; i < 2; i++) bt.playTurn(M1, M0);
  assert.equal(bt.phase, 'move');
  bt.playTurn(M1, M0);
  assert.equal(bt.phase, 'ended');
  assert.equal(bt.winner, 'draw');
});

test('검은눈빛류(가두기): 교체 불가. 고스트는 예외', () => {
  const a = mk('A', ['normal'], {}, [mv('mean-look')]);
  const b = mk('B', ['normal'], {}, [mv('splash')]), b2 = mk('B2', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, [b, b2]);
  bt.playTurn(M0, M0);
  assert.equal(bt.legalActions(1).switches.length, 0);
  const g = mk('G', ['ghost'], {}, [mv('splash')]);
  const bt2 = duel(mk('A', ['normal'], {}, [mv('mean-look')]), [g, mk('G2', ['normal'], {}, [mv('splash')])]);
  bt2.playTurn(M0, M0);
  assert.equal(bt2.legalActions(1).switches.length, 1);
});

test('원한·물붓기·헤롱헤롱·악몽', () => {
  let bt = duel(mk('A', ['normal'], { spe: 50 }, [mv('spite')]), mk('B', ['normal'], {}, [atk()]));
  bt.playTurn(M0, M0);
  const pp = bt.active(1).moves[0].pp;
  assert.equal(pp, 99 - 1 - 4);
  const b = mk('B', ['fire'], {}, [mv('splash')]);
  duel(mk('A', ['normal'], {}, [mv('soak')]), b).playTurn(M0, M0);
  assert.deepEqual(A(b.types), [T('water')]);
  const c = mk('C', ['normal'], {}, [atk()]);
  bt = duel(mk('A', ['normal'], {}, [mv('attract')]), c, R(0.1));
  const ev = bt.playTurn(M0, M0);
  assert.ok(has(ev, '헤롱헤롱해서 움직일 수 없다'));
  const d = mk('D', ['normal'], {}, [mv('splash')]);
  d.status = 'slp'; d.sleepTurns = 9;
  bt = duel(mk('A', ['normal'], {}, [mv('nightmare')]), d);
  bt.playTurn(M0, M0);
  assert.equal(d.hp, 300 - 75);
});

test('잠꼬대는 잠든 동안만, 메트로놈은 어떤 기술이든 안전하게 쓴다', () => {
  const a = mk('A', ['normal'], {}, [mv('sleep-talk'), atk({ name: '박치기' })]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  assert.equal(bt.legalActions(0).moves[0].usable, false);
  a.status = 'slp'; a.sleepTurns = 9;
  assert.equal(bt.legalActions(0).moves[0].usable, true);
  const ev = bt.playTurn(M0, M0);
  assert.ok(ev.some(e => e.t === 'move' && e.name === '박치기'));
  assert.equal(a.status, 'slp');
  for (let seed = 1; seed <= 150; seed++) {
    const bt2 = E.createBattle({ parties: [[mk('A', ['normal'], {}, [mv('metronome')]), mk('A2', ['normal'], {}, [mv('splash')])], [mk('B', ['normal'], {}, [mv('splash')]), mk('B2', ['normal'], {}, [mv('splash')])]], seed });
    bt2.start();
    for (let i = 0; i < 4 && bt2.phase !== 'ended'; i++) {
      if (bt2.phase === 'switch') { bt2.pending.slice().forEach(s => bt2.replace(s, bt2.sides[s].party.findIndex(m => !m.fainted))); continue; }
      bt2.playTurn(M0, M0);
    }
  }
});

test('치유의방울·리프레시·정화', () => {
  const a = mk('A', ['normal'], {}, [mv('heal-bell'), mv('refresh'), mv('purify')]), a2 = mk('A2', ['normal'], {}, [mv('splash')]);
  const b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel([a, a2], b);
  a.status = 'brn'; a2.status = 'par';
  bt.playTurn(M0, M0);
  assert.equal(a.status, null); assert.equal(a2.status, null);
  a.status = 'psn';
  bt.playTurn(M1, M0);
  assert.equal(a.status, null);
  b.status = 'brn'; a.hp = 100;
  bt.playTurn(M2, M0);
  assert.equal(b.status, null);
  assert.equal(a.hp, 250);
});

test('능력 상승 신규: 소울비트(체력 33% 소모, 전부 +1), 날카로운침(무작위 +2)', () => {
  const a = mk('A', ['normal'], {}, [mv('clangorous-soul'), mv('acupressure')]), b = mk('B', ['normal'], {}, [mv('splash')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 300 - 99);
  assert.deepEqual(['atk', 'def', 'spa', 'spd', 'spe'].map(k => a.stages[k]), [1, 1, 1, 1, 1]);
  bt.playTurn(M1, M0);
  assert.equal(Object.values(a.stages).reduce((s, v) => s + v, 0), 5 + 2);
});

// ───────────── 데이터 ─────────────
test('데이터: 변화기 150개 (1단계 50 + 2단계 100)와 효과 형식', () => {
  const st = Object.entries(data.moves).filter(([, m]) => m.c === 'n');
  assert.equal(st.length, 150);
  const known = new Set(['ail', 'tgt', 'self', 'heal', 'rest', 'hpCost', 'powder', 'typeImmune', 'weather', 'terrain', 'room', 'hazard', 'defog', 'screen', 'side', 'seed', 'taunt',
    'encore', 'disable', 'torment', 'yawn', 'aquaRing', 'ingrain', 'wish', 'roost', 'sandHeal', 'weatherHeal', 'focus', 'attract', 'nightmare', 'perish', 'protect', 'sub',
    'painSplit', 'phaze', 'transform', 'splash', 'haze', 'metronome', 'sleepTalk', 'trap', 'spite', 'soak', 'randStat', 'reqFoeStatus', 'cure', 'cureFoe']);
  for (const [, m] of st) {
    assert.equal(m.pw, 0, m.e);
    const keys = Object.keys(m.fx);
    assert.ok(keys.length, `${m.e}: 효과 없음`);
    for (const k of keys) assert.ok(known.has(k), `${m.e}: 알 수 없는 효과 ${k}`);
    assert.ok(E.describeEffect({ fx: m.fx }), `${m.e}: 설명 없음`);
  }
  for (const p of Object.values(data.pokemon)) for (const mid of p.sm) assert.equal(data.moves[mid].c, 'n');
});

// ───────────── 무작위 대량 시험: 어떤 조합이든 엔진이 멈추거나 깨지지 않아야 한다 ─────────────
test('무작위 대량 시험: 변화기 150개를 섞은 배틀 400판이 오류 없이 끝난다', () => {
  const statusIds = Object.keys(data.moves).filter(i => data.moves[i].c === 'n').map(Number);
  const attackIds = Object.keys(data.moves).filter(i => data.moves[i].c !== 'n').map(Number);
  const rnd = E.mulberry32(77);
  const pick = list => list[Math.floor(rnd() * list.length)];
  let ended = 0, fields = 0;
  for (let g = 0; g < 400; g++) {
    const team = () => [0, 1, 2].map(() => {
      const id = 1 + Math.floor(rnd() * 1025);
      const moves = [pick(attackIds), pick(statusIds), pick(statusIds), pick(statusIds)];
      return E.makeMon(id, { moves: [...new Set(moves)] });
    });
    const bt = E.createBattle({ parties: [team(), team()], seed: g + 1, maxTurns: 120 });
    bt.start();
    let guard = 0;
    while (bt.phase !== 'ended') {
      if (++guard > 400) throw new Error('끝나지 않음');
      if (bt.phase === 'switch') {
        bt.pending.slice().forEach(s => bt.replace(s, bt.sides[s].party.findIndex(m => !m.fainted)));
        continue;
      }
      const pickAction = si => {
        const la = bt.legalActions(si);
        if (la.mustStruggle) return M0;
        const usable = la.moves.filter(m => m.usable);
        if (la.switches.length && rnd() < 0.08) return SW(pick(la.switches));
        return { type: 'move', index: pick(usable).index };
      };
      const ev = bt.playTurn(pickAction(0), pickAction(1));
      if (ev.some(e => e.t === 'field')) fields++;
      for (const m of bt.sides.flatMap(s => s.party)) assert.ok(m.hp >= 0 && m.hp <= m.maxHp, 'HP 범위');
    }
    ended++;
  }
  assert.equal(ended, 400);
  assert.ok(fields > 100, '필드 효과가 실제로 쓰였다');
});
