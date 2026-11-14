// 저장소 — 모든 키는 'proelium:' 접두어 (Holo 와 같은 도메인을 쓰므로 서로의 세이브를 덮어쓰지 않도록)
import { D } from './dex.js';
const NS = 'proelium:';
const load = (k, fb) => { try { const v = localStorage.getItem(NS + k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
const put = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 진행에는 지장 없다 */ } };

function cleanTeam(raw) {
  const out = [null, null, null];
  if (!Array.isArray(raw)) return out;
  raw.slice(0, 3).forEach((t, i) => {
    if (!t || !D().pokemon[t.id]) return;
    const moves = (t.moves || []).filter(m => D().moves[m]).slice(0, 4);
    out[i] = { id: t.id, moves: moves.length ? moves : D().pokemon[t.id].m.slice(0, 4) };
  });
  return out;
}
export const store = {
  team: cleanTeam(load('team', null)),
  level: ['easy', 'normal', 'hard'].includes(load('level', 'normal')) ? load('level', 'normal') : 'normal',
  sound: load('sound', true),
  record: Object.assign({ w: 0, l: 0, d: 0, streak: 0, best: 0 }, load('record', {})),
  save() { put('team', this.team); put('level', this.level); put('sound', this.sound); put('record', this.record); },
};
