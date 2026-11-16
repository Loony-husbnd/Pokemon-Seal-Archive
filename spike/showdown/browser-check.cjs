const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.setContent('<html><body>x</body></html>');
  const code = fs.readFileSync('out/sim.min.js', 'utf8');
  const t0 = Date.now();
  await page.addScriptTag({ content: code });
  const loadMs = Date.now() - t0;
  const r = await page.evaluate(() => {
    const { Battle } = PkSim; const t = performance.now();
    const b = new Battle({ formatid: 'gen9customgame', seed: [1,2,3,4],
      p1: { name: 'a', team: [{ species: 'Garchomp', ability: 'Rough Skin', moves: ['earthquake'], evs: { atk: 252 } }] },
      p2: { name: 'b', team: [{ species: 'Blissey', ability: 'Natural Cure', moves: ['softboiled'] }] } });
    b.choose('p1', 'default'); b.choose('p2', 'default'); b.choose('p1', 'move 1'); b.choose('p2', 'move 1');
    return { turn: b.turn, setupMs: Math.round(performance.now() - t), hp: b.p2.active[0].hp, log: b.log.slice(-6) };
  });
  console.log(JSON.stringify({ scriptEvalMs: loadMs, ...r, errs }, null, 1));
  await browser.close();
})();
