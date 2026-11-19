// Launches the real Electron app and drives it. Needs a display (xvfb-run on CI).
const { _electron } = require('playwright'); const path = require('path');
(async () => {
  const app = await _electron.launch({ args: [path.join(__dirname, '..'), '--no-sandbox', '--user-data-dir=' + (process.env.RR_UD || '/tmp/rrdesk')], executablePath: process.env.RR_ELECTRON || require('electron') });
  const w = await app.firstWindow(), errs = []; w.on('pageerror', e => errs.push(e.message));
  await w.waitForURL('**/login.html**', { timeout: 20000 }); console.log('window url', w.url());
  await w.click('#m-up'); await w.fill('#nm', 'Dana'); await w.fill('#wn', 'Northline'); await w.fill('#em', 'dana@example.com'); await w.fill('#pw', 'a long passphrase 1'); await w.click('#go'); await w.waitForSelector('#ok'); await w.check('#ok'); await w.click('#cont');
  await w.waitForURL('**/dashboard.html'); await w.waitForSelector('.tiles'); console.log('signed in, title:', await w.title());
  await w.goto(w.url().replace('dashboard', 'integration') + '?p=google_calendar'); await w.waitForSelector('#csave'); console.log('app credentials form present:', await w.locator('#cid').count() === 1);
  await w.fill('#cid', 'client-id'); await w.fill('#csec', 'client-secret'); await w.click('#csave'); await w.waitForSelector('#go'); console.log('after saving credentials, sign-in button shown:', await w.locator('#go').count() === 1);
  const host = new URL(w.url()).host; const bad = await app.evaluate(async ({ }, h) => { const r = await fetch('http://' + h + '/api/info', { headers: { Host: 'evil.example:80' } }).catch(e => ({ status: 'err ' + e.message })); return r.status; }, host);
  console.log('host-header check result (fetch cannot override Host, informational):', bad);
  await w.screenshot({ path: '/tmp/desktop.png' }); console.log('errors', errs); await app.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
