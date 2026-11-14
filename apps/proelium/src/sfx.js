// 효과음 — 파일 없이 WebAudio 로 합성한다 (켜기/끄기 가능)
import { store } from './store.js';
let ctx = null;
const ac = () => { if (!store.sound) return null; if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
function tone(freq, dur, { type = 'sine', vol = 0.07, slide = 0, delay = 0 } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.09, delay = 0) {
  const c = ac(); if (!c) return;
  const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), g = c.createGain(); s.buffer = buf; g.gain.value = vol;
  s.connect(g).connect(c.destination); s.start(c.currentTime + delay);
}
export const sfx = {
  click() { tone(720, 0.07, { type: 'triangle', vol: 0.05 }); },
  pick() { tone(520, 0.08, { type: 'square', vol: 0.04 }); tone(780, 0.1, { type: 'square', vol: 0.04, delay: 0.06 }); },
  whoosh() { tone(300, 0.25, { type: 'sawtooth', vol: 0.04, slide: 700 }); },
  hit() { noise(0.18, 0.12); tone(180, 0.15, { type: 'square', vol: 0.06, slide: -120 }); },
  crit() { noise(0.28, 0.16); tone(220, 0.3, { type: 'sawtooth', vol: 0.08, slide: -160 }); tone(880, 0.12, { type: 'square', vol: 0.05, delay: 0.05 }); },
  weak() { noise(0.1, 0.05); tone(200, 0.1, { type: 'triangle', vol: 0.04 }); },
  heal() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'sine', vol: 0.05, delay: i * 0.07 })); },
  buff() { tone(400, 0.2, { type: 'triangle', vol: 0.05, slide: 500 }); },
  debuff() { tone(500, 0.22, { type: 'triangle', vol: 0.05, slide: -350 }); },
  faint() { tone(420, 0.7, { type: 'sawtooth', vol: 0.06, slide: -360 }); },
  win() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, { type: 'square', vol: 0.05, delay: i * 0.11 })); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.06, delay: i * 0.16 })); },
  slam() { noise(0.25, 0.14); tone(90, 0.3, { type: 'square', vol: 0.1, slide: -40 }); },
};
