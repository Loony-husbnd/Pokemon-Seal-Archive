import { Battle } from '@pkmn/sim';
const t=[{species:'Garchomp',ability:'Rough Skin',moves:['earthquake']},{species:'Gholdengo',ability:'Good as Gold',moves:['shadowball']},{species:'Corviknight',ability:'Pressure',moves:['roost']}];
const r = new Battle({formatid:'gen9customgame@@@Terastal Clause',seed:[1,2,3,4],p1:{name:'a',team:t},p2:{name:'b',team:t}}); r.choose('p1','default'); r.choose('p2','default');
let t0=performance.now(); const js = JSON.stringify(r.toJSON()); console.log('직렬화 1회(ms):', (performance.now()-t0).toFixed(2), '크기(KB):', (js.length/1024).toFixed(0));
t0=performance.now(); for(let i=0;i<300;i++) Battle.fromJSON(JSON.parse(js)); console.log('복원 1회(ms):', ((performance.now()-t0)/300).toFixed(2));
