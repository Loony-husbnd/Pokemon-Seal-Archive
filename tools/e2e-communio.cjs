/**
 * Communio 브라우저 전체 흐름 시험 (사육장 → 엔트리 등록 → 1:1 교감 → 새로고침 후 유지).
 *   npm run build:communio && npm run preview:communio   (다른 터미널에서)
 *   node tools/e2e-communio.cjs        환경 변수 PORT(기본 3002), OUT(스크린샷 폴더, 기본 임시 폴더)
 * Tailwind·Lucide CDN 을 못 쓰는 환경(샌드박스)에서는 TAILWIND_CSS(생성한 css 파일), LUCIDE_JS(lucide.min.js) 경로를 주면 대신 끼워 넣는다.
 * Playwright 와 Chromium 이 필요하다. 이미지·글꼴 같은 외부 자원을 못 불러오는 오류는 무시한다.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir();
const URL = 'http://localhost:' + (process.env.PORT || 3002) + '/';
const KEY = 'communio:habitat_v1';
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|githubusercontent|fonts|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  if (process.env.TAILWIND_CSS || process.env.LUCIDE_JS) {
    await page.route(/cdn\.tailwindcss\.com/, r => r.fulfill({ contentType: 'text/javascript', body: 'window.tailwind={};' }));
    await page.route(/unpkg\.com\/lucide/, r => r.fulfill({ contentType: 'text/javascript', body: process.env.LUCIDE_JS ? fs.readFileSync(process.env.LUCIDE_JS, 'utf8') : '' }));
  }
  // 그림은 외부(GitHub)에서 오므로, 막힌 환경에서도 화면을 볼 수 있게 1색 PNG 로 대신한다
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route(/githubusercontent\.com/, r => r.fulfill({ contentType: 'image/png', body: PNG }));

  const addCss = async () => { if (process.env.TAILWIND_CSS) await page.addStyleTag({ content: fs.readFileSync(process.env.TAILWIND_CSS, 'utf8') }); };
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await addCss();
  await page.waitForSelector('#terrarium-container');

  // 1) 빈 사육장
  ok(await page.locator('#terrarium-empty-state').isVisible(), '처음에는 빈 사육장 안내가 보인다');
  ok(await page.locator('.terrarium-creature-node').count() === 0, '처음에는 포켓몬이 없다');
  await page.screenshot({ path: OUT + '/communio-empty.png' });

  // 2) 추천 6마리
  await page.click('#btn-empty-habitat-recommend');
  await page.waitForSelector('.terrarium-creature-node');
  ok(await page.locator('.terrarium-creature-node').count() === 6, '추천 6마리가 사육장에 입장한다');
  ok(await page.locator('#amie-roster-grid > div').count() === 6, '멤버 상태 카드가 6장 나온다');
  ok((await page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]').length, KEY)) === 6, `저장 키 ${KEY} 에 6마리가 저장된다`);
  ok((await page.evaluate(() => Object.keys(localStorage).filter(k => /^pokemon_seal/.test(k)).length)) === 0, 'Holo 의 저장 키는 건드리지 않는다');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/communio-habitat.png' });

  // 3) 엔트리 관리: 가득 참 → 하나 내보내고 → 리자몽(메가X·이로치) 등록
  await page.click('#btn-open-entry-modal');
  await page.waitForSelector('#amie-entry-grid > div');
  ok(await page.locator('#amie-entry-grid button[disabled]').count() > 0, '6마리가 차면 등록 버튼이 막힌다');
  await page.click('#amie-entry-current-slots button >> nth=0');
  ok((await page.evaluate(k => JSON.parse(localStorage.getItem(k)).length, KEY)) === 5, '✕ 로 내보내면 5마리가 된다');
  await page.fill('#amie-entry-search', '리자몽');
  await page.waitForSelector('#entry-form-6');
  ok(await page.locator('#amie-entry-grid > div').count() === 1, '이름 검색(리자몽)이 동작한다');
  await page.selectOption('#entry-form-6', 'mega-x');
  await page.check('#entry-shiny-6');
  await page.click('#amie-entry-grid button:has-text("등록")');
  const names = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).map(h => h.pokemon_name), KEY);
  ok(names.includes('이로치 메가리자몽X'), '폼·이로치를 골라 등록한다: ' + names.join(', '));
  await page.fill('#amie-entry-search', 'ㅍㅋㅊ');
  ok(await page.locator('#amie-entry-grid > div', { hasText: '피카츄' }).count() >= 1, '초성 검색(ㅍㅋㅊ)이 동작한다');
  await page.fill('#amie-entry-search', '');
  await page.selectOption('#amie-entry-filter-gen', '9');
  ok(await page.locator('#amie-entry-grid > div', { hasText: 'No.0906' }).count() === 1 && await page.locator('#amie-entry-grid > div', { hasText: '피카츄' }).count() === 0, '세대 필터(9세대)가 동작한다');
  await page.click('#amie-entry-grid button:has-text("더 보기")');
  ok(await page.locator('#amie-entry-grid > div', { hasText: '복숭악동' }).count() === 1, '더 보기로 나머지(No.1025 복숭악동)까지 볼 수 있다');
  await page.screenshot({ path: OUT + '/communio-entry.png' });
  await page.click('#btn-entry-done');

  // 4) 1:1 교감: 쓰다듬기 · 먹이 · 말 걸기
  await page.locator('.terrarium-creature-node').first().click();
  await page.waitForSelector('#modal-poke-amie-play:not(.hidden)');
  const before = await page.evaluate(k => JSON.parse(localStorage.getItem(k))[0], KEY);
  const pad = await page.locator('#amie-pet-touchpad').boundingBox();
  await page.mouse.move(pad.x + pad.width * 0.3, pad.y + pad.height * 0.5);
  await page.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < 3600) {
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(pad.x + pad.width * (0.3 + 0.4 * ((i % 2) ? 1 : 0)), pad.y + pad.height * (0.4 + 0.05 * (i % 3)), { steps: 4 });
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterPet = await page.evaluate(k => JSON.parse(localStorage.getItem(k))[0], KEY);
  ok(afterPet.affection > before.affection, `3초 쓰다듬으면 친밀도가 오른다 (${before.affection} → ${afterPet.affection})`);
  await page.click('#btn-feed-chocoroll');
  const afterFeed = await page.evaluate(k => JSON.parse(localStorage.getItem(k))[0], KEY);
  ok(afterFeed.fullness === afterPet.fullness + 1 && afterFeed.affection > afterPet.affection, `포켓몬빵을 먹이면 포만감·친밀도가 오른다 (포만감 ${afterPet.fullness} → ${afterFeed.fullness})`);
  await page.screenshot({ path: OUT + '/communio-play.png' });
  await page.click('#btn-close-play-modal');

  // 5) 새로고침 후에도 유지
  await page.reload({ waitUntil: 'domcontentloaded' });
  await addCss();
  await page.waitForSelector('.terrarium-creature-node');
  ok(await page.locator('.terrarium-creature-node').count() === 6, '새로고침해도 6마리가 그대로 있다');

  // 6) 시간대 전환
  for (const t of ['day', 'sunset', 'night']) {
    await page.click('#btn-amie-time-' + t);
    ok(await page.locator('#terrarium-container.terrarium-bg-' + t).count() === 1, t + ' 배경으로 바뀐다');
  }
  await page.screenshot({ path: OUT + '/communio-night.png' });

  ok(errs.length === 0, '화면 오류 없음' + (errs.length ? '\n  ' + errs.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `실패 ${failed}건` : '모두 통과');
  process.exit(failed ? 1 : 0);
})();
