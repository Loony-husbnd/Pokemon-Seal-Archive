import { store } from '../store.js';
import { R2, DEX, row, esc, formLabel, monImg, TYPE_HEX, TYPE_GLYPH, isLite, moveInfo, monTypes, typeName, fromSet, abilityKo, itemKo } from '../dex.js';
import { sfx } from '../sfx.js';

const cardVars = id => { const t = monTypes(id); return `--c1:${TYPE_HEX[t[0]]};--c2:${TYPE_HEX[t[1] || t[0]]}`; };
const LEVELS = [['easy', '쉬움', '실수가 잦은 상대'], ['normal', '보통', '비슷한 강도'], ['hard', '어려움', '늘 최선의 수'], ['hell', '지옥', '내 팀을 겨냥해 짠 상대']];

/** 내 팀과 비슷한 강도의 상대 3마리 (종족값 합계를 내 팀에 맞추고, 각자 쓸 만한 세트를 짠다) */
export function makeOpponent(mine, level) {
  return R2().generateOpponent(DEX(), { level, playerIds: mine.map(t => t.id), rng: Math.random }).map(fromSet);
}

/** 지옥 난이도: 내 팀의 종만 보고(기술·특성·도구는 추정) 가장 잘 이기는 3마리와 세트를 시뮬레이션으로 고른다 (몇 초 걸리므로 비동기) */
export async function makeHellOpponent(mine, onProgress) {
  const sets = await R2().buildHell(DEX(), { playerIds: mine.map(t => t.id), rng: Math.random, budgetMs: 4000, onProgress });
  return sets.map(fromSet);
}

export function mount(root, { go, params }) {
  const mine = store.team;
  if (!mine.every(Boolean)) { go('builder'); return; }
  let opp = params.opp || null, token = 0, prog = { f: 0, msg: '' }, gone = false;
  /** 새 상대를 정한다. 지옥은 분석하는 동안 화면에 진행 상황을 보여 주고, 그사이 다른 요청이 오면 이전 결과는 버린다 */
  async function newOpp() {
    const my = ++token;
    if (store.level !== 'hell') { opp = makeOpponent(mine, store.level); render(); return; }
    opp = null; prog = { f: 0, msg: '내 팀을 분석하는 중…' }; render();
    try {
      const team = await makeHellOpponent(mine, (f, msg) => { if (my === token && !gone) { prog = { f, msg }; const el = root.querySelector('.hell-prog'); if (el) { el.querySelector('i').style.width = (f * 100).toFixed(0) + '%'; el.querySelector('small').textContent = msg; } } });
      if (my !== token || gone) return;
      opp = team;
    } catch (e) { console.error(e); if (my !== token || gone) return; opp = makeOpponent(mine, 'hard'); }
    render();
  }
  const sum = t => t.reduce((s, x) => s + row(x.id).bst, 0);

  const card = (t, i, side) => {
    const r = row(t.id), types = monTypes(t.id);
    // 내 팀은 세트를 보여 주고, 상대는 팀 미리보기처럼 종·타입·종족값만 보인다 (기술·특성·도구는 대전에서 드러난다)
    const moves = side === 'me'
      ? t.moves.map(m => { const mv = moveInfo(m); return `<i class="${mv.cls === 'status' ? 'st' : ''}${isLite(mv.type) ? ' lite' : ''}" style="--c:${TYPE_HEX[mv.type]}" title="${esc(mv.name)}">${esc(mv.name)}</i>`; }).join('')
      : '<i class="st" title="대전에서 드러나요">기술 ???</i><i class="st">특성 ???</i>';
    const extra = side === 'me' ? `<small class="vs-set">${esc(abilityKo(t.ability))} · ${esc(itemKo(t.item))}</small>` : '';
    return `<article class="vs-card ${side}" style="${cardVars(t.id)};--i:${i}">
      <span class="vs-no">${String(r.num).padStart(3, '0')}</span>
      <div class="vs-art">${monImg(t.id)}</div>
      <div class="vs-info"><b>${esc(formLabel(t.id))}</b><div class="vs-types">${types.map(x => `<span title="${esc(typeName(x))}">${TYPE_GLYPH[x]}</span>`).join('')}<small>${r.bst}</small></div>
      <div class="vs-moves">${moves}</div>${extra}</div></article>`;
  };
  function render() {
    const loading = !opp;
    const d = loading ? 0 : sum(opp) - sum(mine);
    root.innerHTML = `
      <main class="matchup screen">
        <header class="topbar"><button class="iconbtn" data-act="back">←</button><h2 class="title display">MATCH UP</h2></header>
        <section class="vs-stage">
          <div class="vs-team"><h4 class="vs-label me">YOU <small>종족값 ${sum(mine)}</small></h4>${mine.map((t, i) => card(t, i, 'me')).join('')}</div>
          <div class="vs-badge display"><span>VS</span></div>
          <div class="vs-team">${loading
            ? `<h4 class="vs-label foe">RIVAL <small>분석 중</small></h4><div class="hell-prog" style="padding:28px 14px;text-align:center"><b class="display">내 팀을 겨냥한 상대를 짜는 중…</b><div style="height:8px;border-radius:6px;background:rgba(255,255,255,.12);margin:14px 0 8px;overflow:hidden"><i style="display:block;height:100%;width:${(prog.f * 100).toFixed(0)}%;background:linear-gradient(90deg,#ffb21f,#ff5fa2)"></i></div><small>${esc(prog.msg)}</small></div></div>`
            : `<h4 class="vs-label foe">RIVAL <small>종족값 ${sum(opp)} (${d >= 0 ? '+' : '−'}${Math.abs(d)})</small></h4>${opp.map((t, i) => card(t, i, 'foe')).join('')}</div>`}
        </section>
        <section class="vs-controls">
          <div class="seg lv">${LEVELS.map(([k, n, s]) => `<button data-act="level" data-v="${k}" class="${store.level === k ? 'on' : ''}" title="${s}">${n}</button>`).join('')}</div>
          <div class="vs-btns"><button class="btn" data-act="builder">🧬 팀 수정</button><button class="btn" data-act="reroll">🎲 다른 상대</button>
            <button class="btn primary big" data-act="fight" ${loading ? 'disabled' : ''}>🔥 FIGHT!</button></div>
        </section>
      </main>`;
  }
  if (opp) render(); else newOpp();
  const onClick = e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    switch (t.dataset.act) {
      case 'back': go('home'); break;
      case 'builder': go('builder'); break;
      case 'level': store.level = t.dataset.v; store.save(); sfx.pick(); newOpp(); break;
      case 'reroll': sfx.whoosh(); newOpp(); break;
      case 'fight': if (!opp) break; sfx.slam(); go('battle', { mine, opp, level: store.level }); break;
    }
  };
  root.addEventListener('click', onClick);
  setTimeout(() => sfx.slam(), 500);
  return () => { gone = true; token++; root.removeEventListener('click', onClick); };
}
