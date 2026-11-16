import { Battle, PRNG } from '@pkmn/sim';
const team1 = [{species:'Garchomp',ability:'Rough Skin',item:'Life Orb',moves:['earthquake','stoneedge','swordsdance'],evs:{atk:252,spe:252}},{species:'Gholdengo',ability:'Good as Gold',moves:['focusblast','shadowball'],evs:{spa:252}},{species:'Corviknight',ability:'Pressure',moves:['bravebird','roost'],evs:{hp:252}}];
const team2 = [{species:'Kingambit',ability:'Defiant',moves:['suckerpunch','kowtowcleave'],evs:{atk:252}},{species:'Toxapex',ability:'Regenerator',moves:['scald','recover'],evs:{hp:252}},{species:'Dragapult',ability:'Infiltrator',moves:['dragondarts','shadowball'],evs:{spe:252}}];
const mk = () => { const r = new Battle({formatid:'gen9customgame@@@Terastal Clause',seed:[1,2,3,4],p1:{name:'a',team:team1},p2:{name:'b',team:team2}}); r.choose('p1','default'); r.choose('p2','default'); r.choose('p1','move 1'); r.choose('p2','move 1'); r.choose('p2','switch 2'); return r; };
const play = b => { for (let d = 0; d < 4 && !b.ended; d++) { for (const s of ['p1','p2']) { const q = b[s].activeRequest; if (q && !q.wait) { if (q.forceSwitch) { const i = q.side.pokemon.findIndex(p => !p.active && !/fnt/.test(p.condition)); b.choose(s, `switch ${i+1}`); } else b.choose(s, 'move 1'); } } } };
for (const [label, clone] of [['fromJSON(toJSON()) 직접', r => Battle.fromJSON(r.toJSON())], ['JSON 문자열 깊은 복사', r => Battle.fromJSON(JSON.parse(JSON.stringify(r.toJSON())))]]) {
  const real = mk(); const before = JSON.stringify(real.toJSON());
  let err = 0;
  for (let i = 0; i < 30; i++) { try { const b = clone(real); b.prng = new PRNG([i*31+1,3,5,7]); play(b); } catch (e) { err++; } }
  const after = JSON.stringify(real.toJSON());
  console.log(label, '| 복제 30회 중 오류', err, '| 원본 상태가 오염됨:', before !== after);
}
