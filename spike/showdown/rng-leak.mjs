import { Battle, PRNG } from '@pkmn/sim';
const team1 = [{species:'Garchomp',ability:'Rough Skin',item:'Life Orb',moves:['earthquake','stoneedge','swordsdance'],evs:{atk:252,spe:252}},{species:'Gholdengo',ability:'Good as Gold',moves:['focusblast','shadowball'],evs:{spa:252}},{species:'Corviknight',ability:'Pressure',moves:['bravebird','roost'],evs:{hp:252}}];
const team2 = [{species:'Kingambit',ability:'Defiant',moves:['suckerpunch','kowtowcleave'],evs:{atk:252}},{species:'Toxapex',ability:'Regenerator',moves:['scald','recover'],evs:{hp:252}},{species:'Dragapult',ability:'Infiltrator',moves:['dragondarts','shadowball'],evs:{spe:252}}];
const start = seed => { const b = new Battle({formatid:'gen9customgame@@@Terastal Clause',seed:[seed,2,3,4],p1:{name:'a',team:team1},p2:{name:'b',team:team2}}); b.choose('p1','default'); b.choose('p2','default'); return b; };
const sig = b => b.sides.map(s => s.pokemon.map(p => p.hp).join('/')).join(' | ');
// 실제 배틀과 복제본 비교 (한 턴 진행)
let sameNoReseed = 0, sameReseed = 0, N = 300, diffSeeds = new Set();
for (let g = 0; g < N; g++) {
  const real = start(100 + g);
  const clone = Battle.fromJSON(real.toJSON());             // 복제 (난수 상태까지 복제됨)
  const clone2 = Battle.fromJSON(real.toJSON()); clone2.prng = new PRNG([g * 7 + 1, 5, 6, 7]);   // 시드를 새로 줌
  for (const b of [real, clone, clone2]) { b.choose('p1','move 1'); b.choose('p2','move 1'); }
  if (sig(clone) === sig(real)) sameNoReseed++;
  if (sig(clone2) === sig(real)) sameReseed++;
}
console.log(`한 턴 결과가 실제와 똑같은 비율 — 시드 그대로 복제: ${(100*sameNoReseed/N).toFixed(0)}%, 새 시드: ${(100*sameReseed/N).toFixed(0)}%`);
