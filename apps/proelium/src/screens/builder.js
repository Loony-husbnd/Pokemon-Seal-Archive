import { store } from '../store.js';
import { R2, DEX, row as monRow, esc, formLabel, monImg, TYPE_HEX, TYPE_GLYPH, isLite, typeName, typeChip, monTypes, searchMons, movePool, moveInfo, recommendMoves, defaultSet, abilityList, abilityKo, itemKo, megaOf, stat6, STAT_LABEL, validateTeam } from '../dex.js';
import { sfx } from '../sfx.js';
import { toast } from '../fx.js';
import { randomTeam } from './home.js';

const cardVars = id => { const t = monTypes(id); return `--c1:${TYPE_HEX[t[0]]};--c2:${TYPE_HEX[t[1] || t[0]]}`; };
const copyTeam = team => team.map(t => (t ? { id: t.id, moves: t.moves.slice(), ability: t.ability, item: t.item } : null));
const clsKo = { phys: '물리', spec: '특수', status: '변화' };
const moveChipHtml = id => { const m = moveInfo(id); return `<span class="mv${isLite(m.type) ? ' lite' : ''}${m.cls === 'status' ? ' st' : ''}" style="--c:${TYPE_HEX[m.type]}">${TYPE_GLYPH[m.type]} ${esc(m.name)}</span>`; };

export function mount(root, { go }) {
  let team = copyTeam(store.team);
  const commit = () => { store.team = copyTeam(team); store.save(); };

  // ───────── 슬롯 화면 ─────────
  const slotHtml = (t, i) => {
    if (!t) return `<button class="slot empty" data-act="pick" data-i="${i}"><span class="plus display">+</span><b>포켓몬 고르기</b><small>1,254마리 중에서 자유롭게</small></button>`;
    const p = monRow(t.id), st = stat6(t.id), types = monTypes(t.id), mega = megaOf(t);
    const bars = st.map((v, k) => `<div class="bar" title="${STAT_LABEL[k]} ${v}"><b>${v}</b><span class="tr"><i style="--h:${Math.min(1, v / 160).toFixed(2)}"></i></span><small>${STAT_LABEL[k]}</small></div>`).join('');
    return `<article class="slot" style="${cardVars(t.id)}" data-i="${i}">
      <i class="foil"></i><span class="slot-no">${String(p.num).padStart(3, '0')}</span>
      <span class="slot-num">${i + 1}</span>
      <div class="slot-art">${monImg(t.id)}</div>
      <div class="slot-body">
        <h3>${esc(formLabel(t.id))}</h3>
        <div class="slot-types">${types.map(typeChip).join('')}<span class="bst">종족값 ${p.bst}</span></div>
        <div class="bars">${bars}</div>
        <div class="slot-moves">${t.moves.map(moveChipHtml).join('')}</div>
        <div class="slot-set"><span title="특성">✦ ${esc(abilityKo(t.ability))}</span><span title="도구">🎒 ${esc(itemKo(t.item))}</span>${mega ? '<span class="mega">메가진화 가능</span>' : ''}</div>
        <div class="slot-actions">
          <button class="btn" data-act="pick" data-i="${i}">포켓몬 변경</button>
          <button class="btn primary" data-act="moves" data-i="${i}">세트 편집</button>
          <button class="iconbtn" data-act="clear" data-i="${i}" title="비우기">✕</button>
        </div>
      </div></article>`;
  };
  function validity() {
    if (!team.every(Boolean)) return { ok: false, msg: `${team.filter(Boolean).length}/3마리 — 포켓몬을 모두 골라 주세요` };
    const v = validateTeam(team);
    if (!v.ok) return { ok: false, msg: v.errors[0] };
    return { ok: true, msg: '준비 완료! 이제 상대를 만나러 가요' };
  }
  function render() {
    const v = validity();
    root.innerHTML = `
      <main class="builder screen">
        <header class="topbar glass-top"><button class="iconbtn" data-act="back" title="홈으로">←</button><h2 class="title display">TEAM BUILDER</h2><span class="sp"></span>
          <button class="btn" data-act="random">🎲 랜덤 팀</button></header>
        <p class="lead">내 팀 <b>3마리</b>를 직접 고르고, 각자의 <b>기술 4개 · 특성 · 도구</b>까지 정해 보세요.</p>
        <section class="slots">${team.map(slotHtml).join('')}</section>
        <footer class="dock"><span class="dock-msg ${v.ok ? 'ok' : ''}">${esc(v.msg)}</span>
          <button class="btn primary big" data-act="go" ${v.ok ? '' : 'disabled'}>⚔ 상대 찾기</button></footer>
      </main>`;
  }
  render();

  // ───────── 포켓몬 고르기 ─────────
  function openPicker(slot) {
    const f = { q: '', type: 0, kind: 'all', sort: 'dex' };
    let list = [], shown = 0;
    const sheet = document.createElement('div');
    sheet.className = 'sheet picker';
    sheet.innerHTML = `
      <div class="sheet-box">
        <header class="sheet-head">
          <button class="iconbtn" data-x="close">✕</button>
          <input class="search" type="search" placeholder="이름 · 초성(ㅍㅋㅊ) · 도감번호 검색" autocomplete="off">
          <select class="sel" data-f="sort" aria-label="정렬"><option value="dex">도감순</option><option value="bst">종족값순</option><option value="name">이름순</option></select>
        </header>
        <div class="filters">
          <div class="seg" data-f="kind">${[['all', '전체'], ['base', '기본'], ['form', '지방·특수 폼'], ['legend', '전설']].map(([k, n]) => `<button data-v="${k}" class="${k === 'all' ? 'on' : ''}">${n}</button>`).join('')}</div>
          <div class="types"><button class="tchip on" data-v="0">전체 타입</button>${Array.from({ length: 18 }, (_, i) => `<button class="tchip${isLite(i + 1) ? ' lite' : ''}" data-v="${i + 1}" style="--c:${TYPE_HEX[i + 1]}">${TYPE_GLYPH[i + 1]} ${esc(typeName(i + 1))}</button>`).join('')}</div>
        </div>
        <div class="count"></div>
        <div class="pk-grid"></div><div class="sentinel"></div>
      </div>`;
    root.appendChild(sheet);
    const grid = sheet.querySelector('.pk-grid'), count = sheet.querySelector('.count');
    const taken = new Set(team.map((t, i) => (t && i !== slot ? monRow(t.id).base : '')));
    const card = m => `<button class="pk${taken.has(m.row.base) ? ' taken' : ''}${team[slot] && team[slot].id === m.id ? ' cur' : ''}" data-id="${esc(m.id)}" style="${cardVars(m.id)}">
      <span class="pk-art">${monImg(m.id)}</span><b>${esc(m.label)}</b><small>#${String(m.dex).padStart(3, '0')} · ${m.bst}</small>
      <span class="dots">${m.types.map(t => `<i style="background:${TYPE_HEX[t]}"></i>`).join('')}</span>${taken.has(m.row.base) ? '<em>팀에 있음</em>' : ''}</button>`;
    function refresh() {
      list = searchMons(f); shown = 0; grid.innerHTML = '';
      count.textContent = `${list.length.toLocaleString('ko-KR')}마리`;
      more();
      grid.scrollTop = 0; sheet.querySelector('.sheet-box').scrollTop = 0;
    }
    function more() { const next = list.slice(shown, shown + 60); shown += next.length; grid.insertAdjacentHTML('beforeend', next.map(card).join('')); }
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting && shown < list.length) more(); }, { root: sheet.querySelector('.sheet-box'), rootMargin: '600px' });
    io.observe(sheet.querySelector('.sentinel'));
    let timer = 0;
    sheet.querySelector('.search').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value; refresh(); }, 160); });
    sheet.addEventListener('change', e => { if (e.target.dataset.f === 'sort') { f.sort = e.target.value; refresh(); } });
    sheet.addEventListener('click', e => {
      if (e.target.closest('[data-x="close"]') || e.target === sheet) return close();
      const seg = e.target.closest('.seg button');
      if (seg) { f.kind = seg.dataset.v; sheet.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b === seg)); return refresh(); }
      const tc = e.target.closest('.tchip');
      if (tc) { f.type = Number(tc.dataset.v); sheet.querySelectorAll('.tchip').forEach(b => b.classList.toggle('on', b === tc)); return refresh(); }
      const pk = e.target.closest('.pk');
      if (pk) {
        if (pk.classList.contains('taken')) { toast('같은 종류의 포켓몬은 한 팀에 한 마리만 넣을 수 있어요'); return; }
        const id = pk.dataset.id;
        if (!team[slot] || team[slot].id !== id) team[slot] = defaultSet(id, 1);
        commit(); sfx.pick(); close(); render(); openMoves(slot);
      }
    });
    function close() { io.disconnect(); sheet.classList.add('out'); setTimeout(() => sheet.remove(), 220); }
    refresh();
    setTimeout(() => sheet.querySelector('.search').focus({ preventScroll: true }), 300);
  }

  // ───────── 기술 고르기 ─────────
  function openMoves(slot) {
    const t = team[slot]; if (!t) return;
    const p = monRow(t.id), pool = movePool(t.id), types = monTypes(t.id);
    const f = { tab: 'all', type: 0, q: '' };
    let sel = t.moves.slice(), ability = t.ability, item = t.item;
    const sheet = document.createElement('div');
    sheet.className = 'sheet moves';
    const moveTypes = [...new Set(pool.map(m => m.type))].sort((a, b) => a - b);
    sheet.innerHTML = `
      <div class="sheet-box" style="${cardVars(t.id)}">
        <header class="mv-head">
          <button class="iconbtn" data-x="close">✕</button>
          <div class="mv-mon">${monImg(t.id)}</div>
          <div class="mv-title"><h3>${esc(formLabel(t.id))}</h3><div>${types.map(typeChip).join('')}</div></div>
          <div class="mv-tools"><button class="btn" data-x="rec" title="추천 세트(기술·특성·도구)">✨ 추천</button><button class="btn" data-x="rnd" title="무작위 세트">🎲 무작위</button></div>
        </header>
        <div class="sheet-scroll">
        <div class="set-row">
          <label>✦ 특성<select class="sel" data-s="ability"></select></label>
          <label>🎒 도구<select class="sel" data-s="item"></select></label>
        </div>
        <p class="set-hint"></p>
        <div class="mv-slots"></div>
        <div class="filters">
          <div class="seg" data-f="tab"><button data-v="all" class="on">전체 ${pool.length}</button><button data-v="atk">공격</button><button data-v="sta">변화</button></div>
          <div class="types"><button class="tchip on" data-v="0">전체</button>${moveTypes.map(ty => `<button class="tchip${isLite(ty) ? ' lite' : ''}" data-v="${ty}" style="--c:${TYPE_HEX[ty]}">${TYPE_GLYPH[ty]} ${esc(typeName(ty))}</button>`).join('')}</div>
          <input class="search" type="search" placeholder="기술 이름 · 효과 검색" autocomplete="off">
        </div>
        <div class="mv-list"></div>
        </div>
        <footer class="dock sheet-dock"><span class="dock-msg"></span><button class="btn primary big" data-x="done">✓ 이 기술로 결정</button></footer>
      </div>`;
    root.appendChild(sheet);
    const slotsEl = sheet.querySelector('.mv-slots'), listEl = sheet.querySelector('.mv-list'), msg = sheet.querySelector('.dock-msg');
    const abSel = sheet.querySelector('[data-s="ability"]'), itSel = sheet.querySelector('[data-s="item"]');
    const rowT = monRow(t.id), items = DEX().itemsFor(t.id), stones = new Set(DEX().megaStonesOf(t.id).map(x => x.item));
    function fillSet() {
      abSel.innerHTML = abilityList(t.id).map(a => `<option value="${esc(a.name)}"${a.name === ability ? ' selected' : ''}>${esc(a.ko)}${a.hidden ? ' (숨겨진 특성)' : ''}</option>`).join('');
      if (rowT.fixedItem) { itSel.innerHTML = `<option selected>${esc(itemKo(item))} (고정)</option>`; itSel.disabled = true; return; }
      const mega = items.filter(i => stones.has(i.id)), gen = items.filter(i => !stones.has(i.id)).sort((a, b) => a.ko.localeCompare(b.ko, 'ko'));
      const opt = i => `<option value="${esc(i.name)}"${i.name === item ? ' selected' : ''}>${esc(i.ko)}</option>`;
      const optMega = i => `<option value="${esc(i.name)}"${i.name === item ? ' selected' : ''}>🌀 ${esc(i.ko)} (메가진화)</option>`;
      itSel.innerHTML = `<option value=""${item === '' ? ' selected' : ''}>없음</option>${mega.length ? `<optgroup label="🌀 메가스톤 — 쥐면 배틀 중 메가진화">${mega.map(optMega).join('')}</optgroup>` : ''}<optgroup label="일반 도구">${gen.map(opt).join('')}</optgroup>`;
      sheet.querySelector('.set-hint').innerHTML = mega.length ? `이 포켓몬은 <b>메가스톤</b>을 쥐면 배틀에서 <b>🌀 메가진화</b>를 쓸 수 있어요 (도구 목록 맨 위).` : '';
    }
    fillSet();
    abSel.addEventListener('change', () => { ability = abSel.value; });
    itSel.addEventListener('change', () => { item = itSel.value; });
    const row = m => {
      const on = sel.includes(m.id);
      return `<button class="mrow${on ? ' on' : ''}" data-id="${m.id}" style="--c:${TYPE_HEX[m.type]}">
        <span class="glyph${isLite(m.type) ? ' lite' : ''}">${TYPE_GLYPH[m.type]}</span>
        <span class="mi"><b>${esc(m.name)}</b><small>${m.desc ? esc(m.desc) : ' '}</small></span>
        <span class="tag ${m.cls}">${clsKo[m.cls]}</span>
        <span class="num">${m.cls === 'status' ? '—' : m.varPower ? '가변' : m.power}<small>위력</small></span><span class="num">${m.acc === null ? '필중' : m.acc}<small>명중</small></span><span class="num">${m.pp}<small>PP</small></span>
        <span class="check">${on ? '✓' : ''}</span></button>`;
    };
    function renderSlots() {
      slotsEl.innerHTML = Array.from({ length: 4 }, (_, i) => sel[i]
        ? (() => { const m = moveInfo(sel[i]); return `<button class="mslot on${isLite(m.type) ? ' lite' : ''}" data-id="${m.id}" style="--c:${TYPE_HEX[m.type]}"><span>${TYPE_GLYPH[m.type]}</span><b>${esc(m.name)}</b><small>${m.cls === 'status' ? esc(m.desc) : `${clsKo[m.cls]} · 위력 ${m.varPower ? '가변' : m.power}`}</small></button>`; })()
        : `<div class="mslot"><span>＋</span><small>비어 있음</small></div>`).join('');
      msg.textContent = sel.length ? `${sel.length}/4 선택` : '기술을 1개 이상 골라 주세요';
    }
    function renderList() {
      const q = f.q.trim().toLowerCase();
      const items = pool.filter(m => (f.tab === 'all' || (f.tab === 'atk') === (m.cls !== 'status')) && (!f.type || m.type === f.type) && (!q || (m.name + ' ' + m.desc).toLowerCase().includes(q)));
      listEl.innerHTML = items.length ? items.map(row).join('') : '<p class="empty">조건에 맞는 기술이 없어요</p>';
    }
    renderSlots(); renderList();
    const setMoves = ids => { sel = ids.slice(0, 4); renderSlots(); renderList(); };
    function close(save) {
      if (save) { if (!sel.length) { toast('기술을 1개 이상 골라 주세요'); return; } t.moves = sel.slice(); t.ability = ability; t.item = item; commit(); render(); }
      sheet.classList.add('out'); setTimeout(() => sheet.remove(), 220);
    }
    let timer = 0;
    sheet.querySelector('.search').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value; renderList(); }, 140); });
    sheet.addEventListener('click', e => {
      const x = e.target.closest('[data-x]');
      if (x) {
        if (x.dataset.x === 'close') return close(false);
        if (x.dataset.x === 'done') return close(true);
        if (x.dataset.x === 'rec' || x.dataset.x === 'rnd') {
          sfx.pick(); const d = x.dataset.x === 'rec' ? defaultSet(t.id, 1) : defaultSet(t.id, Math.floor(Math.random() * 2 ** 31), 1);
          ability = d.ability; item = d.item; fillSet(); return setMoves(d.moves);
        }
      }
      if (e.target === sheet) return close(true);
      const seg = e.target.closest('.seg button');
      if (seg) { f.tab = seg.dataset.v; sheet.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b === seg)); return renderList(); }
      const tc = e.target.closest('.tchip');
      if (tc) { f.type = Number(tc.dataset.v); sheet.querySelectorAll('.tchip').forEach(b => b.classList.toggle('on', b === tc)); return renderList(); }
      const el = e.target.closest('.mrow, .mslot.on');
      if (el) {
        const id = el.dataset.id, at = sel.indexOf(id);
        if (at >= 0) { sel.splice(at, 1); sfx.click(); }
        else if (sel.length >= 4) { toast('기술은 4개까지! 먼저 하나를 빼 주세요'); slotsEl.classList.remove('shake'); void slotsEl.offsetWidth; slotsEl.classList.add('shake'); return; }
        else { sel.push(id); sfx.pick(); }
        renderSlots(); renderList();
      }
    });
  }

  // ───────── 이벤트 ─────────
  const onClick = e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const i = Number(t.dataset.i);
    switch (t.dataset.act) {
      case 'back': go('home'); break;
      case 'pick': openPicker(i); break;
      case 'moves': openMoves(i); break;
      case 'clear': team[i] = null; commit(); render(); break;
      case 'random': team = randomTeam(); commit(); sfx.pick(); render(); break;
      case 'go': if (validity().ok) { sfx.whoosh(); go('matchup'); } break;
    }
  };
  root.addEventListener('click', onClick);
  const tilt = e => {
    const c = e.target.closest('.slot:not(.empty)'); if (!c) return;
    const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    c.style.setProperty('--mx', x * 100 + '%'); c.style.setProperty('--my', y * 100 + '%');
  };
  root.addEventListener('pointermove', tilt);
  return () => root.removeEventListener('click', onClick);
}
