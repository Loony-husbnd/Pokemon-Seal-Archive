#!/usr/bin/env node
/**
 * 지옥 상대를 '강한 가상 플레이어(결투가)'로 평가한다. 결투가는 지옥 AI 가 자기 행동을 읽는다는 것을 알고, 상대의 모든 대응을 굴려 보며 최악을 피한다.
 * 규칙 기반 플레이어로는 0% 라서 구분이 안 되던 빌더·AI 개선을 측정하기 위한 도구다 (느리다: 한 판에 수 초).
 *   node tools/evaluate-hell.mjs [--n 12] [--seed 1] [--team random|strong|eter] [--old-boss <다른 boss.js 경로>]
 * --old-boss 를 주면 같은 플레이어 팀·선봉으로 두 빌더를 번갈아 비교한다 (A=현재, B=old-boss).
 */
import { loadBattle } from './lib/load-battle.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 12)), SEED = Number(opt('seed', 1)), TEAM = opt('team', 'strong'), OLD = opt('old-boss', null);
const A = loadBattle();
const Bz = OLD ? loadBattle({ bossFile: OLD }) : null;
const { engine: E, data, ai: AI, party: PT } = A;
const P = PT.create(data);
const builders = [['A', A.boss.create({ E, AI, PT, data, learn: A.learn })]];
if (Bz) builders.push(['B', Bz.boss.create({ E: Bz.engine, AI: Bz.ai, PT: Bz.party, data: Bz.data, learn: Bz.learn })]);
const rnd = E.mulberry32(SEED);
const all = Object.keys(data.pokemon).map(Number);
const eterId = all.find(i => data.pokemon[i].e === 'eternatus-eternamax');
const strong = [...all].sort((a, b) => data.pokemon[b].bst - data.pokemon[a].bst).slice(0, 120);
const src = TEAM === 'random' ? all : strong;
const stat = Object.fromEntries(builders.map(([k]) => [k, { wins: 0, losses: 0, draws: 0, turns: 0, ms: 0 }]));

for (let g = 0; g < N; g++) {
  const s = new Set();
  if (TEAM === 'eter') s.add(eterId);
  while (s.size < 3) { const id = src[Math.floor(rnd() * src.length)]; if (![...s].some(x => data.pokemon[x].sp === data.pokemon[id].sp)) s.add(id); }
  const mine = [...s].map(id => ({ id, moves: P.pickMoveset(id, rnd) }));
  const bossSeed = Math.floor(rnd() * 2 ** 31);
  for (const [k, B] of builders) {
    const t0 = Date.now();
    const boss = await B.build(mine, { rng: E.mulberry32(bossSeed), budgetMs: 6000 });
    stat[k].ms += Date.now() - t0;
    const lead = g % 3, ord = mine.map((_, i) => mine[(i + lead) % 3]);
    const bt = E.createBattle({ parties: [ord.map(t => E.makeMon(t.id, { moves: t.moves })), boss.map(t => E.makeMon(t.id, { moves: t.moves }))], seed: SEED * 1000 + g, maxTurns: 100 });
    const player = AI.create(E, { seed: g }), ai = AI.create(E, { seed: g + 99 });
    bt.start();
    let guard = 0;
    while (bt.phase !== 'ended' && ++guard < 400) {
      if (bt.phase === 'switch') { for (const si of bt.pending.slice()) if (bt.phase === 'switch' && bt.pending.includes(si)) bt.replace(si, (si === 0 ? player : ai).chooseReplacement(bt, si, si === 0 ? 'duelist' : 'hell')); continue; }
      const pa = player.chooseAction(bt, 0, 'duelist'); delete pa.reason;
      bt.playTurn(pa, ai.chooseAction(bt, 1, 'hell', pa));
    }
    stat[k].turns += bt.turn;
    if (bt.winner === 1) stat[k].wins++; else if (bt.winner === 0) stat[k].losses++; else stat[k].draws++;
  }
  process.stderr.write(`\r${g + 1}/${N}`);
}
process.stderr.write('\n');
for (const [k, st] of Object.entries(stat)) console.log(`빌더 ${k}: 지옥 ${st.wins}승 ${st.losses}패 ${st.draws}무 → 지옥 승률 ${(st.wins / N * 100).toFixed(1)}% · 평균 ${(st.turns / N).toFixed(1)}턴 · 팀 구성 ${(st.ms / N / 1000).toFixed(1)}초 (플레이어: 결투가, 팀: ${TEAM}, ${N}판)`);
