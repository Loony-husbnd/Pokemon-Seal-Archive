import { store } from '../store.js';
import { D, E, esc, formLabel, monImg, TYPE_HEX, TYPE_GLYPH, isLite, typeName, moveInfo } from '../dex.js';
import { sfx } from '../sfx.js';
import { wait } from '../fx.js';

const STAT_KO = { atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드', acc: '명중', eva: '회피' };
const STATUS_KO = { par: '마비', brn: '화상', psn: '독', tox: '맹독', slp: '수면', frz: '얼음' };
const VOL_KO = { seeded: '씨뿌리기', taunt: '도발', encore: '앙코르', disable: '봉인', torment: '트집', yawn: '졸림', aquaRing: '아쿠아링', ingrain: '뿌리', sub: '대타', trapped: '가두기',
  attract: '헤롱헤롱', nightmare: '악몽', perish: '멸망', focus: '기합', protect: '방어' };
const WEATHER_UI = { sun: '☀ 쾌청', rain: '☔ 비', sand: '🌪 모래바람', snow: '❄ 눈' };
const TERRAIN_UI = { electric: '⚡ 일렉트릭필드', grassy: '🌿 그래스필드', misty: '🌫 미스트필드', psychic: '🔮 사이코필드' };
const condList = c => [c.rocks && '스텔스록', c.spikes && `압정×${c.spikes}`, c.tspikes && `독압정×${c.tspikes}`, c.web && '끈적네트', c.reflect && '리플렉터', c.lightscreen && '빛의장막',
  c.veil && '오로라베일', c.tailwind && '순풍', c.safeguard && '신비의부적', c.mist && '미스트'].filter(Boolean);

export function mount(root, { go, params }) {
  const { mine, opp, level } = params;
  const Eng = E(), AI = window.BattleAI;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const mkMon = t => Eng.makeMon(t.id, { name: formLabel(t.id), moves: t.moves });
  const B = Eng.createBattle({ parties: [mine.map(mkMon), opp.map(mkMon)], names: ['나', '상대'], seed });
  const brain = AI.create(Eng, { seed: seed ^ 0x9e3779b9 });
  let alive = true, speed = Number(sessionStorage.getItem('proelium:speed')) || 1, skip = false, resolveChoice = null;
  const dmgBy = [0, 0, 0]; let kos = 0;

  // 화면용 상태(이벤트를 따라 갱신): 엔진은 한 턴을 한꺼번에 계산하므로, 연출 중간 상태를 따로 들고 있어야 한다
  const U = {
    field: { weather: null, terrain: null, room: 0, sides: [{}, {}] },
    side: [mine, opp].map(team => ({ active: 0, party: team.map(t => {
      const p = D().pokemon[t.id], types = p.t.slice();
      return { id: t.id, name: formLabel(t.id), types, origTypes: types.slice(), maxHp: 0, hp: 0, fainted: false, status: null, confusion: false, stages: {}, vol: {} };
    }) })),
  };
  B.sides.forEach((s, si) => s.party.forEach((m, i) => { U.side[si].party[i].maxHp = m.maxHp; U.side[si].party[i].hp = m.maxHp; }));
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
    for (const k of Object.keys(VOL_KO)) if (m.vol[k]) badges.push(`<i class="bd vol">${VOL_KO[k]}</i>`);
    condList(U.field.sides[si] || {}).forEach(t => badges.push(`<i class="bd cond">${esc(t)}</i>`));
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
    if (f.room) tags.push('🌀 트릭룸');
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
  function burst(si, color, n = 12) {
    const c = centerOf(si);
    spawn('ringfx', '', c, `--c:${color}`, 700);
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * .5, d = 70 + Math.random() * 70;
      spawn('spark', '', c, `--c:${color};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px`, 700);
    }
  }
  const shake = (cls = 'shake') => { arena.classList.remove('shake', 'shake-big'); void arena.offsetWidth; arena.classList.add(cls); };
  const flash = color => { const f = $('#flash'); f.style.setProperty('--c', color || '#fff'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); };
  async function pulse(el, cls, t) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); await dly(t); el.classList.remove(cls); }
  async function banner(text, cls, t = 900) { const b = $('#banner'); b.className = 'banner ' + (cls || ''); b.textContent = text; void b.offsetWidth; b.classList.add('on'); await dly(t); b.classList.remove('on'); }
  let curMove = null;

  // ───────── 이벤트 연출 ─────────
  async function handle(ev) {
    switch (ev.t) {
      case 'turn': say(ev.text); break;
      case 'switch': {
        const s = U.side[ev.side];
        if (!ev.initial) { const o = s.party[s.active]; Object.assign(o, { stages: {}, confusion: false, vol: {}, types: o.origTypes.slice() }); }
        s.active = ev.to; cur(ev.side).hp = ev.hp;
        renderPlate(ev.side); renderMon(ev.side, true); sfx.whoosh(); say(ev.text); await dly(ev.initial ? 650 : 800);
        break;
      }
      case 'move': {
        curMove = ev; say(ev.text);
        const col = TYPE_HEX[ev.type] || '#fff', el = $('#mon-' + ev.side);
        const c = centerOf(ev.side);
        spawn('mvtag' + (isLite(ev.type) ? ' lite' : ''), `${TYPE_GLYPH[ev.type] || '✦'} ${esc(ev.name)}`, { x: c.x, y: c.y - 110 }, `--c:${col}`, 1000);
        if (ev.cls === 'status') { sfx.buff(); spawn('ringfx big', '', c, `--c:${col}`, 800); await pulse(el, 'cast', 520); }
        else { sfx.whoosh(); await pulse(el, ev.side === 0 ? 'lunge-me' : 'lunge-foe', 420); }
        break;
      }
      case 'miss': say(ev.text); float(1 - ev.side, 'MISS', 'miss'); await dly(750); break;
      case 'damage': {
        const m = cur(ev.side); const was = m.hp; m.hp = ev.hp;
        if (!ev.cause && ev.move) { const att = 1 - ev.side; if (att === 0) dmgBy[U.side[0].active] += ev.amount; }
        updateHp(ev.side);
        const col = ev.cause ? '#ff6b81' : TYPE_HEX[(curMove || {}).type] || '#fff';
        if (!ev.cause) { burst(ev.side, col, ev.crit ? 20 : 12); shake(ev.crit || ev.amount > m.maxHp * .35 ? 'shake-big' : 'shake'); ev.crit ? sfx.crit() : sfx.hit(); }
        else sfx.weak();
        float(ev.side, `-${ev.amount}`, ev.crit ? 'crit' : ev.cause ? 'dot' : '');
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
      case 'crit': flash('#ffd23f'); say(ev.text); await banner('CRITICAL!', 'crit', 650); break;
      case 'hits': say(ev.text); await dly(500); break;
      case 'heal': {
        const m = cur(ev.side); m.hp = ev.hp; updateHp(ev.side); sfx.heal();
        const c = centerOf(ev.side);
        for (let i = 0; i < 8; i++) spawn('sparkle', '✦', { x: c.x + (Math.random() - .5) * 120, y: c.y + 20 }, `animation-delay:${i * 60}ms`, 1200);
        float(ev.side, `+${ev.amount}`, 'heal'); say(ev.text); await pulse($('#mon-' + ev.side), 'healfx', 700); break;
      }
      case 'status': {
        const m = cur(ev.side);
        if (STATUS_KO[ev.kind]) { m.status = ev.kind; float(ev.side, STATUS_KO[ev.kind], 'stat'); sfx.debuff(); }
        else if (ev.kind === 'thaw' || ev.kind === 'wake') m.status = null;
        else if (ev.kind === 'cnf') { m.confusion = true; float(ev.side, '혼란', 'stat'); sfx.debuff(); }
        else if (ev.kind === 'cnfEnd') m.confusion = false;
        renderPlate(ev.side); say(ev.text); await dly(750); break;
      }
      case 'stage': {
        const m = cur(ev.side); m.stages[ev.stat] = (m.stages[ev.stat] || 0) + ev.change; if (!m.stages[ev.stat]) delete m.stages[ev.stat];
        renderPlate(ev.side); ev.change > 0 ? sfx.buff() : sfx.debuff();
        float(ev.side, `${STAT_KO[ev.stat]} ${ev.change > 0 ? '▲' : '▼'}`.repeat(1), ev.change > 0 ? 'up' : 'down');
        say(ev.text); await dly(700); break;
      }
      case 'stages': cur(ev.side).stages = Object.assign({}, ev.stages); renderPlate(ev.side); if (ev.text) { say(ev.text); await dly(600); } break;
      case 'cure': { const s = U.side[ev.side]; for (const i of ev.indexes) { s.party[i].status = null; if (i === s.active) s.party[i].confusion = false; } renderPlate(ev.side); sfx.heal(); say(ev.text); await dly(700); break; }
      case 'vol': cur(ev.side).vol = ev.flags; renderPlate(ev.side); break;
      case 'types': cur(ev.side).types = ev.types; renderPlate(ev.side); renderMon(ev.side, false); break;
      case 'field': U.field = { weather: ev.weather, terrain: ev.terrain, room: ev.room, sides: ev.sides }; renderField(); renderPlate(0); renderPlate(1); await dly(450); break;
      case 'faint': {
        const m = cur(ev.side); m.fainted = true; m.hp = 0; m.status = null; m.confusion = false; m.stages = {}; m.vol = {}; m.types = m.origTypes.slice();
        if (ev.side === 1) kos++;
        updateHp(ev.side); renderPlate(ev.side); sfx.faint(); say(ev.text); shake('shake-big');
        $('#mon-' + ev.side).classList.add('ko');
        await banner('K.O.', 'ko', 1000);
        break;
      }
      case 'text': say(ev.text); await dly(Math.min(1200, 420 + ev.text.length * 22)); break;
      case 'end': say(ev.text); await dly(600); break;
    }
  }
  async function play(events) { for (const ev of events) { if (!alive) return; await handle(ev); } }

  // ───────── 조작 ─────────
  const effHint = (mvType, foeTypes) => { const e = Eng.typeMultiplier(mvType, foeTypes); return e === 0 ? ['im', '무효'] : e >= 4 ? ['se', '×4'] : e > 1 ? ['se', '×2'] : e < 1 ? ['nve', e <= .25 ? '×¼' : '×½'] : null; };
  function renderControls() {
    const la = B.legalActions(0), me = B.active(0), foe = B.active(1);
    const cards = la.mustStruggle
      ? `<button class="mvc" style="--c:#8a8fa8;grid-column:1/-1" data-act="move" data-i="0"><b>발버둥</b><small>쓸 수 있는 기술이 없어요 · 반동 피해</small></button>`
      : me.moves.map((m, i) => {
        const lm = la.moves[i], col = TYPE_HEX[m.type], st = m.cls === 'status', h = !st && effHint(m.type, foe.types);
        const meta = st ? esc(Eng.describeEffect(m)) : `${m.cls === 'phys' ? '물리' : '특수'} · 위력 ${m.power} · ${m.acc === null || (m.fx && m.fx.neverMiss) ? '필중' : '명중 ' + m.acc}`;
        return `<button class="mvc${st ? ' st' : ''}${isLite(m.type) ? ' lite' : ''}" style="--c:${col}" data-act="move" data-i="${i}" ${lm.usable ? '' : 'disabled'} title="${i + 1}번 키">
          <span class="g">${TYPE_GLYPH[m.type]}</span><b>${esc(m.name)}</b><small>${meta}</small><em>PP ${m.pp}/${m.maxPp}</em>
          ${lm.why ? `<u class="why">${esc(lm.why)}</u>` : h ? `<u class="hint ${h[0]}">${h[1]}</u>` : ''}</button>`;
      }).join('');
    $('#controls').innerHTML = `<div class="mvgrid">${cards}</div>
      <div class="subbar"><button class="btn" data-act="switch-open" ${la.switches.length ? '' : 'disabled'}>${la.trapped ? '🔒 교체 불가' : '🔄 교체'}</button><button class="btn danger" data-act="surrender">🏳 항복</button></div>`;
  }
  const lock = () => { $('#controls').classList.add('lock'); };
  const unlock = () => { $('#controls').classList.remove('lock'); };
  const choose = () => new Promise(res => { resolveChoice = res; renderControls(); unlock(); });
  function partyPicker(title, allowCancel) {
    return new Promise(res => {
      const ov = $('#overlay'), me = B.sides[0];
      ov.innerHTML = `<div class="pick-ov"><div class="pick-box glass"><h3 class="display">${esc(title)}</h3><div class="pick-list">${me.party.map((m, i) => {
        const u = U.side[0].party[i], off = m.fainted || i === me.active, r = m.hp / m.maxHp;
        return `<button class="pcard${off ? ' off' : ''}" data-i="${i}" ${off ? 'disabled' : ''} style="--c1:${TYPE_HEX[u.origTypes[0]]}"><span class="pa">${monImg(u.id)}</span><b>${esc(u.name)}</b>
          <div class="hp mini"><i class="fill ${hpClass(r)}" style="width:${(r * 100).toFixed(0)}%"></i></div><small>${m.fainted ? '기절' : i === me.active ? '출전 중' : `${m.hp}/${m.maxHp}`}${m.status ? ' · ' + STATUS_KO[m.status] : ''}</small></button>`;
      }).join('')}</div>${allowCancel ? '<button class="btn" data-pk="cancel">취소</button>' : ''}</div></div>`;
      ov.onclick = e => {
        const c = e.target.closest('.pcard'), x = e.target.closest('[data-pk]');
        if (c && !c.disabled) { ov.innerHTML = ''; ov.onclick = null; sfx.pick(); res(Number(c.dataset.i)); }
        else if (x || e.target.classList.contains('pick-ov')) { if (allowCancel) { ov.innerHTML = ''; ov.onclick = null; res(null); } }
      };
    });
  }
  const onClick = async e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    switch (t.dataset.act) {
      case 'move': if (resolveChoice) { const r = resolveChoice; resolveChoice = null; lock(); r({ type: 'move', index: Number(t.dataset.i) }); } break;
      case 'switch-open': { if (!resolveChoice) break; const to = await partyPicker('교체할 포켓몬', true); if (to !== null && resolveChoice) { const r = resolveChoice; resolveChoice = null; lock(); r({ type: 'switch', to }); } break; }
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
  async function run() {
    renderPlate(0); renderPlate(1); renderField();
    await dly(400);
    await banner('READY?', 'ready', 800); await banner('FIGHT!', 'fight', 700);
    await play(B.start());
    let result = null;
    while (alive && B.phase !== 'ended') {
      if (B.phase === 'switch') {
        for (const si of B.pending.slice()) {
          if (!alive) return;
          const idx = si === 0 ? await partyPicker('다음 포켓몬을 골라 주세요', false) : brain.chooseReplacement(B, 1, level);
          await play(B.replace(si, idx));
        }
        continue;
      }
      const a0 = await choose();
      if (a0.type === 'surrender') { result = 1; break; }
      const a1 = brain.chooseAction(B, 1, level);
      lock();
      await play(B.playTurn(a0, a1));
    }
    if (!alive) return;
    const winner = result !== null ? result : B.winner;
    await dly(900);
    go('result', { winner, turns: B.turn, mine, opp, level, dmg: dmgBy, kos });
  }
  run().catch(err => { console.error(err); say('오류가 발생했어요. 홈으로 돌아가 주세요.'); });
  return () => { alive = false; root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
}
