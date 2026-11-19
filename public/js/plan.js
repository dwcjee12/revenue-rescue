const { $, esc, guard, on, toast, when } = RR;
let C, plan, prev = null;
function draw() {
  const own = C.w.role === 'owner', d = own ? '' : ' disabled';
  $('#content').innerHTML = `<div class="card"><div class="row" style="margin:0"><label style="display:flex;gap:10px;align-items:center;margin:0;font-size:1rem"><input type="checkbox" id="on"${plan.on ? ' checked' : ''}${d}> Prepare follow-up drafts automatically every day</label></div><p class="small mut">This only writes drafts. Nothing is sent until an approver approves it on the Outreach page. Customers who reply, opt out, or are not marked eligible are skipped. ${plan.last ? 'Last run ' + esc(when(plan.last)) + '.' : ''}</p></div>
  <div class="card"><h2>Steps</h2><p class="small mut">Each step is prepared once the quote is at least that many days old and the last message is 2+ days ago. Use {name}, {company} and {days}.</p>
  ${plan.steps.map((s, i) => `<div class="card" style="background:var(--bg)"><div class="row" style="margin:0"><div><label for="d${i}" style="margin-top:0">Day</label><input id="d${i}" type="number" min="0" value="${s.day}" style="width:90px" data-i="${i}" data-f="day"${d}></div><div><label for="c${i}" style="margin-top:0">Channel</label><select id="c${i}" data-i="${i}" data-f="channel"${d}>${[['auto', 'Customer preference'], ['sms', 'Text'], ['email', 'Email']].map(o => `<option value="${o[0]}"${s.channel === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div><div class="grow"><label for="s${i}" style="margin-top:0">Subject (email)</label><input id="s${i}" value="${esc(s.subject)}" data-i="${i}" data-f="subject"${d}></div><button class="sm danger" data-rm="${i}"${d}>Remove</button></div><label for="b${i}">Message</label><textarea id="b${i}" data-i="${i}" data-f="body" style="min-height:70px"${d}>${esc(s.body)}</textarea></div>`).join('')}
  <div class="row"><button id="add"${d}>Add step</button><button class="p" id="save"${d}>Save plan</button></div>${own ? '' : '<p class="small mut">Only an owner can change the plan.</p>'}</div>
  <div class="card"><h2>Who is due now</h2><div class="row" style="margin:0"><button id="dry">Preview</button><button class="p" id="run"${C.can('draft') ? '' : ' disabled'}>Create drafts now</button></div>${prev ? `<p style="margin-top:10px">${prev.created ? `Created ${prev.created} drafts. <a href="/outreach.html">Review them</a>.` : `${prev.due.length} due.`}</p>${prev.due.length ? `<div class="tw"><table><tr><th>Customer</th><th>Quote</th><th>Step</th><th>Channel</th></tr>${prev.due.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.quote)}</td><td>${x.step}</td><td>${x.channel}</td></tr>`).join('')}</table></div>` : ''}<p class="small mut">Skipped: ${Object.entries(prev.skipped).map(([k, v]) => `${k} ${v}`).join(', ')}</p>` : ''}</div>`;
}
RR.boot('plan').then(guard(async c => {
  C = c; plan = await C.wapi('/plan'); draw(); const root = $('#content');
  root.addEventListener('input', e => { const t = e.target; if (t.dataset.f) plan.steps[+t.dataset.i][t.dataset.f] = t.dataset.f === 'day' ? +t.value : t.value; if (t.id === 'on') plan.on = t.checked; });
  root.addEventListener('change', e => { if (e.target.id === 'on') plan.on = e.target.checked; });
  on(root, 'click', '#add', () => { const l = plan.steps[plan.steps.length - 1]; plan.steps.push({ day: (l ? l.day : 0) + 7, channel: 'auto', subject: '', body: 'Hi {name}, ' }); draw(); });
  on(root, 'click', '[data-rm]', t => { plan.steps.splice(+t.dataset.rm, 1); draw(); });
  on(root, 'click', '#save', guard(async () => { await C.wapi('/plan', { method: 'PUT', body: plan }); toast('Saved', 'ok'); plan = await C.wapi('/plan'); draw(); }));
  on(root, 'click', '#dry', guard(async () => { prev = await C.wapi('/plan/run', { method: 'POST', body: { dry: true } }); draw(); }));
  on(root, 'click', '#run', guard(async () => { prev = await C.wapi('/plan/run', { method: 'POST', body: {} }); draw(); }));
}));
