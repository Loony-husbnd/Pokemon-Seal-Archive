#!/usr/bin/env node
/**
 * Rembrandt 2 한국어 이름표 생성 — PokeAPI CSV(한국어 = local_language_id 3)를 Showdown 식별자(toID)에 맞춰 묶는다.
 *   node tools/build-ko-names.mjs        → packages/rembrandt2/data/ko-names.js
 * 종·기술·특성·도구·타입·성격 이름. 폼 이름(메가·리전)은 규칙으로 조립하고, 규칙에 없는 폼은 '이름 (영문 폼)' 으로 둔다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/sim';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache', 'csv');
const OUT = path.join(ROOT, 'packages', 'rembrandt2', 'data', 'ko-names.js');
const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const FILES = ['pokemon_species', 'pokemon_species_names', 'moves', 'move_names', 'abilities', 'ability_names', 'items', 'item_names', 'types', 'type_names', 'natures', 'nature_names'];

async function download(name) {
  const dest = path.join(CACHE, name + '.csv');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(CACHE, { recursive: true });
  try { const res = await fetch(`${BASE}/${name}.csv`); if (!res.ok) throw new Error(`HTTP ${res.status}`); fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer())); }
  catch (err) { const r = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', dest, `${BASE}/${name}.csv`]); if (r.status !== 0) throw new Error(`다운로드 실패: ${name} (${err.message})`); }
}
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const csv = n => parseCsv(fs.readFileSync(path.join(CACHE, n + '.csv'), 'utf8'));
const id = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const KO = 3;

for (const f of FILES) await download(f);
const nameMap = (idsCsv, namesCsv, key) => {
  const ident = new Map(csv(idsCsv).map(r => [r.id, id(r.identifier)]));
  return new Map(csv(namesCsv).filter(r => r.local_language_id === String(KO) && r.name).map(r => [ident.get(r[key]), r.name]));
};
const koMove = nameMap('moves', 'move_names', 'move_id'), koAbility = nameMap('abilities', 'ability_names', 'ability_id');
const koItem = nameMap('items', 'item_names', 'item_id'), koType = nameMap('types', 'type_names', 'type_id'), koNature = nameMap('natures', 'nature_names', 'nature_id');
const koSpeciesById = new Map(csv('pokemon_species_names').filter(r => r.local_language_id === String(KO)).map(r => [Number(r.pokemon_species_id), r.name]));

const dex = Dex.forGen(9);
const out = { species: {}, moves: {}, abilities: {}, items: {}, types: {}, natures: {} };
const miss = { species: [], moves: [], abilities: [], items: [], types: [], natures: [] };

// 종: 기본형은 PokeAPI 한국어 이름, 폼은 규칙으로 조립
const REGION = { Alola: '알로라', Galar: '가라르', Hisui: '히스이', Paldea: '팔데아' };
function speciesName(sp) {
  const base = koSpeciesById.get(sp.num);
  if (!base) return null;
  if (!sp.forme) return base;
  const f = sp.forme;
  let m;
  if ((m = /^Mega(?:-([XYZ]))?$/.exec(f))) return `메가${base}${m[1] || ''}`;
  if (REGION[f]) return `${REGION[f]} ${base}`;
  if ((m = /^(Alola|Galar|Hisui|Paldea)-(.+)$/.exec(f))) return `${REGION[m[1]]} ${base} (${m[2]})`;
  if (f === 'Gmax') return `거다이맥스 ${base}`;
  if (f === 'Primal') return `원시회귀 ${base}`;
  return `${base} (${f})`;
}
let fallbackForms = 0;
for (const sp of dex.species.all()) {
  if (!sp.exists || sp.num <= 0) continue;
  const n = speciesName(sp);
  if (n) { out.species[sp.id] = n; if (sp.forme && /\(/.test(n) && !/^(알로라|가라르|히스이|팔데아)/.test(n)) fallbackForms++; }
  else miss.species.push(sp.name);
}
// Showdown 과 PokeAPI 의 식별자가 다른 것 (확인된 것만)
const ALIAS = { visegrip: 'vicegrip', prettyfeather: 'prettywing', embodyaspectteal: 'embodyaspect', embodyaspecthearthflame: 'embodyaspect', embodyaspectwellspring: 'embodyaspect', embodyaspectcornerstone: 'embodyaspect' };
const fill = (kind, list, map) => { for (const x of list) { if (!x.exists || (x.num !== undefined && x.num <= 0 && kind !== 'types')) continue; const n = map.get(x.id) || map.get(ALIAS[x.id]); if (n) out[kind][x.id] = n; else miss[kind].push(x.name); } };
fill('moves', [...dex.moves.all()], koMove);
fill('abilities', [...dex.abilities.all()], koAbility);
fill('items', [...dex.items.all()], koItem);
fill('types', [...dex.types.all()], koType);
for (const n of dex.natures.all()) { const k = koNature.get(id(n.name)); if (k) out.natures[id(n.name)] = k; else miss.natures.push(n.name); }

const banner = '// 자동 생성 파일 — node tools/build-ko-names.mjs (PokeAPI CSV 의 한국어 이름). 직접 고치지 말고 도구를 고친다.\n';
fs.writeFileSync(OUT, banner + 'export const KO = ' + JSON.stringify(out) + ';\n');
const count = o => Object.keys(o).length;
console.log(`종 ${count(out.species)} (이름 없음 ${miss.species.length}, 규칙 밖 폼 ${fallbackForms}) · 기술 ${count(out.moves)} (없음 ${miss.moves.length}) · 특성 ${count(out.abilities)} (없음 ${miss.abilities.length}) · 도구 ${count(out.items)} (없음 ${miss.items.length}) · 타입 ${count(out.types)} · 성격 ${count(out.natures)}`);
for (const k of ['species', 'moves', 'abilities', 'items']) if (miss[k].length) console.log(`  ${k} 없음 예: ${miss[k].slice(0, 6).join(', ')}`);
console.log(`크기 ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
