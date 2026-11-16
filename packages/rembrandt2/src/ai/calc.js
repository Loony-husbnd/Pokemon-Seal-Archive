/**
 * AI 용 피해 계산. Showdown 의 Pokemon 객체(가려진 세계 안의 것)를 그대로 읽는다.
 * 정확한 계산기가 아니라 '어느 쪽이 얼마나 유리한가'를 가르는 어림 계산이다. (탐색은 실제 시뮬레이터로 굴리므로 여기 오차가 결과를 망치지 않는다)
 */
import { Dex } from '@pkmn/sim';

export const dex = Dex.forGen(9);

const stageMult = s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const sideCond = (side, id) => (side && side.sideConditions && side.sideConditions[id]) || null;

/** 능력 변화·상태이상·도구·특성을 반영한 실효 능력치 */
export function stat(mon, key, field) {
  let v = mon.storedStats[key];
  if (key !== 'hp') v = Math.floor(v * stageMult(mon.boosts[key] || 0));
  const ab = mon.ability, it = mon.item, w = field && field.weather;
  if (key === 'atk') { if (ab === 'hugepower' || ab === 'purepower') v *= 2; if (it === 'choiceband') v *= 1.5; if (mon.status === 'brn' && ab !== 'guts') v *= 0.5; if (mon.status && ab === 'guts') v *= 1.5; }
  if (key === 'spa') { if (it === 'choicespecs') v *= 1.5; }
  if (key === 'def') { if (w === 'snow' && ab === 'snowcloak') v *= 1; if (ab === 'furcoat') v *= 2; }
  if (key === 'spd') { if (it === 'assaultvest') v *= 1.5; if (w === 'sandstorm' && mon.types.includes('Rock')) v *= 1.5; if (w === 'snow' && mon.types.includes('Ice')) v *= 1; }
  if (key === 'spe') {
    if (it === 'choicescarf') v *= 1.5; if (mon.status === 'par') v *= 0.5;
    if (w === 'raindance' && ab === 'swiftswim') v *= 2; if (w === 'sunnyday' && ab === 'chlorophyll') v *= 2; if (w === 'sandstorm' && ab === 'sandrush') v *= 2; if (w === 'snow' && ab === 'slushrush') v *= 2;
  }
  return Math.max(1, v);
}

/** 이 포켓몬이 지금 상대보다 먼저 움직이는가 (우선도 제외, 트릭룸 반영) */
export function outspeeds(a, b, field, sideA, sideB) {
  let sa = stat(a, 'spe', field), sb = stat(b, 'spe', field);
  if (sideCond(sideA, 'tailwind')) sa *= 2; if (sideCond(sideB, 'tailwind')) sb *= 2;
  const tr = field && field.pseudoWeather && field.pseudoWeather.trickroom;
  return tr ? sa < sb : sa > sb;
}

// 상대 공격을 받지 않는 특성: 특성 → 면역이 되는 타입
const ABSORB = { levitate: 'Ground', flashfire: 'Fire', waterabsorb: 'Water', stormdrain: 'Water', dryskin: 'Water', voltabsorb: 'Electric', lightningrod: 'Electric', motordrive: 'Electric', sapsipper: 'Grass', eartheater: 'Ground', wellbakedbody: 'Fire' };
const SOUND_IMMUNE = 'soundproof', BALL_IMMUNE = 'bulletproof';

/** 타입 상성 배율 (면역 0) */
export function effectiveness(moveType, def) {
  if (!dex.getImmunity(moveType, def.types)) return 0;
  return 2 ** dex.getEffectiveness(moveType, def.types);
}

function basePower(att, def, move, field) {
  if (move.basePower) {
    let bp = move.basePower;
    if (move.multihit) bp *= Array.isArray(move.multihit) ? (move.multihit[0] === 2 && move.multihit[1] === 5 ? (att.ability === 'skilllink' ? 5 : 3.1) : (move.multihit[0] + move.multihit[1]) / 2) : move.multihit;
    return bp;
  }
  switch (move.id) {
    case 'gyroball': return Math.min(150, Math.floor(25 * stat(def, 'spe', field) / stat(att, 'spe', field)) + 1);
    case 'electroball': { const r = stat(att, 'spe', field) / stat(def, 'spe', field); return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; }
    case 'eruption': case 'waterspout': case 'dragonenergy': return Math.max(1, Math.floor(150 * att.hp / att.maxhp));
    case 'reversal': case 'flail': return 60;
    case 'lowkick': case 'grassknot': case 'heavyslam': case 'heatcrash': case 'crushgrip': case 'wringout': return 80;
    case 'return': case 'frustration': return 102;
    default: return 60;
  }
}

/**
 * 피해 어림값. { min, max, avg, hit, eff } 는 모두 '실제 HP 포인트'. hit = 명중률(0~1)
 * field = battle.field, attSide/defSide = battle.sides[i]
 */
export function damage(att, def, move, field, attSide, defSide) {
  if (move.category === 'Status') return { min: 0, max: 0, avg: 0, hit: 1, eff: 1 };
  const eff = effectiveness(move.type, def);
  const acc = move.accuracy === true ? 1 : (move.accuracy || 100) / 100;
  const hit = move.ohko ? 0.3 : acc;
  if (eff === 0) return { min: 0, max: 0, avg: 0, hit, eff };
  const ab = def.ability;
  if (ABSORB[ab] === move.type && !(att.ability === 'moldbreaker' || att.ability === 'teravolt' || att.ability === 'turboblaze')) return { min: 0, max: 0, avg: 0, hit, eff: 0 };
  if (ab === 'wonderguard' && eff <= 1) return { min: 0, max: 0, avg: 0, hit, eff: 0 };
  if (move.flags && move.flags.sound && ab === SOUND_IMMUNE) return { min: 0, max: 0, avg: 0, hit, eff: 0 };
  if (move.flags && move.flags.bullet && ab === BALL_IMMUNE) return { min: 0, max: 0, avg: 0, hit, eff: 0 };
  if (move.ohko) return { min: def.hp, max: def.hp, avg: def.hp, hit, eff };
  if (move.damage) { const d = move.damage === 'level' ? att.level : Number(move.damage) || 0; return { min: d, max: d, avg: d, hit, eff }; }
  if (move.id === 'superfang' || move.id === 'naturesmadness') { const d = Math.floor(def.hp / 2); return { min: d, max: d, avg: d, hit, eff }; }

  const phys = move.category === 'Physical';
  let atkKey = phys ? 'atk' : 'spa', defKey = phys ? 'def' : 'spd';
  if (move.id === 'bodypress') atkKey = 'def'; if (move.id === 'psyshock' || move.id === 'psystrike' || move.id === 'secretsword') defKey = 'def';
  const attacker = move.id === 'foulplay' ? def : att;
  const A = stat(attacker, atkKey, field), D = stat(def, defKey, field);
  let bp = basePower(att, def, move, field);
  if (att.ability === 'technician' && bp <= 60) bp *= 1.5;
  const L = att.level || 100;
  let dmg = Math.floor(Math.floor(Math.floor(2 * L / 5 + 2) * bp * A / D) / 50) + 2;

  const w = field && field.weather;
  if (w === 'raindance') { if (move.type === 'Water') dmg *= 1.5; else if (move.type === 'Fire') dmg *= 0.5; }
  if (w === 'sunnyday') { if (move.type === 'Fire') dmg *= 1.5; else if (move.type === 'Water') dmg *= 0.5; }
  const terr = field && field.terrain;
  if (terr === 'electricterrain' && move.type === 'Electric') dmg *= 1.3;
  if (terr === 'grassyterrain' && move.type === 'Grass') dmg *= 1.3;
  if (terr === 'psychicterrain' && move.type === 'Psychic') dmg *= 1.3;
  if (terr === 'mistyterrain' && move.type === 'Dragon') dmg *= 0.5;
  const stab = att.types.includes(move.type) ? (att.ability === 'adaptability' ? 2 : 1.5) : 1;
  dmg *= stab * eff;
  if (att.status === 'brn' && phys && att.ability !== 'guts' && move.id !== 'facade') dmg *= 0.5;
  if (defSide) {
    const scr = sideCond(defSide, 'auroraveil') || sideCond(defSide, phys ? 'reflect' : 'lightscreen');
    if (scr && att.ability !== 'infiltrator') dmg *= 2 / 3;
  }
  // 도구·특성 (알려진 주요한 것만)
  const it = att.item;
  if (it === 'lifeorb') dmg *= 1.3; if (it === 'expertbelt' && eff > 1) dmg *= 1.2; if (it === 'muscleband' && phys) dmg *= 1.1; if (it === 'wiseglasses' && !phys) dmg *= 1.1;
  if (ab === 'thickfat' && (move.type === 'Fire' || move.type === 'Ice')) dmg *= 0.5;
  if ((ab === 'multiscale' || ab === 'shadowshield') && def.hp === def.maxhp) dmg *= 0.5;
  if ((ab === 'filter' || ab === 'solidrock' || ab === 'prismarmor') && eff > 1) dmg *= 0.75;
  if (ab === 'fluffy' && move.flags && move.flags.contact) dmg *= 0.5;
  if (def.item === 'eviolite' && dex.species.get(def.species.id).nfe) dmg *= 1;
  if (def.item === 'assaultvest' && !phys) dmg *= 1;
  dmg = Math.max(1, dmg);
  return { min: Math.floor(dmg * 0.85), max: Math.floor(dmg), avg: Math.floor(dmg * 0.925), hit, eff };
}

/** 이 선택이 우선도·선제 등을 포함해 상대보다 먼저 쓰이는가 */
export function movesFirst(att, def, move, foeMove, field, attSide, defSide) {
  const pa = move ? (move.priority || 0) : 0, pb = foeMove ? (foeMove.priority || 0) : 0;
  if (pa !== pb) return pa > pb;
  return outspeeds(att, def, field, attSide, defSide);
}
