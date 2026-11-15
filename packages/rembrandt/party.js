/**
 * 파티 규칙과 상대 파티 생성 (3단계)
 *
 *   const P = BattleParty.create(BATTLE_DATA);
 *   P.validate([6, 25, 9])                    → { ok, total, errors:[] }   (3마리·종 중복 없음. 종족값 합계 상한은 없다)
 *   P.generateOpponent({ playerIds, level, rng })   → 포켓몬 데이터 ID 3개 (플레이어 파티 종족값 합계에 맞춤)
 *   P.displayName(id)                         → '메가리자몽X', '알로라 라이츄' 등 표시 이름
 *   P.pickMoveset(id, rng)                    → 기술 ID 최대 4개 (공격기 2~3 + 변화기 1~2, 무작위)  ※ Holo 용
 *                                               변화기를 못 배우는 포켓몬은 공격기 그대로. 엔진에는 makeMon(id, { moves }) 로 넘긴다.
 *
 * 상대 파티의 종족값 합계 목표 = 내 파티 합계 + 난이도 보정 (시뮬레이션: 100 차이 ≈ 승률 72%). 상한은 없다.
 *   쉬움 −120 / 보통 0 / 어려움 +90
 * 전설·환상은 내 파티에 있거나, 목표 합계가 2000을 넘을 때만 상대에게도 허용한다.
 */
(function (global) {
  'use strict';

  const LEGEND_FROM = 2000;      // 목표 종족값 합계가 이보다 크면 전설·환상도 상대로 나올 수 있다
  const OFFSET = { easy: -120, normal: 0, hard: 90, hell: 2000 };      // 지옥: 가장 강한 조합(전설 포함)을 고른다
  const STAT_MULT = { hell: 1.5 };                                      // 지옥: 상대 능력치 ×1.5
  const REGION = { alola: '알로라', galar: '가라르', hisui: '히스이', paldea: '팔데아' };

  function create(data, opts) {
    opts = opts || {};
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
      return { ok: errors.length === 0, total: t, errors };
    }

    /**
     * 내 파티 강도(종족값 합계)에 맞춘 상대 3마리. 상한은 없다.
     * 목표 = 내 합계 + 난이도 보정. 한 마리당 평균 종족값 근처의 후보에서 뽑아 높은 목표에도 맞추고,
     * 맞출 수 있는 최대치를 넘는 목표면 가장 강한 후보들 중 가장 가까운 조합을 고른다.
     */
    function generateOpponent(o) {
      const rng = o.rng || Math.random;
      const level = OFFSET[o.level] === undefined ? 'normal' : o.level;
      const playerTotal = total(o.playerIds);
      const target = Math.max(750, playerTotal + OFFSET[level]);
      const allowLegend = hasLegend(o.playerIds) || target > LEGEND_FROM || level === 'hell';     // 높은 목표는 전설 없이 맞출 수 없다

      const sorted = pool.filter(id => allowLegend || !P[id].leg).sort((a, b) => P[a].bst - P[b].bst || a - b);
      const avg = target / 3;
      const near = w => sorted.filter(id => Math.abs(P[id].bst - avg) <= w);
      const valid = ids => new Set(ids.map(id => P[id].sp)).size === 3 && new Set(ids.map(id => P[id].t[0])).size >= 2;   // 같은 속성 3마리는 제외

      // 허용 오차와 후보 범위를 점점 넓혀 가며 목표에 가까운 조합을 찾는다
      for (const w of [150, 260, 420, 700]) {
        const win = near(w);
        if (win.length < 12) continue;
        const pick = () => win[Math.floor(rng() * win.length)];
        for (const tol of [30, 60, 110, 190]) {
          for (let tries = 0; tries < 1500; tries++) {
            const ids = [pick(), pick(), pick()];
            if (valid(ids) && Math.abs(total(ids) - target) <= tol) return ids;
          }
        }
      }
      // 폴백: 가장 강한 후보들 중 목표에 가장 가까운 조합
      const top = sorted.slice(-60), pick = () => top[Math.floor(rng() * top.length)];
      let best = null, bestD = Infinity;
      for (let tries = 0; tries < 12000; tries++) {
        const ids = [pick(), pick(), pick()];
        if (!valid(ids)) continue;
        const d = Math.abs(total(ids) - target);
        if (d < bestD) { bestD = d; best = ids; }
      }
      return best || [pick(), pick(), pick()];
    }

    // ───────────── 기술 구성 (변화기 포함) ─────────────
    const clamp01 = v => Math.max(0, Math.min(1, v));

    /** 효과 종류별 기본 비중 (2단계 변화기). 시뮬레이션 결과로 기술마다의 w 가 따로 곱해진다 */
    const SPECIAL_FIT = {
      dead: 0, splash: 0.02,
      // 3단계
      faintSelf: 0.3, revive: 0.3, pivot: 0.5, gravity: 0.3, wonder: 0.2, magicRoom: 0.15, sport: 0.15, ion: 0.1, electrify: 0.1, fairyLock: 0.1, courtChange: 0.3,
      mimic: 0.1, sketch: 0.1, mirrorMove: 0.15, copycat: 0.1, meFirst: 0.1, assist: 0.1, naturePower: 0.2, repeat: 0.1, copyStages: 0.2, typeChange: 0.15, addType: 0.2, setType: 0.2,
      swapTypes: 0.05, rolePlay: 0.05, giveTypes: 0.05, doodle: 0.05, swapStages: 0.1, invertStages: 0.2, swapStat: 0.05, ownSwap: 0.1, splitStats: 0.1, psychoShift: 0.2, statusSwap: 0.1,
      clearBoosts: 0.2, embargo: 0.1, healBlock: 0.25, simple: 0.05, insomnia: 0.02, recycle: 0.05, levitate: 0.2, telekinesis: 0.05, foresight: 0.15, lockOn: 0.1, laserFocus: 0.15,
      curse: 0.35, destinyBond: 0.25, grudge: 0.05, imprison: 0.15, snatch: 0.1, coat: 0.3, dust: 0.15, octolock: 0.3, nextOrder: 0.1, boostNext: 0.05, tidy: 0.4, selfTrap: 0.5,
      stockpile: 0.5, swallow: 0.4, charge2: 0.5, strengthSap: 0.6, tar: 0.4, metronome: 0.3, sleepTalk: 0.25, perish: 0.1, transform: 6,
      weather: 0.6, terrain: 0.45, room: 0.4, defog: 0.4, seed: 0.8, taunt: 0.7, encore: 0.4, disable: 0.3, torment: 0.2, yawn: 0.5, attract: 0.5,
      nightmare: 0.2, trap: 0.3, spite: 0.15, soak: 0.2, aquaRing: 0.5, ingrain: 0.35, wish: 0.7, focus: 0.2, sub: 0.7, painSplit: 0.3, phaze: 0.5,
      haze: 0.35, cureFoe: 0.5, randStat: 0.5,
    };
    const HAZARD_FIT = { rocks: 1, spikes: 0.6, tspikes: 0.6, web: 0.4 };
    const SCREEN_FIT = { reflect: 0.6, lightscreen: 0.6, veil: 0.2 };
    const SIDE_FIT = { tailwind: 0.7, safeguard: 0.3, mist: 0.2 };

    /** 이 포켓몬에게 이 변화기가 얼마나 어울리는지 (0이면 뽑히지 않는다) */
    function statusFit(p, mv) {
      const fx = mv.fx;
      for (const k of Object.keys(SPECIAL_FIT)) if (fx[k]) return SPECIAL_FIT[k];
      if (fx.hazard) return HAZARD_FIT[fx.hazard];
      if (fx.screen) return SCREEN_FIT[fx.screen];
      if (fx.side) return SIDE_FIT[fx.side];
      if (fx.protect) return { endure: 0.2, maxguard: 0.6, quick: 0.2, crafty: 0.15, wide: 0.1, mat: 0.2 }[fx.protect] || 0.9;
      if (fx.cure) return fx.heal ? 0.6 : fx.cure === 'party' ? 0.4 : 0.3;
      let w;
      if (fx.heal) w = fx.roost || fx.weatherHeal || fx.sandHeal ? 1 : 1;
      else if (fx.rest) w = 0.6;
      else if (fx.self) {
        const rel = { atk: clamp01(p.b[1] / Math.max(p.b[1], p.b[3])) ** 3, spa: clamp01(p.b[3] / Math.max(p.b[1], p.b[3])) ** 3,
          def: 0.6, spd: 0.6, spe: 0.7, acc: 0.3, eva: 0.2 };
        const ups = fx.self.filter(c => c.change > 0);
        w = ups.length ? 1.1 * ups.reduce((a, c) => a + rel[c.stat], 0) / ups.length : 0;
        if (fx.hpCost) w *= 0.5;                                   // 뱃대띠 등
        if (mv.e === 'growth' || mv.e === 'harden') w *= 0.5;      // 효과가 약한 기술
      } else if (fx.ail && fx.tgt) w = 0.7;                        // 뽐내기·치켜세우기
      else if (fx.ail) w = { slp: 1.1, tox: 1.2, par: 1, brn: 1, psn: 0.7, cnf: 0.5 }[fx.ail.kind] || 0.5;
      else w = 0.35;                                               // 상대 능력을 깎는 기술은 약한 편
      return w;
    }

    /** 같은 역할의 변화기가 한 포켓몬에게 겹치지 않도록 하는 표식 (회복 / 같은 상태이상 / 같은 능력 / 필드 …) */
    function roleTokens(mv) {
      const fx = mv.fx, t = [];
      if (fx.heal || fx.rest) t.push('heal');
      if (fx.ail) t.push('ail:' + fx.ail.kind);
      (fx.tgt || []).forEach(c => t.push('foe:' + c.stat));
      (fx.self || []).forEach(c => { if (c.change > 0) t.push('my:' + c.stat); });
      if (fx.weather || fx.terrain || fx.room) t.push('field');          // 날씨·필드·트릭룸은 하나만
      if (fx.hazard) t.push('hazard:' + fx.hazard);
      if (fx.screen) t.push('screen');
      if (fx.side) t.push('side:' + fx.side);
      if (fx.protect) t.push('protect');
      if (fx.cure) t.push('cure');
      for (const k of ['seed', 'taunt', 'encore', 'disable', 'torment', 'yawn', 'attract', 'nightmare', 'trap', 'sub', 'phaze', 'haze', 'painSplit', 'defog', 'randStat',
        'pivot', 'faintSelf', 'revive', 'gravity', 'wonder', 'magicRoom', 'sport', 'courtChange', 'typeChange', 'addType', 'setType', 'curse', 'destinyBond', 'imprison', 'coat', 'tidy',
        'stockpile', 'swallow', 'foresight', 'lockOn', 'levitate', 'healBlock', 'octolock', 'embargo', 'clearBoosts', 'invertStages', 'copyStages', 'mimic', 'sketch', 'mirrorMove', 'copycat']) if (fx[k]) t.push(k);
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

    return { validate, generateOpponent, displayName, speciesLabel, pickMoveset, total, pool, OFFSET };
  }

  global.BattleParty = { create, OFFSET, STAT_MULT, statMult: level => [1, STAT_MULT[level] || 1] };
})(typeof window !== 'undefined' ? window : globalThis);
