// 연출 도우미: 색종이, 토스트
let toastTimer = 0;
export function toast(msg) {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}
/** 화면 전체 색종이 (승리 연출) */
export function confetti(ms = 3600) {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:60;pointer-events:none';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
  const colors = ['#ff2e88', '#7a4dff', '#19e3ff', '#ffd23f', '#7dff6b', '#ffffff'];
  const bits = Array.from({ length: 170 }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .3, y: H * .55, vx: (Math.random() - .5) * 18 * dpr, vy: (-Math.random() * 20 - 8) * dpr,
    s: (6 + Math.random() * 8) * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const k = t - t0; ctx.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += .55 * dpr; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vx *= .995;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.globalAlpha = Math.max(0, 1 - k / ms);
      ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); ctx.restore();
    }
    if (k < ms) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}
export const wait = ms => new Promise(r => setTimeout(r, ms));
