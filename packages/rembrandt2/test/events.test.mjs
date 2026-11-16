// 변환기: 무작위 합법 팀 대전을 많이 돌려 한국어 문구·체력 일관성·미변환 비율을 확인한다
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createTranslator, josa, missingNames } from '../src/index.js';
import { D, prng, randomTeam, playRandom } from './helpers.mjs';

const BATTLES = 120;
function runMany(n, seed0) {
  const total = { lines: 0, shown: 0, generic: 0 }, unmapped = new Map(), bad = [], englishTexts = new Map(); let hpMismatch = 0, checked = 0, switchBad = 0, ended = 0, megas = 0;
  for (let g = 0; g < n; g++) {
    const r = prng(seed0 + g);
    const teams = [randomTeam(r), randomTeam(r)];
    assert.ok(D.validateTeam(teams[0]).ok && D.validateTeam(teams[1]).ok, '무작위 팀은 합법이어야 한다');
    const m = createMatch({ teams, seed: [g + 1, 2, 3, 4] });
    const T = [createTranslator(m, 0), createTranslator(m, 1)];
    const evs = [[], []];
    const flush = () => { for (const s of [0, 1]) evs[s].push(...T[s].pull()); };
    flush();
    try { playRandom(m, r, { afterTurn: flush }); } catch (e) { bad.push(`${g}: ${e.message}`); continue; }
    flush();
    if (m.ended) ended++;
    for (const s of [0, 1]) {
      for (const e of evs[s]) {
        if (e.t === 'mega') megas++;
        if (e.text && /[A-Za-z]{3,}/.test(e.text.replace(/\b[XYZ]\b/g, ''))) englishTexts.set(e.text, (englishTexts.get(e.text) || 0) + 1);
        if (e.t === 'switch' && !(e.to >= 0 && e.to < 3)) switchBad++;
      }
      // 내 포켓몬 체력: 이벤트로 따라간 마지막 값이 실제와 같다 (내 시점에서 내 쪽은 정확한 값)
      const last = new Map();
      for (const e of evs[s]) if (e.side === s && 'hp' in e && e.t !== 'faint') last.set(e.species ?? e.t, e.hp);
      const mine = m.battle.sides[s].pokemon;
      const tracked = T[s].hp[s];
      for (const p of mine) { const t = tracked[`${p.name}#${p.maxhp}`]; if (t) { checked++; if (t.hp !== p.hp) hpMismatch++; } }
      for (const [k, v] of T[s].unmapped) unmapped.set(k, (unmapped.get(k) || 0) + v);
      total.lines += T[s].stats.lines; total.shown += T[s].stats.shown; total.generic += T[s].stats.generic;
    }
  }
  return { total, unmapped, bad, englishTexts, hpMismatch, checked, switchBad, ended, megas };
}

const R = runMany(BATTLES, 1000);

test(`변환기: 합법 무작위 팀 ${BATTLES}판이 오류 없이 끝까지 간다`, () => {
  assert.deepEqual(R.bad, []);
  assert.ok(R.ended >= BATTLES * 0.9, `끝난 판 ${R.ended}/${BATTLES}`);
  assert.ok(R.megas > 20, `메가진화 이벤트 ${R.megas}번`);
});
test('변환기: 내 포켓몬의 체력을 이벤트로 따라가면 실제 체력과 같다', () => {
  assert.ok(R.checked > 500);
  assert.equal(R.hpMismatch, 0, `불일치 ${R.hpMismatch}/${R.checked}`);
});
test('변환기: 교체 이벤트의 파티 번호(to)는 항상 0~2', () => { assert.equal(R.switchBad, 0); });
test('변환기: 변환하지 못한 줄 종류와 일반 문구로 처리한 비율을 점검한다', () => {
  const ratio = R.total.generic / Math.max(1, R.total.shown);
  console.log(`  줄 ${R.total.lines} · 화면 문구 ${R.total.shown} · 일반 문구 ${R.total.generic} (${(100 * ratio).toFixed(2)}%) · 미변환 종류 ${[...R.unmapped].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  assert.ok(ratio < 0.05, `일반 문구 비율 ${(100 * ratio).toFixed(1)}%`);
});
test('변환기: 화면 문구에 영문이 새어 나오지 않는다 (이름표 누락 점검)', () => {
  const top = [...R.englishTexts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('  영문 섞인 문구:', top.length ? top.map(([t, n]) => `${t} ×${n}`).join(' | ') : '없음', '| 이름표 누락:', JSON.stringify(missingNames()).slice(0, 300));
  assert.ok([...R.englishTexts.values()].reduce((a, b) => a + b, 0) <= R.total.shown * 0.01, '영문 문구가 1% 를 넘는다');
});
test('조사: 받침에 따라 은/는 이/가 을/를 으로/로', () => {
  assert.equal(josa('리자몽', '은/는'), '리자몽은'); assert.equal(josa('피카츄', '이/가'), '피카츄가'); assert.equal(josa('한카리아스', '을/를'), '한카리아스를');
  assert.equal(josa('불꽃', '으로/로'), '불꽃으로'); assert.equal(josa('얼음', '으로/로'), '얼음으로'); assert.equal(josa('물', '으로/로'), '물로'); assert.equal(josa('리자몽', '의'), '리자몽의');
});
