// 변화기 3단계 테스트 (교체·복사·타입·교환·방어 변종·필드·길동무 …, 총 270개 완성):  npm run test:battle
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../../tools/lib/load-battle.mjs';

const { engine: E, data, ai: AI, party: PT } = loadBattle();
const T = name => data.types.find(t => t.e === name).id;
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
const A = x => [...x];
const splash = () => mv('splash');
const idle = () => mk('쉬는애', ['normal'], {}, [splash()]);

// ───────────── 데이터 ─────────────
test('데이터: 변화기 270개가 모두 들어 있고 숨은 효과 없이 설명이 있다', () => {
  const st = Object.values(data.moves).filter(m => m.c === 'n');
  assert.equal(st.length, 270);
  for (const m of st) assert.ok(E.describeEffect({ fx: m.fx }), `${m.e}: 설명 없음`);
  assert.equal(data.moves[idOf('hail')], undefined, '싸라기눈은 9세대에 없다');
  assert.ok(Object.values(data.moves).some(m => m.ct), '접촉 기술 표시');
});

// ───────────── 턴 도중 교체 ─────────────
test('순간이동: 우선도 −6, 쓰면 교체 선택 단계로 넘어가고 고르면 남은 행동을 이어 간다', () => {
  const a = mk('A', ['psychic'], {}, [mv('teleport')]), a2 = mk('A2', ['water'], {}, [atk()]);
  const b = mk('B', ['normal'], { spe: 300 }, [atk({ power: 40 })]);
  const bt = duel([a, a2], b);
  const ev = bt.playTurn(M0, M0);
  assert.equal(bt.phase, 'switch', '교체 선택 대기');
  assert.deepEqual(A(bt.pending), [0]);
  assert.ok(ev.some(e => e.t === 'needSwitch' && e.pivot));
  assert.deepEqual(A(bt.replaceOptions(0)), [1], '출전 중인 포켓몬은 고를 수 없다');
  assert.throws(() => bt.replace(0, 0), /이미 나와 있는/);
  const ev2 = bt.replace(0, 1);
  assert.equal(bt.sides[0].active, 1);
  assert.equal(bt.phase, 'move', '턴이 끝나고 다음 턴 대기');
  assert.ok(ev2.some(e => e.t === 'switch'));
});

test('막말내뱉기: 상대 공격·특공 −1 뒤 교체, 같은 턴 상대 공격은 교체한 포켓몬이 받는다', () => {
  const a = mk('A', ['dark'], { spe: 300 }, [mv('parting-shot')]), a2 = mk('A2', ['water'], {}, [atk()]);
  const b = mk('B', ['normal'], {}, [atk({ power: 60 })]);
  const bt = duel([a, a2], b);
  bt.playTurn(M0, M0);
  assert.equal(b.stages.atk, -1); assert.equal(b.stages.spa, -1);
  assert.equal(bt.phase, 'switch');
  bt.replace(0, 1);
  assert.ok(a2.hp < a2.maxHp, '교체한 포켓몬이 이번 턴 공격을 받았다');
  assert.equal(a.hp, a.maxHp);
});

test('배턴터치: 능력 단계·대타·기합을 넘겨 준다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('swords-dance'), mv('baton-pass')]), a2 = mk('A2', ['water'], {}, [atk()]);
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  a.focus = true;
  bt.playTurn(M1, M0);
  const ev = bt.replace(0, 1);
  assert.equal(a2.stages.atk, 2, '공격 +2 를 넘겨 받았다');
  assert.equal(a2.focus, true);
  assert.ok(ev.some(e => e.t === 'stages' && e.side === 0 && e.stages.atk === 2), '화면에 알려 준다');
  assert.equal(a.stages.atk, 0, '나간 포켓몬은 초기화');
});

test('꼬리자르기: 체력 절반을 내고 대타를 만들어 다음 포켓몬에게 넘긴다. 체력이 모자라면 실패', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('shed-tail')]), a2 = mk('A2', ['water'], {}, [atk()]);
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 300 - 150);
  bt.replace(0, 1);
  assert.equal(a2.sub, 75, '최대 체력 1/4 짜리 대타');
  const b = mk('B', ['normal'], {}, [mv('shed-tail')]); b.hp = 100;
  const bt2 = duel([b, mk('B2', ['normal'], {}, [atk()])], idle());
  const ev = bt2.playTurn(M0, M0);
  assert.ok(has(ev, '실패'));
  assert.equal(bt2.phase, 'move');
});

test('교체할 동료가 없으면 순간이동·배턴터치는 실패한다', () => {
  const a = mk('A', ['normal'], {}, [mv('baton-pass')]);
  const bt = duel(a, idle());
  const ev = bt.playTurn(M0, M0);
  assert.ok(has(ev, '실패'));
  assert.equal(bt.phase, 'move');
});

test('썰렁개그: 눈을 내리고 교체한다', () => {
  const a = mk('A', ['ice'], {}, [mv('chilly-reception')]), a2 = mk('A2', ['water'], {}, [atk()]);
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.equal(bt.field.weather, 'snow');
  assert.equal(bt.phase, 'switch');
  bt.replace(0, 1);
  assert.equal(bt.sides[0].active, 1);
});

test('가두기 상태에서는 교체 기술을 쓸 수 없다', () => {
  const a = mk('A', ['normal'], {}, [mv('teleport')]), a2 = mk('A2', ['water'], {}, [atk()]);
  a.trapped = true;
  const bt = duel([a, a2], idle());
  const ev = bt.playTurn(M0, M0);
  assert.ok(has(ev, '실패'));
});

test('치유소원: 쓰러지고 다음 포켓몬이 체력·상태이상을 모두 회복한다 / 초승달춤은 PP 도', () => {
  const a = mk('A', ['psychic'], { spe: 300 }, [mv('healing-wish')]), a2 = mk('A2', ['water'], {}, [atk()]);
  a2.hp = 50; a2.status = 'brn'; a2.moves[0].pp = 3;
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.equal(a.fainted, true);
  assert.equal(bt.phase, 'switch');
  bt.replace(0, 1);
  assert.equal(a2.hp, a2.maxHp); assert.equal(a2.status, null); assert.equal(a2.moves[0].pp, 3);
  const b = mk('B', ['psychic'], { spe: 300 }, [mv('lunar-dance')]), b2 = mk('B2', ['water'], {}, [atk()]);
  b2.moves[0].pp = 3;
  const bt2 = duel([b, b2], idle());
  bt2.playTurn(M0, M0); bt2.replace(0, 1);
  assert.equal(b2.moves[0].pp, 99);
  const solo = mk('S', ['psychic'], {}, [mv('healing-wish')]);
  assert.ok(has(duel(solo, idle()).playTurn(M0, M0), '실패'), '동료가 없으면 실패');
});

test('추억의선물: 상대 공격·특공 −2 하고 쓰러진다', () => {
  const a = mk('A', ['dark'], { spe: 300 }, [mv('memento')]), a2 = mk('A2', ['water'], {}, [atk()]);
  const b = mk('B', ['normal'], {}, [atk()]);
  const bt = duel([a, a2], b);
  bt.playTurn(M0, M0);
  assert.equal(a.fainted, true);
  assert.equal(b.stages.atk, -2); assert.equal(b.stages.spa, -2);
  assert.equal(a2.hp, a2.maxHp, '쓰러진 쪽을 노린 공격은 헛수고(동료는 맞지 않는다)');
});

test('회생의기도: 쓰러진 동료를 체력 절반으로 되살린다', () => {
  const a = mk('A', ['normal'], {}, [mv('revival-blessing')]), a2 = mk('A2', ['water'], { hp: 400 }, [atk()]);
  a2.hp = 0; a2.fainted = true;
  const bt = duel([a, a2], idle());
  const ev = bt.playTurn(M0, M0);
  assert.equal(a2.fainted, false); assert.equal(a2.hp, 200);
  assert.ok(ev.some(e => e.t === 'revive' && e.side === 0 && e.index === 1));
  assert.ok(has(duel(mk('X', ['normal'], {}, [mv('revival-blessing')]), idle()).playTurn(M0, M0), '실패'), '쓰러진 동료가 없으면 실패');
});

// ───────────── 방어 변종 ─────────────
test('킹실드: 접촉 공격은 막고 공격 −1, 비접촉은 막지만 반격 없음, 변화기는 막지 못한다', () => {
  const a = mk('A', ['steel'], { spe: 300 }, [mv('kings-shield')]);
  const b = mk('B', ['normal'], {}, [atk({ contact: true }), atk({ contact: false }), mv('swords-dance')]);
  const bt = duel(a, b, R(0.1));
  bt.playTurn(M0, M0);
  assert.equal(a.hp, a.maxHp); assert.equal(b.stages.atk, -1);
  bt.playTurn(M0, M1);
  assert.equal(a.hp, a.maxHp); assert.equal(b.stages.atk, -1, '비접촉은 반격하지 않는다');
  bt.playTurn(M0, M2);
  assert.equal(b.stages.atk, 1, '변화기는 막지 못한다');
});

test('니들가드·토치카·화염의수호·블로킹·스레드트랩: 접촉 반격 종류', () => {
  const run = (ident, check) => {
    const a = mk('A', ['steel'], { spe: 300 }, [mv(ident)]), b = mk('B', ['normal'], {}, [atk({ contact: true })]);
    const bt = duel(a, b);
    bt.playTurn(M0, M0);
    assert.equal(a.hp, a.maxHp, ident);
    check(b, a);
  };
  run('spiky-shield', b => assert.equal(b.hp, b.maxHp - 37));
  run('baneful-bunker', b => assert.equal(b.status, 'psn'));
  run('burning-bulwark', b => assert.equal(b.status, 'brn'));
  run('obstruct', b => assert.equal(b.stages.def, -2));
  run('silk-trap', b => assert.equal(b.stages.spe, -1));
});

test('토치카·다이월은 변화기도 막고 킹실드류는 막지 못한다', () => {
  const t = ident => { const a = mk('A', ['fighting'], { spe: 300 }, [mv(ident)]), b = mk('B', ['normal'], {}, [mv('toxic')]); duel(a, b).playTurn(M0, M0); return a.status; };
  assert.equal(t('baneful-bunker'), null);
  assert.equal(t('max-guard'), null);
  assert.equal(t('kings-shield'), 'tox');
});

test('패스트가드는 우선도 공격만, 트릭가드는 변화기만, 와이드가드는 다단 히트만 막는다', () => {
  const dmg = (ident, move) => { const a = mk('A', ['steel'], { spe: 300 }, [mv(ident)]), b = mk('B', ['normal'], {}, [move]); const bt = duel(a, b); bt.playTurn(M0, M0); return a.maxHp - a.hp; };
  assert.equal(dmg('quick-guard', atk({ pri: 1 })), 0);
  assert.ok(dmg('quick-guard', atk()) > 0);
  assert.equal(dmg('wide-guard', atk({ fx: { hits: [2, 2] } })), 0);
  assert.ok(dmg('wide-guard', atk()) > 0);
  const a = mk('A', ['steel'], { spe: 300 }, [mv('crafty-shield')]), b = mk('B', ['normal'], {}, [mv('toxic')]);
  duel(a, b).playTurn(M0, M0);
  assert.equal(a.status, null);
  const a2 = mk('A', ['steel'], { spe: 300 }, [mv('crafty-shield')]), b2 = mk('B', ['normal'], {}, [atk()]);
  duel(a2, b2).playTurn(M0, M0);
  assert.ok(a2.hp < a2.maxHp, '공격은 통한다');
});

test('마룻바닥세워막기: 등장한 첫 턴에만 성공한다', () => {
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('mat-block')]), b = mk('B', ['normal'], {}, [atk()]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.hp, a.maxHp);
  const ev = bt.playTurn(M0, M0);
  assert.ok(has(ev, '실패'));
});

// ───────────── 필드 ─────────────
test('중력: 땅 기술이 비행·부유에도 맞고 명중이 오르며 5턴 뒤 끝난다', () => {
  const ground = atk({ type: T('ground') });
  const flyer = mk('F', ['flying'], {}, [atk()]), a = mk('A', ['normal'], {}, [ground]);
  assert.equal(E.calcDamage(a, flyer, ground, { roll: 100 }).damage, 0);
  assert.ok(E.calcDamage(a, flyer, ground, { roll: 100, ctx: { gravity: true } }).damage > 0);
  const g = mk('G', ['psychic'], { spe: 300 }, [mv('gravity')]);
  const bt = duel(g, idle());
  bt.playTurn(M0, M0);
  assert.equal(bt.field.gravity, 4, '쓴 턴을 포함해 5턴');
  assert.equal(bt.grounded(mk('F', ['flying'], {}, [splash()])), true);
  for (let i = 0; i < 4; i++) bt.playTurn(M0, M0);
  assert.equal(bt.field.gravity, 0);
});

test('원더룸: 방어와 특수방어가 뒤바뀐다 (다시 쓰면 해제)', () => {
  const a = mk('A', ['normal'], {}, [atk()]), d = mk('D', ['normal'], { def: 400, spd: 100 }, [atk()]);
  const phys = atk(), spec = atk({ cls: 'spec' });
  const dmg = (m, ctx) => E.calcDamage(a, d, m, { roll: 100, ctx }).damage;
  assert.ok(dmg(phys) < dmg(spec));
  assert.ok(dmg(phys, { wonder: true }) > dmg(spec, { wonder: true }));
  const w = mk('W', ['psychic'], { spe: 300 }, [mv('wonder-room')]);
  const bt = duel(w, idle());
  bt.playTurn(M0, M0); assert.equal(bt.field.wonder, 4);
  bt.playTurn(M0, M0); assert.equal(bt.field.wonder, 0, '다시 쓰면 해제');
});

test('매직룸: 턴 종료 회복(아쿠아링)이 멈춘다', () => {
  const a = mk('A', ['water'], { spe: 300 }, [mv('magic-room'), splash()]);
  a.hp = 100; a.aquaRing = true;
  const bt = duel(a, idle());
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 100, '회복 정지');
  for (let i = 0; i < 3; i++) bt.playTurn(M1, M0);
  assert.equal(a.hp, 100);
  bt.playTurn(M1, M0);
  assert.equal(bt.field.magicRoom, 0);
  bt.playTurn(M1, M0);
  assert.ok(a.hp > 100, '끝나면 다시 회복한다');
});

test('흙놀이·물놀이: 전기/불꽃 위력 1/3', () => {
  const a = mk('A', ['psychic'], {}, [atk()]), d = mk('D', ['normal'], {}, [atk()]);
  const elec = atk({ type: T('electric') }), fire = atk({ type: T('fire') });
  const base = E.calcDamage(a, d, elec, { roll: 100 }).damage;
  assert.ok(E.calcDamage(a, d, elec, { roll: 100, ctx: { mud: true } }).damage < base / 2.5);
  assert.equal(E.calcDamage(a, d, fire, { roll: 100, ctx: { mud: true } }).damage, E.calcDamage(a, d, fire, { roll: 100 }).damage);
  assert.ok(E.calcDamage(a, d, fire, { roll: 100, ctx: { waterSport: true } }).damage < base / 2.5);
  const bt = duel(mk('M', ['ground'], { spe: 300 }, [mv('mud-sport')]), idle());
  bt.playTurn(M0, M0); assert.equal(bt.field.mud, 4);
});

test('플라스마샤워: 이번 턴 노말 기술이 전기 타입이 되어 땅 타입에는 무효', () => {
  const a = mk('A', ['electric'], { spe: 300 }, [mv('ion-deluge')]), g = mk('G', ['ground'], {}, [atk()]);
  const b = mk('B', ['normal'], {}, [atk()]);
  const bt = duel([a], [g]);
  const ev = bt.playTurn(M0, M0);         // 땅 타입이 쏜 노말 기술이 전기 타입이 되어 전기 타입에게 반감
  assert.ok(ev.some(e => e.t === 'effective' && e.eff === 0.5));
  assert.equal(bt.field.ion, false, '턴이 끝나면 풀린다');
  const g2 = mk('G2', ['ground'], {}, [splash()]);
  const bt2 = duel(mk('A', ['electric'], { spe: 300 }, [mv('ion-deluge')]), [mk('B', ['normal'], {}, [atk()]), g2]);
  const hp0 = bt2.active(0).hp;
  bt2.playTurn(M0, M0);
  assert.ok(bt2.active(0).hp < hp0);
});

test('송전: 상대의 다음 기술이 전기 타입이 된다 (이미 움직였으면 실패)', () => {
  const a = mk('A', ['ground'], { spe: 300 }, [mv('electrify')]), b = mk('B', ['normal'], {}, [atk()]);
  duel(a, b).playTurn(M0, M0);
  assert.equal(a.hp, a.maxHp, '땅 타입에게 전기는 무효');
  const slow = mk('A', ['ground'], { spe: 1 }, [mv('electrify')]), fast = mk('B', ['normal'], { spe: 300 }, [atk()]);
  const ev = duel(slow, fast).playTurn(M0, M0);
  assert.ok(has(ev, '실패'));
});

test('페어리록: 다음 턴 교체할 수 없다', () => {
  const a = mk('A', ['fairy'], { spe: 300 }, [mv('fairy-lock')]), a2 = mk('A2', ['water'], {}, [atk()]);
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.deepEqual(A(bt.legalActions(0).switches), []);
  bt.playTurn(M0, M0);
  assert.deepEqual(A(bt.legalActions(0).switches), [1]);
});

test('코트체인지: 양쪽 진영의 함정·벽을 맞바꾼다', () => {
  const a = mk('A', ['psychic'], { spe: 300 }, [mv('court-change')]);
  const bt = duel(a, idle());
  bt.sides[0].cond.rocks = true; bt.sides[1].cond.reflect = 5;
  bt.playTurn(M0, M0);
  assert.equal(bt.sides[1].cond.rocks, true); assert.equal(bt.sides[0].cond.reflect, 4);
  assert.equal(bt.sides[0].cond.rocks, false);
});

test('주술: 급소에 맞지 않는다', () => {
  const a = mk('A', ['normal'], {}, [atk({ fx: { crit: 2 } })]), d = mk('D', ['normal'], {}, [mv('lucky-chant')]);
  const bt = duel(a, d);
  bt.sides[1].cond.lucky = 5;
  const ev = bt.playTurn(M0, M0);
  assert.ok(!ev.some(e => e.t === 'crit'));
});

// ───────────── 복사 ─────────────
test('흉내내기: 상대가 마지막으로 쓴 기술이 이 칸에 복사되고 교체하면 원래대로', () => {
  const a = mk('A', ['normal'], { spe: 1 }, [mv('mimic'), atk({ id: 111, name: '내공격' })]), a2 = mk('A2', ['normal'], {}, [atk()]);
  const b = mk('B', ['normal'], { spe: 300 }, [mv('swords-dance')]);
  const bt = duel([a, a2], b);
  bt.playTurn(M0, M0);                    // b 가 먼저 칼춤, 그 뒤 a 가 흉내
  assert.equal(a.moves[0].name, '칼춤');
  assert.equal(a.moves[0].pp, a.moves[0].maxPp);
  bt.playTurn(SW(1), M0);
  assert.equal(a.moves[0].name, '흉내내기', '교체하면 원래 기술로');
});

test('스케치: 영구적으로 복사한다', () => {
  const a = mk('A', ['normal'], { spe: 1 }, [mv('sketch')]), a2 = mk('A2', ['normal'], {}, [atk()]);
  const b = mk('B', ['normal'], { spe: 300 }, [mv('swords-dance')]);
  const bt = duel([a, a2], b);
  bt.playTurn(M0, M0);
  assert.equal(a.moves[0].name, '칼춤');
  bt.playTurn(SW(1), M0); bt.playTurn(SW(0), M0);
  assert.equal(a.moves[0].name, '칼춤', '교체해도 유지');
});

test('따라하기·흉내쟁이: 상대/직전 기술을 그대로 쓴다', () => {
  const a = mk('A', ['normal'], { spe: 1 }, [mv('mirror-move')]), b = mk('B', ['normal'], { spe: 300 }, [mv('swords-dance')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.stages.atk, 2);
  const c = mk('C', ['normal'], { spe: 1 }, [mv('copycat')]), d = mk('D', ['normal'], { spe: 300 }, [mv('swords-dance')]);
  duel(c, d).playTurn(M0, M0);
  assert.equal(c.stages.atk, 2);
});

test('선취: 상대가 고른 공격기를 먼저 1.5배로 쓴다 / 변화기를 고르면 실패', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('me-first')]), b = mk('B', ['normal'], {}, [atk({ power: 40 })]);
  const bt = duel(a, b);
  const ev = bt.playTurn(M0, M0);
  assert.ok(ev.some(e => e.t === 'damage' && e.side === 1), '내가 먼저 때렸다');
  const c = mk('C', ['normal'], { spe: 300 }, [mv('me-first')]), d = mk('D', ['normal'], {}, [splash()]);
  assert.ok(has(duel(c, d).playTurn(M0, M0), '실패'));
});

test('조수: 동료의 기술을 무작위로 쓴다', () => {
  const a = mk('A', ['normal'], {}, [mv('assist')]), a2 = mk('A2', ['normal'], {}, [mv('swords-dance')]);
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.equal(a.stages.atk, 2);
});

test('자연의힘: 필드에 따라 공격기가 바뀐다', () => {
  const a = mk('A', ['normal'], {}, [mv('nature-power')]);
  const bt = duel(a, idle());
  const ev = bt.playTurn(M0, M0);
  assert.ok(ev.some(e => e.t === 'damage'));
  assert.ok(has(ev, '트라이어택'));
  const bt2 = duel(mk('A', ['normal'], {}, [mv('nature-power')]), idle());
  bt2.field.terrain = 'electric'; bt2.field.terrainTurns = 5;
  assert.ok(has(bt2.playTurn(M0, M0), '10만볼트'));
});

test('지휘: 방금 쓴 자신의 기술을 한 번 더 쓴다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('swords-dance'), mv('instruct')]);
  const bt = duel(a, idle());
  bt.playTurn(M0, M0); assert.equal(a.stages.atk, 2);
  bt.playTurn(M1, M0); assert.equal(a.stages.atk, 4);
});

// ───────────── 타입 ─────────────
test('텍스처: 자신의 기술 타입으로 바뀐다 / 보호색은 필드에 따라 / 미러타입은 상대와 같게', () => {
  const a = mk('A', ['normal'], {}, [mv('conversion'), atk({ type: T('fire') })]);
  duel(a, idle()).playTurn(M0, M0);
  assert.deepEqual(A(a.types), [T('fire')]);
  const c = mk('C', ['normal'], {}, [mv('camouflage')]);
  const bt = duel(c, idle()); bt.field.terrain = 'grassy'; bt.field.terrainTurns = 5;
  bt.playTurn(M0, M0);
  assert.deepEqual(A(c.types), [T('grass')]);
  const m = mk('M', ['normal'], {}, [mv('reflect-type')]), t = mk('T', ['fire', 'flying'], {}, [splash()]);
  duel(m, t).playTurn(M0, M0);
  assert.deepEqual(A(m.types), [T('fire'), T('flying')]);
});

test('텍스처2: 상대의 마지막 기술을 반감하는 타입으로', () => {
  const a = mk('A', ['normal'], { spe: 1 }, [mv('conversion-2')]), b = mk('B', ['normal'], { spe: 300 }, [atk({ type: T('fire') })]);
  duel(a, b).playTurn(M0, M0);
  assert.ok(E.typeMultiplier(T('fire'), a.types) < 1);
});

test('핼러윈·숲의저주·마법가루·물에빠뜨리기: 타입을 더하거나 바꾼다. 교체하면 원래대로', () => {
  const b = mk('B', ['normal'], {}, [splash()]), b2 = mk('B2', ['normal'], {}, [atk()]);
  const bt = duel(mk('A', ['ghost'], {}, [mv('trick-or-treat'), mv('forests-curse')]), [b, b2]);
  bt.playTurn(M0, M0);
  assert.deepEqual(A(b.types), [T('normal'), T('ghost')]);
  bt.playTurn(M1, M0);
  assert.deepEqual(A(b.types), [T('normal'), T('grass')], '세 번째 타입은 교체된다');
  const c = mk('C', ['normal'], {}, [splash()]);
  duel(mk('A', ['psychic'], {}, [mv('magic-powder')]), c).playTurn(M0, M0);
  assert.deepEqual(A(c.types), [T('psychic')]);
  const grass = mk('G', ['grass'], {}, [splash()]);
  assert.ok(has(duel(mk('A', ['psychic'], {}, [mv('magic-powder')]), grass).playTurn(M0, M0), '효과가 없'), '풀 타입에게는 가루 무효');
  bt.playTurn(M0, SW(1));
  assert.deepEqual(A(b.types), [T('normal')], '나가면 원래 타입');
});

test('스킬스왑·역할·동료만들기·배껴그리기: 타입 교환/복사', () => {
  const a = mk('A', ['fire'], {}, [mv('skill-swap')]), b = mk('B', ['water'], {}, [splash()]);
  duel(a, b).playTurn(M0, M0);
  assert.deepEqual(A(a.types), [T('water')]); assert.deepEqual(A(b.types), [T('fire')]);
  const c = mk('C', ['fire'], {}, [mv('role-play')]), d = mk('D', ['water'], {}, [splash()]);
  duel(c, d).playTurn(M0, M0);
  assert.deepEqual(A(c.types), [T('fire'), T('water')]);
  const e = mk('E', ['fire'], {}, [mv('entrainment')]), f = mk('F', ['water'], {}, [splash()]);
  duel(e, f).playTurn(M0, M0);
  assert.deepEqual(A(f.types), [T('fire')]);
  const g = mk('G', ['fire'], {}, [mv('doodle')]), h = mk('H', ['water'], {}, [splash()]);
  h.stages.atk = 2;
  duel(g, h).playTurn(M0, M0);
  assert.deepEqual(A(g.types), [T('water')]); assert.equal(g.stages.atk, 2);
});

// ───────────── 교환·분배 ─────────────
test('자기암시·파워스왑·가드스왑·하트스왑·뒤집어엎기: 능력 단계', () => {
  const a = mk('A', ['normal'], {}, [mv('psych-up')]), b = mk('B', ['normal'], {}, [splash()]);
  b.stages.atk = 3; b.stages.def = -1;
  duel(a, b).playTurn(M0, M0);
  assert.equal(a.stages.atk, 3); assert.equal(a.stages.def, -1);
  const c = mk('C', ['normal'], {}, [mv('power-swap')]), d = mk('D', ['normal'], {}, [splash()]);
  c.stages.atk = 2; d.stages.spa = 4;
  duel(c, d).playTurn(M0, M0);
  assert.equal(c.stages.atk, 0); assert.equal(c.stages.spa, 4); assert.equal(d.stages.atk, 2);
  const e = mk('E', ['normal'], {}, [mv('guard-swap')]), f = mk('F', ['normal'], {}, [splash()]);
  e.stages.def = 2; f.stages.spd = 3;
  duel(e, f).playTurn(M0, M0);
  assert.equal(e.stages.spd, 3); assert.equal(f.stages.def, 2);
  const g = mk('G', ['normal'], {}, [mv('heart-swap')]), h = mk('H', ['normal'], {}, [splash()]);
  g.stages.spe = -2; h.stages.atk = 6;
  duel(g, h).playTurn(M0, M0);
  assert.equal(g.stages.atk, 6); assert.equal(h.stages.spe, -2);
  const i = mk('I', ['normal'], {}, [mv('topsy-turvy')]), j = mk('J', ['normal'], {}, [splash()]);
  j.stages.atk = 2; j.stages.def = -3;
  duel(i, j).playTurn(M0, M0);
  assert.equal(j.stages.atk, -2); assert.equal(j.stages.def, 3);
});

test('파워트릭·스피드스왑·파워셰어·가드셰어: 능력치 자체를 바꾼다. 교체하면 원래대로', () => {
  const a = mk('A', ['normal'], { atk: 100, def: 300 }, [mv('power-trick')]), a2 = idle();
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.equal(E.effectiveStat(a, 'atk'), 300); assert.equal(E.effectiveStat(a, 'def'), 100);
  bt.playTurn(SW(1), M0);
  assert.equal(E.effectiveStat(a, 'atk'), 100);
  const c = mk('C', ['normal'], { spe: 50 }, [mv('speed-swap')]), d = mk('D', ['normal'], { spe: 400 }, [splash()]);
  duel(c, d).playTurn(M0, M0);
  assert.equal(E.effectiveStat(c, 'spe'), 400); assert.equal(E.effectiveStat(d, 'spe'), 50);
  const e = mk('E', ['normal'], { atk: 100, spa: 100 }, [mv('power-split')]), f = mk('F', ['normal'], { atk: 300, spa: 200 }, [splash()]);
  duel(e, f).playTurn(M0, M0);
  assert.equal(E.effectiveStat(e, 'atk'), 200); assert.equal(E.effectiveStat(f, 'atk'), 200);
  const g = mk('G', ['normal'], { def: 100, spd: 100 }, [mv('guard-split')]), h = mk('H', ['normal'], { def: 300, spd: 100 }, [splash()]);
  duel(g, h).playTurn(M0, M0);
  assert.equal(E.effectiveStat(g, 'def'), 200); assert.equal(E.effectiveStat(h, 'def'), 200);
});

test('사이코시프트·트릭: 상태이상을 옮기거나 맞바꾼다', () => {
  const a = mk('A', ['psychic'], {}, [mv('psycho-shift')]), b = mk('B', ['normal'], {}, [splash()]);
  a.status = 'brn';
  duel(a, b).playTurn(M0, M0);
  assert.equal(a.status, null); assert.equal(b.status, 'brn');
  const c = mk('C', ['psychic'], {}, [mv('trick')]), d = mk('D', ['normal'], {}, [splash()]);
  c.status = 'psn';
  const ev = duel(c, d).playTurn(M0, M0);
  assert.equal(c.status, null); assert.equal(d.status, 'psn');
  assert.ok(ev.some(e => e.t === 'sync'));
  const e = mk('E', ['psychic'], {}, [mv('trick')]), f = mk('F', ['normal'], {}, [splash()]);
  assert.ok(has(duel(e, f).playTurn(M0, M0), '실패'), '둘 다 정상이면 실패');
});

test('힘흡수: 상대의 공격 능력치만큼 회복하고 공격 −1', () => {
  const a = mk('A', ['grass'], {}, [mv('strength-sap')]), b = mk('B', ['normal'], { atk: 100 }, [splash()]);
  a.hp = 100;
  duel(a, b).playTurn(M0, M0);
  assert.equal(b.stages.atk, -1);
  assert.equal(a.hp, 200, '상대 공격 능력치 100 만큼 회복');
});

test('부식가스·금제·회복봉인·심플빔·고민씨', () => {
  const b = mk('B', ['normal'], {}, [splash()]);
  b.stages.atk = 3; b.stages.def = -1;
  duel(mk('A', ['poison'], {}, [mv('corrosive-gas')]), b).playTurn(M0, M0);
  assert.equal(b.stages.atk, 0); assert.equal(b.stages.def, -1, '내려간 능력은 그대로');
  const c = mk('C', ['normal'], {}, [mv('swords-dance')]);
  const bt = duel(mk('A', ['dark'], { spe: 300 }, [mv('embargo')]), c);
  bt.playTurn(M0, M0);
  assert.equal(c.stages.atk, 0, '금제: 능력을 올릴 수 없다');
  const d = mk('D', ['normal'], {}, [mv('recover')]); d.hp = 100;
  const bt2 = duel(mk('A', ['dark'], { spe: 300 }, [mv('heal-block')]), d);
  bt2.playTurn(M0, M0);
  assert.equal(d.hp, 100);
  assert.equal(bt2.legalActions(1).moves[0].usable, false);
  const e = mk('E', ['normal'], {}, [splash()]);
  duel(mk('A', ['grass'], {}, [mv('worry-seed')]), e).playTurn(M0, M0);
  assert.equal(e.insomnia, true);
  const f = mk('F', ['normal'], {}, [splash()]); f.status = 'slp'; f.sleepTurns = 3;
  duel(mk('A', ['grass'], {}, [mv('worry-seed')]), f).playTurn(M0, M0);
  assert.equal(f.status, null, '고민씨는 잠을 깨운다');
});

test('심플빔: 능력 변화가 2배가 된다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('simple-beam')]), b = mk('B', ['normal'], {}, [mv('swords-dance')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(b.simple, true);
  assert.equal(b.stages.atk, 4, '칼춤 +2 가 2배');
});

// ───────────── 부유·명중·급소 ─────────────
test('전자부유: 땅 기술 무효, 5턴 뒤 풀림 / 텔레키네시스: 상대는 땅 무효이며 내 공격이 필중', () => {
  const ground = atk({ type: T('ground') });
  const a = mk('A', ['steel'], { spe: 300 }, [mv('magnet-rise')]), b = mk('B', ['normal'], {}, [ground]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.hp, a.maxHp);
  assert.equal(bt.grounded(a), false);
  for (let i = 0; i < 4; i++) bt.playTurn(M0, M0);
  assert.equal(a.levitate, 0);
  const c = mk('C', ['psychic'], { spe: 300 }, [mv('telekinesis'), atk({ acc: 1 })]), d = mk('D', ['normal'], {}, [splash()]);
  const bt2 = duel(c, d, R(0.9));
  bt2.playTurn(M0, M0);
  assert.equal(d.float, 2);
  const ev = bt2.playTurn(M1, M0);
  assert.ok(!ev.some(e => e.t === 'miss'), '띄워진 상대에게는 명중 1 도 필중');
});

test('꿰뚫어보기·미라클아이: 고스트에 노말·격투, 악에 에스퍼가 맞는다', () => {
  const normal = atk(), g = mk('G', ['ghost'], {}, [splash()]), a = mk('A', ['normal'], {}, [mv('foresight')]);
  assert.equal(E.calcDamage(a, g, normal, { roll: 100 }).damage, 0);
  assert.ok(E.calcDamage(a, g, normal, { roll: 100, ctx: { fsG: true } }).damage > 0);
  const bt = duel(mk('A', ['normal'], { spe: 300 }, [mv('odor-sleuth')]), g);
  bt.playTurn(M0, M0); assert.equal(g.fsG, true);
  const dk = mk('D', ['dark'], {}, [splash()]);
  duel(mk('A', ['psychic'], { spe: 300 }, [mv('miracle-eye')]), dk).playTurn(M0, M0);
  assert.equal(dk.fsD, true);
  assert.ok(E.calcDamage(a, dk, atk({ type: T('psychic') }), { roll: 100, ctx: { fsD: true } }).damage > 0);
});

test('록온·마음의눈: 다음 공격이 반드시 명중한다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('lock-on'), atk({ acc: 1 })]), b = mk('B', ['normal'], {}, [splash()]);
  const bt = duel(a, b, R(0.99));
  bt.playTurn(M0, M0);
  assert.ok(a.lockOn > 0);
  const ev = bt.playTurn(M1, M0);
  assert.ok(!ev.some(e => e.t === 'miss'));
  assert.equal(a.lockOn, 0);
});

test('예민해지기: 다음 턴 공격이 반드시 급소에 맞는다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('laser-focus'), atk()]), b = mk('B', ['normal'], {}, [splash()]);
  const bt = duel(a, b, R(0.99));
  bt.playTurn(M0, M0);
  const ev = bt.playTurn(M1, M0);
  assert.ok(ev.some(e => e.t === 'crit'));
});

// ───────────── 저주·복수 ─────────────
test('저주: 고스트는 체력 절반으로 상대에게 매 턴 1/4 피해, 그 외는 공격·방어 +1 스피드 −1', () => {
  const a = mk('A', ['ghost'], { spe: 300 }, [mv('curse')]), b = mk('B', ['normal'], {}, [splash()]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.hp, 150); assert.equal(b.hp, 300 - 75);
  const c = mk('C', ['normal'], {}, [mv('curse')]);
  duel(c, idle()).playTurn(M0, M0);
  assert.deepEqual([c.stages.atk, c.stages.def, c.stages.spe], [1, 1, -1]);
});

test('길동무: 쓰러뜨린 상대도 함께 쓰러진다 / 원념: 쓰러뜨린 기술의 PP 가 0', () => {
  const a = mk('A', ['dark'], { spe: 300, hp: 50 }, [mv('destiny-bond')]), a2 = mk('A2', ['normal'], {}, [atk()]);
  const b = mk('B', ['normal'], {}, [atk({ power: 200 })]);
  const bt = duel([a, a2], [b, mk('B2', ['normal'], {}, [atk()])]);
  bt.playTurn(M0, M0);
  assert.equal(a.fainted, true); assert.equal(b.fainted, true);
  const c = mk('C', ['dark'], { spe: 300, hp: 50 }, [mv('grudge')]), c2 = mk('C2', ['normal'], {}, [atk()]);
  const killer = atk({ power: 200 });
  const d = mk('D', ['normal'], {}, [killer]);
  const bt2 = duel([c, c2], [d, mk('D2', ['normal'], {}, [atk()])]);
  bt2.playTurn(M0, M0);
  assert.equal(d.moves[0].pp, 0);
});

test('봉인: 내가 가진 기술을 상대가 쓰지 못한다', () => {
  const shared = mv('swords-dance');
  const a = mk('A', ['psychic'], { spe: 300 }, [mv('imprison'), shared]), b = mk('B', ['normal'], {}, [Object.assign({}, shared), atk()]);
  const bt = duel(a, b);
  bt.playTurn(M0, M1);
  const la = bt.legalActions(1);
  assert.equal(la.moves[0].usable, false); assert.equal(la.moves[0].why, '봉인');
  assert.equal(la.moves[1].usable, true);
});

test('가로채기: 상대의 강화 기술을 가로챈다 / 매직코트: 상대의 변화기를 되받아친다', () => {
  const a = mk('A', ['dark'], { spe: 1 }, [mv('snatch')]), b = mk('B', ['normal'], { spe: 300 }, [mv('swords-dance')]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(a.stages.atk, 2); assert.equal(b.stages.atk, 0);
  const c = mk('C', ['psychic'], { spe: 1 }, [mv('magic-coat')]), d = mk('D', ['normal'], { spe: 300 }, [mv('toxic')]);
  duel(c, d).playTurn(M0, M0);
  assert.equal(c.status, null); assert.equal(d.status, 'tox');
});

test('분진: 불꽃 기술이 실패하고 체력 1/4 피해', () => {
  const a = mk('A', ['bug'], { spe: 300 }, [mv('powder')]), b = mk('B', ['normal'], {}, [atk({ type: T('fire') })]);
  duel(a, b).playTurn(M0, M0);
  assert.equal(a.hp, a.maxHp);
  assert.equal(b.hp, 300 - 75);
});

test('문어굳히기: 상대를 가두고 매 턴 방어·특방 −1', () => {
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('octolock')]), b = mk('B', ['normal'], {}, [splash()]), b2 = idle();
  const bt = duel(a, [b, b2]);
  bt.playTurn(M0, M0);
  assert.equal(b.octolock, true);
  assert.deepEqual(A(bt.legalActions(1).switches), []);
  assert.equal(b.stages.def, -1); assert.equal(b.stages.spd, -1);
  bt.playTurn(M0, M0);
  assert.equal(b.stages.def, -2);
});

test('타르샷: 스피드 −1, 불꽃 기술이 2배', () => {
  const a = mk('A', ['rock'], { spe: 300 }, [mv('tar-shot')]), b = mk('B', ['normal'], {}, [splash()]);
  duel(a, b).playTurn(M0, M0);
  assert.equal(b.stages.spe, -1); assert.equal(b.tarred, true);
  const fire = atk({ type: T('fire') });
  assert.equal(E.typeMultiplier(T('fire'), b.types, { tar: true }), 2);
  assert.equal(E.calcDamage(a, b, fire, { roll: 100, ctx: { tar: true } }).damage, 2 * E.calcDamage(a, b, fire, { roll: 100 }).damage - 0, '대략 2배');
});

// ───────────── 비축·자기 강화 ─────────────
test('비축하기·꿀꺽: 최대 3번, 비축한 만큼 회복하고 올린 방어를 되돌린다', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('stockpile'), mv('swallow')]);
  a.hp = 60;
  const bt = duel(a, idle());
  bt.playTurn(M0, M0); bt.playTurn(M0, M0);
  assert.equal(a.stock, 2); assert.equal(a.stages.def, 2);
  bt.playTurn(M0, M0); bt.playTurn(M0, M0);
  assert.equal(a.stock, 3);
  bt.playTurn(M1, M0);
  assert.equal(a.hp, 300, '100% 회복');
  assert.equal(a.stock, 0); assert.equal(a.stages.def, 0);
  assert.ok(has(bt.playTurn(M1, M0), '실패'));
});

test('배수의진: 모든 능력 +1 하지만 교체할 수 없다 / 정리정돈: 함정·대타 제거', () => {
  const a = mk('A', ['fighting'], { spe: 300 }, [mv('no-retreat')]), a2 = idle();
  const bt = duel([a, a2], idle());
  bt.playTurn(M0, M0);
  assert.equal(a.stages.spe, 1);
  assert.deepEqual(A(bt.legalActions(0).switches), []);
  assert.ok(has(bt.playTurn(M0, M0), '실패'));
  const c = mk('C', ['normal'], { spe: 300 }, [mv('tidy-up')]), d = idle();
  const bt2 = duel(c, d);
  bt2.sides[0].cond.rocks = true; bt2.sides[1].cond.spikes = 2; d.sub = 50;
  bt2.playTurn(M0, M0);
  assert.equal(bt2.sides[0].cond.rocks, false); assert.equal(bt2.sides[1].cond.spikes, 0); assert.equal(d.sub, 0);
  assert.equal(c.stages.atk, 1); assert.equal(c.stages.spe, 1);
});

test('지오컨트롤: 첫 턴은 힘을 모으고 다음 턴 효과가 나온다 (그동안 다른 기술은 못 쓴다)', () => {
  const a = mk('A', ['fairy'], { spe: 300 }, [mv('geomancy'), atk()]);
  const bt = duel(a, idle());
  const ev = bt.playTurn(M0, M0);
  assert.ok(has(ev, '에너지를 모으고'));
  assert.equal(a.stages.spa, 0);
  const la = bt.legalActions(0);
  assert.equal(la.moves[1].usable, false); assert.equal(la.moves[1].why, '충전 중');
  bt.playTurn(M1, M0);                    // 다른 기술을 골라도 충전한 기술이 나온다
  assert.equal(a.stages.spa, 2); assert.equal(a.stages.spd, 2); assert.equal(a.stages.spe, 2);
  assert.equal(a.moves[0].pp, 98, 'PP 는 한 번만 깎인다');
});

test('취향: 능력 단계만 오르는 신기술(하바네로엑기스·익스트림부스트·코칭 …)', () => {
  const a = mk('A', ['normal'], { spe: 300 }, [mv('extreme-evoboost')]);
  duel(a, idle()).playTurn(M0, M0);
  assert.deepEqual(['atk', 'def', 'spa', 'spd', 'spe'].map(k => a.stages[k]), [2, 2, 2, 2, 2]);
  const b = idle();
  duel(mk('A', ['grass'], { spe: 300 }, [mv('spicy-extract')]), b).playTurn(M0, M0);
  assert.equal(b.stages.atk, 2); assert.equal(b.stages.def, -2);
  const c = mk('C', ['psychic'], { spe: 300 }, [mv('take-heart')]); c.status = 'brn';
  duel(c, idle()).playTurn(M0, M0);
  assert.equal(c.status, null); assert.equal(c.stages.spa, 1);
});

test('플라워힐: 그래스필드에서는 2/3 회복', () => {
  const a = mk('A', ['fairy'], { spe: 300 }, [mv('floral-healing')]); a.hp = 1;
  const bt = duel(a, idle());
  bt.field.terrain = 'grassy'; bt.field.terrainTurns = 5;
  bt.playTurn(M0, M0);
  assert.ok(a.hp >= 200, '2/3 회복(+필드 회복)');
});

test('순서미루기·당신먼저·도우미', () => {
  const a = mk('A', ['dark'], { spe: 300 }, [mv('quash'), atk({ power: 50 })]), b = mk('B', ['normal'], { spe: 100 }, [atk({ power: 50 })]);
  const bt = duel(a, b);
  bt.playTurn(M0, M0);
  assert.equal(b.nextOrder, -1);
  bt.playTurn(M1, M0);
  assert.equal(b.nextOrder, 0, '다음 턴 시작에 적용되고 사라진다');
  const slow = mk('S', ['normal'], { spe: 1 }, [mv('after-you'), atk({ power: 50 })]), fast = mk('F', ['normal'], { spe: 300 }, [splash(), atk({ power: 50 })]);
  const bt2 = duel(slow, fast);
  bt2.playTurn(M0, M0);
  const ev = bt2.playTurn(M1, M1);
  const moves = ev.filter(e => e.t === 'move').map(e => e.side);
  assert.equal(moves[0], 0, '당신먼저를 쓴 쪽이 다음 턴 먼저 움직인다');
  const h = mk('H', ['normal'], { spe: 300 }, [mv('helping-hand'), atk()]);
  const bt3 = duel(h, idle());
  bt3.playTurn(M0, M0);
  const base = E.calcDamage(h, bt3.active(1), h.moves[1], { roll: 100 }).damage;
  const boosted = E.calcDamage(h, bt3.active(1), h.moves[1], { roll: 100, ctx: bt3.ctx(0) }).damage;
  assert.ok(boosted > base * 1.4);
});

test('싱글 배틀에서 효과 없는 기술은 실패하거나 아무 일도 없다', () => {
  for (const id of ['ally-switch', 'follow-me', 'rage-powder', 'spotlight']) assert.ok(has(duel(mk('A', ['normal'], {}, [mv(id)]), idle()).playTurn(M0, M0), '아군이 없다'), id);
  assert.ok(has(duel(mk('A', ['normal'], {}, [mv('bestow')]), idle()).playTurn(M0, M0), '도구가 없다'));
  for (const id of ['celebrate', 'happy-hour', 'hold-hands']) assert.ok(has(duel(mk('A', ['normal'], {}, [mv(id)]), idle()).playTurn(M0, M0), '아무 일도'), id);
});

// ───────────── AI · 파티 ─────────────
test('AI: 쓰러지기 직전이면 길동무를 쓰고 필요 없는 때는 쓰지 않는다', () => {
  const brain = AI.create(E, { seed: 1 });
  const a = mk('A', ['ghost'], { spe: 300 }, [mv('destiny-bond'), atk({ power: 20 })]); a.hp = 40;
  const b = mk('B', ['normal'], {}, [atk({ power: 120 })]);
  const bt = duel(a, b);
  assert.equal(brain.chooseAction(bt, 0, 'hard').index, 0);
  const c = mk('C', ['ghost'], { spe: 300 }, [mv('destiny-bond'), atk({ power: 120 })]);
  assert.equal(brain.chooseAction(duel(c, idle()), 0, 'hard').index, 1);
});

test('AI: 교체 선택(교체 기술 뒤 · 기절 뒤)은 현재 나와 있는 포켓몬을 고르지 않는다', () => {
  const brain = AI.create(E, { seed: 3 });
  const a = mk('A', ['psychic'], {}, [mv('teleport')]), a2 = mk('A2', ['water'], {}, [atk()]), a3 = mk('A3', ['fire'], {}, [atk()]);
  const bt = duel([a, a2, a3], idle());
  bt.playTurn(M0, M0);
  for (const lv of ['easy', 'normal', 'hard']) for (let i = 0; i < 20; i++) assert.notEqual(brain.chooseReplacement(bt, 0, lv), 0);
});

test('AI: 3단계 변화기를 가진 배틀을 끝까지 치른다 (무작위 선택 + AI 혼합 300판)', () => {
  const statusIds = Object.keys(data.moves).filter(i => data.moves[i].c === 'n').map(Number);
  const rnd = E.mulberry32(5);
  const pick = l => l[Math.floor(rnd() * l.length)];
  let pivots = 0, ended = 0;
  for (let g = 0; g < 300; g++) {
    const team = () => [0, 1, 2].map(() => E.makeMon(1 + Math.floor(rnd() * 1025), { moves: [...new Set([pick(statusIds), pick(statusIds), pick(statusIds), pick(statusIds)])] }));
    const bt = E.createBattle({ parties: [team(), team()], seed: g + 11, maxTurns: 100 });
    const brains = [AI.create(E, { seed: g }), AI.create(E, { seed: g + 1 })];
    bt.start();
    let guard = 0;
    while (bt.phase !== 'ended') {
      if (++guard > 400) throw new Error('끝나지 않음');
      if (bt.phase === 'switch') {
        for (const si of bt.pending.slice()) { if (bt.phase === 'switch' && bt.pending.includes(si)) { if (bt.pivot) pivots++; bt.replace(si, brains[si].chooseReplacement(bt, si, 'hard')); } }
        continue;
      }
      bt.playTurn(brains[0].chooseAction(bt, 0, 'hard'), brains[1].chooseAction(bt, 1, 'normal'));
      for (const m of bt.sides.flatMap(s => s.party)) assert.ok(m.hp >= 0 && m.hp <= m.maxHp);
    }
    ended++;
  }
  assert.equal(ended, 300);
  assert.ok(pivots > 5, '턴 도중 교체가 실제로 일어났다');
});

test('파티: 무작위 기술 구성은 싱글에서 쓸 수 없는 기술(dead)을 뽑지 않는다', () => {
  const P = PT.create(data);
  const rnd = E.mulberry32(9);
  let withNew = 0;
  for (let i = 0; i < 1500; i++) {
    const id = 1 + Math.floor(rnd() * 1025);
    const ms = P.pickMoveset(id, rnd);
    assert.ok(ms.length <= 4);
    for (const m of ms) { assert.ok(!data.moves[m].fx.dead, `${data.moves[m].e} 는 뽑히면 안 된다`); if (data.moves[m].c === 'n' && Number(m) > 0 && ['teleport', 'curse', 'baton-pass', 'kings-shield', 'gravity'].includes(data.moves[m].e)) withNew++; }
  }
  assert.ok(withNew > 0, '3단계 기술도 뽑힌다');
});
