// Rembrandt 2 기초 층 테스트: 규칙(9세대·메가만) · 정보 가리기 · 복제 안전 · 선택지
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, legalChoices, FORMAT_ID } from '../src/index.js';

const EV = { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 };
const set = (species, ability, item, moves, extra) => Object.assign({ species, ability, item, moves, evs: EV }, extra);
const teamA = () => [set('Charizard', 'Blaze', 'Charizardite X', ['dragonclaw', 'flareblitz', 'dragondance', 'roost']), set('Garchomp', 'Rough Skin', 'Life Orb', ['earthquake', 'outrage']), set('Corviknight', 'Pressure', 'Leftovers', ['bravebird', 'roost'])];
const teamB = () => [set('Blissey', 'Natural Cure', 'Leftovers', ['softboiled', 'seismictoss']), set('Kingambit', 'Defiant', 'Black Glasses', ['suckerpunch', 'kowtowcleave']), set('Toxapex', 'Regenerator', 'Black Sludge', ['scald', 'recover'])];
const move = (index, extra) => Object.assign({ type: 'move', index }, extra);
const sig = m => JSON.stringify(m.battle.toJSON().sides.map(s => s.pokemon.map(p => p.hp)));

test('규칙: 9세대 비디버그 형식 + 테라스탈 금지', () => {
  assert.match(FORMAT_ID, /^gen9/); assert.match(FORMAT_ID, /Terastal Clause/);
  const m = createMatch({ teams: [teamA(), teamB()] });
  assert.equal(m.turn, 1);
  assert.throws(() => m.submit(['move 1 terastallize', move(0)]), /올바르지 않다/);
  assert.equal(m.turn, 1, '거부된 선택은 진행하지 않는다');
});

test('메가진화: 메가스톤을 든 포켓몬만 메가 선택지가 있고, 메가하면 모습이 바뀐다', () => {
  const m = createMatch({ teams: [teamA(), teamB()] });
  const c = m.choices(0);
  assert.ok(c.some(x => x.type === 'move' && x.mega), '리자몽은 메가 가능');
  assert.ok(!m.choices(1).some(x => x.mega), '블래시키는 메가 불가');
  m.submit([move(0, { mega: true }), move(0)]);
  assert.equal(m.battle.p1.active[0].species.name, 'Charizard-Mega-X');
  assert.ok(!m.choices(0).some(x => x.mega), '메가는 한 번만');
});

test('정보 가리기: 상대 체력은 퍼센트, 드러나지 않은 특성·도구는 내 시점에 없다', () => {
  const m = createMatch({ teams: [teamA(), teamB()] });
  m.submit([move(1), move(1)]);
  const mine = m.view(0).join('\n'), omni = m.omniscient().join('\n');
  assert.match(mine, /\|switch\|p2a: Blissey\|[^|]*\|100\/100/, '상대 체력은 100 기준');
  assert.match(omni, /\|switch\|p2a: Blissey\|[^|]*\|\d{3,}\/\d{3,}/, '전지적 시점은 정확한 체력');
  assert.ok(!/Black Glasses|Black Sludge/.test(mine), '상대 도구는 가려짐');
  assert.ok(m.view(0).length > 0 && m.view(1).length > 0);
});

test('복제: 복제본을 굴려도 원본은 변하지 않는다 (깊은 복사)', () => {
  const m = createMatch({ teams: [teamA(), teamB()] });
  m.submit([move(0), move(0)]);
  const before = JSON.stringify(m.battle.toJSON());
  for (let i = 0; i < 20; i++) { const c = m.clone([i + 1, 2, 3, 4]); c.submit([move(1), move(0)]); }
  assert.equal(JSON.stringify(m.battle.toJSON()), before);
});

test('복제: 시드를 새로 주면 같은 선택이라도 결과가 갈린다 (급소·빗나감을 미리 볼 수 없다)', () => {
  const m = createMatch({ teams: [teamA(), teamB()], seed: [7, 7, 7, 7] });
  const outcomes = new Set();
  for (let i = 0; i < 40; i++) { const c = m.clone([i * 13 + 1, 5, 6, 7]); c.submit([move(1), move(1)]); outcomes.add(sig(c)); }
  assert.ok(outcomes.size > 3, `서로 다른 결과 ${outcomes.size}가지`);
});

test('재현성: 같은 시드·같은 선택이면 결과가 같다', () => {
  const play = () => { const m = createMatch({ teams: [teamA(), teamB()], seed: [9, 8, 7, 6] }); for (let i = 0; i < 6 && !m.ended; i++) m.submit([0, 1].map(s => m.choices(s)[0] || null)); return [sig(m), m.omniscient().join('\n')]; };
  assert.deepEqual(play(), play());
});

test('선택지: 쓰러지면 교체 요청이 오고, 상대는 대기 상태가 된다', () => {
  const killer = [set('Garchomp', 'Rough Skin', 'Life Orb', ['earthquake'], { evs: { atk: 252, spe: 252 } }), set('Corviknight', 'Pressure', 'Leftovers', ['roost']), set('Gholdengo', 'Good as Gold', 'Leftovers', ['shadowball'])];
  const weak = [set('Pikachu', 'Static', 'Leftovers', ['thunderbolt'], { evs: {} }), set('Blissey', 'Natural Cure', 'Leftovers', ['softboiled']), set('Toxapex', 'Regenerator', 'Leftovers', ['recover'])];
  const m = createMatch({ teams: [killer, weak] });
  m.submit([move(0), move(0)]);
  assert.equal(m.kind(1), 'switch');
  assert.equal(m.kind(0), 'wait');
  assert.deepEqual(m.choices(0), []);
  const opts = m.choices(1);
  assert.ok(opts.length === 2 && opts.every(o => o.type === 'switch'), '교체 선택지만 있다');
  m.submit([null, opts[0]]);
  assert.equal(m.kind(0), 'move');
});

test('선택지: 잘못된 선택은 진행하지 않고 오류를 던진다', () => {
  const m = createMatch({ teams: [teamA(), teamB()] });
  assert.throws(() => m.submit([move(9), move(0)]), /올바르지 않다/);
  assert.equal(m.turn, 1);
  assert.throws(() => m.submit([move(0), move(9)]), /올바르지 않다/);
  assert.equal(m.turn, 1, '한쪽만 올바른 선택이어도 진행하지 않는다');
  m.submit([move(0), move(0)]);
  assert.equal(m.turn, 2, '올바른 선택은 정상 진행');
});

test('선택지 목록: 기술은 index, 교체는 to 로 0부터 센다', () => {
  const m = createMatch({ teams: [teamA(), teamB()] });
  const c = legalChoices(m.request(1));
  assert.deepEqual(c.filter(x => x.type === 'move').map(x => x.index), [0, 1]);
  assert.deepEqual(c.filter(x => x.type === 'switch').map(x => x.to), [1, 2]);
});
