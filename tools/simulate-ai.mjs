#!/usr/bin/env node
/**
 * AI 난이도 매트릭스: 같은 파티로 자리를 바꿔 싸워 난이도별 승률을 비교한다.
 *   node tools/simulate-ai.mjs [--n 300] [--seed 1]
 */
import { loadBattle } from './lib/load-battle.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
const N = opt('n', 300), SEED = opt('seed', 1);
const { engine: E, data, ai: AI } = loadBattle();
const rnd = E.mulberry32(SEED);
const ids = Object.keys(data.pokemon).map(Number).filter(i => i <= 1025 && !data.pokemon[i].leg);
const levels = ['easy', 'normal', 'hard'];

function fight(a, b, lvA, lvB, seed) {
  const bt = E.createBattle({ parties: [a.map(i => E.makeMon(i)), b.map(i => E.makeMon(i))], seed });
  bt.start();
  const brain = AI.create(E, { seed });
  const lv = [lvA, lvB];
  let guard = 0;
  while (bt.phase !== 'ended') {
    if (++guard > 800) throw new Error('끝나지 않음');
    if (bt.phase === 'switch') { bt.pending.slice().forEach(s => bt.replace(s, brain.chooseReplacement(bt, s, lv[s]))); continue; }
    bt.playTurn(brain.chooseAction(bt, 0, lv[0]), brain.chooseAction(bt, 1, lv[1]));
  }
  return bt.winner;
}

const t0 = Date.now();
const pairs = [];
for (let i = 0; i < N; i++) {
  const mk = () => [0, 0, 0].map(() => ids[Math.floor(rnd() * ids.length)]);
  const a = mk(), b = mk();
  if (new Set(a).size === 3 && new Set(b).size === 3) pairs.push([a, b]);
}

console.log(`AI 난이도 매트릭스 (파티 ${pairs.length}쌍 × 자리 교차, 행 = 이긴 쪽 승률)`);
console.log('            ' + levels.map(l => l.padStart(8)).join(''));
for (const lvA of levels) {
  const row = [];
  for (const lvB of levels) {
    let w = 0, total = 0, seed = 1;
    for (const [a, b] of pairs) {
      for (const sideA of [0, 1]) {
        const winner = sideA === 0 ? fight(a, b, lvA, lvB, seed++) : fight(b, a, lvB, lvA, seed++);
        if (winner === 'draw') continue;
        total++;
        if (winner === sideA) w++;
      }
    }
    row.push((100 * w / total).toFixed(1).padStart(7) + '%');
  }
  console.log(lvA.padEnd(12) + row.join(''));
}
console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
