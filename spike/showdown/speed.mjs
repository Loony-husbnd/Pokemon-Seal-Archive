import { Battle, PRNG } from '@pkmn/sim';
const team1 = [{species:'Garchomp',ability:'Rough Skin',item:'Life Orb',moves:['earthquake','stoneedge','swordsdance'],evs:{atk:252,spe:252}},{species:'Gholdengo',ability:'Good as Gold',moves:['focusblast','shadowball'],evs:{spa:252}},{species:'Corviknight',ability:'Pressure',moves:['bravebird','roost'],evs:{hp:252}}];
const team2 = [{species:'Kingambit',ability:'Defiant',moves:['suckerpunch','kowtowcleave'],evs:{atk:252}},{species:'Toxapex',ability:'Regenerator',moves:['scald','recover'],evs:{hp:252}},{species:'Dragapult',ability:'Infiltrator',moves:['dragondarts','shadowball'],evs:{spe:252}}];
const start = seed => { const b = new Battle({formatid:'gen9customgame@@@Terastal Clause',seed:[seed,2,3,4],p1:{name:'a',team:team1},p2:{name:'b',team:team2}}); b.choose('p1','default'); b.choose('p2','default'); return b; };
// 요청에 맞는 선택: 교체 요청이면 살아있는 첫 포켓몬, 아니면 pref
const reqOf = (b, s) => b[s].activeRequest;
function auto(b, s, pref) {
  const r = reqOf(b, s); if (!r || r.wait) return null;
  if (r.forceSwitch) { const i = r.side.pokemon.findIndex(p => !p.active && !/fnt/.test(p.condition)); return `switch ${i + 1}`; }
  return pref || 'move 1';
}
const step = (b, c1, c2) => { const a = auto(b,'p1',c1), d = auto(b,'p2',c2); if (a) b.choose('p1', a); if (d) b.choose('p2', d); };
function settle(b) { let g = 0; while (!b.ended && g++ < 5 && ['p1','p2'].some(s => reqOf(b,s)?.forceSwitch)) step(b); }
// 시작 상태: 두 턴 진행 후 양쪽 다 기술 고르는 상태로
console.log("start");
const real = start(1); step(real,'move 1','move 1'); settle(real);
console.log("real state:", real.requestState, "turn", real.turn, "p1 req:", Object.keys(real.p1.activeRequest||{}).join(","), "p2 req:", Object.keys(real.p2.activeRequest||{}).join(","));
const cands = ["move 1","move 2","move 3","switch 2","switch 3"];
const json = JSON.stringify(real.toJSON());
let t0 = performance.now(), forks = 0, bad = 0, turns = 0;
for (let round = 0; round < 20; round++) for (const cand of cands) {
  const b = Battle.fromJSON(JSON.parse(json)); b.prng = new PRNG([round*31+1,3,5,7]); forks++;
  let ok; try { ok = b.choose("p1", cand); } catch (e) { console.log("FAIL", cand, "round", round, e.message); process.exit(1); } if (!ok) { bad++; continue; }
  try { b.choose('p2','move 1'); } catch (e) { console.log('FAIL p2', cand, 'round', round, 'p1req', JSON.stringify(Object.keys(b.p1.activeRequest||{})), 'p2req', JSON.stringify(Object.keys(b.p2.activeRequest||{})), 'state', b.requestState, 'turn', b.turn, 'forks so far', forks); process.exit(1); } turns++;
  for (let d = 0; d < 3 && !b.ended; d++) { settle(b); if (!b.ended) { step(b); turns++; } }
}
const dt = performance.now() - t0;
console.log(`3대3 탐색 20라운드 × 후보 ${cands.length}개 (각 후속 3턴): 총 ${dt.toFixed(0)}ms, 복제 ${forks}회(선택 불가 ${bad}), 진행 턴 ${turns}`);
console.log(`복제+4턴 평균 ${(dt/forks).toFixed(2)}ms → 현재 지옥 예산 700ms면 약 ${Math.floor(700/(dt/forks))}회`);
