const { $, esc, guard, on, toast, copy } = RR;
let C, T, link = '';
const NAMES = { move: 'Move and edit quotes', draft: 'Write drafts', approve: 'Approve and send', contract: 'Prepare contracts', assign: 'Assign quotes', export: 'Import and export', integrations: 'Integrations and developer' };
async function load() { T = await C.wapi('/team'); draw(); }
function draw() {
  const own = C.w.role === 'owner';
  $('#content').innerHTML = `<div class="card"><h2>Members</h2><div class="tw"><table><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>${T.members.map(m => `<tr><td>${esc(m.name || '')}</td><td>${esc(m.email)}</td><td><select data-r="${m.id}"${own ? '' : ' disabled'} style="width:auto">${['owner', 'estimator', 'viewer'].map(r => `<option${m.role === r ? ' selected' : ''}>${r}</option>`).join('')}</select></td><td>${own && m.id !== T.me ? `<button class="sm danger" data-x="${m.id}">Remove</button>` : ''}</td></tr>`).join('')}</table></div>
  ${own ? `<h3 style="margin-top:16px">Invite someone</h3><div class="row"><div class="grow"><label for="ie">Email</label><input id="ie" type="email"></div><div><label for="ir">Role</label><select id="ir"><option>estimator</option><option>viewer</option><option>owner</option></select></div><button class="p" id="inv">Create invite link</button></div><p class="small mut">No email is sent. Share the link yourself. It works once, for that email address, for 7 days.</p>${link ? `<div class="copy"><pre>${esc(link)}</pre><button class="sm" id="cl">Copy</button></div>` : ''}` : ''}
  ${T.invites.length ? `<p class="small mut" style="margin-top:12px">Pending: ${T.invites.map(i => esc(i.email) + ' (' + i.role + ')').join(', ')}</p>` : ''}</div>
  <div class="card"><h2>Permissions</h2><p class="small mut">${own ? 'Owners always have everything. Choose what the other roles can do.' : 'Only an owner can change permissions.'}</p><div class="tw"><table><tr><th>Permission</th><th>Estimator</th><th>Viewer</th></tr>${T.perms.map(p => `<tr><td>${NAMES[p]}</td>${['estimator', 'viewer'].map(r => `<td><input type="checkbox" aria-label="${r} ${NAMES[p]}" data-r2="${r}" data-p="${p}"${T.matrix[r].includes(p) ? ' checked' : ''}${own ? '' : ' disabled'}></td>`).join('')}</tr>`).join('')}</table></div></div>`;
}
RR.boot('team').then(guard(async c => {
  C = c; await load(); const root = $('#content');
  root.addEventListener('change', guard(async e => { const t = e.target; if (t.dataset.r) { await C.wapi('/members/' + t.dataset.r, { method: 'PATCH', body: { role: t.value } }); toast('Role updated', 'ok'); await load(); } if (t.dataset.r2) { await C.wapi('/perms', { method: 'PUT', body: { role: t.dataset.r2, perm: t.dataset.p, allowed: t.checked } }); toast('Saved', 'ok'); } }));
  on(root, 'click', '[data-x]', guard(async t => { await C.wapi('/members/' + t.dataset.x, { method: 'DELETE' }); await load(); }));
  on(root, 'click', '#inv', guard(async () => { const r = await C.wapi('/invites', { method: 'POST', body: { email: $('#ie').value, role: $('#ir').value } }); link = r.link; await load(); }));
  on(root, 'click', '#cl', () => copy(link));
}));
