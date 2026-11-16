// Showdown 프로토콜 → 기존 Rembrandt 화면 이벤트 변환기 (시험용 최소 버전)
import fs from 'node:fs';
import { Battle, Dex, PRNG } from '@pkmn/sim';
import { loadBattle } from '../../tools/lib/load-battle.mjs';
const { data } = loadBattle();
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const dex = Dex.forGen(9);
const csv = f => { const [h, ...rows] = fs.readFileSync(`out/csv/${f}.csv`, 'utf8').trim().split('\n'); const c = h.split(','); return rows.map(r => { const v = r.split(','); return Object.fromEntries(c.map((k, i) => [k, v[i]])); }); };
const koMap = (idCsv, nameCsv, key) => { const idOf = new Map(csv(idCsv).map(r => [r.id, norm(r.identifier)])); return new Map(csv(nameCsv).filter(r => r.local_language_id === '3').map(r => [idOf.get(r[key]), r.name])); };
const KO = { ability: koMap('abilities', 'ability_names', 'ability_id'), item: koMap('items', 'item_names', 'item_id'),
  move: new Map(Object.values(data.moves).map(m => [norm(m.e), m.k])),
  species: new Map(Object.values(data.pokemon).map(p => [norm(p.e), p.k])) };
const kname = (kind, name) => KO[kind].get(norm(name)) ?? name;
const mon = s => { const m = /^p([12])[ab]?: (.*)$/.exec(s); return m ? { side: Number(m[1]) - 1, name: kname('species', m[2]) } : { side: 0, name: s }; };
const hp = s => { const m = /^(\d+)(?:\/(\d+))? ?(\w+)?/.exec(s || ''); return m ? { hp: +m[1], maxHp: +(m[2] || 100) } : {}; };

/** 한 줄 → 기존 화면 이벤트(0~n개). 못 바꾸면 null (통계용) */
export function convert(line) {
  const p = line.split('|').slice(1); const k = p[0];
  switch (k) {
    case 'turn': return [{ t: 'turn', turn: +p[1] }];
    case 'switch': case 'drag': { const m = mon(p[1]); return [{ t: 'switch', side: m.side, name: kname('species', p[2].split(',')[0]), ...hp(p[3]), text: `${m.side ? '상대' : '나'}는 ${kname('species', p[2].split(',')[0])}을(를) 내보냈다!` }]; }
    case 'move': { const m = mon(p[1]); return [{ t: 'move', side: m.side, move: kname('move', p[2]), text: `${m.name}의 ${kname('move', p[2])}!` }]; }
    case '-damage': { const m = mon(p[1]); return [{ t: 'damage', side: m.side, ...hp(p[2]) }]; }
    case '-heal': { const m = mon(p[1]); return [{ t: 'heal', side: m.side, ...hp(p[2]), text: `${m.name}의 체력이 회복되었다!` }]; }
    case '-crit': return [{ t: 'crit', text: '급소에 맞았다!' }];
    case '-supereffective': return [{ t: 'effective', eff: 2, text: '효과가 굉장했다!' }];
    case '-resisted': return [{ t: 'effective', eff: 0.5, text: '효과가 별로인 듯하다...' }];
    case '-immune': return [{ t: 'effective', eff: 0, text: `${mon(p[1]).name}에게는 효과가 없는 것 같다...` }];
    case '-miss': return [{ t: 'miss', text: `${mon(p[1]).name}에게는 맞지 않았다!` }];
    case 'faint': { const m = mon(p[1]); return [{ t: 'faint', side: m.side, text: `${m.name}은(는) 쓰러졌다!` }]; }
    case '-boost': case '-unboost': { const m = mon(p[1]); return [{ t: 'stage', side: m.side, stat: p[2], change: (k === '-boost' ? 1 : -1) * +p[3], text: `${m.name}의 ${p[2]}이(가) ${k === '-boost' ? '올랐다' : '떨어졌다'}!` }]; }
    case '-status': { const m = mon(p[1]); return [{ t: 'status', side: m.side, kind: p[2], text: `${m.name}은(는) ${p[2]} 상태가 되었다!` }]; }
    case '-weather': return [{ t: 'field', weather: p[1], text: `날씨: ${p[1]}` }];
    case '-ability': { const m = mon(p[1]); return [{ t: 'text', text: `${m.name}의 특성 ${kname('ability', p[2])}!` }]; }
    case '-item': case '-enditem': { const m = mon(p[1]); return [{ t: 'text', text: `${m.name}의 ${kname('item', p[2])}!` }]; }
    case '-mega': { const m = mon(p[1]); return [{ t: 'text', text: `${m.name}은(는) ${kname('item', p[3])}으로 메가진화했다!` }]; }
    case 'detailschange': { const m = mon(p[1]); return [{ t: 'types', side: m.side, text: `→ ${kname('species', p[2].split(',')[0])}` }]; }
    case 'win': return [{ t: 'end', text: `${p[1] === 'a' ? '나' : '상대'}의 승리!` }];
    case 'cant': return [{ t: 'text', text: `${mon(p[1]).name}은(는) 움직일 수 없다!` }];
    case '-fail': return [{ t: 'text', text: '하지만 실패했다!' }];
    // 화면에 나오지 않는 줄
    case 'split': case 't:': case 'upkeep': case 'debug': case 'poke': case 'player': case 'teamsize': case 'gametype': case 'gen': case 'tier': case 'rule': case 'raw': case 'clearpoke': case 'teampreview': case 'start': case '': case 'inactive': return [];
    default: return null;
  }
}
// ── 시연: 우리 한국어 데이터의 메가진화 포켓몬으로 3대3 ──
if (process.argv[1].endsWith('bridge.mjs')) {
  const mk = (sp, ability, item, moves) => ({ species: sp, ability, item, moves, evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 } });
  const b = new Battle({ formatid: 'gen9customgame@@@Terastal Clause', seed: [3, 1, 4, 1],
    p1: { name: 'a', team: [mk('Charizard', 'Blaze', 'Charizardite X', ['dragonclaw', 'flareblitz', 'dragondance', 'roost']), mk('Gengar', 'Cursed Body', 'Life Orb', ['shadowball', 'sludgebomb', 'thunderbolt', 'willowisp']), mk('Metagross', 'Clear Body', 'Leftovers', ['meteormash', 'earthquake', 'bulletpunch', 'psychic'])] },
    p2: { name: 'b', team: [mk('Venusaur', 'Overgrow', 'Venusaurite', ['gigadrain', 'sludgebomb', 'sleeppowder', 'earthquake']), mk('Blastoise', 'Torrent', 'Blastoisinite', ['hydropump', 'icebeam', 'rapidspin', 'darkpulse']), mk('Garchomp', 'Rough Skin', 'Choice Band', ['earthquake', 'outrage', 'stoneedge', 'firefang'])] } });
  const rng = new PRNG([1, 2, 3, 4]); let cursor = 0, total = 0, mapped = 0, unknown = new Map(); const out = [];
  const flush = () => { for (; cursor < b.log.length; cursor++) { const ev = convert(b.log[cursor]); if (ev === null) { const k = b.log[cursor].split('|')[1]; unknown.set(k, (unknown.get(k) || 0) + 1); total++; continue; } if (ev.length) { total++; mapped++; out.push(...ev); } } };
  let g = 0;
  while (!b.ended && g++ < 80) for (const s of ['p1', 'p2']) { const q = b[s].activeRequest; if (!q || q.wait) continue;
    if (q.teamPreview) { b.choose(s, 'default'); continue; }
    if (q.forceSwitch) { b.choose(s, `switch ${q.side.pokemon.findIndex(p => !p.active && !/fnt/.test(p.condition)) + 1}`); continue; }
    const a = q.active[0]; const i = 1 + Math.floor(rng.random() * a.moves.length); b.choose(s, `move ${i}${a.canMegaEvo ? ' mega' : ''}`); }
  flush();
  console.log(out.map(e => e.text ? `[${e.t}] ${e.text}` : `[${e.t}] ${JSON.stringify(e)}`).slice(0, 34).join('\n'));
  console.log(`\n변환 결과: 화면에 필요한 줄 ${mapped}개 변환, 미변환 종류 ${JSON.stringify([...unknown])}`);
}
