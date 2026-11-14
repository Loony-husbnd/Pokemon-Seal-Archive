import { store } from '../store.js';
import { D, esc, formLabel, monImg, TYPE_HEX, allMons, recommendMoves, typeChip } from '../dex.js';
import { sfx } from '../sfx.js';
import { setSound } from '../main.js';

const cardStyle = id => { const t = D().pokemon[id].t; return `--c1:${TYPE_HEX[t[0]]};--c2:${TYPE_HEX[t[1] || t[0]]}`; };

/** 무작위 팀: 서로 다른 종 3마리 + 추천 기술 */
export function randomTeam() {
  const pool = allMons().filter(m => !m.isForm && !m.leg);
  const used = new Set(), team = [];
  while (team.length < 3) {
    const m = pool[Math.floor(Math.random() * pool.length)];
    if (used.has(m.dex)) continue;
    used.add(m.dex);
    team.push({ id: m.id, moves: recommendMoves(m.id, Math.floor(Math.random() * 2 ** 31)) });
  }
  return team;
}

export function mount(root, { go }) {
  const ready = store.team.every(Boolean);
  const r = store.record, total = r.w + r.l + r.d;
  const fan = store.team.map((t, i) => t
    ? `<button class="fan-card" data-act="builder" style="${cardStyle(t.id)};--rot:${(i - 1) * 9}deg;--dy:${Math.abs(i - 1) * 14}px;--i:${i}">
         <span class="fan-no display">${String(D().pokemon[t.id].sp).padStart(3, '0')}</span>
         <span class="fan-art">${monImg(t.id)}</span><b>${esc(formLabel(t.id))}</b><i class="foil"></i></button>`
    : `<button class="fan-card empty" data-act="builder" style="--rot:${(i - 1) * 9}deg;--dy:${Math.abs(i - 1) * 14}px;--i:${i}"><span class="q display">?</span><b>비어 있음</b></button>`).join('');

  root.innerHTML = `
    <main class="home screen">
      <header class="home-top">
        <a class="iconbtn" href="../" title="띠부씰 아카이브(Holo)로" data-sfx>🗂</a>
        <span class="sp"></span>
        <button class="iconbtn" data-act="sound" title="효과음">${store.sound ? '🔊' : '🔇'}</button>
      </header>
      <section class="hero">
        <div class="logo-wrap">
          <i class="spot"></i>
          <h1 class="logo display" aria-label="Proelium"><span>PRO</span><span>ELIUM</span></h1>
          <p class="tagline">내가 고른 3마리로 겨루는 <b>포켓몬 아레나</b></p>
        </div>
        <div class="fan">${fan}</div>
        <div class="cta">
          ${ready
            ? `<button class="btn primary big" data-act="play">⚔ 배틀 시작</button>
               <div class="cta-row"><button class="btn" data-act="builder">🧬 팀 편성</button><button class="btn" data-act="random">🎲 랜덤 팀</button></div>`
            : `<button class="btn primary big" data-act="builder">🧬 내 팀 만들기</button>
               <div class="cta-row"><button class="btn" data-act="quick">🎲 랜덤 팀으로 바로 시작</button></div>`}
        </div>
        <div class="record glass">
          <div><b>${r.w}</b><small>승</small></div><div><b>${r.l}</b><small>패</small></div>
          <div><b>${total ? Math.round(100 * r.w / total) : 0}%</b><small>승률</small></div><div><b>${r.streak}</b><small>연승 (최고 ${r.best})</small></div>
        </div>
      </section>
    </main>`;

  const onClick = e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    switch (t.dataset.act) {
      case 'builder': go('builder'); break;
      case 'play': sfx.whoosh(); go('matchup'); break;
      case 'random': store.team = randomTeam(); store.save(); sfx.pick(); go('home'); break;
      case 'quick': store.team = randomTeam(); store.save(); sfx.whoosh(); go('matchup'); break;
      case 'sound': setSound(!store.sound); t.textContent = store.sound ? '🔊' : '🔇'; break;
    }
  };
  root.addEventListener('click', onClick);

  // 카드를 기울이는 입체 효과 (포일 반사)
  const tilt = e => {
    const c = e.target.closest('.fan-card'); if (!c || c.classList.contains('empty')) return;
    const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    c.style.setProperty('--mx', (x * 100) + '%'); c.style.setProperty('--my', (y * 100) + '%');
    c.style.setProperty('--rx', ((0.5 - y) * 16) + 'deg'); c.style.setProperty('--ry', ((x - 0.5) * 20) + 'deg');
  };
  const untilt = e => { const c = e.target.closest && e.target.closest('.fan-card'); if (c) { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); } };
  root.addEventListener('pointermove', tilt); root.addEventListener('pointerout', untilt);
  return () => { root.removeEventListener('click', onClick); };
}
