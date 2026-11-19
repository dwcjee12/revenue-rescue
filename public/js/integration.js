const { $, esc, when, guard, on, toast, copy } = RR;
const qs = new URLSearchParams(location.search); let C, p, pid = qs.get('p'), credsUi = false, desktop = false;
async function load() { const r0 = await C.wapi('/integrations'); credsUi = r0.credsUi; C.baseUrl = r0.base; C.baseIsPublic = /^https:\/\//.test(r0.base); const all = r0.providers; p = all.find(x => x.id === pid); if (!p) { $('#content').innerHTML = '<p class="notice">Unknown integration.</p>'; return; } draw(); }
function draw() {
  const k = p.connection, own = C.can('integrations'); $('title').textContent = p.name + ' · Revenue Rescue'; document.querySelector('h1').textContent = p.name; $('#sub').textContent = p.category;
  $('#actions').innerHTML = '<a class="btn" href="/integrations.html">All integrations</a>';
  let h = qs.get('error') ? `<p class="notice" style="margin-bottom:12px;border-color:var(--bad)" role="alert">${esc(qs.get('error'))}</p>` : qs.get('connected') ? '<p class="notice" style="margin-bottom:12px;border-color:var(--ok)">Connected.</p>' : '';
  if (p.auth === 'builtin') { $('#content').innerHTML = h + `<div class="card"><p>${esc(p.note)}</p><div class="row"><a class="btn p" href="${esc(p.href)}">Open</a></div></div>`; return; }
  h += `<div class="card"><h2>Connection</h2>`;
  if (k) {
    h += `<p><span class="bd ${k.status === 'connected' ? 'ok' : 'bad'}">${k.status === 'connected' ? 'Connected' : 'Needs attention'}</span> ${esc(k.label || '')}</p><p class="small mut">Last checked ${esc(when(k.last_test))}${k.last_error ? ` · <span style="color:var(--bad)">${esc(k.last_error)}</span>` : ''}</p>
    <div class="row"><button id="test" class="sm">Test connection</button>${p.auth === 'oauth2' ? '<button id="re" class="sm">Reconnect</button>' : ''}<button id="off" class="sm danger"${own ? '' : ' disabled'}>Disconnect</button></div>`;
  } else if (p.auth === 'oauth2') {
    h += p.configured ? `<p>You will be sent to ${esc(p.name)} to sign in and approve access. We never see your password.</p><div class="row"><button class="p" id="go"${own ? '' : ' disabled'}>Sign in with ${esc(p.name)}</button></div>`
      : `<p class="notice">This server doesn't have a ${esc(p.name)} app registered yet, so sign-in can't start. Whoever runs the server registers one once, and then every workspace can connect its own account.</p>`;
  } else {
    h += `<p class="small mut">Credentials are verified with ${esc(p.name)} first, then stored encrypted. They are never shown again.</p>${p.fields.map(f => `<label for="f_${f.key}">${esc(f.label)}</label><input id="f_${f.key}" data-k="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" placeholder="${esc(f.placeholder)}">`).join('')}<div class="row"><button class="p" id="conn"${own ? '' : ' disabled'}>Verify and connect</button></div>`;
  }
  h += `${p.note ? `<p class="small" style="margin-top:12px">${esc(p.note)}</p>` : ''}</div>`;
  if (k && p.settings.length) h += `<div class="card"><h2>Settings</h2>${p.settings.map(s => `<label for="s_${s.key}">${esc(s.label)}</label><input id="s_${s.key}" data-s="${s.key}" value="${esc(k.settings[s.key] || '')}" placeholder="${esc(s.placeholder || '')}">${s.help ? `<p class="small mut">${esc(s.help)}</p>` : ''}`).join('')}<div class="row"><button id="ss" class="p"${own ? '' : ' disabled'}>Save settings</button></div></div>`;
  if (p.auth === 'oauth2' && credsUi) h += `<div class="card"><h2>Your ${esc(p.name)} app</h2><p class="small mut">${desktop ? 'This app runs on your computer, so you use your own free developer app with each provider.' : 'Saved for the whole server.'} Credentials are stored encrypted and never shown again.</p><p class="small">1. Create an app in the ${esc(p.name)} developer console${p.docs ? ` (<a href="${esc(p.docs)}" target="_blank" rel="noopener">open console</a>)` : ''}.</p><p class="small">2. Register this redirect URI exactly:</p><div class="copy"><pre>${esc(p.redirect)}</pre><button class="sm" id="cr">Copy</button></div><p class="small">3. Request these scopes: <b>${esc(p.scopes.join(', ') || 'default')}</b></p><label for="cid">Client ID</label><input id="cid" autocomplete="off"><label for="csec">Client secret</label><input id="csec" type="password" autocomplete="off"><div class="row"><button class="p" id="csave"${own ? '' : ' disabled'}>Save app credentials</button>${p.credsSaved ? '<button id="cdel" class="danger">Remove saved credentials</button>' : ''}</div>${p.credsSaved ? '<p class="small mut">Credentials are saved for this app.</p>' : ''}</div>`;
  else if (p.auth === 'oauth2') h += `<div class="card"><h2>Operator setup</h2><p class="small mut">Done once on the server, not by each customer.</p><p class="small">1. Create an app in the ${esc(p.name)} developer console${p.docs ? ` (<a href="${esc(p.docs)}" target="_blank" rel="noopener">open console</a>)` : ''}.</p><p class="small">2. Set this redirect URI:</p><div class="copy"><pre>${esc(p.redirect)}</pre><button class="sm" id="cr">Copy</button></div><p class="small">3. Request these scopes: <b>${esc(p.scopes.join(', ') || 'default')}</b></p><p class="small">4. Put the keys in the server environment, then restart:</p><pre>${esc(p.app)}_CLIENT_ID=...\n${esc(p.app)}_CLIENT_SECRET=...</pre></div>`;
  else if (p.docs) h += `<div class="card"><p class="small">Find your credentials in the <a href="${esc(p.docs)}" target="_blank" rel="noopener">${esc(p.name)} dashboard</a>.</p></div>`;
  if (k && p.id === 'twilio') h += `<div class="card"><h2>Replies and calls</h2><p class="small">Replies are fetched automatically about once a minute while the app is open, and when you press <b>Check for replies</b> in the Inbox. STOP replies mark the customer as opted out.</p>${C.baseIsPublic ? `<p class="small">For instant replies, set this as your Twilio number's incoming message webhook:</p><div class="copy"><pre>${esc(C.baseUrl + '/hooks/twilio/' + C.ws)}</pre></div>` : ''}</div>`;
  if (p.actions.length) h += `<div class="card"><h2>What Revenue Rescue can do with it</h2><p class="small">${esc(p.actions.join(', '))}</p></div>`;
  $('#content').innerHTML = h;
}
RR.boot('integrations').then(guard(async c => {
  C = c; try { desktop = !!window.RR_DESKTOP || (await RR.api('/api/info')).desktop; } catch (e) {} await load(); const root = $('#content');
  const go = guard(async () => {
    const r = await C.wapi(`/integrations/${pid}/oauth-start`, { method: 'POST', body: {} });
    if (!desktop) { location.href = r.url; return; }
    window.open(r.url, '_blank'); toast('Finish signing in in your browser. This page updates when you are connected.', 'ok');
    for (let i = 0; i < 90; i++) { await new Promise(r => setTimeout(r, 2000)); const x = (await C.wapi('/integrations')).providers.find(q => q.id === pid); if (x.connection && x.connection.status === 'connected') { await load(); toast('Connected', 'ok'); return; } }
  });
  on(root, 'click', '#go', go); on(root, 'click', '#re', go);
  on(root, 'click', '#conn', guard(async () => { const fields = {}; $('#content').querySelectorAll('[data-k]').forEach(i => fields[i.dataset.k] = i.value); await C.wapi(`/integrations/${pid}/connect`, { method: 'POST', body: { fields } }); toast('Connected', 'ok'); await load(); }));
  on(root, 'click', '#test', guard(async () => { const r = await C.wapi(`/integrations/${pid}/test`, { method: 'POST', body: {} }); toast(r.ok ? 'Connection works' : 'Failed: ' + r.error, r.ok ? 'ok' : 'err'); await load(); }));
  on(root, 'click', '#off', guard(async () => { if (!confirm('Disconnect ' + p.name + ' from this workspace?')) return; await C.wapi(`/integrations/${pid}`, { method: 'DELETE' }); await load(); }));
  on(root, 'click', '#ss', guard(async () => { const settings = {}; root.querySelectorAll('[data-s]').forEach(i => settings[i.dataset.s] = i.value); await C.wapi(`/integrations/${pid}/settings`, { method: 'PATCH', body: { settings } }); toast('Saved', 'ok'); await load(); }));
  on(root, 'click', '#cr', () => copy(p.redirect));
  on(root, 'click', '#csave', guard(async () => { await C.wapi(`/app-credentials/${p.app}`, { method: 'PUT', body: { client_id: $('#cid').value, client_secret: $('#csec').value } }); toast('Saved', 'ok'); await load(); }));
  on(root, 'click', '#cdel', guard(async () => { await C.wapi(`/app-credentials/${p.app}`, { method: 'DELETE' }); await load(); }));
}));
