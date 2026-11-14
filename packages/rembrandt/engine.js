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
  const FIRE = 10, GRASS = 12, ELECTRIC = 13, ICE = 15, POISON = 4, STEEL = 9;
  const STAT_SHORT = { atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드', acc: '명중', eva: '회피' };
  const AIL_KO = { par: '마비', slp: '잠듦', brn: '화상', psn: '독', tox: '맹독', frz: '얼음', cnf: '혼란' };

  /** 타입 때문에 걸리지 않는 상태이상 (전기=마비, 불꽃=화상, 얼음=얼음, 독·강철=독) */
  function statusImmune(mon, kind) {
    if (kind === 'par') return mon.types.includes(ELECTRIC);
    if (kind === 'brn') return mon.types.includes(FIRE);
    if (kind === 'frz') return mon.types.includes(ICE);
    if (kind === 'psn' || kind === 'tox') return mon.types.includes(POISON) || mon.types.includes(STEEL);
    return false;
  }

  /** 변화기 효과를 한 줄로 요약한다 (화면용). 예: '상대 마비' · '공격 +2' · '체력 50% 회복' */
  function describeEffect(move) {
    const fx = move.fx || {}, out = [];
    if (fx.rest) out.push('체력 전부 회복 · 잠듦');
    if (fx.heal) out.push(`체력 ${fx.heal}% 회복`);
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
     */
    function calcDamage(att, def, move, o) {
      o = o || {};
      if (move.cls === 'status') return { damage: 0, eff: 1, crit: false };   // 변화기는 데미지가 없다
      const phys = move.cls === 'phys';
      const atkKey = phys ? 'atk' : 'spa';
      const defKey = (phys || move.fx.useDef) ? 'def' : 'spd';
      const A = effectiveStat(att, atkKey, o.crit ? { crit: true, attacking: true } : null);
      const D = effectiveStat(def, defKey, o.crit ? { crit: true, attacking: false } : null);
      const eff = typeMultiplier(move.type, def.types);
      if (eff === 0) return { damage: 0, eff: 0, crit: !!o.crit };
      let dmg = Math.floor(Math.floor(42 * move.power * A / D) / 50) + 2;
      if (o.crit) dmg = Math.floor(dmg * 1.5);
      dmg = Math.floor(dmg * (o.roll || 100) / 100);
      if (att.types.includes(move.type)) dmg = Math.floor(dmg * 1.5);
      dmg = Math.floor(dmg * eff);
      if (att.status === 'brn' && phys) dmg = Math.floor(dmg * 0.5);
      return { damage: Math.max(1, dmg), eff, crit: !!o.crit };
    }

    /** AI/UI 용 데미지 추정 (급소 제외, 평균 난수) */
    function estimateDamage(att, def, move) {
      if (move.cls === 'status') return { min: 0, max: 0, avg: 0, expected: 0, eff: 1 };
      const lo = calcDamage(att, def, move, { roll: 85 }).damage;
      const hi = calcDamage(att, def, move, { roll: 100 }).damage;
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
      return {
        name: spec.name, dataId: spec.dataId || null, tag: spec.tag || null,
        types: spec.types.slice(), stats: st, maxHp: st.hp, hp: st.hp,
        moves: spec.moves.map(m => Object.assign({}, m, { maxPp: m.maxPp || m.pp, fx: m.fx || {} })),
        status: null, sleepTurns: 0, toxCount: 0, confusion: 0, flinch: false, fainted: false, stages,
      };
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

      const sides = opts.parties.map((party, i) => ({ index: i, name: names[i], party, active: 0 }));
      const B = {
        sides, turn: 0, phase: 'init', winner: null, pending: [], log: [],
        rng,
      };
      let events = [];

      const emit = ev => { events.push(ev); B.log.push(ev); return ev; };
      const text = (msg, extra) => emit(Object.assign({ t: 'text', text: msg }, extra));
      const active = si => sides[si].party[sides[si].active];
      const alive = si => sides[si].party.filter(m => !m.fainted).length;
      const J = josa;

      const sideLabel = si => (si === 0 ? '' : '상대 ');
      const nm = (si, mon) => sideLabel(si) + mon.name;

      function drain() { const e = events; events = []; return e; }

      // ───────── 합법 행동 ─────────
      function legalActions(si) {
        const mon = active(si);
        const moves = mon.moves.map((m, index) => ({ index, name: m.name, pp: m.pp, maxPp: m.maxPp, usable: m.pp > 0 && !mon.fainted }));
        const mustStruggle = !mon.fainted && moves.every(m => !m.usable);
        const switches = [];
        sides[si].party.forEach((m, i) => { if (!m.fainted && i !== sides[si].active) switches.push(i); });
        return { moves, switches, mustStruggle };
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
      function faintCheck(si, mon) {
        if (mon.hp <= 0 && !mon.fainted) {
          mon.fainted = true;
          mon.status = null; mon.confusion = 0;
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
      function inflict(si, mon, kind) {
        if (mon.fainted) return false;
        if (kind === 'cnf') {
          if (mon.confusion > 0) return false;
          mon.confusion = 2 + Math.floor(rng() * 4); // 2~5턴
          emit({ t: 'status', side: si, kind, text: STATUS_TEXT.cnf(nm(si, mon)) });
          return true;
        }
        if (mon.status || immuneToStatus(mon, kind)) return false;
        mon.status = kind;
        if (kind === 'slp') mon.sleepTurns = 2 + Math.floor(rng() * 3); // 행동 불가 1~3턴
        if (kind === 'tox') mon.toxCount = 1;
        emit({ t: 'status', side: si, kind, text: STATUS_TEXT[kind](nm(si, mon)) });
        return true;
      }
      function changeStage(si, mon, stat, change) {
        const cur = mon.stages[stat];
        const label = J(STAT_KO[stat], '이/가');
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

      // ───────── 교체 ─────────
      function resetOnLeave(mon) {
        STAT_KEYS.forEach(k => { mon.stages[k] = 0; });
        mon.confusion = 0; mon.flinch = false;
        if (mon.status === 'tox') mon.toxCount = 1;
      }
      function sendOut(si, to, fromName) {
        const side = sides[si];
        const old = active(si);
        if (!old.fainted) resetOnLeave(old);
        side.active = to;
        const mon = active(si);
        const msg = si === 0
          ? `${fromName ? `돌아와, ${fromName}! ` : ''}가라, ${mon.name}!`
          : `${fromName ? `상대는 ${J(fromName, '을/를')} 불러들였다! ` : ''}상대는 ${J(mon.name, '을/를')} 내보냈다!`;
        emit({ t: 'switch', side: si, to, name: mon.name, hp: mon.hp, maxHp: mon.maxHp, text: msg });
      }

      // ───────── 행동 전 판정 ─────────
      function canAct(si, mon, ctx) {
        if (mon.status === 'frz') {
          if (rng() < 0.2) { mon.status = null; emit({ t: 'status', side: si, kind: 'thaw', text: `${nm(si, mon)}의 얼음이 녹았다!` }); }
          else { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 얼어붙어서 움직일 수 없다!` }); return false; }
        }
        if (mon.status === 'slp') {
          mon.sleepTurns--;
          if (mon.sleepTurns > 0) { emit({ t: 'text', side: si, text: `${J(nm(si, mon), '은/는')} 쿨쿨 잠들어 있다.` }); return false; }
          mon.status = null;
          emit({ t: 'status', side: si, kind: 'wake', text: `${J(nm(si, mon), '은/는')} 눈을 떴다!` });
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

      /** 변화기 사용. 상태이상·능력 변화·회복 (공격기와 같은 부품을 재사용) */
      function runStatusMove(si, move, user) {
        const foe = 1 - si, target = active(foe), fx = move.fx;
        const fail = () => emit({ t: 'text', text: '하지만 실패했다...' });
        const noEffect = () => emit({ t: 'effective', side: foe, eff: 0, text: `${nm(foe, target)}에게는 효과가 없는 것 같다...` });

        if (fx.ail || fx.tgt) {                       // ── 상대에게 거는 기술 ──
          if (target.fainted) return fail();
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
          if (fx.ail && !fx.tgt) {                     // 상태이상만 거는 기술은 이미 걸려 있거나 면역이면 실패
            const kind = fx.ail.kind;
            if (kind === 'cnf' ? target.confusion > 0 : target.status) return fail();
            if (kind !== 'cnf' && immuneToStatus(target, kind)) return noEffect();
          }
          (fx.tgt || []).forEach(c => changeStage(foe, target, c.stat, c.change));
          if (fx.ail) inflict(foe, target, fx.ail.kind);
          return;
        }

        // ── 자신에게 쓰는 기술 ──
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
          if (user.hp >= user.maxHp) return fail();
          heal(si, user, Math.max(1, Math.floor(user.maxHp * fx.heal / 100)), `${J(nm(si, user), '은/는')} 체력을 회복했다!`);
        }
        (fx.self || []).forEach(c => changeStage(si, user, c.stat, c.change));
      }

      function runMove(si, move, struggle, acted) {
        const foe = 1 - si;
        const user = active(si);
        if (!canAct(si, user)) return;
        if (!struggle) move.pp--;
        emit({ t: 'move', side: si, name: move.name, type: move.type, cls: move.cls, text: `${nm(si, user)}의 ${move.name}!` });
        if (move.cls === 'status') return runStatusMove(si, move, user);

        const target = active(foe);
        if (target.fainted) { emit({ t: 'text', text: '하지만 실패했다...' }); return; }

        const fx = move.fx;
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
        let total = 0, landed = 0;
        const critStage = fx.crit === 1 ? 1 : 0;
        for (let i = 0; i < hits && !target.fainted; i++) {
          const crit = fx.crit === 2 || rng() < CRIT_RATE[critStage];
          const roll = 85 + Math.floor(rng() * 16);
          const res = calcDamage(user, target, move, { crit, roll });
          const dealt = applyDamage(foe, target, res.damage);
          total += dealt; landed++;
          emitDamage(foe, target, dealt, { move: move.name, crit, eff });
          if (target.status === 'frz' && move.type === FIRE) { target.status = null; emit({ t: 'status', side: foe, kind: 'thaw', text: `${nm(foe, target)}의 얼음이 녹았다!` }); }
          if (crit) emit({ t: 'crit', side: foe, text: '급소에 맞았다!' });
          if (i === 0 && eff !== 1) {
            emit({ t: 'effective', side: foe, eff, text: eff > 1 ? '효과가 굉장했다!' : '효과가 별로인 듯하다...' });
          }
          faintCheck(foe, target);
        }
        if (hits > 1) emit({ t: 'hits', count: landed, text: `${landed}번 맞았다!` });

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
          if (fx.ail && rng() * 100 < fx.ail.chance) inflict(foe, target, fx.ail.kind);
          (fx.tgt || []).forEach(s => { if (!target.fainted && rng() * 100 < s.chance) changeStage(foe, target, s.stat, s.change); });
        }
        if (landed > 0 && !user.fainted) {
          (fx.self || []).forEach(s => { if (rng() * 100 < s.chance) changeStage(si, user, s.stat, s.change); });
        }
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

      // ───────── 공개 API ─────────
      B.legalActions = legalActions;
      B.active = active;
      B.alive = alive;

      /** 첫 포켓몬 등장 (양쪽 파티의 선두) */
      B.start = function () {
        if (B.phase !== 'init') throw new Error('이미 시작된 배틀입니다.');
        events = [];
        emit({ t: 'text', text: '배틀 시작!' });
        for (let si = 0; si < 2; si++) {
          const mon = active(si);
          emit({ t: 'switch', side: si, to: sides[si].active, name: mon.name, hp: mon.hp, maxHp: mon.maxHp, initial: true,
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

        // 행동 순서 결정 (턴 시작 시점의 속도 기준)
        const queue = acts.map((a, si) => {
          const mon = active(si);
          mon.flinch = false;
          const struggle = a.type === 'move' && a.index === -1;
          const move = a.type === 'move' ? (struggle ? STRUGGLE : mon.moves[a.index]) : null;
          return {
            si, a, struggle, move, mon,
            pri: a.type === 'switch' ? 100 : move.pri || 0,
            speed: effectiveStat(mon, 'spe'),
            tie: rng(),
          };
        }).sort((x, y) => y.pri - x.pri || y.speed - x.speed || y.tie - x.tie);

        const acted = [false, false];
        for (const q of queue) {
          if (B.phase === 'ended') break;
          const mon = active(q.si);
          if (mon !== q.mon || mon.fainted) continue; // 기절한 포켓몬은 행동하지 못한다
          if (q.a.type === 'switch') sendOut(q.si, q.a.to, mon.name);
          else runMove(q.si, q.move, q.struggle, acted);
          acted[q.si] = true;
          if (checkEnd(q.si)) break;
        }

        // 턴 종료 처리: 상태이상 데미지 (스피드 순)
        if (B.phase !== 'ended') {
          const order = [0, 1].sort((x, y) => effectiveStat(active(y), 'spe') - effectiveStat(active(x), 'spe'));
          for (const si of order) {
            const mon = active(si);
            if (mon.fainted) continue;
            let dmg = 0, label = null;
            if (mon.status === 'brn') { dmg = Math.max(1, Math.floor(mon.maxHp / 16)); label = '화상'; }
            else if (mon.status === 'psn') { dmg = Math.max(1, Math.floor(mon.maxHp / 8)); label = '독'; }
            else if (mon.status === 'tox') { dmg = Math.max(1, Math.floor(mon.maxHp * mon.toxCount / 16)); mon.toxCount = Math.min(15, mon.toxCount + 1); label = '독'; }
            if (!label) continue;
            const dealt = applyDamage(si, mon, dmg);
            emitDamage(si, mon, dealt, { cause: mon.status, text: `${J(nm(si, mon), '은/는')} ${label} 데미지를 입고 있다!` });
            faintCheck(si, mon);
          }
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
        if (!B.pending.length) B.phase = 'move';
        return drain();
      };

      B.snapshot = function () {
        return {
          turn: B.turn, phase: B.phase, winner: B.winner, pending: B.pending.slice(),
          sides: sides.map(s => ({
            name: s.name, active: s.active,
            party: s.party.map(m => ({
              name: m.name, dataId: m.dataId, tag: m.tag, types: m.types.slice(), hp: m.hp, maxHp: m.maxHp, status: m.status,
              fainted: m.fainted, stages: Object.assign({}, m.stages), confusion: m.confusion,
              moves: m.moves.map(mv => ({ id: mv.id, name: mv.name, type: mv.type, cls: mv.cls, power: mv.power, pp: mv.pp, maxPp: mv.maxPp })),
            })),
          })),
        };
      };

      return B;
    }

    return {
      createBattle, makeMon, makeCustomMon, makeMove, calcDamage, estimateDamage,
      typeMultiplier, effectiveStat, describeEffect, statusImmune, STRUGGLE, josa, mulberry32, data,
    };
  }

  global.createBattleEngine = createEngine;
  global.BattleEngine = global.BATTLE_DATA ? createEngine(global.BATTLE_DATA) : null;
})(typeof window !== 'undefined' ? window : globalThis);
