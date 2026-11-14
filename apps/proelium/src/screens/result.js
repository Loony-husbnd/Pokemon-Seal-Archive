import { store } from '../store.js';
import { D, esc, formLabel, monImg, TYPE_HEX } from '../dex.js';
import { sfx } from '../sfx.js';
import { confetti } from '../fx.js';

export function mount(root, { go, params }) {
  const { winner, turns, mine, opp, level, dmg = [], kos = 0 } = params;
  const win = winner === 0, draw = winner === 'draw';
  const r = store.record;
  if (draw) r.d++; else if (win) { r.w++; r.streak++; r.best = Math.max(r.best, r.streak); } else { r.l++; r.streak = 0; }
  store.save();
  const mvp = dmg.length ? dmg.indexOf(Math.max(...dmg)) : -1;
  root.innerHTML = `
    <main class="result screen ${win ? 'win' : draw ? 'draw' : 'lose'}">
      <div class="res-hero">
        <h1 class="res-title display">${win ? 'VICTORY' : draw ? 'DRAW' : 'DEFEAT'}</h1>
        <p class="res-sub">${win ? '완벽한 승부였어요!' : draw ? '아슬아슬한 무승부!' : '다음엔 이길 수 있어요. 팀을 다듬어 볼까요?'}</p>
      </div>
      <div class="res-team">${mine.map((t, i) => `<article class="res-card${i === mvp && dmg[i] > 0 ? ' mvp' : ''}" style="--c1:${TYPE_HEX[D().pokemon[t.id].t[0]]};--i:${i}">
        ${i === mvp && dmg[i] > 0 ? '<span class="crown">👑 MVP</span>' : ''}<div class="rc-art">${monImg(t.id)}</div><b>${esc(formLabel(t.id))}</b><small>${(dmg[i] || 0).toLocaleString('ko-KR')} 피해</small></article>`).join('')}</div>
      <div class="res-stats glass"><div><b>${turns}</b><small>턴</small></div><div><b>${kos}</b><small>쓰러뜨림</small></div><div><b>${r.streak}</b><small>연승</small></div><div><b>${r.w}승 ${r.l}패</b><small>통산</small></div></div>
      <div class="res-btns"><button class="btn primary big" data-act="again">🔁 한 번 더</button><div class="cta-row"><button class="btn" data-act="new">🎲 새 상대</button><button class="btn" data-act="builder">🧬 팀 수정</button><button class="btn" data-act="home">🏠 홈</button></div></div>
    </main>`;
  if (win) { sfx.win(); setTimeout(() => confetti(), 300); } else if (!draw) sfx.lose();
  const onClick = e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.dataset.act === 'again') go('battle', { mine, opp, level });
    else if (t.dataset.act === 'new') go('matchup');
    else go(t.dataset.act);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
