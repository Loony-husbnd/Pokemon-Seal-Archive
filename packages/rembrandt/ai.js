/**
 * 배틀 AI (3단계) — 규칙 기반, 외부 API 불필요 (변화기 270개 평가 포함)
 *
 *   const ai = BattleAI.create(BattleEngine, { seed: 1 });
 *   ai.chooseAction(battle, 1, 'normal')       → { type:'move', index } | { type:'switch', to }
 *   ai.chooseReplacement(battle, 1, 'normal')  → 파티 인덱스 (기절 후 교체)
 *
 * 난이도(level): 'easy' | 'normal' | 'hard'
 *   쉬움  : 실수가 잦고(최선 기술 55%) 먼저 교체하지 않는다
 *   보통  : 대체로 최선(85%), 확실히 불리할 때만 교체
 *   어려움: 항상 최선 + 선공 KO/우선도/상성 교체까지 계산
 *
 * AI 는 엔진과 별도의 난수(opts.rng 또는 seed)를 쓰므로 엔진의 시드 재현성을 해치지 않는다.
 */
(function (global) {
  'use strict';

  const LEVELS = {
    easy:   { label: '쉬움',   best: 0.55, switchChance: 0,   ko: 0.6, replaceBest: 0.5,  status: 0.7 },
    normal: { label: '보통',   best: 0.85, switchChance: 0.6, ko: 1,   replaceBest: 0.85, status: 1 },
    hard:   { label: '어려움', best: 1,    switchChance: 1,   ko: 1.3, replaceBest: 1,    status: 1.1 },
  };

  function create(E, opts) {
    opts = opts || {};
    const rng = opts.rng || E.mulberry32(opts.seed === undefined ? 1 : opts.seed);
    const memory = new WeakMap();   // battle → { lastSwitchTurn: [-9, -9] }
    const mem = b => { if (!memory.has(b)) memory.set(b, { lastSwitchTurn: [-9, -9] }); return memory.get(b); };
    const cfg = level => LEVELS[level] || LEVELS.normal;

    const accOf = mv => (mv.fx && mv.fx.neverMiss) || mv.acc === null ? 1 : mv.acc / 100;

    // ───────────── 변화기 평가 ─────────────
    // 점수는 공격기와 같은 단위(체력 포인트)로 맞춘다: 변화기 가치 ≈ 그 효과가 가져다줄 체력 비율 × 최대 체력
    const AIL_VALUE = { slp: 0.55, tox: 0.38, par: 0.30, brn: 0.28, psn: 0.20, cnf: 0.18 };
    const hasClass = (mon, cls) => mon.moves.some(m => m.cls === cls && m.pp > 0);
    const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    /** owner 의 stat 이 change 만큼 변할 때 owner 에게 생기는 이득 (체력 포인트, 손해면 음수) */
    function stageValue(owner, opp, stat, change) {
      const cur = owner.stages[stat];
      const eff = clampN(cur + change, -6, 6) - cur;
      if (!eff) return 0;
      let rel = 0, w = 0;
      if (stat === 'atk' || stat === 'spa') {
        const mine = hasClass(owner, stat === 'atk' ? 'phys' : 'spec'), other = hasClass(owner, stat === 'atk' ? 'spec' : 'phys');
        rel = mine ? (other ? 0.55 : 1) : 0.03; w = 0.17;
      } else if (stat === 'def' || stat === 'spd') {
        const theirs = hasClass(opp, stat === 'def' ? 'phys' : 'spec'), other = hasClass(opp, stat === 'def' ? 'spec' : 'phys');
        rel = theirs ? (other ? 0.55 : 1) : 0.1; w = 0.12;
      } else if (stat === 'spe') {
        rel = E.effectiveStat(owner, 'spe') > E.effectiveStat(opp, 'spe') ? 0.3 : 1; w = 0.15;
      } else { rel = 1; w = stat === 'eva' ? 0.07 : 0.06; }
      // 이미 많이 올라가 있으면 가치가 줄고, 깎인 능력을 되돌리거나 올라간 능력을 깎으면 가치가 크다
      const factor = clampN(1 - Math.sign(eff) * cur * 0.22, 0, 1.5);
      return owner.maxHp * w * rel * eff * factor;
    }

    // ───────────── 날씨·함정·벽·지속 효과 등 (2단계 변화기) ─────────────
    const classBest = (owner, opp, cls, ctx) => {
      let b = 0;
      for (const mv of owner.moves) if (mv.pp > 0 && mv.cls === cls) b = Math.max(b, E.estimateDamage(owner, opp, mv, ctx).expected);
      return b;
    };
    const statSum = m => Object.values(m.stats).reduce((a, x) => a + x, 0);
    const GROUND_ROCK_STEEL = [5, 6, 9];

    /** 2단계 변화기의 가치. 해당하지 않는 기술이면 undefined, 쓸 수 없으면 -1 */
    function specialScore(me, foe, mv, meFaster, env) {
      const fx = mv.fx;
      const B = env && env.B, si = env ? env.si : 0;
      const field = B ? B.field : {};
      const mine = B ? B.sides[si].cond : {}, theirs = B ? B.sides[1 - si].cond : {};
      const reserves = s => (B ? B.sides[s].party.filter((m, i) => !m.fainted && i !== B.sides[s].active).length : 1);
      const ctxMe = B ? B.ctx(si) : undefined, ctxFoe = B ? B.ctx(1 - si) : undefined;
      const turnFactor = B ? Math.max(0.5, 1 - B.turn / 30) : 1;
      const hpFrac = me.hp / me.maxHp;

      if (fx.weather) {
        if (field.weather === fx.weather) return -1;
        const gain = bestOf(me, foe, Object.assign({}, ctxMe, { weather: fx.weather })) - bestOf(me, foe, ctxMe);
        const loss = bestOf(foe, me, Object.assign({}, ctxFoe, { weather: fx.weather })) - bestOf(foe, me, ctxFoe);
        let v = (gain - loss) * 3;
        if (fx.weather === 'sand') {
          v += (foe.types.some(t => GROUND_ROCK_STEEL.includes(t)) ? 0 : foe.maxHp / 16 * 3) - (me.types.some(t => GROUND_ROCK_STEEL.includes(t)) ? 0 : me.maxHp / 16 * 3);
        }
        return Math.max(0, v) * 0.6;           // 평균 7턴짜리 배틀에서는 준비하는 한 턴이 아깝다
      }
      if (fx.terrain) {
        if (field.terrain === fx.terrain) return -1;
        const t = fx.terrain;
        const gain = bestOf(me, foe, Object.assign({}, ctxMe, { terrain: t })) - bestOf(me, foe, ctxMe);
        const loss = bestOf(foe, me, Object.assign({}, ctxFoe, { terrain: t })) - bestOf(foe, me, ctxFoe);
        let v = (gain - loss) * 3;
        const myG = B ? B.grounded(me) : true, foeG = B ? B.grounded(foe) : true;
        if (t === 'grassy') v += (myG ? me.maxHp / 16 * 3 : 0) - (foeG ? foe.maxHp / 16 * 3 : 0);
        if (t === 'electric' && foeG && foe.moves.some(m => m.fx.ail && m.fx.ail.kind === 'slp')) v += me.maxHp * 0.1;
        if (t === 'misty' && myG && foe.moves.some(m => m.fx.ail)) v += me.maxHp * 0.1;
        return Math.max(0, v) * 0.6;
      }
      if (fx.room) return meFaster ? -1 : me.maxHp * 0.35;
      if (fx.hazard) {
        const rs = reserves(1 - si);
        if (!rs) return -1;
        const k = fx.hazard;
        if ((k === 'rocks' && theirs.rocks) || (k === 'web' && theirs.web) || (k === 'spikes' && theirs.spikes >= 3) || (k === 'tspikes' && theirs.tspikes >= 2)) return -1;
        const per = { rocks: 0.14, spikes: 0.1 - (theirs.spikes || 0) * 0.015, tspikes: 0.11, web: 0.07 }[k];
        return rs * per * foe.maxHp * turnFactor * 0.55;
      }
      if (fx.defog) {
        const val = (c, mon) => ((c.rocks ? 0.14 : 0) + (c.spikes || 0) * 0.08 + (c.tspikes || 0) * 0.09 + (c.web ? 0.07 : 0)) * mon.maxHp;
        const screens = (theirs.reflect > 0) + (theirs.lightscreen > 0) + (theirs.veil > 0);
        const v = reserves(si) * val(mine, me) + screens * 0.15 * foe.maxHp - reserves(1 - si) * val(theirs, foe);
        return v > 0.03 * me.maxHp ? v : -1;
      }
      if (fx.screen) {
        if (mine[fx.screen] > 0 || (fx.screen === 'veil' && field.weather !== 'snow')) return -1;
        const phys = classBest(foe, me, 'phys', ctxFoe), spec = classBest(foe, me, 'spec', ctxFoe);
        const saved = fx.screen === 'reflect' ? phys / 2 : fx.screen === 'lightscreen' ? spec / 2 : Math.max(phys, spec) / 2;
        return Math.min(saved * 2.5, me.maxHp * 0.5);
      }
      if (fx.side) {
        if (mine[fx.side] > 0) return -1;
        if (fx.side === 'tailwind') return meFaster ? me.maxHp * 0.08 : me.maxHp * 0.3;
        if (fx.side === 'safeguard') return foe.moves.some(m => m.fx.ail) ? me.maxHp * 0.14 : me.maxHp * 0.02;
        return foe.moves.some(m => m.cls === 'status' && m.fx.tgt) ? me.maxHp * 0.1 : me.maxHp * 0.02;     // mist
      }
      if (fx.seed) {
        if (foe.types.includes(12) || foe.seeded || foe.fainted) return -1;
        return Math.min(foe.hp, foe.maxHp * 0.5) * 0.4 * accOf(mv);
      }
      if (fx.taunt) {
        const n = foe.moves.filter(m => m.cls === 'status' && m.pp > 0).length;
        return foe.taunt > 0 || !n ? -1 : foe.maxHp * (0.08 + 0.07 * n);
      }
      if (fx.encore) {
        const last = foe.moves[foe.lastMove];
        if (foe.encore > 0 || !last || last.pp <= 0) return -1;
        return last.cls === 'status' ? foe.maxHp * 0.3 : foe.maxHp * 0.04;
      }
      if (fx.disable) {
        const last = foe.moves[foe.lastMove];
        if (foe.disable > 0 || !last || last.pp <= 0) return -1;
        return last.cls !== 'status' && E.estimateDamage(foe, me, last, ctxFoe).expected >= me.hp * 0.25 ? me.maxHp * 0.15 : me.maxHp * 0.04;
      }
      if (fx.torment) return foe.torment ? -1 : foe.maxHp * 0.06;
      if (fx.yawn) return foe.status || foe.yawn > 0 ? -1 : AIL_VALUE.slp * foe.maxHp * 0.6;
      if (fx.attract) return foe.attract ? -1 : foe.maxHp * 0.2;
      if (fx.nightmare) return foe.status === 'slp' && !foe.nightmare ? foe.maxHp * 0.3 : -1;
      if (fx.trap) return foe.trapped || !reserves(1 - si) ? -1 : foe.maxHp * 0.1;
      if (fx.spite) { const last = foe.moves[foe.lastMove]; return last && last.pp > 0 ? foe.maxHp * 0.03 : -1; }
      if (fx.soak) {
        if (foe.types.length === 1 && foe.types[0] === 11) return -1;
        const fake = Object.assign({}, foe, { types: [11] });
        const v = (bestOf(me, fake, ctxMe) - bestOf(me, foe, ctxMe)) * 2;
        return v > 0 ? v : -1;
      }
      if (fx.perish || fx.splash || fx.dead) return -1;
      if (fx.protect) {
        if (fx.protect === 'endure' || me.protectStreak > 0) return -1;
        if (fx.protect === 'mat' && me.turnsOut > 0) return -1;
        const residual = (['psn', 'tox', 'brn'].includes(foe.status) ? foe.maxHp * 0.1 : 0) + (foe.seeded ? foe.maxHp * 0.1 : 0) + (foe.perish ? foe.maxHp * 0.3 : 0)
          + (foe.yawn > 0 ? foe.maxHp * 0.3 : 0) + (mine.wish ? me.maxHp * 0.3 : 0) + (field.weather === 'sand' && !foe.types.some(t => GROUND_ROCK_STEEL.includes(t)) ? foe.maxHp / 16 : 0)
          + (foe.cursed ? foe.maxHp * 0.2 : 0) + (foe.octolock ? foe.maxHp * 0.1 : 0);
        const foeAtk = foe.moves.filter(m => m.pp > 0 && m.cls !== 'status');
        const k = fx.protect;
        let extra = 0;
        if (['king', 'spiky', 'bunker', 'obstruct', 'silk', 'burning'].includes(k) && foeAtk.some(m => m.contact)) extra = foe.maxHp * (k === 'spiky' ? 0.1 : 0.07);
        if (k === 'quick') extra = foeAtk.some(m => m.pri > 0) ? me.maxHp * 0.25 : -1;
        if (k === 'crafty') extra = foe.moves.some(m => m.cls === 'status' && m.pp > 0) ? me.maxHp * 0.06 : -1;
        if (k === 'wide') extra = foeAtk.some(m => m.fx.hits) ? me.maxHp * 0.15 : -1;
        if (k === 'mat') extra = me.maxHp * 0.12;
        if (extra < 0 && residual <= 0) return -1;
        const v = residual + Math.max(0, extra);
        return v > 0 ? v : -1;
      }
      // ───────────── 3단계 변화기 ─────────────
      let fbMemo = null, mbMemo = null;                         // 필요할 때만 계산한다
      const foeBest = () => (fbMemo === null ? (fbMemo = bestOf(foe, me, ctxFoe)) : fbMemo);
      const meBest = () => (mbMemo === null ? (mbMemo = bestOf(me, foe, ctxMe)) : mbMemo);
      const typeGain = (meT, foeT) => {                         // 타입이 바뀌었을 때 (받는 피해 감소 + 주는 피해 증가) × 2
        const meF = Object.assign({}, me, { types: meT || me.types }), foeF = Object.assign({}, foe, { types: foeT || foe.types });
        return ((foeBest() - bestOf(foe, meF, ctxFoe)) + (bestOf(me, foeF, ctxMe) - meBest())) * 2;
      };
      const ungroundMe = me.types.includes(3) || me.levitate > 0;
      if (fx.pivot) {                                           // 순간이동 · 배턴터치 · 막말내뱉기 · 꼬리자르기 · 썰렁개그
        if (!reserves(si) || me.trapped || me.noRetreat) return -1;
        const danger = foeBest() >= me.hp * 0.55 ? 0.3 : 0.03;
        let v = me.maxHp * danger;
        if (fx.pivot === 'baton') v += Object.values(me.stages).reduce((a, x) => a + Math.max(0, x), 0) * 0.13 * me.maxHp + (me.sub > 0 ? 0.1 * me.maxHp : 0);
        if (fx.pivot === 'shed') { if (me.sub > 0 || hpFrac <= 0.55) return -1; v = me.maxHp * (0.22 + danger * 0.3); }
        (fx.tgt || []).forEach(c => { v -= stageValue(foe, me, c.stat, c.change); });
        if (fx.weather && field.weather !== fx.weather) v += me.maxHp * 0.05;
        return v;
      }
      if (fx.faintSelf === 'wish' || fx.faintSelf === 'dance') {
        const party = B ? B.sides[si].party : [];
        const gain = party.reduce((a, m, i) => a + (!m.fainted && i !== B.sides[si].active ? (m.maxHp - m.hp) + (m.status ? m.maxHp * 0.1 : 0) : 0), 0);
        return reserves(si) && gain > me.maxHp * 0.7 && hpFrac < 0.3 ? gain * 0.8 : -1;
      }
      if (fx.faintSelf === 'memento') {
        const boosted = Object.values(foe.stages).reduce((a, x) => a + Math.max(0, x), 0);
        return hpFrac < 0.3 && (reserves(si)) ? foe.maxHp * (0.25 + 0.05 * boosted) : -1;
      }
      if (fx.revive) {
        const dead = B ? B.sides[si].party.filter(m => m.fainted).length : 0;
        return dead ? me.maxHp * 0.55 * turnFactor : -1;
      }
      if (fx.swallow) {
        if (!me.stock || me.hp >= me.maxHp) return -1;
        return Math.min(me.maxHp - me.hp, me.maxHp * [0, 0.25, 0.5, 1][me.stock]) * (hpFrac < 0.5 ? 1 : 0.4);
      }
      if (fx.stockpile && me.stock >= 3) return -1;
      if (fx.selfTrap && me.noRetreat) return -1;
      if (fx.tidy) {
        const val = (c, mon) => ((c.rocks ? 0.14 : 0) + (c.spikes || 0) * 0.08 + (c.tspikes || 0) * 0.09 + (c.web ? 0.07 : 0)) * mon.maxHp;
        return stageValue(me, foe, 'atk', 1) + stageValue(me, foe, 'spe', 1) + reserves(si) * val(mine, me) - reserves(1 - si) * val(theirs, foe) + (foe.sub > 0 ? me.maxHp * 0.1 : 0);
      }
      if (fx.gravity) {
        if (field.gravity > 0) return -1;
        const v = ((foe.types.includes(3) || foe.levitate > 0) ? 0.2 : 0) + (me.moves.some(m => m.acc && m.acc < 85) ? 0.12 : 0) - (ungroundMe ? 0.15 : 0);
        return v > 0.05 ? v * me.maxHp : -1;
      }
      if (fx.wonder) {
        const sw = (a, d, ctx) => bestOf(a, d, Object.assign({}, ctx, { wonder: true })) - bestOf(a, d, ctx);
        const v = ((field.wonder > 0 ? -1 : 1) * (sw(me, foe, ctxMe) - sw(foe, me, ctxFoe))) * 3;
        return v > 0.04 * me.maxHp ? v * 0.6 : -1;
      }
      if (fx.magicRoom) {
        const sus = (m, c) => ((m.aquaRing ? 1 : 0) + (m.ingrain ? 1 : 0)) * m.maxHp / 16 * 3 + (c.wish ? m.maxHp * 0.25 : 0);
        const d = sus(foe, theirs) - sus(me, mine);
        const v = field.magicRoom > 0 ? -d : d;
        return v > 0.05 * me.maxHp ? v * 0.6 : -1;
      }
      if (fx.sport) {
        const key = fx.sport === 'mud' ? 'mud' : 'waterSport', ty = fx.sport === 'mud' ? 13 : 10;
        if (field[key] > 0) return -1;
        const foeHas = foe.moves.some(m => m.type === ty && m.cls !== 'status'), meHas = me.moves.some(m => m.type === ty && m.cls !== 'status');
        return foeHas && !meHas ? me.maxHp * 0.18 : -1;
      }
      if (fx.ion) return me.types.includes(5) && foe.moves.some(m => m.type === 1 && m.cls !== 'status') ? me.maxHp * 0.3 : -1;
      if (fx.electrify) return meFaster && me.types.includes(5) ? me.maxHp * 0.3 : -1;
      if (fx.fairyLock) return foe.trapped || !reserves(1 - si) ? -1 : foe.maxHp * 0.04;
      if (fx.courtChange) {
        const val = (c, mon) => ((c.rocks ? 0.14 : 0) + (c.spikes || 0) * 0.08 + (c.tspikes || 0) * 0.09 + (c.web ? 0.07 : 0)) * mon.maxHp;
        const scr = c => ((c.reflect > 0) + (c.lightscreen > 0) + (c.veil > 0)) * 0.15 * me.maxHp;
        const v = reserves(1 - si) * val(mine, foe) - reserves(si) * val(theirs, me) + scr(theirs) - scr(mine);
        return v > 0.06 * me.maxHp ? v : -1;
      }
      if (fx.side === 'lucky') return mine.lucky > 0 ? -1 : me.maxHp * 0.05;
      if (fx.mimic || fx.sketch || fx.mirrorMove) {
        const last = foe.moves[foe.lastMove];
        if (!last || last.fx.mimic || last.fx.sketch || last.fx.transform || (fx.mirrorMove && last.fx.mirrorMove)) return -1;
        if (me.moves.some(m => m.id && m.id === last.id)) return -1;
        const worth = last.cls === 'status' ? me.maxHp * 0.1 : E.estimateDamage(me, foe, last, ctxMe).expected;
        return worth * (fx.sketch ? 0.8 : fx.mirrorMove ? 0.9 : 0.6);
      }
      if (fx.copycat) return B && B.lastUsed ? me.maxHp * 0.1 : -1;
      if (fx.assist) return reserves(si) ? me.maxHp * 0.1 : -1;
      if (fx.meFirst) return meFaster && foe.moves.some(m => m.cls !== 'status' && m.pp > 0) ? foeBest() * 1.3 * 0.6 : -1;
      if (fx.naturePower) return meBest() * 0.8;
      if (fx.repeat) {
        const prev = me.moves[me.prevMove];
        return prev && prev.pp > 0 && prev.cls !== 'status' ? E.estimateDamage(me, foe, prev, ctxMe).expected * 0.9 : -1;
      }
      if (fx.copyStages || fx.doodle) {
        let v = 0;
        for (const k of Object.keys(foe.stages)) v += stageValue(me, foe, k, foe.stages[k] - me.stages[k]);
        if (fx.doodle) v += Math.max(0, typeGain(null, null));
        return v > 0.06 * me.maxHp ? v : -1;
      }
      if (fx.swapStages) {
        const keys = fx.swapStages === 'all' ? Object.keys(me.stages) : fx.swapStages;
        let v = 0;
        for (const k of keys) v += stageValue(me, foe, k, foe.stages[k] - me.stages[k]) - stageValue(foe, me, k, me.stages[k] - foe.stages[k]);
        return v > 0.06 * me.maxHp ? v : -1;
      }
      if (fx.invertStages) {
        let v = 0;
        for (const k of Object.keys(foe.stages)) v -= stageValue(foe, me, k, -2 * foe.stages[k]);
        return v > 0.06 * me.maxHp ? v : -1;
      }
      if (fx.clearBoosts) {
        const v = Object.values(foe.stages).reduce((a, x) => a + Math.max(0, x), 0) * 0.1 * foe.maxHp;
        return v > 0.06 * me.maxHp ? v * accOf(mv) : -1;
      }
      if (fx.swapStat) return E.effectiveStat(me, 'spe') < E.effectiveStat(foe, 'spe') && !(me.ov && me.ov.spe) ? me.maxHp * 0.22 : -1;
      if (fx.splitStats) {
        const g = fx.splitStats.reduce((a, k) => a + Math.max(0, (foe.stats[k] - me.stats[k]) / 2 / me.stats[k]), 0);
        return g > 0.15 ? me.maxHp * Math.min(0.4, g) * 0.5 : -1;
      }
      if (fx.ownSwap) {
        const [a, b] = fx.ownSwap, used = hasClass(me, a === 'atk' ? 'phys' : 'spec');
        return !(me.ov && me.ov[a] !== undefined) && used && me.stats[b] > me.stats[a] * 1.3 ? me.maxHp * 0.2 : -1;
      }
      if (fx.psychoShift) return me.status && !foe.status && !E.statusImmune(foe, me.status) ? foe.maxHp * (AIL_VALUE[me.status] || 0.2) + me.maxHp * 0.2 : -1;
      if (fx.statusSwap) {
        const d = (AIL_VALUE[me.status] || 0) * me.maxHp - (AIL_VALUE[foe.status] || 0) * foe.maxHp;
        return d > 0.1 * me.maxHp && !(me.status && E.statusImmune(foe, me.status)) ? d : -1;
      }
      if (fx.embargo) {
        const n = foe.moves.filter(m => m.cls === 'status' && m.pp > 0 && (m.fx.self || []).some(c => c.change > 0)).length;
        return foe.embargo > 0 || !n ? -1 : foe.maxHp * 0.06 * n;
      }
      if (fx.healBlock) {
        const heals = foe.moves.some(m => m.fx.heal || m.fx.rest || m.fx.wish) || foe.aquaRing || foe.ingrain || (me.hp < me.maxHp && false);
        return foe.healBlock > 0 ? -1 : heals ? foe.maxHp * 0.12 : foe.maxHp * 0.02;
      }
      if (fx.simple) {
        let v = 0;
        for (const k of Object.keys(foe.stages)) v -= stageValue(foe, me, k, foe.stages[k]);
        return foe.simple || v < 0.06 * me.maxHp ? -1 : v;
      }
      if (fx.insomnia) return -1;
      if (fx.recycle) { const last = me.moves[me.prevMove]; return last && last.maxPp - last.pp >= 3 ? me.maxHp * 0.03 : -1; }
      if (fx.typeChange) {
        const k = fx.typeChange; let best = 0;
        const cands = [];
        if (k === 'move') me.moves.forEach(m => { if (m !== mv && m.type && !me.types.includes(m.type)) cands.push([m.type]); });
        else if (k === 'resist') {
          const last = foe.moves[foe.lastMove];
          if (last && last.type) for (let t = 1; t <= 18; t++) if (E.typeMultiplier(last.type, [t]) < 1 && !me.types.includes(t)) cands.push([t]);
        } else if (k === 'terrain') cands.push([{ electric: 13, grassy: 12, misty: 18, psychic: 14 }[field.terrain] || 1]);
        else if (k === 'mirror') cands.push(foe.types.slice());
        for (const t of cands) best = Math.max(best, typeGain(t, null));
        return best > 0.06 * me.maxHp ? best * 0.8 : -1;
      }
      if (fx.addType || fx.setType || fx.giveTypes || fx.swapTypes || fx.rolePlay) {
        if (fx.addType) { if (foe.types.includes(fx.addType)) return -1; const v = typeGain(null, foe.types.slice(0, 2).concat(fx.addType)); return v > 0.06 * me.maxHp ? v * accOf(mv) : -1; }
        if (fx.setType) { const v = typeGain(null, [fx.setType]); return v > 0.06 * me.maxHp ? v * accOf(mv) : -1; }
        if (fx.giveTypes) { const v = typeGain(null, me.types.slice()); return v > 0.06 * me.maxHp ? v * accOf(mv) : -1; }
        if (fx.swapTypes) { const v = typeGain(foe.types.slice(), me.types.slice()); return v > 0.06 * me.maxHp ? v * accOf(mv) : -1; }
        const v = typeGain(me.types.includes(foe.types[0]) ? me.types : [me.types[0], foe.types[0]], null);
        return v > 0.06 * me.maxHp ? v : -1;
      }
      if (fx.levitate) return !ungroundMe && !(B && field.gravity > 0) && foe.moves.some(m => m.type === 5 && m.cls !== 'status' && m.pp > 0) ? me.maxHp * 0.25 : -1;
      if (fx.telekinesis) return foe.float > 0 || (B && field.gravity > 0) || !me.moves.some(m => m.acc && m.acc < 80) ? -1 : me.maxHp * 0.1;
      if (fx.foresight) {
        const ghost = fx.foresight === 'ghost', t = ghost ? 8 : 17;
        const key = ghost ? 'fsG' : 'fsD';
        if (foe[key]) return -1;
        const blocked = foe.types.includes(t) && me.moves.some(m => (ghost ? (m.type === 1 || m.type === 2) : m.type === 14) && m.cls !== 'status');
        return blocked ? me.maxHp * 0.25 : foe.stages.eva > 0 ? me.maxHp * 0.15 : -1;
      }
      if (fx.lockOn) return me.lockOn > 0 || !me.moves.some(m => m.cls !== 'status' && m.acc && m.acc < 90) ? -1 : me.maxHp * 0.08;
      if (fx.laserFocus) return me.laserFocus > 0 ? -1 : me.maxHp * 0.06;
      if (fx.curse) {
        if (me.types.includes(8)) return foe.cursed || hpFrac < 0.6 || foe.fainted ? -1 : Math.max(-1, foe.maxHp * 0.3 - me.maxHp * 0.45) > 0 ? foe.maxHp * 0.3 - me.maxHp * 0.45 : -1;
        const v = stageValue(me, foe, 'atk', 1) + stageValue(me, foe, 'def', 1) + stageValue(me, foe, 'spe', -1);
        return v > 0.04 * me.maxHp ? v * (0.5 + 0.5 * hpFrac) : -1;
      }
      if (fx.destinyBond) return hpFrac < 0.4 ? foe.maxHp * 0.4 : -1;
      if (fx.grudge) return hpFrac < 0.3 ? me.maxHp * 0.05 : -1;
      if (fx.imprison) {
        const n = me.moves.filter(m => m.id && foe.moves.some(x => x.id === m.id)).length;
        return me.imprison || !n ? -1 : me.maxHp * 0.08 * n;
      }
      if (fx.snatch) {
        const n = foe.moves.filter(m => m.snatchable && m.pp > 0 && ((m.fx.self || []).some(c => c.change > 0) || m.fx.heal)).length;
        return n ? me.maxHp * 0.1 * n : -1;
      }
      if (fx.coat) {
        const n = foe.moves.filter(m => m.reflectable && m.pp > 0).length;
        return n ? me.maxHp * 0.1 * n : -1;
      }
      if (fx.dust) return foe.powdered || foe.types.includes(12) || !foe.moves.some(m => m.type === 10 && m.pp > 0) ? -1 : foe.maxHp * 0.25;
      if (fx.octolock) return foe.octolock || foe.trapped || foe.types.includes(8) ? -1 : foe.maxHp * 0.3 * accOf(mv);
      if (fx.nextOrder) return fx.nextOrder > 0 ? (meFaster ? -1 : me.maxHp * 0.12) : (meFaster ? -1 : foe.maxHp * 0.12);
      if (fx.boostNext) return me.boostNext > 0 ? -1 : meBest() * 0.45;

      if (fx.sub) return me.sub > 0 || me.hp <= me.maxHp * 0.3 ? -1 : (hpFrac > 0.6 ? me.maxHp * 0.1 : me.maxHp * 0.03);
      if (fx.painSplit) {
        const avg = Math.floor((me.hp + foe.hp) / 2);
        const gain = avg - me.hp;
        return gain > me.maxHp * 0.15 ? gain + (foe.hp - avg) * 0.5 : -1;
      }
      if (fx.phaze) {
        if (foe.ingrain || !reserves(1 - si)) return -1;
        let v = 0;
        for (const k of Object.keys(foe.stages)) v += Math.max(0, foe.stages[k]) * 0.12 * foe.maxHp;
        v += ((theirs.rocks ? 0.14 : 0) + (theirs.spikes || 0) * 0.08) * foe.maxHp;
        return Math.max(v, foe.maxHp * 0.01);
      }
      if (fx.haze) {
        let v = 0;
        for (const k of Object.keys(foe.stages)) v += Math.max(0, foe.stages[k]) * 0.1 * foe.maxHp;
        for (const k of Object.keys(me.stages)) v += (me.stages[k] < 0 ? -me.stages[k] : -Math.max(0, me.stages[k])) * 0.1 * me.maxHp;
        return v > 0.05 * me.maxHp ? v : -1;
      }
      if (fx.transform) return me.base || foe.base || statSum(foe) <= statSum(me) * 1.15 ? -1 : me.maxHp * 0.5;
      if (fx.metronome) return me.maxHp * 0.15;
      if (fx.sleepTalk) return me.status === 'slp' ? foe.maxHp * 0.3 : -1;
      if (fx.focus) return me.focus ? -1 : me.maxHp * 0.1;
      if (fx.aquaRing || fx.ingrain) {
        if (me.aquaRing && fx.aquaRing || me.ingrain && fx.ingrain) return -1;
        return me.maxHp * 0.2 * (hpFrac < 0.9 ? 1 : 0.5) * (fx.ingrain ? 0.7 : 1);
      }
      if (fx.wish) return mine.wish ? -1 : (hpFrac < 0.65 ? me.maxHp * 0.4 : me.maxHp * 0.05);
      if (fx.cureFoe) return foe.status ? foe.maxHp * 0.15 + Math.min(Math.floor(me.maxHp / 2), me.maxHp - me.hp) : -1;
      if (fx.cure === 'party' && !fx.heal) {
        const party = B ? B.sides[si].party : [me];
        const n = party.filter(m => !m.fainted && (m.status || m.confusion)).length;
        return n ? n * 0.22 * me.maxHp : -1;
      }
      if (fx.cure === 'self' && !fx.heal) return me.status || me.confusion ? me.maxHp * 0.25 : -1;
      if (fx.randStat) return me.maxHp * 0.2 * (0.5 + 0.5 * hpFrac);
      return undefined;
    }

    /** 변화기 한 개의 점수. 무효(실패·면역)면 -1 */
    function statusScore(me, foe, mv, meFaster, c, env) {
      const fx = mv.fx || {};
      const B = env && env.B;
      const weather = B ? B.field.weather : null;
      const foeCtx = B ? B.ctx(1 - env.si) : undefined;
      const foeHit = bestOf(foe, me, foeCtx);                         // 상대가 나에게 줄 기대 피해
      const foeMaxHit = Math.max(0, ...foe.moves.filter(m => m.pp > 0).map(m => E.estimateDamage(foe, me, m, foeCtx).max));
      const doomed = foeMaxHit >= me.hp && !meFaster;                // 이번 턴 안에 쓰러질 가능성이 높다
      const hpFrac = me.hp / me.maxHp;
      let v = 0;

      const sp = specialScore(me, foe, mv, meFaster, env);
      if (sp !== undefined) {
        if (sp < 0) return -1;
        v = sp;
        if (doomed) v *= 0.3;
        return v * c.status;
      }

      if (fx.ail || fx.tgt) {                                         // ── 상대에게 거는 기술 ──
        if (foe.fainted) return -1;
        const acc = mv.acc === null || (fx.ail && fx.ail.kind === 'tox' && me.types.includes(4)) ? 1 : mv.acc / 100;
        if (fx.powder && foe.types.includes(12)) return -1;
        if (fx.typeImmune && E.typeMultiplier(mv.type, foe.types) === 0) return -1;
        if (fx.reqFoeStatus && !fx.reqFoeStatus.includes(foe.status)) return -1;
        if (foe.sub > 0) return -1;
        if (fx.ail) {
          const k = fx.ail.kind;
          if (k === 'cnf' ? foe.confusion > 0 : foe.status) { if (!fx.tgt) return -1; }
          else if (E.statusImmune(foe, k)) { if (!fx.tgt) return -1; }
          else if (B && B.sides[1 - env.si].cond.safeguard > 0) { if (!fx.tgt) return -1; }
          else {
            let a = AIL_VALUE[k];
            if (k === 'par') a *= E.effectiveStat(foe, 'spe') > E.effectiveStat(me, 'spe') ? 1.4 : 0.8;
            if (k === 'brn') a *= foe.stats.atk >= foe.stats.spa ? 1.3 : 0.5;
            v += foe.maxHp * a * (0.4 + 0.6 * foe.hp / foe.maxHp);   // 이미 약해진 상대에게는 덜 값지다
          }
        }
        (fx.tgt || []).forEach(s => { v -= stageValue(foe, me, s.stat, s.change); });   // 상대 능력이 내려가면 내 이득
        if (fx.strengthSap) v += Math.min(E.effectiveStat(foe, 'atk'), me.maxHp - me.hp) * (hpFrac < 0.6 ? 0.9 : 0.3);
        if (fx.tar && me.moves.some(m => m.type === 10 && m.cls !== 'status' && m.pp > 0)) v += foe.maxHp * 0.2;
        v *= acc;
      } else {                                                       // ── 자신에게 쓰는 기술 ──
        if (fx.rest) {
          if (me.hp >= me.maxHp || me.status === 'slp') return -1;
          v = (me.maxHp - me.hp) * 0.8 - me.maxHp * 0.3 + (me.status ? me.maxHp * 0.15 : 0);
          if (hpFrac > 0.45) v = Math.min(v, 0);
        }
        if (fx.heal) {
          if (me.hp >= me.maxHp && !(fx.cure && me.status)) return -1;
          const amt = Math.min(E.healAmountFor(fx, me.maxHp, weather, B ? B.field.terrain : null), me.maxHp - me.hp);
          v = amt * (hpFrac < 0.35 ? 1.05 : hpFrac < 0.6 ? 0.85 : 0.3);
          if (foeHit >= amt) v *= 0.35;                                // 회복량보다 더 많이 맞으면 버티기 싸움에서 진다
          if (fx.cure === 'self' && me.status) v += me.maxHp * 0.2;
        }
        if (fx.hpCost) {
          const cost = me.maxHp * fx.hpCost / 100;
          if (me.hp <= cost) return -1;
          v -= cost * 0.8;
          if (foeMaxHit >= me.hp - cost) v *= 0.15;                    // 체력을 깎은 뒤 한 방에 쓰러진다면 도박이다
        }
        (fx.self || []).forEach(s => { v += stageValue(me, foe, s.stat, s.change); });
        if (fx.self && !fx.heal && !fx.rest) {
          if (v <= 0) return -1;                                       // 더 올릴 수 없거나 손해인 능력 변화
          v *= 0.5 + 0.5 * hpFrac;                                     // 체력이 낮을 때 판돈을 키우지 않는다
          if (fx.charge2) v *= 0.45;                                   // 힘을 모으는 첫 턴이 있다
        }
      }
      if (doomed && !fx.heal && !fx.rest) v *= 0.3;                    // 곧 쓰러질 상황의 준비 동작은 의미가 적다
      return v * c.status;
    }

    /**
     * 특수 공격기의 사용 조건·성공 확률 보정. 돌려주는 값: -1 이면 쓸 수 없다(실패가 확정), 아니면 점수에 곱할 배율.
     * 상대가 이번 턴 무엇을 고를지는 모르므로 '공격기를 고를 확률'을 0.65 로 어림한다.
     */
    function attackAdjust(me, foe, mv, B) {
      const fx = mv.fx || {};
      const foeAtks = foe.moves.filter(m => m.pp > 0 && m.cls !== 'status');
      const field = B ? B.field : {};
      let k = 1;
      if (fx.firstTurn && me.turnsOut > 0) return -1;
      if (fx.reqFoeStatus && !fx.reqFoeStatus.includes(foe.status)) return -1;
      if (fx.onlySleep && me.status !== 'slp') return -1;
      if (fx.needTerrain && !field.terrain) return -1;
      if (fx.dyn === 'spitUp' && !me.stock) return -1;
      if (fx.fixed === 'endeavor' && foe.hp <= me.hp) return -1;
      if (fx.lastResort && !(me.moves.length > 1 && me.moves.every((m, i) => m.fx === fx || me.used[i]))) return -1;
      if (fx.needFoeAttack) { if (!foeAtks.length) return -1; k *= 0.65; }
      if (fx.needFoePriority) { if (!foeAtks.some(m => m.pri > 0)) return -1; k *= 0.5; }
      if (fx.focusPunch) k *= foeAtks.length ? 0.3 : 1;                        // 먼저 맞으면 집중이 깨진다
      if (fx.counter) {
        const cls = fx.counter === 'phys' ? 'phys' : fx.counter === 'spec' ? 'spec' : null;
        if (!foeAtks.some(m => !cls || m.cls === cls)) return -1;
        k *= 0.5;
      }
      if (fx.finalGambit) return -2;                                           // 별도 계산(확정 KO 일 때만)
      return k;
    }

    /** 사용 가능한 기술의 점수표 */
    function scoreMoves(me, foe, meFaster, level, env) {
      const c = cfg(level), rows = [];
      const ctx = env && env.B ? env.B.ctx(env.si) : undefined;
      me.moves.forEach((mv, index) => {
        if (mv.pp <= 0) return;
        if (env && env.la && !env.la.moves[index].usable) return;     // 도발·사슬묶기·앙코르 등으로 쓸 수 없는 기술
        const est = E.estimateDamage(me, foe, mv, ctx);
        if (mv.cls === 'status') { rows.push({ index, score: statusScore(me, foe, mv, meFaster, c, env), est, mv }); return; }
        if (me.status === 'slp' && me.sleepTurns > 1) { rows.push({ index, score: -0.5, est, mv }); return; }   // 잠든 채로는 행동할 수 없다
        const acc = accOf(mv), fx = mv.fx || {};
        if (est.eff === 0) { rows.push({ index, score: -1, est, mv }); return; }
        const adj = attackAdjust(me, foe, mv, env && env.B);
        if (adj === -1) { rows.push({ index, score: -1, est, mv }); return; }
        if (adj === -2) {                                                      // 목숨걸기: 확정으로 쓰러뜨릴 수 있을 때만
          rows.push({ index, score: me.hp >= foe.hp ? foe.hp + foe.maxHp * 0.6 - me.hp * 0.2 : -1, est, mv }); return;
        }
        if (fx.counter) {                                                      // 반격기: 상대가 줄 피해에 비례 (피해량은 실제로 맞아 봐야 안다)
          const cls = fx.counter === 'phys' ? 'phys' : fx.counter === 'spec' ? 'spec' : null;
          const guess = Math.max(0, ...foe.moves.filter(m => m.pp > 0 && m.cls !== 'status' && (!cls || m.cls === cls)).map(m => E.estimateDamage(foe, me, m, env && env.B ? env.B.ctx(1 - env.si) : undefined).expected));
          rows.push({ index, score: Math.min(guess * (cls ? 2 : 1.5), foe.hp) * 0.5, est, mv }); return;
        }
        let score = Math.min(est.expected, foe.hp);
        // KO 가능성: 확정 KO(최소 데미지로도) > 난수에 따라 KO
        const kill = est.min >= foe.hp ? 1 : est.max >= foe.hp ? 0.5 : 0;
        if (kill) {
          let bonus = foe.maxHp * (0.6 + 0.4 * kill) * acc * c.ko;
          if (mv.pri > 0 && !meFaster) bonus *= 1.8;               // 상대가 더 빠를 때 우선도 KO 는 값지다
          score += bonus;
        }
        score *= adj;
        if (fx.recoil) score -= est.expected * fx.recoil / 100 * 0.4;
        if (fx.drain && me.hp < me.maxHp * 0.6) score += est.expected * fx.drain / 100 * 0.5;
        if (fx.ail && !foe.status) score += foe.maxHp * 0.05 * fx.ail.chance / 100;
        if (fx.flinch && meFaster) score += foe.maxHp * 0.05 * fx.flinch / 100;
        if (fx.self) fx.self.forEach(s => { if (s.change < 0) score -= est.expected * 0.05 * -s.change * s.chance / 100; });
        rows.push({ index, score, est, mv });
      });
      return rows;
    }

    const bestOf = (me, foe, ctx) => {
      let b = 0;
      for (const mv of me.moves) { if (mv.pp > 0) b = Math.max(b, E.estimateDamage(me, foe, mv, ctx).expected); }
      return b;
    };

    /** 맞대결 평가: 내가 주는 피해 비율 − 받는 피해 비율 (+선공 보너스). 클수록 유리 */
    function matchup(me, foe, env) {
      const mine = Math.min(1.5, bestOf(me, foe, env && env.mine) / Math.max(1, foe.hp));
      const theirs = Math.min(1.5, bestOf(foe, me, env && env.theirs) / Math.max(1, me.hp));
      const speedEdge = E.effectiveStat(me, 'spe') > E.effectiveStat(foe, 'spe') ? 0.15 : 0;
      return { value: mine - theirs + speedEdge, mine, theirs };
    }

    function chooseAction(battle, si, level) {
      const c = cfg(level);
      const la = battle.legalActions(si);
      if (la.mustStruggle) return { type: 'move', index: 0, reason: '발버둥' };

      const me = battle.active(si), foe = battle.active(1 - si);
      const meFaster = battle.outspeeds ? battle.outspeeds(si) : E.effectiveStat(me, 'spe') >= E.effectiveStat(foe, 'spe');
      const env = { B: battle.ctx ? battle : null, si, la };
      const rows = scoreMoves(me, foe, meFaster, level, env).sort((a, b) => b.score - a.score);
      const top = rows[0];

      // ── 교체 판단 ──
      const m = mem(battle);
      if (c.switchChance > 0 && la.switches.length && battle.turn - m.lastSwitchTurn[si] > 2) {
        const menv = battle.ctx ? { mine: battle.ctx(si), theirs: battle.ctx(1 - si) } : undefined;
        const cur = matchup(me, foe, menv);
        const canKoFirst = top && top.est.max >= foe.hp && (meFaster || cur.theirs < 1 || top.mv.pri > 0);
        if (!canKoFirst && cur.value < -0.35) {
          let best = null;
          for (const idx of la.switches) {
            const cand = battle.sides[si].party[idx];
            const mu = matchup(cand, foe, menv);
            const value = mu.mine - mu.theirs - 0.4 * Math.min(1, mu.theirs);   // 교체하면 한 대 맞는다
            if (!best || value > best.value) best = { idx, value };
          }
          if (best && best.value - cur.value > 0.6 && rng() < c.switchChance) {
            m.lastSwitchTurn[si] = battle.turn;
            return { type: 'switch', to: best.idx, reason: '상성 불리 → 교체' };
          }
        }
      }

      // ── 기술 선택 ──
      if (!rows.length) return { type: 'move', index: 0, reason: '기술 없음' };
      const mistake = rng() > c.best;
      if (mistake) {
        const pool = rows.filter(r => r.score >= 0);
        const pick = (pool.length ? pool : rows)[Math.floor(rng() * (pool.length || rows.length))];
        return { type: 'move', index: pick.index, reason: '실수' };
      }
      // 점수가 거의 같은 기술은 무작위(±4%) — 같은 상황에서 항상 같은 기술만 쓰지 않도록
      const near = rows.filter(r => r.score >= top.score - Math.abs(top.score) * 0.04);   // 음수 점수(전부 무효)도 안전
      const pick = near[Math.floor(rng() * near.length)];
      return { type: 'move', index: pick.index, reason: pick.mv.cls === 'status' ? '변화기' : pick.est.max >= foe.hp ? 'KO 노림' : '최대 피해' };
    }

    function chooseReplacement(battle, si, level) {
      const c = cfg(level);
      const foe = battle.active(1 - si);
      const alive = battle.replaceOptions ? battle.replaceOptions(si).slice() : [];
      if (!battle.replaceOptions) battle.sides[si].party.forEach((mon, i) => { if (!mon.fainted) alive.push(i); });
      if (!alive.length) return -1;
      if (rng() > c.replaceBest) return alive[Math.floor(rng() * alive.length)];
      let best = alive[0], bestV = -Infinity;
      for (const i of alive) {
        const v = matchup(battle.sides[si].party[i], foe).value;
        if (v > bestV) { bestV = v; best = i; }
      }
      return best;
    }

    return { chooseAction, chooseReplacement, matchup, scoreMoves, LEVELS };
  }

  global.BattleAI = { create, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
