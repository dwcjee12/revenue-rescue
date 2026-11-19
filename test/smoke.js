// End-to-end check against a local mock of the provider APIs. Run: npm test
const net = require('net'), http = require('http'), crypto = require('crypto'), os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
(async () => {
  const [mp, ap, hp] = [await free(), await free(), await free()], seen = [], hooks = [], inbound = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const u = new URL(req.url, 'http://x'); seen.push({ m: req.method, p: u.pathname, auth: req.headers.authorization, b }); const j = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      if (u.pathname === '/accounts.google.com/o/oauth2/v2/auth') { res.statusCode = 302; res.setHeader('Location', `${u.searchParams.get('redirect_uri')}?code=abc&state=${u.searchParams.get('state')}`); return res.end(); }
      if (u.pathname === '/oauth2.googleapis.com/token') { assert(/code_verifier=/.test(b) || /refresh_token/.test(b), 'PKCE verifier sent'); return j({ access_token: 'ya29.mock', refresh_token: 'r1', expires_in: 3600 }); }
      if (u.pathname === '/www.googleapis.com/calendar/v3/calendars/primary') return j({ id: 'owner@example.com' });
      if (u.pathname === '/www.googleapis.com/calendar/v3/calendars/primary/events') return j({ id: 'ev1', htmlLink: 'https://calendar.example/ev1' });
      if (u.pathname === '/api.twilio.com/2010-04-01/Accounts/AC123.json') return j({ friendly_name: 'Mock Twilio' });
      if (u.pathname === '/api.twilio.com/2010-04-01/Accounts/AC123/Messages.json' && req.method === 'POST') return j({ sid: 'SM1' });
      if (u.pathname === '/api.twilio.com/2010-04-01/Accounts/AC123/Messages.json' && req.method === 'GET') return j({ messages: inbound });
      if (u.pathname === '/api.twilio.com/2010-04-01/Accounts/AC123/Calls.json') return j({ sid: 'CA1' });
      if (u.pathname === '/api.twilio.com/2010-04-01/Accounts/AC123/Calls/CA1.json') return j({ status: 'completed', duration: '94' });
      if (u.pathname === '/api.hellosign.com/v3/account') return j({ account: { email_address: 'o@example.com' } });
      if (u.pathname === '/api.hellosign.com/v3/signature_request/send') return j({ signature_request: { signature_request_id: 'SR1' } });
      if (u.pathname === '/api.hellosign.com/v3/signature_request/SR1') return j({ signature_request: { is_complete: true } });
      if (u.pathname === '/api.housecallpro.com/company') return j({ name: 'Mock HVAC' });
      if (u.pathname === '/api.housecallpro.com/customers') return j({ id: 'cust_1' });
      if (u.pathname === '/api.resend.com/emails') return j({ id: 'em_1' });
      if (u.pathname === '/api.resend.com/domains') { if (req.headers.authorization !== 'Bearer good') { res.statusCode = 401; return j({ message: 'bad key' }); } return j({ data: [] }); }
      res.statusCode = 404; j({ message: 'mock: no route ' + u.pathname });
    });
  }).listen(mp);
  let failing = false; const recv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { if (failing && req.url === '/fail') { res.statusCode = 500; return res.end('no'); } hooks.push({ h: req.headers, b, u: req.url }); res.end('ok'); }); }).listen(hp);
  Object.assign(process.env, { PROVIDER_MOCK: `http://127.0.0.1:${mp}`, ALLOW_PRIVATE_URLS: '1', PORT: ap, BASE_URL: `http://127.0.0.1:${ap}`, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rr-')), GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec', OUTBOX_BASE_MS: '300' });
  const { app, tick } = require('../server.js'); const srv = app.listen(ap); const B = `http://127.0.0.1:${ap}`;
  const jar = {}; const mk = name => { jar[name] = ''; return async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || 'GET', redirect: 'manual', headers: { 'X-RR': o.noRR ? '' : '1', Cookie: jar[name], ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) jar[name] = sc.split(';')[0]; let j = null; try { j = await r.clone().json(); } catch (e) {} return { s: r.status, j, r }; }; };
  const A = mk('a'), V = mk('v'); let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok', m); };

  let r = await A('/api/auth/signup', { method: 'POST', body: { email: 'owner@example.com', password: 'correct horse battery', name: 'Owner', workspace: 'Northline' } }); ok(r.s === 200, 'signup');
  r = await A('/api/auth/signup', { method: 'POST', body: { email: 'x@example.com', password: 'short' } }); ok(r.s === 400, 'short password rejected');
  r = await A('/api/me'); const wid = r.j.workspaces[0].id; ok(r.j.workspaces[0].role === 'owner', 'owner workspace created');
  r = await A(`/api/w/${wid}/quotes`, { method: 'POST', body: { name: 'x' }, noRR: true }); ok(r.s === 403, 'CSRF header required');
  const d = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10), W = p => `/api/w/${wid}${p}`;
  r = await A(W('/quotes/import'), { method: 'POST', body: { rows: [{ ref: 'E1', name: 'Rachel', email: 'r@example.com', phone: '(555) 010-0101', amount: '$7,200', quote_date: d(11), eligible: 'Yes', channel: 'text' }, { ref: 'E2', name: 'Leo', amount: 2200, quote_date: d(9), eligible: '' }, { ref: 'E3', name: 'Bad', amount: 0, quote_date: d(3), eligible: 'yes' }, { ref: 'E4', name: 'Won', amount: 10, quote_date: d(3), eligible: 'yes', stage: 'won' }] } });
  ok(r.j.added === 1 && r.j.noConsent === 1 && r.j.invalid.length === 1 && r.j.notOpen === 1, 'import enforces consent and validation: ' + JSON.stringify(r.j));
  r = await A(W('/quotes')); const q = r.j[0]; ok(q.lane === 'high' && q.phone === '+15550100101', 'high lane and phone normalised');
  r = await A(W('/quotes'), { method: 'POST', body: { ref: 'E5', name: 'NoConsent', amount: 900, quote_date: d(6), phone: '5550100102' } }); const q2 = r.j; ok(!q2.eligible, 'quote defaults to not eligible');

  r = await A(W('/integrations/twilio/connect'), { method: 'POST', body: { fields: { account_sid: 'AC123', auth_token: 'tok', from: '+15550000000' } } }); ok(r.s === 200, 'Twilio verified and connected');
  r = await A(W('/integrations')); const tw = r.j.providers.find(p => p.id === 'twilio'); ok(tw.connection.status === 'connected' && !JSON.stringify(r.j).includes('tok"'), 'secrets never returned');
  r = await A(W('/integrations/resend/connect'), { method: 'POST', body: { fields: { api_key: 'wrong', from: 'a@b.co' } } }); ok(r.s === 400 && /Could not verify/.test(r.j.error), 'bad credentials rejected, not saved');
  r = await A(W('/messages'), { method: 'POST', body: { quote_id: q.id, channel: 'sms', body: 'Hi Rachel, checking in on your estimate.' } }); const mid = r.j.id; ok(r.s === 200, 'draft saved');
  r = await A(W(`/messages/${mid}/send`), { method: 'POST', body: {} }); ok(r.s === 400, 'cannot send before approval');
  await A(W(`/messages/${mid}/approve`), { method: 'POST', body: {} }); r = await A(W(`/messages/${mid}/send`), { method: 'POST', body: {} }); ok(r.s === 200, 'approved message sent');
  const sms = seen.find(s => /Messages\.json/.test(s.p)); ok(/STOP/.test(decodeURIComponent(sms.b)) && /To=%2B15550100101/.test(sms.b), 'sent to normalised number with opt-out line');
  r = await A(W('/messages'), { method: 'POST', body: { quote_id: q2.id, channel: 'sms', body: 'hello' } }); await A(W(`/messages/${r.j.id}/approve`), { method: 'POST', body: {} }); r = await A(W(`/messages/${r.j.id}/send`), { method: 'POST', body: {} }); ok(r.s === 400 && /eligible/.test(r.j.error), 'ineligible customer blocked at send');
  r = await A(W('/quotes')); ok(r.j.find(x => x.id === q.id).stage === 'sent' && r.j.find(x => x.id === q.id).lane === 'sent', 'quote moved to sent');

  r = await A(W('/integrations/google_calendar/oauth-start'), { method: 'POST', body: {} }); ok(/code_challenge=/.test(r.j.url) && /state=/.test(r.j.url), 'OAuth URL has state and PKCE');
  const au = new URL(r.j.url); const a1 = await fetch(`${process.env.PROVIDER_MOCK}/${au.host}${au.pathname}${au.search}`, { redirect: 'manual' }); const cb = new URL(a1.headers.get('location')); r = await A(cb.pathname + cb.search); ok(r.s === 302 && /connected=1/.test(r.r.headers.get('location')), 'OAuth callback connects');
  r = await A(cb.pathname + cb.search); ok(/error=/.test(r.r.headers.get('location')), 'state is single use');
  r = await A(W(`/quotes/${q.id}/schedule`), { method: 'POST', body: { start: new Date(Date.now() + 864e5).toISOString() } }); ok(r.j.id === 'ev1', 'calendar event created');
  r = await A(W('/integrations/hubspot/oauth-start'), { method: 'POST', body: {} }); ok(r.s === 409 && /HUBSPOT_CLIENT_ID/.test(r.j.error), 'unconfigured OAuth app explained');

  r = await A(W('/webhooks'), { method: 'POST', body: { url: `http://127.0.0.1:${hp}/hook`, events: ['quote.created'] } }); const secret = r.j.secret; ok(!!secret, 'webhook created');
  await A(W('/quotes'), { method: 'POST', body: { name: 'Hook', amount: 1000, quote_date: d(2) } }); await new Promise(r => setTimeout(r, 500));
  const h = hooks.find(x => x.h['x-rr-event'] === 'quote.created'); const [t, v1] = h.h['x-rr-signature'].split(',').map(p => p.split('=')[1]);
  ok(crypto.createHmac('sha256', secret).update(t + '.' + h.b).digest('hex') === v1, 'webhook signature verifies');

  r = await A(W('/apikeys'), { method: 'POST', body: { label: 'zap' } }); const key = r.j.key;
  r = await fetch(B + '/api/v1/quotes', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Api', amount: 3000, quote_date: d(8) }) }); ok(r.status === 201, 'public API creates a quote');
  r = await fetch(B + '/api/v1/quotes', { headers: { Authorization: 'Bearer rr_live_nope' } }); ok(r.status === 401, 'bad API key rejected');

  r = await A(W('/team')); r = await A(W('/invites'), { method: 'POST', body: { email: 'viewer@example.com', role: 'viewer' } }); const inv = new URL(r.j.link).searchParams.get('invite');
  r = await V('/api/auth/signup', { method: 'POST', body: { email: 'viewer@example.com', password: 'another long password', invite: inv } }); ok(r.s === 200, 'invited viewer joins');
  r = await V(W('/quotes'), { method: 'POST', body: { name: 'Z', amount: 5, quote_date: d(1) } }); ok(r.s === 403, 'viewer cannot add quotes');
  r = await V(W(`/messages/${mid}/approve`), { method: 'POST', body: {} }); ok(r.s === 403, 'viewer cannot approve');
  r = await V(W('/integrations/twilio'), { method: 'DELETE' }); ok(r.s === 403, 'viewer cannot disconnect integrations');
  r = await V('/api/w/other/summary'); ok(r.s === 404, 'other workspaces are invisible');
  await A(W('/perms'), { method: 'PUT', body: { role: 'viewer', perm: 'move', allowed: true } }); r = await V(W('/quotes'), { method: 'POST', body: { name: 'Z', amount: 5, quote_date: d(1) } }); ok(r.s === 200, 'owner can grant a permission');

  r = await A(W('/contracts'), { method: 'POST', body: { quote_id: q.id, tpl: 'service', scope: 'Heat pump' } }); const cid = r.j.id;
  r = await A(W(`/contracts/${cid}/send`), { method: 'POST', body: { mode: 'link' } }); const tkn = new URL(r.j.link).searchParams.get('t');
  r = await fetch(`${B}/api/sign/${tkn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RR': '1' }, body: JSON.stringify({ name: 'Rachel Smith', agree: true }) }); ok(r.status === 200, 'signing link records signature');
  r = await A(W('/contracts')); ok(r.j[0].status === 'signed' && r.j[0].signed_by === 'Rachel Smith', 'contract shows signed');

  /* ---- v2: replies, calls, plan, bulk, sync, recovery, retries ---- */
  inbound.push({ sid: 'SMin1', direction: 'inbound', from: '+15550100101', body: 'Thanks, can you do Tuesday?', date_sent: new Date().toISOString() }, { sid: 'SMin2', direction: 'inbound', from: '+15559999999', body: 'wrong number', date_sent: new Date().toISOString() });
  r = await A(W('/sync'), { method: 'POST', body: {} }); ok(r.j.replies === 1, 'inbound reply ingested, unknown number ignored');
  r = await A(W('/inbox')); ok(r.j[0].unread === 1 && r.j[0].dir === 'in', 'inbox shows the unread reply');
  r = await A(W(`/threads/${q.id}`)); ok(r.j.items.some(i => i.direction === 'in') && r.j.quote.stage === 'replied', 'thread read; quote marked replied');
  r = await A(W('/sync'), { method: 'POST', body: {} }); ok(r.j.replies === 0, 'same reply is not imported twice');
  inbound.push({ sid: 'SMin3', direction: 'inbound', from: '+15550100101', body: ' STOP ', date_sent: new Date().toISOString() }); await A(W('/sync'), { method: 'POST', body: {} });
  r = await A(W('/quotes')); const rq = r.j.find(x => x.id === q.id); ok(rq.opted_out && !rq.eligible, 'STOP marks the customer opted out');
  r = await A(W('/messages'), { method: 'POST', body: { quote_id: q.id, channel: 'sms', body: 'hello again', send: true } }); ok(r.s === 400 && /opted out/.test(r.j.error), 'cannot message an opted-out customer');
  r = await A(W('/calls'), { method: 'POST', body: { quote_id: q.id, agent_phone: '+15550000001' } }); ok(r.s === 400 && /opted out/.test(r.j.error), 'cannot call an opted-out customer');
  r = await A(W('/quotes'), { method: 'POST', body: { ref: 'C1', name: 'Callee', amount: 4000, quote_date: d(10), phone: '+15550100777', eligible: true } }); const cq = r.j;
  r = await A(W('/calls'), { method: 'POST', body: { quote_id: cq.id, agent_phone: '+15550000001' } }); ok(r.s === 200, 'click-to-call placed');
  const call = seen.find(x => /Calls\.json/.test(x.p)); ok(/To=%2B15550000001/.test(call.b) && /Dial/.test(decodeURIComponent(call.b)) && !/Record/i.test(call.b), 'agent rung first, bridged to customer, not recorded');
  await A(W('/sync'), { method: 'POST', body: {} }); r = await A(W('/calls')); ok(r.j[0].status === 'completed' && r.j[0].duration === 94, 'call status and duration synced');
  r = await V(W('/calls'), { method: 'POST', body: { quote_id: cq.id, agent_phone: '+15550000001' } }); ok(r.s === 403, 'viewer cannot place calls');

  r = await A(W('/plan')); ok(r.j.steps.length === 4 && !r.j.on, 'default 3/7/14/30 plan, off');
  r = await A(W('/plan/run'), { method: 'POST', body: { dry: true } }); ok(r.j.due.some(x => x.quote === 'C1') && r.j.created === 0, 'dry run lists who is due without writing');
  r = await A(W('/plan/run'), { method: 'POST', body: {} }); ok(r.j.created >= 1, 'plan creates drafts');
  r = await A(W('/messages')); const pd = r.j.filter(m => m.created_by === 'plan' && m.status === 'draft'); ok(pd.length >= 1 && pd.every(m => /Hi /.test(m.body) && !/\{name\}/.test(m.body)), 'plan drafts are filled in and waiting for approval');
  r = await A(W('/plan/run'), { method: 'POST', body: { dry: true } }); ok(r.j.due.length === 0 && r.j.skipped.pending >= 1, 'no duplicate drafts while one is pending');
  r = await A(W('/plan'), { method: 'PUT', body: { on: true, steps: [{ day: 5, body: 'b' }, { day: 3, body: 'b' }] } }); ok(r.s === 400, 'plan days must increase');
  r = await V(W('/plan'), { method: 'PUT', body: { on: true, steps: [{ day: 1, body: 'x' }] } }); ok(r.s === 403, 'viewer cannot edit the plan');
  r = await V(W('/messages/bulk'), { method: 'POST', body: { action: 'approve' } }); ok(r.s === 403, 'viewer cannot bulk approve');
  r = await A(W('/messages/bulk'), { method: 'POST', body: { action: 'approve' } }); ok(r.j.done >= 1, 'bulk approve');
  await A(W('/integrations/resend/connect'), { method: 'POST', body: { fields: { api_key: 'good', from: 'Co <a@b.co>' } } });
  r = await A(W('/messages/bulk'), { method: 'POST', body: { action: 'send' } }); ok(r.j.done >= 1 && r.j.failed.length === 1 && /eligible/.test(r.j.failed[0].error), 'bulk send sends the good ones and reports the ineligible one');
  r = await A(W('/summary')); ok(r.j.setup.find(x => x.key === 'channel').done && r.j.setup.find(x => x.key === 'send').done && !r.j.setup.find(x => x.key === 'plan').done, 'setup checklist reflects progress');

  r = await A(W('/integrations/dropbox_sign/connect'), { method: 'POST', body: { fields: { api_key: 'k' } } }); ok(r.s === 200, 'Dropbox Sign connected');
  r = await A(W('/contracts'), { method: 'POST', body: { quote_id: cq.id, tpl: 'accept', scope: 'x' } }); const kid = r.j.id; await A(W('/quotes/' + cq.id), { method: 'PATCH', body: { assignee: null } });
  r = await A(W('/contracts/' + kid + '/send'), { method: 'POST', body: { mode: 'dropbox_sign' } }); ok(r.s === 400 && /email/.test(r.j.error), 'provider send needs an email address');
  await A(W('/quotes/' + cq.id), { method: 'DELETE' }); r = await A(W('/quotes'), { method: 'POST', body: { ref: 'C2', name: 'Signer', amount: 4000, quote_date: d(10), email: 'sg@example.com', eligible: true } }); const sq = r.j;
  r = await A(W('/contracts'), { method: 'POST', body: { quote_id: sq.id, tpl: 'accept', scope: 'x' } }); const kid2 = r.j.id;
  r = await A(W('/contracts/' + kid2 + '/send'), { method: 'POST', body: { mode: 'dropbox_sign' } }); ok(r.s === 200, 'contract sent through Dropbox Sign');
  r = await A(W('/sync'), { method: 'POST', body: {} }); ok(r.j.contracts === 1, 'signature status pulled back automatically');
  r = await A(W('/contracts')); ok(r.j.find(x => x.id === kid2).status === 'signed', 'contract now signed');
  r = await A(W('/integrations/housecall_pro/connect'), { method: 'POST', body: { fields: { api_key: 'k' } } }); ok(r.s === 200, 'Housecall Pro connected');
  r = await A(W(`/quotes/${sq.id}/push`), { method: 'POST', body: { provider: 'housecall_pro' } }); ok(r.j.id === 'cust_1', 'customer pushed to Housecall Pro');

  r = await A('/api/account'); ok(r.j.recoveryLeft === 8, 'signup issued 8 recovery codes');
  r = await fetch(B + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RR': '1' }, body: JSON.stringify({ email: 'rec@example.com', password: 'original passphrase' }) }); const rj = await r.json(); ok(rj.recovery.length === 8, 'signup returns the codes once');
  const rs = (code, pw) => fetch(B + '/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RR': '1' }, body: JSON.stringify({ email: 'rec@example.com', code, password: pw }) });
  ok((await rs('0000-0000', 'a brand new passphrase')).status === 401, 'wrong recovery code rejected');
  ok((await rs(rj.recovery[0], 'a brand new passphrase')).status === 200, 'recovery code resets the password');
  ok((await rs(rj.recovery[0], 'another new passphrase')).status === 401, 'recovery code works only once');
  r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RR': '1' }, body: JSON.stringify({ email: 'rec@example.com', password: 'a brand new passphrase' }) }); ok(r.status === 200, 'sign in with the new password');

  const failHook = await A(W('/webhooks'), { method: 'POST', body: { url: `http://127.0.0.1:${hp}/fail`, events: ['quote.created'] } });
  failing = true; await A(W('/quotes'), { method: 'POST', body: { name: 'Retry', amount: 800, quote_date: d(2) } }); await new Promise(r => setTimeout(r, 600));
  const before = hooks.filter(h => h.h['x-rr-event'] === 'quote.created').length; failing = false; await tick.runOutbox(); await new Promise(r => setTimeout(r, 400));
  ok(hooks.filter(h => h.h['x-rr-event'] === 'quote.created').length > before, 'failed webhook is retried from the database queue');
  const tsig = (url, params) => crypto.createHmac('sha1', 'tok').update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest('base64');
  const tp = { MessageSid: 'SMhook1', From: '+15550100777', Body: 'hi there' }; r = await fetch(`${B}/hooks/twilio/${wid}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'bad' }, body: new URLSearchParams(tp) }); ok(r.status === 403, 'Twilio webhook rejects a bad signature');
  r = await fetch(`${B}/hooks/twilio/${wid}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': tsig(`${B}/hooks/twilio/${wid}`, tp) }, body: new URLSearchParams(tp) }); ok(r.status === 200, 'Twilio webhook accepts a valid signature');

  r = await A(W('/quotes/export.csv')); const csv = await r.r.text(); ok(/Quote ID/.test(csv), 'CSV export');
  for (const f of ['login', 'dashboard', 'pipeline', 'inbox', 'plan', 'outreach', 'contracts', 'integrations', 'integration', 'developer', 'team', 'settings', 'account', 'sign']) { const p = await fetch(`${B}/${f}.html`); assert.equal(p.status, 200, f); }
  ok(true, 'all 14 pages are served');
  console.log(`\n${n} checks passed`); srv.close(); mock.close(); recv.close(); process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
