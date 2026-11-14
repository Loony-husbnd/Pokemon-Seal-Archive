#!/usr/bin/env node
/**
 * 변화기 밸런스 시뮬레이션 (실제 AI 끼리 대결, Holo 와 같은 기술 구성 규칙 사용)
 *
 *   node tools/simulate-status.mjs [--n 1500] [--seed 1] [--cap 1500] [--level hard]
 *
 * 1) 대칭성       : 양쪽 모두 변화기를 쓸 때 0번 승률이 50% 부근인지, 무승부·평균 턴 수
 * 2) 변화기 효과  : 변화기 있는 쪽 vs 공격기만 있는 쪽 (같은 파티, 자리 교차) → 변화기가 이득인지
 * 3) 종족값 격차  : 종족값 합계 차이별 승률 (상대 파티 난이도 보정 OFFSET 을 다시 맞출 때 참고)
 * 4) 기술별 통계  : 변화기마다 쓰인 횟수, 그 기술을 가진 쪽의 승률
 */
import { loadBattle } from './lib/load-battle.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const N = Number(opt('n', 1500)), SEED = Number(opt('seed', 1)), CAP = Number(opt('cap', 1500)), LEVEL = opt('level', 'hard');

const { engine: E, data, ai: AI, party: PT } = loadBattle();
const P = PT.create(data);
const rnd = E.mulberry32(SEED);
const pool = Object.keys(data.pokemon).map(Number).filter(id => id <= 1025);

function randomParty() {
  for (;;) {
    const ids = new Set();
    while (ids.size < 3) ids.add(pool[Math.floor(rnd() * pool.length)]);
    const arr = [...ids];
    const bst = arr.reduce((s, id) => s + data.pokemon[id].bst, 0);
    if (bst <= CAP) return { ids: arr, bst };
  }
}
const withSets = party => party.ids.map(id => ({ id, moves: [...P.pickMoveset(id, rnd)] }));
const attackOnly = party => party.ids.map(id => ({ id, moves: [...data.pokemon[id].m] }));

function fight(sideA, sideB, seed, st) {
  const mons = s => s.map(x => E.makeMon(x.id, { moves: x.moves }));
  const bt = E.createBattle({ parties: [mons(sideA), mons(sideB)], seed });
  const brains = [AI.create(E, { seed }), AI.create(E, { seed: seed + 7919 })];
  bt.start();
  let guard = 0;
  while (bt.phase !== 'ended') {
    if (++guard > 1200) throw new Error('배틀이 끝나지 않음');
    if (bt.phase === 'switch') { bt.pending.slice().forEach(si => bt.replace(si, brains[si].chooseReplacement(bt, si, LEVEL))); continue; }
    const ev = bt.playTurn(brains[0].chooseAction(bt, 0, LEVEL), brains[1].chooseAction(bt, 1, LEVEL));
    if (st) for (const e of ev) if (e.t === 'move') {
      st.moves++;
      if (e.cls === 'status') { st.status++; st.byName[e.name] = (st.byName[e.name] || 0) + 1; }
    }
  }
  if (st) st.turns += bt.turn;
  return bt.winner;
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '-') + '%';
const t0 = Date.now();

// 1) 대칭성 + 4) 기술별 통계
const st = { turns: 0, moves: 0, status: 0, byName: {} };
let w0 = 0, w1 = 0, dr = 0;
const rows = [], owner = {};            // owner[기술이름] = { have, win }
for (let i = 0; i < N; i++) {
  const pa = randomParty(), pb = randomParty();
  const a = withSets(pa), b = withSets(pb);
  const w = fight(a, b, i + 1, st);
  if (w === 0) w0++; else if (w === 1) w1++; else dr++;
  rows.push({ diff: pa.bst - pb.bst, w });
  [[a, 0], [b, 1]].forEach(([side, si]) => {
    const names = new Set(side.flatMap(x => x.moves).map(m => data.moves[m]).filter(m => m.c === 'n').map(m => m.k));
    names.forEach(n => { const o = owner[n] || (owner[n] = { have: 0, win: 0 }); if (w !== 'draw') { o.have++; if (w === si) o.win++; } });
  });
}
console.log(`설정: ${N}판, 시드 ${SEED}, AI 난이도 ${LEVEL}, 파티 종족값합 상한 ${CAP}`);
console.log('\n[1] 대칭성 (양쪽 변화기 포함)');
console.log(`  0번 승 ${pct(w0, N)} / 1번 승 ${pct(w1, N)} / 무승부 ${pct(dr, N)}   평균 ${(st.turns / N).toFixed(1)}턴, 전체 행동 중 변화기 ${pct(st.status, st.moves)}`);

// 2) 변화기 효과: 같은 파티·같은 상대·같은 시드로, 내 기술 구성만 바꿔 비교 (짝지은 A/B)
let baseWins = 0, setWins = 0, nPair = 0;
const M = Math.floor(N / 2);
for (let i = 0; i < M; i++) {
  const pa = randomParty(), pb = randomParty();
  const foe = attackOnly(pb), seed = 50000 + i;
  const a1 = fight(attackOnly(pa), foe, seed, null);
  const a2 = fight(withSets(pa), foe, seed, null);
  if (a1 === 'draw' || a2 === 'draw') continue;
  nPair++; if (a1 === 0) baseWins++; if (a2 === 0) setWins++;
}
console.log('\n[2] 변화기 효과 (같은 파티·같은 상대(공격기만)·같은 시드, 내 기술 구성만 바꿈)');
console.log(`  공격기 4개 승률 ${pct(baseWins, nPair)} → 공격기+변화기(Holo 구성) 승률 ${pct(setWins, nPair)}   차이 ${(100 * (setWins - baseWins) / nPair).toFixed(1)}%p`);

// 3) 종족값 격차
console.log('\n[3] 종족값합 차이(0번 − 1번)별 0번 승률 (변화기 포함)');
for (const [lo, hi] of [[-1e9, -200], [-200, -100], [-100, -30], [-30, 30], [30, 100], [100, 200], [200, 1e9]]) {
  const r = rows.filter(x => x.diff >= lo && x.diff < hi && x.w !== 'draw');
  if (r.length) console.log(`  ${String(lo < -1e8 ? '-∞' : lo).padStart(5)} ~ ${String(hi > 1e8 ? '+∞' : hi).padEnd(5)} : ${pct(r.filter(x => x.w === 0).length, r.length).padStart(6)}  (${r.length}판)`);
}

// 4) 기술별
console.log('\n[4] 변화기별 (사용 횟수 / 가진 쪽 승률, 표본 30 이상)');
const list = Object.entries(owner).filter(([, o]) => o.have >= 30)
  .map(([n, o]) => ({ n, use: st.byName[n] || 0, have: o.have, wr: o.win / o.have }))
  .sort((x, y) => y.wr - x.wr);
const line = x => `  ${x.n.padEnd(8)} 사용 ${String(x.use).padStart(5)}  승률 ${(100 * x.wr).toFixed(1)}%  (${x.have}판)`;
console.log('  ▲ 승률 높은 기술');  list.slice(0, 6).forEach(x => console.log(line(x)));
console.log('  ▼ 승률 낮은 기술');  list.slice(-6).forEach(x => console.log(line(x)));
const unused = Object.values(data.moves).filter(m => m.c === 'n' && !(st.byName[m.k] > 0)).map(m => m.k);
console.log(`  한 번도 쓰이지 않은 변화기: ${unused.length ? unused.join(', ') : '없음'}`);
console.log(`\n소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
