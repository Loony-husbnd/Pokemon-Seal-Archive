/**
 * 지옥 난이도의 상대 팀 빌더 — 내 팀(공개 정보)을 보고, 전체 포켓몬 중에서 가장 잘 이기는 3마리와 기술을 직접 짠다.
 *
 *   const B = BattleBoss.create({ E: BattleEngine, AI: BattleAI, PT: BattleParty, data: BATTLE_DATA, learn: BATTLE_LEARN });
 *   const team = await B.build([{ id: 6, moves: [..기술 ID..] }, ...], { rng: Math.random, budgetMs: 6000, onProgress: p => {} });
 *   → [{ id, moves: [기술 ID 4개] } × 3]   (앞에서부터 출전 순서)
 *
 * 원칙: 사람이 같은 규칙에서 할 수 있는 선택만 한다. 능력치는 그대로(Lv.100, 개체값 31, 노력치 0), 기술은 그 포켓몬이 실제로 배울 수 있는 것만,
 * 내 팀은 팀 미리보기로 서로 공개되는 정보다. 사용 순서:
 *   1) 정적 추정으로 후보(종족값 상위 + 탐험 몇 마리)를 점수화 → 2) 1대1 시뮬레이션 → 3) 3마리 조합을 3대3 시뮬레이션으로 비교
 *   → 4) 기술 한두 칸 바꿔 보며 개선 → 5) 출전 순서 비교. 결과는 비슷한 점수 중에서 무작위로 골라 매번 조금씩 다르게 나온다.
 * 외부 대전 데이터는 쓰지 않는다: 엔진에 특성·도구가 없어서 그대로 가져오면 오히려 틀린 판단을 하기 때문이다. 대신 엔진 안에서의 자기대전으로 고른다.
 */
(function (global) {
  'use strict';

  function create(ctx) {
    const { E, AI, PT, data } = ctx, learn = ctx.learn || null;
    const P = data.pokemon, M = data.moves;
    const party = PT.create(data);
    const tick = () => (typeof setTimeout === 'function' ? new Promise(r => setTimeout(r, 0)) : Promise.resolve());     // 브라우저에서는 화면이 멈추지 않게 틈을 준다
    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // 기술 객체 캐시 (추정용). PP 는 넉넉하게 둔다.
    const moveCache = new Map();
    const moveObj = mid => { if (!moveCache.has(mid)) moveCache.set(mid, E.makeMove(mid)); return moveCache.get(mid); };

    const attacksOf = id => (learn && learn[id] ? learn[id].filter(m => M[m] && M[m].c !== 'n') : P[id].m.slice());
    const statusOf = id => (P[id].sm || []).filter(m => M[m]);

    /** 공격기 한 개의 실전 가치 보정 (쓰기 어렵거나 위험한 기술은 낮춘다) */
    function moveWeight(fx) {
      if (fx.selfKO || fx.lastResort || fx.firstTurn || fx.dead || fx.finalGambit || fx.focusPunch || fx.onlySleep) return 0;
      let w = 1;
      if (fx.recharge) w *= 0.7;
      if (fx.charge2) w *= 0.65;
      if (fx.rampage) w *= 0.8;
      if (fx.delay) w *= 0.5;
      if (fx.crash) w *= 0.8;
      if (fx.cantRepeat) w *= 0.85;
      if (fx.needFoeAttack || fx.needFoePriority) w *= 0.6;
      if (fx.counter) w *= 0.5;
      if (fx.ohko) w *= 0.3;
      if (fx.pivot) w *= 1.1;
      if (fx.selfDamagePct) w *= 0.8;
      return w;
    }

    /** 변화기의 대략적인 실전 유용도 (후보 선별용: 0 이면 쓰지 않는다) */
    function statusUtility(mid, p) {
      const fx = M[mid].fx;
      if (fx.dead || fx.splash || fx.perish || fx.transform || fx.metronome || fx.sleepTalk || fx.focus || fx.endure) return 0;
      if (fx.protect) return fx.protect === 'protect' || fx.protect === 'king' || fx.protect === 'spiky' || fx.protect === 'bunker' || fx.protect === 'maxguard' ? 0.8 : 0.1;
      if (fx.heal || fx.rest || fx.wish) return 1.1;
      if (fx.hazard === 'rocks') return 1;
      if (fx.hazard) return 0.5;
      if (fx.weather) return 0.55;
      if (fx.screen || fx.sub || fx.taunt) return 0.6;
      if (fx.ail) return { slp: 1, tox: 0.9, par: 0.8, brn: 0.8, psn: 0.5, cnf: 0.3 }[fx.ail.kind] || 0.3;
      if (fx.self) {
        const rel = { atk: p.b[1] >= p.b[3] ? 1 : 0.2, spa: p.b[3] >= p.b[1] ? 1 : 0.2, spe: 0.8, def: 0.5, spd: 0.5 };
        const ups = fx.self.filter(c => c.change > 0);
        return ups.length ? Math.min(1.2, ups.reduce((a, c) => a + (rel[c.stat] || 0.1) * c.change, 0) / 2) : 0;
      }
      if (fx.pivot || fx.seed || fx.aquaRing || fx.ingrain) return 0.5;
      return 0.1;
    }

    /** 후보 포켓몬 한 마리에 대해 내 팀(foes)을 겨냥한 공격기 구성을 고른다 */
    function pickAttacks(id, foes, extraWeight) {
      const me = E.makeMon(id);
      const list = [];
      for (const mid of attacksOf(id)) {
        const mv = moveObj(mid), w = moveWeight(mv.fx);
        if (!w) continue;
        const dmg = foes.map(f => Math.min(1.2, (E.estimateDamage(me, f, mv).expected / f.maxHp)));
        list.push({ mid, w, dmg, mv });
      }
      const chosen = [];
      const best = foes.map(() => 0);
      while (chosen.length < 3 && list.length) {
        let bi = -1, bs = -1;
        list.forEach((c, i) => {
          if (chosen.includes(c)) return;
          let gain = 0;
          foes.forEach((f, j) => { gain += Math.max(0, c.dmg[j] * c.w - best[j]); });
          const solo = c.dmg.reduce((a, x) => a + x, 0) * c.w * 0.25;                   // 커버 못 해도 센 기술이 우선
          const s = gain + solo + (extraWeight && extraWeight.get(c.mid) || 0);
          if (s > bs) { bs = s; bi = i; }
        });
        if (bi < 0) break;
        const c = list[bi]; chosen.push(c);
        foes.forEach((f, j) => { best[j] = Math.max(best[j], c.dmg[j] * c.w); });
      }
      return chosen.map(c => c.mid);
    }

    /** 정적 추정: 내 팀을 상대로 한 1대1 유불리 점수 (클수록 좋다) */
    function staticScore(id, moves, foes) {
      const me = E.makeMon(id, { moves });
      let total = 0;
      for (const f of foes) {
        const mine = Math.max(0, ...me.moves.map(m => E.estimateDamage(me, f, m).expected)) / f.maxHp;
        const theirs = Math.max(0, ...f.moves.map(m => E.estimateDamage(f, me, m).expected)) / me.maxHp;
        const faster = E.effectiveStat(me, 'spe') > E.effectiveStat(f, 'spe');
        total += clamp(mine, 0, 1.5) - clamp(theirs, 0, 1.5) + (faster ? 0.15 : 0) + 0.2 * Math.min(1, mine) * (faster ? 1 : 0.6);
      }
      return total / foes.length;
    }

    /** 이 포켓몬의 4번째 칸으로 쓸 만한 변화기 후보들 */
    function statusCandidates(id, n) {
      const p = P[id], rec = new Set(p.ss || []);
      return statusOf(id).map(mid => ({ mid, u: statusUtility(mid, p) * (rec.has(mid) ? 1.6 : 1) })).filter(c => c.u > 0.2)
        .sort((a, b) => b.u - a.u).slice(0, n).map(c => c.mid);
    }

    // ───────────── 시뮬레이션 ─────────────
    const mkMons = team => team.map(t => E.makeMon(t.id, { moves: t.moves }));
    function simulate(playerTeam, bossTeam, seed) {
      const bt = E.createBattle({ parties: [mkMons(playerTeam), mkMons(bossTeam)], seed, maxTurns: 100 });
      const a = AI.create(E, { seed }), b = AI.create(E, { seed: seed + 5 });
      bt.start();
      let guard = 0;
      while (bt.phase !== 'ended' && ++guard < 400) {
        if (bt.phase === 'switch') { for (const p of bt.pending.slice()) if (bt.phase === 'switch' && bt.pending.includes(p)) bt.replace(p, (p === 0 ? a : b).chooseReplacement(bt, p, 'hard')); continue; }
        bt.playTurn(a.chooseAction(bt, 0, 'hard'), b.chooseAction(bt, 1, 'hard'));
      }
      if (bt.phase !== 'ended') {
        const hp = s => bt.sides[s].party.reduce((x, m) => x + (m.fainted ? 0 : m.hp / m.maxHp), 0);
        return clamp(0.5 + (hp(1) - hp(0)) / 6, 0, 1);
      }
      return bt.winner === 1 ? 1 : bt.winner === 0 ? 0 : 0.5;
    }
    const winRate = (playerTeam, bossTeam, n, seed0) => { let s = 0; for (let i = 0; i < n; i++) s += simulate(playerTeam, bossTeam, seed0 + i * 31); return s / n; };

    // ───────────── 후보 풀 ─────────────
    // 플레이어가 고를 수 있는 모든 포켓몬(무한다이맥스·원시회귀·왕관 폼 등 포함)이 후보다. 사람이 할 수 있는 선택은 AI 도 할 수 있어야 한다.
    // 같은 종은 폼마다 속성·능력이 다르므로 종족값 상위 2개 폼까지 남긴다 (3마리 조합에서는 종 중복이 걸러진다).
    const candidatePool = () => {
      const ids = party.fullPool.filter(id => P[id].m.length >= 1);
      const bySpecies = new Map();
      for (const id of ids) { const sp = P[id].sp; if (!bySpecies.has(sp)) bySpecies.set(sp, []); bySpecies.get(sp).push(id); }
      const out = [];
      for (const list of bySpecies.values()) out.push(...list.sort((a, b) => P[b].bst - P[a].bst).slice(0, 2));
      return out;
    };

    /**
     * 내 팀에 가장 잘 맞는 3마리를 짠다. 오래 걸릴 수 있어 비동기로 조금씩 진행한다.
     * @param playerTeam [{ id, moves }] 내 팀(출전 순서)
     * @param o.rng 난수(다양성) / o.budgetMs 전체 예산 / o.onProgress(0~1, 메시지)
     */
    async function build(playerTeam, o) {
      o = o || {};
      const rng = o.rng || Math.random, budget = o.budgetMs || 6000, t0 = nowMs();
      const progress = (f, msg) => { if (o.onProgress) o.onProgress(f, msg); };
      const left = () => budget - (nowMs() - t0);
      const foes = mkMons(playerTeam);
      const all = candidatePool().sort((a, b) => P[b].bst - P[a].bst);
      const mySp = new Set(playerTeam.map(t => P[t.id].sp));

      // 1) 정적 추정 — 종족값 상위 + 탐험 몇 마리
      progress(0.03, '내 팀을 분석하는 중…');
      const top = all.slice(0, 260), rest = all.slice(260);
      const explore = []; for (let i = 0; i < 24 && rest.length; i++) explore.push(rest[Math.floor(rng() * rest.length)]);
      const scored = [];
      let n = 0;
      for (const id of top.concat(explore)) {
        const moves = pickAttacks(id, foes);
        if (!moves.length) continue;
        scored.push({ id, moves, s: staticScore(id, moves, foes) + (rng() - 0.5) * 0.12 });      // 약간의 잡음으로 단골만 나오지 않게
        if (++n % 40 === 0) await tick();
      }
      scored.sort((a, b) => b.s - a.s);

      // 2) 1대1 시뮬레이션으로 상위 후보를 다시 거른다 (같은 종·같은 타입 몰림은 나중에 조합 단계에서 걸러진다)
      progress(0.2, '후보 1대1 대결 중…');
      const shortN = 40, shortlist = scored.slice(0, shortN);
      for (let i = 0; i < shortlist.length; i++) {
        const c = shortlist[i];
        let w = 0;
        for (let j = 0; j < playerTeam.length; j++) w += winRate([playerTeam[j]], [{ id: c.id, moves: c.moves }], 3, 100 + i * 7 + j);
        c.duel = w / playerTeam.length;
        c.rank = c.s + c.duel * 1.4;
        if (i % 6 === 5) await tick();
      }
      shortlist.sort((a, b) => b.rank - a.rank);
      const pickN = left() > budget * 0.6 ? 12 : left() > budget * 0.4 ? 10 : 8;
      const finalists = shortlist.slice(0, pickN);

      // 3) 3마리 조합을 3대3 으로 비교
      progress(0.4, '조합을 비교하는 중…');
      const trios = [];
      for (let a = 0; a < finalists.length; a++) for (let b = a + 1; b < finalists.length; b++) for (let c = b + 1; c < finalists.length; c++) trios.push([finalists[a], finalists[b], finalists[c]]);
      const ok = trio => new Set(trio.map(t => P[t.id].sp)).size === 3 && trio.every(t => !mySp.has(P[t.id].sp) || true);
      const evalTrios = [];
      const simsPer = left() > budget * 0.5 ? 5 : 3;
      let ti = 0;
      for (const trio of trios.filter(ok)) {
        const bossTeam = trio.map(t => ({ id: t.id, moves: t.moves }));
        const wr = winRate(playerTeam, bossTeam, simsPer, 500 + ti * 13);
        // 속성이 한쪽으로 몰리면 약간 감점 (같은 약점을 공유하면 한 번에 무너진다)
        const types = trio.flatMap(t => P[t.id].t), dup = types.length - new Set(types).size;
        evalTrios.push({ trio, wr, adj: wr - dup * 0.015 + (rng() - 0.5) * 0.02 });
        if (++ti % 6 === 0) { await tick(); progress(0.4 + 0.3 * ti / trios.length, '조합을 비교하는 중…'); }
        if (left() < budget * 0.35) break;
      }
      evalTrios.sort((a, b) => b.adj - a.adj);
      const near = evalTrios.filter(t => t.adj >= evalTrios[0].adj - 0.03).slice(0, 4);      // 비슷한 점수면 무작위로 골라 다양하게
      let best = near[Math.floor(rng() * near.length)] || evalTrios[0];
      let team = best.trio.map(t => ({ id: t.id, moves: t.moves.slice() }));

      // 4) 기술 개선: 각 포켓몬의 남는 칸(공격기 3개 + 1칸)에 변화기/네 번째 공격기 후보를 넣어 보고 이기는 쪽을 택한다
      progress(0.72, '기술 구성을 다듬는 중…');
      for (let k = 0; k < team.length && left() > budget * 0.12; k++) {
        const id = team[k].id;
        const atkList = pickAttacks(id, foes);
        const options = [];
        const fourthAtk = attacksOf(id).filter(m => !atkList.includes(m) && moveWeight(M[m].fx) > 0).slice(0, 2);
        for (const m of statusCandidates(id, 4).concat(fourthAtk)) options.push(m);
        let bestSet = atkList.concat(); let bestWr = -1;
        const variants = [atkList.slice(0, 4)].concat(options.map(m => atkList.slice(0, 3).concat(m)));
        for (const v of variants) {
          const trial = team.map((t, j) => (j === k ? { id, moves: v } : t));
          const wr = winRate(playerTeam, trial, 5, 900 + k * 17);
          if (wr > bestWr + 1e-9) { bestWr = wr; bestSet = v; }
          if (left() < budget * 0.1) break;
        }
        team[k] = { id, moves: bestSet.slice(0, 4) };
        await tick();
      }

      // 5) 출전 순서
      progress(0.9, '출전 순서를 정하는 중…');
      const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
      let bestOrder = orders[0], bestW = -1;
      for (const ord of orders) {
        if (left() < 0 && bestW >= 0) break;
        const w = winRate(playerTeam, ord.map(i => team[i]), 5, 1300);
        if (w > bestW + 1e-9) { bestW = w; bestOrder = ord; }
      }
      team = bestOrder.map(i => team[i]);
      // 기술이 4개 미만이면 대표 공격기로 채운다
      team.forEach(t => { for (const m of P[t.id].m) if (t.moves.length < 4 && !t.moves.includes(m)) t.moves.push(m); });
      progress(1, '완료');
      return team;
    }

    return { build, pickAttacks, staticScore, simulate, winRate, candidatePool };
  }

  global.BattleBoss = { create };
})(typeof window !== 'undefined' ? window : globalThis);
