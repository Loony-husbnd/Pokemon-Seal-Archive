/**
 * 세트 짜기: 포켓몬 한 마리에게 쓸 만한 기술 4개·특성·도구를 정한다.
 * 능력치는 이 게임의 기본(Lv.100 · 개체값 31 · 노력치 0 · 무보정)이다. 노력치 체계가 들어오면 여기에 배분을 더한다.
 */
import { dex } from '../ai/calc.js';
import { toID } from '../ko.js';

// 특성의 전투 가치(없으면 1). 일반적으로 강하다고 알려진 것만 올린다.
const ABILITY_VALUE = {
  hugepower: 5, purepower: 5, speedboost: 4, protean: 3.5, libero: 3.5, multiscale: 3.5, shadowshield: 3.5, intimidate: 3, regenerator: 3, magicguard: 3, moxie: 3, beastboost: 3,
  orichalcumpulse: 4, hadronengine: 4, intrepidsword: 2, dauntlessshield: 2, thickfat: 2.5, unaware: 2.5, prankster: 3, technician: 2.5, skilllink: 3, guts: 2.5, adaptability: 3,
  drought: 2.5, drizzle: 2.5, sandstream: 2.5, snowwarning: 2.5, swiftswim: 2, chlorophyll: 2, sandrush: 2, slushrush: 2, levitate: 2.5, magicbounce: 3, sturdy: 2, filter: 2, solidrock: 2,
  fluffy: 2, ironbarbs: 1.8, roughskin: 1.8, poisonheal: 3, toughclaws: 2.5, sheerforce: 2.5, tintedlens: 2.5, analytic: 1.8, supremeoverlord: 3, goodasgold: 3.5, armortail: 1.5, protosynthesis: 3, quarkdrive: 3,
  wellbakedbody: 2, eartheater: 2.5, flashfire: 1.8, waterabsorb: 1.8, voltabsorb: 1.8, sapsipper: 1.8, lightningrod: 1.5, stormdrain: 1.5, mirrorarmor: 2, defiant: 1.8, competitive: 1.8,
  sharpness: 2.8, strongjaw: 2.5, ironfist: 2.2, reckless: 2.2, hustle: 1, truant: 0.1, slowstart: 0.2, defeatist: 0.2, stall: 0.3, klutz: 0.2, normalize: 0.3, minus: 0.3, plus: 0.3,
  comatose: 2, shadowtag: 3, arenatrap: 3, magnetpull: 2, contrary: 2.5, simple: 1.5, serenegrace: 2, parentalbond: 4, hugepower2: 0,
};
export const abilityValue = id => ABILITY_VALUE[toID(id)] ?? 1;

const UTILITY = {
  swordsdance: 3, nastyplot: 3, calmmind: 3, dragondance: 3.2, quiverdance: 3.4, bulkup: 2.5, shellsmash: 3.4, irondefense: 1.5, agility: 1.8, bellydrum: 1.5, curse: 1.5, tailglow: 3,
  recover: 3, roost: 3, softboiled: 3, slackoff: 3, moonlight: 2.5, synthesis: 2.5, shoreup: 3, wish: 2, rest: 1.5,
  protect: 2, substitute: 1.8, stealthrock: 3, spikes: 1.8, toxicspikes: 1.5, toxic: 2.2, willowisp: 2.2, thunderwave: 2, spore: 3, sleeppowder: 2, glare: 1.8, leechseed: 1.5,
  uturn: 2.2, voltswitch: 2.2, flipturn: 2.2, partingshot: 2, knockoff: 2.5, taunt: 1.5, haze: 1.2, reflect: 1.6, lightscreen: 1.6, auroraveil: 2, trickroom: 1.5, defog: 1.2, rapidspin: 1.5, painsplit: 1.2, teleport: 0.6,
};
const SETUP = new Set(['swordsdance', 'nastyplot', 'calmmind', 'dragondance', 'quiverdance', 'bulkup', 'shellsmash', 'tailglow', 'bellydrum', 'curse', 'agility']);
const HEAL = new Set(['recover', 'roost', 'softboiled', 'slackoff', 'moonlight', 'synthesis', 'shoreup', 'rest']);

const typeMult = (atkType, defTypes) => (dex.getImmunity(atkType, defTypes) ? 2 ** dex.getEffectiveness(atkType, defTypes) : 0);

/** 기술 하나의 공격 가치 (STAB·정확도·반동 등을 반영한 대략값) */
export function attackValue(sp, m) {
  if (m.category === 'Status' || m.isZ || m.isMax) return 0;
  let bp = m.basePower || 0;
  if (!bp) bp = { eruption: 150, waterspout: 150, gyroball: 90, electroball: 80, foulplay: 95, bodypress: 80, lowkick: 70, grassknot: 70, heavyslam: 80, heatcrash: 80, reversal: 60, flail: 60, returnmove: 102 }[m.id] || 0;
  if (!bp) return 0;
  if (m.multihit) bp *= Array.isArray(m.multihit) ? 3 : m.multihit;
  const acc = m.accuracy === true ? 1 : (m.accuracy || 100) / 100;
  let v = bp * acc;
  if (m.flags && m.flags.recharge) v *= 0.4; else if (m.flags && m.flags.charge) v *= 0.6;
  if (m.selfdestruct || m.ohko) v *= 0.2;
  if (m.id === 'fakeout' || m.id === 'firstimpression' || m.id === 'suckerpunch' || m.id === 'lastresort' || m.id === 'dreameater' || m.id === 'focuspunch' || m.id === 'beakblast' || m.id === 'shelltrap') v *= 0.35;
  if (m.self && m.self.boosts && Object.values(m.self.boosts).some(n => n < 0)) v *= 0.85;
  if (m.recoil) v *= 0.9;
  if (m.drain) v *= 1.1;
  if (m.priority > 0) v *= 1.15;
  if (m.selfSwitch) v *= 1.05;
  if (sp.types.includes(m.type)) v *= 1.5;
  const phys = sp.baseStats.atk >= sp.baseStats.spa;
  const matches = m.id === 'bodypress' ? true : (m.category === 'Physical') === phys;
  v *= matches ? 1 : 0.35;
  return v;
}

/** 포켓몬 한 마리의 세트. opts: { rng, variety(0=가장 좋은 것, 1=상위에서 무작위), mega(true/false/null), item } */
export function bestSet(D, speciesId, opts = {}) {
  const rng = opts.rng || Math.random, variety = opts.variety ?? 0;
  const row = D.get(speciesId);
  const sp = dex.species.get(speciesId);
  const learn = [...D.learnable(sp.id)].map(id => dex.moves.get(id)).filter(m => m.exists);
  const chosen = [];
  const used = new Set();
  const take = m => { chosen.push(m.id); used.add(m.id); };
  const pickTop = (list, scoreOf) => { const ranked = list.map(m => ({ m, s: scoreOf(m) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s); if (!ranked.length) return null; const k = variety > 0 ? Math.min(ranked.length, 1 + Math.floor(rng() * 2)) : 1; return ranked[Math.floor(rng() * k)].m; };

  if (row && row.fixedMove) take(dex.moves.get(row.fixedMove));
  const covered = new Set();
  // 공격기: 같은 타입이 겹치지 않게 (STAB 은 최대 2개까지 허용)
  const attacks = learn.filter(m => m.category !== 'Status');
  const wantAttacks = 3;
  for (let n = 0; n < wantAttacks && chosen.length < 4; n++) {
    const m = pickTop(attacks.filter(x => !used.has(x.id)), x => attackValue(sp, x) * (covered.has(x.type) ? (sp.types.includes(x.type) && [...covered].filter(t => sp.types.includes(t)).length < 2 ? 0.7 : 0.45) : 1));
    if (!m) break; take(m); covered.add(m.type);
  }
  // 변화기 한 칸: 가치가 높은 것 (공격 성향에 맞는 능력 상승 · 회복 · 함정 · 상태이상)
  const phys = sp.baseStats.atk >= sp.baseStats.spa, bulky = sp.baseStats.hp + sp.baseStats.def + sp.baseStats.spd > 300;
  const statusPick = pickTop(learn.filter(m => UTILITY[m.id] && !used.has(m.id)), m => {
    let s = UTILITY[m.id];
    if (SETUP.has(m.id)) { const b = m.boosts || (m.self && m.self.boosts) || {}; const mine = phys ? (b.atk || 0) : (b.spa || 0); s *= mine > 0 || b.spe > 0 && b.def > 0 ? 1 : 0.3; if (bulky && HEAL.size) s *= 1; }
    if (HEAL.has(m.id) && !bulky) s *= 0.6;
    if (m.id === 'stealthrock' && opts.noHazards) s *= 0.2;
    return s;
  });
  if (statusPick && chosen.length < 4) take(statusPick);
  // 남는 칸은 가장 좋은 공격기로
  while (chosen.length < 4) {
    const m = pickTop(attacks.filter(x => !used.has(x.id)), x => attackValue(sp, x)) || pickTop(learn.filter(x => !used.has(x.id)), x => UTILITY[x.id] || 0.1);
    if (!m) break; take(m);
  }

  // 특성
  const abilities = Object.values(sp.abilities).map(a => ({ a, v: abilityValue(a) + (variety > 0 ? rng() * 0.6 : 0) }));
  abilities.sort((x, y) => y.v - x.v);
  const ability = abilities[0].a;

  // 도구
  const stones = D.megaStonesOf(sp.baseSpecies ? dex.species.get(sp.baseSpecies).id : sp.id);
  let item = '';
  const fixed = row && row.fixedItem;
  if (fixed) item = dex.items.get(fixed).name;
  else if (opts.item !== undefined) item = opts.item;
  else if (stones.length && opts.mega !== false) item = dex.items.get(stones[Math.floor(rng() * stones.length)].item).name;
  else {
    const atkMoves = chosen.map(id => dex.moves.get(id)).filter(m => m.category !== 'Status');
    const setup = chosen.some(id => SETUP.has(id)), recovers = chosen.some(id => HEAL.has(id));
    if (recovers || (bulky && !setup)) item = bulky && atkMoves.length === chosen.length ? 'Assault Vest' : 'Leftovers';
    else if (atkMoves.length === chosen.length && sp.baseStats.spe >= 90 && variety > 0 && rng() < 0.3) item = 'Choice Scarf';
    else if (atkMoves.length === chosen.length && phys && atkMoves.length >= 3) item = 'Choice Band';
    else if (atkMoves.length === chosen.length && !phys && atkMoves.length >= 3) item = 'Choice Specs';
    else item = 'Life Orb';
    if (!D.itemsFor(sp.id).some(i => i.name === item)) item = 'Leftovers';
  }
  return D.makeSet({ species: sp.name, moves: chosen, ability, item });
}

/** 팀 전체의 강도 어림 (종족값 합계) */
export const teamBst = (D, ids) => ids.reduce((s, id) => s + (D.get(id) ? D.get(id).bst : 0), 0);
