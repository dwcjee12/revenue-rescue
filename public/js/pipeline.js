const { $, $$, esc, money, guard, on, toast, save } = RR;
let C, Q = [], team = [], sel = null, imp = null, pushTo = [];
const PUSHN = { hubspot: 'HubSpot', salesforce: 'Salesforce lead', mailchimp: 'Mailchimp', quickbooks: 'QuickBooks customer', jobber: 'Jobber client', housecall_pro: 'Housecall Pro customer' };
const LANES = [['high', 'High priority', 'var(--hi)'], ['medium', 'Medium priority', 'var(--med)'], ['low', 'Low priority', 'var(--blue)'], ['sent', 'Approved and sent', 'var(--teal)']];
const FIELDS = [['ref', 'Quote ID', ['id', 'number', '#', 'estimate', 'quote']], ['name', 'Customer first name', ['first', 'client', 'customer', 'name']], ['email', 'Email', ['email', 'e-mail']], ['phone', 'Phone', ['phone', 'mobile', 'cell']], ['amount', 'Quote amount', ['amount', 'total', 'value', 'price']], ['date', 'Quote date', ['date', 'sent', 'created', 'issued']], ['stage', 'Quote status', ['status', 'stage', 'state']], ['eligible', 'Eligible to contact', ['eligib', 'ok to contact', 'consent', 'permission']], ['channel', 'Preferred channel', ['channel', 'prefer', 'method']], ['note', 'Notes', ['note', 'comment', 'memo']]];
async function load() { let ints; [Q, team, ints] = await Promise.all([C.wapi('/quotes'), C.wapi('/team').then(t => t.members), C.wapi('/integrations')]); pushTo = ints.providers.filter(p => p.connection && PUSHN[p.id]).map(p => p.id); draw(); }
function draw() {
  const ro = !C.can('move');
  $('#content').innerHTML = `${ro ? '<p class="notice" style="margin-bottom:12px">Your role is read-only here.</p>' : ''}<div class="lanes">${LANES.map(l => { const a = Q.filter(q => q.lane === l[0]); return `<div class="lane"><h3><span><span class="dot" style="background:${l[2]}"></span>${l[1]}</span><span class="mut small">${a.length} · ${money(a.reduce((t, q) => t + q.amount, 0))}</span></h3>${a.map(q => `<button class="qc" type="button" data-id="${q.id}"${sel === q.id ? ' style="border-color:var(--blue)"' : ''}><b><span>${esc(q.name)}</span><span>${money(q.amount)}</span></b><small>${esc(q.ref)} · ${q.days} days${q.opted_out ? ' · opted out' : q.eligible ? '' : ' · not eligible'}</small></button>`).join('') || '<p class="mut small">None</p>'}</div>`; }).join('')}</div>
  <div class="card" id="detail"></div>
  <div class="grid"><div class="card"><h2>Add a quote</h2><div class="row"><div class="grow"><label for="a1">First name</label><input id="a1"></div><div class="grow"><label for="a2">Amount (CAD)</label><input id="a2" type="number" min="0"></div><div class="grow"><label for="a3">Quote date</label><input id="a3" type="date"></div></div><div class="row"><div class="grow"><label for="a4">Email</label><input id="a4" type="email"></div><div class="grow"><label for="a5">Mobile</label><input id="a5" type="tel"></div><div class="grow"><label for="a6">Prefers</label><select id="a6"><option value="email">Email</option><option value="text">Text</option></select></div></div>
  <label style="display:flex;gap:8px;font-weight:400"><input type="checkbox" id="a7"> This customer has agreed to be contacted about this quote</label><div class="row"><button class="p" id="addq"${ro ? ' disabled' : ''}>Add quote</button></div></div>
  <div class="card"><h2>Import and export</h2><p class="small mut">CSV or Excel from any system. Map the columns, review, then load.</p><div class="row"><input type="file" id="file" accept=".csv,.xlsx,.xls" aria-label="Choose a file"><button id="samp" type="button">Use sample CSV</button></div><div id="map"></div>
  <div class="row"><a class="btn" href="/api/w/${C.ws}/quotes/export.csv">Download CSV</a><a class="btn" href="/api/w/${C.ws}/quotes/export.json">Download JSON</a><button id="sheets" type="button">Append to Google Sheets</button></div></div></div>`;
  drawDetail(); drawMap();
}
function drawDetail() {
  const q = Q.find(x => x.id === sel), el = $('#detail'); if (!q) { el.innerHTML = '<p class="mut">Select a quote to manage it.</p>'; return; }
  const ro = !C.can('move');
  el.innerHTML = `<h2>${esc(q.name)} · ${money(q.amount)} <span class="bd">${esc(q.ref)}</span></h2><p class="small mut">${q.days} days open · prefers ${q.channel} · ${esc(q.email || 'no email')} · ${esc(q.phone || 'no phone')}</p>
  <div class="row"><div><label for="d1">Stage</label><select id="d1"${ro ? ' disabled' : ''}>${['open', 'sent', 'replied', 'booked', 'won', 'lost'].map(s => `<option${q.stage === s ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
  <div><label for="d2">Assigned to</label><select id="d2"${C.can('assign') ? '' : ' disabled'}><option value="">Unassigned</option>${team.filter(m => m.role !== 'viewer').map(m => `<option value="${m.id}"${q.assignee === m.id ? ' selected' : ''}>${esc(m.name || m.email)}</option>`).join('')}</select></div>
  ${q.stage === 'won' ? `<div><label for="d3">Revenue (CAD)</label><input id="d3" type="number" min="0" value="${q.revenue || ''}"></div>` : ''}
  <label style="display:flex;gap:8px;font-weight:400;align-self:end"><input type="checkbox" id="d4"${q.eligible ? ' checked' : ''}${ro ? ' disabled' : ''}> Eligible to contact</label></div>
  <div class="row"><button class="p sm" id="dsave"${ro ? ' disabled' : ''}>Save</button><input type="datetime-local" id="d5" style="width:auto" aria-label="Follow-up time"><button class="sm" id="dcal">Add follow-up to calendar</button>${pushTo.map(id => `<button class="sm" data-push="${id}">Send to ${PUSHN[id]}</button>`).join('')}<a class="btn sm" href="/inbox.html?q=${q.id}">Open conversation</a><button class="sm danger" id="ddel"${ro ? ' disabled' : ''}>Delete</button></div>`;
}
function drawMap() {
  const el = $('#map'); if (!imp) { el.innerHTML = ''; return; }
  const v = (r, f) => { const i = imp.map[f]; return i === '' || i == null ? '' : (r[i] || '').toString().trim(); };
  el.innerHTML = `<p class="small" style="margin-top:10px">${imp.rows.length} rows read. Check the matches.</p><div class="row">${FIELDS.map(f => `<div class="grow"><label for="m_${f[0]}">${f[1]}</label><select id="m_${f[0]}" data-f="${f[0]}"><option value="">Not in my file</option>${imp.h.map((h, i) => `<option value="${i}"${imp.map[f[0]] === i ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div>
  <div class="tw"><table><tr>${FIELDS.map(f => `<th>${f[1]}</th>`).join('')}</tr>${imp.rows.slice(0, 5).map(r => `<tr>${FIELDS.map(f => `<td>${esc(v(r, f[0]))}</td>`).join('')}</tr>`).join('')}</table></div>
  ${imp.map.eligible === '' ? '<label style="display:flex;gap:8px;font-weight:400"><input type="checkbox" id="conf"> I confirm every customer in this file has agreed to be contacted.</label>' : ''}<div class="row"><button class="p" id="load">Load into this workspace</button></div><p class="small mut" id="res" role="status"></p>`;
}
function setImport(h, rows) {
  h = h.map(x => String(x == null ? '' : x).trim()); const used = new Set(), map = {};
  FIELDS.forEach(f => { let found = ''; for (const k of f[2]) { const i = h.findIndex((x, j) => !used.has(j) && x.toLowerCase().includes(k)); if (i >= 0) { found = i; used.add(i); break; } } map[f[0]] = found; });
  imp = { h, rows, map }; drawMap();
}
function parseCSV(t) { const rows = []; let r = [], c = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; if (r.some(x => x.trim())) rows.push(r); r = []; } else c += ch; } r.push(c); if (r.some(x => x.trim())) rows.push(r); return rows; }
const dAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
RR.boot('pipeline').then(async c => {
  C = c; await load();
  const root = $('#content');
  on(root, 'click', '.qc', t => { sel = t.dataset.id; draw(); });
  on(root, 'click', '#addq', guard(async () => { await C.wapi('/quotes', { method: 'POST', body: { name: $('#a1').value, amount: $('#a2').value, quote_date: $('#a3').value, email: $('#a4').value, phone: $('#a5').value, channel: $('#a6').value, eligible: $('#a7').checked } }); toast('Quote added', 'ok'); await load(); }));
  on(root, 'click', '#dsave', guard(async () => { const b = { stage: $('#d1').value, eligible: $('#d4').checked }; if (C.can('assign')) b.assignee = $('#d2').value || null; if ($('#d3')) b.revenue = $('#d3').value; await C.wapi('/quotes/' + sel, { method: 'PATCH', body: b }); toast('Saved', 'ok'); await load(); }));
  on(root, 'click', '#ddel', guard(async () => { await C.wapi('/quotes/' + sel, { method: 'DELETE' }); sel = null; await load(); }));
  on(root, 'click', '#dcal', guard(async () => { const r = await C.wapi('/quotes/' + sel + '/schedule', { method: 'POST', body: { start: $('#d5').value } }); toast('Event created' + (r.url ? '' : ''), 'ok'); }));
  on(root, 'click', '[data-push]', guard(async t => { await C.wapi('/quotes/' + sel + '/push', { method: 'POST', body: { provider: t.dataset.push } }); toast('Sent to ' + t.dataset.push, 'ok'); }));
  on(root, 'click', '#sheets', guard(async () => { const r = await C.wapi('/sheets/append', { method: 'POST', body: {} }); toast(`Appended ${r.rows} rows`, 'ok'); }));
  on(root, 'change', '#map select[data-f]', t => { imp.map[t.dataset.f] = t.value === '' ? '' : +t.value; drawMap(); });
  on(root, 'click', '#samp', () => { const t = ['Estimate #,Client,Email,Mobile,Total,Sent On,Stage,OK to contact,Method,Comments', `E-5001,Rachel,rachel@example.com,555-010-0101,7200,${dAgo(11)},Open,Yes,email,Heat pump quote`, `E-5002,Omar,,555-010-0102,3100,${dAgo(4)},Open,Yes,text,`, `E-5003,Grace,grace@example.com,,5400,${dAgo(20)},Won,Yes,email,`, `E-5004,Leo,,555-010-0104,2200,${dAgo(9)},Open,,text,No consent recorded`, `E-5005,Priya,priya@example.com,,9800,${dAgo(14)},Open,Yes,email,Furnace and duct replacement`, `E-5006,Marcus,,555-010-0106,4600,${dAgo(8)},Open,Yes,text,Wants financing options`, `E-5007,Elena,elena@example.com,,12800,${dAgo(22)},Open,Yes,email,Whole-home heat pump`, `E-5008,Sam,,555-010-0108,1900,${dAgo(3)},Open,Yes,text,`].join('\n'); const r = parseCSV(t); setImport(r[0], r.slice(1)); });
  $('#content').addEventListener('change', guard(async e => {
    if (e.target.id !== 'file' || !e.target.files[0]) return; const f = e.target.files[0];
    if (/\.xlsx?$/i.test(f.name)) { if (!window.XLSX) throw new Error('The Excel reader did not load. Save the sheet as CSV instead.'); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true }); const ws = wb.Sheets[wb.SheetNames.includes('QUOTES_IN') ? 'QUOTES_IN' : wb.SheetNames[0]]; const r = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' }); if (r.length < 2) throw new Error('No data rows found'); setImport(r[0], r.slice(1)); }
    else { const r = parseCSV(await f.text()); if (r.length < 2) throw new Error('No data rows found'); setImport(r[0], r.slice(1)); }
  }));
  on(root, 'click', '#load', guard(async () => {
    const v = (r, f) => { const i = imp.map[f]; return i === '' || i == null ? undefined : (r[i] || '').toString().trim(); };
    const rows = imp.rows.map(r => Object.fromEntries(FIELDS.map(f => [f[0] === 'date' ? 'quote_date' : f[0], v(r, f[0])]))); const res = await C.wapi('/quotes/import', { method: 'POST', body: { rows, confirmAllEligible: !!($('#conf') && $('#conf').checked) } });
    await load(); imp = null; drawMap(); toast(`Loaded ${res.added}. Skipped ${res.notOpen} not open, ${res.noConsent} without consent, ${res.duplicates} duplicates, ${res.invalid.length} unreadable.`, res.invalid.length ? 'err' : 'ok');
  }));
}).catch(e => RR.toast(e.message, 'err'));
