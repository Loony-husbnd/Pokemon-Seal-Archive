#!/usr/bin/env node
/**
 * 배틀 엔진 대량 시뮬레이션 (엔진 검증 + 밸런스 참고용)
 *
 *   node tools/simulate-battles.mjs [--n 3000] [--seed 1] [--cap 1500] [--no-legend]
 *
 * 1) 대칭성   : 같은 전략끼리 싸울 때 0번 쪽 승률이 50% 부근인지 (엔진 편향 검사)
 * 2) 전략 차이: '기대 데미지 최대' 전략 vs '무작위 기술' 전략 (엔진이 합리적 플레이에 보상하는지)
 * 3) 밸런스   : 파티 종족값 총합 차이별 승률, 전설/환상 포함 여부별 승률
 * 4) 통계     : 평균 턴 수, 급소/빗나감/상태이상 발생 빈도, 속도
 */
import { loadBattle } from './lib/load-battle.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
const N = opt('n', 3000), SEED = opt('seed', 1), CAP = opt('cap', 1500), NO_LEGEND = args.includes('--no-legend');

const { engine: E, data } = loadBattle();
const rnd = E.mulberry32(SEED);
const species = Object.keys(data.pokemon).map(Number).filter(id => id <= 1025 && !(NO_LEGEND && data.pokemon[id].leg));

// ───────── 파티 생성: 종족값 총합 상한(CAP) 이하인 서로 다른 3마리 ─────────
function randomParty() {
  for (let tries = 0; tries < 5000; tries++) {
    const ids = new Set();
    while (ids.size < 3) ids.add(species[Math.floor(rnd() * species.length)]);
    const arr = [...ids];
    const bst = arr.reduce((s, id) => s + data.pokemon[id].bst, 0);
    if (bst <= CAP) return { ids: arr, bst, legend: arr.some(id => data.pokemon[id].leg) };
  }
  throw new Error('조건에 맞는 파티를 만들지 못했습니다. --cap 을 늘려 보세요.');
}

// ───────── 전략 ─────────
const best = (bt, si) => {                       // 기대 데미지가 가장 큰 기술
  const me = bt.active(si), foe = bt.active(1 - si), la = bt.legalActions(si);
  if (la.mustStruggle) return { type: 'move', index: 0 };
  let pick = -1, score = -1;
  for (const m of la.moves) {
    if (!m.usable) continue;
    const e = E.estimateDamage(me, foe, me.moves[m.index]).expected;
    if (e > score) { score = e; pick = m.index; }
  }
  return { type: 'move', index: pick };
};
const random = (bt, si) => {
  const la = bt.legalActions(si);
  if (la.mustStruggle) return { type: 'move', index: 0 };
  const u = la.moves.filter(m => m.usable);
  return { type: 'move', index: u[Math.floor(rnd() * u.length)].index };
};
const pickReplacement = (bt, si) => {            // 상대에게 가장 큰 기대 데미지를 줄 수 있는 후보
  const foe = bt.active(1 - si);
  let bestIdx = -1, bestScore = -1;
  bt.sides[si].party.forEach((m, i) => {
    if (m.fainted) return;
    const s = Math.max(...m.moves.map(mv => E.estimateDamage(m, foe, mv).expected));
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  });
  return bestIdx;
};

function fight(partyA, partyB, policyA, policyB, seed, stats) {
  const bt = E.createBattle({
    parties: [partyA.ids.map(id => E.makeMon(id)), partyB.ids.map(id => E.makeMon(id))],
    seed,
  });
  bt.start();
  let guard = 0;
  while (bt.phase !== 'ended') {
    if (++guard > 1000) throw new Error('배틀이 끝나지 않음');
    if (bt.phase === 'switch') { bt.pending.slice().forEach(s => bt.replace(s, pickReplacement(bt, s))); continue; }
    const ev = bt.playTurn(policyA(bt, 0), policyB(bt, 1));
    if (stats) for (const e of ev) {
      if (e.t === 'crit') stats.crit++;
      else if (e.t === 'miss') stats.miss++;
      else if (e.t === 'status' && ['par', 'brn', 'psn', 'tox', 'slp', 'frz', 'cnf'].includes(e.kind)) stats.status++;
      else if (e.t === 'move') stats.moves++;
      else if (e.t === 'effective') stats[e.eff === 0 ? 'immune' : e.eff > 1 ? 'se' : 'nve']++;
    }
  }
  if (stats) stats.turns += bt.turn;
  return bt.winner;
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '-') + '%';
const t0 = Date.now();

// 1) 대칭성: 같은 전략 vs 같은 전략
let wins0 = 0, wins1 = 0, draws = 0;
const stats = { turns: 0, crit: 0, miss: 0, status: 0, moves: 0, se: 0, nve: 0, immune: 0 };
const rows = [];
for (let i = 0; i < N; i++) {
  const a = randomParty(), b = randomParty();
  const w = fight(a, b, best, best, i + 1, stats);
  if (w === 0) wins0++; else if (w === 1) wins1++; else draws++;
  rows.push({ diff: a.bst - b.bst, aLegend: a.legend, bLegend: b.legend, w });
}
console.log(`설정: 시뮬레이션 ${N}판, 시드 ${SEED}, 파티 종족값합 상한 ${CAP}${NO_LEGEND ? ', 전설/환상 제외' : ''}`);
console.log('\n[1] 대칭성 (기대 데미지 전략 vs 같은 전략, 서로 다른 무작위 파티)');
console.log(`  0번 승 ${pct(wins0, N)} / 1번 승 ${pct(wins1, N)} / 무승부 ${pct(draws, N)}   (0번 승률이 50% ±3%p 안이면 정상)`);

// 2) 전략 차이: 같은 파티로 자리 바꿔 2번씩
let bestWins = 0, randWins = 0, d2 = 0;
const M = Math.floor(N / 2);
for (let i = 0; i < M; i++) {
  const a = randomParty(), b = randomParty();
  const w1 = fight(a, b, best, random, 10000 + i, null);
  const w2 = fight(b, a, random, best, 20000 + i, null);
  [[w1, 0], [w2, 1]].forEach(([w, bestSide]) => { if (w === 'draw') d2++; else if (w === bestSide) bestWins++; else randWins++; });
}
console.log('\n[2] 전략 차이 (기대 데미지 전략 vs 무작위 기술, 자리 교차)');
console.log(`  기대 데미지 전략 승 ${pct(bestWins, 2 * M)} / 무작위 승 ${pct(randWins, 2 * M)} / 무승부 ${pct(d2, 2 * M)}`);

// 3) 밸런스: 종족값 총합 차이별
console.log('\n[3] 밸런스 (종족값합 차이 = 0번 파티 − 1번 파티, 0번 승률)');
const bins = [[-1e9, -200], [-200, -100], [-100, -30], [-30, 30], [30, 100], [100, 200], [200, 1e9]];
for (const [lo, hi] of bins) {
  const r = rows.filter(x => x.diff >= lo && x.diff < hi && x.w !== 'draw');
  if (r.length) console.log(`  ${String(lo < -1e8 ? '-∞' : lo).padStart(5)} ~ ${String(hi > 1e8 ? '+∞' : hi).padEnd(5)} : 0번 승률 ${pct(r.filter(x => x.w === 0).length, r.length).padStart(6)}  (n=${r.length})`);
}
const onlyA = rows.filter(x => x.aLegend && !x.bLegend && x.w !== 'draw'), onlyB = rows.filter(x => !x.aLegend && x.bLegend && x.w !== 'draw');
if (onlyA.length + onlyB.length) {
  const legendWins = onlyA.filter(x => x.w === 0).length + onlyB.filter(x => x.w === 1).length;
  console.log(`  전설/환상 보유 파티 vs 미보유 파티: 보유 쪽 승률 ${pct(legendWins, onlyA.length + onlyB.length)} (n=${onlyA.length + onlyB.length})`);
}

// 4) 통계
console.log('\n[4] 진행 통계 (대칭성 실험 기준)');
console.log(`  평균 ${(stats.turns / N).toFixed(1)}턴 / 급소율 ${pct(stats.crit, stats.moves)} / 빗나감 ${pct(stats.miss, stats.moves)} / 상태이상 ${(stats.status / N).toFixed(2)}회/판`);
console.log(`  상성 메시지(비중립 타격 중): 굉장함 ${pct(stats.se, stats.se + stats.nve + stats.immune)} / 별로 ${pct(stats.nve, stats.se + stats.nve + stats.immune)} / 무효 ${pct(stats.immune, stats.se + stats.nve + stats.immune)}`);
const secs = (Date.now() - t0) / 1000;
console.log(`  소요 ${secs.toFixed(1)}초 (${((N + 2 * M) / secs).toFixed(0)}판/초)`);
