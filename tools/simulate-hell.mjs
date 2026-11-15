#!/usr/bin/env node
/**
 * '지옥' 난이도 측정. 플레이어 쪽은 어려움 AI, 상대는 지옥(팀 빌더로 내 팀을 겨냥해 짠 조합 + 행동 읽기·탐색 AI).
 *   node tools/simulate-hell.mjs [--n 30] [--seed 1] [--team random|strong|all|eter] [--player hard|savvy]
 * 능력치 배율 같은 반칙이 없으므로, 승률을 일부러 맞추지 않고 '가장 잘 이기는지'만 본다.
 */
import { loadBattle } from './lib/load-battle.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PLV = opt('player', 'savvy');      // 플레이어 방식: hard(최대 피해) | savvy(예측해서 받아내는 사람)
const N = Number(opt('n', 30)), SEED = Number(opt('seed', 1)), TEAM = opt('team', 'random');
const { engine: E, data, ai: AI, party: PT, boss: BB, learn } = loadBattle();
const P = PT.create(data), B = BB.create({ E, AI, PT, data, learn });
const rnd = E.mulberry32(SEED);
const pool = TEAM === 'all' ? Object.keys(data.pokemon).map(Number) : Object.keys(data.pokemon).map(Number).filter(id => id <= 1025);   // all: 모든 폼
const strong = [...pool].sort((a, b) => data.pokemon[b].bst - data.pokemon[a].bst).slice(0, 220);
const eterId = Number(Object.keys(data.pokemon).find(i => data.pokemon[i].e === 'eternatus-eternamax'));
const src = TEAM === 'strong' ? strong : pool;
let sims = 0, wins = 0, losses = 0, draws = 0, turns = 0, buildMs = 0;
const seen = new Map();
for (let g = 0; g < N; g++) {
  const s = new Set();
  if (TEAM === 'eter') s.add(eterId);      // 무한다이맥스 1마리 + 무작위 2마리
  while (s.size < 3) { const id = src[Math.floor(rnd() * src.length)]; if (![...s].some(x => data.pokemon[x].sp === data.pokemon[id].sp)) s.add(id); }
  const mine = [...s].map(id => ({ id, moves: P.pickMoveset(id, rnd) }));
  const t0 = Date.now();
  const st = {};
  const boss = await B.build(mine, { rng: rnd, budgetMs: 6000, stats: st });
  buildMs += Date.now() - t0; sims += st.sims || 0;
  const lead = g % 3; mine.push(...mine.splice(0, lead));      // 선봉도 바꿔 가며
  boss.forEach(t => seen.set(t.id, (seen.get(t.id) || 0) + 1));
  const bt = E.createBattle({ parties: [mine.map(t => E.makeMon(t.id, { moves: t.moves })), boss.map(t => E.makeMon(t.id, { moves: t.moves }))], seed: SEED * 1000 + g, maxTurns: 200 });
  const player = AI.create(E, { seed: g }), ai = AI.create(E, { seed: g + 99 });
  bt.start();
  let guard = 0;
  while (bt.phase !== 'ended' && ++guard < 600) {
    if (bt.phase === 'switch') { for (const si of bt.pending.slice()) if (bt.phase === 'switch' && bt.pending.includes(si)) bt.replace(si, (si === 0 ? player : ai).chooseReplacement(bt, si, si === 0 ? PLV : 'hell')); continue; }
    const pa = player.chooseAction(bt, 0, PLV); delete pa.reason;
    bt.playTurn(pa, ai.chooseAction(bt, 1, 'hell', pa));
  }
  turns += bt.turn;
  if (bt.winner === 0) wins++; else if (bt.winner === 1) losses++; else draws++;
}
console.log(`지옥 ${N}판 (플레이어 팀: ${TEAM}, 방식: ${PLV}): 플레이어 ${wins}승 ${losses}패 ${draws}무 → 승률 ${(wins / N * 100).toFixed(1)}% · 평균 ${(turns / N).toFixed(1)}턴 · 팀 구성 평균 ${(buildMs / N / 1000).toFixed(1)}초 · 등장 포켓몬 ${seen.size}종 · 빌더 모의 대전 평균 ${(sims / N).toFixed(0)}판`);
