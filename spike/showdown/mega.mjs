import { Battle } from '@pkmn/sim';
const mk = fmt => { const b = new Battle({ formatid: fmt, seed:[1,2,3,4],
  p1:{name:'a',team:[{species:'Garchomp',ability:'Rough Skin',moves:['earthquake']},{species:'Charizard',ability:'Blaze',item:'Charizardite X',moves:['flamethrower']}]},
  p2:{name:'b',team:[{species:'Blissey',ability:'Natural Cure',moves:['softboiled']}]}});
  b.choose('p1','default'); b.choose('p2','default'); return b; };
const b = mk('gen9customgame@@@Terastal Clause');
console.log('규칙 적용 시 can*:', Object.keys(b.p1.activeRequest.active[0]).filter(k=>/^can/.test(k)).join(',') || '(없음)');
const ok = b.choose('p1','move 1 terastallize');
console.log('테라스탈 선택 결과:', ok, '| 요청 상태:', JSON.stringify(b.p1.activeRequest).slice(0,60));
// 같은 팀의 메가석 리자몽은 교체 후 메가 가능?
const c = mk('gen9customgame@@@Terastal Clause'); c.choose('p1','switch 2'); c.choose('p2','move 1');
console.log('교체 후 리자몽 can*:', Object.keys(c.p1.activeRequest.active[0]).filter(k=>/^can/.test(k)).join(','));
c.choose('p1','move 1 mega'); c.choose('p2','move 1');
console.log('메가X 종/특성:', c.p1.active[0].species.name, c.p1.active[0].ability, '타입:', c.p1.active[0].types.join('/'));
