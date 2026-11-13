#!/usr/bin/env node
/**
 * battle/data/battle-data.js 무결성 검증
 *   node tools/validate-battle-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'battle', 'data', 'battle-data.js');
const sandbox = {};
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox); // 브라우저와 같은 방식(전역 BATTLE_DATA)으로 로드
const d = sandbox.BATTLE_DATA;

const errors = [];
const err = m => errors.push(m);
const isInt = v => Number.isInteger(v);

if (!d || !d.pokemon || !d.moves) { console.error('BATTLE_DATA 로드 실패'); process.exit(1); }
if (d.types.length !== 18 || d.chart.length !== 18 || d.chart.some(r => r.length !== 18)) err('타입/상성표 크기 오류');

for (const [id, m] of Object.entries(d.moves)) {
  if (!m.k || !m.e) err(`기술 ${id}: 이름 없음`);
  if (!(m.t >= 1 && m.t <= 18)) err(`기술 ${id}: 타입 오류`);
  if (!['p', 's'].includes(m.c)) err(`기술 ${id}: 분류 오류`);
  if (!(m.pw > 0) || !(m.pp > 1)) err(`기술 ${id}: 위력/PP 오류`);
  if (m.ac !== null && !(m.ac > 0 && m.ac <= 100)) err(`기술 ${id}: 명중 오류`);
  if (!m.fx || typeof m.fx !== 'object') err(`기술 ${id}: fx 없음`);
}

let noMove = 0, totalMoves = 0;
const dist = {};
for (const [id, p] of Object.entries(d.pokemon)) {
  if (!p.k) err(`#${id}: 이름 없음`);
  if (!p.t.length || p.t.length > 2 || p.t.some(t => !(t >= 1 && t <= 18))) err(`#${id}: 타입 오류`);
  if (p.b.length !== 6 || p.s.length !== 6 || p.b.some(v => !isInt(v) || v <= 0) || p.s.some(v => !isInt(v) || v <= 0)) err(`#${id}: 능력치 오류`);
  if (p.bst !== p.b.reduce((a, x) => a + x, 0)) err(`#${id}: 종족값합 불일치`);
  p.b.forEach((v, i) => {
    const expect = i === 0 ? (p.sp === 292 ? 1 : 2 * v + 141) : 2 * v + 36;
    if (p.s[i] !== expect) err(`#${id}: Lv100 능력치 계산 불일치 (idx ${i})`);
  });
  if (!p.m.length) { noMove++; err(`#${id}: 기술 없음`); }
  if (p.m.length > 4 || new Set(p.m).size !== p.m.length) err(`#${id}: 기술 중복/초과`);
  for (const mid of p.m) if (!d.moves[mid]) err(`#${id}: 존재하지 않는 기술 ${mid}`);
  totalMoves += p.m.length;
  dist[p.m.length] = (dist[p.m.length] || 0) + 1;
}

const n = Object.keys(d.pokemon).length;
console.log(`포켓몬 ${n}종/폼, 기술 ${Object.keys(d.moves).length}개, 평균 보유 기술 ${(totalMoves / n).toFixed(2)}개`);
console.log('보유 기술 수 분포:', JSON.stringify(dist));
const missing = Array.from({ length: 1025 }, (_, i) => i + 1).filter(i => !d.pokemon[i]);
if (missing.length) err(`1~1025 중 누락: ${missing.join(',')}`);
if (errors.length) {
  console.error(`검증 실패 ${errors.length}건`);
  errors.slice(0, 30).forEach(e => console.error(' - ' + e));
  process.exit(1);
}
console.log('검증 통과');
