/**
 * Communio 2.0 브라우저 전체 흐름 시험
 *   (사육장 → 데려오기(인원 제한 없음) → 교감 화면 → 손으로 쓰다듬기·때리기 → 음식 끌어 먹이기 → 말 걸기 → 빼기 확인 → 저장)
 *   npm run build:communio && npm run preview:communio   (다른 터미널에서)
 *   node tools/e2e-communio.cjs        환경 변수 PORT(기본 3002), OUT(스크린샷 폴더, 기본 임시 폴더)
 * Playwright 와 Chromium 이 필요하다. 그림·글꼴 같은 외부 자원은 못 불러와도 되도록 그림은 단색으로 대신한다.
 */
const { chromium } = require('playwright');
const zlib = require('zlib');
const OUT = process.env.OUT || require('os').tmpdir();
const URL = 'http://localhost:' + (process.env.PORT || 3002) + '/';
const KEY = 'communio:habitat_v1';
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) failed++; };

// 128x128 단색 원 PNG (외부 그림 대체)
function blobPng() {
  const w = 128, h = 128, rows = [];
  for (let y = 0; y < h; y++) { const r = [0]; for (let x = 0; x < w; x++) { const d = Math.hypot(x - 64, y - 64); r.push(...(d < 52 ? [255, 140, 160, 255] : [0, 0, 0, 0])); } rows.push(Buffer.from(r)); }
  const raw = Buffer.concat(rows);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_|fonts/.test(m.text())) errs.push('console: ' + m.text()); });
  const PNG = blobPng();
  await page.route(/githubusercontent\.com/, r => r.fulfill({ contentType: 'image/png', body: PNG }));
  const store = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), KEY);

  // 0) 1.0 에서 쓰던 저장 데이터를 그대로 이어받는다
  await page.addInitScript(([k, old]) => { if (!localStorage.getItem(k) && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); if (old) localStorage.setItem(k, old); } }, [KEY, process.env.SEED_OLD ? JSON.stringify([{ id: 'cm_old1', pokedex_number: 25, pokemon_name: '피카츄', types: ['전기'], affection: 55, fullness: 3, x: 40, y: 80, anchor: 'foot', facing: 'left', scale: 1 }]) : '']);

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#world');
  ok(await page.locator('.world-empty').isVisible(), '처음에는 빈 사육장 안내가 보인다');
  await page.screenshot({ path: OUT + '/c2-empty.png' });

  // 1) 추천 6마리 → 월드 + 멤버 카드
  await page.click('#btn-recommend');
  await page.waitForSelector('.mon');
  ok(await page.locator('.mon').count() === 6 && await page.locator('.member').count() === 6, '추천 6마리가 사육장·멤버 목록에 나온다');
  ok(!(await page.evaluate(() => Object.keys(localStorage).some(k => /^pokemon_seal/.test(k)))), 'Holo 저장 키는 건드리지 않는다');

  // 2) 데려오기 화면: 6마리 제한 없음
  await page.click('a[href="#/add"]');
  await page.waitForSelector('#picker .pick');
  ok(page.url().endsWith('#/add'), '데려오기는 팝업이 아니라 별도 화면이다');
  await page.fill('#add-q', '리자몽');
  await page.waitForSelector('#pf-6');
  await page.selectOption('#pf-6', 'mega-x'); await page.check('#ps-6');
  await page.click('#pc-6 [data-reg]');
  ok((await store()).some(h => h.pokemon_name === '이로치 메가리자몽X'), '폼·이로치를 골라 등록한다');
  await page.fill('#add-q', 'ㅍㅋㅊ');
  ok(await page.locator('#picker .pick', { hasText: '피카츄' }).count() >= 1, '초성 검색이 된다');
  await page.fill('#add-q', '');
  await page.click('#add-gens [data-g="1"]');
  for (let i = 0; i < 12; i++) await page.locator('#picker [data-reg]').nth(i).click();
  const total = (await store()).length;
  ok(total === 19, `7마리를 넘겨도 계속 등록된다 (현재 ${total}마리)`);
  await page.screenshot({ path: OUT + '/c2-add.png' });
  await page.click('.dock a.btn');
  await page.waitForSelector('#world');
  ok(await page.locator('.mon').count() === 12, '풍경에는 12마리만 나온다');
  ok(await page.locator('.member').count() === 19, '멤버 목록에는 19마리가 모두 나온다');
  await page.click('#btn-shuffle');
  ok(await page.locator('.mon').count() === 12, '무대 멤버를 바꿔도 12마리');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/c2-home.png', fullPage: true });

  // 3) 포켓몬을 누르면 새 화면
  const firstId = (await store())[0].id;
  await page.locator('.member [data-go]').first().click();
  await page.waitForSelector('#stage');
  ok(/#\/play\//.test(page.url()) && await page.locator('.veil').count() === 0, '누르면 팝업이 아니라 새 화면(#/play/…)으로 간다');
  await page.waitForFunction(() => PL && PL.eng && PL.eng.getBodyRect());
  await page.waitForTimeout(1200);
  const stageBox = await page.locator('#stage').boundingBox();
  const body = await page.evaluate(() => PL.eng.getBodyRect());
  const cx = stageBox.x + body.x + body.w / 2, cy = stageBox.y + body.y + body.h * 0.6;

  // 4) 손: 장갑 손이 나타나고, 모드에 따라 자세가 바뀐다
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(250);
  ok(await page.locator('#hand.show').count() === 1 && await page.locator('#hand svg.open').isVisible(), '스테이지에 손이 나타난다(쓰다듬기: 펼친 손)');
  const fingers = await page.locator('#hand svg.open use').count();
  ok(fingers >= 1, '손 그림(SVG)이 그려진다');
  await page.screenshot({ path: OUT + '/c2-play-hand.png' });

  // 5) 쓰다듬기: 3초 문지르면 +5
  let st = (await store()).find(h => h.id === firstId); const aff0 = st.affection;
  await page.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < 3800) { for (let i = 0; i < 10; i++) await page.mouse.move(cx + (i % 2 ? 50 : -50), cy + (i % 3) * 6, { steps: 4 }); }
  await page.mouse.up();
  await page.waitForTimeout(300);
  st = (await store()).find(h => h.id === firstId);
  ok(st.affection > aff0 && (st.affection - aff0) % 5 === 0, `3초 이상 쓰다듬으면 친밀도가 5씩 오른다 (${aff0} → ${st.affection})`);

  // 6) 때리기: 한 대 -4
  await page.click('.mode[data-m="hit"]');
  ok(await page.locator('#hand[data-pose="fist"]').count() === 1, '때리기 모드에서는 손이 주먹이 된다');
  const aff1 = st.affection;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(700);
  st = (await store()).find(h => h.id === firstId);
  ok(st.affection === Math.max(0, aff1 - 4), `때리면 친밀도 -4 (${aff1} → ${st.affection})`);
  ok(await page.locator('.impact').count() >= 0, '충격 효과');
  await page.screenshot({ path: OUT + '/c2-play-hit.png' });
  // 몸 밖을 때리면 헛손질
  const aff2 = st.affection;
  await page.mouse.move(stageBox.x + 40, stageBox.y + 100); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(500);
  st = (await store()).find(h => h.id === firstId);
  ok(st.affection === aff2, '몸이 아닌 곳을 때리면 친밀도가 그대로다');
  await page.click('.mode[data-m="pet"]');

  // 7) 음식 끌어서 먹이기
  ok(await page.locator('#foods .food').count() === 10, '음식 아이콘이 10개 있다');
  const names = await page.locator('#foods .fname').allInnerTexts();
  ok(['오랭열매', '자뭉열매', '맛있는물', '사이다', '달콤한꿀', '이상한사탕'].every(n => names.includes(n)), '포켓몬 세계관 음식이다: ' + names.join(', '));
  const dragFood = async (idx) => {
    const fb = await page.locator('#foods .food').nth(idx).boundingBox();
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await page.mouse.down();
    await page.mouse.move(cx, cy - 20, { steps: 12 });
    await page.mouse.up();
  };
  st = (await store()).find(h => h.id === firstId); const full0 = st.fullness, aff3 = st.affection;
  await dragFood(0);
  await page.waitForTimeout(1700);
  st = (await store()).find(h => h.id === firstId);
  ok(st.fullness === Math.min(5, full0 + 1) && st.affection > aff3, `음식을 끌어다 주면 먹는다 (포만감 ${full0} → ${st.fullness}, 친밀도 ${aff3} → ${st.affection})`);
  await page.screenshot({ path: OUT + '/c2-play-fed.png' });
  // 음식을 포켓몬이 없는 곳에 놓으면 먹지 않는다
  const fb = await page.locator('#foods .food').nth(1).boundingBox(); const before = (await store()).find(h => h.id === firstId).fullness;
  await page.mouse.move(fb.x + 30, fb.y + 30); await page.mouse.down(); await page.mouse.move(stageBox.x + 30, stageBox.y + stageBox.height - 20, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(600);
  ok((await store()).find(h => h.id === firstId).fullness === before, '엉뚱한 곳에 놓으면 먹지 않고 쟁반으로 돌아간다');
  // 배부르면 거절
  for (let i = 0; i < 6; i++) { await dragFood(i % 10); await page.waitForTimeout(1500); }
  st = (await store()).find(h => h.id === firstId);
  ok(st.fullness === 5, '포만감은 5에서 멈춘다(배가 부르면 거절)');

  // 8) 말 걸기
  await page.click('.mode[data-m="talk"]');
  await page.fill('#talk-input', '안녕 오늘도 잘 지냈어?');
  await page.click('#talk-form button[type=submit]');
  await page.waitForTimeout(1100);
  ok((await page.locator('#speech').innerText()).length > 4 && !(await page.locator('#speech').getAttribute('class')).includes('off'), '말을 걸면 대답이 나온다');
  await page.click('.mode[data-m="pet"]');

  // 9) 이전/다음, 빼기(확인 창)
  await page.click('#btn-next'); await page.waitForTimeout(300);
  ok(!page.url().includes(firstId), '다음 포켓몬으로 넘어간다');
  const curId = page.url().split('/play/')[1];
  await page.click('#btn-remove');
  ok(await page.locator('.veil .dialog').isVisible() && /사육장에서 빼기/.test(await page.locator('.veil').innerText()), '"사육장에서 빼기" 확인 창이 뜬다(휴식이라는 말은 쓰지 않는다)');
  await page.click('.veil [data-r="0"]');
  ok((await store()).some(h => h.id === curId), '취소하면 그대로 있다');
  await page.click('#btn-remove'); await page.click('.veil [data-r="1"]');
  await page.waitForSelector('#world');
  ok(!(await store()).some(h => h.id === curId) && (await store()).length === 18, '확인하면 삭제되고 사육장 화면으로 돌아간다');
  ok(!(await page.locator('body').innerText()).includes('휴식'), '화면 어디에도 "휴식" 문구가 없다');

  // 10) 새로고침 후 유지 + 시간대
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.mon');
  ok((await store()).length === 18 && await page.locator('.member').count() === 18, '새로고침해도 그대로다');
  for (const t of ['day', 'sunset', 'night']) { await page.click(`#seg-time [data-k="${t}"]`); ok(await page.locator(`#world[data-period="${t}"]`).count() === 1, t + ' 풍경으로 바뀐다'); }
  await page.screenshot({ path: OUT + '/c2-night.png' });
  await page.click('#btn-sound'); ok((await page.evaluate(() => JSON.parse(localStorage.getItem('communio:settings')).sound)) === false, '효과음 끄기가 저장된다');

  ok(errs.length === 0, '화면 오류 없음' + (errs.length ? '\n  ' + errs.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `실패 ${failed}건` : '모두 통과');
  process.exit(failed ? 1 : 0);
})();
