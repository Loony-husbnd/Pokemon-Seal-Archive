import './styles/tokens.css';
import './styles/base.css';
import './styles/home.css';
import './styles/builder.css';
import './styles/battle.css';
import { store } from './store.js';
import { sfx } from './sfx.js';
import { D, monImg } from './dex.js';
import * as home from './screens/home.js';
import * as builder from './screens/builder.js';
import * as matchup from './screens/matchup.js';
import * as battle from './screens/battle.js';
import * as result from './screens/result.js';

const SCREENS = { home, builder, matchup, battle, result };
const app = document.getElementById('app');
let cleanup = null, current = null;

/** 화면 이동. params 는 다음 화면이 받는다 */
export function go(name, params = {}) {
  if (cleanup) { try { cleanup(); } catch (e) { /* 정리 중 오류는 무시 */ } cleanup = null; }
  current = name;
  app.innerHTML = '';
  window.scrollTo(0, 0);
  document.body.dataset.screen = name;
  cleanup = SCREENS[name].mount(app, { go, params }) || null;
}

// 이미지를 못 불러오면 도감번호 자리표시로 바꾼다 (error 는 버블링하지 않으므로 캡처 단계에서 받는다)
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('mon-img') || img.dataset.fb) return;
  img.dataset.fb = '1';
  const id = Number(img.dataset.id), p = D().pokemon[id];
  const d = document.createElement('div');
  d.className = 'mon-fallback ' + img.className.replace('mon-img', '').trim();
  d.textContent = p ? `#${String(p.sp).padStart(3, '0')}` : '?';
  img.replaceWith(d);
}, true);

// 버튼 효과음
document.addEventListener('click', e => { if (e.target.closest('.btn, .iconbtn, [data-sfx]')) sfx.click(); });

export function setSound(on) { store.sound = on; store.save(); }

function boot() {
  if (!window.BATTLE_DATA || !window.BattleEngine || !window.BATTLE_LEARN) {
    app.innerHTML = '<div style="padding:40px;text-align:center">배틀 엔진(Rembrandt)을 불러오지 못했어요. 새로고침해 주세요.</div>';
    return;
  }
  go('home');
}
boot();
export { current };
