import { BattleStreams, Teams } from '@pkmn/sim'; const { BattleStream, getPlayerStreams } = BattleStreams;
const T1 = [{species:'Charizard',ability:'Blaze',item:'Choice Specs',moves:['flamethrower','airslash'],evs:{spa:252}}], T2 = [{species:'Blissey',ability:'Natural Cure',item:'Leftovers',moves:['softboiled','seismictoss']}];
const streams = getPlayerStreams(new BattleStream());
const seen = { p1: [], p2: [], omni: [] };
const rd = async (st, key) => { for await (const chunk of st) seen[key].push(chunk); };
rd(streams.omniscient, 'omni'); rd(streams.p1, 'p1'); rd(streams.p2, 'p2');
await streams.omniscient.write(`>start ${JSON.stringify({ formatid: 'gen9anythinggoes@@@Terastal Clause', seed: [1,2,3,4] })}\n>player p1 ${JSON.stringify({ name: 'a', team: Teams.pack(T1) })}\n>player p2 ${JSON.stringify({ name: 'b', team: Teams.pack(T2) })}`);
await streams.p1.write('team 1'); await streams.p2.write('team 1');
for (let i = 0; i < 4; i++) { await streams.p1.write('move 1'); await streams.p2.write('move 1'); }
await new Promise(r => setTimeout(r, 200));
const p1 = seen.p1.join('\n'), omni = seen.omni.join('\n');
const sw = l => l.split('\n').filter(x => /^\|(switch|-damage|-heal)\|p2a/.test(x));
console.log('상대(p2) 쪽 줄 — p1(나) 시점:\n ', sw(p1).slice(0, 4).join('\n  '));
console.log('상대(p2) 쪽 줄 — 전지적 시점:\n ', sw(omni).slice(0, 4).join('\n  '));
const leak = w => `${w}: p1 시점 ${p1.includes(w) ? '노출' : '가려짐'} / 전지적 ${omni.includes(w) ? '노출' : '가려짐'}`;
console.log(leak('Leftovers'), '|', leak('Natural Cure'), '|', leak('seismictoss'));
console.log('내 도구 Choice Specs → p1 시점:', p1.includes('Choice Specs') ? '노출(자기 정보)' : '없음');
