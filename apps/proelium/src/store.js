// 저장소 — 모든 키는 'proelium:' 접두어 (Holo 와 같은 도메인을 쓰므로 서로의 세이브를 덮어쓰지 않도록)
// 팀 저장 형식이 Rembrandt 2 로 바뀌어 키를 'team2' 로 새로 썼다 (옛 'team' 은 건드리지 않는다).
import { DEX, R2, defaultSet } from './dex.js';
const NS = 'proelium:';
const load = (k, fb) => { try { const v = localStorage.getItem(NS + k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
const put = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 진행에는 지장 없다 */ } };

/** 엔진을 불러온 뒤 한 번 호출: 저장된 팀이 지금 규칙(전국도감·9세대 습득 기술·특성·도구)에 맞는지 확인하고, 어긋난 칸은 기본 세트로 고친다 */
function cleanTeam(raw) {
  const out = [null, null, null], D = DEX(), toID = R2().toID;
  if (!Array.isArray(raw)) return out;
  raw.slice(0, 3).forEach((t, i) => {
    if (!t || typeof t.id !== 'string' || !D.get(t.id)) return;
    const can = D.learnable(t.id), moves = (t.moves || []).map(toID).filter(m => can.has(m) || (D.get(t.id).fixedMove && toID(D.get(t.id).fixedMove) === m)).slice(0, 4);
    const base = defaultSet(t.id, 1);
    const abilities = D.get(t.id).abilities;
    const item = D.get(t.id).fixedItem ? base.item : (typeof t.item === 'string' && (t.item === '' || D.itemsFor(t.id).some(x => x.name === t.item)) ? t.item : base.item);
    out[i] = { id: t.id, moves: moves.length ? moves : base.moves, ability: abilities.includes(t.ability) ? t.ability : base.ability, item };
  });
  // 같은 종이 겹치면 뒤쪽을 비운다
  const seen = new Set(); return out.map(t => { if (!t) return null; const k = DEX().get(t.id).base; if (seen.has(k)) return null; seen.add(k); return t; });
}
export const store = {
  team: [null, null, null], _raw: load('team2', null),
  level: ['easy', 'normal', 'hard', 'hell'].includes(load('level', 'normal')) ? load('level', 'normal') : 'normal',
  sound: load('sound', true),
  record: Object.assign({ w: 0, l: 0, d: 0, streak: 0, best: 0 }, load('record', {})),
  sanitize() { this.team = cleanTeam(this._raw); },
  save() { put('team2', this.team); put('level', this.level); put('sound', this.sound); put('record', this.record); },
};
