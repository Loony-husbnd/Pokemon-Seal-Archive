// 변화기(1단계) 테스트:  npm run test:battle
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBattle } from '../../tools/lib/load-battle.mjs';

const { engine: E, data, ai: AI, party: PT } = loadBattle();
const T = name => data.types.find(t => t.e === name).id;
const A = x => [...x];

function mk(name, types, stats, moves) {
  return E.makeCustomMon({
    name, types: types.map(T),
    stats: Object.assign({ hp: 300, atk: 200, def: 200, spa: 200, spd: 200, spe: 100 }, stats),
    moves,
  });
}
/** 변화기. fx 만 넘기면 된다 (명중 null = 자신에게 쓰는 기술) */
const sm = (name, fx, over) => Object.assign({ id: 900, name, type: T('normal'), cls: 'status', power: 0, acc: null, pp: 10, maxPp: 10, pri: 0, fx }, over);
const NOP = () => sm('멍때리기', {});
const ail = (kind, over) => sm('상태이상기', { ail: { kind, chance: 100 } }, Object.assign({ acc: 100 }, over));
const R = v => () => v;
function duel(a, b, rng) {
  const bt = E.createBattle({ parties: [[a], [b]], rng: rng || R(0.5) });
  bt.start();
  return bt;
}
const M = { type: 'move', index: 0 };
const texts = ev => ev.map(e => e.text).filter(Boolean);

// ───────────── 상태이상 ─────────────
test('상태이상 변화기: 상대에게 상태이상을 건다', () => {
  for (const [kind, want] of [['psn', 'psn'], ['brn', 'brn'], ['par', 'par'], ['slp', 'slp'], ['tox', 'tox']]) {
    const a = mk('A', ['normal'], {}, [ail(kind)]), b = mk('B', ['normal'], {}, [NOP()]);
    const bt = duel(a, b);
    const ev = bt.playTurn(M, M);
    assert.equal(b.status, want, kind);
    assert.ok(ev.some(e => e.t === 'status' && e.side === 1 && e.kind === want));
    assert.equal(ev.filter(e => e.t === 'damage' && !e.cause).length, 0, '변화기는 직접 피해가 없다');
  }
});

test('혼란 변화기와 이미 혼란인 상대(실패)', () => {
  const a = mk('A', ['normal'], {}, [ail('cnf')]), b = mk('B', ['normal'], {}, [NOP()]);
  const bt = duel(a, b);
  bt.playTurn(M, M);
  assert.ok(b.confusion > 0);
  const ev = bt.playTurn(M, M);
  assert.ok(texts(ev).includes('하지만 실패했다...'));
});

test('이미 상태이상인 상대에게는 실패하고, 덮어쓰지 않는다', () => {
  const a = mk('A', ['normal'], {}, [ail('par')]), b = mk('B', ['normal'], {}, [NOP()]);
  b.status = 'brn';
  const ev = duel(a, b).playTurn(M, M);
  assert.equal(b.status, 'brn');
  assert.ok(texts(ev).includes('하지만 실패했다...'));
});

test('타입 면역: 불꽃=화상, 전기=마비, 독/강철=독 → 효과 없음', () => {
  const cases = [['brn', 'fire'], ['par', 'electric'], ['psn', 'poison'], ['tox', 'steel']];
  for (const [kind, type] of cases) {
    const a = mk('A', ['normal'], {}, [ail(kind)]), b = mk('B', [type], {}, [NOP()]);
    const ev = duel(a, b).playTurn(M, M);
    assert.equal(b.status, null, `${kind} vs ${type}`);
    assert.ok(ev.some(e => e.t === 'effective' && e.eff === 0), `${kind} vs ${type}`);
  }
});

test('가루 기술은 풀 타입에게 효과가 없다 / 전기자석파는 땅 타입에게 효과가 없다', () => {
  const powder = ail('slp', { fx: { ail: { kind: 'slp', chance: 100 }, powder: true } });
  let b = mk('B', ['grass'], {}, [NOP()]);
  duel(mk('A', ['normal'], {}, [powder]), b).playTurn(M, M);
  assert.equal(b.status, null);
  b = mk('B', ['normal'], {}, [NOP()]);
  duel(mk('A', ['normal'], {}, [powder]), b).playTurn(M, M);
  assert.equal(b.status, 'slp');

  const wave = ail('par', { type: T('electric'), fx: { ail: { kind: 'par', chance: 100 }, typeImmune: true } });
  b = mk('B', ['ground'], {}, [NOP()]);
  duel(mk('A', ['electric'], {}, [wave]), b).playTurn(M, M);
  assert.equal(b.status, null);
});

test('명중 판정: 낮은 명중률은 빗나가고, 자신에게 쓰는 기술은 빗나가지 않는다', () => {
  let b = mk('B', ['normal'], {}, [NOP()]);
  let ev = duel(mk('A', ['normal'], {}, [ail('slp', { acc: 60 })]), b, R(0.99)).playTurn(M, M);
  assert.equal(b.status, null);
  assert.ok(ev.some(e => e.t === 'miss'));
  b = mk('B', ['normal'], {}, [NOP()]);
  duel(mk('A', ['normal'], {}, [ail('slp', { acc: 60 })]), b, R(0.1)).playTurn(M, M);
  assert.equal(b.status, 'slp');

  const a = mk('A', ['normal'], {}, [sm('칼춤', { self: [{ stat: 'atk', change: 2, chance: 100 }] })]);
  ev = duel(a, mk('B', ['normal'], {}, [NOP()]), R(0.999)).playTurn(M, M);
  assert.equal(a.stages.atk, 2);
  assert.ok(!ev.some(e => e.t === 'miss'));
});

test('독 타입이 쓴 맹독은 필중', () => {
  const toxic = ail('tox', { acc: 90 });
  const b = mk('B', ['normal'], {}, [NOP()]);
  duel(mk('A', ['poison'], {}, [toxic]), b, R(0.999)).playTurn(M, M);
  assert.equal(b.status, 'tox');
  const b2 = mk('B', ['normal'], {}, [NOP()]);
  duel(mk('A', ['normal'], {}, [toxic]), b2, R(0.999)).playTurn(M, M);
  assert.equal(b2.status, null);
});

// ───────────── 능력 변화 ─────────────
test('자신의 능력 상승: 칼춤 +2, 용의춤 +1/+1, 껍질깨기(오르고 내리고)', () => {
  const up = (stat, change) => ({ stat, change, chance: 100 });
  const a = mk('A', ['normal'], {}, [
    sm('칼춤', { self: [up('atk', 2)] }), sm('용의춤', { self: [up('atk', 1), up('spe', 1)] }),
    sm('껍질깨기', { self: [up('atk', 2), up('spa', 2), up('spe', 2), up('def', -1), up('spd', -1)] }),
  ]);
  const bt = duel(a, mk('B', ['normal'], {}, [NOP()]));
  bt.playTurn(M, M);
  assert.equal(a.stages.atk, 2);
  bt.playTurn({ type: 'move', index: 1 }, M);
  assert.deepEqual([a.stages.atk, a.stages.spe], [3, 1]);
  bt.playTurn({ type: 'move', index: 2 }, M);
  assert.deepEqual([a.stages.atk, a.stages.spa, a.stages.spe, a.stages.def, a.stages.spd], [5, 2, 3, -1, -1]);
});

test('능력 단계는 ±6 에서 멈추고 안내 메시지가 나온다', () => {
  const a = mk('A', ['normal'], {}, [sm('칼춤', { self: [{ stat: 'atk', change: 2, chance: 100 }] })]);
  const bt = duel(a, mk('B', ['normal'], {}, [NOP()]));
  let last;
  for (let i = 0; i < 4; i++) last = bt.playTurn(M, M);
  assert.equal(a.stages.atk, 6);
  assert.ok(texts(last).some(t => t.includes('더 이상 올라가지 않는다')));
});

test('상대 능력 하락과 허세(상대 공격 +2 & 혼란)', () => {
  const a = mk('A', ['normal'], {}, [
    sm('울음소리', { tgt: [{ stat: 'atk', change: -1, chance: 100 }] }, { acc: 100 }),
    sm('허세', { tgt: [{ stat: 'atk', change: 2, chance: 100 }], ail: { kind: 'cnf', chance: 100 } }, { acc: 85 }),
  ]);
  const b = mk('B', ['normal'], {}, [NOP()]);
  const bt = duel(a, b);
  bt.playTurn(M, M);
  assert.equal(b.stages.atk, -1);
  bt.playTurn({ type: 'move', index: 1 }, M);
  assert.equal(b.stages.atk, 1);
  assert.ok(b.confusion > 0);
});

// ───────────── 회복 ─────────────
test('회복기: 최대 체력의 50% 회복, 최대 체력을 넘지 않고, 가득 차 있으면 실패', () => {
  const a = mk('A', ['normal'], { hp: 301 }, [sm('자가재생', { heal: 50 })]);
  const bt = duel(a, mk('B', ['normal'], {}, [NOP()]));
  let ev = bt.playTurn(M, M);
  assert.equal(a.hp, 301);
  assert.ok(texts(ev).includes('하지만 실패했다...'));
  a.hp = 10;
  ev = bt.playTurn(M, M);
  assert.equal(a.hp, 10 + 150);
  assert.ok(ev.some(e => e.t === 'heal' && e.amount === 150));
  a.hp = 280;
  bt.playTurn(M, M);
  assert.equal(a.hp, 301);
});

test('잠자기: 체력 전부 회복 + 상태이상 해제 후 잠듦, 2턴 뒤 깨어난다', () => {
  const a = mk('A', ['normal'], {}, [sm('잠자기', { rest: true }), sm('칼춤', { self: [{ stat: 'atk', change: 1, chance: 100 }] })]);
  const bt = duel(a, mk('B', ['normal'], {}, [NOP()]));
  a.hp = 50; a.status = 'brn';
  bt.playTurn(M, M);
  assert.equal(a.hp, 300);
  assert.equal(a.status, 'slp');
  const sw = { type: 'move', index: 1 };
  let ev = bt.playTurn(sw, M);   // 잠듦 1턴째
  assert.equal(a.stages.atk, 0);
  ev = bt.playTurn(sw, M);       // 잠듦 2턴째
  assert.equal(a.stages.atk, 0);
  ev = bt.playTurn(sw, M);       // 3턴째에는 눈을 뜨고 행동한다
  assert.ok(ev.some(e => e.t === 'status' && e.kind === 'wake'));
  assert.equal(a.stages.atk, 1);
  // 체력이 가득이면 실패
  a.status = null;
  ev = bt.playTurn(M, M);
  assert.ok(texts(ev).includes('하지만 실패했다...'));
});

test('뱃대띠: 체력 절반을 내고 공격 +6, 체력이 모자라면 실패', () => {
  const a = mk('A', ['normal'], {}, [sm('뱃대띠', { hpCost: 50, self: [{ stat: 'atk', change: 6, chance: 100 }] })]);
  const bt = duel(a, mk('B', ['normal'], {}, [NOP()]));
  const ev = bt.playTurn(M, M);
  assert.equal(a.hp, 150);
  assert.equal(a.stages.atk, 6);
  assert.ok(ev.some(e => e.t === 'damage' && e.cause === 'cost'));
  const ev2 = bt.playTurn(M, M);     // 이미 +6 → 실패, 체력은 더 줄지 않는다
  assert.equal(a.hp, 150);
  assert.ok(texts(ev2).includes('하지만 실패했다...'));
});

// ───────────── 엔진 일반 ─────────────
test('변화기는 데미지 계산/추정에서 0 이고, 분류는 status', () => {
  const a = mk('A', ['normal'], {}, [ail('par')]), b = mk('B', ['normal'], {}, [NOP()]);
  assert.equal(E.calcDamage(a, b, a.moves[0]).damage, 0);
  assert.equal(E.estimateDamage(a, b, a.moves[0]).expected, 0);
  assert.equal(E.makeMove(Object.keys(data.moves).find(i => data.moves[i].c === 'n')).cls, 'status');
});

test('변화기에도 우선도와 PP 소모가 적용된다', () => {
  const a = mk('A', ['normal'], { spe: 1 }, [sm('선제기', { self: [{ stat: 'atk', change: 1, chance: 100 }] }, { pri: 1, pp: 1, maxPp: 1 })]);
  const b = mk('B', ['normal'], { spe: 999 }, [NOP()]);
  const bt = duel(a, b);
  const ev = bt.playTurn(M, M);
  assert.equal(ev.find(e => e.t === 'move').side, 0, '우선도 +1 이라 느려도 먼저 쓴다');
  assert.equal(a.moves[0].pp, 0);
  assert.equal(bt.legalActions(0).mustStruggle, true);
});

test('describeEffect: 효과 한 줄 요약', () => {
  const d = id => E.describeEffect(E.makeMove(Object.keys(data.moves).find(i => data.moves[i].e === id)));
  assert.equal(d('toxic'), '상대 맹독');
  assert.equal(d('swords-dance'), '공격 +2');
  assert.equal(d('recover'), '체력 50% 회복');
  assert.equal(d('belly-drum'), '체력 50% 소모 · 공격 +6');
  assert.equal(d('swagger'), '상대 공격 +2 · 상대 혼란');
});

// ───────────── 데이터 ─────────────
test('데이터: 1단계 변화기 50개가 그대로 들어 있고 형식이 올바르다', () => {
  const stage1 = new Set(['poison-powder', 'toxic', 'will-o-wisp', 'thunder-wave', 'stun-spore', 'glare', 'sleep-powder', 'spore', 'hypnosis', 'sing', 'lovely-kiss', 'supersonic', 'confuse-ray',
    'sweet-kiss', 'swagger', 'flatter', 'growl', 'tail-whip', 'leer', 'screech', 'charm', 'sand-attack', 'smokescreen', 'scary-face', 'string-shot', 'metal-sound', 'swords-dance', 'dragon-dance',
    'nasty-plot', 'calm-mind', 'bulk-up', 'iron-defense', 'amnesia', 'agility', 'rock-polish', 'quiver-dance', 'shell-smash', 'growth', 'harden', 'cotton-guard', 'coil', 'belly-drum', 'double-team',
    'recover', 'soft-boiled', 'slack-off', 'moonlight', 'synthesis', 'morning-sun', 'rest']);
  const st = Object.entries(data.moves).filter(([, m]) => m.c === 'n');
  assert.ok(st.length >= 50);
  assert.equal(st.filter(([, m]) => stage1.has(m.e)).length, 50);
  for (const [, m] of st) {
    assert.equal(m.pw, 0, m.e);
    assert.ok(m.fx.ail || m.fx.tgt || m.fx.self || m.fx.heal || m.fx.rest || Object.keys(m.fx).length, `${m.e}: 효과 없음`);
    assert.ok(m.ac === null || m.ac > 0, `${m.e}: 명중률 오류`);
    if (m.fx.ail) assert.ok(m.ac > 0, `${m.e}: 상태이상을 거는 기술은 명중률이 있어야 한다`);
  }
  for (const p of Object.values(data.pokemon)) {
    for (const mid of p.sm) assert.equal(data.moves[mid].c, 'n');
    for (const mid of p.ss) assert.ok(p.sm.includes(mid), 'ss 는 sm 의 부분집합');
  }
});

test('pickMoveset: 최대 4개, 중복 없음, 공격기 최소 2개, 역할이 겹치지 않는다', () => {
  const P = PT.create(data);
  const rng = E.mulberry32(11);
  let withStatus = 0;
  for (let i = 0; i < 1500; i++) {
    const id = 1 + Math.floor(rng() * 1025), p = data.pokemon[id];
    const set = A(P.pickMoveset(id, rng));
    assert.ok(set.length >= 1 && set.length <= 4, `#${id}`);
    assert.equal(new Set(set).size, set.length);
    const stat = set.filter(m => data.moves[m].c === 'n');
    if (p.sm.length && p.m.length >= 2) assert.ok(set.length - stat.length >= 2 || p.m.length < 4, `#${id} 공격기 부족`);
    if (stat.length) withStatus++;
    const heals = stat.filter(m => data.moves[m].fx.heal || data.moves[m].fx.rest);
    assert.ok(heals.length <= 1, `#${id} 회복기 중복`);
    set.forEach(m => assert.ok(p.m.includes(m) || p.sm.includes(m), `#${id} 배울 수 없는 기술`));
  }
  assert.ok(withStatus > 1400, '거의 모든 포켓몬이 변화기를 가진다');
});

test('pickMoveset: 같은 시드면 같은 결과', () => {
  const P = PT.create(data);
  assert.deepEqual(A(P.pickMoveset(6, E.mulberry32(5))), A(P.pickMoveset(6, E.mulberry32(5))));
});

// ───────────── AI ─────────────
const byIdent = ident => Object.keys(data.moves).find(i => data.moves[i].e === ident);
const row = (rows, ident) => rows.find(r => r.mv.id === Number(byIdent(ident)));
function aiBattle(aMon, bMon, seed) {
  const bt = E.createBattle({ parties: [[aMon], [bMon]], seed: seed || 1 });
  bt.start();
  return { bt, ai: AI.create(E, { seed: 1 }) };
}
const real = (id, moves) => E.makeMon(id, { moves: moves.map(byIdent) });

test('AI: 상태이상이 이미 걸린 상대/면역 상대에게는 상태이상기를 고르지 않는다', () => {
  const me = real(6, ['flamethrower', 'toxic']);     // 리자몽: 화염방사 / 맹독
  const foe = real(25, ['thunderbolt']);             // 피카츄
  const { bt, ai } = aiBattle(me, foe);
  const rows = ai.scoreMoves(me, foe, true, 'hard');
  assert.ok(rows.find(r => r.mv.id === Number(byIdent('toxic'))).score > 0, '일반 상대에겐 맹독 가치가 있다');
  foe.status = 'par';
  assert.equal(ai.scoreMoves(me, foe, true, 'hard').find(r => r.mv.id === Number(byIdent('toxic'))).score, -1);
  foe.status = null; foe.types = [T('steel')];
  assert.equal(ai.scoreMoves(me, foe, true, 'hard').find(r => r.mv.id === Number(byIdent('toxic'))).score, -1);
});

test('AI: 체력이 낮고 안전하면 회복, 체력이 가득이면 회복 안 함', () => {
  const me = real(143, ['body-slam', 'recover']);    // 잠만보 (재생)
  const foe = real(25, ['thunderbolt']);
  const { bt, ai } = aiBattle(me, foe);
  const full = ai.scoreMoves(me, foe, true, 'hard');
  assert.equal(full.find(r => r.mv.id === Number(byIdent('recover'))).score, -1);
  me.hp = Math.floor(me.maxHp * 0.3);
  const low = ai.scoreMoves(me, foe, true, 'hard');
  const heal = low.find(r => r.mv.id === Number(byIdent('recover'))).score, atk = low.find(r => r.mv.id === Number(byIdent('body-slam'))).score;
  assert.ok(heal > 0);
});

test('AI: 능력을 이미 많이 올렸으면 더 올리지 않는다', () => {
  const me = real(6, ['flamethrower', 'swords-dance']);
  const foe = real(143, ['body-slam']);
  const { ai } = aiBattle(me, foe);
  const sd = () => ai.scoreMoves(me, foe, true, 'hard').find(r => r.mv.id === Number(byIdent('swords-dance'))).score;
  const s0 = sd();
  me.stages.atk = 4;
  const s4 = sd();
  me.stages.atk = 6;
  assert.ok(s0 > s4, '올라갈수록 가치가 줄어든다');
  assert.equal(sd(), -1, '6단계면 쓸 이유가 없다');
});

test('AI: 변화기를 가진 배틀이 끝까지 정상 진행된다 (무한 대치 없음)', () => {
  const P = PT.create(data);
  const rng = E.mulberry32(3);
  let ended = 0, draws = 0;
  for (let g = 0; g < 60; g++) {
    const ids = [0, 1].map(() => [0, 1, 2].map(() => 1 + Math.floor(rng() * 1025)));
    const parties = ids.map(side => side.map(id => E.makeMon(id, { moves: A(P.pickMoveset(id, rng)) })));
    const bt = E.createBattle({ parties, seed: g + 1 });
    const brains = [AI.create(E, { seed: g }), AI.create(E, { seed: g + 100 })];
    bt.start();
    let guard = 0;
    while (bt.phase !== 'ended' && guard++ < 800) {
      if (bt.phase === 'switch') { bt.pending.slice().forEach(si => bt.replace(si, brains[si].chooseReplacement(bt, si, 'hard'))); continue; }
      bt.playTurn(brains[0].chooseAction(bt, 0, 'hard'), brains[1].chooseAction(bt, 1, 'hard'));
    }
    assert.equal(bt.phase, 'ended');
    ended++;
    if (bt.winner === 'draw') draws++;
  }
  assert.equal(ended, 60);
  assert.ok(draws <= 6, `무승부가 너무 많다: ${draws}/60`);
});
