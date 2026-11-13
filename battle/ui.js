/**
 * 배틀 UI (4단계) — #view-battle 에 파티 편성 → 상대 공개 → 배틀 → 결과 화면을 그린다.
 *
 * 의존: battle-data.js, engine.js, ai.js, party.js  +  index.html 의 전역
 *   (sealDatabase, getSealImageUrl, getTargetPokemonFormId, getArtworkUrlById, handleSealImageError,
 *    matchesChosungOrText, showToast, showConfirmDialog, switchNavTab)
 * index.html 의 switchNavTab('battle') 이 BattleUI.show() 를 호출한다.
 */
(function () {
  'use strict';

  const KEY = 'pokemon_seal_battle_v1';
  const TYPE_COLORS = [null, '#A8A77A', '#C22E28', '#8F7BE8', '#A33EA1', '#D9B24B', '#B6A136', '#A6B91A', '#735797', '#8E8EAE',
    '#EE8130', '#6390F0', '#5DB52E', '#EBC81E', '#F95587', '#6FCBC7', '#6F35FC', '#705746', '#D685AD'];
  const LIGHT_TEXT = new Set([13, 15]);   // 밝은 배경이라 어두운 글자를 쓰는 속성
  const STAT_KO = { atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드', acc: '명중', eva: '회피' };
  const STATUS_KO = { par: '마비', brn: '화상', psn: '독', tox: '맹독', slp: '잠듦', frz: '얼음' };
  const LEVELS = {
    easy:   { label: '쉬움',   desc: '상대 파티가 약하고 실수도 잦아요.' },
    normal: { label: '보통',   desc: '내 파티와 비슷한 강도, 대체로 최선의 수를 둬요.' },
    hard:   { label: '어려움', desc: '상대 파티가 더 강하고 늘 최선의 수를 둬요.' },
  };

  let E = null, AIlib = null, PT = null, PRT = null, brain = null;
  let root = null, mounted = false;

  // ───────────── 상태 ─────────────
  const S = {
    screen: 'select',          // select | preview | battle
    level: 'normal',
    party: [],                 // 씰 ID 3개
    opp: [],                   // 상대 데이터 ID 3개
    q: '', sort: 'bst',
    speed: 1, skip: false, hints: true, showHistory: false,
    record: { w: 0, l: 0, d: 0, byLevel: { easy: [0, 0, 0], normal: [0, 0, 0], hard: [0, 0, 0] } },
    battle: null, U: null, busy: false, entries: [], curMove: null, log: [], finished: false,
  };

  // ───────────── 공통 도우미 ─────────────
  const $ = (sel, el) => (el || root).querySelector(sel);
  const escFallback = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = v => (typeof escapeHtml === 'function' ? escapeHtml(v) : escFallback(v));   // index.html 의 escapeHtml 재사용
  const D = () => window.BATTLE_DATA;
  const fmt = n => Number(n).toLocaleString('ko-KR');
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  const refreshIcons = () => { if (window.lucide && lucide.createIcons) lucide.createIcons(); };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw) {
        if (LEVELS[raw.level]) S.level = raw.level;
        if (Array.isArray(raw.party)) S.party = raw.party.slice(0, 3);
        if (raw.speed) S.speed = [1, 2, 3].includes(raw.speed) ? raw.speed : 1;
        if (typeof raw.hints === 'boolean') S.hints = raw.hints;
        if (raw.record) S.record = Object.assign(S.record, raw.record);
      }
    } catch (e) { /* 저장소를 못 읽어도 동작에는 지장 없음 */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ level: S.level, party: S.party, speed: S.speed, hints: S.hints, record: S.record })); } catch (e) { /* noop */ }
  }

  const typeColor = id => TYPE_COLORS[id] || '#64748b';
  const typeChip = id => `<span class="bt-type${LIGHT_TEXT.has(id) ? ' light' : ''}" style="background:${typeColor(id)}">${esc(D().types[id - 1].k)}</span>`;
  const typeChips = ids => ids.map(typeChip).join(' ');
  const moveChips = p => `<div class="bt-movechips">${p.m.map(mid => {
    const m = D().moves[mid];
    return `<span class="bt-movechip" style="background:${typeColor(m.t)}${LIGHT_TEXT.has(m.t) ? ';color:#1e293b' : ''}">${esc(m.k)}</span>`;
  }).join('')}</div>`;

  function artworkUrl(id) {
    if (typeof getArtworkUrlById === 'function') return getArtworkUrlById(id);
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
  }
  function imgTag(url, id, dex, alt) {
    const err = typeof handleSealImageError === 'function'
      ? `handleSealImageError(this, ${Number(id) || 0}, ${Number(dex) || 1})`
      : "this.style.visibility='hidden'";
    return `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="${err}">`;
  }

  // ───────────── 씰 → 배틀 포켓몬 ─────────────
  function resolveId(seal) {
    const dex = Number(seal.pokedex_number) || 0;
    let id = dex;
    try {
      if (typeof getTargetPokemonFormId === 'function') {
        id = getTargetPokemonFormId({
          pokedex_number: dex, regional_form: seal.regional_form, is_mega: seal.is_mega,
          mega_variant: seal.mega_variant, is_gmax: seal.is_gmax, alt_form: seal.alt_form,
        });
      }
    } catch (e) { id = dex; }
    if (!D().pokemon[id]) id = dex;
    return D().pokemon[id] ? id : null;
  }

  let candCache = null;
  const invalidateCandidates = () => { candCache = null; };
  /** 같은 렌더 사이클 안에서는 한 번만 계산한다 (탭 진입/컬렉션 변경 시 무효화) */
  const candidates = () => candCache || (candCache = buildCandidates());

  function buildCandidates() {
    const seals = typeof sealDatabase !== 'undefined' && Array.isArray(sealDatabase) ? sealDatabase : [];
    const out = [];
    for (const seal of seals) {
      const id = resolveId(seal);
      if (!id) continue;
      const p = D().pokemon[id];
      out.push({
        seal, id, p, sp: p.sp, name: seal.pokemon_name || p.k, dex: Number(seal.pokedex_number) || p.sp,
        img: typeof getSealImageUrl === 'function' ? getSealImageUrl(seal) : artworkUrl(id),
      });
    }
    return out;
  }

  const partyEntries = () => {
    const all = candidates();
    return S.party.map(sid => all.find(c => c.seal.id === sid)).filter(Boolean);
  };

  // ═════════════════════ 파티 편성 화면 ═════════════════════
  function renderSelect() {
    S.screen = 'select';
    root.innerHTML = `
      <div class="space-y-4">
        <div class="rounded-2xl p-4 sm:p-5 text-white bg-gradient-to-br from-indigo-600 via-violet-600 to-rose-500 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-black flex items-center gap-2"><i data-lucide="swords" class="w-5 h-5"></i>띠부씰 배틀</h2>
            <p class="text-xs text-indigo-100 mt-1 leading-relaxed">내 띠부씰 3마리로 싸우는 3:3 턴제 배틀 · 전원 Lv.100 · 포켓몬마다 대표 공격기 4개 · 파티 종족값 합계 ${fmt(PRT.cap)} 이하</p>
          </div>
          <div id="bt-record" class="flex gap-2 text-center"></div>
        </div>
        <div class="grid lg:grid-cols-5 gap-4">
          <section class="lg:col-span-2 space-y-3" id="bt-left"></section>
          <section class="lg:col-span-3 bt-card p-3 sm:p-4" id="bt-right"></section>
        </div>
      </div>`;
    renderRecord();
    renderParty();
    renderPickerShell();
    refreshIcons();
  }

  function renderRecord() {
    const el = $('#bt-record');
    if (!el) return;
    const r = S.record, box = (v, label, cls) => `<div class="px-3 py-1.5 rounded-xl bg-white/15 border border-white/20"><div class="text-base font-black ${cls}">${v}</div><div class="text-[10px] text-indigo-100 font-bold">${label}</div></div>`;
    el.innerHTML = box(r.w, '승', 'text-amber-200') + box(r.l, '패', '') + box(r.d, '무', '');
  }

  function renderParty() {
    const left = $('#bt-left');
    if (!left) return;
    const entries = partyEntries();
    S.party = entries.map(e => e.seal.id);                       // 삭제된 씰 정리
    const ids = entries.map(e => e.id);
    const check = PRT.validate(ids);
    const total = check.total, ratio = Math.min(1, total / PRT.cap);
    const meterCls = total > PRT.cap ? 'over' : ratio > 0.9 ? 'warn' : '';
    const errors = check.errors.filter(m => !(entries.length < 3 && /3마리/.test(m)));
    const ready = check.ok && entries.length === 3;

    const slots = [0, 1, 2].map(i => {
      const e = entries[i];
      if (!e) return `<div class="bt-slot"><span class="bt-slot-no">${i + 1}번</span><i data-lucide="plus-circle" class="w-6 h-6 text-slate-300"></i><div class="text-[11px] font-bold text-slate-400 mt-1">오른쪽에서<br>띠부씰을 골라요</div></div>`;
      const [hp, at, df, sa, sd, sp] = e.p.s;
      return `<div class="bt-slot filled" data-slot="${i}">
        <span class="bt-slot-no">${i === 0 ? '선봉' : i + 1 + '번'}</span>
        <div class="bt-slot-actions">
          <button class="bt-icon-btn" data-act="move-left" data-i="${i}" title="앞으로" ${i === 0 ? 'disabled' : ''}>◀</button>
          <button class="bt-icon-btn" data-act="move-right" data-i="${i}" title="뒤로" ${i === entries.length - 1 ? 'disabled' : ''}>▶</button>
          <button class="bt-icon-btn" data-act="remove" data-i="${i}" title="빼기">✕</button>
        </div>
        ${imgTag(e.img, e.id, e.dex, e.name)}
        <div class="text-xs font-black text-slate-900 mt-1 leading-tight">${esc(e.name)}</div>
        <div class="mt-1">${typeChips(e.p.t)}</div>
        <div class="text-[10px] text-slate-500 font-bold mt-1">종족값 ${e.p.bst}</div>
        <div class="text-[9px] text-slate-400 font-mono mt-0.5">HP${hp} 공${at} 방${df}<br>특공${sa} 특방${sd} 스${sp}</div>
      </div>`;
    }).join('');

    left.innerHTML = `
      <div class="bt-card p-3 sm:p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-black text-slate-900">내 파티 <span class="text-indigo-600">${entries.length}/3</span></h3>
          <button class="bt-btn !py-1 !px-2.5 !text-[11px]" data-act="auto">자동 편성</button>
        </div>
        <div class="grid grid-cols-3 gap-2">${slots}</div>
        <div class="mt-3">
          <div class="flex items-center justify-between text-[11px] font-bold mb-1">
            <span class="text-slate-500">종족값 합계</span>
            <span class="${total > PRT.cap ? 'text-rose-600' : 'text-slate-800'}">${fmt(total)} / ${fmt(PRT.cap)}</span>
          </div>
          <div class="bt-meter ${meterCls}"><i style="width:${Math.max(0, ratio * 100)}%"></i></div>
          ${errors.length ? `<ul class="mt-2 text-[11px] text-rose-600 font-bold space-y-0.5">${errors.map(m => `<li>· ${esc(m)}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
      <div class="bt-card p-3 sm:p-4">
        <h3 class="text-sm font-black text-slate-900 mb-2">난이도</h3>
        <div class="bt-seg" role="tablist">${Object.keys(LEVELS).map(k => `<button data-act="level" data-v="${k}" class="${S.level === k ? 'on' : ''}">${LEVELS[k].label}</button>`).join('')}</div>
        <p class="text-[11px] text-slate-500 mt-2 leading-relaxed">${esc(LEVELS[S.level].desc)}<br><span class="text-slate-400">상대 파티 종족값 합계 ≈ 내 합계 ${PT.OFFSET[S.level] >= 0 ? '+' : '−'}${Math.abs(PT.OFFSET[S.level])}</span></p>
      </div>
      <button class="bt-btn primary w-full !py-3 !text-sm" data-act="start" ${ready ? '' : 'disabled'}>${ready ? '배틀 준비!' : '파티를 완성해 주세요'}</button>`;
    refreshIcons();
  }

  function renderPickerShell() {
    const right = $('#bt-right');
    right.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <h3 class="text-sm font-black text-slate-900 flex-1">내 띠부씰에서 고르기 <span id="bt-count" class="text-xs text-slate-400 font-bold"></span></h3>
        <input id="bt-q" type="search" placeholder="이름·초성 검색 (예: ㅍㅋㅊ)" value="${esc(S.q)}" class="w-full sm:w-52 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300">
        <select id="bt-sort" class="text-xs px-2 py-2 rounded-lg border border-slate-200 bg-white">
          <option value="bst" ${S.sort === 'bst' ? 'selected' : ''}>종족값 높은 순</option>
          <option value="name" ${S.sort === 'name' ? 'selected' : ''}>이름순</option>
          <option value="dex" ${S.sort === 'dex' ? 'selected' : ''}>도감번호순</option>
        </select>
      </div>
      <div id="bt-grid" class="bt-grid"></div>`;
    renderPicker();
  }

  function renderPicker() {
    const grid = $('#bt-grid');
    if (!grid) return;
    let list = candidates();
    const total = list.length;
    const q = S.q.trim();
    if (q) {
      const match = typeof matchesChosungOrText === 'function' ? matchesChosungOrText : (t, s) => String(t).includes(s);
      list = list.filter(c => match(c.name, q) || match(c.p.k, q));
    }
    const cmp = { bst: (a, b) => b.p.bst - a.p.bst || a.dex - b.dex, name: (a, b) => a.name.localeCompare(b.name, 'ko'), dex: (a, b) => a.dex - b.dex || b.p.bst - a.p.bst };
    list.sort(cmp[S.sort] || cmp.bst);
    const cnt = $('#bt-count');
    if (cnt) cnt.textContent = `· ${list.length}${q ? `/${total}` : ''}장`;

    if (!total) {
      grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-400"><div class="text-3xl mb-2">📭</div><div class="text-sm font-bold text-slate-500">등록된 띠부씰이 없어요</div><div class="text-xs mt-1">도감 아카이브에서 띠부씰을 등록하면 배틀에 쓸 수 있어요.</div></div>`;
      return;
    }
    if (!list.length) { grid.innerHTML = `<div class="col-span-full text-center py-10 text-xs text-slate-400 font-bold">검색 결과가 없어요.</div>`; return; }

    const selected = new Set(S.party);
    const pEntries = partyEntries();
    const partyTotal = pEntries.reduce((s, e) => s + e.p.bst, 0);
    const partySp = new Set(pEntries.map(e => e.sp));
    grid.innerHTML = list.map(c => {
      const sel = selected.has(c.seal.id);
      let dis = false, why = '';
      if (!sel) {
        if (pEntries.length >= 3) { dis = true; why = '파티 가득'; }
        else if (partySp.has(c.sp)) { dis = true; why = '같은 종'; }
        else if (partyTotal + c.p.bst > PRT.cap) { dis = true; why = '상한 초과'; }
      }
      return `<button class="bt-pick${sel ? ' sel' : ''}${dis ? ' dis' : ''}" data-act="pick" data-id="${esc(c.seal.id)}" ${dis ? `title="${esc(why)}"` : ''}>
        ${sel ? '<span class="bt-tag">선택</span>' : dis && why !== '파티 가득' ? `<span class="bt-tag no">${esc(why)}</span>` : ''}
        ${imgTag(c.img, c.id, c.dex, c.name)}
        <div class="text-xs font-black text-slate-900 mt-1 leading-tight">${esc(c.name)}</div>
        <div class="mt-1">${typeChips(c.p.t)}</div>
        <div class="text-[10px] text-slate-500 font-bold mt-1">종족값 ${c.p.bst}</div>
        ${moveChips(c.p)}
      </button>`;
    }).join('');
  }

  function togglePick(sealId) {
    const all = candidates();
    const c = all.find(x => x.seal.id === sealId);
    if (!c) return;
    if (S.party.includes(sealId)) { S.party = S.party.filter(x => x !== sealId); }
    else {
      const cur = partyEntries();
      if (cur.length >= 3) return toast('파티가 가득 찼어요. 먼저 한 마리를 빼 주세요.', 'warning');
      if (cur.some(e => e.sp === c.sp)) return toast('같은 종류의 포켓몬은 한 파티에 한 마리만 넣을 수 있어요.', 'warning');
      if (cur.reduce((s, e) => s + e.p.bst, 0) + c.p.bst > PRT.cap) return toast(`종족값 합계가 상한(${PRT.cap})을 넘어요.`, 'warning');
      S.party = cur.map(e => e.seal.id).concat(sealId);
    }
    save(); renderParty(); renderPicker();
  }

  /** 종족값 합계가 상한 이하에서 가장 큰 서로 다른 3마리 (전체 후보 대상 투 포인터 탐색) */
  function autoParty() {
    const best = new Map();
    for (const c of candidates()) { const k = c.sp; if (!best.has(k) || c.p.bst > best.get(k).p.bst) best.set(k, c); }
    const arr = [...best.values()].sort((a, b) => a.p.bst - b.p.bst);
    if (arr.length < 3) return toast('서로 다른 포켓몬 띠부씰이 3종 이상 필요해요.', 'warning');
    let top = null;
    for (let i = 0; i < arr.length - 2; i++) {
      let j = i + 1, k = arr.length - 1;
      while (j < k) {
        const t = arr[i].p.bst + arr[j].p.bst + arr[k].p.bst;
        if (t <= PRT.cap) { if (!top || t > top.t) top = { t, set: [arr[i], arr[j], arr[k]] }; j++; } else k--;
      }
    }
    if (!top) return toast(`종족값 합계 ${PRT.cap} 이하로 만들 수 있는 조합이 없어요.`, 'warning');
    S.party = top.set.map(c => c.seal.id);
    save(); renderParty(); renderPicker();
    toast(`추천 파티 완성! (종족값 합계 ${top.t})`, 'success');
  }

  // ═════════════════════ 상대 공개(VS) 화면 ═════════════════════
  function newOpponent() {
    const ids = partyEntries().map(e => e.id);
    S.opp = PRT.generateOpponent({ playerIds: ids, level: S.level, rng: Math.random });
  }

  function renderPreview() {
    S.screen = 'preview';
    const mine = partyEntries();
    const myTotal = mine.reduce((s, e) => s + e.p.bst, 0), oppTotal = PRT.total(S.opp);
    const card = (name, img, p) => `<div class="bt-vs-card">${img}<div class="text-xs font-black text-slate-900 mt-1">${esc(name)}</div><div class="mt-1">${typeChips(p.t)}</div><div class="text-[10px] text-slate-500 font-bold mt-1">종족값 ${p.bst}</div>${moveChips(p)}</div>`;
    root.innerHTML = `
      <div class="max-w-3xl mx-auto space-y-4">
        <div class="bt-card p-4 sm:p-5">
          <div class="text-center mb-3"><span class="text-[11px] font-black px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">난이도 ${esc(LEVELS[S.level].label)}</span></div>
          <div class="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
            <div>
              <div class="text-xs font-black text-slate-700 mb-2 text-center">내 파티 <span class="text-slate-400 font-bold">· ${fmt(myTotal)}</span></div>
              <div class="grid gap-2">${mine.map(e => card(e.name, imgTag(e.img, e.id, e.dex, e.name), e.p)).join('')}</div>
            </div>
            <div class="bt-vs self-center">VS</div>
            <div>
              <div class="text-xs font-black text-slate-700 mb-2 text-center">상대 파티 <span class="text-slate-400 font-bold">· ${fmt(oppTotal)}</span></div>
              <div class="grid gap-2">${S.opp.map(id => card(PRT.displayName(id), imgTag(artworkUrl(id), id, D().pokemon[id].sp, PRT.displayName(id)), D().pokemon[id])).join('')}</div>
            </div>
          </div>
          <p class="text-center text-[11px] text-slate-400 font-bold mt-3">선봉(맨 위)이 가장 먼저 나가요 · 상대 파티 종족값 ${oppTotal - myTotal >= 0 ? '+' : '−'}${Math.abs(oppTotal - myTotal)}</p>
          <div class="flex flex-wrap gap-2 justify-center mt-4">
            <button class="bt-btn" data-act="back">← 파티 수정</button>
            <button class="bt-btn" data-act="reroll">상대 다시 뽑기</button>
            <button class="bt-btn primary" data-act="fight">출전!</button>
          </div>
        </div>
      </div>`;
    refreshIcons();
  }

  // ═════════════════════ 배틀 화면 ═════════════════════
  function sealToMon(entry) {
    return E.makeMon(entry.id, { name: entry.name, tag: entry.seal.id });
  }

  function startBattle() {
    const mine = partyEntries();
    if (mine.length !== 3 || S.opp.length !== 3) return;
    const parties = [mine.map(sealToMon), S.opp.map(id => E.makeMon(id, { name: PRT.displayName(id) }))];
    const seed = Math.floor(Math.random() * 2 ** 31);
    S.battle = E.createBattle({ parties, names: ['나', '상대'], seed });
    brain = AIlib.create(E, { seed: seed ^ 0x9e3779b9 });
    S.entries = mine;
    S.log = []; S.finished = false; S.busy = true; S.skip = false; S.showHistory = false; S.curMove = null;

    // UI 미러: 이벤트를 따라 갱신되는 화면용 상태
    S.U = { turn: 0, side: [0, 1].map(si => ({
      active: 0,
      party: parties[si].map((m, i) => ({
        name: m.name, types: m.types.slice(), maxHp: m.maxHp, hp: m.maxHp, fainted: false, status: null, confusion: false, stages: {},
        img: si === 0 ? mine[i].img : artworkUrl(m.dataId), id: m.dataId, dex: si === 0 ? mine[i].dex : D().pokemon[m.dataId].sp,
      })),
    })) };

    renderBattleShell();
    renderSide(0, true); renderSide(1, true);
    const intro = S.battle.start();
    playEvents(intro).then(() => beginTurn()).catch(recover);
  }

  function renderBattleShell() {
    S.screen = 'battle';
    root.innerHTML = `
      <div class="max-w-4xl mx-auto">
        <div class="relative">
          <div class="bt-arena" id="bt-arena">
            <div class="bt-platform foe"></div><div class="bt-platform me"></div>
            <div class="bt-sprite foe idle hidden-mon" id="bt-spr-foe">${'<img alt="">'}<div class="bt-fallback"></div></div>
            <div class="bt-sprite me idle hidden-mon" id="bt-spr-me">${'<img alt="">'}<div class="bt-fallback"></div></div>
            <div class="bt-box foe" id="bt-box-foe"></div>
            <div class="bt-box me" id="bt-box-me"></div>
            <div class="bt-fx" id="bt-fx"></div>
            <div class="bt-turn" id="bt-turn">배틀 준비</div>
            <div class="bt-tools">
              <button id="bt-speed" data-act="speed" title="재생 속도">${S.speed}x</button>
              <button data-act="skip" title="연출 건너뛰기">⏭</button>
              <button id="bt-hist-btn" data-act="history" title="전투 기록">기록</button>
            </div>
          </div>
          <div id="bt-result-host"></div>
        </div>
        <div class="bt-text" id="bt-text" aria-live="polite"><span class="bt-line">배틀 시작!</span></div>
        <div id="bt-history" class="bt-history hidden"></div>
        <div id="bt-controls"></div>
      </div>`;
    for (const key of ['foe', 'me']) {
      const img = $(`#bt-spr-${key} img`);
      img.addEventListener('error', () => {
        const si = key === 'me' ? 0 : 1, mon = S.U && S.U.side[si].party[S.U.side[si].active];
        if (typeof handleSealImageError === 'function' && mon && !img.dataset.fb) {
          img.dataset.fb = '1';
          handleSealImageError(img, mon.id, mon.dex);
        } else $(`#bt-spr-${key}`).classList.add('noimg');
      });
    }
  }

  const spriteEl = si => $(si === 0 ? '#bt-spr-me' : '#bt-spr-foe');
  const boxEl = si => $(si === 0 ? '#bt-box-me' : '#bt-box-foe');

  function hpClass(ratio) { return ratio <= 0.2 ? 'low' : ratio <= 0.5 ? 'mid' : ''; }

  function renderSide(si, withSprite) {
    const side = S.U.side[si], mon = side.party[side.active];
    const ratio = mon.maxHp ? mon.hp / mon.maxHp : 0;
    const chips = [];
    if (mon.status) chips.push(`<span class="bt-chip ${mon.status}">${STATUS_KO[mon.status]}</span>`);
    if (mon.confusion) chips.push('<span class="bt-chip cnf">혼란</span>');
    for (const k of Object.keys(mon.stages)) {
      const v = mon.stages[k];
      if (v) chips.push(`<span class="bt-chip ${v > 0 ? 'up' : 'down'}">${STAT_KO[k]} ${v > 0 ? '▲' : '▼'}${Math.abs(v)}</span>`);
    }
    const dots = side.party.map((m, i) => `<i class="${m.fainted ? 'ko' : ''}${i === side.active ? ' cur' : ''}" title="${esc(m.name)}"></i>`).join('');
    boxEl(si).innerHTML = `
      <div class="bt-name"><span>${esc(mon.name)}</span><small>Lv.100</small><span class="ml-auto">${typeChips(mon.types)}</span></div>
      <div class="bt-hp"><b>HP</b><div class="bt-hpbar"><i class="${hpClass(ratio)}" style="width:${(ratio * 100).toFixed(1)}%"></i></div></div>
      ${si === 0 ? `<div class="bt-hpnum"><span class="bt-hpcur">${mon.hp}</span> / ${mon.maxHp}</div>` : ''}
      <div class="flex items-center justify-between"><div class="bt-dots">${dots}</div></div>
      <div class="bt-chips">${chips.join('')}</div>`;
    if (withSprite) {
      const spr = spriteEl(si), img = $('img', spr);
      spr.classList.remove('noimg', 'fainted');
      delete img.dataset.fb;
      if (img.getAttribute('src') !== mon.img) img.setAttribute('src', mon.img);
      img.alt = mon.name;
      $('.bt-fallback', spr).textContent = mon.name;
      spr.classList.toggle('fainted', mon.fainted);
    }
  }

  function updateHp(si, animate) {
    const side = S.U.side[si], mon = side.party[side.active];
    const ratio = mon.maxHp ? mon.hp / mon.maxHp : 0;
    const bar = $('.bt-hpbar > i', boxEl(si));
    if (bar) { bar.style.width = (ratio * 100).toFixed(1) + '%'; bar.className = hpClass(ratio); }
    const num = $('.bt-hpcur', boxEl(si));
    if (num) {
      const from = Number(num.textContent) || 0;
      if (!animate || S.skip || from === mon.hp) num.textContent = mon.hp;
      else tweenNumber(num, from, mon.hp, 650 / S.speed);
    }
  }
  function tweenNumber(el, from, to, ms) {
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = Math.round(from + (to - from) * p);
      if (p < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = to;
    })(t0);
  }

  // ───────────── 연출 재생 ─────────────
  const wait = ms => (S.skip ? Promise.resolve() : new Promise(r => setTimeout(r, ms / S.speed)));
  const msgDelay = t => 520 + Math.min(900, String(t || '').length * 26);

  function say(text, turn) {
    if (!text) return;
    const box = $('#bt-text');
    if (box) box.innerHTML = `<span class="bt-line">${esc(text)}</span>`;
    S.log.push({ turn: turn || S.U.turn, text });
    const hist = $('#bt-history');
    if (hist && S.showHistory) renderHistory();
  }
  function renderHistory() {
    const hist = $('#bt-history');
    if (!hist) return;
    let last = -1, html = '';
    for (const l of S.log) {
      if (l.turn !== last) { last = l.turn; html += `<div class="turn">${l.turn ? l.turn + '턴' : '시작'}</div>`; }
      html += `<div>${esc(l.text)}</div>`;
    }
    hist.innerHTML = html;
    hist.scrollTop = hist.scrollHeight;
  }

  async function pulse(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth;
    el.classList.add(cls);
    await wait(ms);
    el.classList.remove(cls);
  }

  function centerOf(si, yFrac) {
    const spr = spriteEl(si), fx = $('#bt-fx');
    const r = spr.getBoundingClientRect(), a = fx.getBoundingClientRect();
    return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height * (yFrac == null ? 0.55 : yFrac) };
  }
  function spawn(cls, html, pos, style) {
    if (S.skip) return;
    const fx = $('#bt-fx');
    if (!fx) return;
    const d = document.createElement('div');
    d.className = cls; d.innerHTML = html || '';
    d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px';
    if (style) d.style.cssText += style;
    fx.appendChild(d);
    setTimeout(() => d.remove(), 1300 / S.speed + 100);
  }
  function floatText(si, text, cls, dy) {
    const c = centerOf(si, 0.25);
    spawn('bt-float ' + (cls || ''), esc(text), { x: c.x, y: c.y + (dy || 0) });
  }

  async function handleEvent(ev) {
    const U = S.U;
    const mon = si => U.side[si].party[U.side[si].active];
    switch (ev.t) {
      case 'turn': U.turn = ev.turn; $('#bt-turn').textContent = `${ev.turn}턴`; break;
      case 'switch': {
        const side = U.side[ev.side];
        if (!ev.initial) { const old = side.party[side.active]; old.stages = {}; old.confusion = false; }
        side.active = ev.to;
        side.party[ev.to].hp = ev.hp;
        renderSide(ev.side, true);
        const spr = spriteEl(ev.side);
        spr.classList.remove('hidden-mon');
        say(ev.text);
        await pulse(spr, 'enter', 700);
        await wait(msgDelay(ev.text) - 500);
        break;
      }
      case 'move': {
        S.curMove = ev;
        say(ev.text);
        const spr = spriteEl(ev.side);
        const c = centerOf(ev.side, -0.05);
        const col = typeColor(ev.type);
        spawn('bt-banner' + (LIGHT_TEXT.has(ev.type) ? ' light' : ''), esc(ev.name), { x: c.x, y: c.y - 6 }, `--c:${col}`);
        await pulse(spr, ev.side === 0 ? 'atk-me' : 'atk-foe', 460);
        await wait(80);
        break;
      }
      case 'miss': say(ev.text); floatText(1 - ev.side, 'MISS', 'miss'); await wait(msgDelay(ev.text)); break;
      case 'damage': {
        const m = mon(ev.side);
        m.hp = ev.hp;
        updateHp(ev.side, true);
        const tgt = spriteEl(ev.side);
        const col = ev.cause ? '#fb7185' : typeColor((S.curMove || {}).type);
        if (!ev.cause) {
          const c = centerOf(ev.side);
          spawn('bt-burst', '', c, `--c:${col}`);
          spawn('bt-burst ring', '', c, `--c:${col}`);
        }
        floatText(ev.side, `-${ev.amount}`, ev.crit ? 'crit' : '');
        if (ev.text) say(ev.text);
        await pulse(tgt, 'hit', 520);
        await wait(ev.text ? msgDelay(ev.text) - 400 : 300);
        break;
      }
      case 'effective': say(ev.text); floatText(ev.side, ev.eff === 0 ? '효과 없음' : ev.eff > 1 ? '효과 굉장!' : '효과 별로', ev.eff === 0 ? 'miss' : ev.eff > 1 ? 'se' : 'nve', 34); await wait(msgDelay(ev.text) - 100); break;
      case 'crit': say(ev.text); await wait(msgDelay(ev.text) - 200); break;
      case 'hits': say(ev.text); await wait(msgDelay(ev.text) - 200); break;
      case 'heal': {
        const m = mon(ev.side); m.hp = ev.hp; updateHp(ev.side, true);
        floatText(ev.side, `+${ev.amount}`, 'heal'); say(ev.text);
        await pulse(spriteEl(ev.side), 'heal', 700);
        await wait(msgDelay(ev.text) - 500);
        break;
      }
      case 'status': {
        const m = mon(ev.side);
        if (STATUS_KO[ev.kind]) m.status = ev.kind;
        else if (ev.kind === 'thaw' || ev.kind === 'wake') m.status = null;
        else if (ev.kind === 'cnf') m.confusion = true;
        else if (ev.kind === 'cnfEnd') m.confusion = false;
        renderSide(ev.side, false);
        say(ev.text); await wait(msgDelay(ev.text));
        break;
      }
      case 'stage': {
        const m = mon(ev.side);
        m.stages[ev.stat] = (m.stages[ev.stat] || 0) + ev.change;
        if (!m.stages[ev.stat]) delete m.stages[ev.stat];
        renderSide(ev.side, false);
        floatText(ev.side, `${STAT_KO[ev.stat]} ${ev.change > 0 ? '▲' : '▼'}`, 'sub');
        say(ev.text); await wait(msgDelay(ev.text));
        break;
      }
      case 'faint': {
        const m = mon(ev.side);
        m.fainted = true; m.hp = 0; m.status = null; m.confusion = false; m.stages = {};
        updateHp(ev.side, false);
        renderSide(ev.side, false);
        say(ev.text);
        spriteEl(ev.side).classList.add('fainted');
        await wait(900);
        break;
      }
      case 'text': say(ev.text); await wait(msgDelay(ev.text)); break;
      case 'end': say(ev.text); await wait(700); break;
      case 'needSwitch': break;
      default: break;
    }
  }

  /** 화면용 미러(S.U)를 엔진의 실제 상태에 맞춘다 */
  function syncFromEngine(withSprite) {
    if (!S.battle || !S.U) return;
    const snap = S.battle.snapshot();
    snap.sides.forEach((side, si) => {
      S.U.side[si].active = side.active;
      side.party.forEach((m, i) => {
        const u = S.U.side[si].party[i];
        u.hp = m.hp; u.fainted = m.fainted; u.status = m.status; u.confusion = m.confusion > 0;
        if (m.fainted) u.stages = {};
      });
    });
    renderSide(0, withSprite); renderSide(1, withSprite);
    updateHp(0, false); updateHp(1, false);
  }

  async function playEvents(events) {
    for (const ev of events) await handleEvent(ev);
    syncFromEngine(false);                     // 안전장치: 재생이 끝나면 엔진 상태와 화면을 한 번 맞춘다
    S.skip = false;
  }

  // ───────────── 턴 진행 ─────────────
  function beginTurn() {
    const B = S.battle;
    if (B.phase === 'ended') return finishBattle();
    S.busy = false;
    renderControls();
  }

  function renderControls() {
    const host = $('#bt-controls');
    if (!host || !S.battle) return;
    const B = S.battle, me = B.active(0), foe = B.active(1);
    const la = B.legalActions(0);
    const moveBtns = la.mustStruggle
      ? `<button class="bt-move" style="--c:#64748b;grid-column:1/-1" data-act="move" data-i="0"><span class="nm">발버둥</span><span class="meta"><span>PP 소진 · 반동 피해</span></span></button>`
      : me.moves.map((m, i) => {
        const col = typeColor(m.type), eff = E.typeMultiplier(m.type, foe.types);
        const hint = S.hints ? (eff === 0 ? ['im', '무효'] : eff >= 4 ? ['se', '×4'] : eff > 1 ? ['se', '×2'] : eff < 1 ? ['nve', eff <= 0.25 ? '×¼' : '×½'] : null) : null;
        return `<button class="bt-move${LIGHT_TEXT.has(m.type) ? ' light' : ''}" style="--c:${col}" data-act="move" data-i="${i}" ${m.pp <= 0 ? 'disabled' : ''} title="${i + 1}번 키">
          ${hint ? `<span class="hint ${hint[0]}">${hint[1]}</span>` : ''}
          <span class="nm">${esc(m.name)}</span>
          <span class="meta"><span>${esc(D().types[m.type - 1].k)} · ${m.cls === 'phys' ? '물리' : '특수'}</span><span>위력 ${m.power}</span></span>
          <span class="meta"><span>PP ${m.pp}/${m.maxPp}</span><span>${m.acc === null || (m.fx && m.fx.neverMiss) ? '필중' : '명중 ' + m.acc}</span></span>
        </button>`;
      }).join('');
    host.innerHTML = `
      <div class="bt-cmd">${moveBtns}</div>
      <div class="bt-sub">
        <button data-act="switch-open" ${la.switches.length ? '' : 'disabled'}>교체</button>
        <button data-act="hints" title="효과 힌트 표시">${S.hints ? '상성 힌트 켬' : '상성 힌트 끔'}</button>
        <button class="danger" data-act="surrender">항복</button>
      </div>
      <div id="bt-panel-host"></div>`;
  }

  function lockControls() {
    const host = $('#bt-controls');
    if (host) host.innerHTML = '<div class="text-center text-xs text-slate-400 font-bold py-4">…</div>';
  }

  /** 재생·진행 중 예외가 나도 화면이 영구히 잠기지 않도록 상태를 되돌린다 */
  function recover(err) {
    console.error('[battle]', err);
    S.skip = false;
    const B = S.battle;
    if (!B) { S.busy = false; return; }
    try { syncFromEngine(true); } catch (e) { /* 화면이 이미 사라졌다면 무시 */ }
    if (B.phase === 'ended') { S.busy = false; return finishBattle(); }
    if (B.phase === 'switch' && !S.recovering) {
      S.recovering = true;
      return afterTurn().catch(recover).finally(() => { S.recovering = false; });
    }
    S.busy = false;
    toast('화면 처리 중 문제가 생겼어요.', 'error');
    if (B.phase === 'move') renderControls(); else renderSelect();
  }

  async function submit(action) {
    if (S.busy || !S.battle) return;
    S.busy = true;
    lockControls();
    const B = S.battle;
    let events;
    try {
      const oppAction = brain.chooseAction(B, 1, S.level);
      delete oppAction.reason;
      events = B.playTurn(action, oppAction);
    } catch (e) {
      console.error(e); S.busy = false; renderControls();
      return toast('행동을 처리하지 못했어요.', 'error');
    }
    try {
      await playEvents(events);
      await afterTurn();
    } catch (e) { recover(e); }
  }

  async function afterTurn() {
    const B = S.battle;
    while (B.phase === 'switch') {
      for (const si of B.pending.slice()) {
        if (si === 1) {
          const idx = brain.chooseReplacement(B, 1, S.level);
          await playEvents(B.replace(1, idx));
        } else {
          const alive = B.sides[0].party.map((m, i) => (m.fainted ? -1 : i)).filter(i => i >= 0);
          const idx = alive.length === 1 ? alive[0] : await askReplacement();
          await playEvents(B.replace(0, idx));
        }
      }
    }
    beginTurn();
  }

  function partyListHtml(forced) {
    const B = S.battle, side = B.sides[0];
    return side.party.map((m, i) => {
      const u = S.U.side[0].party[i];
      const disabled = m.fainted || (!forced && i === side.active) || (forced && i === side.active && !m.fainted);
      const ratio = m.maxHp ? m.hp / m.maxHp : 0;
      return `<button class="bt-sw" data-act="${forced ? 'replace' : 'switch'}" data-i="${i}" ${disabled ? 'disabled' : ''}>
        ${imgTag(u.img, u.id, u.dex, u.name)}
        <div class="info">
          <div class="flex items-center gap-1.5 flex-wrap"><b>${esc(m.name)}</b>${typeChips(m.types)}${i === side.active && !m.fainted ? '<span class="text-[10px] font-black text-indigo-600">출전 중</span>' : ''}${m.fainted ? '<span class="text-[10px] font-black text-slate-400">기절</span>' : ''}${m.status ? `<span class="bt-chip ${m.status}">${STATUS_KO[m.status]}</span>` : ''}</div>
          <div class="bt-hp"><b>HP</b><div class="bt-hpbar"><i class="${hpClass(ratio)}" style="width:${(ratio * 100).toFixed(1)}%"></i></div><span class="text-[10px] font-mono font-bold text-slate-600">${m.hp}/${m.maxHp}</span></div>
        </div>
      </button>`;
    }).join('');
  }

  function openSwitchPanel() {
    const host = $('#bt-panel-host');
    if (!host || S.busy) return;
    host.innerHTML = `<div class="bt-panel"><div class="ttl"><span>누구로 교체할까요?</span><button class="bt-icon-btn" data-act="panel-close">✕</button></div>${partyListHtml(false)}<p class="text-[10px] text-slate-400 font-bold">교체하면 이번 턴에는 공격하지 못하고, 상대의 공격을 받아요.</p></div>`;
    host.scrollIntoView({ block: 'nearest', behavior: S.skip ? 'auto' : 'smooth' });
  }

  let replaceResolve = null;
  function askReplacement() {
    return new Promise(resolve => {
      replaceResolve = resolve;
      say('다음 포켓몬을 골라 주세요!');
      const host = $('#bt-controls');
      host.innerHTML = `<div class="bt-panel"><div class="ttl"><span>다음 포켓몬을 선택하세요</span></div>${partyListHtml(true)}</div>`;
      host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function surrender() {
    if (S.busy) return;
    const run = () => { S.finished = true; recordResult('lose'); showResult('lose', true); };
    if (typeof showConfirmDialog === 'function') showConfirmDialog({ title: '항복할까요?', message: '항복하면 이번 배틀은 패배로 기록돼요.', confirmText: '항복하기', isDanger: true, onConfirm: run });
    else if (window.confirm('항복하면 패배로 기록돼요. 항복할까요?')) run();
  }

  // ───────────── 결과 ─────────────
  function recordResult(kind) {
    const idx = kind === 'win' ? 0 : kind === 'lose' ? 1 : 2;
    const R = S.record;
    R[['w', 'l', 'd'][idx]]++;
    R.byLevel[S.level][idx]++;
    save();
  }

  function finishBattle() {
    if (S.finished) return;
    S.finished = true;
    const w = S.battle.winner;
    const kind = w === 0 ? 'win' : w === 1 ? 'lose' : 'draw';
    recordResult(kind);
    showResult(kind, false);
  }

  function showResult(kind, surrendered) {
    const U = S.U, B = S.battle;
    const title = kind === 'win' ? '승리!' : kind === 'lose' ? (surrendered ? '항복…' : '패배…') : '무승부';
    const sub = kind === 'win' ? '멋진 배틀이었어요! 🎉' : kind === 'lose' ? '다음엔 이길 수 있어요. 파티나 순서를 바꿔 볼까요?' : '아슬아슬한 승부였어요.';
    const mini = si => U.side[si].party.map(m => `<div class="mini${m.fainted ? ' ko' : ''}">${imgTag(m.img, m.id, m.dex, m.name)}<div class="truncate">${esc(m.name)}</div><div>${m.fainted ? '기절' : Math.round(m.hp / m.maxHp * 100) + '%'}</div></div>`).join('');
    const lv = S.record.byLevel[S.level];
    const host = $('#bt-result-host');
    host.innerHTML = `<div class="bt-overlay"><div class="bt-result ${kind}">
      <h3>${title}</h3>
      <p class="text-xs text-slate-500 font-bold mt-1">${esc(sub)} · ${B.turn}턴</p>
      <div class="text-[10px] font-black text-slate-400 mt-3">내 파티</div><div class="row">${mini(0)}</div>
      <div class="text-[10px] font-black text-slate-400 mt-2">상대 파티</div><div class="row">${mini(1)}</div>
      <p class="text-[11px] text-slate-400 font-bold mt-3">${esc(LEVELS[S.level].label)} 전적 ${lv[0]}승 ${lv[1]}패 ${lv[2]}무 · 통산 ${S.record.w}승 ${S.record.l}패 ${S.record.d}무</p>
      <div class="flex flex-wrap gap-2 justify-center mt-4">
        <button class="bt-btn primary" data-act="rematch">같은 상대와 재도전</button>
        <button class="bt-btn" data-act="new-opp">다른 상대</button>
        <button class="bt-btn" data-act="back-select">파티 변경</button>
        <button class="bt-btn" data-act="to-archive">도감으로</button>
      </div></div></div>`;
  }

  // ───────────── 이벤트 위임 ─────────────
  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const act = t.dataset.act;
    switch (act) {
      case 'pick': togglePick(t.dataset.id); break;
      case 'remove': { const i = Number(t.dataset.i); S.party.splice(i, 1); save(); renderParty(); renderPicker(); break; }
      case 'move-left': case 'move-right': {
        const i = Number(t.dataset.i), j = act === 'move-left' ? i - 1 : i + 1;
        if (S.party[i] && S.party[j]) { [S.party[i], S.party[j]] = [S.party[j], S.party[i]]; save(); renderParty(); }
        break;
      }
      case 'auto': autoParty(); break;
      case 'level': S.level = t.dataset.v; save(); renderParty(); break;
      case 'start': if (PRT.validate(partyEntries().map(x => x.id)).ok) { newOpponent(); renderPreview(); } break;
      case 'back': renderSelect(); break;
      case 'reroll': newOpponent(); renderPreview(); break;
      case 'fight': startBattle(); break;
      case 'move': if (!S.busy) submit({ type: 'move', index: Number(t.dataset.i) }); break;
      case 'switch-open': openSwitchPanel(); break;
      case 'panel-close': { const h = $('#bt-panel-host'); if (h) h.innerHTML = ''; break; }
      case 'switch': if (!S.busy) submit({ type: 'switch', to: Number(t.dataset.i) }); break;
      case 'replace': if (replaceResolve) { const r = replaceResolve; replaceResolve = null; lockControls(); r(Number(t.dataset.i)); } break;
      case 'hints': S.hints = !S.hints; save(); renderControls(); break;
      case 'surrender': surrender(); break;
      case 'speed': S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 3 : 1; t.textContent = S.speed + 'x'; save(); break;
      case 'skip': if (S.busy) S.skip = true; break;
      case 'history': S.showHistory = !S.showHistory; { const h = $('#bt-history'); h.classList.toggle('hidden', !S.showHistory); t.classList.toggle('on', S.showHistory); if (S.showHistory) renderHistory(); } break;
      case 'rematch': startBattle(); break;
      case 'new-opp': newOpponent(); renderPreview(); break;
      case 'back-select': renderSelect(); break;
      case 'to-archive': if (typeof switchNavTab === 'function') switchNavTab('archive'); break;
      default: break;
    }
  }

  function onInput(e) {
    if (e.target.id === 'bt-q') { S.q = e.target.value; clearTimeout(S.qTimer); S.qTimer = setTimeout(renderPicker, 120); }
  }
  function onChange(e) {
    if (e.target.id === 'bt-sort') { S.sort = e.target.value; renderPicker(); }
  }
  function onKey(e) {
    if (!mounted || S.screen !== 'battle' || S.busy || S.finished || !S.battle || root.classList.contains('hidden')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;      // 입력 중에는 단축키 무시
    // 앱 모달이 실제로 화면에 열려 있으면 무시 (숨겨진 모달 안쪽 요소는 렌더되지 않으므로 제외된다)
    if ([...document.querySelectorAll('[id^="modal-"]')].some(m => !m.classList.contains('hidden') && m.getClientRects().length > 0)) return;
    if (/^[1-4]$/.test(e.key)) {
      const btn = $(`[data-act="move"][data-i="${Number(e.key) - 1}"]`);
      if (btn && !btn.disabled) btn.click();
    } else if (e.key === 'Escape') { const h = $('#bt-panel-host'); if (h) h.innerHTML = ''; }
  }

  // ───────────── 외부 API ─────────────
  function mount() {
    root = document.getElementById('view-battle');
    if (!root) return false;
    E = window.BattleEngine; AIlib = window.BattleAI; PT = window.BattleParty;
    if (!E || !AIlib || !PT || !window.BATTLE_DATA) {
      root.innerHTML = '<div class="bt-card p-6 text-center text-sm text-slate-500 font-bold">배틀 모듈을 불러오지 못했어요. battle/ 폴더가 index.html 옆에 있는지 확인해 주세요.</div>';
      return false;
    }
    PRT = PT.create(D());
    load();
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    mounted = true;
    return true;
  }

  function show() {
    if (!mounted && !mount()) return;
    invalidateCandidates();
    if (S.screen === 'battle' && S.battle && !S.finished) return;    // 진행 중인 배틀은 그대로 둔다
    if (S.screen === 'preview' && S.opp.length === 3 && partyEntries().length === 3) return renderPreview();
    renderSelect();
  }
  function hide() { /* 진행 상태 유지 */ }
  function refresh() {
    invalidateCandidates();
    if (mounted && S.screen === 'select') { renderParty(); renderPicker(); }
  }

  window.BattleUI = { show, hide, refresh, _state: S };
})();
