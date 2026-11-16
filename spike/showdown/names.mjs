import fs from 'node:fs';
import { Dex } from '@pkmn/sim';
const csv = f => { const [h, ...rows] = fs.readFileSync(`out/csv/${f}.csv`, 'utf8').trim().split('\n'); const cols = h.split(','); return rows.map(r => { const v = r.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); }); };
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function cover(kind, idCsv, nameCsv, idKey, list) {
  const idOf = new Map(csv(idCsv).map(r => [r.id, norm(r.identifier)]));
  const ko = new Map(csv(nameCsv).filter(r => r.local_language_id === '3').map(r => [idOf.get(r[idKey]), r.name]));
  const have = list.filter(x => ko.has(x.id));
  console.log(`${kind}: Showdown 9세대 ${list.length}개 중 한국어 이름 ${have.length}개 (${(100*have.length/list.length).toFixed(1)}%)`);
  console.log('  없는 예:', list.filter(x => !ko.has(x.id)).slice(0, 8).map(x => x.name).join(', '));
}
const dex = Dex.forGen(9);
cover('특성', 'abilities', 'ability_names', 'ability_id', [...dex.abilities.all()].filter(a => a.exists && !a.isNonstandard && a.num > 0));
cover('도구', 'items', 'item_names', 'item_id', [...dex.items.all()].filter(i => i.exists && !i.isNonstandard && i.num > 0));
