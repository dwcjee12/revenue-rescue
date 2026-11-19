const { $, esc, when, guard, on, toast } = RR;
RR.boot('settings').then(guard(async c => {
  const s = await c.wapi('/settings'), own = c.w.role === 'owner', d = own ? '' : ' disabled';
  $('#content').innerHTML = `<div class="card"><h2>Workspace</h2><label for="n">Name</label><input id="n" value="${esc(s.name)}"${d}><label for="c">Color</label><select id="c"${d}>${['teal', 'blue', 'amber', 'pink'].map(x => `<option${s.color === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
  <h3 style="margin-top:16px">Follow-up rules</h3><div class="row"><div class="grow"><label for="ha">High priority amount (CAD)</label><input id="ha" type="number" value="${s.high_amount}"${d}></div></div><p class="small mut">High: amount at or above this and 7 to 30 days open. Medium: 5 to 14 days. Everything else Low.</p><div class="row"><button class="p" id="sv"${d}>Save</button></div></div>
  <div class="card"><h2>Audit log</h2><div class="tw"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>${s.audit.map(a => `<tr><td>${esc(when(a.created))}</td><td>${esc(a.email || 'system')}</td><td>${esc(a.action)}</td><td class="wrap">${esc(a.detail)}</td></tr>`).join('')}</table></div></div>`;
  on($('#content'), 'click', '#sv', guard(async () => { await c.wapi('/settings', { method: 'PATCH', body: { name: $('#n').value, color: $('#c').value, high_amount: $('#ha').value, review_days: s.review_days, recontact_days: s.recontact_days } }); toast('Saved', 'ok'); setTimeout(() => location.reload(), 600); }));
}));
