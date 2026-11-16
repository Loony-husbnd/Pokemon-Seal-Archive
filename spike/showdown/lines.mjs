import { Battle, Dex, PRNG } from '@pkmn/sim';
const dex = Dex.forGen(9);
const SP = [...dex.species.all()].filter(x => x.exists && x.num > 0 && x.num <= 1025 && !x.isNonstandard && !x.forme && x.baseSpecies === x.name);
const IT = [...dex.items.all()].filter(i => i.exists && !i.isNonstandard && !/ium Z|Memory|Plate|Drive|Orb$/.test(i.name) && !i.isPokeball && !i.megaStone && !i.zMove);
const prng0 = new PRNG([5,5,5,5]);
const pick = a => a[Math.floor(prng0.random() * a.length)];
const randTeam = () => { const t = []; while (t.length < 3) { const sp = pick(SP); const ld = dex.species.getLearnsetData(sp.id).learnset; if (!ld) continue; const mv = Object.keys(ld).filter(m => ld[m].some(s => s.startsWith('9')) && dex.moves.get(m).exists); if (mv.length < 4) continue; const ms = new Set(); while (ms.size < 4) ms.add(pick(mv)); t.push({ species: sp.name, ability: pick(Object.values(sp.abilities)), item: pick(IT).name, moves: [...ms], evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 } }); } return t; };
const fmt = 'gen9customgame@@@Terastal Clause';
const kinds = new Map(), detail = new Map(); let battles = 0, turns = 0, errs = 0;
const rng = new PRNG([9, 8, 7, 6]);
for (let g = 0; g < 400; g++) {
  try {
    const t1 = randTeam(), t2 = randTeam();
    const b = new Battle({ formatid: fmt, seed: [g, 2, 3, 4], p1: { name: 'a', team: t1 }, p2: { name: 'b', team: t2 } });
    let guard = 0;
    while (!b.ended && guard++ < 120) {
      for (const s of ['p1','p2']) {
        const q = b[s].activeRequest; if (!q || q.wait) continue;
        if (q.teamPreview) { b.choose(s, 'default'); continue; }
        if (q.forceSwitch) { const i = q.side.pokemon.findIndex(p => !p.active && !/fnt/.test(p.condition)); b.choose(s, `switch ${i+1}`); continue; }
        const mv = q.active[0].moves.map((m, i) => m.disabled ? -1 : i + 1).filter(i => i > 0);
        b.choose(s, mv.length ? `move ${mv[Math.floor(rng.random() * mv.length)]}` : 'default');
      }
      if (b.turn > turns) turns = 0; 
    }
    battles++; turns += b.turn;
    for (const line of b.log) {
      const p = line.split('|'); const k = p[1]; if (!k) continue;
      kinds.set(k, (kinds.get(k) || 0) + 1);
      // 효과 이름이 들어가는 종류는 (종류, 효과) 쌍으로 센다
      let key = k;
      if (['-start','-end','-activate','-weather','-fieldstart','-sidestart','-sideend','-status','-curestatus','-singlemove','-singleturn','-ability','-enditem','-item','-fieldend','-block','-immune','-fail'].includes(k)) {
        const eff = p.slice(2).filter(x => !/^p[12][ab]?:/.test(x) && !/^\[(of|silent|msg|from)\]/.test(x) || /^\[from\]/.test(x)).join('|').replace(/p[12][ab]?: [^|]*/g,'');
        key = k + '|' + eff.replace(/\[from\] ?/, '');
      }
      detail.set(key, (detail.get(key) || 0) + 1);
    }
  } catch (e) { errs++; }
}
const sorted = [...kinds].sort((a, b) => b[1] - a[1]);
console.log(`대전 ${battles}판 (오류 ${errs}), 총 턴 ${turns}`);
console.log('프로토콜 줄 종류:', kinds.size, '개');
console.log(sorted.map(([k, n]) => `${k}:${n}`).join(' '));
console.log('(종류, 효과) 조합 수:', detail.size);
const rare = [...detail].filter(([, n]) => n >= 3).length; console.log('3회 이상 등장한 조합:', rare);
