/**
 * 파티 규칙과 상대 파티 생성 (3단계)
 *
 *   const P = BattleParty.create(BATTLE_DATA);
 *   P.validate([6, 25, 9])                    → { ok, total, cap, errors:[] }   (3마리·종 중복 없음·종족값 합계 ≤ 상한)
 *   P.generateOpponent({ playerIds, level, rng })   → 포켓몬 데이터 ID 3개 (플레이어 파티 종족값 합계에 맞춤)
 *   P.displayName(id)                         → '메가리자몽X', '알로라 라이츄' 등 표시 이름
 *   P.pickMoveset(id, rng)                    → 기술 ID 최대 4개 (공격기 2~3 + 변화기 1~2, 무작위)  ※ Holo 용
 *                                               변화기를 못 배우는 포켓몬은 공격기 그대로. 엔진에는 makeMon(id, { moves }) 로 넘긴다.
 *
 * 상대 파티의 종족값 합계 목표 = 내 파티 합계 + 난이도 보정 (시뮬레이션: 100 차이 ≈ 승률 72%)
 *   쉬움 −120 / 보통 0 / 어려움 +90 (어려움은 상한을 최대 90까지 넘을 수 있다)
 * 전설·환상은 내 파티에 있을 때만 상대에게도 허용한다.
 */
(function (global) {
  'use strict';

  const CAP = 1500;
  const OFFSET = { easy: -120, normal: 0, hard: 90 };
  const REGION = { alola: '알로라', galar: '가라르', hisui: '히스이', paldea: '팔데아' };

  function create(data, opts) {
    opts = opts || {};
    const cap = opts.cap || CAP;
    const P = data.pokemon;

    const speciesLabel = id => P[id].k;

    function displayName(id) {
      const p = P[id];
      if (!p) return String(id);
      const m = /-mega(?:-([xyz]))?$/.exec(p.e);
      if (m) return `메가${p.k}${m[1] ? m[1].toUpperCase() : ''}`;
      for (const key of Object.keys(REGION)) if (p.e.includes(`-${key}`)) return `${REGION[key]} ${p.k}`;
      return p.k;
    }

    // 상대 후보: 기본 포켓몬(1~1025) + 메가/리전폼. 이상한 폼(원시회귀 등)은 제외
    const pool = Object.keys(P).map(Number).filter(id => {
      if (id <= 1025) return true;
      const e = P[id].e;
      if (/-(gmax|eternamax|totem|primal|ultra|starter|cap|belle|libre|phd|pop-star|rock-star|cosplay|original|world|partner)/.test(e)) return false;
      return /-mega(-[xyz])?$/.test(e) || /-(alola|galar|hisui|paldea)(-|$)/.test(e);
    });

    const total = ids => ids.reduce((s, id) => s + P[id].bst, 0);
    const hasLegend = ids => ids.some(id => P[id].leg);

    function validate(ids) {
      const errors = [];
      if (ids.length !== 3) errors.push('포켓몬 3마리를 골라야 합니다.');
      if (new Set(ids.map(id => P[id] && P[id].sp)).size !== ids.length) errors.push('같은 종류의 포켓몬은 한 파티에 한 마리만 넣을 수 있습니다.');
      const t = total(ids.filter(id => P[id]));
      if (t > cap) errors.push(`종족값 합계가 상한(${cap})을 넘었습니다. (${t})`);
      return { ok: errors.length === 0, total: t, cap, errors };
    }

    function generateOpponent(o) {
      const rng = o.rng || Math.random;
      const level = OFFSET[o.level] === undefined ? 'normal' : o.level;
      const playerTotal = total(o.playerIds);
      const allowLegend = hasLegend(o.playerIds);
      const maxTotal = cap + (level === 'hard' ? OFFSET.hard : 0);
      const target = Math.max(750, Math.min(maxTotal, playerTotal + OFFSET[level]));

      const cands = pool.filter(id => allowLegend || !P[id].leg);
      const pick = () => cands[Math.floor(rng() * cands.length)];

      // 합계가 목표에 가까운 서로 다른 3마리를 찾는다 (허용 오차를 점점 넓힘)
      for (let tol = 30; tol <= 400; tol += 30) {
        for (let tries = 0; tries < 4000; tries++) {
          const ids = [pick(), pick(), pick()];
          if (new Set(ids.map(id => P[id].sp)).size < 3) continue;
          if (new Set(ids.map(id => P[id].t[0])).size < 2) continue;       // 같은 속성 3마리는 제외
          if (ids.some(id => P[id].bst > 720)) continue;
          const t = total(ids);
          if (t <= maxTotal && Math.abs(t - target) <= tol) return ids;   // 상한은 절대 넘지 않는다
        }
      }
      // 폴백: 합계가 상한 이하가 될 때까지 가장 약한 쪽으로 다시 뽑는다
      for (let tries = 0; tries < 20000; tries++) {
        const ids = [pick(), pick(), pick()];
        if (new Set(ids.map(id => P[id].sp)).size === 3 && total(ids) <= maxTotal) return ids;
      }
      return [pick(), pick(), pick()];
    }

    // ───────────── 기술 구성 (변화기 포함) ─────────────
    const clamp01 = v => Math.max(0, Math.min(1, v));

    /** 이 포켓몬에게 이 변화기가 얼마나 어울리는지 (0이면 뽑히지 않는다) */
    function statusFit(p, mv) {
      const fx = mv.fx;
      let w;
      if (fx.heal) w = 1;
      else if (fx.rest) w = 0.6;
      else if (fx.self) {
        const rel = { atk: clamp01(p.b[1] / Math.max(p.b[1], p.b[3])) ** 3, spa: clamp01(p.b[3] / Math.max(p.b[1], p.b[3])) ** 3,
          def: 0.6, spd: 0.6, spe: 0.7, acc: 0.3, eva: 0.2 };
        const ups = fx.self.filter(c => c.change > 0);
        w = ups.length ? 1.1 * ups.reduce((a, c) => a + rel[c.stat], 0) / ups.length : 0;
        if (fx.hpCost) w *= 0.5;                                   // 뱃대띠
        if (mv.e === 'growth' || mv.e === 'harden') w *= 0.5;      // 효과가 약한 기술
      } else if (fx.ail && fx.tgt) w = 0.7;                        // 뽐내기·치켜세우기
      else if (fx.ail) w = { slp: 1.1, tox: 1.2, par: 1, brn: 1, psn: 0.7, cnf: 0.5 }[fx.ail.kind] || 0.5;
      else w = 0.35;                                               // 상대 능력을 깎는 기술은 약한 편
      return w;
    }

    /** 같은 역할의 변화기가 한 포켓몬에게 겹치지 않도록 하는 표식 (회복 / 같은 상태이상 / 같은 능력) */
    function roleTokens(mv) {
      const fx = mv.fx, t = [];
      if (fx.heal || fx.rest) t.push('heal');
      if (fx.ail) t.push('ail:' + fx.ail.kind);
      (fx.tgt || []).forEach(c => t.push('foe:' + c.stat));
      (fx.self || []).forEach(c => { if (c.change > 0) t.push('my:' + c.stat); });
      return t;
    }

    function pickMoveset(id, rng) {
      rng = rng || Math.random;
      const p = P[id];
      const attacks = p.m.slice();
      const pool = (p.sm || []).filter(mid => data.moves[mid]);
      if (!pool.length) return attacks;

      const rec = new Set(p.ss || []);                              // Showdown 랜덤배틀 세트에 나오는 기술은 3배 잘 뽑힌다
      let cand = pool.map(mid => ({ mid, mv: data.moves[mid], w: statusFit(p, data.moves[mid]) * (data.moves[mid].w === undefined ? 1 : data.moves[mid].w) * (rec.has(mid) ? 3 : 1) })).filter(c => c.w > 0);
      if (!cand.length) return attacks;

      // 변화기 칸 수: 1~2칸. 공격기가 모자라는 포켓몬(예: 마자용)은 변화기로 채운다
      let slots = rng() < 0.6 ? 1 : 2;
      slots = Math.max(slots, 4 - attacks.length);
      const chosen = [], used = new Set();
      while (chosen.length < slots && cand.length) {
        const total = cand.reduce((a, c) => a + c.w, 0);
        let r = rng() * total, pick = cand[cand.length - 1];
        for (const c of cand) { r -= c.w; if (r <= 0) { pick = c; break; } }
        chosen.push(pick.mid);
        roleTokens(pick.mv).forEach(t => used.add(t));
        cand = cand.filter(c => c !== pick && !roleTokens(c.mv).some(t => used.has(t)));
      }
      return attacks.slice(0, Math.max(0, 4 - chosen.length)).concat(chosen);
    }

    return { validate, generateOpponent, displayName, speciesLabel, pickMoveset, total, cap, pool, OFFSET };
  }

  global.BattleParty = { create, CAP, OFFSET };
})(typeof window !== 'undefined' ? window : globalThis);
