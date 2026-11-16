// 화면이 요청(request)에서 읽는 정보로 죽지 않는가: 반동·충전 턴, 기술이 하나뿐인 포켓몬, 추정 셋이 비는 종
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createAI } from '../src/index.js';
import { D, prng, randomTeam } from './helpers.mjs';

const S = (species, ability, item, moves) => ({ species, ability, item, moves, evs: {} });
const mv = i => ({ type: 'move', index: i });

test('반동 턴: 파괴광선 다음 턴의 선택지는 가짜 기술 recharge 하나이고, 기술 정보를 읽을 수 있다', () => {
  const m = createMatch({ teams: [[S('Garchomp', 'Rough Skin', '', ['hyperbeam', 'earthquake']), S('Gengar', 'Cursed Body', '', ['shadowball'])], [S('Blissey', 'Natural Cure', '', ['softboiled'])]] });
  m.submit([mv(0), mv(0)]);
  const info = m.player(0).moves();
  assert.deepEqual(info.moves.map(x => x.id), ['recharge']);
  assert.equal(info.locked, true, '선택지가 고정된 턴');
  assert.equal(info.moves[0].pp, undefined, '요청에 PP 정보가 없다');
  const d = D.moveInfo('recharge');
  assert.ok(d && d.pseudo && d.ko && d.category === 'Status', 'moveInfo(recharge) 가 null 이면 화면이 죽는다');
  m.submit([mv(0), mv(0)]);       // 쉬는 턴도 정상 진행
  assert.equal(m.player(0).moves().locked, false);
});
test('충전 턴: 불새(스카이어택) 다음 턴은 같은 기술 하나로 고정된다', () => {
  const m = createMatch({ teams: [[S('Pidgeot', 'Keen Eye', '', ['skyattack', 'roost'])], [S('Blissey', 'Natural Cure', '', ['softboiled'])]] });
  m.submit([mv(0), mv(0)]);
  const info = m.player(0).moves();
  assert.deepEqual(info.moves.map(x => x.id), ['skyattack']); assert.equal(info.locked, true); assert.equal(info.trapped, true);
});
test('기술이 하나뿐인 포켓몬(딧토)은 고정 상태가 아니다', () => {
  const m = createMatch({ teams: [[S('Ditto', 'Limber', '', ['transform'])], [S('Blissey', 'Natural Cure', '', ['softboiled'])]] });
  const info = m.player(0).moves(); assert.equal(info.moves.length, 1); assert.equal(info.locked, false);
});
test('요청에 나오는 모든 기술 id 는 기술 정보를 가진다 (무작위 대전 100판)', () => {
  const seen = new Set(), missing = new Set();
  for (let g = 0; g < 100; g++) {
    const r = prng(5000 + g), m = createMatch({ teams: [randomTeam(r), randomTeam(r)], seed: [g + 1, 2, 3, 4] });
    for (let t = 0; t < 80 && !m.ended; t++) {
      for (const s of [0, 1]) { const i = m.player(s).moves(); if (i) for (const x of i.moves) { seen.add(x.id); if (!D.moveInfo(x.id)) missing.add(x.id); } }
      m.submitWith(() => [0, 1].map(s => { const c = m.choices(s); return c.length ? c[Math.floor(r() * c.length)] : null; }));
    }
  }
  assert.deepEqual([...missing], [], `기술 정보가 없는 id: ${[...missing]}`);
  assert.ok(seen.has('recharge') || seen.size > 200, `확인한 기술 id ${seen.size}개`);
});
test('추정 셋이 비지 않는다: 딧토·스모그·코스모그·코스모움이 상대 팀에 있어도 AI 가 판단한다', () => {
  for (const level of ['normal', 'hard', 'hell']) {
    const m = createMatch({ teams: [[S('Ditto', 'Limber', '', ['transform']), S('Smeargle', 'Own Tempo', '', ['sketch']), S('Cosmog', 'Unaware', '', ['splash', 'teleport'])], [S('Garchomp', 'Rough Skin', '', ['earthquake', 'outrage'])]] });
    const ai = createAI({ dex: D, seed: 1 });
    const d = ai.choose(m.player(1), level, { budgetMs: 0, minRounds: 2 });       // 1번(AI)이 0번 팀(딧토 등)을 추정한다
    assert.ok(d.choice, `${level}: 선택 없음`);
    m.submitWith(() => [m.choices(0)[0], d.choice]);
  }
  const m2 = createMatch({ teams: [[S('Cosmoem', 'Sturdy', '', ['harden'])], [S('Garchomp', 'Rough Skin', '', ['earthquake'])]] });
  assert.ok(createAI({ dex: D, seed: 2 }).choose(m2.player(1), 'hard').choice);
});
