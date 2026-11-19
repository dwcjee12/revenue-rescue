'use strict';
/*
 * Provider registry. Every integration is declared here: how it authenticates, what the
 * connect form asks for, how a connection is tested, and which actions it can perform.
 * OAuth providers need an app registered by the platform operator (CLIENT_ID / CLIENT_SECRET
 * in the environment). API-key providers collect credentials from each workspace.
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const MOCK = process.env.PROVIDER_MOCK || ''; // test hook: route every provider host to a local mock
const rw = url => { if (!MOCK) return url; const u = new URL(url); return `${MOCK}/${u.host}${u.pathname}${u.search}`; };

async function http(url, opts = {}) {
  const r = await fetch(rw(url), { ...opts, signal: AbortSignal.timeout(15000) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  if (!r.ok) {
    const detail = j && (j.message || j.error_description || (typeof j.error === 'string' ? j.error : j.error && j.error.message));
    const e = new Error(`${new URL(url).host} responded ${r.status}${detail ? ': ' + String(detail).slice(0, 200) : ''}`);
    e.status = r.status; throw e;
  }
  return j === null ? t : j;
}
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null));
const jsonReq = (method, token, body, extra = {}) => ({ method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
const get = (token, extra = {}) => ({ headers: { Authorization: `Bearer ${token}`, ...extra } });

/* Refuse to call private network addresses (SSRF guard for user-supplied URLs). */
async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && !(process.env.ALLOW_PRIVATE_URLS === '1' && u.protocol === 'http:')) throw new Error('URL must use https');
  if (process.env.ALLOW_PRIVATE_URLS === '1') return u;
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(address)) throw new Error('URL points to a private address');
  }
  return u;
}

const P = {};
const add = p => { P[p.id] = Object.assign({ settings: [], actions: {}, fields: [], note: '' }, p); };
const DS = process.env.DOCUSIGN_ENV === 'prod' ? 'https://account.docusign.com' : 'https://account-d.docusign.com';
const QB = process.env.QUICKBOOKS_ENV === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
const SF = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

/* ---------- Calendars ---------- */
add({
  id: 'google_calendar', name: 'Google Calendar', category: 'Calendar', auth: 'oauth2', app: 'GOOGLE',
  oauth: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scopes: ['https://www.googleapis.com/auth/calendar.events'], params: { access_type: 'offline', prompt: 'consent' }, pkce: true },
  docs: 'https://console.cloud.google.com/apis/credentials',
  async test(c) { const j = await http('https://www.googleapis.com/calendar/v3/calendars/primary', get(await c.token())); return j.id || j.summary; },
  actions: {
    async createEvent(c, { summary, description, start, end }) {
      const j = await http('https://www.googleapis.com/calendar/v3/calendars/primary/events', jsonReq('POST', await c.token(), { summary, description, start: { dateTime: start }, end: { dateTime: end } }));
      return { id: j.id, url: j.htmlLink };
    }
  }
});
add({
  id: 'outlook_calendar', name: 'Outlook Calendar', category: 'Calendar', auth: 'oauth2', app: 'MICROSOFT',
  oauth: { auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: ['offline_access', 'User.Read', 'Calendars.ReadWrite'], pkce: true },
  docs: 'https://entra.microsoft.com',
  async test(c) { const j = await http('https://graph.microsoft.com/v1.0/me', get(await c.token())); return j.userPrincipalName || j.displayName; },
  actions: {
    async createEvent(c, { summary, description, start, end }) {
      const j = await http('https://graph.microsoft.com/v1.0/me/events', jsonReq('POST', await c.token(), { subject: summary, body: { contentType: 'text', content: description || '' }, start: { dateTime: start.replace(/Z$/, ''), timeZone: 'UTC' }, end: { dateTime: end.replace(/Z$/, ''), timeZone: 'UTC' } }));
      return { id: j.id, url: j.webLink };
    }
  }
});

/* ---------- Spreadsheets ---------- */
add({
  id: 'google_sheets', name: 'Google Sheets', category: 'Spreadsheets', auth: 'oauth2', app: 'GOOGLE',
  oauth: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/spreadsheets'], params: { access_type: 'offline', prompt: 'consent' }, pkce: true },
  settings: [{ key: 'spreadsheet_id', label: 'Spreadsheet ID', help: 'The long ID in the sheet URL. Share the sheet with the connected Google account.' }, { key: 'range', label: 'Tab and start cell', placeholder: 'QUOTES_IN!A1' }],
  docs: 'https://console.cloud.google.com/apis/credentials',
  async test(c) { const j = await http('https://openidconnect.googleapis.com/v1/userinfo', get(await c.token())); return j.email; },
  actions: {
    async appendRows(c, { rows }) {
      const s = c.settings; if (!s.spreadsheet_id) throw new Error('Set a spreadsheet ID in the connection settings first');
      const range = encodeURIComponent(s.range || 'Sheet1!A1');
      const j = await http(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(s.spreadsheet_id)}/values/${range}:append?valueInputOption=RAW`, jsonReq('POST', await c.token(), { values: rows }));
      return { updated: j.updates && j.updates.updatedRows };
    }
  }
});

/* ---------- Phone, email, e-signature ---------- */
add({
  id: 'twilio', name: 'Twilio SMS', category: 'Phone and SMS', auth: 'apikey',
  fields: [{ key: 'account_sid', label: 'Account SID' }, { key: 'auth_token', label: 'Auth token', secret: true }, { key: 'from', label: 'Sending number (E.164)', placeholder: '+15555550100' }],
  settings: [{ key: 'agent_phone', label: 'Your phone number (rung first for click-to-call)', placeholder: '+15555550123' }],
  docs: 'https://console.twilio.com',
  note: 'Texts are sent only after an approver approves them, only to customers marked eligible, and always end with an opt-out line.',
  async test(c) { const j = await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.cfg.account_sid)}.json`, { headers: { Authorization: basic(c.cfg.account_sid, c.cfg.auth_token) } }); return j.friendly_name || c.cfg.account_sid; },
  actions: {
    async sms(c, { to, body }) {
      const j = await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.cfg.account_sid)}/Messages.json`, { method: 'POST', headers: { Authorization: basic(c.cfg.account_sid, c.cfg.auth_token) }, body: form({ To: to, From: c.cfg.from, Body: body }) });
      return { id: j.sid };
    },
    async listInbound(c, { sinceDay }) {
      const q = new URLSearchParams({ To: c.cfg.from, PageSize: '100' }); if (sinceDay) q.set('DateSent>', sinceDay);
      const j = await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.cfg.account_sid)}/Messages.json?${q}`, { headers: { Authorization: basic(c.cfg.account_sid, c.cfg.auth_token) } });
      return (j.messages || []).filter(m => m.direction === 'inbound').map(m => ({ sid: m.sid, from: m.from, body: m.body, date: m.date_sent }));
    },
    // Rings the agent first, then bridges to the customer. No recording is requested.
    async call(c, { agent, customer, name }) {
      const x = s => String(s).replace(/[<>&"']/g, '');
      const twiml = `<Response><Say>Connecting you to ${x(name)}.</Say><Dial callerId="${x(c.cfg.from)}" timeout="25">${x(customer)}</Dial></Response>`;
      const j = await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.cfg.account_sid)}/Calls.json`, { method: 'POST', headers: { Authorization: basic(c.cfg.account_sid, c.cfg.auth_token) }, body: form({ To: agent, From: c.cfg.from, Twiml: twiml }) });
      return { id: j.sid };
    },
    async callStatus(c, { sid }) {
      const j = await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.cfg.account_sid)}/Calls/${encodeURIComponent(sid)}.json`, { headers: { Authorization: basic(c.cfg.account_sid, c.cfg.auth_token) } });
      return { status: j.status, duration: +j.duration || 0 };
    }
  }
});
add({
  id: 'resend', name: 'Resend', category: 'Email', auth: 'apikey',
  fields: [{ key: 'api_key', label: 'API key', secret: true }, { key: 'from', label: 'From address', placeholder: 'Northline Heating <quotes@yourdomain.com>' }],
  docs: 'https://resend.com/api-keys',
  async test(c) { await http('https://api.resend.com/domains', get(c.cfg.api_key)); return c.cfg.from; },
  actions: { async email(c, { to, subject, text }) { const j = await http('https://api.resend.com/emails', jsonReq('POST', c.cfg.api_key, { from: c.cfg.from, to: [to], subject, text })); return { id: j.id }; } }
});
add({
  id: 'mailgun', name: 'Mailgun', category: 'Email', auth: 'apikey',
  fields: [{ key: 'api_key', label: 'Private API key', secret: true }, { key: 'domain', label: 'Sending domain', placeholder: 'mg.yourdomain.com' }, { key: 'from', label: 'From address' }, { key: 'region', label: 'Region (us or eu)', placeholder: 'us' }],
  docs: 'https://app.mailgun.com',
  async test(c) { const h = c.cfg.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'; const j = await http(`https://${h}/v3/domains/${encodeURIComponent(c.cfg.domain)}`, { headers: { Authorization: basic('api', c.cfg.api_key) } }); return j.domain && j.domain.name || c.cfg.domain; },
  actions: { async email(c, { to, subject, text }) { const h = c.cfg.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'; const j = await http(`https://${h}/v3/${encodeURIComponent(c.cfg.domain)}/messages`, { method: 'POST', headers: { Authorization: basic('api', c.cfg.api_key) }, body: form({ from: c.cfg.from, to, subject, text }) }); return { id: j.id }; } }
});
add({
  id: 'mailchimp', name: 'Mailchimp', category: 'Email', auth: 'apikey',
  fields: [{ key: 'api_key', label: 'API key (ends with -us1, -us2, ...)', secret: true }, { key: 'list_id', label: 'Audience ID' }],
  docs: 'https://admin.mailchimp.com/account/api/',
  note: 'Contacts are added as pending, so Mailchimp sends its own confirmation email before they can receive newsletters.',
  async test(c) { const dc = String(c.cfg.api_key).split('-')[1]; if (!dc) throw new Error('API key must end with a data center such as -us1'); await http(`https://${dc}.api.mailchimp.com/3.0/ping`, { headers: { Authorization: basic('rr', c.cfg.api_key) } }); return c.cfg.list_id; },
  actions: { async addContact(c, { email, name }) { const dc = String(c.cfg.api_key).split('-')[1]; const h = crypto.createHash('md5').update(String(email).toLowerCase()).digest('hex'); const j = await http(`https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(c.cfg.list_id)}/members/${h}`, { method: 'PUT', headers: { Authorization: basic('rr', c.cfg.api_key), 'Content-Type': 'application/json' }, body: JSON.stringify({ email_address: email, status_if_new: 'pending', merge_fields: { FNAME: name } }) }); return { id: j.id }; } }
});
add({
  id: 'docusign', name: 'DocuSign', category: 'E-signature', auth: 'oauth2', app: 'DOCUSIGN',
  oauth: { auth: `${DS}/oauth/auth`, token: `${DS}/oauth/token`, scopes: ['signature'], clientAuth: 'basic' },
  docs: 'https://admindemo.docusign.com',
  async extra(tok) { const u = await http(`${DS}/oauth/userinfo`, get(tok.access_token)); const a = (u.accounts || []).find(x => x.is_default) || (u.accounts || [])[0]; if (!a) throw new Error('No DocuSign account found'); return { account_id: a.account_id, base_uri: a.base_uri, label: u.email }; },
  async test(c) { await c.token(); return c.cfg.label || c.cfg.account_id; },
  actions: {
    async sendEnvelope(c, { subject, text, name, email }) {
      const j = await http(`${c.cfg.base_uri}/restapi/v2.1/accounts/${c.cfg.account_id}/envelopes`, jsonReq('POST', await c.token(), {
        emailSubject: subject, status: 'sent',
        documents: [{ documentBase64: Buffer.from(text + '\n\nSignature: /sn1/\n').toString('base64'), name: 'Agreement', fileExtension: 'txt', documentId: '1' }],
        recipients: { signers: [{ email, name, recipientId: '1', routingOrder: '1', tabs: { signHereTabs: [{ anchorString: '/sn1/', anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '0' }] } }] }
      }));
      return { id: j.envelopeId };
    },
    async status(c, { id }) {
      const j = await http(`${c.cfg.base_uri}/restapi/v2.1/accounts/${c.cfg.account_id}/envelopes/${encodeURIComponent(id)}`, get(await c.token()));
      return j.status === 'completed' ? 'signed' : ['declined', 'voided'].includes(j.status) ? 'declined' : 'pending';
    }
  }
});
add({
  id: 'dropbox_sign', name: 'Dropbox Sign', category: 'E-signature', auth: 'apikey',
  fields: [{ key: 'api_key', label: 'API key', secret: true }],
  settings: [{ key: 'test_mode', label: 'Test mode (1 = test, 0 = live)', placeholder: '1' }],
  docs: 'https://app.hellosign.com/home/myAccount#api',
  async test(c) { const j = await http('https://api.hellosign.com/v3/account', { headers: { Authorization: basic(c.cfg.api_key, '') } }); return j.account && j.account.email_address; },
  actions: {
    async sendEnvelope(c, { subject, text, name, email }) {
      const fd = new FormData();
      fd.append('title', subject); fd.append('subject', subject);
      fd.append('signers[0][email_address]', email); fd.append('signers[0][name]', name);
      fd.append('files[0]', new Blob([text], { type: 'text/plain' }), 'agreement.txt');
      fd.append('test_mode', c.settings.test_mode === '0' ? '0' : '1');
      const j = await http('https://api.hellosign.com/v3/signature_request/send', { method: 'POST', headers: { Authorization: basic(c.cfg.api_key, '') }, body: fd });
      return { id: j.signature_request && j.signature_request.signature_request_id };
    },
    async status(c, { id }) {
      const j = await http(`https://api.hellosign.com/v3/signature_request/${encodeURIComponent(id)}`, { headers: { Authorization: basic(c.cfg.api_key, '') } });
      const r = j.signature_request || {}; return r.is_complete ? 'signed' : r.is_declined ? 'declined' : 'pending';
    }
  }
});

/* ---------- Team chat ---------- */
add({
  id: 'slack', name: 'Slack', category: 'Messaging', auth: 'oauth2', app: 'SLACK',
  oauth: { auth: 'https://slack.com/oauth/v2/authorize', token: 'https://slack.com/api/oauth.v2.access', scopes: ['chat:write', 'channels:read'], scopeSep: ',' },
  settings: [{ key: 'channel', label: 'Channel ID', help: 'Invite the Revenue Rescue app to the channel first.' }, { key: 'notify', label: 'Events to post (comma separated)', placeholder: 'message.sent,contract.signed,quote.won' }],
  docs: 'https://api.slack.com/apps',
  extra: tok => ({ label: tok.team && tok.team.name }),
  async test(c) { const j = await http('https://slack.com/api/auth.test', jsonReq('POST', await c.token(), {})); if (!j.ok) throw new Error(j.error); return `${j.team} (${j.user})`; },
  actions: { async notify(c, { text }) { if (!c.settings.channel) throw new Error('Set a channel ID in the connection settings'); const j = await http('https://slack.com/api/chat.postMessage', jsonReq('POST', await c.token(), { channel: c.settings.channel, text })); if (!j.ok) throw new Error(j.error); return { id: j.ts }; } }
});
add({
  id: 'teams', name: 'Microsoft Teams', category: 'Messaging', auth: 'apikey',
  fields: [{ key: 'webhook_url', label: 'Incoming webhook or Workflows URL', secret: true }],
  settings: [{ key: 'notify', label: 'Events to post (comma separated)', placeholder: 'message.sent,contract.signed,quote.won' }],
  docs: 'https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
  async test(c) { await assertPublicUrl(c.cfg.webhook_url); await http(c.cfg.webhook_url, jsonReq('POST', null, { text: 'Revenue Rescue connection test' })); return 'Test message posted'; },
  actions: { async notify(c, { text }) { await assertPublicUrl(c.cfg.webhook_url); await http(c.cfg.webhook_url, jsonReq('POST', null, { text })); return {}; } }
});

/* ---------- CRM, accounting, field service, payments ---------- */
add({
  id: 'hubspot', name: 'HubSpot', category: 'CRM', auth: 'oauth2', app: 'HUBSPOT',
  oauth: { auth: 'https://app.hubspot.com/oauth/authorize', token: 'https://api.hubapi.com/oauth/v1/token', scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] },
  docs: 'https://developers.hubspot.com/',
  async test(c) { const j = await http('https://api.hubapi.com/account-info/v3/details', get(await c.token())); return `Portal ${j.portalId}`; },
  actions: { async upsertContact(c, { email, name, phone }) { const j = await http('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', jsonReq('POST', await c.token(), { inputs: [{ idProperty: 'email', id: email, properties: { email, firstname: name, phone: phone || '' } }] })); return { id: j.results && j.results[0] && j.results[0].id }; } }
});
add({
  id: 'salesforce', name: 'Salesforce', category: 'CRM', auth: 'oauth2', app: 'SALESFORCE',
  oauth: { auth: `${SF}/services/oauth2/authorize`, token: `${SF}/services/oauth2/token`, scopes: ['api', 'refresh_token'] },
  docs: 'https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm',
  extra: tok => ({ instance_url: tok.instance_url, label: tok.instance_url }),
  async test(c) { await http(`${c.cfg.instance_url}/services/data/`, get(await c.token())); return c.cfg.instance_url; },
  actions: { async createLead(c, { name, email, phone, company }) { const j = await http(`${c.cfg.instance_url}/services/data/v59.0/sobjects/Lead`, jsonReq('POST', await c.token(), { LastName: name, Company: company || 'Customer', Email: email, Phone: phone })); return { id: j.id }; } }
});
add({
  id: 'quickbooks', name: 'QuickBooks Online', category: 'Accounting', auth: 'oauth2', app: 'QUICKBOOKS',
  oauth: { auth: 'https://appcenter.intuit.com/connect/oauth2', token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', scopes: ['com.intuit.quickbooks.accounting'], clientAuth: 'basic' },
  docs: 'https://developer.intuit.com/app/developer/dashboard',
  extra: (tok, q) => ({ realm: q.realmId, label: `Company ${q.realmId}` }),
  async test(c) { const j = await http(`${QB}/v3/company/${c.cfg.realm}/companyinfo/${c.cfg.realm}?minorversion=70`, get(await c.token(), { Accept: 'application/json' })); return j.CompanyInfo && j.CompanyInfo.CompanyName; },
  actions: { async createCustomer(c, { name, email, phone }) { const j = await http(`${QB}/v3/company/${c.cfg.realm}/customer?minorversion=70`, jsonReq('POST', await c.token(), { GivenName: name, DisplayName: `${name} - ${email || phone || Date.now()}`, ...(email ? { PrimaryEmailAddr: { Address: email } } : {}), ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}) }, { Accept: 'application/json' })); return { id: j.Customer && j.Customer.Id }; } }
});
add({
  id: 'jobber', name: 'Jobber', category: 'Field service', auth: 'oauth2', app: 'JOBBER',
  oauth: { auth: 'https://api.getjobber.com/api/oauth/authorize', token: 'https://api.getjobber.com/api/oauth/token', scopes: [] },
  docs: 'https://developer.getjobber.com/',
  async test(c) { const j = await http('https://api.getjobber.com/api/graphql', jsonReq('POST', await c.token(), { query: '{ account { name } }' }, { 'X-JOBBER-GRAPHQL-VERSION': process.env.JOBBER_API_VERSION || '2023-11-15' })); return j.data && j.data.account && j.data.account.name; },
  actions: {
    async createCustomer(c, { name, email, phone }) {
      const input = { firstName: name, lastName: '', ...(email ? { emails: [{ description: 'MAIN', primary: true, address: email }] } : {}), ...(phone ? { phones: [{ description: 'MAIN', primary: true, number: phone }] } : {}) };
      const j = await http('https://api.getjobber.com/api/graphql', jsonReq('POST', await c.token(), { query: 'mutation($input: ClientCreateInput!){ clientCreate(input:$input){ client{ id } userErrors{ message } } }', variables: { input } }, { 'X-JOBBER-GRAPHQL-VERSION': process.env.JOBBER_API_VERSION || '2023-11-15' }));
      const r = j.data && j.data.clientCreate; if (!r || (r.userErrors || []).length) throw new Error((r && r.userErrors[0] && r.userErrors[0].message) || 'Jobber rejected the client'); return { id: r.client.id };
    }
  }
});
add({
  id: 'servicetitan', name: 'ServiceTitan', category: 'Field service', auth: 'apikey',
  fields: [{ key: 'tenant_id', label: 'Tenant ID' }, { key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client secret', secret: true }, { key: 'app_key', label: 'App key', secret: true }],
  docs: 'https://developer.servicetitan.io/',
  async test(c) {
    const t = await http('https://auth.servicetitan.io/connect/token', { method: 'POST', body: form({ grant_type: 'client_credentials', client_id: c.cfg.client_id, client_secret: c.cfg.client_secret }) });
    await http(`https://api.servicetitan.io/crm/v2/tenant/${encodeURIComponent(c.cfg.tenant_id)}/customers?pageSize=1`, get(t.access_token, { 'ST-App-Key': c.cfg.app_key })); return `Tenant ${c.cfg.tenant_id}`;
  }
});
add({
  id: 'housecall_pro', name: 'Housecall Pro', category: 'Field service', auth: 'apikey',
  fields: [{ key: 'api_key', label: 'API key', secret: true }],
  docs: 'https://help.housecallpro.com/',
  async test(c) { const j = await http('https://api.housecallpro.com/company', { headers: { Authorization: `Token ${c.cfg.api_key}`, Accept: 'application/json' } }); return j.name || 'Connected'; },
  actions: { async createCustomer(c, { name, email, phone }) { const j = await http('https://api.housecallpro.com/customers', { method: 'POST', headers: { Authorization: `Token ${c.cfg.api_key}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ first_name: name, ...(email ? { email } : {}), ...(phone ? { mobile_number: phone } : {}) }) }); return { id: j.id }; } }
});
add({
  id: 'stripe', name: 'Stripe', category: 'Payments', auth: 'apikey',
  fields: [{ key: 'api_key', label: 'Restricted API key (read only recommended)', secret: true }],
  docs: 'https://dashboard.stripe.com/apikeys',
  note: 'Connect-only for now: used to verify an account. Never paste a full-access secret key.',
  async test(c) { const j = await http('https://api.stripe.com/v1/account', get(c.cfg.api_key)); return j.business_profile && j.business_profile.name || j.id; }
});

/* ---------- Built in ---------- */
add({ id: 'webhooks', name: 'Webhooks, Zapier and Make', category: 'Automation', auth: 'builtin', href: '/developer.html', note: 'Signed outbound webhooks for any event, plus an API key based inbound API. Paste a Zapier Catch Hook or Make webhook URL on the Developer page.' });
add({ id: 'files', name: 'CSV, Excel and JSON', category: 'Files', auth: 'builtin', href: '/pipeline.html', note: 'Import with a column mapper and export from the Pipeline page.' });

/* ---------- OAuth helpers ---------- */
let credLookup = () => null; // lets the server supply OAuth app credentials saved in its database
const setCredLookup = f => { credLookup = f; };
const envOf = p => credLookup(p.app) || ({ id: process.env[`${p.app}_CLIENT_ID`], secret: process.env[`${p.app}_CLIENT_SECRET`] });
const isConfigured = p => p.auth !== 'oauth2' || !!(envOf(p).id && envOf(p).secret);
const redirectUri = (base, p) => `${base}/oauth/callback/${p.id}`;

function authorizeUrl(p, { base, state, challenge }) {
  const o = p.oauth, q = new URLSearchParams({ response_type: 'code', client_id: envOf(p).id, redirect_uri: redirectUri(base, p), state });
  if (o.scopes.length) q.set('scope', o.scopes.join(o.scopeSep || ' '));
  Object.entries(o.params || {}).forEach(([k, v]) => q.set(k, v));
  if (o.pkce && challenge) { q.set('code_challenge', challenge); q.set('code_challenge_method', 'S256'); }
  return `${o.auth}?${q}`;
}
async function tokenRequest(p, base, params) {
  const e = envOf(p), o = p.oauth, headers = {}, body = { ...params };
  if (o.clientAuth === 'basic') headers.Authorization = basic(e.id, e.secret); else { body.client_id = e.id; body.client_secret = e.secret; }
  if (params.grant_type === 'authorization_code') body.redirect_uri = redirectUri(base, p);
  const t = await http(o.token, { method: 'POST', headers: { ...headers, Accept: 'application/json' }, body: form(body) });
  if (t.ok === false) throw new Error(t.error || 'Token exchange failed');
  return t;
}

const catalog = () => Object.values(P).map(p => ({ id: p.id, name: p.name, category: p.category, auth: p.auth, fields: p.fields.map(f => ({ key: f.key, label: f.label, secret: !!f.secret, placeholder: f.placeholder || '' })), settings: p.settings, actions: Object.keys(p.actions), note: p.note, docs: p.docs || '', href: p.href || '', configured: isConfigured(p), app: p.app || '', scopes: p.oauth ? p.oauth.scopes : [] }));

module.exports = { setCredLookup, P, http, assertPublicUrl, authorizeUrl, tokenRequest, isConfigured, redirectUri, envOf, catalog };
