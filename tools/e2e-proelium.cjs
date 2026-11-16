/**
 * Proelium 브라우저 전체 흐름 시험 (홈 → 팀 편성 → 세트 편집 → 매칭 → 배틀 → 결과).
 *   npm run build:proelium && npm run preview:proelium   (다른 터미널에서)
 *   node tools/e2e-proelium.cjs [easy|normal|hard|hell]      환경 변수 PORT(기본 3001), OUT(스크린샷 폴더, 기본 임시 폴더)
 * Playwright 와 Chromium 이 필요하다. 이미지·글꼴 같은 외부 자원을 못 불러오는 오류는 무시한다.
 */
const { chromium } = require('playwright');
const OUT = process.env.OUT || require('os').tmpdir();
const level = process.argv[2] || 'easy';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|githubusercontent|fonts/.test(m.text())) errs.push('console: ' + m.text()); });
  const t0 = Date.now();
  await page.goto('http://localhost:' + (process.env.PORT || 3001) + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.home', { timeout: 60000 });
  console.log('홈 표시까지', Date.now() - t0, 'ms');
  await page.screenshot({ path: OUT + '/e2e-home.png' });
  await page.click('[data-act="builder"]'); await page.waitForSelector('.builder');
  await page.click('[data-act="random"]'); await page.waitForSelector('.builder .slot:not(.empty)');
  console.log('빌더 슬롯 수', await page.locator('.builder .slot:not(.empty)').count(), '| 세트 표시', await page.locator('.slot-set').first().innerText());
  await page.screenshot({ path: OUT + '/e2e-builder.png' });
  // 세트 편집 시트 열기
  await page.click('[data-act="moves"][data-i="0"]'); await page.waitForSelector('.sheet.moves .set-row');
  console.log('특성 옵션', await page.locator('[data-s="ability"] option').count(), '| 도구 옵션', await page.locator('[data-s="item"] option').count());
  await page.screenshot({ path: OUT + '/e2e-sheet.png' });
  await page.click('[data-x="done"]');
  await page.click('[data-act="go"]'); await page.waitForSelector('.matchup');
  const tm = Date.now(); await page.click(`[data-act="level"][data-v="${level}"]`);
  if (level === 'hell') { await page.waitForSelector('.hell-prog'); console.log('지옥 진행 표시 확인'); }
  await page.waitForSelector('.vs-card.foe', { timeout: 60000 }); console.log('상대 구성 시간', Date.now() - tm, 'ms');
  console.log('상대 카드', await page.locator('.vs-card.foe').count());
  await page.waitForTimeout(1500); await page.screenshot({ path: OUT + '/e2e-matchup.png' });
  await page.click('[data-act="fight"]'); await page.waitForSelector('.battle');
  await page.waitForSelector('.mvc', { timeout: 30000 });
  await page.click('[data-act="skip"]');
  await page.screenshot({ path: OUT + '/e2e-battle.png' });
  let turns = 0, megaUsed = false; const logs = [];
  for (let i = 0; i < 400; i++) {
    if (await page.locator('.result').count()) break;
    const pick = page.locator('.pick-ov .pcard:not(.off)').first();
    if (await pick.count()) { await pick.click(); await page.waitForTimeout(80); continue; }
    const mega = page.locator('[data-act="mega"]');
    if (await mega.count() && !megaUsed) { const txt = await mega.innerText(); if (/OFF/.test(txt)) { await mega.click(); megaUsed = true; } }
    const mv = page.locator('.controls:not(.lock) .mvc:not([disabled])');
    if (await mv.count()) { await mv.nth(0).click(); turns++; await page.waitForTimeout(120); logs.push(await page.locator('#log p').first().innerText().catch(() => '')); }
    else await page.waitForTimeout(100);
  }
  const done = await page.locator('.result').count();
  console.log('결과 화면', done ? '도달' : '미도달', '| 내가 낸 수', turns, '| 메가 시도', megaUsed, '| 로그 마지막:', await page.locator('#log p, .log p').first().innerText().catch(() => '-'));
  if (done) { console.log('결과:', (await page.locator('.res-title').innerText())); await page.screenshot({ path: OUT + '/e2e-result.png' }); }
  console.log('턴별 마지막 로그:', logs.join(' | '));
  console.log('오류', errs.length, errs.slice(0, 5));
  await browser.close();
})();
