const { $, esc, guard, on, toast, copy, save } = RR;
RR.boot('account').then(guard(async c => {
  const a = await RR.api('/api/account'); let codes = null;
  const draw = () => { $('#content').innerHTML = `<div class="card"><h2>${esc(a.email)}</h2><p class="small mut">${esc(a.name || '')}</p></div>
  <div class="card"><h2>Change password</h2><label for="cp">Current password</label><input id="cp" type="password" autocomplete="current-password"><label for="np">New password (10+ characters)</label><input id="np" type="password" autocomplete="new-password"><div class="row"><button class="p" id="chg">Change password</button></div></div>
  <div class="card"><h2>Recovery codes</h2><p class="small mut">If you forget your password, one of these codes lets you set a new one on the sign-in page. ${a.recoveryLeft} unused code${a.recoveryLeft === 1 ? '' : 's'} left. Making new ones cancels the old ones.</p>${codes ? `<div class="notice"><b>Save these now. They are not shown again.</b><pre>${esc(codes.join('\n'))}</pre><div class="row"><button class="sm" id="cc">Copy</button><button class="sm" id="dc">Download</button></div></div>` : `<label for="rp">Your password</label><input id="rp" type="password" autocomplete="current-password"><div class="row"><button id="rg">Make new recovery codes</button></div>`}</div>`; };
  draw(); const root = $('#content');
  on(root, 'click', '#chg', guard(async () => { await RR.api('/api/account/password', { method: 'POST', body: { current: $('#cp').value, next: $('#np').value } }); toast('Password changed. Other sessions were signed out.', 'ok'); $('#cp').value = $('#np').value = ''; }));
  on(root, 'click', '#rg', guard(async () => { const r = await RR.api('/api/account/recovery', { method: 'POST', body: { current: $('#rp').value } }); codes = r.codes; a.recoveryLeft = 8; draw(); }));
  on(root, 'click', '#cc', () => copy(codes.join('\n'))); on(root, 'click', '#dc', () => save('revenue-rescue-recovery-codes.txt', codes.join('\n')));
}));
