import { store } from '../store.js';
import { R2, DEX, esc, formLabel, monImg, TYPE_HEX, TYPE_GLYPH, isLite, typeName, typeId, monTypes, moveInfo, toSets, megaOf, abilityKo, itemKo } from '../dex.js';
import { sfx } from '../sfx.js';
import { wait, toast } from '../fx.js';

const STAT_KO = { atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드', accuracy: '명중', evasion: '회피' };
const STATUS_KO = { par: '마비', brn: '화상', psn: '독', tox: '맹독', slp: '수면', frz: '얼음' };
// 임시 상태 (Showdown 식별자 → 표시). 여기 없는 것은 화면에 배지로 내지 않는다.
const VOL_KO = { confusion: '혼란', substitute: '대타', leechseed: '씨뿌리기', taunt: '도발', encore: '앙코르', disable: '봉인', torment: '트집', yawn: '졸림', aquaring: '아쿠아링', ingrain: '뿌리',
  attract: '헤롱헤롱', nightmare: '악몽', curse: '저주', perish3: '멸망 3', perish2: '멸망 2', perish1: '멸망 1', focusenergy: '기합', protect: '방어', partiallytrapped: '조이기', octolock: '문어굳히기',
  lockedmove: '난동', healblock: '회복봉인', embargo: '금제', magnetrise: '전자부유', telekinesis: '텔레키네시스', smackdown: '떨어뜨림', destinybond: '길동무', saltcure: '소금절임', syrupbomb: '시럽폭탄' };
const WEATHER_UI = { sun: '☀ 쾌청', rain: '☔ 비', sand: '🌪 모래바람', snow: '❄ 눈' };
const WEATHER_MAP = { raindance: 'rain', primordialsea: 'rain', sunnyday: 'sun', desolateland: 'sun', sandstorm: 'sand', snow: 'snow', snowscape: 'snow', hail: 'snow' };
const TERRAIN_UI = { electric: '⚡ 일렉트릭필드', grassy: '🌿 그래스필드', misty: '🌫 미스트필드', psychic: '🔮 사이코필드' };
const TERRAIN_MAP = { electricterrain: 'electric', grassyterrain: 'grassy', mistyterrain: 'misty', psychicterrain: 'psychic' };
const condList = list => (list || []).map(c => (c.layers > 1 ? `${c.ko}×${c.layers}` : c.ko));
const rnd32 = () => Math.floor(Math.random() * 2 ** 31);

export function mount(root, { go, params }) {
  const { mine, opp, level } = params;
  const R = R2(), D = DEX();
  const match = R.createMatch({ teams: [toSets(mine), toSets(opp)], seed: [rnd32(), rnd32(), rnd32(), rnd32()] });
  const me = match.player(0), foeP = match.player(1);
  const ai = R.createAI({ dex: D, seed: rnd32(), budgetMs: 900 });
  const T = R.createTranslator(match, 0);
  let alive = true, speed = Number(sessionStorage.getItem('proelium:speed')) || 1, skip = false, resolveChoice = null, megaOn = false;
  const dmgBy = [0, 0, 0]; let kos = 0;

  // 화면용 상태(이벤트를 따라 갱신): 엔진은 한 턴을 한꺼번에 계산하므로, 연출 중간 상태를 따로 들고 있어야 한다.
  // 상대 포켓몬의 체력은 퍼센트(최대 100)로만 알 수 있다.
  const mk = (id, name, maxHp, hp) => { const types = monTypes(id); return { id, name, types, origTypes: types.slice(), maxHp, hp, fainted: false, status: null, confusion: false, stages: {}, vol: {} }; };
  const U = {
    field: { weather: null, terrain: null, pseudo: [], sides: [[], []] },
    side: [
      { active: 0, party: me.team().map(m => mk(R.toID(m.species), formLabel(R.toID(m.species)), m.maxHp, m.hp)) },
      { active: 0, party: opp.map(t => mk(t.id, formLabel(t.id), 100, 100)) },
    ],
  };
  const cur = si => U.side[si].party[U.side[si].active];
  const ms = n => (skip ? 0 : n / speed);
  const dly = n => wait(ms(n));

  root.innerHTML = `
    <main class="battle screen">
      <div class="arena" id="arena">
        <div class="wx" id="wx"></div><div class="floor"></div>
        <div class="fieldbar" id="fieldbar"></div>
        <div class="tools"><button class="iconbtn" data-act="speed" id="speedBtn" title="재생 속도">${speed}x</button><button class="iconbtn" data-act="skip" title="연출 건너뛰기">⏭</button><button class="iconbtn" data-act="sound" id="sndBtn">${store.sound ? '🔊' : '🔇'}</button></div>
        <div class="side foe" id="side-1"><div class="plate" id="plate-1"></div><div class="mon" id="mon-1"><i class="ring"></i><div class="art"></div></div></div>
        <div class="side me" id="side-0"><div class="plate" id="plate-0"></div><div class="mon" id="mon-0"><i class="ring"></i><div class="art"></div></div></div>
        <div class="fxlayer" id="fx"></div><div class="flash" id="flash"></div><div class="banner" id="banner"></div>
      </div>
      <div class="log" id="log"><p>배틀 준비...</p></div>
      <div class="controls" id="controls"></div>
      <div id="overlay"></div>
    </main>`;
  const $ = s => root.querySelector(s);
  const arena = $('#arena');

  // ───────── 그리기 ─────────
  const hpClass = r => (r > 0.5 ? 'g' : r > 0.2 ? 'y' : 'r');
  function renderPlate(si) {
    const side = U.side[si], m = cur(si), r = m.maxHp ? m.hp / m.maxHp : 0;
    const badges = [];
    if (m.status) badges.push(`<i class="bd ${m.status}">${STATUS_KO[m.status]}</i>`);
    if (m.confusion) badges.push('<i class="bd cnf">혼란</i>');
    for (const k of Object.keys(m.stages)) if (m.stages[k]) badges.push(`<i class="bd ${m.stages[k] > 0 ? 'up' : 'down'}">${STAT_KO[k]} ${m.stages[k] > 0 ? '▲' : '▼'}${Math.abs(m.stages[k])}</i>`);
    for (const k of Object.keys(m.vol)) if (VOL_KO[k]) badges.push(`<i class="bd vol">${VOL_KO[k]}</i>`);
    condList(U.field.sides[si]).forEach(t => badges.push(`<i class="bd cond">${esc(t)}</i>`));
    $('#plate-' + si).innerHTML = `
      <div class="p-top"><b>${esc(m.name)}</b><span class="ptypes">${m.types.map(t => `<i style="background:${TYPE_HEX[t]}">${TYPE_GLYPH[t]}</i>`).join('')}</span><small>Lv.100</small></div>
      <div class="hp"><i class="ghost" style="width:${(r * 100).toFixed(1)}%"></i><i class="fill ${hpClass(r)}" style="width:${(r * 100).toFixed(1)}%"></i>${si === 0 ? `<span class="hpnum">${m.hp} / ${m.maxHp}</span>` : ''}</div>
      <div class="p-bot"><span class="pdots">${side.party.map((x, i) => `<i class="${x.fainted ? 'ko' : ''}${i === side.active ? ' cur' : ''}"></i>`).join('')}</span><span class="badges">${badges.join('')}</span></div>`;
  }
  function renderMon(si, enter) {
    const m = cur(si), el = $('#mon-' + si);
    el.className = 'mon' + (m.fainted ? ' ko' : '');
    el.style.setProperty('--c', TYPE_HEX[m.types[0]]);
    el.querySelector('.art').innerHTML = monImg(m.id);
    if (enter) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
  }
  function updateHp(si) {
    const m = cur(si), r = m.maxHp ? m.hp / m.maxHp : 0, p = $('#plate-' + si);
    const fill = p.querySelector('.fill'), ghost = p.querySelector('.ghost'), num = p.querySelector('.hpnum');
    fill.style.width = (r * 100).toFixed(1) + '%'; fill.className = 'fill ' + hpClass(r);
    setTimeout(() => { ghost.style.width = (r * 100).toFixed(1) + '%'; }, ms(450));
    if (num) num.textContent = `${m.hp} / ${m.maxHp}`;
  }
  function renderField() {
    const f = U.field, tags = [];
    if (f.weather) tags.push(WEATHER_UI[f.weather]);
    if (f.terrain) tags.push(TERRAIN_UI[f.terrain]);
    for (const p of f.pseudo) tags.push(`🌀 ${p.ko}`);
    $('#fieldbar').innerHTML = tags.map(t => `<span>${esc(t)}</span>`).join('');
    $('#wx').className = 'wx' + (f.weather ? ' ' + f.weather : '') + (f.terrain ? ' t-' + f.terrain : '');
  }
  const say = text => { const p = $('#log p'); p.textContent = text; p.classList.remove('in'); void p.offsetWidth; p.classList.add('in'); };

  // ───────── 연출 도구 ─────────
  const centerOf = si => { const a = arena.getBoundingClientRect(), b = $('#mon-' + si + ' .art').getBoundingClientRect(); return { x: b.left - a.left + b.width / 2, y: b.top - a.top + b.height / 2 }; };
  function spawn(cls, html, pos, style, life = 1100) {
    const d = document.createElement('div'); d.className = cls; d.innerHTML = html || ''; d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px';
    if (style) d.style.cssText += style; $('#fx').appendChild(d); setTimeout(() => d.remove(), life / speed + 120); return d;
  }
  const float = (si, text, cls, dy = 0) => { const c = centerOf(si); spawn('float ' + (cls || ''), esc(text), { x: c.x, y: c.y - 30 + dy }); };
  // 타격 파티클은 타입 색에 금색·파랑·흰색과 여러 색을 섞어 화려하게 터뜨린다
  const CONFETTI = ['#ffb21f', '#ffe3a6', '#ffffff', '#9bb8ff', '#ff5fa2', '#5ee7ff', '#7dff6b', '#b45cff'];
  function burst(si, color, n = 12) {
    const c = centerOf(si), total = n + 10;
    spawn('ringfx', '', c, `--c:${color}`, 700);
    spawn('ringfx gold', '', c, '--c:#ffb21f', 950);
    for (let i = 0; i < total; i++) {
      const a = (Math.PI * 2 * i) / total + Math.random() * .5, d = 70 + Math.random() * 120;
      const col = i % 3 === 0 ? color : CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
      const sz = 6 + Math.random() * 11;
      spawn('spark', '', c, `--c:${col};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;width:${sz}px;height:${sz}px;${i % 4 === 0 ? 'border-radius:2px;' : ''}`, 850);
    }
  }
  const shake = (cls = 'shake') => { arena.classList.remove('shake', 'shake-big'); void arena.offsetWidth; arena.classList.add(cls); };
  const flash = color => { const f = $('#flash'); f.style.setProperty('--c', color || '#fff'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); };
  async function pulse(el, cls, t) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); await dly(t); el.classList.remove(cls); }
  async function banner(text, cls, t = 900) { const b = $('#banner'); b.className = 'banner ' + (cls || ''); b.textContent = text; void b.offsetWidth; b.classList.add('on'); await dly(t); b.classList.remove('on'); }
  let curMove = null, pendingCrit = false;

  // ───────── 이벤트 연출 ─────────
  async function handle(ev) {
    switch (ev.t) {
      case 'turn': say(`${ev.turn}턴`); break;
      case 'switch': {
        const s = U.side[ev.side];
        if (!ev.initial) { const o = s.party[s.active]; Object.assign(o, { stages: {}, confusion: false, vol: {}, types: o.origTypes.slice(), id: o.baseId || o.id }); }
        s.active = ev.to; const m = cur(ev.side); m.hp = ev.hp; m.maxHp = ev.maxHp; m.baseId = m.baseId || m.id; m.id = ev.species; m.types = ev.types.map(typeId); m.vol = {};
        renderPlate(ev.side); renderMon(ev.side, true); sfx.whoosh(); say(ev.text); await dly(ev.initial ? 650 : 800);
        break;
      }
      case 'move': {
        curMove = Object.assign({}, ev, { typeId: typeId(ev.type) }); say(ev.text);
        const tid = curMove.typeId, col = TYPE_HEX[tid] || '#fff', el = $('#mon-' + ev.side);
        const c = centerOf(ev.side);
        spawn('mvtag' + (isLite(tid) ? ' lite' : ''), `${TYPE_GLYPH[tid] || '✦'} ${esc(ev.name)}`, { x: c.x, y: c.y - 110 }, `--c:${col}`, 1000);
        if (ev.cls === 'status') { sfx.buff(); spawn('ringfx big', '', c, `--c:${col}`, 800); await pulse(el, 'cast', 520); }
        else { sfx.whoosh(); await pulse(el, ev.side === 0 ? 'lunge-me' : 'lunge-foe', 420); }
        break;
      }
      case 'miss': say(ev.text); float(1 - ev.side, 'MISS', 'miss'); await dly(750); break;
      case 'damage': {
        const m = cur(ev.side); m.hp = ev.hp; m.maxHp = ev.maxHp;
        const crit = pendingCrit; pendingCrit = false;
        const byMove = !ev.cause && curMove && curMove.side !== ev.side;
        if (byMove && curMove.side === 0 && ev.side === 1) dmgBy[U.side[0].active] += ev.amount;      // 상대 체력은 퍼센트라 퍼센트포인트로 센다
        updateHp(ev.side);
        const col = ev.cause ? '#ff6b81' : TYPE_HEX[(curMove || {}).typeId] || '#fff';
        if (!ev.cause) { burst(ev.side, col, crit ? 20 : 12); shake(crit || ev.amount > m.maxHp * .35 ? 'shake-big' : 'shake'); crit ? sfx.crit() : sfx.hit(); }
        else sfx.weak();
        float(ev.side, ev.side === 1 ? `-${ev.amount}%` : `-${ev.amount}`, crit ? 'crit' : ev.cause ? 'dot' : '');
        if (ev.text) say(ev.text);
        await pulse($('#mon-' + ev.side), 'hit', 520);
        await dly(ev.text ? 550 : 250);
        break;
      }
      case 'effective': {
        say(ev.text);
        const label = ev.eff === 0 ? '효과 없음…' : ev.eff > 1 ? '효과 굉장!' : '효과 별로…';
        if (ev.eff > 1) sfx.crit(); else sfx.weak();
        await banner(label, ev.eff === 0 ? 'none' : ev.eff > 1 ? 'super' : 'weak', 800);
        break;
      }
      case 'crit': pendingCrit = true; flash('#ffd23f'); say(ev.text); await banner('CRITICAL!', 'crit', 650); break;
      case 'hits': say(ev.text); await dly(500); break;
      case 'heal': {
        const m = cur(ev.side); m.hp = ev.hp; m.maxHp = ev.maxHp; updateHp(ev.side); sfx.heal();
        const c = centerOf(ev.side);
        for (let i = 0; i < 8; i++) spawn('sparkle', '✦', { x: c.x + (Math.random() - .5) * 120, y: c.y + 20 }, `animation-delay:${i * 60}ms`, 1200);
        if (ev.amount > 0) float(ev.side, ev.side === 1 ? `+${ev.amount}%` : `+${ev.amount}`, 'heal');
        if (ev.text) say(ev.text); await pulse($('#mon-' + ev.side), 'healfx', 700); break;
      }
      case 'status': {
        const m = cur(ev.side);
        if (STATUS_KO[ev.kind]) { m.status = ev.kind; if (ev.text) { float(ev.side, STATUS_KO[ev.kind], 'stat'); sfx.debuff(); } }
        else if (ev.kind === 'thaw' || ev.kind === 'wake' || ev.kind === 'cure') m.status = null;
        renderPlate(ev.side); if (ev.text) { say(ev.text); await dly(750); } break;
      }
      case 'stage': {
        const m = cur(ev.side); m.stages[ev.stat] = (m.stages[ev.stat] || 0) + ev.change; if (!m.stages[ev.stat]) delete m.stages[ev.stat];
        renderPlate(ev.side);
        if (ev.text) { ev.change > 0 ? sfx.buff() : sfx.debuff(); float(ev.side, `${STAT_KO[ev.stat] || ev.stat} ${ev.change > 0 ? '▲' : '▼'}`, ev.change > 0 ? 'up' : 'down'); say(ev.text); await dly(700); }
        break;
      }
      case 'vol': cur(ev.side).vol = Object.fromEntries(ev.flags.map(f => [f, 1])); renderPlate(ev.side); break;
      case 'types': cur(ev.side).types = ev.types.map(typeId); renderPlate(ev.side); renderMon(ev.side, false); if (ev.text) { say(ev.text); await dly(600); } break;
      case 'forme': { const m = cur(ev.side); m.id = ev.species; m.types = ev.types.map(typeId); renderPlate(ev.side); renderMon(ev.side, true); break; }
      case 'mega': { sfx.crit(); flash('#ff5fa2'); say(ev.text); await banner('MEGA EVOLUTION', 'ready', 1000); break; }
      case 'field': {
        const w = String(ev.weather || '').toLowerCase().replace(/[^a-z]/g, ''), tr = String(ev.terrain || '').toLowerCase().replace(/[^a-z]/g, '');
        U.field = { weather: WEATHER_MAP[w] || null, terrain: TERRAIN_MAP[tr] || null, pseudo: ev.pseudo || [], sides: ev.sides || [[], []] };
        renderField(); renderPlate(0); renderPlate(1); await dly(450); break;
      }
      case 'faint': {
        const m = cur(ev.side); m.fainted = true; m.hp = 0; m.status = null; m.confusion = false; m.stages = {}; m.vol = {}; m.types = m.origTypes.slice();
        if (ev.side === 1) kos++;
        updateHp(ev.side); renderPlate(ev.side); sfx.faint(); say(ev.text); shake('shake-big');
        $('#mon-' + ev.side).classList.add('ko');
        await banner('K.O.', 'ko', 1000);
        break;
      }
      case 'text': if (ev.text) { say(ev.text); await dly(Math.min(1200, 420 + ev.text.length * 22)); } break;
      case 'end': say(ev.text); await dly(600); break;
    }
  }
  async function play(events) { for (const ev of events) { if (!alive) return; await handle(ev); } }

  // ───────── 조작 ─────────
  const TYPE_EN = ['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy'];
  const hintOf = (mvType, foeTypes) => { const e = R.typeMultiplier(TYPE_EN[mvType - 1], foeTypes.map(t => TYPE_EN[t - 1])); return e === 0 ? ['im', '무효'] : e >= 4 ? ['se', '×4'] : e > 1 ? ['se', '×2'] : e < 1 ? ['nve', e <= .25 ? '×¼' : '×½'] : null; };
  function renderControls() {
    const info = me.moves(), foe = cur(1), team = me.team(), canSwitch = match.choices(0).some(c => c.type === 'switch');
    // 반동·충전·난동처럼 선택지가 하나로 고정된 턴: 기술 칸이 하나뿐이고(교체 불가), PP 정보는 요청에 없다
    const forced = !!(info && info.locked);
    const cards = !info ? '' : info.moves.map((sl, i) => {
      const m = moveInfo(sl.id, sl.name), col = TYPE_HEX[m.type], st = m.cls === 'status', h = !st && !forced && hintOf(m.type, foe.types);
      const meta = st ? esc(m.desc || '변화 기술') : `${m.cls === 'phys' ? '물리' : '특수'} · 위력 ${m.varPower ? '가변' : m.power} · ${m.acc === null ? '필중' : '명중 ' + m.acc}${m.desc ? ' · ' + esc(m.desc) : ''}`;
      const pp = sl.pp == null || sl.maxpp == null ? '' : `<em>PP ${sl.pp}/${sl.maxpp}</em>`;
      const why = sl.disabled ? '사용 불가' : m.pseudo ? '' : sl.id === 'struggle' ? '쓸 수 있는 기술이 없어요' : forced ? '이어서 사용' : '';
      return `<button class="mvc${st ? ' st' : ''}${isLite(m.type) ? ' lite' : ''}${forced ? ' forced' : ''}" style="--c:${col}${forced ? ';grid-column:1/-1' : ''}" data-act="move" data-i="${i}" ${sl.disabled ? 'disabled' : ''} title="${i + 1}번 키">
        <span class="g">${TYPE_GLYPH[m.type]}</span><b>${esc(m.name)}</b><small>${meta}</small>${pp}
        ${why ? `<u class="why">${why}</u>` : h ? `<u class="hint ${h[0]}">${h[1]}</u>` : ''}</button>`;
    }).join('');
    const active = team.find(m => m.active), mega = info && info.canMega ? megaOf({ id: R.toID(active.species), item: active.item }) : null;
    $('#controls').innerHTML = `<div class="mvgrid">${cards}</div>
      <div class="subbar">${info && info.canMega ? `<button class="btn mega${megaOn ? ' primary' : ''}" data-act="mega" title="이번 턴에 메가진화">🌀 메가진화 ${megaOn ? 'ON' : 'OFF'}</button>` : ''}<button class="btn" data-act="switch-open" ${canSwitch ? '' : 'disabled'}>${info && info.trapped ? '🔒 교체 불가' : '🔄 교체'}</button><button class="btn danger" data-act="surrender">🏳 항복</button></div>`;
  }
  const lock = () => { $('#controls').classList.add('lock'); };
  const unlock = () => { $('#controls').classList.remove('lock'); };
  const choose = () => new Promise(res => { resolveChoice = res; renderControls(); unlock(); });
  /** 교체할 포켓몬 고르기. 합법인 교체 선택지만 누를 수 있다. 돌려주는 값은 선택지 객체(취소는 null) */
  function partyPicker(title, allowCancel) {
    return new Promise(res => {
      const ov = $('#overlay'), team = me.team(), opts = new Map(match.choices(0).filter(c => c.type === 'switch').map(c => [c.to, c]));
      ov.innerHTML = `<div class="pick-ov"><div class="pick-box glass"><h3 class="display">${esc(title)}</h3><div class="pick-list">${team.map((m, i) => {
        // 요청의 종 이름은 지금 모습(메가 등)이고, 화면 상태의 id 는 교체로 나갈 때 원래 종으로 되돌아가 있을 수 있다 → 지금 모습·이름(ident)·원래 종 어느 것으로든 찾는다
        const id = R.toID(m.species), nm = R.toID(m.ident), u = U.side[0].party.find(x => x.baseId === id || x.id === id || x.baseId === nm || x.id === nm);
        const types = u ? u.origTypes : monTypes(id), off = !opts.has(i), r = m.hp / m.maxHp;
        return `<button class="pcard${off ? ' off' : ''}" data-i="${i}" ${off ? 'disabled' : ''} style="--c1:${TYPE_HEX[types[0]]}"><span class="pa">${monImg(id)}</span><b>${esc(formLabel(id))}</b>
          <div class="hp mini"><i class="fill ${hpClass(r)}" style="width:${(r * 100).toFixed(0)}%"></i></div><small>${m.fainted ? '기절' : m.active ? '출전 중' : `${m.hp}/${m.maxHp}`}${m.status && STATUS_KO[m.status] ? ' · ' + STATUS_KO[m.status] : ''}</small></button>`;
      }).join('')}</div>${allowCancel ? '<button class="btn" data-pk="cancel">취소</button>' : ''}</div></div>`;
      ov.onclick = e => {
        const c = e.target.closest('.pcard'), x = e.target.closest('[data-pk]');
        if (c && !c.disabled) { ov.innerHTML = ''; ov.onclick = null; sfx.pick(); res(opts.get(Number(c.dataset.i))); }
        else if (x || e.target.classList.contains('pick-ov')) { if (allowCancel) { ov.innerHTML = ''; ov.onclick = null; res(null); } }
      };
    });
  }
  const onClick = async e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    switch (t.dataset.act) {
      case 'move': if (resolveChoice) { const r = resolveChoice; resolveChoice = null; lock(); const info = me.moves(); r(Object.assign({ type: 'move', index: Number(t.dataset.i) }, info && info.canMega && megaOn ? { mega: true } : {})); } break;
      case 'home': go('home'); break;
      case 'mega': megaOn = !megaOn; renderControls(); sfx.click(); break;
      case 'switch-open': { if (!resolveChoice) break; const c = await partyPicker('교체할 포켓몬', true); if (c && resolveChoice) { const r = resolveChoice; resolveChoice = null; lock(); r(c); } break; }
      case 'surrender': if (resolveChoice && confirm('항복하면 패배로 기록돼요. 항복할까요?')) { const r = resolveChoice; resolveChoice = null; r({ type: 'surrender' }); } break;
      case 'speed': speed = speed >= 3 ? 1 : speed + 1; sessionStorage.setItem('proelium:speed', speed); $('#speedBtn').textContent = speed + 'x'; break;
      case 'skip': skip = !skip; t.classList.toggle('on', skip); break;
      case 'sound': store.sound = !store.sound; store.save(); $('#sndBtn').textContent = store.sound ? '🔊' : '🔇'; break;
    }
  };
  root.addEventListener('click', onClick);
  const onKey = e => { if (/^[1-4]$/.test(e.key) && resolveChoice) { const b = root.querySelectorAll('.mvc')[Number(e.key) - 1]; if (b && !b.disabled) b.click(); } };
  document.addEventListener('keydown', onKey);

  // ───────── 진행 ─────────
  /** 상대 AI 의 선택. 지옥은 몇백 ms 걸릴 수 있어 화면이 먼저 그려지도록 한 박자 쉰다 */
  async function foeChoice() {
    if (level === 'hell') { say('상대가 수를 읽고 있어요…'); await wait(30); }
    return ai.choose(foeP, level).choice;
  }
  /** 양쪽 선택을 넣고 생긴 이벤트를 연출한다. 내 선택이 거부되면(상대의 숨은 특성으로 교체가 막힌 경우) 다시 고르게 한다 */
  async function takeTurn(c0, kind0, kind1) {
    for (let attempt = 0; attempt < 4 && alive; attempt++) {
      const c1 = kind1 === 'wait' ? null : await foeChoice();
      try { match.submit([c0, c1]); break; }
      catch (err) {
        if (/p1/.test(err.message)) { toast('지금은 그 선택을 할 수 없어요 (상대 특성 때문에 교체가 막혔어요)'); c0 = kind0 === 'switch' ? await partyPicker('다른 포켓몬을 골라 주세요', false) : await choose(); if (c0.type === 'surrender') return c0; }
        else if (attempt === 3) throw err;
      }
    }
    if (alive) await play(T.pull());
    return null;
  }
  async function run() {
    renderPlate(0); renderPlate(1); renderField();
    await dly(400);
    await banner('READY?', 'ready', 800); await banner('FIGHT!', 'fight', 700);
    await play(T.pull());
    let result = null;
    while (alive && !match.ended) {
      const k0 = match.kind(0), k1 = match.kind(1);
      if (k0 === 'switch' || k1 === 'switch') {                          // 쓰러진 뒤 교체
        const c0 = k0 === 'switch' ? await partyPicker('다음 포켓몬을 골라 주세요', false) : null;
        if (!alive) return;
        const cancel = await takeTurn(c0, k0, k1 === 'switch' ? 'move' : 'wait'); if (cancel) { result = 1; break; }
        continue;
      }
      const c0 = await choose();
      if (c0.type === 'surrender') { result = 1; break; }
      lock();
      const cancel = await takeTurn(c0, 'move', 'move'); if (cancel) { result = 1; break; }
      megaOn = false;
    }
    if (!alive) return;
    const winner = result !== null ? result : match.winner;
    await dly(900);
    go('result', { winner, turns: match.turn, mine, opp, level, dmg: dmgBy, kos });
  }
  run().catch(err => {
    console.error(err);
    say(`오류가 발생했어요. (${String(err && err.message || err).slice(0, 80)}) 홈으로 돌아가 주세요.`);
    const c = $('#controls'); if (c) { c.classList.remove('lock'); c.innerHTML = '<div class="subbar"><button class="btn primary big" data-act="home">🏠 홈으로</button></div>'; }
  });
  return () => { alive = false; root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
}
