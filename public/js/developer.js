const { $, esc, when, guard, on, toast, copy } = RR;
let C, D, secret = '';
async function load() { D = await C.wapi('/developer'); draw(); }
function draw() {
  const own = C.can('integrations');
  $('#content').innerHTML = `${secret ? `<div class="notice" style="margin-bottom:16px"><b>Copy this now. It will not be shown again.</b><div class="copy"><pre>${esc(secret)}</pre><button class="sm" id="cs">Copy</button></div></div>` : ''}
  <div class="grid"><div class="card"><h2>Outbound webhooks</h2><p class="small mut">Works with Zapier (Catch Hook), Make (Custom webhook) or your own server. Each request is signed.</p>
  <label for="u">Endpoint URL (https)</label><input id="u" placeholder="https://hooks.zapier.com/hooks/catch/..."><label>Events (none selected = all)</label><div class="seg" id="ev">${D.events.map(e => `<button type="button" class="sm" aria-pressed="false" data-e="${e}">${e}</button>`).join('')}</div><div class="row"><button class="p" id="addh"${own ? '' : ' disabled'}>Add webhook</button></div>
  ${D.webhooks.map(h => `<div class="card" style="margin-top:12px;background:var(--bg)"><div style="overflow-wrap:anywhere"><b>${esc(h.url)}</b></div><p class="small mut">${esc(h.events || 'all events')}</p><div class="row"><button class="sm" data-t="${h.id}">Send test</button><button class="sm danger" data-d="${h.id}"${own ? '' : ' disabled'}>Remove</button></div></div>`).join('')}</div>
  <div class="card"><h2>API keys</h2><p class="small mut">For Zapier or Make actions, scripts and other systems that push quotes in. A key has full access to this workspace, so keep it secret.</p><div class="row"><div class="grow"><label for="kl">Label</label><input id="kl" placeholder="Zapier"></div><button class="p" id="addk"${own ? '' : ' disabled'}>Create key</button></div>
  <div class="tw"><table><tr><th>Label</th><th>Key</th><th>Last used</th><th></th></tr>${D.keys.map(k => `<tr><td>${esc(k.label)}</td><td><code>${esc(k.prefix)}…</code></td><td>${esc(when(k.last_used) || 'never')}</td><td><button class="sm danger" data-k="${k.id}"${own ? '' : ' disabled'}>Revoke</button></td></tr>`).join('') || '<tr><td colspan="4" class="mut">No keys.</td></tr>'}</table></div>
  <h3 style="margin-top:14px">Examples</h3><pre>curl ${esc(D.base)}/api/v1/quotes \\\n  -H "Authorization: Bearer rr_live_..."\n\ncurl -X POST ${esc(D.base)}/api/v1/quotes \\\n  -H "Authorization: Bearer rr_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Alex","amount":6400,"quote_date":"2026-11-10","email":"alex@example.com","eligible":true}'</pre></div></div>
  <div class="card"><h2>Verify signatures</h2><pre>// header: X-RR-Signature: t=1700000000,v1=hexdigest\nconst [t, v1] = header.split(',').map(p => p.split('=')[1]);\nconst expected = crypto.createHmac('sha256', SECRET).update(t + '.' + rawBody).digest('hex');\nconst ok = crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected)) &&\n  Math.abs(Date.now()/1000 - +t) < 300;</pre><p class="small mut">Failed deliveries are retried twice. Retries happen in memory, so a server restart can drop them.</p></div>
  <div class="card"><h2>Recent deliveries</h2><div class="tw"><table><tr><th>When</th><th>Event</th><th>Result</th><th>Attempt</th></tr>${D.deliveries.map(d => `<tr><td>${esc(when(d.created))}</td><td>${esc(d.event)}</td><td><span class="bd ${d.status === 'ok' ? 'ok' : 'bad'}">${d.status === 'ok' ? d.code : esc(d.error)}</span></td><td>${d.attempt}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">None yet.</td></tr>'}</table></div></div>`;
}
RR.boot('developer').then(guard(async c => {
  C = c; await load(); const root = $('#content');
  on(root, 'click', '#ev button', t => t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'));
  on(root, 'click', '#addh', guard(async () => { const events = [...root.querySelectorAll('#ev [aria-pressed=true]')].map(b => b.dataset.e); const r = await C.wapi('/webhooks', { method: 'POST', body: { url: $('#u').value, events } }); secret = 'Signing secret: ' + r.secret; await load(); }));
  on(root, 'click', '[data-t]', guard(async t => { const r = await C.wapi(`/webhooks/${t.dataset.t}/test`, { method: 'POST', body: {} }); toast(r.ok ? 'Test delivered (HTTP ' + r.code + ')' : 'Failed: ' + r.error, r.ok ? 'ok' : 'err'); await load(); }));
  on(root, 'click', '[data-d]', guard(async t => { await C.wapi('/webhooks/' + t.dataset.d, { method: 'DELETE' }); await load(); }));
  on(root, 'click', '#addk', guard(async () => { const r = await C.wapi('/apikeys', { method: 'POST', body: { label: $('#kl').value } }); secret = r.key; await load(); }));
  on(root, 'click', '[data-k]', guard(async t => { await C.wapi('/apikeys/' + t.dataset.k, { method: 'DELETE' }); await load(); }));
  on(root, 'click', '#cs', () => copy(secret.replace(/^Signing secret: /, '')));
}));
