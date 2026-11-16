/**
 * 상대 정보 추정. AI 가 아는 것은 공개된 로그뿐이다:
 *   - 팀 미리보기로 상대 파티의 종, 지금까지 쓴 기술, 드러난 특성·도구, 메가진화 여부.
 * 나머지(안 쓴 기술·특성·도구)는 추정해서 채운다. 능력치는 이 게임의 기본(Lv.100 · 개체값 31 · 노력치 0 · 무보정)으로 둔다.
 */
import { dex } from './calc.js';
import { toID } from '../ko.js';

const parseRef = s => { const m = /^p([12])[a-d]?: ?(.*)$/.exec(s || ''); return m ? { side: Number(m[1]) - 1, name: m[2] } : null; };
const flagsOf = parts => { const f = {}; for (const x of parts) { const m = /^\[(\w+)\](?: ?(.*))?$/.exec(x); if (m) f[m[1]] = m[2] === undefined ? true : m[2]; } return f; };
const idOf = s => toID(String(s || '').replace(/^(?:ability|item|move): /, ''));

export function createObserver(mySide) {
  const foe = 1 - mySide, entries = [];
  const o = { entries, cursor: 0 };
  const byName = n => entries.find(e => e.key === n);
  const touch = (name, species) => {
    let e = byName(name);
    if (!e && species) { e = entries.find(x => !x.renamed && toID(x.species) === toID(species)); if (e) { e.key = name; e.renamed = true; } }
    return e;
  };
  o.feed = lines => {
    for (const raw of lines) {
      const p = raw.split('|').slice(1), k = p[0], f = flagsOf(p);
      if (k === 'poke' && p[1] === `p${foe + 1}`) { const sp = p[2].split(',')[0]; entries.push({ key: dex.species.get(sp).baseSpecies || sp, species: sp, form: sp, moves: new Set(), ability: null, item: undefined, itemGone: false, mega: null, renamed: false }); continue; }
      if (k === 'switch' || k === 'drag') { const r = parseRef(p[1]); if (r && r.side === foe) { const e = touch(r.name, p[2].split(',')[0]); if (e) e.form = p[2].split(',')[0]; } continue; }
      if (k === 'detailschange' || k === '-formechange') { const r = parseRef(p[1]); if (r && r.side === foe) { const e = byName(r.name); if (e) e.form = p[2].split(',')[0]; } continue; }
      if (k === 'move') { const r = parseRef(p[1]); if (r && r.side === foe && (!f.from || f.from === 'lockedmove')) { const e = byName(r.name); if (e) e.moves.add(idOf(p[2])); } continue; }
      if (k === '-ability' || k === '-activate') {
        const r = parseRef(p[1]); if (!r || r.side !== foe) continue; const e = byName(r.name); if (!e) continue;
        if (k === '-ability') e.ability = idOf(p[2]); else if (/^ability: /.test(p[2])) e.ability = idOf(p[2]);
        continue;
      }
      if (k === '-damage' || k === '-heal') {
        const r = parseRef(p[1]); const from = f.from ? String(f.from) : ''; if (!r) continue;
        if (r.side === foe && /^item: /.test(from)) { const e = byName(r.name); if (e) e.item = idOf(from); }
        const of = f.of ? parseRef(f.of) : null; if (of && of.side === foe && /^ability: /.test(from)) { const e = byName(of.name); if (e) e.ability = idOf(from); }
        continue;
      }
      if (k === '-item') { const r = parseRef(p[1]); if (r && r.side === foe) { const e = byName(r.name); if (e) e.item = idOf(p[2]); } continue; }
      if (k === '-enditem') { const r = parseRef(p[1]); if (r && r.side === foe) { const e = byName(r.name); if (e) { e.item = idOf(p[2]); e.itemGone = true; } } continue; }
      if (k === '-mega') { const r = parseRef(p[1]); if (r && r.side === foe) { const e = byName(r.name); if (e) { e.mega = idOf(p[3]); e.item = e.mega; } } continue; }
    }
  };
  return o;
}

// ── 상대 셋 추정 ──
const UTILITY = new Set(['recover', 'roost', 'softboiled', 'slackoff', 'moonlight', 'synthesis', 'protect', 'toxic', 'willowisp', 'thunderwave', 'swordsdance', 'nastyplot', 'calmmind', 'dragondance', 'bulkup', 'quiverdance', 'stealthrock', 'spikes', 'substitute', 'taunt', 'knockoff', 'uturn', 'voltswitch', 'leechseed', 'reflect', 'lightscreen']);
const ITEM_PRIOR = [['', 0.7], ['leftovers', 0.15], ['lifeorb', 0.05], ['sitrusberry', 0.1]];

function pickWeighted(list, rng) { const total = list.reduce((a, [, w]) => a + w, 0); let r = rng() * total; for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[list.length - 1][0]; }

function fillMoves(D, sp, known, rng, variant) {
  const out = [...known]; if (out.length >= 4) return out.slice(0, 4);
  const learn = [...D.learnable(sp.id)].filter(id => !known.has(id)).map(id => dex.moves.get(id)).filter(m => m.exists);
  const physical = sp.baseStats.atk >= sp.baseStats.spa;
  const attackScore = m => { if (m.category === 'Status') return 0; let bp = m.basePower || 60; if (m.multihit) bp *= 2.5; const acc = m.accuracy === true ? 1 : (m.accuracy || 100) / 100; if (m.flags && (m.flags.charge || m.flags.recharge)) bp *= 0.6; if (m.selfdestruct) bp *= 0.3; if (m.ohko) bp = 0; const stab = sp.types.includes(m.type) ? 1.5 : 1; const cat = (m.category === 'Physical') === physical ? 1 : 0.4; return bp * acc * stab * cat; };
  const attacks = learn.map(m => ({ m, s: attackScore(m) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const utility = learn.filter(m => UTILITY.has(m.id));
  const takeFrom = (list, n) => { const top = list.slice(0, Math.max(n, 6)); const picked = []; while (picked.length < n && top.length) picked.push(top.splice(Math.floor(rng() * Math.min(top.length, variant === 0 ? 1 : top.length)), 1)[0]); return picked; };
  const atkSlots = Math.min(4 - out.length, Math.max(2, 4 - out.length - (utility.length ? 1 : 0)));
  for (const x of takeFrom(attacks, atkSlots)) out.push(x.m.id);
  while (out.length < 4 && utility.length) { const u = utility.splice(Math.floor(rng() * utility.length * (variant === 0 ? 0.3 : 1)), 1)[0]; if (!out.includes(u.id)) out.push(u.id); }
  for (const x of attacks) { if (out.length >= 4) break; if (!out.includes(x.m.id)) out.push(x.m.id); }
  for (const m of learn) { if (out.length >= 1) break; out.push(m.id); }          // 공격기도 정해진 변화기도 없는 종(딧토 등)은 배우는 기술 아무거나
  return out.slice(0, 4);
}

/** 관찰한 것을 바탕으로 상대 파티 전원의 추정 셋을 만든다. variant 0 은 가장 그럴듯한 하나, 그 밖에는 무작위로 바꿔 가며 뽑는다 */
export function sampleGuess(obs, D, rng, variant = 0) {
  const guess = {};
  for (const e of obs.entries) {
    let sp = dex.species.get(e.form);
    const base = dex.species.get(sp.baseSpecies || sp.name);
    let ability = e.ability, item = e.item;
    if (e.mega) { sp = dex.species.get(e.form); item = e.mega; ability = Object.values(sp.abilities)[0]; }
    else if (!ability) { const ab = sp.abilities; const slots = [[ab[0], 0.4], ab[1] ? [ab[1], 0.4] : null, ab.H ? [ab.H, 0.2] : null].filter(Boolean); ability = toID(variant === 0 ? ab[0] : pickWeighted(slots, rng)); }
    if (item === undefined) {
      const stones = D.megaStonesOf(base.id);
      if (stones.length && rng() < (variant === 0 ? 0 : 0.4)) { const st = stones[Math.floor(rng() * stones.length)]; item = st.item; }
      else item = variant === 0 ? '' : pickWeighted(ITEM_PRIOR, rng);
    } else if (e.itemGone) item = '';
    const known = new Set(e.moves);
    guess[e.key] = { name: e.key, species: sp.name, ability, item, moves: fillMoves(D, base.id === sp.id ? sp : base, known, rng, variant), nature: 'Hardy', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '' };
    if (e.mega) guess[e.key].species = e.form;
  }
  return guess;
}
