// 도감·팀 데이터: 9세대 기준 로스터, 습득 기술, 메가스톤, 팀 검증, 한국어 이름표
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDex, koName, lookupName } from '../src/index.js';

const D = createDex();
const R = D.roster();

test('로스터: 9세대(SV)에 나오는 종만, 메가·전투 전용 폼·CAP 은 따로 없다', () => {
  assert.ok(R.length > 800 && R.length < 950, `로스터 ${R.length}종`);
  assert.ok(D.get('garchomp') && D.get('charizard'));
  assert.equal(D.get('caterpie'), null, '9세대에 없는 종은 제외');
  assert.ok(!R.some(r => /Mega|Gmax|Primal/.test(r.forme)), '메가는 메가스톤 도구로 표현');
  assert.ok(R.some(r => r.id === 'raichualola'), '지방 폼은 포함');
  assert.ok(createDex({ roster: 'all' }).roster().length > R.length, "'all' 은 더 넓다");
});
test('습득 기술: 9세대 기준 — 옛 세대 전용 기술은 못 배운다, 진화 전 알 기술은 배운다', () => {
  assert.ok(D.learnable('garchomp').has('earthquake'));
  assert.ok(!D.learnable('garchomp').has('megapunch'));
  assert.ok(D.learnable('pikachu').has('fakeout'), '알 기술(진화 전 단계 기록)');
  assert.deepEqual([...D.learnable('charizardmegax')].sort(), [...D.learnable('charizard')].sort(), '메가는 원래 종 기준');
});
test('습득 기술: 고를 수 있는 종은 모두 기술이 있고(변칙 종 제외), 폼은 원래 종의 기술을 이어받는다', () => {
  const tiny = R.filter(r => D.learnable(r.id).size < 4).map(r => r.id);
  assert.deepEqual(tiny.sort(), ['cosmog', 'cosmoem', 'ditto', 'magikarp', 'smeargle'].sort(), `기술이 4개 미만인 종: ${tiny}`);
  assert.ok(D.learnable('rotomwash').has('hydropump') && D.learnable('rotomwash').has('thunderbolt'), '로토무 폼');
  assert.ok(D.learnable('ogerponwellspring').size > 20 || !D.get('ogerponwellspring'), '오거폰');
  assert.ok(!D.learnable('raichualola').has('thunderpunch') || D.learnable('pikachu').has('thunderpunch'), '지방 폼은 자기 목록');
});
test('메가스톤: 그 종만 쓸 수 있다', () => {
  assert.deepEqual(D.megaStonesOf('charizard').map(s => s.item).sort(), ['charizarditex', 'charizarditey']);
  assert.equal(D.megaStonesOf('garchomp').length > 0, true);
  const base = { moves: ['flamethrower'], ability: 'Blaze' };
  const team = item => [D.makeSet({ species: 'Charizard', item, ...base }), D.makeSet({ species: 'Gengar', moves: ['shadowball'], ability: 'Cursed Body' }), D.makeSet({ species: 'Metagross', moves: ['meteormash'], ability: 'Clear Body' })];
  assert.ok(D.validateTeam(team('Charizardite X')).ok);
  assert.match(D.validateTeam(team('Gengarite')).errors.join(), /메가스톤/);
});
test('팀 검증: 3마리·종 중복 없음·배울 수 있는 기술·특성·노력치', () => {
  const ok = [D.makeSet({ species: 'Garchomp', moves: ['earthquake', 'outrage'], ability: 'Rough Skin', evs: { atk: 252, spe: 252, hp: 4 } }), D.makeSet({ species: 'Gengar', moves: ['shadowball'], ability: 'Cursed Body' }), D.makeSet({ species: 'Corviknight', moves: ['bravebird'], ability: 'Pressure' })];
  assert.ok(D.validateTeam(ok).ok);
  const e = fn => D.validateTeam(fn(structuredClone(ok))).errors.join('|');
  assert.match(e(t => t.slice(0, 2)), /3마리/);
  assert.match(e(t => { t[1] = D.makeSet({ species: 'Garchomp', moves: ['earthquake'], ability: 'Sand Veil' }); return t; }), /한 마리만/);
  assert.match(e(t => { t[0].moves = ['megapunch']; return t; }), /배울 수 없습니다/);
  assert.match(e(t => { t[0].ability = 'Levitate'; return t; }), /특성/);
  assert.match(e(t => { t[0].evs = { atk: 252, spe: 252, hp: 252 }; return t; }), /노력치/);
  assert.match(e(t => { t[0].moves = []; return t; }), /기술은 1~4개/);
});
test('한국어 이름표: 로스터·습득 기술·특성은 거의 다 한국어로 나온다', () => {
  const noKo = (list, kind) => list.filter(x => !lookupName(kind, x));
  assert.equal(noKo(R.map(r => r.id), 'species').length, 0, '로스터 종');
  const moves = new Set(); for (const r of R) for (const m of D.learnable(r.id)) moves.add(m);
  const lacking = noKo([...moves], 'move'); assert.ok(lacking.length / moves.size < 0.005, `기술 이름 누락 ${lacking.length}/${moves.size}: ${lacking.slice(0, 5)}`);
  const abil = new Set(R.flatMap(r => r.abilities)); const la = [...abil].filter(a => !lookupName('ability', a)); assert.ok(la.length / abil.size < 0.02, `특성 이름 누락 ${la}`);
  assert.equal(koName('species', 'charizardmegax'), '메가리자몽X'); assert.equal(koName('species', 'raichualola'), '알로라 라이츄'); assert.equal(koName('item', 'Charizardite X'), '리자몽나이트X');
});
test('기술 정보: 한국어 이름·타입·분류·위력', () => {
  const m = D.moveInfo('flamethrower');
  assert.equal(m.ko, '화염방사'); assert.equal(m.typeKo, '불꽃'); assert.equal(m.category, 'Special'); assert.equal(m.power ?? m.power, 90);
});
