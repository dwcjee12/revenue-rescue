'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const prov = require('./providers');
const { P } = prov;

const PORT = +process.env.PORT || 3000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = BASE.startsWith('https://');
const DESKTOP = process.env.DESKTOP === '1';
const CREDS_UI = DESKTOP || process.env.ALLOW_APP_CREDS_UI === '1';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA, 'app.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

/* ---------------- schema ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,pw TEXT NOT NULL,created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,exp INTEGER);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT,color TEXT,review_days INTEGER DEFAULT 3,recontact_days INTEGER DEFAULT 5,high_amount REAL DEFAULT 5000,created INTEGER);
CREATE TABLE IF NOT EXISTS members(ws TEXT,user_id TEXT,role TEXT,PRIMARY KEY(ws,user_id));
CREATE TABLE IF NOT EXISTS perms(ws TEXT,role TEXT,perm TEXT,allowed INTEGER,PRIMARY KEY(ws,role,perm));
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,ws TEXT,email TEXT,role TEXT,exp INTEGER);
CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY,ws TEXT,ref TEXT,name TEXT,email TEXT,phone TEXT,amount REAL,quote_date TEXT,channel TEXT DEFAULT 'email',eligible INTEGER DEFAULT 0,stage TEXT DEFAULT 'open',assignee TEXT,revenue REAL DEFAULT 0,note TEXT,created INTEGER,UNIQUE(ws,ref));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,ws TEXT,quote_id TEXT,channel TEXT,to_addr TEXT,subject TEXT,body TEXT,status TEXT,created_by TEXT,approved_by TEXT,provider TEXT,provider_id TEXT,error TEXT,created INTEGER,sent_at INTEGER);
CREATE TABLE IF NOT EXISTS contracts(id TEXT PRIMARY KEY,ws TEXT,quote_id TEXT,tpl TEXT,text TEXT,doc_hash TEXT,status TEXT,mode TEXT,provider_id TEXT,token_hash TEXT,signed_by TEXT,signed_at INTEGER,signed_ip TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,ws TEXT,provider TEXT,status TEXT,label TEXT,config TEXT,last_test INTEGER,last_error TEXT,created INTEGER,UNIQUE(ws,provider));
CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY,ws TEXT,user_id TEXT,provider TEXT,verifier TEXT,exp INTEGER);
CREATE TABLE IF NOT EXISTS webhooks(id TEXT PRIMARY KEY,ws TEXT,url TEXT,secret TEXT,events TEXT,active INTEGER DEFAULT 1,created INTEGER);
CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,hook TEXT,ws TEXT,event TEXT,status TEXT,code INTEGER,attempt INTEGER,error TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS apikeys(id TEXT PRIMARY KEY,ws TEXT,label TEXT,hash TEXT UNIQUE,prefix TEXT,created INTEGER,last_used INTEGER);
CREATE TABLE IF NOT EXISTS app_creds(app TEXT PRIMARY KEY,data TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,ws TEXT,user_id TEXT,action TEXT,detail TEXT,created INTEGER);
`);

/* ---------------- helpers ---------------- */
const rid = () => crypto.randomBytes(8).toString('hex');
const tok = () => crypto.randomBytes(32).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const q1 = (s, ...a) => db.prepare(s).get(...a);
const qa = (s, ...a) => db.prepare(s).all(...a);
const run = (s, ...a) => db.prepare(s).run(...a);
const DAY = 864e5;
function addCol(t, c, d) { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); }
db.exec(`CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,ws TEXT,quote_id TEXT,user_id TEXT,sid TEXT,status TEXT,duration INTEGER DEFAULT 0,notes TEXT,outcome TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS recovery(hash TEXT PRIMARY KEY,user_id TEXT,used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,hook TEXT,ws TEXT,event TEXT,body TEXT,attempt INTEGER,next_at INTEGER);`);
addCol('quotes', 'opted_out', 'INTEGER DEFAULT 0'); addCol('messages', 'direction', "TEXT DEFAULT 'out'"); addCol('messages', 'is_read', 'INTEGER DEFAULT 1');
addCol('workspaces', 'plan', 'TEXT'); addCol('workspaces', 'plan_on', 'INTEGER DEFAULT 0'); addCol('workspaces', 'plan_last', 'INTEGER');
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m, s = 400) => { throw new HttpError(s, m); };

let KEY;
if (process.env.ENCRYPTION_KEY) KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
else { const f = path.join(DATA, '.secret'); if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 }); KEY = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); }
if (KEY.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes as 64 hex characters');
const enc = o => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv), b = Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64'); };
const dec = s => { const b = Buffer.from(s, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); };

prov.setCredLookup(app => { const r = q1('SELECT data FROM app_creds WHERE app=?', app); if (!r) return null; try { const d = dec(r.data); return { id: d.id, secret: d.secret }; } catch (e) { return null; } });

const hashPw = pw => { const s = crypto.randomBytes(16); return `${s.toString('hex')}:${crypto.scryptSync(pw, s, 64).toString('hex')}`; };
const checkPw = (pw, st) => { const [s, h] = st.split(':'); const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };

const PERMS = ['move', 'draft', 'approve', 'call', 'contract', 'assign', 'export', 'integrations'];
const DEFAULT_PERMS = { owner: PERMS, estimator: ['move', 'draft', 'call', 'contract', 'assign', 'export'], viewer: [] };
for (const w of db.prepare('SELECT id FROM workspaces').all()) for (const r of ['estimator', 'viewer']) for (const pm of PERMS) db.prepare('INSERT OR IGNORE INTO perms(ws,role,perm,allowed) VALUES(?,?,?,?)').run(w.id, r, pm, DEFAULT_PERMS[r].includes(pm) ? 1 : 0);
const EVENTS = ['quote.created', 'quote.updated', 'quote.won', 'message.drafted', 'message.approved', 'message.sent', 'message.received', 'message.failed', 'quote.opted_out', 'call.started', 'contract.sent', 'contract.signed', 'integration.connected', 'test.ping'];

function audit(ws, user, action, detail) { run('INSERT INTO audit(ws,user_id,action,detail,created) VALUES(?,?,?,?,?)', ws, user || null, action, String(detail || '').slice(0, 300), Date.now()); }

const rate = new Map();
function limit(key, max, ms) { const n = Date.now(), a = (rate.get(key) || []).filter(t => n - t < ms); if (a.length >= max) return false; a.push(n); rate.set(key, a); return true; }

const validEmail = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e || '');
function normPhone(p) { if (!p) return null; const raw = String(p).trim(), d = raw.replace(/\D/g, ''); if (raw.startsWith('+') && d.length >= 8 && d.length <= 15) return '+' + d; if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return null; }
function normDate(v) { if (!v) return null; const s = String(v).trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); let d; if (m) d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3])); else if (/^\d{5}$/.test(s)) d = new Date(Date.UTC(1899, 11, 30) + +s * DAY); else { const t = new Date(s); if (isNaN(t)) return null; d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())); } return isNaN(d) ? null : d.toISOString().slice(0, 10); }
const daysOpen = q => Math.max(0, Math.floor((Date.now() - Date.parse(q.quote_date + 'T00:00:00Z')) / DAY));
const SENT_STAGES = ['sent', 'replied', 'booked', 'won'];
function laneOf(q, w) { if (SENT_STAGES.includes(q.stage)) return 'sent'; if (q.stage === 'lost') return 'closed'; const d = daysOpen(q); if (q.amount >= w.high_amount && d >= 7 && d <= 30) return 'high'; if (d >= 5 && d <= 14) return 'medium'; return 'low'; }
const publicQuote = (q, w) => ({ id: q.id, ref: q.ref, name: q.name, email: q.email, phone: q.phone, amount: q.amount, quote_date: q.quote_date, days: daysOpen(q), channel: q.channel, eligible: !!q.eligible && !q.opted_out, opted_out: !!q.opted_out, stage: q.stage, lane: laneOf(q, w), assignee: q.assignee, revenue: q.revenue, note: q.note });

/* ---------------- events: webhooks and chat notifications ---------------- */
const RETRY_MS = (process.env.OUTBOX_BASE_MS ? [+process.env.OUTBOX_BASE_MS] : [60e3, 5 * 60e3, 30 * 60e3, 2 * 36e5]);
async function deliver(hook, event, body, attempt = 1) {
  const t = Math.floor(Date.now() / 1000), sig = crypto.createHmac('sha256', dec(hook.secret).s).update(`${t}.${body}`).digest('hex');
  let code = 0, err = null;
  try {
    await prov.assertPublicUrl(hook.url);
    const r = await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'RevenueRescue-Webhook/1', 'X-RR-Event': event, 'X-RR-Signature': `t=${t},v1=${sig}` }, body, signal: AbortSignal.timeout(10000), redirect: 'manual' });
    code = r.status; if (code < 200 || code >= 300) err = `HTTP ${code}`;
  } catch (e) { err = e.message; }
  run('INSERT INTO deliveries(id,hook,ws,event,status,code,attempt,error,created) VALUES(?,?,?,?,?,?,?,?,?)', rid(), hook.id, hook.ws, event, err ? 'failed' : 'ok', code, attempt, err, Date.now());
  if (err && event !== 'test.ping' && attempt <= RETRY_MS.length) run('INSERT INTO outbox(id,hook,ws,event,body,attempt,next_at) VALUES(?,?,?,?,?,?,?)', rid(), hook.id, hook.ws, event, body, attempt + 1, Date.now() + RETRY_MS[Math.min(attempt, RETRY_MS.length) - 1]);
  return { ok: !err, code, error: err };
}
async function runOutbox() { for (const o of qa('SELECT * FROM outbox WHERE next_at<=? LIMIT 20', Date.now())) { run('DELETE FROM outbox WHERE id=?', o.id); const h = q1('SELECT * FROM webhooks WHERE id=? AND active=1', o.hook); if (h) await deliver(h, o.event, o.body, o.attempt); } }
function emit(wid, event, data, summary) {
  setImmediate(async () => {
    try {
      const body = JSON.stringify({ id: 'evt_' + rid(), event, workspace: wid, occurred_at: new Date().toISOString(), data });
      for (const h of qa('SELECT * FROM webhooks WHERE ws=? AND active=1', wid)) { const ev = (h.events || '').split(',').filter(Boolean); if (!ev.length || ev.includes(event) || ev.includes('*')) deliver(h, event, body).catch(() => {}); }
      for (const pid of ['slack', 'teams']) {
        const row = q1("SELECT * FROM connections WHERE ws=? AND provider=? AND status='connected'", wid, pid); if (!row) continue;
        const ctx = ctxFor(row), list = (ctx.settings.notify || 'message.sent,contract.signed,quote.won').split(',').map(s => s.trim());
        if (list.includes(event)) await P[pid].actions.notify(ctx, { text: `[Revenue Rescue] ${summary || event}` }).catch(e => audit(wid, null, 'notify.failed', `${pid}: ${e.message}`));
      }
    } catch (e) { console.error('emit', e.message); }
  });
}

/* ---------------- connections ---------------- */
function ctxFor(row) {
  const cfg = dec(row.config), p = P[row.provider];
  const ctx = { cfg, get settings() { return cfg.settings || {}; } };
  ctx.token = async () => {
    if (cfg.refresh_token && cfg.expires_at && cfg.expires_at - 60000 < Date.now()) {
      try {
        const t = await prov.tokenRequest(p, BASE, { grant_type: 'refresh_token', refresh_token: cfg.refresh_token });
        cfg.access_token = t.access_token; if (t.refresh_token) cfg.refresh_token = t.refresh_token; cfg.expires_at = t.expires_in ? Date.now() + t.expires_in * 1000 : null;
        run('UPDATE connections SET config=? WHERE id=?', enc(cfg), row.id);
      } catch (e) { run("UPDATE connections SET status='error',last_error=? WHERE id=?", 'Token refresh failed: ' + e.message, row.id); throw e; }
    }
    return cfg.access_token;
  };
  return ctx;
}
const findConn = (wid, ids) => { for (const id of ids) { const r = q1("SELECT * FROM connections WHERE ws=? AND provider=? AND status='connected'", wid, id); if (r) return { row: r, p: P[id] }; } return null; };
const connView = r => ({ provider: r.provider, status: r.status, label: r.label, last_test: r.last_test, last_error: r.last_error, created: r.created, settings: dec(r.config).settings || {} });

/* ---------------- app ---------------- */
const app = express();
if (SECURE) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
  if (SECURE) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
if (DESKTOP) app.use((req, res, next) => { const h = String(req.headers.host || ''); if (!/^(127\.0\.0\.1|localhost):\d+$/.test(h)) return res.status(403).send('Forbidden'); next(); });
app.use(express.json({ limit: '4mb' }));
app.get('/api/info', (req, res) => res.json({ desktop: DESKTOP }));
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
function startSession(res, uid) { const t = tok(), exp = Date.now() + 14 * DAY; run('INSERT INTO sessions(hash,user_id,exp) VALUES(?,?,?)', sha(t), uid, exp); res.setHeader('Set-Cookie', `rr_sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}${SECURE ? '; Secure' : ''}`); }
function sessionUser(req) { const t = cookies(req).rr_sid; if (!t) return null; const s = q1('SELECT * FROM sessions WHERE hash=? AND exp>?', sha(t), Date.now()); return s ? q1('SELECT id,email,name FROM users WHERE id=?', s.user_id) : null; }

app.use('/api', (req, res, next) => { if (req.method !== 'GET' && !req.path.startsWith('/v1/') && req.get('x-rr') !== '1') return res.status(403).json({ error: 'Missing X-RR header' }); next(); });
const auth = (req, res, next) => { const u = sessionUser(req); if (!u) return res.status(401).json({ error: 'Sign in required' }); req.user = u; next(); };
const wsMw = (req, res, next) => {
  const m = q1('SELECT m.role,w.* FROM members m JOIN workspaces w ON w.id=m.ws WHERE m.ws=? AND m.user_id=?', req.params.wid, req.user.id);
  if (!m) return res.status(404).json({ error: 'Workspace not found' });
  req.w = m; req.role = m.role;
  req.can = p => m.role === 'owner' || !!q1('SELECT allowed FROM perms WHERE ws=? AND role=? AND perm=? AND allowed=1', m.id, m.role, p);
  req.need = (p, what) => { if (!req.can(p)) bad(`Your role can't ${what || p}. An owner can change this on the Team page.`, 403); };
  next();
};
const W = [auth, wsMw];

function createWorkspace(uid, name, color) {
  const id = rid(); run('INSERT INTO workspaces(id,name,color,created) VALUES(?,?,?,?)', id, name, color || 'teal', Date.now()); run('INSERT INTO members(ws,user_id,role) VALUES(?,?,?)', id, uid, 'owner');
  for (const r of ['estimator', 'viewer']) for (const p of PERMS) run('INSERT INTO perms(ws,role,perm,allowed) VALUES(?,?,?,?)', id, r, p, DEFAULT_PERMS[r].includes(p) ? 1 : 0);
  audit(id, uid, 'workspace.created', name); return id;
}
const wsList = uid => qa('SELECT w.id,w.name,w.color,m.role FROM members m JOIN workspaces w ON w.id=m.ws WHERE m.user_id=? ORDER BY w.created', uid).map(w => ({ ...w, perms: w.role === 'owner' ? PERMS : qa('SELECT perm FROM perms WHERE ws=? AND role=? AND allowed=1', w.id, w.role).map(r => r.perm) }));

/* ---------------- auth routes ---------------- */
function acceptInvite(token, user) {
  const inv = q1('SELECT * FROM invites WHERE hash=? AND exp>?', sha(token), Date.now()); if (!inv) bad('This invite is invalid or has expired');
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) bad('This invite was sent to a different email address');
  run('INSERT OR REPLACE INTO members(ws,user_id,role) VALUES(?,?,?)', inv.ws, user.id, inv.role); run('DELETE FROM invites WHERE hash=?', inv.hash); audit(inv.ws, user.id, 'invite.accepted', user.email); return inv.ws;
}
app.post('/api/auth/signup', wrap((req, res) => {
  const { email, password, name, workspace, invite } = req.body || {};
  if (!limit('su:' + req.ip, 10, 36e5)) bad('Too many sign-ups. Try again later.', 429);
  if (!validEmail(email)) bad('Enter a valid email address');
  if (!password || password.length < 10) bad('Use a password of at least 10 characters');
  if (q1('SELECT 1 FROM users WHERE email=?', email.toLowerCase())) bad('An account with that email already exists. Sign in instead.', 409);
  const id = rid(); run('INSERT INTO users(id,email,name,pw,created) VALUES(?,?,?,?,?)', id, email.toLowerCase(), String(name || '').slice(0, 80), hashPw(password), Date.now());
  const user = { id, email: email.toLowerCase() };
  if (invite) acceptInvite(invite, user); else createWorkspace(id, String(workspace || 'My company').slice(0, 80), 'teal');
  startSession(res, id); res.json({ ok: true, recovery: newRecovery(id) });
}));
app.post('/api/auth/login', wrap((req, res) => {
  const { email, password, invite } = req.body || {}; const k = 'li:' + req.ip + ':' + String(email).toLowerCase();
  if (!limit(k, 10, 9e5)) bad('Too many attempts. Wait 15 minutes.', 429);
  const u = q1('SELECT * FROM users WHERE email=?', String(email || '').toLowerCase());
  if (!u || !checkPw(String(password || ''), u.pw)) bad('Email or password is incorrect', 401);
  if (invite) acceptInvite(invite, u);
  startSession(res, u.id); res.json({ ok: true });
}));
app.post('/api/auth/logout', (req, res) => { const t = cookies(req).rr_sid; if (t) run('DELETE FROM sessions WHERE hash=?', sha(t)); res.setHeader('Set-Cookie', 'rr_sid=; Path=/; HttpOnly; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: req.user, workspaces: wsList(req.user.id), perms: PERMS }));
app.post('/api/workspaces', auth, wrap((req, res) => { const n = String(req.body.name || '').trim(); if (!n) bad('Enter a workspace name'); res.json({ id: createWorkspace(req.user.id, n.slice(0, 80), req.body.color) }); }));

/* ---------------- quotes ---------------- */
function insertQuote(wid, b, actor) {
  const name = String(b.name || '').trim(), amount = parseFloat(String(b.amount).replace(/[^0-9.]/g, '')), date = normDate(b.quote_date || b.date);
  if (!name) bad('Customer first name is required'); if (!(amount > 0)) bad('Amount must be greater than 0'); if (!date) bad('Quote date is missing or unreadable');
  const email = b.email ? String(b.email).trim().toLowerCase() : null; if (email && !validEmail(email)) bad(`"${email}" is not a valid email`);
  const phone = b.phone ? normPhone(b.phone) : null; if (b.phone && !phone) bad(`"${b.phone}" is not a valid phone number`);
  const id = rid(), ref = String(b.ref || '').trim() || 'Q-' + id.slice(0, 6).toUpperCase();
  if (q1('SELECT 1 FROM quotes WHERE ws=? AND ref=?', wid, ref)) bad(`Quote ${ref} already exists`, 409);
  const channel = /text|sms/i.test(b.channel || '') ? 'text' : 'email';
  run('INSERT INTO quotes(id,ws,ref,name,email,phone,amount,quote_date,channel,eligible,note,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, wid, ref, name.slice(0, 60), email, phone, amount, date, channel, b.eligible ? 1 : 0, String(b.note || '').slice(0, 300), Date.now());
  audit(wid, actor, 'quote.created', ref); const q = q1('SELECT * FROM quotes WHERE id=?', id); return q;
}
app.get('/api/w/:wid/quotes', W, (req, res) => res.json(qa('SELECT * FROM quotes WHERE ws=? ORDER BY quote_date', req.w.id).map(q => publicQuote(q, req.w))));
app.post('/api/w/:wid/quotes', W, wrap((req, res) => { req.need('move', 'add quotes'); const q = insertQuote(req.w.id, req.body, req.user.id); emit(req.w.id, 'quote.created', publicQuote(q, req.w), `New quote ${q.ref} for ${q.name}`); res.json(publicQuote(q, req.w)); }));
app.post('/api/w/:wid/quotes/import', W, wrap((req, res) => {
  req.need('export', 'import data'); const rows = req.body.rows; if (!Array.isArray(rows) || !rows.length) bad('No rows to import'); if (rows.length > 5000) bad('Import up to 5000 rows at a time');
  const r = { added: 0, notOpen: 0, noConsent: 0, invalid: [], duplicates: 0 };
  rows.forEach((b, i) => {
    const st = String(b.stage || 'open').toLowerCase(); if (st !== 'open') { r.notOpen++; return; }
    const el = b.eligible === undefined || b.eligible === '' ? !!req.body.confirmAllEligible : ['yes', 'y', 'true', '1'].includes(String(b.eligible).toLowerCase());
    if (!el) { r.noConsent++; return; }
    try { insertQuote(req.w.id, { ...b, eligible: true }, req.user.id); r.added++; } catch (e) { if (e.status === 409) r.duplicates++; else if (r.invalid.length < 20) r.invalid.push(`Row ${i + 2}: ${e.message}`); }
  });
  audit(req.w.id, req.user.id, 'quotes.imported', `${r.added} added`); res.json(r);
}));
app.patch('/api/w/:wid/quotes/:id', W, wrap((req, res) => {
  const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', req.params.id, req.w.id); if (!q) bad('Quote not found', 404); const b = req.body;
  if ('stage' in b || 'eligible' in b || 'revenue' in b) req.need('move', 'change quote status');
  if ('assignee' in b) req.need('assign', 'assign quotes');
  if (b.stage && !['open', 'sent', 'replied', 'booked', 'won', 'lost'].includes(b.stage)) bad('Unknown stage');
  if (b.stage === 'sent' && q.stage === 'open') req.need('approve', 'mark a quote as sent');
  if (b.assignee) { const m = q1('SELECT 1 FROM members WHERE ws=? AND user_id=?', req.w.id, b.assignee); if (!m) bad('Assignee is not in this workspace'); }
  const n = { stage: b.stage ?? q.stage, eligible: 'eligible' in b ? (b.eligible ? 1 : 0) : q.eligible, assignee: 'assignee' in b ? (b.assignee || null) : q.assignee, revenue: 'revenue' in b ? Math.max(0, +b.revenue || 0) : q.revenue, note: 'note' in b ? String(b.note).slice(0, 300) : q.note };
  if (n.stage !== 'won') n.revenue = 0;
  run('UPDATE quotes SET stage=?,eligible=?,assignee=?,revenue=?,note=? WHERE id=?', n.stage, n.eligible, n.assignee, n.revenue, n.note, q.id);
  const u = publicQuote(q1('SELECT * FROM quotes WHERE id=?', q.id), req.w);
  emit(req.w.id, n.stage === 'won' && q.stage !== 'won' ? 'quote.won' : 'quote.updated', u, n.stage === 'won' ? `Quote ${q.ref} won: $${n.revenue}` : `Quote ${q.ref} updated`); res.json(u);
}));
app.delete('/api/w/:wid/quotes/:id', W, wrap((req, res) => { req.need('move', 'delete quotes'); run('DELETE FROM messages WHERE quote_id=? AND ws=?', req.params.id, req.w.id); run('DELETE FROM contracts WHERE quote_id=? AND ws=?', req.params.id, req.w.id); run('DELETE FROM quotes WHERE id=? AND ws=?', req.params.id, req.w.id); audit(req.w.id, req.user.id, 'quote.deleted', req.params.id); res.json({ ok: true }); }));
const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
function exportRows(w) { return [['Quote ID', 'Customer First Name', 'Email', 'Phone', 'Quote Amount', 'Quote Date', 'Days Open', 'Priority Lane', 'Stage', 'Eligible', 'Preferred Channel', 'Revenue']].concat(qa('SELECT * FROM quotes WHERE ws=? ORDER BY quote_date', w.id).map(q => { const p = publicQuote(q, w); return [p.ref, p.name, p.email, p.phone, p.amount, p.quote_date, p.days, p.lane, p.stage, p.eligible ? 'Yes' : 'No', p.channel, p.revenue]; })); }
app.get('/api/w/:wid/quotes/export.csv', W, wrap((req, res) => { req.need('export', 'export data'); res.type('text/csv').set('Content-Disposition', 'attachment; filename="quotes.csv"').send(exportRows(req.w).map(r => r.map(csvCell).join(',')).join('\n')); }));
app.get('/api/w/:wid/quotes/export.json', W, wrap((req, res) => { req.need('export', 'export data'); res.set('Content-Disposition', 'attachment; filename="quotes.json"').json(qa('SELECT * FROM quotes WHERE ws=?', req.w.id).map(q => publicQuote(q, req.w))); }));

function setupSteps(w, nq) {
  const has = ids => !!findConn(w.id, ids), sent = q1("SELECT COUNT(*) n FROM messages WHERE ws=? AND status='sent'", w.id).n, members = q1('SELECT COUNT(*) n FROM members WHERE ws=?', w.id).n;
  return [{ key: 'import', label: 'Add or import your quotes', done: nq > 0, href: '/pipeline.html' }, { key: 'channel', label: 'Connect texting or email', done: has(['twilio', 'resend', 'mailgun']), href: '/integrations.html' }, { key: 'plan', label: 'Turn on your follow-up plan', done: !!w.plan_on, href: '/plan.html' }, { key: 'send', label: 'Approve and send your first message', done: sent > 0, href: '/outreach.html' }, { key: 'team', label: 'Invite a teammate or connect a calendar', done: members > 1 || has(['google_calendar', 'outlook_calendar']), href: '/team.html' }];
}
app.get('/api/w/:wid/summary', W, (req, res) => {
  const qs = qa('SELECT * FROM quotes WHERE ws=?', req.w.id).map(q => publicQuote(q, req.w)), lane = {};
  ['high', 'medium', 'low', 'sent', 'closed'].forEach(l => { const a = qs.filter(q => q.lane === l); lane[l] = { count: a.length, value: a.reduce((t, q) => t + q.amount, 0) }; });
  const sent = qs.filter(q => SENT_STAGES.includes(q.stage)), won = qs.filter(q => q.stage === 'won');
  res.json({ lane, total: qs.length, funnel: { reviewed: qs.length, sent: sent.length, replied: sent.filter(q => q.stage !== 'sent').length, booked: sent.filter(q => ['booked', 'won'].includes(q.stage)).length, won: won.length }, revenue: won.reduce((t, q) => t + q.revenue, 0),
    aging: [['0 to 4 days', 0, 4], ['5 to 14 days', 5, 14], ['15 to 30 days', 15, 30], ['Over 30 days', 31, 1e9]].map(([l, a, b]) => ({ label: l, count: qs.filter(q => !SENT_STAGES.includes(q.stage) && q.stage !== 'lost' && q.days >= a && q.days <= b).length })),
    setup: setupSteps(req.w, qs.length), connections: qa("SELECT provider,status FROM connections WHERE ws=?", req.w.id), messages: q1("SELECT COUNT(*) n FROM messages WHERE ws=? AND status='sent'", req.w.id).n, pendingApproval: q1("SELECT COUNT(*) n FROM messages WHERE ws=? AND status='draft'", req.w.id).n,
    activity: qa('SELECT a.action,a.detail,a.created,u.name,u.email FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.ws=? ORDER BY a.id DESC LIMIT 12', req.w.id) });
});

/* ---------------- outreach ---------------- */
const draftText = (q, w) => `Hi ${q.name}, this is ${w.name} following up on the estimate we sent ${daysOpen(q)} days ago. Do you have any questions, or is there anything you'd like adjusted? No rush, just let me know how you'd like to proceed.`;
app.get('/api/w/:wid/messages', W, (req, res) => res.json(qa("SELECT m.*,q.name,q.ref FROM messages m LEFT JOIN quotes q ON q.id=m.quote_id WHERE m.ws=? AND m.direction='out' ORDER BY m.created DESC LIMIT 300", req.w.id)));
app.get('/api/w/:wid/quotes/:id/draft', W, wrap((req, res) => { const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', req.params.id, req.w.id); if (!q) bad('Quote not found', 404); res.json({ subject: `Your estimate from ${req.w.name}`, body: draftText(q, req.w) }); }));
function newMessage(w, uid, b) {
  const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', b.quote_id, w.id); if (!q) bad('Quote not found', 404);
  const channel = b.channel === 'sms' ? 'sms' : 'email', body = String(b.body || '').trim(); if (!body) bad('Write the message first'); if (body.length > 1500) bad('Keep messages under 1500 characters');
  const to = channel === 'sms' ? q.phone : q.email; if (!to) bad(`This customer has no ${channel === 'sms' ? 'phone number' : 'email address'} on file`);
  const id = rid(); run("INSERT INTO messages(id,ws,quote_id,channel,to_addr,subject,body,status,created_by,created,direction) VALUES(?,?,?,?,?,?,?,'draft',?,?,'out')", id, w.id, q.id, channel, to, String(b.subject || '').slice(0, 150), body, uid, Date.now());
  audit(w.id, uid, 'message.drafted', `${channel} to ${q.ref}`); emit(w.id, 'message.drafted', { id, quote: q.ref, channel }, `Draft ${channel} for ${q.ref} awaiting approval`); return id;
}
async function doSend(w, uid, m) {
  if (m.status !== 'approved') bad('Approve the message before sending it'); const q = q1('SELECT * FROM quotes WHERE id=?', m.quote_id);
  if (q.opted_out) bad('This customer opted out of messages'); if (!q.eligible) bad('This customer is not marked as eligible to contact');
  const conn = findConn(w.id, m.channel === 'sms' ? ['twilio'] : ['resend', 'mailgun']);
  if (!conn) bad(m.channel === 'sms' ? 'Connect Twilio on the Integrations page to send texts' : 'Connect Resend or Mailgun on the Integrations page to send email', 409);
  try {
    const ctx = ctxFor(conn.row); let r;
    if (m.channel === 'sms') { const body = /stop/i.test(m.body) ? m.body : m.body + ' Reply STOP to opt out.'; r = await conn.p.actions.sms(ctx, { to: m.to_addr, body }); }
    else r = await conn.p.actions.email(ctx, { to: m.to_addr, subject: m.subject || `Your estimate from ${w.name}`, text: m.body + `\n\n${w.name}\nReply to this email to opt out of follow-ups.` });
    run("UPDATE messages SET status='sent',provider=?,provider_id=?,sent_at=?,error=NULL WHERE id=?", conn.p.id, r.id || null, Date.now(), m.id);
    if (q.stage === 'open') run("UPDATE quotes SET stage='sent' WHERE id=?", q.id);
    audit(w.id, uid, 'message.sent', `${m.channel} to ${q.ref} via ${conn.p.name}`); emit(w.id, 'message.sent', { id: m.id, quote: q.ref, channel: m.channel, provider: conn.p.id }, `${m.channel === 'sms' ? 'Text' : 'Email'} sent for ${q.ref} (${q.name})`);
  } catch (e) { run("UPDATE messages SET error=? WHERE id=?", e.message, m.id); emit(w.id, 'message.failed', { id: m.id, error: e.message }, `Message failed: ${e.message}`); bad('Provider error: ' + e.message, 502); }
}
app.post('/api/w/:wid/messages', W, wrap(async (req, res) => {
  req.need('draft', 'write drafts'); const id = newMessage(req.w, req.user.id, req.body);
  if (req.body.send) { req.need('approve', 'send messages'); run("UPDATE messages SET status='approved',approved_by=? WHERE id=?", req.user.id, id); audit(req.w.id, req.user.id, 'message.approved', id); try { await doSend(req.w, req.user.id, q1('SELECT * FROM messages WHERE id=?', id)); } catch (e) { if (e.status !== 502) run('DELETE FROM messages WHERE id=?', id); throw e; } }
  res.json({ id });
}));
app.post('/api/w/:wid/messages/bulk', W, wrap(async (req, res) => {
  req.need('approve', 'approve or send messages'); const act = req.body.action; if (!['approve', 'send'].includes(act)) bad('Unknown action'); const out = { done: 0, failed: [] };
  const rows = Array.isArray(req.body.ids) && req.body.ids.length ? req.body.ids.map(i => q1("SELECT * FROM messages WHERE id=? AND ws=? AND direction='out'", i, req.w.id)).filter(Boolean) : qa("SELECT * FROM messages WHERE ws=? AND direction='out' AND status=?", req.w.id, act === 'approve' ? 'draft' : 'approved');
  for (const m of rows) {
    try { if (act === 'approve') { if (m.status !== 'draft') continue; run("UPDATE messages SET status='approved',approved_by=? WHERE id=?", req.user.id, m.id); audit(req.w.id, req.user.id, 'message.approved', m.id); } else { if (m.status !== 'approved') continue; await doSend(req.w, req.user.id, m); } out.done++; }
    catch (e) { out.failed.push({ id: m.id, error: e.message }); }
  }
  res.json(out);
}));
app.patch('/api/w/:wid/messages/:id', W, wrap((req, res) => { req.need('draft', 'edit drafts'); const m = q1('SELECT * FROM messages WHERE id=? AND ws=?', req.params.id, req.w.id); if (!m) bad('Not found', 404); if (m.status === 'sent') bad('Sent messages cannot be edited'); run("UPDATE messages SET body=?,subject=?,status='draft',approved_by=NULL,error=NULL WHERE id=?", String(req.body.body || m.body).slice(0, 1500), String(req.body.subject ?? m.subject).slice(0, 150), m.id); res.json({ ok: true }); }));
app.post('/api/w/:wid/messages/:id/approve', W, wrap((req, res) => { req.need('approve', 'approve messages'); const m = q1('SELECT * FROM messages WHERE id=? AND ws=?', req.params.id, req.w.id); if (!m) bad('Not found', 404); if (m.status === 'sent') bad('Already sent'); run("UPDATE messages SET status='approved',approved_by=? WHERE id=?", req.user.id, m.id); audit(req.w.id, req.user.id, 'message.approved', m.id); emit(req.w.id, 'message.approved', { id: m.id }, 'Message approved'); res.json({ ok: true }); }));
app.post('/api/w/:wid/messages/:id/send', W, wrap(async (req, res) => { req.need('approve', 'send messages'); const m = q1('SELECT * FROM messages WHERE id=? AND ws=?', req.params.id, req.w.id); if (!m) bad('Not found', 404); await doSend(req.w, req.user.id, m); res.json({ ok: true }); }));
app.delete('/api/w/:wid/messages/:id', W, wrap((req, res) => { req.need('draft', 'delete drafts'); run("DELETE FROM messages WHERE id=? AND ws=? AND status!='sent'", req.params.id, req.w.id); res.json({ ok: true }); }));

/* ---------------- calendar and CRM actions ---------------- */
app.post('/api/w/:wid/quotes/:id/schedule', W, wrap(async (req, res) => {
  req.need('move', 'schedule follow-ups'); const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', req.params.id, req.w.id); if (!q) bad('Quote not found', 404);
  const conn = findConn(req.w.id, ['google_calendar', 'outlook_calendar']); if (!conn) bad('Connect Google or Outlook Calendar on the Integrations page', 409);
  const start = new Date(req.body.start); if (isNaN(start)) bad('Pick a start time'); const end = new Date(start.getTime() + 30 * 60000);
  try { const r = await conn.p.actions.createEvent(ctxFor(conn.row), { summary: `Follow up: ${q.name} ($${q.amount})`, description: `Quote ${q.ref}`, start: start.toISOString(), end: end.toISOString() }); audit(req.w.id, req.user.id, 'calendar.event', q.ref); res.json(r); } catch (e) { bad('Calendar error: ' + e.message, 502); }
}));
const PUSH = { hubspot: 'upsertContact', salesforce: 'createLead', mailchimp: 'addContact', quickbooks: 'createCustomer', jobber: 'createCustomer', housecall_pro: 'createCustomer' };
app.post('/api/w/:wid/quotes/:id/push', W, wrap(async (req, res) => {
  req.need('integrations', 'sync to other systems'); const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', req.params.id, req.w.id); if (!q) bad('Quote not found', 404);
  const target = req.body.provider; if (!PUSH[target]) bad('Unknown target'); if (!q.eligible || q.opted_out) bad('This customer is not eligible to contact');
  const conn = findConn(req.w.id, [target]); if (!conn) bad(`Connect ${P[target].name} first`, 409); if (!q.email && ['hubspot', 'mailchimp'].includes(target)) bad('This customer has no email address');
  try { const r = await conn.p.actions[PUSH[target]](ctxFor(conn.row), { email: q.email, name: q.name, phone: q.phone, company: req.w.name }); audit(req.w.id, req.user.id, 'crm.push', `${q.ref} to ${target}`); res.json(r); } catch (e) { bad(`${P[target].name} error: ${e.message}`, 502); }
}));
app.post('/api/w/:wid/sheets/append', W, wrap(async (req, res) => {
  req.need('export', 'export data'); const conn = findConn(req.w.id, ['google_sheets']); if (!conn) bad('Connect Google Sheets first', 409);
  try { const rows = exportRows(req.w).slice(1); const r = await conn.p.actions.appendRows(ctxFor(conn.row), { rows }); audit(req.w.id, req.user.id, 'sheets.append', `${rows.length} rows`); res.json({ rows: rows.length, ...r }); } catch (e) { bad('Google Sheets error: ' + e.message, 502); }
}));

/* ---------------- contracts and signing ---------------- */
const TPL = {
  service: ['Service agreement', (q, w, s) => `SERVICE AGREEMENT\n\nContractor: ${w.name}\nCustomer: ${q.name}\nEstimate: ${q.ref} for $${q.amount} CAD\n\nScope of work: ${s || '[describe the work]'}\n\nBy signing, the customer accepts the estimate above and authorizes the contractor to schedule the work. Payment, warranty and cancellation terms: [add your terms].`],
  accept: ['Estimate acceptance', (q, w, s) => `ESTIMATE ACCEPTANCE\n\n${q.name} accepts estimate ${q.ref} from ${w.name} for $${q.amount} CAD.\n\nWork covered: ${s || '[describe the work]'}`],
  change: ['Change order', (q, w, s) => `CHANGE ORDER\n\nProject: estimate ${q.ref} for ${q.name} with ${w.name}\nOriginal amount: $${q.amount} CAD\n\nRequested change: ${s || '[describe the change and any price difference]'}\n\nThe change takes effect when both parties sign.`]
};
app.get('/api/w/:wid/contracts', W, (req, res) => res.json(qa('SELECT c.id,c.quote_id,c.tpl,c.text,c.status,c.mode,c.provider_id,c.signed_by,c.signed_at,c.created,q.name,q.ref FROM contracts c JOIN quotes q ON q.id=c.quote_id WHERE c.ws=? ORDER BY c.created DESC', req.w.id)));
app.post('/api/w/:wid/contracts', W, wrap((req, res) => {
  req.need('contract', 'prepare contracts'); const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', req.body.quote_id, req.w.id); if (!q) bad('Quote not found', 404); const t = TPL[req.body.tpl]; if (!t) bad('Unknown template');
  const id = rid(), text = t[1](q, req.w, String(req.body.scope || '').slice(0, 1500)); run("INSERT INTO contracts(id,ws,quote_id,tpl,text,doc_hash,status,created) VALUES(?,?,?,?,?,?,'draft',?)", id, req.w.id, q.id, req.body.tpl, text, sha(text), Date.now()); audit(req.w.id, req.user.id, 'contract.created', q.ref); res.json({ id });
}));
app.post('/api/w/:wid/contracts/:id/send', W, wrap(async (req, res) => {
  req.need('approve', 'send contracts'); const c = q1('SELECT * FROM contracts WHERE id=? AND ws=?', req.params.id, req.w.id); if (!c) bad('Not found', 404); if (c.status === 'signed') bad('Already signed');
  const q = q1('SELECT * FROM quotes WHERE id=?', c.quote_id), mode = req.body.mode;
  if (!q.eligible) bad('This customer is not marked as eligible to contact');
  if (mode === 'link') { const t = tok(); run("UPDATE contracts SET status='sent',mode='link',token_hash=? WHERE id=?", sha(t), c.id); audit(req.w.id, req.user.id, 'contract.sent', `${q.ref} by link`); emit(req.w.id, 'contract.sent', { id: c.id, quote: q.ref, mode }, `Contract sent for ${q.ref}`); return res.json({ link: `${BASE}/sign.html?t=${t}` }); }
  if (!['docusign', 'dropbox_sign'].includes(mode)) bad('Choose how to send this contract'); if (!q.email) bad('This customer has no email address');
  const conn = findConn(req.w.id, [mode]); if (!conn) bad(`Connect ${P[mode].name} first`, 409);
  try { const r = await conn.p.actions.sendEnvelope(ctxFor(conn.row), { subject: `${TPL[c.tpl][0]} from ${req.w.name}`, text: c.text, name: q.name, email: q.email }); run("UPDATE contracts SET status='sent',mode=?,provider_id=? WHERE id=?", mode, r.id || null, c.id); audit(req.w.id, req.user.id, 'contract.sent', `${q.ref} via ${P[mode].name}`); emit(req.w.id, 'contract.sent', { id: c.id, quote: q.ref, mode }, `Contract sent for ${q.ref} via ${P[mode].name}`); res.json({ ok: true, provider_id: r.id }); } catch (e) { bad('Provider error: ' + e.message, 502); }
}));
app.post('/api/w/:wid/contracts/:id/mark-signed', W, wrap((req, res) => { req.need('contract', 'update contracts'); const c = q1('SELECT * FROM contracts WHERE id=? AND ws=?', req.params.id, req.w.id); if (!c || c.mode === 'link') bad('Only provider contracts can be marked signed by hand'); run("UPDATE contracts SET status='signed',signed_by=?,signed_at=? WHERE id=?", `${req.user.email} (recorded manually from ${c.mode})`, Date.now(), c.id); audit(req.w.id, req.user.id, 'contract.marked_signed', c.id); res.json({ ok: true }); }));
app.get('/api/sign/:t', wrap((req, res) => { const c = q1('SELECT c.text,c.status,c.signed_by,c.signed_at,w.name company FROM contracts c JOIN workspaces w ON w.id=c.ws WHERE c.token_hash=?', sha(req.params.t)); if (!c) bad('This signing link is not valid', 404); res.json(c); }));
app.post('/api/sign/:t', wrap((req, res) => {
  if (!limit('sg:' + req.ip, 20, 6e5)) bad('Too many attempts', 429);
  const c = q1('SELECT * FROM contracts WHERE token_hash=?', sha(req.params.t)); if (!c) bad('This signing link is not valid', 404); if (c.status === 'signed') bad('Already signed', 409);
  if (sha(c.text) !== c.doc_hash) bad('This document changed after it was sent. Ask for a new link.');
  const name = String(req.body.name || '').trim(); if (name.length < 3 || !req.body.agree) bad('Type your full name and tick the agreement box');
  run("UPDATE contracts SET status='signed',signed_by=?,signed_at=?,signed_ip=? WHERE id=?", name.slice(0, 100), Date.now(), req.ip, c.id); audit(c.ws, null, 'contract.signed', `${c.id} by ${name}`);
  const q = q1('SELECT ref FROM quotes WHERE id=?', c.quote_id); emit(c.ws, 'contract.signed', { id: c.id, quote: q.ref, signed_by: name }, `Contract for ${q.ref} signed by ${name}`); res.json({ ok: true });
}));

/* ---------------- integrations ---------------- */
app.get('/api/w/:wid/integrations', W, (req, res) => { const rows = Object.fromEntries(qa('SELECT * FROM connections WHERE ws=?', req.w.id).map(r => [r.provider, connView(r)])); res.json({ base: BASE, credsUi: CREDS_UI, providers: prov.catalog().map(p => ({ ...p, redirect: p.auth === 'oauth2' ? prov.redirectUri(BASE, P[p.id]) : '', connection: rows[p.id] || null, credsSaved: p.app ? !!q1('SELECT 1 FROM app_creds WHERE app=?', p.app) : false })) }); });
const credApp = id => { if (!CREDS_UI) bad('Saving app credentials in the browser is turned off on this server', 403); if (!/^[A-Z_]+$/.test(id) || !Object.values(P).some(p => p.app === id)) bad('Unknown app', 404); return id; };
app.put('/api/w/:wid/app-credentials/:app', W, wrap((req, res) => { ownerOnly(req, 'save app credentials'); const a = credApp(req.params.app), id = String(req.body.client_id || '').trim(), secret = String(req.body.client_secret || '').trim(); if (!id || !secret) bad('Enter both the client ID and the client secret'); run('INSERT OR REPLACE INTO app_creds(app,data) VALUES(?,?)', a, enc({ id, secret })); audit(req.w.id, req.user.id, 'app.credentials.saved', a); res.json({ ok: true }); }));
app.delete('/api/w/:wid/app-credentials/:app', W, wrap((req, res) => { ownerOnly(req, 'remove app credentials'); run('DELETE FROM app_creds WHERE app=?', credApp(req.params.app)); audit(req.w.id, req.user.id, 'app.credentials.removed', req.params.app); res.json({ ok: true }); }));
const provOr404 = id => { const p = P[id]; if (!p || p.auth === 'builtin') bad('Unknown provider', 404); return p; };
async function saveConn(wid, p, cfg, ctx) { const label = await p.test(ctx); const ex = q1('SELECT id FROM connections WHERE ws=? AND provider=?', wid, p.id); const row = { id: ex ? ex.id : rid() }; if (ex) run("UPDATE connections SET status='connected',label=?,config=?,last_test=?,last_error=NULL WHERE id=?", String(label || p.name).slice(0, 120), enc(cfg), Date.now(), ex.id); else run("INSERT INTO connections(id,ws,provider,status,label,config,last_test,created) VALUES(?,?,?,'connected',?,?,?,?)", row.id, wid, p.id, String(label || p.name).slice(0, 120), enc(cfg), Date.now(), Date.now()); }
app.post('/api/w/:wid/integrations/:p/connect', W, wrap(async (req, res) => {
  req.need('integrations', 'connect integrations'); const p = provOr404(req.params.p); if (p.auth !== 'apikey') bad('This provider uses Sign in with ' + p.name);
  const cfg = { settings: {} }; for (const f of p.fields) { const v = String((req.body.fields || {})[f.key] || '').trim(); if (!v && !(f.key === 'region')) bad(`${f.label} is required`); cfg[f.key] = v; }
  try { await saveConn(req.w.id, p, cfg, { cfg, settings: {}, token: async () => '' }); } catch (e) { bad(`Could not verify these credentials: ${e.message}`); }
  audit(req.w.id, req.user.id, 'integration.connected', p.name); emit(req.w.id, 'integration.connected', { provider: p.id }, `${p.name} connected`); res.json({ ok: true });
}));
app.post('/api/w/:wid/integrations/:p/oauth-start', W, wrap((req, res) => {
  req.need('integrations', 'connect integrations'); const p = provOr404(req.params.p); if (p.auth !== 'oauth2') bad('This provider does not use sign-in');
  if (!prov.isConfigured(p)) bad(`The platform operator has not registered a ${p.name} app yet. Set ${p.app}_CLIENT_ID and ${p.app}_CLIENT_SECRET on the server.`, 409);
  const state = tok(), verifier = tok(), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  run('DELETE FROM oauth_states WHERE exp<?', Date.now()); run('INSERT INTO oauth_states(state,ws,user_id,provider,verifier,exp) VALUES(?,?,?,?,?,?)', sha(state), req.w.id, req.user.id, p.id, verifier, Date.now() + 6e5);
  res.json({ url: prov.authorizeUrl(p, { base: BASE, state, challenge }) });
}));
app.get('/oauth/callback/:p', wrap(async (req, res) => {
  const back0 = (wid, p, msg) => res.redirect(`/integration.html?p=${encodeURIComponent(p)}&ws=${encodeURIComponent(wid || '')}${msg ? '&error=' + encodeURIComponent(msg) : '&connected=1'}`);
  const p = P[req.params.p]; if (!p || p.auth !== 'oauth2') return res.redirect('/integrations.html');
  const st = q1('SELECT * FROM oauth_states WHERE state=? AND exp>?', sha(String(req.query.state || '')), Date.now()); let u = sessionUser(req);
  // The desktop app runs provider sign-in in the system browser, which has no app session. The 256-bit single-use state, bound to the user who started it, stands in for the cookie.
  const viaBrowser = !u && st; if (viaBrowser) u = { id: st.user_id };
  const back = (wid, pid, msg) => viaBrowser ? res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Revenue Rescue</title><body style="font:16px system-ui;max-width:520px;margin:15vh auto;padding:0 20px"><h2>${msg ? 'Could not connect' : 'Connected'}</h2><p>${msg ? String(msg).replace(/[&<>"']/g, '') : 'You can close this tab and return to Revenue Rescue.'}</p>`) : back0(wid, pid, msg);
  if (!st || !u || st.user_id !== u.id || st.provider !== p.id) return back(st && st.ws, p.id, 'The sign-in session expired or did not match. Please try again.');
  run('DELETE FROM oauth_states WHERE state=?', st.state);
  if (req.query.error) return back(st.ws, p.id, String(req.query.error_description || req.query.error).slice(0, 200));
  try {
    const t = await prov.tokenRequest(p, BASE, { grant_type: 'authorization_code', code: String(req.query.code || ''), code_verifier: p.oauth.pkce ? st.verifier : undefined });
    const cfg = { access_token: t.access_token || (t.authed_user && t.authed_user.access_token), refresh_token: t.refresh_token, expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : null, settings: {} };
    if (p.extra) Object.assign(cfg, await p.extra(t, req.query));
    if (!cfg.access_token) throw new Error('The provider did not return an access token');
    await saveConn(st.ws, p, cfg, { cfg, settings: {}, token: async () => cfg.access_token });
    audit(st.ws, u.id, 'integration.connected', p.name); emit(st.ws, 'integration.connected', { provider: p.id }, `${p.name} connected`); back(st.ws, p.id);
  } catch (e) { back(st.ws, p.id, e.message); }
}));
app.post('/api/w/:wid/integrations/:p/test', W, wrap(async (req, res) => {
  req.need('integrations', 'test integrations'); const p = provOr404(req.params.p), row = q1('SELECT * FROM connections WHERE ws=? AND provider=?', req.w.id, p.id); if (!row) bad('Not connected', 404);
  try { const label = await p.test(ctxFor(row)); run("UPDATE connections SET status='connected',last_test=?,last_error=NULL,label=? WHERE id=?", Date.now(), String(label || row.label).slice(0, 120), row.id); res.json({ ok: true, label }); }
  catch (e) { run("UPDATE connections SET status='error',last_test=?,last_error=? WHERE id=?", Date.now(), e.message, row.id); res.status(200).json({ ok: false, error: e.message }); }
}));
app.patch('/api/w/:wid/integrations/:p/settings', W, wrap((req, res) => {
  req.need('integrations', 'change integration settings'); const p = provOr404(req.params.p), row = q1('SELECT * FROM connections WHERE ws=? AND provider=?', req.w.id, p.id); if (!row) bad('Not connected', 404);
  const cfg = dec(row.config); cfg.settings = cfg.settings || {}; for (const s of p.settings) if (s.key in (req.body.settings || {})) cfg.settings[s.key] = String(req.body.settings[s.key]).slice(0, 300);
  run('UPDATE connections SET config=? WHERE id=?', enc(cfg), row.id); audit(req.w.id, req.user.id, 'integration.settings', p.name); res.json({ ok: true });
}));
app.delete('/api/w/:wid/integrations/:p', W, wrap((req, res) => { req.need('integrations', 'disconnect integrations'); run('DELETE FROM connections WHERE ws=? AND provider=?', req.w.id, req.params.p); audit(req.w.id, req.user.id, 'integration.disconnected', req.params.p); res.json({ ok: true }); }));

/* ---------------- developer: webhooks and API keys ---------------- */
app.get('/api/w/:wid/developer', W, (req, res) => res.json({ events: EVENTS, base: BASE,
  webhooks: qa('SELECT id,url,events,active,created FROM webhooks WHERE ws=?', req.w.id), keys: qa('SELECT id,label,prefix,created,last_used FROM apikeys WHERE ws=?', req.w.id),
  deliveries: qa('SELECT event,status,code,attempt,error,created,hook FROM deliveries WHERE ws=? ORDER BY created DESC LIMIT 30', req.w.id) }));
app.post('/api/w/:wid/webhooks', W, wrap(async (req, res) => {
  req.need('integrations', 'manage webhooks'); const url = String(req.body.url || '').trim(); try { await prov.assertPublicUrl(url); } catch (e) { bad(e.message); }
  const events = (req.body.events || []).filter(e => EVENTS.includes(e)), secret = 'whsec_' + tok(), id = rid();
  run('INSERT INTO webhooks(id,ws,url,secret,events,created) VALUES(?,?,?,?,?,?)', id, req.w.id, url, enc({ s: secret }), events.join(','), Date.now()); audit(req.w.id, req.user.id, 'webhook.created', url); res.json({ id, secret });
}));
app.post('/api/w/:wid/webhooks/:id/test', W, wrap(async (req, res) => { req.need('integrations', 'manage webhooks'); const h = q1('SELECT * FROM webhooks WHERE id=? AND ws=?', req.params.id, req.w.id); if (!h) bad('Not found', 404); res.json(await deliver(h, 'test.ping', JSON.stringify({ id: 'evt_' + rid(), event: 'test.ping', workspace: req.w.id, occurred_at: new Date().toISOString(), data: { hello: 'world' } }))); }));
app.delete('/api/w/:wid/webhooks/:id', W, wrap((req, res) => { req.need('integrations', 'manage webhooks'); run('DELETE FROM webhooks WHERE id=? AND ws=?', req.params.id, req.w.id); res.json({ ok: true }); }));
app.post('/api/w/:wid/apikeys', W, wrap((req, res) => { req.need('integrations', 'manage API keys'); const k = 'rr_live_' + tok(), id = rid(); run('INSERT INTO apikeys(id,ws,label,hash,prefix,created) VALUES(?,?,?,?,?,?)', id, req.w.id, String(req.body.label || 'API key').slice(0, 60), sha(k), k.slice(0, 12), Date.now()); audit(req.w.id, req.user.id, 'apikey.created', id); res.json({ id, key: k }); }));
app.delete('/api/w/:wid/apikeys/:id', W, wrap((req, res) => { req.need('integrations', 'manage API keys'); run('DELETE FROM apikeys WHERE id=? AND ws=?', req.params.id, req.w.id); res.json({ ok: true }); }));

/* public API (Bearer key), meant for Zapier, Make and your own scripts */
function keyAuth(req, res, next) {
  const m = /^Bearer (rr_live_\S+)$/.exec(req.get('authorization') || ''); if (!m) return res.status(401).json({ error: 'Send Authorization: Bearer <api key>' });
  const k = q1('SELECT * FROM apikeys WHERE hash=?', sha(m[1])); if (!k) return res.status(401).json({ error: 'Invalid API key' });
  if (!limit('k:' + k.id, 120, 6e4)) return res.status(429).json({ error: 'Rate limit: 120 requests per minute' });
  run('UPDATE apikeys SET last_used=? WHERE id=?', Date.now(), k.id); req.w = q1('SELECT * FROM workspaces WHERE id=?', k.ws); next();
}
app.get('/api/v1/quotes', keyAuth, (req, res) => res.json(qa('SELECT * FROM quotes WHERE ws=? ORDER BY quote_date', req.w.id).map(q => publicQuote(q, req.w))));
app.post('/api/v1/quotes', keyAuth, wrap((req, res) => { const q = insertQuote(req.w.id, req.body, null); emit(req.w.id, 'quote.created', publicQuote(q, req.w), `New quote ${q.ref} via API`); res.status(201).json(publicQuote(q, req.w)); }));
app.patch('/api/v1/quotes/:id', keyAuth, wrap((req, res) => {
  const q = q1('SELECT * FROM quotes WHERE (id=? OR ref=?) AND ws=?', req.params.id, req.params.id, req.w.id); if (!q) bad('Quote not found', 404);
  if (req.body.stage && !['open', 'replied', 'booked', 'won', 'lost'].includes(req.body.stage)) bad('API can set stage to open, replied, booked, won or lost. Sending is done in the app after approval.');
  const stage = req.body.stage ?? q.stage, revenue = stage === 'won' ? Math.max(0, +req.body.revenue || q.revenue || 0) : 0; run('UPDATE quotes SET stage=?,revenue=? WHERE id=?', stage, revenue, q.id);
  const u = publicQuote(q1('SELECT * FROM quotes WHERE id=?', q.id), req.w); emit(req.w.id, stage === 'won' && q.stage !== 'won' ? 'quote.won' : 'quote.updated', u, `Quote ${q.ref} updated via API`); res.json(u);
}));

/* ---------------- team and settings ---------------- */
app.get('/api/w/:wid/team', W, (req, res) => res.json({ me: req.user.id, members: qa('SELECT u.id,u.email,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.ws=?', req.w.id), perms: PERMS, matrix: Object.fromEntries(['estimator', 'viewer'].map(r => [r, qa('SELECT perm FROM perms WHERE ws=? AND role=? AND allowed=1', req.w.id, r).map(x => x.perm)])), invites: qa('SELECT email,role,exp FROM invites WHERE ws=? AND exp>?', req.w.id, Date.now()) }));
const ownerOnly = (req, what) => { if (req.role !== 'owner') bad(`Only an owner can ${what}`, 403); };
app.post('/api/w/:wid/invites', W, wrap((req, res) => { ownerOnly(req, 'invite people'); const email = String(req.body.email || '').toLowerCase(), role = req.body.role; if (!validEmail(email)) bad('Enter a valid email'); if (!['owner', 'estimator', 'viewer'].includes(role)) bad('Choose a role'); const t = tok(); run('INSERT OR REPLACE INTO invites(hash,ws,email,role,exp) VALUES(?,?,?,?,?)', sha(t), req.w.id, email, role, Date.now() + 7 * DAY); audit(req.w.id, req.user.id, 'invite.created', email); res.json({ link: `${BASE}/login.html?invite=${t}` }); }));
app.patch('/api/w/:wid/members/:uid', W, wrap((req, res) => { ownerOnly(req, 'change roles'); const role = req.body.role; if (!['owner', 'estimator', 'viewer'].includes(role)) bad('Choose a role'); if (req.params.uid === req.user.id && role !== 'owner' && q1("SELECT COUNT(*) n FROM members WHERE ws=? AND role='owner'", req.w.id).n < 2) bad('A workspace needs at least one owner'); run('UPDATE members SET role=? WHERE ws=? AND user_id=?', role, req.w.id, req.params.uid); audit(req.w.id, req.user.id, 'member.role', `${req.params.uid} → ${role}`); res.json({ ok: true }); }));
app.delete('/api/w/:wid/members/:uid', W, wrap((req, res) => { ownerOnly(req, 'remove people'); const t = q1('SELECT role FROM members WHERE ws=? AND user_id=?', req.w.id, req.params.uid); if (t && t.role === 'owner' && q1("SELECT COUNT(*) n FROM members WHERE ws=? AND role='owner'", req.w.id).n < 2) bad('A workspace needs at least one owner'); run('DELETE FROM members WHERE ws=? AND user_id=?', req.w.id, req.params.uid); run('UPDATE quotes SET assignee=NULL WHERE ws=? AND assignee=?', req.w.id, req.params.uid); res.json({ ok: true }); }));
app.put('/api/w/:wid/perms', W, wrap((req, res) => { ownerOnly(req, 'change permissions'); const { role, perm, allowed } = req.body; if (!['estimator', 'viewer'].includes(role) || !PERMS.includes(perm)) bad('Invalid permission'); run('INSERT OR REPLACE INTO perms(ws,role,perm,allowed) VALUES(?,?,?,?)', req.w.id, role, perm, allowed ? 1 : 0); audit(req.w.id, req.user.id, 'perm.changed', `${role}.${perm}=${!!allowed}`); res.json({ ok: true }); }));
app.get('/api/w/:wid/settings', W, (req, res) => res.json({ name: req.w.name, color: req.w.color, review_days: req.w.review_days, recontact_days: req.w.recontact_days, high_amount: req.w.high_amount, audit: qa('SELECT a.action,a.detail,a.created,u.email FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.ws=? ORDER BY a.id DESC LIMIT 100', req.w.id) }));
app.patch('/api/w/:wid/settings', W, wrap((req, res) => { ownerOnly(req, 'change settings'); const b = req.body, n = String(b.name || req.w.name).trim().slice(0, 80) || req.w.name, rd = Math.max(0, +b.review_days || 0), cd = Math.max(0, +b.recontact_days || 0), ha = Math.max(0, +b.high_amount || 0); run('UPDATE workspaces SET name=?,color=?,review_days=?,recontact_days=?,high_amount=? WHERE id=?', n, ['teal', 'blue', 'amber', 'pink'].includes(b.color) ? b.color : req.w.color, rd, cd, ha, req.w.id); audit(req.w.id, req.user.id, 'settings.changed', n); res.json({ ok: true }); }));

/* ---------------- replies, opt-outs, calls ---------------- */
const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;
function ingestInbound(wid, m) {
  if (q1("SELECT 1 FROM messages WHERE ws=? AND provider_id=? AND direction='in'", wid, m.sid)) return false;
  const phone = normPhone(m.from); if (!phone) return false;
  const q = q1('SELECT * FROM quotes WHERE ws=? AND phone=? ORDER BY created DESC', wid, phone); if (!q) return false; // texts from unknown numbers are not stored
  run("INSERT INTO messages(id,ws,quote_id,channel,to_addr,body,status,provider,provider_id,created,sent_at,direction,is_read) VALUES(?,?,?,?,?,?,'received','twilio',?,?,?,'in',0)", rid(), wid, q.id, 'sms', phone, String(m.body || '').slice(0, 1600), m.sid, Date.now(), m.date ? Date.parse(m.date) || Date.now() : Date.now());
  if (OPT_OUT.test(m.body || '')) { run("UPDATE quotes SET opted_out=1,eligible=0 WHERE id=?", q.id); audit(wid, null, 'quote.opted_out', `${q.ref} replied STOP`); emit(wid, 'quote.opted_out', { quote: q.ref }, `${q.name} (${q.ref}) opted out by text`); }
  else if (q.stage === 'sent') run("UPDATE quotes SET stage='replied' WHERE id=?", q.id);
  emit(wid, 'message.received', { quote: q.ref, channel: 'sms' }, `Reply from ${q.name} (${q.ref})`); return true;
}
async function pollTwilio(wid) {
  const conn = findConn(wid, ['twilio']); if (!conn) return 0; let n = 0;
  const since = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
  for (const m of await conn.p.actions.listInbound(ctxFor(conn.row), { sinceDay: since })) if (ingestInbound(wid, m)) n++;
  return n;
}
app.post('/hooks/twilio/:wid', express.urlencoded({ extended: false }), wrap((req, res) => {
  const conn = findConn(req.params.wid, ['twilio']); if (!conn) return res.status(404).end();
  const url = `${BASE}/hooks/twilio/${req.params.wid}`, data = Object.keys(req.body).sort().reduce((a, k) => a + k + req.body[k], url);
  const expect = crypto.createHmac('sha1', ctxFor(conn.row).cfg.auth_token).update(data).digest('base64'), got = String(req.get('x-twilio-signature') || '');
  if (expect.length !== got.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(got))) return res.status(403).end();
  ingestInbound(req.params.wid, { sid: req.body.MessageSid, from: req.body.From, body: req.body.Body }); res.type('text/xml').send('<Response/>');
}));
app.get('/api/w/:wid/inbox', W, (req, res) => {
  const t = {}, add = (q, at, last, dir, unread) => { const k = q.quote_id; t[k] = t[k] || { quote_id: k, name: q.name, ref: q.ref, phone: q.phone, opted_out: !!q.opted_out, at: 0, last: '', dir: '', unread: 0 }; if (at >= t[k].at) { t[k].at = at; t[k].last = last; t[k].dir = dir; } t[k].unread += unread ? 1 : 0; };
  for (const m of qa("SELECT m.*,q.name,q.ref,q.phone,q.opted_out FROM messages m JOIN quotes q ON q.id=m.quote_id WHERE m.ws=? AND m.status IN ('sent','received')", req.w.id)) add(m, m.sent_at || m.created, m.body, m.direction, m.direction === 'in' && !m.is_read);
  for (const c of qa('SELECT c.*,q.name,q.ref,q.phone,q.opted_out FROM calls c JOIN quotes q ON q.id=c.quote_id WHERE c.ws=?', req.w.id)) add(c, c.created, `Call (${c.status})`, 'out', false);
  res.json(Object.values(t).sort((a, b) => b.at - a.at));
});
app.get('/api/w/:wid/threads/:qid', W, wrap((req, res) => {
  const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', req.params.qid, req.w.id); if (!q) bad('Not found', 404);
  const items = [...qa("SELECT id,direction,channel,body,status,error,COALESCE(sent_at,created) at FROM messages WHERE quote_id=? AND status IN ('sent','received')", q.id).map(m => ({ kind: 'msg', ...m })), ...qa('SELECT id,status,duration,notes,outcome,created at FROM calls WHERE quote_id=?', q.id).map(c => ({ kind: 'call', ...c }))].sort((a, b) => a.at - b.at);
  run("UPDATE messages SET is_read=1 WHERE quote_id=? AND direction='in'", q.id); res.json({ quote: publicQuote(q, req.w), items });
}));
async function refreshCalls(wid) {
  const conn = findConn(wid, ['twilio']); if (!conn) return 0; let n = 0;
  for (const c of qa("SELECT * FROM calls WHERE ws=? AND sid IS NOT NULL AND status IN ('queued','initiated','ringing','in-progress') AND created>?", wid, Date.now() - DAY)) { try { const r = await conn.p.actions.callStatus(ctxFor(conn.row), { sid: c.sid }); run('UPDATE calls SET status=?,duration=? WHERE id=?', r.status, r.duration, c.id); n++; } catch (e) { /* try again next tick */ } }
  return n;
}
app.post('/api/w/:wid/sync', W, wrap(async (req, res) => { const out = {}; try { out.replies = await pollTwilio(req.w.id); } catch (e) { out.error = 'Twilio: ' + e.message; } out.calls = await refreshCalls(req.w.id); out.contracts = await syncContracts(req.w.id); res.json(out); }));
app.get('/api/w/:wid/calls', W, (req, res) => res.json(qa('SELECT c.*,q.name,q.ref FROM calls c JOIN quotes q ON q.id=c.quote_id WHERE c.ws=? ORDER BY c.created DESC LIMIT 100', req.w.id)));
app.post('/api/w/:wid/calls', W, wrap(async (req, res) => {
  req.need('call', 'place calls'); const q = q1('SELECT * FROM quotes WHERE id=? AND ws=?', req.body.quote_id, req.w.id); if (!q) bad('Quote not found', 404);
  if (q.opted_out) bad('This customer opted out'); if (!q.eligible) bad('This customer is not marked as eligible to contact'); if (!q.phone) bad('This customer has no phone number');
  const conn = findConn(req.w.id, ['twilio']); if (!conn) bad('Connect Twilio on the Integrations page to place calls', 409);
  const ctx = ctxFor(conn.row), agent = normPhone(req.body.agent_phone || ctx.settings.agent_phone); if (!agent) bad('Enter the number we should ring you on first');
  let r; try { r = await conn.p.actions.call(ctx, { agent, customer: q.phone, name: q.name }); } catch (e) { bad('Twilio error: ' + e.message, 502); }
  const id = rid(); run("INSERT INTO calls(id,ws,quote_id,user_id,sid,status,created) VALUES(?,?,?,?,?,'initiated',?)", id, req.w.id, q.id, req.user.id, r.id, Date.now()); audit(req.w.id, req.user.id, 'call.started', q.ref); emit(req.w.id, 'call.started', { quote: q.ref }, `Call started to ${q.name}`); res.json({ id });
}));
app.patch('/api/w/:wid/calls/:id', W, wrap((req, res) => { req.need('call', 'log calls'); run('UPDATE calls SET notes=?,outcome=? WHERE id=? AND ws=?', String(req.body.notes || '').slice(0, 1000), String(req.body.outcome || '').slice(0, 40), req.params.id, req.w.id); res.json({ ok: true }); }));

/* ---------------- follow-up plan (drafts only, never auto-sends) ---------------- */
const PLAN_BODY = { 3: 'Hi {name}, this is {company}. I wanted to check in on the estimate we sent. Do you have any questions, or is there anything you would like adjusted? No rush.', 7: 'Hi {name}, {company} here. In case it helps, I am happy to walk through the estimate or adjust anything. Just let me know.', 14: 'Hi {name}, following up on your estimate from {company}. If your plans have changed, no problem at all. Just let me know.', 30: 'Hi {name}, if you would still like to go ahead with the work, just reply and we will pick it up. No pressure either way. {company}' };
const DEFAULT_PLAN = [3, 7, 14, 30].map(d => ({ day: d, channel: 'auto', subject: d === 3 ? 'Checking in on your estimate' : d === 7 ? 'Still thinking it over?' : d === 14 ? 'Any questions on your estimate?' : 'Closing the loop', body: PLAN_BODY[d] }));
const getPlan = w => { try { return w.plan ? JSON.parse(w.plan) : DEFAULT_PLAN; } catch (e) { return DEFAULT_PLAN; } };
const fillVars = (t, q, w) => String(t).replace(/\{name\}/g, q.name).replace(/\{company\}/g, w.name).replace(/\{days\}/g, daysOpen(q));
function runPlan(w, dry) {
  const steps = getPlan(w), skipped = { done: 0, pending: 0, reply: 0, notDue: 0, noAddress: 0 }, due = []; let created = 0;
  for (const q of qa("SELECT * FROM quotes WHERE ws=? AND stage IN ('open','sent') AND eligible=1 AND opted_out=0", w.id)) {
    const sent = qa("SELECT sent_at FROM messages WHERE quote_id=? AND direction='out' AND status='sent' ORDER BY sent_at DESC", q.id), n = sent.length;
    if (n >= steps.length) { skipped.done++; continue; }
    if (q1("SELECT 1 FROM messages WHERE quote_id=? AND direction='out' AND status IN ('draft','approved')", q.id)) { skipped.pending++; continue; }
    const lastIn = q1("SELECT MAX(created) t FROM messages WHERE quote_id=? AND direction='in'", q.id).t; if (lastIn && (!sent[0] || lastIn > sent[0].sent_at)) { skipped.reply++; continue; }
    const st = steps[n], gap = sent[0] ? (Date.now() - sent[0].sent_at) / DAY : 99; if (daysOpen(q) < st.day || gap < 2) { skipped.notDue++; continue; }
    let ch = st.channel === 'sms' || st.channel === 'email' ? st.channel : (q.channel === 'text' ? 'sms' : 'email'); if (ch === 'sms' && !q.phone) ch = q.email ? 'email' : null; if (ch === 'email' && !q.email) ch = q.phone ? 'sms' : null;
    if (!ch) { skipped.noAddress++; continue; }
    due.push({ quote: q.ref, name: q.name, step: n + 1, channel: ch });
    if (!dry) { run("INSERT INTO messages(id,ws,quote_id,channel,to_addr,subject,body,status,created_by,created,direction) VALUES(?,?,?,?,?,?,?,'draft','plan',?,'out')", rid(), w.id, q.id, ch, ch === 'sms' ? q.phone : q.email, fillVars(st.subject || '', q, w).slice(0, 150), fillVars(st.body, q, w).slice(0, 1500), Date.now()); created++; }
  }
  if (!dry && created) { audit(w.id, null, 'plan.drafts', `${created} drafts created`); emit(w.id, 'message.drafted', { count: created }, `${created} follow-up drafts are waiting for approval`); }
  if (!dry) run('UPDATE workspaces SET plan_last=? WHERE id=?', Date.now(), w.id);
  return { created, due, skipped };
}
app.get('/api/w/:wid/plan', W, (req, res) => res.json({ on: !!req.w.plan_on, steps: getPlan(req.w), last: req.w.plan_last }));
app.put('/api/w/:wid/plan', W, wrap((req, res) => {
  ownerOnly(req, 'change the follow-up plan'); const steps = req.body.steps; if (!Array.isArray(steps) || !steps.length || steps.length > 8) bad('Use between 1 and 8 steps');
  let prev = -1; const clean = steps.map(s => { const day = Math.floor(+s.day); if (!(day >= 0 && day <= 365) || day <= prev) bad('Each step needs a later day than the one before'); prev = day; const body = String(s.body || '').trim(); if (!body || body.length > 1500) bad('Each step needs a message under 1500 characters'); return { day, channel: ['sms', 'email'].includes(s.channel) ? s.channel : 'auto', subject: String(s.subject || '').slice(0, 150), body }; });
  run('UPDATE workspaces SET plan=?,plan_on=? WHERE id=?', JSON.stringify(clean), req.body.on ? 1 : 0, req.w.id); audit(req.w.id, req.user.id, 'plan.saved', `${clean.length} steps, ${req.body.on ? 'on' : 'off'}`); res.json({ ok: true });
}));
app.post('/api/w/:wid/plan/run', W, wrap((req, res) => { req.need('draft', 'create drafts'); res.json(runPlan(req.w, !!req.body.dry)); }));

/* ---------------- contract status sync ---------------- */
async function syncContracts(wid) {
  let n = 0;
  for (const c of qa("SELECT * FROM contracts WHERE ws=? AND status='sent' AND mode IN ('docusign','dropbox_sign') AND provider_id IS NOT NULL", wid)) {
    const conn = findConn(wid, [c.mode]); if (!conn) continue;
    try {
      const st = await conn.p.actions.status(ctxFor(conn.row), { id: c.provider_id });
      if (st === 'signed') { run("UPDATE contracts SET status='signed',signed_by=?,signed_at=? WHERE id=?", `Signed through ${conn.p.name}`, Date.now(), c.id); const q = q1('SELECT ref FROM quotes WHERE id=?', c.quote_id); audit(wid, null, 'contract.signed', `${c.id} via ${conn.p.name}`); emit(wid, 'contract.signed', { id: c.id, quote: q.ref, provider: c.mode }, `Contract for ${q.ref} signed through ${conn.p.name}`); n++; }
      else if (st === 'declined') { run("UPDATE contracts SET status='declined' WHERE id=?", c.id); n++; }
    } catch (e) { /* try again next tick */ }
  }
  return n;
}

/* ---------------- accounts: password, recovery codes, overview ---------------- */
function newRecovery(uid) { run('DELETE FROM recovery WHERE user_id=?', uid); return Array.from({ length: 8 }, () => { const c = crypto.randomBytes(4).toString('hex') + '-' + crypto.randomBytes(4).toString('hex'); run('INSERT INTO recovery(hash,user_id) VALUES(?,?)', sha(c), uid); return c; }); }
app.post('/api/auth/reset', wrap((req, res) => {
  const email = String(req.body.email || '').toLowerCase(), code = String(req.body.code || '').trim().toLowerCase(), pw = String(req.body.password || '');
  if (!limit('rs:' + req.ip, 8, 9e5)) bad('Too many attempts. Wait 15 minutes.', 429); if (pw.length < 10) bad('Use a password of at least 10 characters');
  const u = q1('SELECT * FROM users WHERE email=?', email), r = u && q1('SELECT * FROM recovery WHERE hash=? AND user_id=? AND used=0', sha(code), u.id);
  if (!u || !r) bad('That email and recovery code do not match', 401);
  run('UPDATE recovery SET used=1 WHERE hash=?', r.hash); run('UPDATE users SET pw=? WHERE id=?', hashPw(pw), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); audit(null, u.id, 'password.reset', u.email); res.json({ ok: true });
}));
app.get('/api/account', auth, (req, res) => res.json({ email: req.user.email, name: req.user.name, recoveryLeft: q1('SELECT COUNT(*) n FROM recovery WHERE user_id=? AND used=0', req.user.id).n }));
const reauth = (req) => { const u = q1('SELECT pw FROM users WHERE id=?', req.user.id); if (!checkPw(String(req.body.current || ''), u.pw)) bad('Your current password is incorrect', 401); };
app.post('/api/account/password', auth, wrap((req, res) => { reauth(req); const n = String(req.body.next || ''); if (n.length < 10) bad('Use a password of at least 10 characters'); run('UPDATE users SET pw=? WHERE id=?', hashPw(n), req.user.id); const keep = sha(cookies(req).rr_sid || ''); run('DELETE FROM sessions WHERE user_id=? AND hash!=?', req.user.id, keep); res.json({ ok: true }); }));
app.post('/api/account/recovery', auth, wrap((req, res) => { reauth(req); res.json({ codes: newRecovery(req.user.id) }); }));
app.get('/api/overview', auth, (req, res) => res.json(wsList(req.user.id).map(w => { const qs = qa('SELECT * FROM quotes WHERE ws=?', w.id).map(q => publicQuote(q, q1('SELECT * FROM workspaces WHERE id=?', w.id))); return { id: w.id, name: w.name, color: w.color, role: w.role, open: qs.filter(q => ['open', 'sent'].includes(q.stage)).reduce((t, q) => t + q.amount, 0), high: qs.filter(q => q.lane === 'high').length, sent: qs.filter(q => ['sent', 'replied', 'booked', 'won'].includes(q.stage)).length, won: qs.filter(q => q.stage === 'won').length, revenue: qs.reduce((t, q) => t + (q.revenue || 0), 0) }; })));

/* ---------------- background workers ---------------- */
let workersOn = false;
function startWorkers() {
  if (workersOn) return; workersOn = true; let lastSlow = 0, lastContracts = 0;
  setInterval(() => { runOutbox().catch(e => console.error('outbox', e.message)); }, 10000).unref();
  setInterval(async () => {
    const now = Date.now(); if (now - lastSlow < 55000) return; lastSlow = now;
    for (const w of qa('SELECT * FROM workspaces')) {
      try { await pollTwilio(w.id); await refreshCalls(w.id); if (now - lastContracts > 5 * 60000) await syncContracts(w.id); if (w.plan_on && (!w.plan_last || now - w.plan_last > 20 * 36e5)) runPlan(w); } catch (e) { console.error('worker', w.id, e.message); }
    }
    if (now - lastContracts > 5 * 60000) lastContracts = now;
  }, 60000).unref();
}

/* ---------------- static pages and errors ---------------- */
app.get('/', (req, res) => res.redirect('/dashboard.html'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err); res.status(500).json({ error: 'Something went wrong on the server' });
});

if (require.main === module) app.listen(PORT, () => { console.log(`Revenue Rescue running at ${BASE}`); startWorkers(); });
module.exports = { app, db, BASE, startWorkers, tick: { pollTwilio, syncContracts, refreshCalls, runPlan, runOutbox } };
