/**
 * 회귀 시험: 메가진화한 포켓몬이 벤치에 있을 때 교체창이 열리는가 (예전에는 'Cannot read properties of null (reading types)' 로 멈췄다).
 *   npm run build:proelium && npm run preview:proelium   (다른 터미널에서)
 *   node tools/e2e-proelium-megapicker.cjs               환경 변수 PORT(기본 3001)
 * 번치코(번치코나이트)로 1턴에 메가진화 → 2턴에 교체 → 3턴에 교체창을 다시 연다. Playwright 필요.
 */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 900, height: 800 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text().slice(0, 400)); });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('proelium:team2')) { localStorage.setItem('proelium:team2', JSON.stringify([
    { id: 'blaziken', moves: ['flareblitz', 'closecombat', 'swordsdance', 'protect'], ability: 'Blaze', item: 'Blazikenite' },
    { id: 'swampert', moves: ['waterfall', 'earthquake'], ability: 'Torrent', item: 'Leftovers' }, { id: 'garchomp', moves: ['earthquake'], ability: 'Rough Skin', item: 'Life Orb' }])); localStorage.setItem('proelium:level', JSON.stringify('easy')); } } catch (e) {} });
  await page.goto('http://localhost:' + (process.env.PORT || 3001) + '/'); await page.waitForSelector('.home'); await page.click('[data-act="play"]', { force: true });
  await page.waitForSelector('.vs-card.foe'); await page.click('[data-act="fight"]', { force: true }); await page.waitForSelector('.mvc'); await page.click('[data-act="skip"]');
  // 1턴: 메가진화 + 보호(바로 쓰러지지 않게)
  await page.click('[data-act="mega"]'); await page.locator('.controls:not(.lock) .mvc').nth(3).click(); await page.waitForTimeout(1200); await page.waitForSelector('.controls:not(.lock) .mvc');
  console.log('1턴 후 메가:', await page.locator('.plate').last().innerText().then(t => t.replace(/\n/g, ' ')).catch(() => '-'));
  // 2턴: 교체 → 둘째 선택 (메가 번치코가 벤치로)
  await page.click('[data-act="switch-open"]'); await page.waitForSelector('.pick-ov .pcard:not(.off)'); await page.locator('.pick-ov .pcard:not(.off)').first().click(); await page.waitForTimeout(1200); await page.waitForSelector('.controls:not(.lock) .mvc');
  // 3턴: 다시 교체창을 연다 — 벤치에 메가 번치코가 있다
  await page.click('[data-act="switch-open"]'); await page.waitForTimeout(600);
  const open = await page.locator('.pick-ov .pcard').count();
  console.log('교체창 열림:', open ? `${open}칸` : '안 열림', '| 오류', errs.length, errs.slice(0, 1));
  if (!open || errs.length) { console.error('실패'); process.exitCode = 1; } else console.log('통과');
  await b.close();
})();
