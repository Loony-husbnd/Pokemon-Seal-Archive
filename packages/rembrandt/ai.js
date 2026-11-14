/**
 * 배틀 AI (3단계) — 규칙 기반, 외부 API 불필요
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

    /** 변화기 한 개의 점수. 무효(실패·면역)면 -1 */
    function statusScore(me, foe, mv, meFaster, c) {
      const fx = mv.fx || {};
      const foeHit = bestOf(foe, me);                                // 상대가 나에게 줄 기대 피해
      const foeMaxHit = Math.max(0, ...foe.moves.filter(m => m.pp > 0).map(m => E.estimateDamage(foe, me, m).max));
      const doomed = foeMaxHit >= me.hp && !meFaster;                // 이번 턴 안에 쓰러질 가능성이 높다
      const hpFrac = me.hp / me.maxHp;
      let v = 0;

      if (fx.ail || fx.tgt) {                                         // ── 상대에게 거는 기술 ──
        if (foe.fainted) return -1;
        const acc = mv.acc === null || (fx.ail && fx.ail.kind === 'tox' && me.types.includes(4)) ? 1 : mv.acc / 100;
        if (fx.powder && foe.types.includes(12)) return -1;
        if (fx.typeImmune && E.typeMultiplier(mv.type, foe.types) === 0) return -1;
        if (fx.ail) {
          const k = fx.ail.kind;
          if (k === 'cnf' ? foe.confusion > 0 : foe.status) { if (!fx.tgt) return -1; }
          else if (E.statusImmune(foe, k)) { if (!fx.tgt) return -1; }
          else {
            let a = AIL_VALUE[k];
            if (k === 'par') a *= E.effectiveStat(foe, 'spe') > E.effectiveStat(me, 'spe') ? 1.4 : 0.8;
            if (k === 'brn') a *= foe.stats.atk >= foe.stats.spa ? 1.3 : 0.5;
            v += foe.maxHp * a * (0.4 + 0.6 * foe.hp / foe.maxHp);   // 이미 약해진 상대에게는 덜 값지다
          }
        }
        (fx.tgt || []).forEach(s => { v -= stageValue(foe, me, s.stat, s.change); });   // 상대 능력이 내려가면 내 이득
        v *= acc;
      } else {                                                       // ── 자신에게 쓰는 기술 ──
        if (fx.rest) {
          if (me.hp >= me.maxHp || me.status === 'slp') return -1;
          v = (me.maxHp - me.hp) * 0.8 - me.maxHp * 0.3 + (me.status ? me.maxHp * 0.15 : 0);
          if (hpFrac > 0.45) v = Math.min(v, 0);
        }
        if (fx.heal) {
          if (me.hp >= me.maxHp) return -1;
          const amt = Math.min(Math.floor(me.maxHp * fx.heal / 100), me.maxHp - me.hp);
          v = amt * (hpFrac < 0.35 ? 1.05 : hpFrac < 0.6 ? 0.85 : 0.3);
          if (foeHit >= amt) v *= 0.35;                                // 회복량보다 더 많이 맞으면 버티기 싸움에서 진다
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
        }
      }
      if (doomed && !fx.heal && !fx.rest) v *= 0.3;                    // 곧 쓰러질 상황의 준비 동작은 의미가 적다
      return v * c.status;
    }

    /** 사용 가능한 기술의 점수표 */
    function scoreMoves(me, foe, meFaster, level) {
      const c = cfg(level), rows = [];
      me.moves.forEach((mv, index) => {
        if (mv.pp <= 0) return;
        const est = E.estimateDamage(me, foe, mv);
        if (mv.cls === 'status') { rows.push({ index, score: statusScore(me, foe, mv, meFaster, c), est, mv }); return; }
        const acc = accOf(mv), fx = mv.fx || {};
        if (est.eff === 0) { rows.push({ index, score: -1, est, mv }); return; }
        let score = Math.min(est.expected, foe.hp);
        // KO 가능성: 확정 KO(최소 데미지로도) > 난수에 따라 KO
        const kill = est.min >= foe.hp ? 1 : est.max >= foe.hp ? 0.5 : 0;
        if (kill) {
          let bonus = foe.maxHp * (0.6 + 0.4 * kill) * acc * c.ko;
          if (mv.pri > 0 && !meFaster) bonus *= 1.8;               // 상대가 더 빠를 때 우선도 KO 는 값지다
          score += bonus;
        }
        if (fx.recoil) score -= est.expected * fx.recoil / 100 * 0.4;
        if (fx.drain && me.hp < me.maxHp * 0.6) score += est.expected * fx.drain / 100 * 0.5;
        if (fx.ail && !foe.status) score += foe.maxHp * 0.05 * fx.ail.chance / 100;
        if (fx.flinch && meFaster) score += foe.maxHp * 0.05 * fx.flinch / 100;
        if (fx.self) fx.self.forEach(s => { if (s.change < 0) score -= est.expected * 0.05 * -s.change * s.chance / 100; });
        rows.push({ index, score, est, mv });
      });
      return rows;
    }

    const bestOf = (me, foe) => {
      let b = 0;
      for (const mv of me.moves) { if (mv.pp > 0) b = Math.max(b, E.estimateDamage(me, foe, mv).expected); }
      return b;
    };

    /** 맞대결 평가: 내가 주는 피해 비율 − 받는 피해 비율 (+선공 보너스). 클수록 유리 */
    function matchup(me, foe) {
      const mine = Math.min(1.5, bestOf(me, foe) / Math.max(1, foe.hp));
      const theirs = Math.min(1.5, bestOf(foe, me) / Math.max(1, me.hp));
      const speedEdge = E.effectiveStat(me, 'spe') > E.effectiveStat(foe, 'spe') ? 0.15 : 0;
      return { value: mine - theirs + speedEdge, mine, theirs };
    }

    function chooseAction(battle, si, level) {
      const c = cfg(level);
      const la = battle.legalActions(si);
      if (la.mustStruggle) return { type: 'move', index: 0, reason: '발버둥' };

      const me = battle.active(si), foe = battle.active(1 - si);
      const meFaster = E.effectiveStat(me, 'spe') >= E.effectiveStat(foe, 'spe');
      const rows = scoreMoves(me, foe, meFaster, level).sort((a, b) => b.score - a.score);
      const top = rows[0];

      // ── 교체 판단 ──
      const m = mem(battle);
      if (c.switchChance > 0 && la.switches.length && battle.turn - m.lastSwitchTurn[si] > 2) {
        const cur = matchup(me, foe);
        const canKoFirst = top && top.est.max >= foe.hp && (meFaster || cur.theirs < 1 || top.mv.pri > 0);
        if (!canKoFirst && cur.value < -0.35) {
          let best = null;
          for (const idx of la.switches) {
            const cand = battle.sides[si].party[idx];
            const mu = matchup(cand, foe);
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
      const alive = [];
      battle.sides[si].party.forEach((mon, i) => { if (!mon.fainted) alive.push(i); });
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
