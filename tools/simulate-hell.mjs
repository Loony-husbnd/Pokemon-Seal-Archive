#!/usr/bin/env node
/**
 * '지옥' 난이도 검증: 플레이어 쪽을 최선을 다하는 AI(어려움)로 두고, 지옥 상대를 이길 수 있는지 측정한다.
 *   node tools/simulate-hell.mjs [--n 300] [--seed 1] [--team best|random|mixed] [--mult 1.5]
 * 플레이어 팀은 best = 종족값이 가장 높은 서로 다른 3종, random = 무작위 3종.
 */
import { loadBattle } from './lib/load-battle.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 300)), SEED = Number(opt('seed', 1)), TEAM = opt('team', 'mixed'), MULT = Number(opt('mult', 1.5));
const { engine: E, data, ai: AI, party: PT } = loadBattle();
const P = PT.create(data);
const rnd = E.mulberry32(SEED);
const pool = Object.keys(data.pokemon).map(Number).filter(id => id <= 1025);
const bestSpecies = (() => { const m = new Map(); for (const id of pool) { const p = data.pokemon[id]; if (!m.has(p.sp) || data.pokemon[m.get(p.sp)].bst < p.bst) m.set(p.sp, id); } return [...m.values()].sort((a, b) => data.pokemon[b].bst - data.pokemon[a].bst); })();
const bestTeam = () => { const ids = [], seen = new Set(); for (const id of bestSpecies) { if (seen.has(data.pokemon[id].t[0]) && ids.length < 3 && seen.size < 2) continue; ids.push(id); seen.add(data.pokemon[id].t[0]); if (ids.length === 3) break; } return ids; };
const randTeam = () => { const s = new Set(); while (s.size < 3) s.add(pool[Math.floor(rnd() * pool.length)]); return [...s]; };
const sets = ids => ids.map(id => ({ id, moves: P.pickMoveset(id, rnd) }));
const mon = x => E.makeMon(x.id, { moves: x.moves });

let wins = 0, losses = 0, draws = 0, turns = 0;
for (let g = 0; g < N; g++) {
  const mine = TEAM === 'best' || (TEAM === 'mixed' && g % 2 === 0) ? bestTeam() : randTeam();
  const opp = P.generateOpponent({ playerIds: mine, level: 'hell', rng: rnd });
  const a = sets(mine), b = opp.map(id => ({ id, moves: [...data.pokemon[id].m] }));
  const bt = E.createBattle({ parties: [a.map(mon), b.map(mon)], seed: SEED * 1000 + g, statMult: [1, MULT], maxTurns: 200 });
  const player = AI.create(E, { seed: g }), boss = AI.create(E, { seed: g + 99 });
  bt.start();
  let guard = 0;
  while (bt.phase !== 'ended' && ++guard < 600) {
    if (bt.phase === 'switch') { for (const si of bt.pending.slice()) if (bt.phase === 'switch' && bt.pending.includes(si)) bt.replace(si, (si === 0 ? player : boss).chooseReplacement(bt, si, si === 0 ? 'hard' : 'hell')); continue; }
    const pa = player.chooseAction(bt, 0, 'hard');
    delete pa.reason;
    const ba = boss.chooseAction(bt, 1, 'hell', pa);
    bt.playTurn(pa, ba);
  }
  turns += bt.turn;
  if (bt.winner === 0) wins++; else if (bt.winner === 1) losses++; else draws++;
}
console.log(`지옥 난이도 ${N}판 (플레이어 팀: ${TEAM}, 상대 능력치 ×${MULT}): 플레이어 ${wins}승 ${losses}패 ${draws}무 → 승률 ${(wins / N * 100).toFixed(1)}% · 평균 ${(turns / N).toFixed(1)}턴`);
