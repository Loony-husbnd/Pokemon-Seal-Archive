/**
 * 규칙 기반 판단 (쉬움·보통·어려움, 그리고 지옥 탐색의 후보 좁히기·굴리기 정책).
 * 가려진 세계(world)만 읽는다. 선택지는 world.choices(side) 에서 온 합법 수만 고른다.
 *
 *   decide(world, side, level, rng) → { choice, reason }
 */
import { dex, damage, stat, outspeeds, effectiveness } from './calc.js';

export const LEVELS = {
  easy:   { label: '쉬움',   random: 0.45, switching: 0,    status: 0.4, mega: 0.5, lookahead: false },
  normal: { label: '보통',   random: 0.12, switching: 0.5,  status: 1,   mega: 1,   lookahead: false },
  hard:   { label: '어려움', random: 0,    switching: 1,    status: 1.1, mega: 1,   lookahead: true },
  hell:   { label: '지옥',   random: 0,    switching: 1,    status: 1.1, mega: 1,   lookahead: true, search: true },
};

const alive = side => side.pokemon.filter(p => !p.fainted);
const reservesOf = (side, mon) => side.pokemon.filter(p => !p.fainted && p !== mon);
const moveOf = slot => dex.moves.get(slot.id);

/** mon 이 상대 foe 에게 줄 수 있는 최대 기대 피해(HP 포인트)와 그 기술 */
function bestHit(att, def, field, aSide, dSide, usable) {
  let best = { avg: 0, min: 0, max: 0, move: null };
  for (const slot of att.moveSlots) {
    if (usable && !usable(slot)) continue;
    const m = moveOf(slot); const d = damage(att, def, m, field, aSide, dSide);
    const v = d.avg * d.hit;
    if (!best.move || v > best.avg) best = { avg: v, min: d.min, max: d.max, move: m, hit: d.hit };
  }
  return best;
}

const POWDER = new Set(['sleeppowder', 'stunspore', 'poisonpowder', 'spore']);
function immuneToStatus(foe, status, move) {
  if (foe.status || (foe.volatiles && foe.volatiles.substitute)) return true;
  const t = foe.types;
  if (status === 'par' && (t.includes('Electric') || (t.includes('Ground') && move.type === 'Electric'))) return true;
  if (status === 'brn' && t.includes('Fire')) return true;
  if ((status === 'psn' || status === 'tox') && (t.includes('Poison') || t.includes('Steel')) ) return true;
  if (status === 'frz' && t.includes('Ice')) return true;
  if (POWDER.has(move.id) && t.includes('Grass')) return true;
  if (['insomnia', 'vitalspirit', 'sweetveil'].includes(foe.ability) && status === 'slp') return true;
  if (foe.ability === 'limber' && status === 'par') return true;
  if (foe.ability === 'waterveil' && status === 'brn') return true;
  if (['immunity', 'pastelveil'].includes(foe.ability) && (status === 'psn' || status === 'tox')) return true;
  if (foe.ability === 'magicbounce') return true;
  return false;
}

/** 변화기의 가치(체력 비율 단위). 0 이하면 쓸모없음 */
function statusValue(ctx, move) {
  const { me, foe, b, side, mySide, foeSide, doomed, hpFrac } = ctx; const field = b.field;
  const acc = move.accuracy === true ? 1 : (move.accuracy || 100) / 100;
  let v = 0;
  if (move.status && move.target !== 'self') {
    if (immuneToStatus(foe, move.status, move)) return 0;
    if (foeSide.sideConditions.safeguard) return 0;
    const base = { slp: 0.55, tox: 0.38, par: 0.3, brn: 0.28, psn: 0.2, frz: 0.3 }[move.status] || 0.1;
    let a = base;
    if (move.status === 'par' && outspeeds(foe, me, field, foeSide, mySide)) a *= 1.4;
    if (move.status === 'brn' && foe.storedStats.atk > foe.storedStats.spa) a *= 1.3;
    v += a * (0.4 + 0.6 * foe.hp / foe.maxhp);
  }
  if (move.volatileStatus && move.target !== 'self') {
    if (foe.volatiles[move.volatileStatus]) return 0;
    const vs = move.volatileStatus;
    if (vs === 'confusion') v += 0.15;
    else if (vs === 'leechseed') v += foe.types.includes('Grass') ? 0 : 0.28;
    else if (vs === 'taunt') v += 0.15;
    else if (vs === 'encore' || vs === 'torment' || vs === 'disable') v += 0.08;
    else v += 0.05;
  }
  const own = move.target === 'self' ? move.boosts : move.self && move.self.boosts;
  if (own) {
    let g = 0;
    const phys = me.moveSlots.some(s => moveOf(s).category === 'Physical'), spec = me.moveSlots.some(s => moveOf(s).category === 'Special');
    for (const [k, n] of Object.entries(own)) {
      const cur = me.boosts[k] || 0; if (n > 0 && cur >= 4) continue;
      const w = k === 'atk' ? (phys ? 0.17 : 0.02) : k === 'spa' ? (spec ? 0.17 : 0.02) : k === 'spe' ? (outspeeds(me, foe, field, mySide, foeSide) ? 0.05 : 0.15) : k === 'def' || k === 'spd' ? 0.1 : 0.04;
      g += w * n * Math.max(0.2, 1 - cur * 0.2);
    }
    v += g * (move.id === 'bellydrum' ? (hpFrac > 0.6 ? 1 : 0) : 1);
    if (move.id === 'bellydrum' || move.id === 'shellsmash' && hpFrac < 0.5) v *= 0.5;
  }
  if (move.boosts && move.target !== 'self') {            // 상대 능력을 깎는 기술
    let g = 0; for (const [k, n] of Object.entries(move.boosts)) { const cur = foe.boosts[k] || 0; if (n < 0 && cur <= -4) continue; g += (k === 'atk' || k === 'spa' ? 0.1 : k === 'spe' ? 0.08 : 0.05) * -n; }
    v += g;
  }
  if (move.heal && move.target === 'self' || move.id === 'rest') {
    if (me.hp >= me.maxhp) return 0;
    const amt = (move.heal ? move.heal[0] / move.heal[1] : 1) * (1 - hpFrac);
    v += amt * (hpFrac < 0.4 ? 1.1 : hpFrac < 0.65 ? 0.8 : 0.25);
    if (move.id === 'rest' && me.status === 'slp') return 0;
  }
  if (move.sideCondition) {
    const sc = move.sideCondition;
    const tgtFoe = ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'].includes(sc);
    const rem = alive(foeSide).length - 1;
    if (tgtFoe) { const cur = foeSide.sideConditions[sc]; const layers = cur ? cur.layers || 1 : 0; const max = sc === 'spikes' ? 3 : sc === 'toxicspikes' ? 2 : 1; if (layers >= max || rem <= 0) return 0; v += (sc === 'stealthrock' ? 0.32 : 0.2) * Math.min(1, rem / 2); }
    else if (['reflect', 'lightscreen', 'auroraveil'].includes(sc)) {
      if (mySide.sideConditions[sc] || mySide.sideConditions.auroraveil) return 0;
      const sees = foe.moveSlots.length ? 1 : 1; v += 0.25 * sees * (sc === 'auroraveil' ? 1.1 : 1);
      if (sc === 'auroraveil' && b.field.weather !== 'snow' && b.field.weather !== 'hail') return 0;
    } else if (sc === 'tailwind') { if (mySide.sideConditions.tailwind) return 0; v += outspeeds(me, foe, field, mySide, foeSide) ? 0.05 : 0.22; }
    else v += 0.08;
  }
  if (move.weather) { if (field.weather === move.weather.toLowerCase()) return 0; v += 0.12; }
  if (move.terrain) { if (field.terrain === dex.conditions.get(move.terrain).id) return 0; v += 0.1; }
  if (move.pseudoWeather === 'Trick Room') { v += outspeeds(foe, me, field, foeSide, mySide) ? 0.04 : 0.2; if (field.pseudoWeather && field.pseudoWeather.trickroom) v = outspeeds(me, foe, field, mySide, foeSide) ? 0.25 : 0; }
  if (move.forceSwitch) v += 0.1 + 0.05 * Math.max(0, ...Object.values(foe.boosts));
  if (move.stallingMove) { if (me.volatiles.stall) return 0; v += (ctx.foeThreat > 0 ? 0.12 : 0.03) + (foe.status === 'tox' || foe.volatiles.leechseed ? 0.08 : 0); }
  if (move.id === 'substitute') { if (me.volatiles.substitute || hpFrac < 0.3) return 0; v += 0.2; }
  if (['defog', 'rapidspin', 'courtchange'].includes(move.id)) { const n = Object.keys(mySide.sideConditions).filter(k => ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'].includes(k)).length; v += 0.12 * n; }
  if (move.id === 'wish') v += me.hp < me.maxhp * 0.7 ? 0.2 : 0.05;
  if (move.id === 'painsplit') v += Math.max(0, (foe.hp - me.hp) / me.maxhp) * 0.5;
  if (move.selfSwitch) v += doomed ? 0.2 : 0.05;
  if (v === 0 && !move.status && !move.volatileStatus) v = 0.02;
  v *= acc;
  return v * (doomed ? 0.3 : 1);
}

/** 선택지를 하나 고른다 */
export function decide(world, side, level, rng) {
  const cfg = LEVELS[level] || LEVELS.normal; rng = rng || Math.random;
  const kind = world.kind(side);
  const choices = world.choices(side);
  if (!choices.length) return { choice: null, reason: '대기' };
  if (kind === 'preview') return { choice: choices[0], reason: '미리보기' };
  const b = world.battle, me = b.sides[side].active[0], foe = b.sides[1 - side].active[0];
  const mySide = b.sides[side], foeSide = b.sides[1 - side], field = b.field;
  if (!me || !foe || foe.fainted) return { choice: choices[0], reason: '기본' };

  // 쓰러진 뒤 교체: 상대에게 가장 잘 맞는 포켓몬
  if (kind === 'switch') {
    if (rng() < cfg.random) return { choice: choices[Math.floor(rng() * choices.length)], reason: '실수' };
    let best = null;
    for (const c of choices) { const cand = mySide.pokemon[c.to]; const v = matchup(cand, foe, field, mySide, foeSide); if (!best || v > best.v) best = { c, v }; }
    return { choice: best.c, reason: '교체: 상성' };
  }

  const foeBest = bestHit(foe, me, field, foeSide, mySide);
  const foeFirst = outspeeds(foe, me, field, foeSide, mySide);
  const hpFrac = me.hp / me.maxhp;
  const moveChoices = choices.filter(c => c.type === 'move' && !c.mega), megaChoices = choices.filter(c => c.type === 'move' && c.mega), switches = choices.filter(c => c.type === 'switch');
  const doomed = foeFirst && foeBest.max >= me.hp;           // 상대가 먼저 때려 쓰러뜨릴 수 있다
  const ctx = { me, foe, b, side, mySide, foeSide, doomed, hpFrac, foeThreat: foeBest.avg };

  const rows = [];
  for (const c of moveChoices) {
    const slot = me.moveSlots[c.index]; if (!slot) continue; const m = moveOf(slot);
    let score;
    if (m.category === 'Status') score = statusValue(ctx, m) * cfg.status;
    else {
      const d = damage(me, foe, m, field, mySide, foeSide);
      const first = (m.priority || 0) !== 0 ? (m.priority || 0) > 0 || !foeFirst : !foeFirst;
      let v = Math.min(d.avg * d.hit, foe.hp) / foe.maxhp;
      const ko = d.min >= foe.hp ? 1 : d.max >= foe.hp ? 0.5 : 0;
      if (ko) v += 0.6 * ko * d.hit;
      if (m.recoil) v -= (d.avg * m.recoil[0] / m.recoil[1]) / me.maxhp * 0.5;
      if (m.drain) v += (d.avg * m.drain[0] / m.drain[1]) / me.maxhp * 0.5 * (hpFrac < 0.6 ? 1 : 0.4);
      if (m.self && m.self.boosts) for (const [k, n] of Object.entries(m.self.boosts)) if (n < 0) v += n * 0.03;
      if (m.selfdestruct && !(ko === 1) && hpFrac > 0.25) v *= 0.1;
      if (m.flags && (m.flags.charge || m.flags.recharge)) v *= 0.7;
      if ((m.id === 'fakeout' || m.id === 'firstimpression') && me.activeTurns > 0) v = 0;
      if (m.id === 'suckerpunch' || m.id === 'thunderclap') v *= 0.7;
      if (m.selfSwitch && reservesOf(mySide, me).length) v += doomed ? 0.15 : 0.04;
      if (cfg.lookahead && doomed && !(first && ko === 1)) v *= 0.45;       // 먼저 쓰러지면 못 쓴다 (선공으로 쓰러뜨리는 경우 제외)
      if (d.eff === 0) v = -1;
      score = v;
    }
    rows.push({ c, score, m });
  }
  // 교체 평가: 지금 상성이 나쁘고 더 나은 상대가 있을 때만
  if (switches.length && cfg.switching > 0 && !me.volatiles.partiallytrapped) {
    const stay = rows.length ? Math.max(...rows.map(r => r.score)) : 0;
    const curMatch = matchup(me, foe, field, mySide, foeSide);
    for (const c of switches) {
      const cand = mySide.pokemon[c.to];
      const inc = bestHit(foe, cand, field, foeSide, mySide).avg / cand.maxhp;
      const out = Math.min(bestHit(cand, foe, field, mySide, foeSide).avg, foe.hp) / foe.maxhp;
      let v = out * 0.6 - inc * 0.9 + 0.1;
      v -= hazardCost(cand, mySide);
      const need = doomed ? 0 : cfg.lookahead ? 0.25 : 0.45;           // 이득이 이만큼 커야 바꾼다
      const better = matchup(cand, foe, field, mySide, foeSide) - curMatch;
      if (stay < 0.35 && better > 0.5 && v > stay + need && rng() < cfg.switching) rows.push({ c, score: v, switching: true });
    }
  }
  if (!rows.length) return { choice: choices[0], reason: '기본' };
  rows.sort((x, y) => y.score - x.score);
  let pick = rows[0];
  if (rng() < cfg.random) { const pool = rows.filter(r => r.score >= 0 && !r.switching); pick = (pool.length ? pool : rows)[Math.floor(rng() * (pool.length || rows.length))]; }
  else { const near = rows.filter(r => r.score >= pick.score - Math.abs(pick.score) * 0.04 && !r.switching); if (!pick.switching && near.length) pick = near[Math.floor(rng() * near.length)]; }
  let choice = pick.c;
  if (choice.type === 'move' && megaChoices.length && rng() < cfg.mega) choice = megaChoices.find(m => m.index === choice.index) || megaChoices[0];     // 메가진화는 쓸 수 있으면 바로
  return { choice, reason: pick.switching ? '교체' : pick.score > 0.6 ? 'KO 노림' : '최선', score: pick.score, rows: rows.map(r => ({ choice: r.c, score: r.score })) };
}

/** 두 포켓몬의 맞대결 값: 내가 주는 피해 비율 − 받는 피해 비율 (+선공 보너스) */
function matchup(me, foe, field, mySide, foeSide) {
  const mine = Math.min(1.5, bestHit(me, foe, field, mySide, foeSide).avg / Math.max(1, foe.hp));
  const theirs = Math.min(1.5, bestHit(foe, me, field, foeSide, mySide).avg / Math.max(1, me.hp));
  return mine - theirs + (outspeeds(me, foe, field, mySide, foeSide) ? 0.15 : 0);
}
function hazardCost(mon, side) {
  let c = 0; const sc = side.sideConditions || {};
  if (sc.stealthrock) c += 0.125 * effectiveness('Rock', mon);
  if (sc.spikes && !mon.types.includes('Flying') && mon.ability !== 'levitate') c += [0, 0.125, 0.167, 0.25][sc.spikes.layers || 1];
  return c;
}
export { matchup };
