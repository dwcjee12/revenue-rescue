const { $, esc, guard, on } = RR;
let P = [], cat = 'All', term = '';
function draw() {
  const cats = ['All', ...new Set(P.map(p => p.category))], list = P.filter(p => (cat === 'All' || p.category === cat) && p.name.toLowerCase().includes(term));
  const badge = p => p.auth === 'builtin' ? '<span class="bd ok">Built in</span>' : p.connection ? (p.connection.status === 'connected' ? '<span class="bd ok">Connected</span>' : '<span class="bd bad">Needs attention</span>') : p.auth === 'oauth2' && !p.configured ? '<span class="bd warn">Setup needed</span>' : '<span class="bd">Not connected</span>';
  const rec = P.filter(p => ['twilio', 'resend', 'google_calendar', 'google_sheets'].includes(p.id) && !p.connection);
  $('#content').innerHTML = `${rec.length ? `<div class="card" style="margin-bottom:16px"><h2>Start here</h2><p class="small mut">The fastest way to get value: connect a way to reach customers, then a calendar or sheet.</p><div class="row">${rec.map(p => `<a class="btn p" href="/integration.html?p=${p.id}">Connect ${esc(p.name)}</a>`).join('')}</div></div>` : ''}<div class="row" style="margin:0 0 14px"><div class="grow"><label for="s" class="small" style="margin:0 0 4px">Search</label><input id="s" value="${esc(term)}" placeholder="Search integrations"></div></div><div class="seg" role="group" aria-label="Category" style="margin-bottom:16px">${cats.map(c => `<button type="button" data-c="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}</button>`).join('')}</div>
  <div class="cgrid">${list.map(p => `<a class="card conn" href="${p.href || '/integration.html?p=' + p.id}"><div class="nm"><span>${esc(p.name)}</span>${badge(p)}</div><div class="small mut">${esc(p.category)} · ${p.auth === 'oauth2' ? 'Sign in with ' + esc(p.name) : p.auth === 'apikey' ? 'Credentials' : 'No account needed'}</div>${p.connection ? `<div class="small">${esc(p.connection.label || '')}</div>` : ''}</a>`).join('') || '<p class="mut">Nothing matches.</p>'}</div>`;
}
RR.boot('integrations').then(guard(async c => {
  P = (await c.wapi('/integrations')).providers; draw();
  $('#sub').textContent = `${P.filter(p => p.connection && p.connection.status === 'connected').length} connected · ${P.length} available. Each workspace connects its own accounts.`;
  on($('#content'), 'click', '[data-c]', t => { cat = t.dataset.c; draw(); });
  $('#content').addEventListener('input', e => { if (e.target.id === 's') { term = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const s = $('#s'); s.focus(); s.setSelectionRange(pos, pos); } });
}));
