#!/usr/bin/env node
/**
 * 변화기 1개씩의 실제 가치 측정 (짝지은 A/B 시뮬레이션, AI 끼리)
 *
 *   node tools/simulate-status-moves.mjs [--k 600] [--seed 1] [--level hard]
 *
 * 변화기 X 를 배울 수 있는 포켓몬이 선봉인 파티를 두 가지로 싸우게 한다.
 *   기준: 공격기 4개          변형: 공격기 3개 + X
 * 같은 상대·같은 시드로 비교하므로, 승률 차이(변형 − 기준)가 곧 'X 를 4번째 공격기 대신 넣었을 때의 득실'이다.
 */
import { loadBattle } from './lib/load-battle.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const K = Number(opt('k', 600)), SEED = Number(opt('seed', 1)), LEVEL = opt('level', 'hard');
const { engine: E, data, ai: AI } = loadBattle();
const rnd = E.mulberry32(SEED);
const all = Object.keys(data.pokemon).map(Number).filter(id => id <= 1025);
const pick = list => list[Math.floor(rnd() * list.length)];
const randTeam = () => { const s = new Set(); while (s.size < 3) s.add(pick(all)); return [...s]; };

function fight(sideA, sideB, seed) {
  const mons = s => s.map(x => E.makeMon(x.id, { moves: x.moves }));
  const bt = E.createBattle({ parties: [mons(sideA), mons(sideB)], seed });
  const brains = [AI.create(E, { seed }), AI.create(E, { seed: seed + 7919 })];
  bt.start();
  let g = 0;
  while (bt.phase !== 'ended') {
    if (++g > 1200) return 'draw';
    if (bt.phase === 'switch') { bt.pending.slice().forEach(si => bt.replace(si, brains[si].chooseReplacement(bt, si, LEVEL))); continue; }
    bt.playTurn(brains[0].chooseAction(bt, 0, LEVEL), brains[1].chooseAction(bt, 1, LEVEL));
  }
  return bt.winner;
}
const atk = id => ({ id, moves: [...data.pokemon[id].m] });

const out = [];
for (const [mid, mv] of Object.entries(data.moves)) {
  if (mv.c !== 'n') continue;
  const learners = all.filter(id => data.pokemon[id].sm.includes(Number(mid)) && data.pokemon[id].m.length >= 4);
  if (learners.length < 3) { out.push({ k: mv.k, e: mv.e, n: 0 }); continue; }
  let base = 0, vari = 0, n = 0;
  for (let i = 0; i < K; i++) {
    const lead = pick(learners), mates = randTeam().filter(x => x !== lead).slice(0, 2), foe = randTeam();
    const seed = 1000 + i;
    const withX = { id: lead, moves: [...data.pokemon[lead].m.slice(0, 3), Number(mid)] };
    const a1 = fight([atk(lead), ...mates.map(atk)], foe.map(atk), seed);
    const a2 = fight([withX, ...mates.map(atk)], foe.map(atk), seed);
    if (a1 === 'draw' || a2 === 'draw') continue;
    n++; if (a1 === 0) base++; if (a2 === 0) vari++;
  }
  out.push({ k: mv.k, e: mv.e, n, delta: 100 * (vari - base) / n, base: 100 * base / n });
}
out.sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999));
console.log(`변화기별 득실 (공격기 4개 → 공격기 3개 + X, ${K}쌍씩, AI ${LEVEL}; 표준오차 약 ±2.5%p)`);
for (const r of out) console.log(`  ${r.k.padEnd(9)} ${r.n ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(1).padStart(5) + '%p' : '  (배우는 포켓몬 부족)'}`);
const ds = out.filter(r => r.n).map(r => r.delta);
console.log(`평균 ${(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(1)}%p / 이득(+3 초과) ${ds.filter(d => d > 3).length}개 / 손해(−3 미만) ${ds.filter(d => d < -3).length}개`);
