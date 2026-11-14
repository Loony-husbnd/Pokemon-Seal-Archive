/**
 * 파티 규칙과 상대 파티 생성 (3단계)
 *
 *   const P = BattleParty.create(BATTLE_DATA);
 *   P.validate([6, 25, 9])                    → { ok, total, cap, errors:[] }   (3마리·종 중복 없음·종족값 합계 ≤ 상한)
 *   P.generateOpponent({ playerIds, level, rng })   → 포켓몬 데이터 ID 3개 (플레이어 파티 종족값 합계에 맞춤)
 *   P.displayName(id)                         → '메가리자몽X', '알로라 라이츄' 등 표시 이름
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

    return { validate, generateOpponent, displayName, speciesLabel, total, cap, pool, OFFSET };
  }

  global.BattleParty = { create, CAP, OFFSET };
})(typeof window !== 'undefined' ? window : globalThis);
