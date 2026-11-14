/**
 * 포켓몬 배틀 엔진 (2단계) — 화면과 무관한 순수 로직
 *
 * 로드 순서: packages/rembrandt/data/battle-data.js → packages/rembrandt/engine.js
 *   브라우저: window.BattleEngine (기본 데이터로 만든 엔진), window.createBattleEngine(data)
 *   Node(vm): tools/lib/load-battle.mjs 참고
 *
 * 사용 흐름
 *   const E = BattleEngine;
 *   const battle = E.createBattle({
 *     parties: [[E.makeMon(6), E.makeMon(25), E.makeMon(9)], [ ... ]],   // 0 = 나, 1 = 상대
 *     names: ['나', '상대'], seed: 123,
 *   });
 *   battle.start();                                          // 첫 포켓몬 등장 이벤트
 *   battle.legalActions(0);                                  // { moves:[...], switches:[...], mustStruggle }
 *   const events = battle.playTurn({type:'move', index:0}, {type:'move', index:2});
 *   if (battle.phase === 'switch') battle.replace(side, partyIndex);   // 기절 후 교체
 *   battle.phase === 'ended' → battle.winner (0 | 1 | 'draw')
 *
 * 이벤트: { t, text, ... } 배열을 돌려준다. UI 는 t 로 연출을, text 로 한국어 메시지를 쓴다.
 *   turn switch move(cls: phys|spec|status) miss damage(cause: confusion|recoil|cost|상태이상) effective crit hits heal recoil status stage faint text needSwitch end
 *
 * 구현 범위(1차): 데미지 공식(Gen 9, Lv100), 상성, 자속, 급소, 명중/회피, 다단 히트,
 *   풀죽음, 상태이상(화상·마비·독·맹독·잠듦·얼음), 혼란, 능력 단계, 흡수/반동, 발버둥, 교체.
 *   변화기 1단계(cls 'status'): 상대에게 상태이상·능력 하락, 자신의 능력 상승, 체력 회복(잠자기·뱃대띠 포함).
 *   특성·도구·날씨·필드·보호·대타 등 몇 턴 지속되는 효과는 아직 없다.
 *
 * 난수 소비 순서(테스트에서 rng 를 고정할 때 참고): 선공 동률 → [행동 전 판정] → 명중 →
 *   (히트마다: 급소 → 데미지 난수) → 추가효과(풀죽음 → 상태이상 → 능력 변화 순, 확률 판정마다 1회)
 */
(function (global) {
  'use strict';

  const STAT_KO = { atk: '공격', def: '방어', spa: '특수공격', spd: '특수방어', spe: '스피드', acc: '명중률', eva: '회피율' };
  const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
  const FLYING = 3, POISON = 4, GROUND = 5, ROCK = 6, GHOST = 8, STEEL = 9, FIRE = 10, WATER = 11, GRASS = 12, ELECTRIC = 13, PSYCHIC = 14, ICE = 15, DRAGON = 16;
  const STAT_SHORT = { atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드', acc: '명중', eva: '회피' };
  const AIL_KO = { par: '마비', slp: '잠듦', brn: '화상', psn: '독', tox: '맹독', frz: '얼음', cnf: '혼란' };

  /** 회복량 (분수로 계산해 오차가 없게 한다). 달빛류는 날씨에 따라, 모래모으기는 모래바람일 때 늘어난다 */
  function healAmountFor(fx, maxHp, weather) {
    let n = fx.heal, d = 100;
    if (fx.weatherHeal) { if (weather === 'sun') { n = 2; d = 3; } else if (weather) { n = 1; d = 4; } else { n = 1; d = 2; } }
    if (fx.sandHeal) { if (weather === 'sand') { n = 2; d = 3; } else { n = 1; d = 2; } }
    return Math.max(1, Math.floor(maxHp * n / d));
  }

  /** 타입 때문에 걸리지 않는 상태이상 (전기=마비, 불꽃=화상, 얼음=얼음, 독·강철=독) */
  function statusImmune(mon, kind) {
    if (kind === 'par') return mon.types.includes(ELECTRIC);
    if (kind === 'brn') return mon.types.includes(FIRE);
    if (kind === 'frz') return mon.types.includes(ICE);
    if (kind === 'psn' || kind === 'tox') return mon.types.includes(POISON) || mon.types.includes(STEEL);
    return false;
  }

  const WEATHER_KO = { sun: '쾌청', rain: '비', sand: '모래바람', snow: '눈' };
  const TERRAIN_KO = { electric: '일렉트릭필드', grassy: '그래스필드', misty: '미스트필드', psychic: '사이코필드' };
  const HAZARD_KO = { rocks: '상대 쪽에 스텔스록', spikes: '상대 쪽에 압정(최대 3겹)', tspikes: '상대 쪽에 독압정(최대 2겹)', web: '상대 쪽에 끈적네트' };
  const SCREEN_KO = { reflect: '물리 피해 절반 5턴', lightscreen: '특수 피해 절반 5턴', veil: '모든 피해 절반 5턴(눈일 때)' };
  const SIDE_KO = { tailwind: '스피드 2배 4턴', safeguard: '상태이상 방지 5턴', mist: '능력 하락 방지 5턴' };
  const PROTECT_KO = { protect: '이번 턴 공격 막기', endure: '이번 턴 1만 남기고 버티기' };
  const MISC_KO = {
    seed: '씨뿌리기(매 턴 흡수)', taunt: '도발(변화기 봉인)', encore: '앙코르(같은 기술 강제)', disable: '마지막 기술 봉인', torment: '같은 기술 연속 사용 봉인',
    yawn: '다음 턴 잠듦', aquaRing: '매 턴 체력 회복', ingrain: '매 턴 회복 · 교체 불가', wish: '다음 턴 체력 회복', focus: '급소율 크게 상승',
    attract: '헤롱헤롱(절반 확률로 행동 불가)', nightmare: '잠든 상대에게 매 턴 피해', perish: '3턴 뒤 양쪽 쓰러짐', sub: '체력 25%로 대타',
    painSplit: '서로의 체력을 평균', phaze: '상대를 강제 교체', transform: '상대로 변신', splash: '아무 일도 일어나지 않음', haze: '모든 능력 변화 초기화',
    metronome: '무작위 기술 사용', sleepTalk: '잠든 동안 무작위 기술', trap: '상대 교체 불가', spite: '상대 기술 PP 감소', soak: '상대를 물 타입으로',
    room: '느린 쪽이 먼저(5턴)', defog: '함정·벽 제거', cureFoe: '상대 상태이상 제거', randStat: '무작위 능력 크게 상승',
  };

  /** 변화기 효과를 한 줄로 요약한다 (화면용). 예: '상대 마비' · '공격 +2' · '체력 50% 회복' */
  function describeEffect(move) {
    const fx = move.fx || {}, out = [];
    if (fx.weather) out.push(`날씨: ${WEATHER_KO[fx.weather]} 5턴`);
    if (fx.terrain) out.push(`${TERRAIN_KO[fx.terrain]} 5턴`);
    if (fx.hazard) out.push(HAZARD_KO[fx.hazard]);
    if (fx.screen) out.push(SCREEN_KO[fx.screen]);
    if (fx.side) out.push(SIDE_KO[fx.side]);
    if (fx.protect) out.push(PROTECT_KO[fx.protect]);
    for (const k of Object.keys(MISC_KO)) if (fx[k]) out.push(MISC_KO[k]);
    if (fx.rest) out.push('체력 전부 회복 · 잠듦');
    if (fx.heal) out.push(`체력 ${fx.weatherHeal ? '날씨별 ' : ''}${fx.heal}% 회복`);
    if (fx.cure === 'self') out.push('상태이상 회복');
    if (fx.cure === 'party') out.push('파티 상태이상 회복');
    if (fx.hpCost) out.push(`체력 ${fx.hpCost}% 소모`);
    (fx.tgt || []).forEach(c => out.push(`상대 ${STAT_SHORT[c.stat]} ${c.change > 0 ? '+' : ''}${c.change}`));
    if (fx.ail) out.push(`상대 ${AIL_KO[fx.ail.kind]}`);
    (fx.self || []).forEach(c => out.push(`${STAT_SHORT[c.stat]} ${c.change > 0 ? '+' : ''}${c.change}`));
    return out.join(' · ');
  }

  // ───────────── 한국어 조사 ─────────────
  function hasBatchim(word) {
    const ch = String(word).trim().slice(-1);
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
    return false;
  }
  function jongRieul(word) {
    const code = String(word).trim().slice(-1).charCodeAt(0);
    return code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 === 8;
  }
  /** josa('불꽃', '은/는') → '불꽃은' */
  function josa(word, pair) {
    const [a, b] = pair.split('/');
    if (pair === '으로/로') return word + (hasBatchim(word) && !jongRieul(word) ? a : b);
    return word + (hasBatchim(word) ? a : b);
  }

  // ───────── 난수 (시드 고정 가능) ─────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const stageMult = n => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n));
  const accStageMult = n => (n >= 0 ? (3 + n) / 3 : 3 / (3 - n));
  const CRIT_RATE = [1 / 24, 1 / 8, 1 / 2, 1];

  /** 배틀 중에만 있는 임시 상태 (교체·기절하면 사라진다) */
  function freshVolatile() {
    return {
      seeded: false, taunt: 0, encore: 0, encoreMove: -1, disable: 0, disableMove: -1, torment: false, yawn: 0,
      aquaRing: false, ingrain: false, roost: false, focus: false, sub: 0, protect: false, protectStreak: 0, endure: false,
      trapped: false, attract: false, nightmare: false, perish: 0, lastMove: -1,
    };
  }

  const STRUGGLE = Object.freeze({
    id: 0, name: '발버둥', type: 0, cls: 'phys', power: 50, acc: null, pp: 1, maxPp: 1, pri: 0, fx: Object.freeze({}),
  });

  function createEngine(data) {
    const CHART = data.chart;

    // ───────────── 기본 계산 ─────────────
    function typeMultiplier(moveType, defTypes) {
      if (!moveType) return 1; // 무속성(발버둥 등)
      let m = 1;
      for (const t of defTypes) m *= CHART[moveType - 1][t - 1];
      return m;
    }

    function effectiveStat(mon, key, opts) {
      let stage = mon.stages[key];
      if (opts && opts.crit) stage = opts.attacking ? Math.max(0, stage) : Math.min(0, stage);
      let v = Math.floor(mon.stats[key] * stageMult(stage));
      if (key === 'spe' && mon.status === 'par') v = Math.floor(v / 2);
      return Math.max(1, v);
    }

    /**
     * 데미지 계산 (Gen 9 공식, Lv100).
     * @param o.crit 급소 여부  @param o.roll 난수 85~100 (기본 100)
     * @param o.ctx  날씨·필드·벽 정보 { weather, terrain, attGrounded, defGrounded, screens } (battle.ctx(side) 로 얻는다)
     */
    function calcDamage(att, def, move, o) {
      o = o || {};
      if (move.cls === 'status') return { damage: 0, eff: 1, crit: false };   // 변화기는 데미지가 없다
      const phys = move.cls === 'phys';
      const atkKey = phys ? 'atk' : 'spa';
      const defKey = (phys || move.fx.useDef) ? 'def' : 'spd';
      const c = o.ctx;
      const A = effectiveStat(att, atkKey, o.crit ? { crit: true, attacking: true } : null);
      let D = effectiveStat(def, defKey, o.crit ? { crit: true, attacking: false } : null);
      const eff = typeMultiplier(move.type, def.types);
      if (eff === 0) return { damage: 0, eff: 0, crit: !!o.crit };
      let power = move.power;
      if (c) {
        if (c.terrain && c.attGrounded && ((c.terrain === 'electric' && move.type === ELECTRIC) || (c.terrain === 'grassy' && move.type === GRASS) ||
            (c.terrain === 'psychic' && move.type === PSYCHIC))) power = Math.floor(power * 1.3);
        if (c.terrain === 'misty' && c.defGrounded && move.type === DRAGON) power = Math.floor(power * 0.5);
        if (c.weather === 'snow' && defKey === 'def' && def.types.includes(ICE)) D = Math.floor(D * 1.5);
        if (c.weather === 'sand' && defKey === 'spd' && def.types.includes(ROCK)) D = Math.floor(D * 1.5);
      }
      let dmg = Math.floor(Math.floor(42 * power * A / D) / 50) + 2;
      if (c && c.weather) {
        if ((c.weather === 'sun' && move.type === FIRE) || (c.weather === 'rain' && move.type === WATER)) dmg = Math.floor(dmg * 1.5);
        else if ((c.weather === 'sun' && move.type === WATER) || (c.weather === 'rain' && move.type === FIRE)) dmg = Math.floor(dmg * 0.5);
      }
      if (o.crit) dmg = Math.floor(dmg * 1.5);
      dmg = Math.floor(dmg * (o.roll || 100) / 100);
      if (att.types.includes(move.type)) dmg = Math.floor(dmg * 1.5);
      dmg = Math.floor(dmg * eff);
      if (att.status === 'brn' && phys) dmg = Math.floor(dmg * 0.5);
      if (c && c.screens && !o.crit) {              // 리플렉터·빛의장막·오로라베일 (급소에는 효과가 없다)
        const sc = c.screens;
        if ((phys && (sc.reflect > 0 || sc.veil > 0)) || (!phys && (sc.lightscreen > 0 || sc.veil > 0))) dmg = Math.floor(dmg * 0.5);
      }
      return { damage: Math.max(1, dmg), eff, crit: !!o.crit };
    }

    /** AI/UI 용 데미지 추정 (급소 제외, 평균 난수) */
    function estimateDamage(att, def, move, ctx) {
      if (move.cls === 'status') return { min: 0, max: 0, avg: 0, expected: 0, eff: 1 };
      const lo = calcDamage(att, def, move, { roll: 85, ctx }).damage;
      const hi = calcDamage(att, def, move, { roll: 100, ctx }).damage;
      const eff = typeMultiplier(move.type, def.types);
      const fx = move.fx;
      const hits = fx.hits ? (fx.hits[0] === 2 && fx.hits[1] === 5 ? 3.1 : (fx.hits[0] + fx.hits[1]) / 2) : 1;
      const acc = fx.neverMiss || move.acc === null ? 1 : move.acc / 100;
      // min/max/avg: 맞았을 때의 데미지, expected: 명중률까지 반영한 기대값
      return { min: lo * hits, max: hi * hits, avg: (lo + hi) / 2 * hits, expected: (lo + hi) / 2 * hits * acc, eff };
    }

    // ───────────── 포켓몬/기술 생성 ─────────────
    function makeMove(id) {
      const m = data.moves[id];
      if (!m) throw new Error(`알 수 없는 기술 ID: ${id}`);
      return { id: Number(id), name: m.k, type: m.t, cls: m.c === 'p' ? 'phys' : m.c === 'n' ? 'status' : 'spec', power: m.pw, acc: m.ac, pp: m.pp, maxPp: m.pp, pri: m.pr, fx: m.fx || {} };
    }

    function makeCustomMon(spec) {
      const st = Array.isArray(spec.stats)
        ? { hp: spec.stats[0], atk: spec.stats[1], def: spec.stats[2], spa: spec.stats[3], spd: spec.stats[4], spe: spec.stats[5] }
        : Object.assign({}, spec.stats);
      const stages = {};
      STAT_KEYS.forEach(k => { stages[k] = 0; });
      return Object.assign({
        name: spec.name, dataId: spec.dataId || null, tag: spec.tag || null,
        types: spec.types.slice(), stats: st, maxHp: st.hp, hp: st.hp,
        moves: spec.moves.map(m => Object.assign({}, m, { maxPp: m.maxPp || m.pp, fx: m.fx || {} })),
        status: null, sleepTurns: 0, toxCount: 0, confusion: 0, flinch: false, fainted: false, stages, base: null,
      }, freshVolatile());
    }

    /** 데이터(PokeAPI 폼 ID 포함)로 포켓몬 생성. opts.name 으로 표시 이름 변경, opts.tag 로 씰 ID 등 보관 */
    function makeMon(dataId, opts) {
      opts = opts || {};
      const p = data.pokemon[dataId];
      if (!p) throw new Error(`알 수 없는 포켓몬 ID: ${dataId}`);
      return makeCustomMon({
        name: opts.name || p.k, dataId: Number(dataId), tag: opts.tag || null,
        types: p.t, stats: p.s, moves: (opts.moves || p.m).map(makeMove),
      });
    }

    // ───────────── 배틀 ─────────────
    function createBattle(opts) {
      const rng = opts.rng || mulberry32(opts.seed === undefined ? Date.now() : opts.seed);
      const names = opts.names || ['나', '상대'];
      const maxTurns = opts.maxTurns || 500;
      if (!opts.parties || opts.parties.length !== 2 || opts.parties.some(p => !p.length)) throw new Error('양쪽 파티가 필요합니다.');

      // 한쪽 진영에 걸리는 효과(함정·벽·순풍 …) / 양쪽에 걸리는 필드(날씨·필드·트릭룸)
      const newCond = () => ({ rocks: false, spikes: 0, tspikes: 0, web: false, reflect: 0, lightscreen: 0, veil: 0, tailwind: 0, safeguard: 0, mist: 0, wish: null });
      const sides = opts.parties.map((party, i) => ({ index: i, name: names[i], party, active: 0, cond: newCond() }));
      const field = { weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, room: 0 };
      const B = {
        sides, field, turn: 0, phase: 'init', winner: null, pending: [], log: [],
        rng,
      };
      let events = [];
      let curActed = [false, false];

      const emit = ev => { events.push(ev); B.log.push(ev); return ev; };
      const text = (msg, extra) => emit(Object.assign({ t: 'text', text: msg }, extra));
      const active = si => sides[si].party[sides[si].active];
      const alive = si => sides[si].party.filter(m => !m.fainted).length;
      const J = josa;

      const sideLabel = si => (si === 0 ? '' : '상대 ');
      const nm = (si, mon) => sideLabel(si) + mon.name;
      const sideName = si => (si === 0 ? '우리 쪽' : '상대 쪽');

      function drain() { const e = events; events = []; return e; }

      // ───────── 상태 조회 / 화면 갱신용 이벤트 ─────────
      const grounded = mon => !(mon.types.includes(FLYING) && !mon.roost);        // 날개쉬기 중에는 비행 타입이 아니다
      const isTrapped = mon => !!(mon.trapped || mon.ingrain) && !mon.types.includes(GHOST);
      const condView = c => ({ rocks: c.rocks, spikes: c.spikes, tspikes: c.tspikes, web: c.web, reflect: c.reflect, lightscreen: c.lightscreen, veil: c.veil, tailwind: c.tailwind, safeguard: c.safeguard, mist: c.mist });
      const emitField = () => emit({ t: 'field', weather: field.weather, terrain: field.terrain, room: field.room, sides: [condView(sides[0].cond), condView(sides[1].cond)] });
      const volView = mon => ({
        seeded: mon.seeded, taunt: mon.taunt > 0, encore: mon.encore > 0, disable: mon.disable > 0, torment: mon.torment, yawn: mon.yawn > 0,
        aquaRing: mon.aquaRing, ingrain: mon.ingrain, sub: mon.sub > 0, trapped: !!mon.trapped, attract: mon.attract, nightmare: mon.nightmare,
        perish: mon.perish, focus: mon.focus, protect: mon.protect || mon.endure,
      });
      const emitVol = (si, mon) => emit({ t: 'vol', side: si, flags: volView(mon) });
      const speedOf = si => effectiveStat(active(si), 'spe') * (sides[si].cond.tailwind > 0 ? 2 : 1);
      /** 같은 우선도일 때 si 쪽이 먼저 움직이는가 (트릭룸이면 느린 쪽이 먼저) */
      const outspeeds = si => (field.room > 0 ? speedOf(si) <= speedOf(1 - si) : speedOf(si) >= speedOf(1 - si));
      /** 데미지 계산에 필요한 날씨·필드·벽 정보 (si = 공격하는 쪽) */
      const ctxFor = si => ({ weather: field.weather, terrain: field.terrain, attGrounded: grounded(active(si)), defGrounded: grounded(active(1 - si)), screens: sides[1 - si].cond });

      // ───────── 합법 행동 ─────────
      function legalActions(si) {
        const mon = active(si);
        const moves = mon.moves.map((m, index) => {
          let usable = m.pp > 0 && !mon.fainted, why = null;
          if (usable && mon.taunt > 0 && m.cls === 'status') { usable = false; why = '도발'; }
          else if (usable && mon.disable > 0 && mon.disableMove === index) { usable = false; why = '사슬묶기'; }
          else if (usable && mon.torment && mon.lastMove === index) { usable = false; why = '트집'; }
          else if (usable && m.fx.sleepTalk && mon.status !== 'slp') { usable = false; why = '잠든 동안만'; }
          return { index, name: m.name, pp: m.pp, maxPp: m.maxPp, usable, why };
        });
        // 앙코르: 마지막에 쓴 기술만 쓸 수 있다
        if (mon.encore > 0 && moves[mon.encoreMove] && moves[mon.encoreMove].usable) {
          moves.forEach((m, i) => { if (i !== mon.encoreMove && m.usable) { m.usable = false; m.why = '앙코르'; } });
        }
        const mustStruggle = !mon.fainted && moves.every(m => !m.usable);
        const switches = [];
        if (!isTrapped(mon)) sides[si].party.forEach((m, i) => { if (!m.fainted && i !== sides[si].active) switches.push(i); });
        return { moves, switches, mustStruggle, trapped: isTrapped(mon) };
      }

      function validate(si, a) {
        if (!a || (a.type !== 'move' && a.type !== 'switch')) throw new Error(`잘못된 행동(${si}): ${JSON.stringify(a)}`);
        const la = legalActions(si);
        if (a.type === 'switch') {
          if (!la.switches.includes(a.to)) throw new Error(`교체할 수 없는 대상(${si}): ${a.to}`);
        } else if (la.mustStruggle) {
          return { type: 'move', index: -1 };
        } else if (!la.moves[a.index] || !la.moves[a.index].usable) {
          throw new Error(`사용할 수 없는 기술(${si}): ${a.index}`);
        }
        return a;
      }

      // ───────── 피해/회복 ─────────
      function applyDamage(si, mon, amount) {
        const before = mon.hp;
        mon.hp = Math.max(0, mon.hp - amount);
        const dealt = before - mon.hp;
        return dealt;
      }
      function revertTransform(mon) {
        if (!mon.base) return;
        mon.types = mon.base.types; mon.stats = mon.base.stats; mon.moves = mon.base.moves; mon.base = null;
      }
      function faintCheck(si, mon) {
        if (mon.hp <= 0 && !mon.fainted) {
          mon.fainted = true;
          mon.status = null; mon.confusion = 0;
          revertTransform(mon);
          Object.assign(mon, freshVolatile());
          const foeMon = active(1 - si);
          if (foeMon && foeMon.trapped) foeMon.trapped = false;
          emit({ t: 'faint', side: si, mon: sides[si].active, text: `${J(nm(si, mon), '은/는')} 쓰러졌다!` });
        }
      }
      function heal(si, mon, amount, msg) {
        const before = mon.hp;
        mon.hp = Math.min(mon.maxHp, mon.hp + amount);
        if (mon.hp > before) emit({ t: 'heal', side: si, amount: mon.hp - before, hp: mon.hp, maxHp: mon.maxHp, text: msg });
      }
      function emitDamage(si, mon, dealt, extra) {
        emit(Object.assign({ t: 'damage', side: si, amount: dealt, hp: mon.hp, maxHp: mon.maxHp }, extra));
      }
      /** 고정 피해(함정·날씨·독 등)를 주고 쓰러졌는지 확인 */
      function hurt(si, mon, amount, cause, msg) {
        const dealt = applyDamage(si, mon, amount);
        emitDamage(si, mon, dealt, { cause, text: msg });
        faintCheck(si, mon);
      }

      // ───────── 상태이상 / 능력 단계 ─────────
      const immuneToStatus = statusImmune;
      const STATUS_TEXT = {
        par: m => `${J(m, '은/는')} 마비되어 기술이 나오기 어려워졌다!`,
        brn: m => `${J(m, '은/는')} 화상을 입었다!`,
        slp: m => `${J(m, '은/는')} 잠들어 버렸다!`,
        frz: m => `${J(m, '은/는')} 얼어붙었다!`,
        psn: m => `${J(m, '은/는')} 독에 걸렸다!`,
        tox: m => `${J(m, '은/는')} 맹독에 걸렸다!`,
        cnf: m => `${J(m, '은/는')} 혼란에 빠졌다!`,
      };
      /** 신비의부적·필드 때문에 상태이상이 걸리지 않으면 이유(문장)를, 아니면 null */
      function statusBlockReason(si, mon, kind) {
        if (sides[si].cond.safeguard > 0) return `${J(nm(si, mon), '은/는')} 신비의부적으로 보호받고 있다!`;
        if (grounded(mon)) {
          if (field.terrain === 'misty') return `${J(nm(si, mon), '은/는')} 미스트필드로 보호받고 있다!`;
          if (field.terrain === 'electric' && kind === 'slp') return `${J(nm(si, mon), '은/는')} 일렉트릭필드 덕분에 잠들지 않는다!`;
        }
        if (kind === 'frz' && field.weather === 'sun') return '';
        return null;
      }
      function inflict(si, mon, kind, quiet) {
        if (mon.fainted) return false;
        const blocked = statusBlockReason(si, mon, kind);
        if (kind === 'cnf') {
          if (mon.confusion > 0) return false;
          if (blocked !== null) { if (blocked && !quiet) text(blocked); return false; }
          mon.confusion = 2 + Math.floor(rng() * 4); // 2~5턴
          emit({ t: 'status', side: si, kind, text: STATUS_TEXT.cnf(nm(si, mon)) });
          return true;
        }
        if (mon.status || immuneToStatus(mon, kind)) return false;
        if (blocked !== null) { if (blocked && !quiet) text(blocked); return false; }
        mon.status = kind;
        if (kind === 'slp') mon.sleepTurns = 2 + Math.floor(rng() * 3); // 행동 불가 1~3턴
        if (kind === 'tox') mon.toxCount = 1;
        emit({ t: 'status', side: si, kind, text: STATUS_TEXT[kind](nm(si, mon)) });
        return true;
      }
      /** fromFoe: 상대가 일으킨 능력 하락이면 미스트가 막아 준다 */
      function changeStage(si, mon, stat, change, fromFoe) {
        const cur = mon.stages[stat];
        const label = J(STAT_KO[stat], '이/가');
        if (change < 0 && fromFoe && sides[si].cond.mist > 0) {
          emit({ t: 'text', text: `${nm(si, mon)}의 ${label} 미스트에 보호받아 떨어지지 않는다!` });
          return;
        }
        if ((change > 0 && cur >= 6) || (change < 0 && cur <= -6)) {
          emit({ t: 'text', text: `${nm(si, mon)}의 ${label} 더 이상 ${change > 0 ? '올라가지' : '내려가지'} 않는다!` });
          return;
        }
        const next = clamp(cur + change, -6, 6);
        mon.stages[stat] = next;
        const d = next - cur, mag = Math.abs(d);
        const adv = mag >= 3 ? '매우 크게 ' : mag === 2 ? '크게 ' : '';
        emit({ t: 'stage', side: si, stat, change: d, text: `${nm(si, mon)}의 ${label} ${adv}${d > 0 ? '올라갔다!' : '내려갔다!'}` });
      }
      function resetStages(si, mon) {
        STAT_KEYS.forEach(k => { mon.stages[k] = 0; });
        emit({ t: 'stages', side: si, stages: {} });
      }
      function cureStatus(si, mon) {
        if (!mon.status && !mon.confusion) return false;
        mon.status = null; mon.confusion = 0; mon.toxCount = 1;
        emit({ t: 'cure', side: si, indexes: [sides[si].party.indexOf(mon)], text: `${J(nm(si, mon), '은/는')} 상태이상이 나았다!` });
        return true;
      }

      // ───────── 날씨 · 필드 ─────────
      const WEATHER_START = { sun: '햇살이 강해졌다!', rain: '비가 내리기 시작했다!', sand: '모래바람이 불기 시작했다!', snow: '눈이 내리기 시작했다!' };
      const WEATHER_END = { sun: '햇살이 약해졌다.', rain: '비가 그쳤다.', sand: '모래바람이 가라앉았다.', snow: '눈이 그쳤다.' };
      const TERRAIN_START = { electric: '발밑에 전기가 흐르기 시작했다!', grassy: '발밑에 풀이 무성해졌다!', misty: '주변에 안개가 자욱해졌다!', psychic: '발밑이 이상한 기운으로 가득 찼다!' };
      const TERRAIN_END = { electric: '전기가 사라졌다.', grassy: '풀이 시들었다.', misty: '안개가 걷혔다.', psychic: '이상한 기운이 사라졌다.' };

      // ───────── 교체 (함정 적용 포함) ─────────
      function applyHazards(si, mon) {
        const c = sides[si].cond, g = grounded(mon);
        if (c.rocks && !mon.fainted) {
          hurt(si, mon, Math.max(1, Math.floor(mon.maxHp * typeMultiplier(ROCK, mon.types) / 8)), 'hazard', `${J(nm(si, mon), '은/는')} 뾰족한 바위에 찔렸다!`);
        }
        if (c.spikes && g && !mon.fainted) {
          hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / [0, 8, 6, 4][c.spikes])), 'hazard', `${J(nm(si, mon), '은/는')} 압정에 찔렸다!`);
        }
        if (c.tspikes && g && !mon.fainted) {
          if (mon.types.includes(POISON)) { c.tspikes = 0; emitField(); text(`${J(nm(si, mon), '은/는')} 독압정을 흡수했다!`); }
          else if (!mon.types.includes(STEEL)) inflict(si, mon, c.tspikes >= 2 ? 'tox' : 'psn', false);
        }
        if (c.web && g && !mon.fainted) {
          text(`${J(nm(si, mon), '은/는')} 끈적끈적네트에 걸렸다!`);
          changeStage(si, mon, 'spe', -1, true);
        }
      }
      function resetOnLeave(si, mon) {
        STAT_KEYS.forEach(k => { mon.stages[k] = 0; });
        mon.confusion = 0; mon.flinch = false;
        if (mon.status === 'tox') mon.toxCount = 1;
        revertTransform(mon);
        Object.assign(mon, freshVolatile());
        const foeMon = active(1 - si);
        if (foeMon && foeMon.trapped) { foeMon.trapped = false; emitVol(1 - si, foeMon); }
      }
      function sendOut(si, to, fromName, dragged) {
        const side = sides[si];
        const old = active(si);
        if (!old.fainted) resetOnLeave(si, old);
        side.active = to;
        const mon = active(si);
        const msg = dragged
          ? `${J(nm(si, mon), '이/가')} 끌려 나왔다!`
          : si === 0
            ? `${fromName ? `돌아와, ${fromName}! ` : ''}가라, ${mon.name}!`
            : `${fromName ? `상대는 ${J(fromName, '을/를')} 불러들였다! ` : ''}상대는 ${J(mon.name, '을/를')} 내보냈다!`;
        emit({ t: 'switch', side: si, to, name: mon.name, hp: mon.hp, maxHp: mon.maxHp, types: mon.types.slice(), text: msg });
        applyHazards(si, mon);
      }

      // ───────── 행동 전 판정 ─────────
      function canAct(si, mon, move) {
        if (mon.status === 'frz') {
          if (rng() < 0.2) { mon.status = null; emit({ t: 'status', side: si, kind: 'thaw', text: `${nm(si, mon)}의 얼음이 녹았다!` }); }
          else { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 얼어붙어서 움직일 수 없다!` }); return false; }
        }
        if (mon.status === 'slp') {
          mon.sleepTurns--;
          if (mon.sleepTurns > 0) {
            if (move && move.fx.sleepTalk) { /* 잠꼬대는 잠든 채로 쓴다 */ }
            else { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 쿨쿨 잠들어 있다.` }); return false; }
          } else {
            mon.status = null;
            emit({ t: 'status', side: si, kind: 'wake', text: `${J(nm(si, mon), '은/는')} 눈을 떴다!` });
          }
        }
        if (mon.flinch) {
          emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 풀이 죽어 움직일 수 없었다!` });
          return false;
        }
        if (mon.confusion > 0) {
          mon.confusion--;
          if (mon.confusion === 0) {
            emit({ t: 'status', side: si, kind: 'cnfEnd', text: `${nm(si, mon)}의 혼란이 풀렸다!` });
          } else {
            emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 혼란에 빠져 있다!` });
            if (rng() < 1 / 3) {
              const self = { name: '혼란', type: 0, cls: 'phys', power: 40, acc: null, fx: {} };
              const roll = 85 + Math.floor(rng() * 16);
              const dmg = calcDamage(mon, mon, self, { roll }).damage;
              const dealt = applyDamage(si, mon, dmg);
              emitDamage(si, mon, dealt, { cause: 'confusion', text: '영문도 모르고 자신을 공격했다!' });
              faintCheck(si, mon);
              return false;
            }
          }
        }
        if (mon.attract) {
          emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 헤롱헤롱해져 있다!` });
          if (rng() < 0.5) { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 헤롱헤롱해서 움직일 수 없다!` }); return false; }
        }
        if (mon.status === 'par' && rng() < 0.25) {
          emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 몸이 저려서 움직일 수 없다!` });
          return false;
        }
        return true;
      }

      // ───────── 기술 사용 ─────────
      function pickHits(fx) {
        if (!fx.hits) return 1;
        const [lo, hi] = fx.hits;
        if (lo === 2 && hi === 5) { const r = rng(); return r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5; }
        return lo + Math.floor(rng() * (hi - lo + 1));
      }
      const fail = msg => emit({ t: 'text', text: msg || '하지만 실패했다...' });

      /** 이미 걸려 있던 도발·사슬묶기 때문에 이번 턴에 쓸 수 없는 기술인가 (턴 중간에 걸린 경우) */
      function moveBlocked(si, mon, move, index) {
        if (mon.taunt > 0 && move.cls === 'status') { text(`${J(nm(si, mon), '은/는')} 도발당해서 ${move.name}을(를) 쓸 수 없다!`); return true; }
        if (mon.disable > 0 && mon.disableMove === index) { text(`${J(nm(si, mon), '은/는')} 사슬묶기 때문에 ${move.name}을(를) 쓸 수 없다!`); return true; }
        return false;
      }

      function runMove(si, move, struggle, acted) {
        const user = active(si);
        const index = struggle ? -1 : user.moves.indexOf(move);
        if (!canAct(si, user, move)) return;
        if (!struggle && moveBlocked(si, user, move, index)) return;
        if (!struggle) move.pp--;
        if (!(move.fx && move.fx.protect)) user.protectStreak = 0;
        user.lastMove = index;
        emit({ t: 'move', side: si, name: move.name, type: move.type, cls: move.cls, text: `${nm(si, user)}의 ${move.name}!` });
        execMove(si, move, struggle, acted);
      }
      function execMove(si, move, struggle, acted) {
        if (move.cls === 'status') return runStatusMove(si, move, active(si));
        return runAttack(si, move, struggle, acted || curActed);
      }

      function runAttack(si, move, struggle, acted) {
        const foe = 1 - si;
        const user = active(si);
        const target = active(foe);
        if (target.fainted) { fail(); return; }
        const fx = move.fx;
        if (target.protect) { text(`${J(nm(foe, target), '은/는')} 공격으로부터 몸을 지켰다!`); return; }
        if (move.pri > 0 && field.terrain === 'psychic' && grounded(target)) { text(`${J(nm(foe, target), '은/는')} 사이코필드로 보호받고 있다!`); return; }
        // 명중
        if (!fx.neverMiss && move.acc !== null) {
          const stage = clamp(user.stages.acc - target.stages.eva, -6, 6);
          if (rng() * 100 >= move.acc * accStageMult(stage)) {
            emit({ t: 'miss', side: si, text: `${nm(si, user)}의 공격은 빗나갔다!` });
            return;
          }
        }

        const eff = typeMultiplier(move.type, target.types);
        if (eff === 0) {
          emit({ t: 'effective', side: foe, eff: 0, text: `${nm(foe, target)}에게는 효과가 없는 것 같다...` });
          return;
        }

        const hits = pickHits(fx);
        const ctx = ctxFor(si);
        let total = 0, landed = 0;
        const critStage = Math.min(3, (fx.crit === 1 ? 1 : 0) + (user.focus ? 2 : 0));
        for (let i = 0; i < hits && !target.fainted; i++) {
          const crit = fx.crit === 2 || rng() < CRIT_RATE[critStage];
          const roll = 85 + Math.floor(rng() * 16);
          const res = calcDamage(user, target, move, { crit, roll, ctx });
          if (target.sub > 0) {                       // 대타가 대신 맞는다
            const take = Math.min(target.sub, res.damage);
            target.sub -= take; total += take;
            text(`${nm(foe, target)}의 대타가 대신 공격을 받았다!`);
            if (target.sub <= 0) { target.sub = 0; text('대타는 쓰러졌다!'); }
            emitVol(foe, target);
            continue;
          }
          let amount = res.damage;
          if (target.endure && amount >= target.hp) { amount = Math.max(0, target.hp - 1); text(`${J(nm(foe, target), '은/는')} 공격을 버텼다!`); }
          const dealt = applyDamage(foe, target, amount);
          total += dealt; landed++;
          emitDamage(foe, target, dealt, { move: move.name, crit, eff });
          if (target.status === 'frz' && move.type === FIRE) { target.status = null; emit({ t: 'status', side: foe, kind: 'thaw', text: `${nm(foe, target)}의 얼음이 녹았다!` }); }
          if (crit) emit({ t: 'crit', side: foe, text: '급소에 맞았다!' });
          if (i === 0 && eff !== 1) {
            emit({ t: 'effective', side: foe, eff, text: eff > 1 ? '효과가 굉장했다!' : '효과가 별로인 듯하다...' });
          }
          faintCheck(foe, target);
        }
        if (landed > 1) emit({ t: 'hits', count: landed, text: `${landed}번 맞았다!` });

        // 흡수 / 반동
        if (fx.drain && total > 0) {
          heal(si, user, Math.max(1, Math.floor(total * fx.drain / 100)), `${nm(foe, target)}의 체력을 흡수했다!`);
        }
        if (fx.recoil && total > 0) {
          const dealt = applyDamage(si, user, Math.max(1, Math.floor(total * fx.recoil / 100)));
          emitDamage(si, user, dealt, { cause: 'recoil', text: `${J(nm(si, user), '은/는')} 반동으로 데미지를 입었다!` });
          faintCheck(si, user);
        }
        if (struggle) {
          const dealt = applyDamage(si, user, Math.max(1, Math.floor(user.maxHp / 4)));
          emitDamage(si, user, dealt, { cause: 'recoil', text: `${J(nm(si, user), '은/는')} 반동으로 데미지를 입었다!` });
          faintCheck(si, user);
        }

        // 추가 효과 (대상: 풀죽음 → 상태이상 → 능력 변화 / 자신: 능력 변화)
        if (!target.fainted && landed > 0) {
          if (fx.flinch && !acted[foe] && rng() * 100 < fx.flinch) target.flinch = true;
          if (fx.ail && rng() * 100 < fx.ail.chance) inflict(foe, target, fx.ail.kind, true);
          (fx.tgt || []).forEach(s => { if (!target.fainted && rng() * 100 < s.chance) changeStage(foe, target, s.stat, s.change, true); });
        }
        if (landed > 0 && !user.fainted) {
          (fx.self || []).forEach(s => { if (rng() * 100 < s.chance) changeStage(si, user, s.stat, s.change); });
        }
      }

      // ───────── 변화기 ─────────
      const FOE_TARGETED = ['ail', 'tgt', 'seed', 'taunt', 'encore', 'disable', 'torment', 'yawn', 'attract', 'nightmare', 'trap', 'spite', 'soak', 'phaze', 'painSplit', 'transform', 'reqFoeStatus'];
      function runStatusMove(si, move, user) {
        const fx = move.fx;
        if (FOE_TARGETED.some(k => fx[k])) return statusOnFoe(si, move, user, active(1 - si));
        return statusOnSelf(si, move, user);
      }

      function statusOnFoe(si, move, user, target) {
        const foe = 1 - si, fx = move.fx;
        const noEffect = () => emit({ t: 'effective', side: foe, eff: 0, text: `${nm(foe, target)}에게는 효과가 없는 것 같다...` });
        if (target.fainted) return fail();
        if (target.protect) return text(`${J(nm(foe, target), '은/는')} 몸을 지켰다!`);
        if (move.pri > 0 && field.terrain === 'psychic' && grounded(target)) return text(`${J(nm(foe, target), '은/는')} 사이코필드로 보호받고 있다!`);
        if (target.sub > 0 && !fx.phaze && !fx.defog) return fail();        // 대타가 막는다
        // 명중 (독 타입이 쓴 맹독은 필중)
        const sure = move.acc === null || (fx.ail && fx.ail.kind === 'tox' && user.types.includes(POISON));
        if (!sure) {
          const stage = clamp(user.stages.acc - target.stages.eva, -6, 6);
          if (rng() * 100 >= move.acc * accStageMult(stage)) {
            emit({ t: 'miss', side: si, text: `${nm(si, user)}의 공격은 빗나갔다!` });
            return;
          }
        }
        if (fx.powder && target.types.includes(GRASS)) return noEffect();
        if (fx.typeImmune && typeMultiplier(move.type, target.types) === 0) return noEffect();
        if (fx.reqFoeStatus && !fx.reqFoeStatus.includes(target.status)) return fail();

        if (fx.phaze) {                                                       // 울부짖기 / 날려버리기
          if (target.ingrain) return fail();
          const options = [];
          sides[foe].party.forEach((m, i) => { if (!m.fainted && i !== sides[foe].active) options.push(i); });
          if (!options.length) return fail();
          sendOut(foe, options[Math.floor(rng() * options.length)], target.name, true);
          return;
        }
        if (fx.painSplit) {                                                   // 아픔나누기
          const avg = Math.floor((user.hp + target.hp) / 2);
          [[si, user], [foe, target]].forEach(([s, m]) => {
            if (avg > m.hp) heal(s, m, avg - m.hp, `${J(nm(s, m), '은/는')} 체력을 나눠 받았다!`);
            else if (avg < m.hp) { const d = applyDamage(s, m, m.hp - avg); emitDamage(s, m, d, { cause: 'split', text: `${J(nm(s, m), '은/는')} 체력을 나눠 주었다!` }); }
          });
          return;
        }
        if (fx.transform) {                                                   // 변신
          if (user.base || target.base) return fail();
          user.base = { types: user.types, stats: user.stats, moves: user.moves };
          user.types = target.types.slice();
          user.stats = Object.assign({}, user.stats, { atk: target.stats.atk, def: target.stats.def, spa: target.stats.spa, spd: target.stats.spd, spe: target.stats.spe });
          user.moves = target.moves.map(m => Object.assign({}, m, { pp: Math.min(5, m.maxPp), maxPp: Math.min(5, m.maxPp) }));
          STAT_KEYS.forEach(k => { user.stages[k] = target.stages[k]; });
          user.lastMove = -1;
          text(`${J(nm(si, user), '은/는')} ${J(target.name, '으로/로')} 변신했다!`);
          emit({ t: 'types', side: si, types: user.types.slice() });
          emit({ t: 'stages', side: si, stages: Object.assign({}, user.stages) });
          return;
        }
        if (fx.seed) {
          if (target.types.includes(GRASS)) return noEffect();
          if (target.seeded) return fail();
          target.seeded = true; text(`${nm(foe, target)}에게 씨앗을 심었다!`); emitVol(foe, target); return;
        }
        if (fx.taunt) {
          if (target.taunt > 0) return fail();
          target.taunt = 3; text(`${J(nm(foe, target), '은/는')} 도발에 넘어갔다!`); emitVol(foe, target); return;
        }
        if (fx.encore) {
          if (target.encore > 0 || target.lastMove < 0 || !target.moves[target.lastMove] || target.moves[target.lastMove].pp <= 0) return fail();
          target.encore = 3; target.encoreMove = target.lastMove;
          text(`${J(nm(foe, target), '은/는')} 앙코르를 받았다!`); emitVol(foe, target); return;
        }
        if (fx.disable) {
          if (target.disable > 0 || target.lastMove < 0 || !target.moves[target.lastMove] || target.moves[target.lastMove].pp <= 0) return fail();
          target.disable = 4; target.disableMove = target.lastMove;
          text(`${J(nm(foe, target), '은/는')} ${target.moves[target.lastMove].name}을(를) 쓸 수 없게 되었다!`); emitVol(foe, target); return;
        }
        if (fx.torment) {
          if (target.torment) return fail();
          target.torment = true; text(`${J(nm(foe, target), '은/는')} 트집을 잡혔다!`); emitVol(foe, target); return;
        }
        if (fx.yawn) {
          if (target.status || target.yawn > 0 || statusBlockReason(foe, target, 'slp') !== null) return fail();
          target.yawn = 2; text(`${J(nm(foe, target), '은/는')} 졸린 듯하다...`); emitVol(foe, target); return;
        }
        if (fx.attract) {
          if (target.attract) return fail();
          target.attract = true; text(`${J(nm(foe, target), '은/는')} 헤롱헤롱해졌다!`); emitVol(foe, target); return;
        }
        if (fx.nightmare) {
          if (target.status !== 'slp' || target.nightmare) return fail();
          target.nightmare = true; text(`${J(nm(foe, target), '은/는')} 악몽을 꾸기 시작했다!`); emitVol(foe, target); return;
        }
        if (fx.trap) {
          if (target.trapped) return fail();
          target.trapped = true; text(`${J(nm(foe, target), '은/는')} 이제 도망칠 수 없다!`); emitVol(foe, target); return;
        }
        if (fx.spite) {
          const last = target.moves[target.lastMove];
          if (!last || last.pp <= 0) return fail();
          const cut = Math.min(4, last.pp); last.pp -= cut;
          text(`${nm(foe, target)}의 ${last.name}의 PP가 ${cut} 줄었다!`); return;
        }
        if (fx.soak) {
          if (target.types.length === 1 && target.types[0] === WATER) return fail();
          target.types = [WATER]; text(`${J(nm(foe, target), '은/는')} 물 타입이 되었다!`);
          emit({ t: 'types', side: foe, types: [WATER] }); return;
        }

        // 상태이상 / 능력 하락
        if (fx.ail && !fx.tgt) {                     // 상태이상만 거는 기술은 이미 걸려 있거나 면역이면 실패
          const kind = fx.ail.kind;
          if (kind === 'cnf' ? target.confusion > 0 : target.status) return fail();
          if (kind !== 'cnf' && immuneToStatus(target, kind)) return noEffect();
        }
        if (fx.defog) {
          for (const s of sides) { const c = s.cond; c.rocks = false; c.spikes = 0; c.tspikes = 0; c.web = false; }
          const fc = sides[foe].cond; fc.reflect = fc.lightscreen = fc.veil = fc.mist = 0;
          text('하얀 안개가 함정과 벽을 날려 버렸다!'); emitField();
        }
        (fx.tgt || []).forEach(c => changeStage(foe, target, c.stat, c.change, true));
        if (fx.ail) inflict(foe, target, fx.ail.kind, false);
      }

      const healAmount = (fx, user) => healAmountFor(fx, user.maxHp, field.weather);

      function statusOnSelf(si, move, user) {
        const foe = 1 - si, fx = move.fx;
        const target = active(foe);

        if (fx.sleepTalk) {                                       // 잠꼬대: 잠든 동안 다른 기술을 무작위로 쓴다
          if (user.status !== 'slp') return fail();
          const pool = user.moves.filter(m => m !== move && m.pp > 0 && !m.fx.sleepTalk && !m.fx.metronome);
          if (!pool.length) return fail();
          const pick = pool[Math.floor(rng() * pool.length)];
          emit({ t: 'move', side: si, name: pick.name, type: pick.type, cls: pick.cls, text: `${nm(si, user)}의 ${pick.name}!` });
          return execMove(si, pick, false, curActed);
        }
        if (fx.metronome) {                                       // 메트로놈: 아무 기술이나 무작위로
          const ids = Object.keys(data.moves).filter(id => { const f = data.moves[id].fx; return !f.metronome && !f.sleepTalk; });
          const pick = makeMove(ids[Math.floor(rng() * ids.length)]);
          emit({ t: 'move', side: si, name: pick.name, type: pick.type, cls: pick.cls, text: `${J(nm(si, user), '은/는')} 손가락을 흔들어 ${pick.name}을(를) 냈다!` });
          return execMove(si, pick, false, curActed);
        }
        if (fx.protect) {                                          // 방어 / 판별 / 버티기
          const chance = user.protectStreak > 0 ? Math.pow(1 / 3, user.protectStreak) : 1;
          if (rng() >= chance) { user.protectStreak = 0; return fail(); }
          user.protectStreak++;
          if (fx.protect === 'endure') { user.endure = true; text(`${J(nm(si, user), '은/는')} 버틸 태세를 갖췄다!`); }
          else { user.protect = true; text(`${J(nm(si, user), '은/는')} 몸을 지키는 태세를 갖췄다!`); }
          emitVol(si, user); return;
        }
        if (fx.sub) {                                              // 대타출동
          const cost = Math.floor(user.maxHp / 4);
          if (user.sub > 0 || user.hp <= cost) return fail(user.sub > 0 ? `${nm(si, user)}의 대타는 이미 나와 있다!` : '체력이 부족해서 대타를 만들 수 없다!');
          const dealt = applyDamage(si, user, cost);
          emitDamage(si, user, dealt, { cause: 'cost', text: `${J(nm(si, user), '은/는')} 체력을 깎아 대타를 만들었다!` });
          user.sub = cost; emitVol(si, user); return;
        }
        if (fx.splash) return text('하지만 아무 일도 일어나지 않았다!');
        if (fx.haze) {
          [[si, user], [foe, target]].forEach(([s, m]) => resetStages(s, m));
          return text('모든 능력 변화가 원래대로 돌아왔다!');
        }
        if (fx.perish) {
          const both = [[si, user], [foe, target]].filter(([, m]) => !m.fainted && !m.perish);
          if (!both.length) return fail();
          both.forEach(([s, m]) => { m.perish = 4; emitVol(s, m); });
          return text('멸망의노래가 울려 퍼졌다! 3턴 뒤 모두 쓰러진다...');
        }
        if (fx.weather) {
          if (field.weather === fx.weather) return fail();
          field.weather = fx.weather; field.weatherTurns = 5;
          text(WEATHER_START[fx.weather]); emitField(); return;
        }
        if (fx.terrain) {
          if (field.terrain === fx.terrain) return fail();
          field.terrain = fx.terrain; field.terrainTurns = 5;
          text(TERRAIN_START[fx.terrain]); emitField(); return;
        }
        if (fx.room) {
          if (field.room > 0) { field.room = 0; text('뒤틀린 시공이 원래대로 돌아왔다!'); }
          else { field.room = 5; text(`${J(nm(si, user), '은/는')} 시공을 뒤틀어 버렸다!`); }
          emitField(); return;
        }
        if (fx.hazard) {                                           // 상대 쪽에 까는 함정
          const c = sides[foe].cond, k = fx.hazard;
          if (k === 'rocks') { if (c.rocks) return fail(); c.rocks = true; text(`${sideName(foe)}에 뾰족한 바위가 떠올랐다!`); }
          else if (k === 'spikes') { if (c.spikes >= 3) return fail(); c.spikes++; text(`${sideName(foe)} 발밑에 압정이 뿌려졌다!`); }
          else if (k === 'tspikes') { if (c.tspikes >= 2) return fail(); c.tspikes++; text(`${sideName(foe)} 발밑에 독압정이 뿌려졌다!`); }
          else if (k === 'web') { if (c.web) return fail(); c.web = true; text(`${sideName(foe)} 발밑에 끈적끈적한 네트가 펼쳐졌다!`); }
          emitField(); return;
        }
        if (fx.screen) {                                           // 우리 쪽에 치는 벽
          const c = sides[si].cond, k = fx.screen;
          if (k === 'veil' && field.weather !== 'snow') return fail();
          if (c[k] > 0) return fail();
          c[k] = 5;
          text(k === 'reflect' ? '리플렉터로 물리 공격이 약해졌다!' : k === 'lightscreen' ? '빛의장막으로 특수 공격이 약해졌다!' : '오로라베일로 모든 공격이 약해졌다!');
          emitField(); return;
        }
        if (fx.side) {                                             // 순풍 / 신비의부적 / 미스트
          const c = sides[si].cond, k = fx.side;
          if (c[k] > 0) return fail();
          c[k] = k === 'tailwind' ? 4 : 5;
          text(k === 'tailwind' ? '우리 쪽에 순풍이 불기 시작했다!' : k === 'safeguard' ? '우리 쪽이 신비의 베일에 감싸였다!' : '우리 쪽이 안개에 감싸였다!');
          emitField(); return;
        }
        if (fx.focus) {
          if (user.focus) return fail();
          user.focus = true; text(`${J(nm(si, user), '은/는')} 기합을 넣었다!`); emitVol(si, user); return;
        }
        if (fx.aquaRing) {
          if (user.aquaRing) return fail();
          user.aquaRing = true; text(`${J(nm(si, user), '은/는')} 물의 베일로 몸을 감쌌다!`); emitVol(si, user); return;
        }
        if (fx.ingrain) {
          if (user.ingrain) return fail();
          user.ingrain = true; text(`${J(nm(si, user), '은/는')} 땅속 깊이 뿌리를 내렸다!`); emitVol(si, user); return;
        }
        if (fx.wish) {
          const c = sides[si].cond;
          if (c.wish) return fail();
          c.wish = { turns: 2, amount: Math.floor(user.maxHp / 2) };
          return text(`${J(nm(si, user), '은/는')} 소원을 빌었다!`);
        }
        if (fx.cureFoe) {                                          // 정화: 상대의 상태이상을 낫게 하고 내가 회복
          if (!target.status) return fail();
          cureStatus(foe, target);
          heal(si, user, Math.floor(user.maxHp / 2), `${J(nm(si, user), '은/는')} 체력을 회복했다!`);
          return;
        }
        if (fx.cure === 'party') {                                 // 치유의방울 / 아로마테라피: 파티 전원의 상태이상
          const idx = [];
          sides[si].party.forEach((m, i) => { if (!m.fainted && (m.status || m.confusion)) { m.status = null; m.confusion = 0; m.toxCount = 1; idx.push(i); } });
          if (!idx.length) return fail();
          return emit({ t: 'cure', side: si, indexes: idx, text: '파티 전원의 상태이상이 나았다!' });
        }

        if (fx.rest) {
          if (user.hp >= user.maxHp || user.status === 'slp') return fail();
          heal(si, user, user.maxHp - user.hp, `${nm(si, user)}의 체력이 전부 회복되었다!`);
          user.status = 'slp'; user.sleepTurns = 3; user.toxCount = 1;   // 잠듦 2턴 (3번째 턴에 눈을 뜬다)
          emit({ t: 'status', side: si, kind: 'slp', text: `${J(nm(si, user), '은/는')} 잠들어서 건강해졌다!` });
          return;
        }
        if (fx.hpCost) {
          const cost = Math.floor(user.maxHp * fx.hpCost / 100);
          if (user.hp <= cost || (fx.self || []).some(c => c.change > 0 && user.stages[c.stat] >= 6)) return fail();
          const dealt = applyDamage(si, user, cost);
          emitDamage(si, user, dealt, { cause: 'cost', text: `${J(nm(si, user), '은/는')} 체력을 깎아서 힘을 끌어올렸다!` });
        }
        if (fx.heal) {
          if (user.hp >= user.maxHp && !(fx.cure && (user.status || user.confusion))) return fail();
          if (fx.roost) { user.roost = true; }
          heal(si, user, healAmount(fx, user), `${J(nm(si, user), '은/는')} 체력을 회복했다!`);
        }
        if (fx.cure === 'self') {
          if (!cureStatus(si, user) && !fx.heal) return fail();
        }
        if (fx.randStat) {                                         // 날카로운침: 무작위 능력 1개를 크게 올린다
          const open = STAT_KEYS.filter(k => user.stages[k] < 6);
          if (!open.length) return fail();
          changeStage(si, user, open[Math.floor(rng() * open.length)], fx.randStat);
        }
        (fx.self || []).forEach(c => changeStage(si, user, c.stat, c.change));
      }

      // ───────── 승패 ─────────
      function checkEnd(attackerSide) {
        const a0 = alive(0), a1 = alive(1);
        if (a0 > 0 && a1 > 0) return false;
        B.phase = 'ended';
        if (a0 === 0 && a1 === 0) B.winner = attackerSide === null || attackerSide === undefined ? 'draw' : 1 - attackerSide;
        else B.winner = a0 === 0 ? 1 : 0;
        const msg = B.winner === 'draw' ? '무승부!' : B.winner === 0 ? '승리했다!' : '패배했다...';
        emit({ t: 'end', winner: B.winner, text: msg });
        return true;
      }

      // ───────── 턴 종료 처리 ─────────
      function endOfTurn() {
        const order = [0, 1].sort((x, y) => (field.room > 0 ? speedOf(x) - speedOf(y) : speedOf(y) - speedOf(x)));
        const each = fn => { for (const si of order) { const mon = active(si); if (!mon.fainted) fn(si, mon); } };

        // 1) 모래바람 피해
        if (field.weather === 'sand') {
          each((si, mon) => {
            if (mon.types.some(t => t === ROCK || t === GROUND || t === STEEL)) return;
            hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), 'weather', `${J(nm(si, mon), '은/는')} 모래바람에 휩쓸렸다!`);
          });
        }
        // 2) 소원
        for (const si of order) {
          const c = sides[si].cond;
          if (c.wish && --c.wish.turns <= 0) {
            const mon = active(si);
            if (!mon.fainted) heal(si, mon, c.wish.amount, `소원이 이루어졌다! ${J(nm(si, mon), '은/는')} 체력을 회복했다!`);
            c.wish = null;
          }
        }
        // 3) 그래스필드 / 뿌리박기 / 아쿠아링 회복
        each((si, mon) => {
          if (field.terrain === 'grassy' && grounded(mon)) heal(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), `${J(nm(si, mon), '은/는')} 풀의 힘으로 체력을 회복했다!`);
          if (mon.ingrain) heal(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), `${J(nm(si, mon), '은/는')} 뿌리로 양분을 빨아들였다!`);
          if (mon.aquaRing) heal(si, mon, Math.max(1, Math.floor(mon.maxHp / 16)), `${J(nm(si, mon), '은/는')} 물의 베일로 체력을 회복했다!`);
        });
        // 4) 씨뿌리기
        each((si, mon) => {
          if (!mon.seeded) return;
          const dmg = Math.max(1, Math.floor(mon.maxHp / 8));
          const gain = Math.min(dmg, mon.hp);
          hurt(si, mon, dmg, 'seed', `${J(nm(si, mon), '은/는')} 씨앗에게 체력을 빼앗겼다!`);
          const other = active(1 - si);
          if (!other.fainted) heal(1 - si, other, gain, `${J(nm(1 - si, other), '은/는')} 체력을 흡수했다!`);
        });
        // 5) 상태이상 피해
        each((si, mon) => {
          let dmg = 0, label = null;
          if (mon.status === 'brn') { dmg = Math.max(1, Math.floor(mon.maxHp / 16)); label = '화상'; }
          else if (mon.status === 'psn') { dmg = Math.max(1, Math.floor(mon.maxHp / 8)); label = '독'; }
          else if (mon.status === 'tox') { dmg = Math.max(1, Math.floor(mon.maxHp * mon.toxCount / 16)); mon.toxCount = Math.min(15, mon.toxCount + 1); label = '독'; }
          if (!label) return;
          hurt(si, mon, dmg, mon.status, `${J(nm(si, mon), '은/는')} ${label} 데미지를 입고 있다!`);
        });
        // 6) 악몽 / 하품 / 멸망의노래
        each((si, mon) => {
          if (mon.nightmare) {
            if (mon.status === 'slp') hurt(si, mon, Math.max(1, Math.floor(mon.maxHp / 4)), 'nightmare', `${J(nm(si, mon), '은/는')} 악몽에 시달리고 있다!`);
            else { mon.nightmare = false; emitVol(si, mon); }
          }
        });
        each((si, mon) => {
          if (mon.yawn > 0 && --mon.yawn === 0) { emitVol(si, mon); inflict(si, mon, 'slp', true); }
        });
        each((si, mon) => {
          if (mon.perish > 0) {
            mon.perish--;
            if (mon.perish === 0) { hurt(si, mon, mon.hp, 'perish', `${J(nm(si, mon), '은/는')} 멸망의노래로 쓰러졌다!`); }
            else { text(`${nm(si, mon)}의 멸망 카운트가 ${mon.perish}이(가) 되었다!`); emitVol(si, mon); }
          }
        });
        // 7) 기간 만료
        let changed = false;
        for (const si of [0, 1]) {
          const mon = active(si);
          mon.roost = false;
          if (mon.fainted) continue;
          let vol = false;
          if (mon.taunt > 0 && --mon.taunt === 0) { text(`${nm(si, mon)}의 도발이 풀렸다!`); vol = true; }
          if (mon.encore > 0 && --mon.encore === 0) { text(`${nm(si, mon)}의 앙코르가 풀렸다!`); vol = true; }
          if (mon.disable > 0 && --mon.disable === 0) { text(`${nm(si, mon)}의 사슬묶기가 풀렸다!`); vol = true; }
          if (vol) emitVol(si, mon);
          const c = sides[si].cond;
          const ends = { reflect: '리플렉터의 효과가 사라졌다.', lightscreen: '빛의장막의 효과가 사라졌다.', veil: '오로라베일의 효과가 사라졌다.', tailwind: '순풍이 그쳤다.', safeguard: '신비의부적의 효과가 사라졌다.', mist: '안개가 걷혔다.' };
          for (const k of Object.keys(ends)) if (c[k] > 0 && --c[k] === 0) { text(`${sideName(si)} ${ends[k]}`); changed = true; }
        }
        if (field.room > 0 && --field.room === 0) { text('뒤틀린 시공이 원래대로 돌아왔다!'); changed = true; }
        if (field.weather && --field.weatherTurns <= 0) { text(WEATHER_END[field.weather]); field.weather = null; changed = true; }
        if (field.terrain && --field.terrainTurns <= 0) { text(TERRAIN_END[field.terrain]); field.terrain = null; changed = true; }
        if (changed) emitField();
      }

      // ───────── 공개 API ─────────
      B.legalActions = legalActions;
      B.active = active;
      B.alive = alive;
      B.speedOf = speedOf;
      B.outspeeds = outspeeds;
      B.ctx = ctxFor;
      B.grounded = grounded;

      /** 첫 포켓몬 등장 (양쪽 파티의 선두) */
      B.start = function () {
        if (B.phase !== 'init') throw new Error('이미 시작된 배틀입니다.');
        events = [];
        emit({ t: 'text', text: '배틀 시작!' });
        for (let si = 0; si < 2; si++) {
          const mon = active(si);
          emit({ t: 'switch', side: si, to: sides[si].active, name: mon.name, hp: mon.hp, maxHp: mon.maxHp, types: mon.types.slice(), initial: true,
            text: si === 0 ? `가라, ${mon.name}!` : `상대는 ${J(mon.name, '을/를')} 내보냈다!` });
        }
        B.phase = 'move';
        return drain();
      };

      B.playTurn = function (action0, action1) {
        if (B.phase !== 'move') throw new Error(`지금은 턴을 진행할 수 없습니다. (phase=${B.phase})`);
        const acts = [validate(0, action0), validate(1, action1)];
        events = [];
        B.turn++;
        emit({ t: 'turn', turn: B.turn, text: `— ${B.turn}턴 —` });

        // 지난 턴의 방어 효과는 새 턴이 시작되면 풀린다
        for (const si of [0, 1]) {
          const m = active(si);
          if (m.protect || m.endure) { m.protect = false; m.endure = false; emitVol(si, m); }
        }

        // 행동 순서 결정 (턴 시작 시점의 속도 기준)
        const queue = acts.map((a, si) => {
          const mon = active(si);
          mon.flinch = false;
          const struggle = a.type === 'move' && a.index === -1;
          const move = a.type === 'move' ? (struggle ? STRUGGLE : mon.moves[a.index]) : null;
          return {
            si, a, struggle, move, mon,
            pri: a.type === 'switch' ? 100 : move.pri || 0,
            speed: speedOf(si),
            tie: rng(),
          };
        }).sort((x, y) => y.pri - x.pri || (field.room > 0 ? x.speed - y.speed : y.speed - x.speed) || y.tie - x.tie);

        const acted = [false, false];
        curActed = acted;
        for (const q of queue) {
          if (B.phase === 'ended') break;
          const mon = active(q.si);
          if (mon !== q.mon || mon.fainted) continue; // 기절한 포켓몬은 행동하지 못한다
          if (q.a.type === 'switch') sendOut(q.si, q.a.to, mon.name);
          else runMove(q.si, q.move, q.struggle, acted);
          acted[q.si] = true;
          if (checkEnd(q.si)) break;
        }

        // 턴 종료 처리
        if (B.phase !== 'ended') {
          endOfTurn();
          checkEnd(null);
        }

        if (B.phase !== 'ended') {
          B.pending = [0, 1].filter(si => active(si).fainted);
          if (B.pending.length) {
            B.phase = 'switch';
            emit({ t: 'needSwitch', sides: B.pending.slice(), text: '다음 포켓몬을 골라야 한다!' });
          } else if (B.turn >= maxTurns) {
            B.phase = 'ended'; B.winner = 'draw';
            emit({ t: 'end', winner: 'draw', text: '무승부!' });
          }
        }
        return drain();
      };

      /** 기절 후 교체 선택 */
      B.replace = function (si, to) {
        if (B.phase !== 'switch' || !B.pending.includes(si)) throw new Error('교체할 차례가 아닙니다.');
        if (!sides[si].party[to] || sides[si].party[to].fainted) throw new Error('교체할 수 없는 대상입니다.');
        events = [];
        sendOut(si, to, null);
        B.pending = B.pending.filter(x => x !== si);
        if (!checkEnd(null)) {
          if (active(si).fainted) {                  // 나오자마자 함정에 쓰러졌다
            B.pending.push(si);
            emit({ t: 'needSwitch', sides: B.pending.slice(), text: '다음 포켓몬을 골라야 한다!' });
          }
          if (!B.pending.length) B.phase = 'move';
        }
        return drain();
      };

      B.snapshot = function () {
        return {
          turn: B.turn, phase: B.phase, winner: B.winner, pending: B.pending.slice(),
          field: { weather: field.weather, terrain: field.terrain, room: field.room },
          sides: sides.map(s => ({
            name: s.name, active: s.active, cond: condView(s.cond),
            party: s.party.map(m => ({
              name: m.name, dataId: m.dataId, tag: m.tag, types: m.types.slice(), hp: m.hp, maxHp: m.maxHp, status: m.status,
              fainted: m.fainted, stages: Object.assign({}, m.stages), confusion: m.confusion, vol: volView(m),
              moves: m.moves.map(mv => ({ id: mv.id, name: mv.name, type: mv.type, cls: mv.cls, power: mv.power, pp: mv.pp, maxPp: mv.maxPp })),
            })),
          })),
        };
      };

      return B;
    }

    return {
      createBattle, makeMon, makeCustomMon, makeMove, calcDamage, estimateDamage,
      typeMultiplier, effectiveStat, describeEffect, statusImmune, healAmountFor, STRUGGLE, josa, mulberry32, data,
    };
  }

  global.createBattleEngine = createEngine;
  global.BattleEngine = global.BATTLE_DATA ? createEngine(global.BATTLE_DATA) : null;
})(typeof window !== 'undefined' ? window : globalThis);
