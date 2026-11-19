const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_(TUNNEL|CONNECTION|NAME|PROXY)|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const U = 'http://localhost:3111'; await p.goto(U + '/login.html'); await p.click('#m-up');
  await p.fill('#nm', 'Dana'); await p.fill('#wn', 'Northline'); await p.fill('#em', 'dana@example.com'); await p.fill('#pw', 'a long passphrase 1'); await p.click('#go'); await p.waitForSelector('#ok'); await p.check('#ok'); await p.click('#cont');
  await p.waitForURL('**/dashboard.html'); await p.waitForSelector('.tiles');
  await p.goto(U + '/pipeline.html'); await p.waitForSelector('.lanes'); await p.click('#samp'); await p.waitForSelector('#load'); await p.click('#load'); await p.waitForSelector('.qc');
  console.log('cards after import', await p.locator('.qc').count());
  await p.click('.qc'); await p.waitForSelector('#dsave');
  for (const pg of ['inbox', 'plan', 'account', 'outreach', 'contracts', 'integrations', 'integration?p=twilio', 'integration?p=google_calendar', 'integration?p=hubspot', 'developer', 'team', 'settings', 'dashboard']) { await p.goto(`${U}/${pg}${pg.includes('?') ? '' : '.html'}`.replace('integration?p', 'integration.html?p')); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(300); const t = (await p.locator('#content').innerText()).slice(0, 60).replace(/\n/g, ' | '); console.log(pg.padEnd(32), t); }
  await p.setViewportSize({ width: 390, height: 800 }); await p.goto(U + '/pipeline.html'); await p.waitForSelector('.lanes');
  console.log('hscroll', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)); await p.screenshot({ path: '/tmp/pipe.png', fullPage: false });
  console.log('errors', errs); await b.close();
})();
