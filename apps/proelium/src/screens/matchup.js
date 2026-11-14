import { store } from '../store.js';
import { D, E, PT, esc, formLabel, monImg, TYPE_HEX, TYPE_GLYPH, isLite, moveInfo, typeChip, recommendMoves } from '../dex.js';
import { sfx } from '../sfx.js';

const cardVars = id => { const t = D().pokemon[id].t; return `--c1:${TYPE_HEX[t[0]]};--c2:${TYPE_HEX[t[1] || t[0]]}`; };
const LEVELS = [['easy', '쉬움', '실수가 잦은 상대'], ['normal', '보통', '비슷한 강도'], ['hard', '어려움', '늘 최선의 수']];

/** 내 팀과 비슷한 강도의 상대 3마리 (종족값 합계를 맞추고, 기술은 무작위) */
export function makeOpponent(mine, level) {
  const P = PT().create(D(), { cap: 2700 });
  const ids = P.generateOpponent({ playerIds: mine.map(t => t.id), level, rng: Math.random });
  return ids.map(id => ({ id, moves: recommendMoves(id, Math.floor(Math.random() * 2 ** 31)) }));
}

export function mount(root, { go, params }) {
  const mine = store.team;
  if (!mine.every(Boolean)) { go('builder'); return; }
  let opp = params.opp || makeOpponent(mine, store.level);
  const sum = t => t.reduce((s, x) => s + D().pokemon[x.id].bst, 0);

  const card = (t, i, side) => {
    const p = D().pokemon[t.id];
    return `<article class="vs-card ${side}" style="${cardVars(t.id)};--i:${i}">
      <span class="vs-no display">${String(p.sp).padStart(3, '0')}</span>
      <div class="vs-art">${monImg(t.id)}</div>
      <div class="vs-info"><b>${esc(formLabel(t.id))}</b><div class="vs-types">${p.t.map(x => `<span title="${esc(D().types[x - 1].k)}">${TYPE_GLYPH[x]}</span>`).join('')}<small>${p.bst}</small></div>
      <div class="vs-moves">${t.moves.map(m => { const mv = moveInfo(m); return `<i class="${mv.cls === 'status' ? 'st' : ''}${isLite(mv.type) ? ' lite' : ''}" style="--c:${TYPE_HEX[mv.type]}" title="${esc(mv.name)}">${esc(mv.name)}</i>`; }).join('')}</div></div></article>`;
  };
  function render() {
    const d = sum(opp) - sum(mine);
    root.innerHTML = `
      <main class="matchup screen">
        <header class="topbar"><button class="iconbtn" data-act="back">←</button><h2 class="title display">MATCH UP</h2></header>
        <section class="vs-stage">
          <div class="vs-team"><h4 class="vs-label me">YOU <small>종족값 ${sum(mine)}</small></h4>${mine.map((t, i) => card(t, i, 'me')).join('')}</div>
          <div class="vs-badge display"><span>VS</span></div>
          <div class="vs-team"><h4 class="vs-label foe">RIVAL <small>종족값 ${sum(opp)} (${d >= 0 ? '+' : '−'}${Math.abs(d)})</small></h4>${opp.map((t, i) => card(t, i, 'foe')).join('')}</div>
        </section>
        <section class="vs-controls">
          <div class="seg lv">${LEVELS.map(([k, n, s]) => `<button data-act="level" data-v="${k}" class="${store.level === k ? 'on' : ''}" title="${s}">${n}</button>`).join('')}</div>
          <div class="vs-btns"><button class="btn" data-act="builder">🧬 팀 수정</button><button class="btn" data-act="reroll">🎲 다른 상대</button>
            <button class="btn primary big" data-act="fight">🔥 FIGHT!</button></div>
        </section>
      </main>`;
  }
  render();
  const onClick = e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    switch (t.dataset.act) {
      case 'back': go('home'); break;
      case 'builder': go('builder'); break;
      case 'level': store.level = t.dataset.v; store.save(); opp = makeOpponent(mine, store.level); sfx.pick(); render(); break;
      case 'reroll': opp = makeOpponent(mine, store.level); sfx.whoosh(); render(); break;
      case 'fight': sfx.slam(); go('battle', { mine, opp, level: store.level }); break;
    }
  };
  root.addEventListener('click', onClick);
  setTimeout(() => sfx.slam(), 500);
  return () => root.removeEventListener('click', onClick);
}
