/**
 * 도감·팀 데이터: Showdown 9세대 데이터에 한국어 이름을 붙인 층.
 *
 *   const D = createDex();                          // 기본 'all': 전국도감 1~1025 전부 · { roster: 'sv' } 는 9세대(스칼렛·바이올렛)에 나오는 종만
 *   D.roster()                  → [{ id, ko, name, types, baseStats, bst, num, abilities }]  (기본형·지방폼·특수폼. 메가는 따로 두지 않고 메가스톤 도구로 표현)
 *   D.learnable('garchomp')     → Set(기술 id)   9세대에서 레벨·기술머신·교습·알로 배우는 기술 (진화 전 포함, 메가는 원래 종 기준)
 *   D.itemsFor('charizard')     → [{ id, ko, name }]  일반 도구 + 그 종의 메가스톤
 *   D.makeSet({ species, moves, ability, item, nature, evs, ivs })  → Showdown PokemonSet (기본: Lv.100, 개체값 31, 노력치 0)
 *   D.validateTeam(sets)        → { ok, errors: [] }
 */
import { Dex } from '@pkmn/sim';
import { koName, josa, toID } from './ko.js';
import { TEAM_SIZE } from './format.js';

const dex = Dex.forGen(9);
// 습득 경로: 레벨업(L)·기술머신(M)·교습(T)·알(E). 이벤트(S) 등 특수 경로는 제외. 폼 자신의 목록에는 'R'(그 폼일 때만 쓰는 기술. 예: 워시로토무의 하이드로펌프)도 인정
const REGIONAL = /^(Alola|Galar|Hisui|Paldea)(-|$)/;
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** 요청에만 나오고 기술 목록에는 없는 가짜 기술. 반동 기술(파괴광선 등)을 쓴 다음 턴의 선택지가 이것 하나뿐이다 */
const PSEUDO_MOVES = {
  recharge: { id: 'recharge', name: 'Recharge', ko: '반동으로 쉬는 중', type: 'Normal', typeKo: '노말', category: 'Status', power: 0, accuracy: null, pp: 0, priority: 0, pseudo: true },
};

export function createDex(opts = {}) {
  const rosterMode = opts.roster || 'all';
  const sv = sp => !sp.isNonstandard;                                // 9세대 정규 데이터에 있는 종

  /** 이 종(폼)을 직접 고를 수 있는가. 메가·전투 중에만 되는 폼은 제외 */
  const pickable = sp => {
    if (!sp.exists || sp.num <= 0 || sp.num > 1025 || sp.isNonstandard === 'CAP' || sp.isNonstandard === 'Custom') return false;
    if (/Mega|Gmax|Primal|Eternamax/.test(sp.forme || '') || sp.battleOnly) return false;
    if (rosterMode === 'sv') return sv(sp) && (!sp.baseSpecies || sp.baseSpecies === sp.name ? true : sv(dex.species.get(sp.baseSpecies)));
    return true;
  };
  // 폼에 따라 정해진 도구(아르세우스 플레이트, 자시안 왕의 녹슨검 등)와 기술(켈디오 비장의검)
  const fixedItemOf = sp => { if (sp.requiredItem) return toID(sp.requiredItem); if (sp.requiredItems && sp.requiredItems.length) return toID(sp.requiredItems[0]); return null; };
  const all = [...dex.species.all()].filter(pickable);
  const roster = all.map(sp => ({
    id: sp.id, name: sp.name, ko: koName('species', sp.id), num: sp.num, forme: sp.forme || '', types: sp.types.slice(),
    baseStats: Object.assign({}, sp.baseStats), bst: Object.values(sp.baseStats).reduce((a, b) => a + b, 0), abilities: Object.values(sp.abilities), abilitySlots: Object.entries(sp.abilities).map(([slot, name]) => ({ slot, name })), base: toID(sp.baseSpecies || sp.name), fixedItem: fixedItemOf(sp), fixedMove: sp.requiredMove || null, legendary: !!(sp.tags && (sp.tags.includes('Restricted Legendary') || sp.tags.includes('Sub-Legendary') || sp.tags.includes('Mythical'))),
  })).sort((a, b) => a.num - b.num || a.id.localeCompare(b.id));
  const byId = new Map(roster.map(r => [r.id, r]));

  // 습득 기술: 진화 전 단계까지 거슬러 올라가며 모은다 (알 기술은 진화 전에 적혀 있다). 메가폼은 원래 종 기준.
  // 지방 폼(알로라 등)은 자기 습득 목록이 완전하지만, 그 밖의 폼(로토무 가전·오거폰 가면·오리진 등)은 자기 목록이 없거나 일부뿐이라 원래 종의 것도 합친다.
  // 9세대에 나오지 않는 종은 9세대 데이터가 비어 있으므로, 그 종(과 진화 전)이 가진 가장 최근 세대(8→7→…)의 기술을 쓴다.
  const learnCache = new Map();
  const chainOf = start => { const list = [], seen = new Set(); for (let cur = start; cur && cur.exists && !seen.has(cur.id); cur = cur.prevo ? dex.species.get(cur.prevo) : null) { seen.add(cur.id); list.push(cur); } return list; };
  const GENS = [9, 8, 7, 6, 5, 4, 3, 2, 1];
  const srcRe = (gen, own) => new RegExp(`^${gen}[LMTE${own ? 'R' : ''}]`);
  function collect(out, species, gen) {
    for (const cur of species) {
      const ld = dex.species.getLearnsetData(cur.id).learnset; if (!ld) continue;
      const re = srcRe(gen, cur === species[0]);
      for (const [m, srcs] of Object.entries(ld)) if (srcs.some(x => re.test(x))) out.add(m);
    }
  }
  function learnable(speciesId) {
    const key = toID(speciesId);
    if (learnCache.has(key)) return learnCache.get(key);
    let sp = dex.species.get(key);
    if (/Mega/.test(sp.forme || '')) sp = dex.species.get(sp.baseSpecies);
    const chains = [chainOf(sp)];
    if (sp.baseSpecies && sp.baseSpecies !== sp.name && !REGIONAL.test(sp.forme || '')) chains.push(chainOf(dex.species.get(sp.baseSpecies)));
    const all = chains.flat();
    const hasGen = g => all.some(c => { const ld = dex.species.getLearnsetData(c.id).learnset; return ld && Object.values(ld).some(srcs => srcs.some(x => srcRe(g, false).test(x))); });
    const gen = GENS.find(hasGen) || 9;
    const out = new Set();
    for (const c of chains) collect(out, c, gen);
    for (const m of [...out]) if (!dex.moves.get(m).exists) out.delete(m);
    learnCache.set(key, out);
    return out;
  }

  const MEGA_STONES = new Map();                     // 기본 종 이름 → [{ item, form }]
  for (const it of dex.items.all()) if (it.exists && it.megaStone) {
    const k = toID(Object.keys(it.megaStone)[0]);          // megaStone: { 원래 종: 메가폼 }
    if (!MEGA_STONES.has(k)) MEGA_STONES.set(k, []);
    MEGA_STONES.get(k).push(it);
  }
  const GENERAL_ITEMS = [...dex.items.all()].filter(it => it.exists && !it.isNonstandard && !it.isPokeball && !it.megaStone && !it.zMove && it.num > 0 && (it.fling || it.onResidual || it.onModifyDamage || it.onModifyAtk || it.onModifySpA || it.onModifyDef || it.onModifySpD || it.onModifySpe || it.onEat || it.isBerry || it.onDamagingHit || it.onTryHit || it.boosts || it.onUpdate || it.onModifyMove || it.onAfterMoveSecondarySelf || it.onFractionalPriority || it.onTryHeal || it.onSourceModifyDamage || it.onStart || it.onTakeItem === false || it.isChoice));
  const asItem = it => ({ id: it.id, name: it.name, ko: koName('item', it.id) });
  function itemsFor(speciesId) {
    const sp = dex.species.get(speciesId);
    const fixed = byId.get(sp.id) && byId.get(sp.id).fixedItem;
    if (fixed) return [asItem(dex.items.get(fixed))];
    return [...(MEGA_STONES.get(toID(sp.baseSpecies || sp.name)) || []).map(asItem), ...GENERAL_ITEMS.map(asItem)];
  }
  const megaStonesOf = speciesId => { const sp = dex.species.get(speciesId); return (MEGA_STONES.get(toID(sp.baseSpecies || sp.name)) || []).map(it => ({ item: it.id, form: Object.values(it.megaStone)[0] })); };

  function makeSet(o) {
    const sp = dex.species.get(o.species);
    const row = byId.get(sp.id) || {};
    const ev = Object.assign({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, o.evs), iv = Object.assign({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, o.ivs);
    return { name: sp.baseSpecies && sp.forme ? sp.name : sp.name, species: sp.name, ability: o.ability || Object.values(sp.abilities)[0], item: row.fixedItem ? dex.items.get(row.fixedItem).name : o.item || '', moves: row.fixedMove && !(o.moves || []).map(toID).includes(toID(row.fixedMove)) ? [row.fixedMove, ...(o.moves || [])].slice(0, 4) : (o.moves || []).slice(), nature: o.nature || 'Hardy', evs: ev, ivs: iv, level: o.level || 100, gender: '' };
  }

  function validateTeam(sets) {
    const errors = [];
    if (!Array.isArray(sets) || sets.length !== TEAM_SIZE) errors.push(`포켓몬 ${TEAM_SIZE}마리를 골라야 합니다.`);
    const bases = new Set();
    (sets || []).forEach((s, i) => {
      const who = `${i + 1}번째`;
      const sp = dex.species.get(s.species);
      if (!sp.exists) { errors.push(`${who}: 알 수 없는 포켓몬 ${s.species}`); return; }
      const baseKey = toID(sp.baseSpecies || sp.name);
      if (bases.has(baseKey)) errors.push(`${who}: 같은 종류의 포켓몬은 한 파티에 한 마리만 넣을 수 있습니다 (${koName('species', sp.id)}).`);
      bases.add(baseKey);
      if (!byId.has(sp.id)) errors.push(`${who}: ${josa(koName('species', sp.id), '은/는')} 고를 수 없는 포켓몬입니다.`);
      if (!s.moves || s.moves.length < 1 || s.moves.length > 4) errors.push(`${who}: 기술은 1~4개여야 합니다.`);
      const can = learnable(sp.id);
      for (const m of s.moves || []) if (!can.has(toID(m))) errors.push(`${who}: ${josa(koName('species', sp.id), '은/는')} ${josa(koName('move', m), '을/를')} 배울 수 없습니다.`);
      if (new Set((s.moves || []).map(toID)).size !== (s.moves || []).length) errors.push(`${who}: 같은 기술이 겹칩니다.`);
      if (!Object.values(sp.abilities).map(toID).includes(toID(s.ability))) errors.push(`${who}: ${koName('species', sp.id)} 의 특성이 될 수 없습니다 (${koName('ability', s.ability)}).`);
      const row = byId.get(sp.id);
      if (row && row.fixedItem && toID(s.item) !== row.fixedItem) errors.push(`${who}: ${josa(koName('species', sp.id), '은/는')} ${josa(koName('item', row.fixedItem), '을/를')} 들고 있어야 합니다.`);
      if (row && row.fixedMove && !(s.moves || []).map(toID).includes(toID(row.fixedMove))) errors.push(`${who}: ${josa(koName('species', sp.id), '은/는')} ${josa(koName('move', row.fixedMove), '을/를')} 배우고 있어야 합니다.`);
      if (s.item) {
        const it = dex.items.get(s.item);
        if (!it.exists) errors.push(`${who}: 알 수 없는 도구 ${s.item}`);
        else if (it.megaStone && toID(Object.keys(it.megaStone)[0]) !== baseKey) errors.push(`${who}: ${josa(koName('item', it.id), '은/는')} ${josa(koName('species', sp.id), '이/가')} 쓸 수 없는 메가스톤입니다.`);
      }
      const evs = STATS.map(k => (s.evs && s.evs[k]) || 0);
      if (evs.some(v => v < 0 || v > 252) || evs.reduce((a, b) => a + b, 0) > 510) errors.push(`${who}: 노력치는 능력치마다 252, 합계 510 이하여야 합니다.`);
      const ivs = STATS.map(k => (s.ivs && s.ivs[k] !== undefined ? s.ivs[k] : 31));
      if (ivs.some(v => v < 0 || v > 31)) errors.push(`${who}: 개체값은 0~31 이어야 합니다.`);
      if (s.nature && !dex.natures.get(s.nature).exists) errors.push(`${who}: 알 수 없는 성격 ${s.nature}`);
    });
    return { ok: errors.length === 0, errors };
  }

  return {
    roster: () => roster, get: id => byId.get(toID(id)) || null, learnable, itemsFor, megaStonesOf, makeSet, validateTeam,
    moveInfo(id) { const m = dex.moves.get(id); if (!m.exists) return PSEUDO_MOVES[toID(id)] || null; return m.exists ? { id: m.id, name: m.name, ko: koName('move', m.id), type: m.type, typeKo: koName('type', m.type), category: m.category, power: m.basePower, accuracy: m.accuracy === true ? null : m.accuracy, pp: m.pp, priority: m.priority } : null; },
    rosterMode,
  };
}
