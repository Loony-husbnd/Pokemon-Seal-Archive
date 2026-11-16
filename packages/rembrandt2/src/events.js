/**
 * 프로토콜 → 화면 이벤트 변환기.
 *
 *   const T = createTranslator(match, 0);      // 0번 플레이어 시점
 *   match.submit([a, b]);
 *   const events = T.pull();                  // 새로 생긴 줄을 이벤트로 (화면은 이것만 본다)
 *
 * 이벤트는 옛 Rembrandt 와 같은 이름을 쓴다: turn switch move miss damage effective crit hits heal status stage faint text end
 * (+ field vol types forme mega). side 는 0/1 (match 의 플레이어 번호), 문구(text)는 이미 한국어다.
 * 상대 포켓몬의 체력은 퍼센트(maxHp 100)로만 온다. 내 포켓몬은 정확한 값이다.
 *
 *   { t:'turn', turn }
 *   { t:'switch', side, to, species, types, name, hp, maxHp, initial?, text }   to = 처음 파티 기준 번호, types = 영문 타입 이름들
 *   { t:'move', side, move, name, type, typeKo, cls, text }                  cls = 'phys' | 'spec' | 'status'
 *   { t:'damage', side, amount, hp, maxHp, cause?, crit?, text? }
 *   { t:'heal', side, amount, hp, maxHp, text }
 *   { t:'status', side, kind, text }  kind: slp par brn psn tox frz | thaw wake cure
 *   { t:'stage', side, stat, change, text }
 *   { t:'miss' | 'effective' | 'crit' | 'hits' | 'faint' | 'text' | 'end', … }
 *   { t:'field', weather, terrain, pseudo:[{id,ko}], sides:[[{id,ko,layers}],[…]] }   weather: raindance|sunnyday|… (프로토콜 이름)
 *   { t:'types', side, types, typesKo, text } · { t:'forme', side, species, name, types, typesKo }
 *   { t:'vol', side, flags:[…] }  { t:'forme', side, species, name, types } { t:'mega', side, text }
 *
 * 변환하지 못한 줄 종류는 translator.unmapped (종류 → 횟수)에 기록된다. 화면에는 나가지 않는다.
 */
import { Dex } from '@pkmn/sim';
import { koName, josa, toID } from './ko.js';
import * as K from './ko-text.js';

const dex = Dex.forGen(9);
const IGNORED = new Set(['', 't:', 'upkeep', 'debug', 'gametype', 'gen', 'tier', 'rule', 'clearpoke', 'teampreview', 'teamsize', 'player', 'start', 'raw', '-hint', 'inactive', 'inactiveoff', 'split', '-anim', '-singlemove', '-singleturn', 'request', 'c', 'chat', 'j', 'l', 'n', '-message', '-notarget-silent']);

const parseRef = s => { const m = /^p([12])([a-d])?: ?(.*)$/.exec(s || ''); return m ? { side: Number(m[1]) - 1, name: m[3] } : null; };
const parseSide = s => { const m = /^p([12])/.exec(s || ''); return m ? Number(m[1]) - 1 : 0; };
const parseHp = s => { const m = /^(\d+)(?:\/(\d+))?(?: (\w+))?/.exec(s || ''); return m ? { hp: Number(m[1]), max: m[2] ? Number(m[2]) : null, status: m[3] || null } : null; };
function flags(parts) { const f = {}; for (const x of parts) { const m = /^\[(\w+)\](?: ?(.*))?$/.exec(x); if (m) f[m[1]] = m[2] === undefined ? true : m[2]; } return f; }
const plain = parts => parts.filter(x => !/^\[\w+\]/.test(x));
const bare = s => String(s || '').replace(/^(?:ability|item|move): /, '');

export function createTranslator(match, side, o = {}) {
  const me = side;
  const T = {
    unmapped: new Map(), stats: { lines: 0, shown: 0, ignored: 0, generic: 0 },
    turn: 0, cursor: 0, party: [[], []], hp: [{}, {}], active: [null, null], form: [{}, {}], vol: [new Set(), new Set()],
    field: { weather: null, terrain: null, pseudo: new Map(), sides: [new Map(), new Map()] },
  };
  const out = [];
  const push = ev => { out.push(ev); if (ev.text) T.stats.shown++; return ev; };
  const mark = (kind, generic) => { if (generic) T.stats.generic++; T.unmapped.set(kind, (T.unmapped.get(kind) || 0) + 1); };
  const noKo = raw => { const e = K.effectKo(raw); return e === String(raw) || e === bare(raw) || /^[\x20-\x7e]+$/.test(e); };      // 한국어 이름이 없어 영문이 남았는가

  const nm = (s, name) => (s === me ? '' : '상대 ') + koName('species', name);          // '리자몽' / '상대의 리자몽'
  const J = (w, p) => josa(w, p);
  const label = ref => (ref ? nm(ref.side, ref.name) : '');
  const sideLabel = s => (s === me ? '우리 쪽' : '상대 쪽');

  function snapshotField() {
    const pseudo = [...T.field.pseudo].map(([id, v]) => ({ id, ko: koName('move', id) }));
    const sides = T.field.sides.map(m => [...m].map(([id, layers]) => ({ id, ko: K.effectKo(id), layers })));
    return push({ t: 'field', weather: T.field.weather, terrain: T.field.terrain, pseudo, sides });
  }
  const volEvent = s => push({ t: 'vol', side: s, flags: [...T.vol[s]] });

  /**
   * 체력 추적은 이름이 아니라 '이름#최대체력' 으로 한다. 환상(Illusion) 특성 때문에 서로 다른 포켓몬이 같은 이름으로 보일 수 있다.
   * 교체로 나오면 그 포켓몬이 '현재 포켓몬'이 되고, 이후 체력 줄은 현재 포켓몬의 것으로 처리한다.
   */
  function hpUpdate(ref, hpStr, entering) {
    const h = parseHp(hpStr); if (!h) return null;
    const act = T.active[ref.side];
    let key;
    if (entering) { key = `${ref.name}#${h.max || 100}`; T.active[ref.side] = { name: ref.name, key }; }
    else if (act && act.name === ref.name) key = act.key;
    else key = Object.keys(T.hp[ref.side]).find(x => x.startsWith(ref.name + '#')) || `${ref.name}#${h.max || 100}`;
    const prev = T.hp[ref.side][key];
    const next = { hp: h.hp, max: h.max || (prev && prev.max) || 100 };
    T.hp[ref.side][key] = next;
    return { prev, next, key };
  }
  const baseOf = n => toID(dex.species.get(n).baseSpecies || n);
  const partyIndex = (s, name) => {                // 처음 파티 기준 번호. 폼 이름이 달라도(미리보기는 기본형) 원래 종으로 맞춘다
    const list = T.party[s]; let i = list.findIndex(n => toID(n) === toID(name));
    if (i < 0) i = list.findIndex(n => baseOf(n) === baseOf(name));
    if (i < 0) { list.push(name); i = list.length - 1; }
    return i;
  };

  function line(raw) {
    const p = raw.split('|').slice(1); const k = p[0]; T.stats.lines++;
    if (IGNORED.has(k)) { T.stats.ignored++; return; }
    const f = flags(p);
    switch (k) {
      case 'poke': { const s = parseSide(p[1]); T.party[s].push(p[2].split(',')[0]); return; }
      case 'turn': T.turn = Number(p[1]); push({ t: 'turn', turn: T.turn }); return;
      case 'switch': case 'drag': {
        const ref = parseRef(p[1]); const sp = p[2].split(',')[0]; const hp = hpUpdate(ref, p[3], true);
        T.form[ref.side][ref.name] = sp; T.vol[ref.side].clear();
        const text = k === 'drag' ? `${J(label(ref), '은/는')} 끌려 나왔다!` : ref.side === me ? `가랏, ${koName('species', ref.name)}!` : `상대는 ${J(koName('species', ref.name), '을/를')} 내보냈다!`;
        push({ t: 'switch', side: ref.side, to: partyIndex(ref.side, ref.name), species: toID(sp), types: dex.species.get(sp).types.slice(), name: koName('species', ref.name), hp: hp.next.hp, maxHp: hp.next.max, initial: T.turn === 0, text });
        return;
      }
      case 'move': {
        const ref = parseRef(p[1]); const mv = dex.moves.get(p[2]);
        if (f.miss) { push({ t: 'move', side: ref.side, move: mv.id, name: koName('move', mv.id), type: mv.type, typeKo: koName('type', mv.type), cls: mv.category === 'Status' ? 'status' : mv.category === 'Physical' ? 'phys' : 'spec', text: `${J(label(ref), '의')} ${koName('move', mv.id)}!` }); return; }
        push({ t: 'move', side: ref.side, move: mv.id, name: koName('move', mv.id), type: mv.type, typeKo: koName('type', mv.type), cls: mv.category === 'Status' ? 'status' : mv.category === 'Physical' ? 'phys' : 'spec', text: `${label(ref)}의 ${koName('move', mv.id)}!` });
        return;
      }
      case '-miss': { const src = parseRef(p[1]); push({ t: 'miss', side: src.side, text: `${label(src)}의 공격은 빗나갔다!` }); return; }
      case '-damage': {
        const ref = parseRef(p[1]); const u = hpUpdate(ref, p[2]); if (!u) return;
        const amount = u.prev ? Math.max(0, u.prev.hp - u.next.hp) : 0;
        const ev = { t: 'damage', side: ref.side, amount, hp: u.next.hp, maxHp: u.next.max };
        if (f.from) {
          const from = String(f.from); const eff = K.effectKo(from), who = label(ref), of = f.of ? parseRef(f.of) : null;
          ev.cause = bare(from);
          if (/^item: Life Orb/.test(from)) ev.text = `${J(who, '은/는')} 생명의구슬의 반동을 받았다!`;
          else if (from === 'brn') ev.text = `${J(who, '은/는')} 화상 데미지를 입었다!`;
          else if (from === 'psn' || from === 'tox') ev.text = `${J(who, '은/는')} 독 데미지를 입었다!`;
          else if (from === 'confusion') ev.text = `${J(who, '은/는')} 혼란으로 자신을 공격했다!`;
          else if (/Stealth Rock/.test(from)) ev.text = `${J(who, '에게')} 뾰족한 바위가 박혔다!`;
          else if (/Toxic Spikes|Spikes/.test(from)) ev.text = `${J(who, '은/는')} 압정에 찔렸다!`;
          else if (from === 'Sandstorm') ev.text = `모래바람이 ${J(who, '을/를')} 덮쳤다!`;
          else if (from === 'Hail') ev.text = `싸라기눈이 ${J(who, '을/를')} 덮쳤다!`;
          else if (from === 'Recoil') ev.text = `${J(who, '은/는')} 반동 데미지를 입었다!`;
          else if (/Leech Seed/.test(from)) ev.text = `${J(who, '의')} 체력을 씨뿌리기가 빼앗는다!`;
          else if (/^ability: /.test(from) && of) ev.text = `${J(label(of), '의')} ${eff}! ${J(who, '은/는')} 데미지를 입었다!`;
          else { ev.text = `${J(who, '은/는')} ${eff}의 효과로 데미지를 입었다!`; mark('-damage[from] ' + from, noKo(from)); }
        }
        push(ev); return;
      }
      case '-heal': {
        const ref = parseRef(p[1]); const u = hpUpdate(ref, p[2]); if (!u) return;
        const amount = u.prev ? Math.max(0, u.next.hp - u.prev.hp) : 0; const who = label(ref);
        let text = `${J(who, '의')} 체력이 회복되었다!`;
        if (f.from) {
          const from = String(f.from), eff = K.effectKo(from);
          if (/^drain/.test(from) && f.of) text = `${J(label(parseRef(f.of)), '에게서')} 체력을 빼앗았다!`;
          else if (/^item: /.test(from)) text = `${J(who, '은/는')} ${eff}(으)로 체력을 회복했다!`;
          else if (/^ability: /.test(from)) text = `${J(who, '의')} ${eff}! 체력이 회복되었다!`;
          else if (from === 'move: Wish') text = `${J(who, '의')} 희망사항이 이루어졌다!`;
          else { text = `${J(who, '은/는')} ${eff}의 효과로 체력을 회복했다!`; mark('-heal[from] ' + from, noKo(from)); }
        }
        if (f.silent) text = '';
        push({ t: 'heal', side: ref.side, amount, hp: u.next.hp, maxHp: u.next.max, text }); return;
      }
      case '-sethp': { const ref = parseRef(p[1]); hpUpdate(ref, p[2]); return; }
      case '-crit': push({ t: 'crit', text: '급소에 맞았다!' }); return;
      case '-supereffective': push({ t: 'effective', side: parseRef(p[1]).side, eff: 2, text: '효과가 굉장했다!' }); return;
      case '-resisted': push({ t: 'effective', side: parseRef(p[1]).side, eff: 0.5, text: '효과가 별로인 듯하다...' }); return;
      case '-immune': {
        const ref = parseRef(p[1]);
        if (f.from && /^ability: /.test(String(f.from))) { push({ t: 'text', text: `${J(label(ref), '의')} ${K.effectKo(f.from)}! 효과가 없다!` }); return; }
        push({ t: 'effective', side: ref.side, eff: 0, text: `${J(label(ref), '에게는')} 효과가 없는 것 같다...` }); return;
      }
      case '-hitcount': push({ t: 'hits', text: `${p[2]}번 맞았다!` }); return;
      case '-fail': push({ t: 'text', text: '하지만 실패했다!' }); return;
      case '-notarget': push({ t: 'text', text: '하지만 대상이 없었다!' }); return;
      case '-nothing': push({ t: 'text', text: '하지만 아무 일도 일어나지 않았다!' }); return;
      case '-ohko': push({ t: 'text', text: '일격필살!' }); return;
      case 'faint': { const ref = parseRef(p[1]); T.vol[ref.side].clear(); const act = T.active[ref.side]; const cur = act && act.name === ref.name ? T.hp[ref.side][act.key] : null; if (cur) cur.hp = 0; push({ t: 'faint', side: ref.side, hp: 0, maxHp: cur ? cur.max : 100, text: `${J(label(ref), '은/는')} 쓰러졌다!` }); return; }
      case 'cant': {
        const ref = parseRef(p[1]); const why = bare(p[2]); const base = K.CANT[why];
        push({ t: 'text', text: `${J(label(ref), '은/는')} ${base || (p[3] ? `${koName('move', p[3])}을(를) 쓸 수 없다!` : '움직일 수 없다!')}` });
        if (!base && !p[3]) mark('cant ' + why, true); return;
      }
      case '-status': {
        const ref = parseRef(p[1]); const st = p[2]; if (f.silent) { push({ t: 'status', side: ref.side, kind: st, text: '' }); return; }
        push({ t: 'status', side: ref.side, kind: st, text: `${J(label(ref), '은/는')} ${K.STATUS_START[st] || '상태이상에 걸렸다!'}` }); return;
      }
      case '-curestatus': { const ref = parseRef(p[1]); const st = p[2]; push({ t: 'status', side: ref.side, kind: st === 'slp' ? 'wake' : st === 'frz' ? 'thaw' : 'cure', cured: st, text: f.silent ? '' : `${J(label(ref), '은/는')} ${K.STATUS_CURE[st] || '상태이상이 나았다!'}` }); return; }
      case '-cureteam': push({ t: 'text', text: '모든 동료의 상태이상이 나았다!' }); return;
      case '-boost': case '-unboost': {
        const ref = parseRef(p[1]); const stat = p[2], n = Number(p[3]); const up = k === '-boost';
        const mag = n >= 3 ? '매우 크게 ' : n === 2 ? '크게 ' : '';
        push({ t: 'stage', side: ref.side, stat, change: up ? n : -n, text: f.silent ? '' : `${label(ref)}의 ${K.STAT_KO[stat] || stat}${josaFor(K.STAT_KO[stat] || stat)} ${mag}${up ? '올랐다' : '떨어졌다'}!` }); return;
      }
      case '-setboost': { const ref = parseRef(p[1]); push({ t: 'stage', side: ref.side, stat: p[2], change: 0, set: Number(p[3]), text: `${J(label(ref), '의')} ${K.STAT_KO[p[2]] || p[2]}이(가) 변화했다!` }); return; }
      case '-clearallboost': push({ t: 'text', text: '모든 능력 변화가 원래대로 돌아왔다!' }); return;
      case '-clearnegativeboost': push({ t: 'text', text: `${J(label(parseRef(p[1])), '의')} 떨어진 능력이 원래대로 돌아왔다!` }); return;
      case '-clearboost': push({ t: 'text', text: `${J(label(parseRef(p[1])), '의')} 능력 변화가 원래대로 돌아왔다!` }); return;
      case '-copyboost': push({ t: 'text', text: `${J(label(parseRef(p[1])), '은/는')} 상대의 능력 변화를 복사했다!` }); return;
      case '-weather': {
        const w = p[1]; const t = K.WEATHER[w];
        if (w === 'none') { T.field.weather = null; snapshotField(); push({ t: 'text', text: '날씨가 원래대로 돌아왔다!' }); return; }
        const upkeep = !!f.upkeep; T.field.weather = w;
        if (!upkeep) snapshotField();
        push({ t: 'text', text: upkeep ? (t ? t[1] : '') : (t ? t[0] : `날씨가 ${K.WEATHER_KO[w] || w}(으)로 바뀌었다!`) });
        if (!t) mark('-weather ' + w, true); return;
      }
      case '-fieldstart': case '-fieldend': {
        const name = bare(p[1]); const start = k === '-fieldstart';
        const kind = K.FIELD_KIND[name];
        if (kind === 'terrain') T.field.terrain = start ? name : null; else if (start) T.field.pseudo.set(name, 1); else T.field.pseudo.delete(name);
        snapshotField();
        const txt = start ? K.fieldStart(name) : K.fieldEnd(name);
        push({ t: 'text', text: txt || (start ? `${J(K.effectKo(p[1]), '이/가')} 발동했다!` : `${J(K.effectKo(p[1]), '이/가')} 사라졌다!`) });
        if (!txt) mark(k + ' ' + name, noKo(p[2] || p[1])); return;
      }
      case '-fieldactivate': push({ t: 'text', text: `${K.effectKo(p[1])}!` }); return;
      case '-sidestart': case '-sideend': {
        const s = parseSide(p[1]), name = bare(p[2]); const start = k === '-sidestart'; const m = T.field.sides[s];
        if (start) m.set(name, (m.get(name) || 0) + 1); else m.delete(name);
        snapshotField();
        const txt = start ? K.sideStart(name) : K.sideEnd(name);
        push({ t: 'text', text: `${sideLabel(s)} ${txt || (start ? `${K.effectKo(p[2])}이(가) 발동했다!` : `${K.effectKo(p[2])}의 효과가 끝났다!`)}` });
        if (!txt) mark(k + ' ' + name, noKo(p[2] || p[1])); return;
      }
      case '-start': case '-end': {
        const ref = parseRef(p[1]); const eff = bare(p[2]); const start = k === '-start'; const who = label(ref);
        if (eff === 'typechange') {
          const ts = plain(p.slice(3)).join('').split('/').filter(Boolean).map(x => koName('type', x));
          push({ t: 'types', side: ref.side, types: String(plain(p.slice(3)).join('')).split('/').filter(Boolean), typesKo: ts, text: ts.length ? `${J(who, '의')} 타입이 ${J(ts.join('/'), '으로/로')} 바뀌었다!` : `${J(who, '의')} 타입이 바뀌었다!` }); return;
        }
        const v = K.VOLATILE[eff] || K.VOLATILE[eff === 'confusion' ? 'confusion' : eff];
        if (start) T.vol[ref.side].add(toID(eff)); else T.vol[ref.side].delete(toID(eff));
        if (/^(perish\d|Dynamax|Mega)/i.test(eff)) { volEvent(ref.side); return; }
        const text = f.silent ? '' : v ? (start ? v[0] : v[1]) : '';
        if (text) push({ t: 'text', text: `${J(who, '은/는')} ${text}` });
        else if (!v && !f.silent) { push({ t: 'text', text: start ? `${J(who, '은/는')} ${K.effectKo(p[2])}의 영향을 받고 있다!` : `${J(who, '의')} ${K.effectKo(p[2])} 효과가 끝났다!` }); mark(k + ' ' + eff, noKo(p[2])); }
        volEvent(ref.side); return;
      }
      case '-activate': {
        const ref = parseRef(p[1]); const eff = bare(p[2]); const who = label(ref);
        if (K.PROTECT[eff]) { push({ t: 'text', text: `${J(who, '은/는')} ${K.PROTECT[eff]}` }); return; }
        if (eff === 'Substitute') { push({ t: 'text', text: f.damage ? `${J(who, '의')} 대타가 대신 공격을 받았다!` : `${J(who, '의')} 대타가 이미 있다!` }); return; }
        if (eff === 'confusion') { push({ t: 'text', text: `${J(who, '은/는')} 혼란에 빠져 있다!` }); return; }
        if (/^(ability|item): /.test(p[2])) { push({ t: 'text', text: `${J(who, '의')} ${K.effectKo(p[2])}!` }); return; }
        push({ t: 'text', text: `${J(who, '에게')} ${K.effectKo(p[2])}의 효과!` }); mark('-activate ' + eff, noKo(p[2])); return;
      }
      case '-ability': { const ref = parseRef(p[1]); if (f.silent) return; push({ t: 'text', text: `${J(label(ref), '의')} ${koName('ability', p[2])}!` }); return; }
      case '-endability': push({ t: 'text', text: `${J(label(parseRef(p[1])), '의')} 특성이 효과를 잃었다!` }); return;
      case '-item': { const ref = parseRef(p[1]); if (f.silent) return; push({ t: 'text', text: `${J(label(ref), '은/는')} ${J(koName('item', p[2]), '을/를')} 손에 넣었다!` }); return; }
      case '-enditem': {
        const ref = parseRef(p[1]); if (f.silent) return;
        const it = koName('item', p[2]);
        push({ t: 'text', text: f.eat ? `${J(label(ref), '은/는')} ${J(it, '을/를')} 먹었다!` : `${J(label(ref), '의')} ${it}!` }); return;
      }
      case '-prepare': { const ref = parseRef(p[1]); push({ t: 'text', text: `${J(label(ref), '은/는')} 힘을 모으고 있다!` }); return; }
      case '-mustrecharge': return;
      case '-block': push({ t: 'text', text: `${J(label(parseRef(p[1])), '의')} ${K.effectKo(p[2])}! 막아냈다!` }); return;
      case '-mega': {
        const ref = parseRef(p[1]); const stone = koName('item', p[3]);
        push({ t: 'mega', side: ref.side, text: `${J(label(ref), '은/는')} ${J(stone, '으로/로')} 메가진화했다!` }); return;
      }
      case 'detailschange': case '-formechange': {
        const ref = parseRef(p[1]); const sp = dex.species.get(p[2].split(',')[0]); T.form[ref.side][ref.name] = sp.name;
        push({ t: 'forme', side: ref.side, species: sp.id, name: koName('species', sp.id), types: sp.types.slice(), typesKo: sp.types.map(x => koName('type', x)) }); return;
      }
      case '-transform': push({ t: 'text', text: `${J(label(parseRef(p[1])), '은/는')} ${J(label(parseRef(p[2])), '으로/로')} 변신했다!` }); return;
      case 'replace': { const ref = parseRef(p[1]); push({ t: 'text', text: `${J(label(ref), '의')} 정체가 드러났다!` }); return; }
      case 'win': { const s = parseSide(p[1]); push({ t: 'end', winner: s, text: s === me ? '승리했다!' : '패배했다...' }); return; }
      case 'tie': push({ t: 'end', winner: -1, text: '무승부!' }); return;
      default: mark(k, false); return;
    }
  }

  /** 능력 이름 뒤의 이/가: '공격이', '스피드가' */
  function josaFor(word) { return josa(word, '이/가').slice(word.length); }

  T.feed = lines => { out.length = 0; for (const l of lines) line(l); return out.slice(); };
  /** match 에서 아직 읽지 않은 이 시점의 줄을 이벤트로 */
  T.pull = () => { const lines = match.view(side, T.cursor); T.cursor += lines.length; return T.feed(lines); };
  return T;
}
