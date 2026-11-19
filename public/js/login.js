const { $, api, toast } = RR; let up = false; const qs = new URLSearchParams(location.search), invite = qs.get('invite');
function mode(u) { up = u; $('#m-in').setAttribute('aria-pressed', !u); $('#m-up').setAttribute('aria-pressed', u); $('#up1').hidden = !u; $('#pwh').hidden = !u; $('#go').textContent = u ? 'Create account' : 'Sign in'; $('#pw').autocomplete = u ? 'new-password' : 'current-password'; $('#wnl').hidden = !!invite; $('#wn').hidden = !!invite; }
$('#m-in').onclick = () => mode(false); $('#m-up').onclick = () => mode(true);
if (invite) { $('#inv').hidden = false; }
$('#f').addEventListener('submit', async e => {
  e.preventDefault(); $('#err').textContent = ''; $('#go').disabled = true;
  try {
    const b = { email: $('#em').value.trim(), password: $('#pw').value, invite };
    if (up) { b.name = $('#nm').value; b.workspace = $('#wn').value; }
    const r = await api(up ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: b, noRedirect: true });
    if (r.recovery) { await showCodes(r.recovery); }
    const next = qs.get('next'); location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard.html';
  } catch (er) { $('#err').textContent = er.message; } finally { $('#go').disabled = false; }
});
api('/api/me', { noRedirect: true }).then(() => { if (!invite) location.href = '/dashboard.html'; }).catch(() => {});
mode(false);

function showCodes(codes) {
  return new Promise(done => {
    $('#f').hidden = true; document.querySelector('.seg').hidden = true; $('#inv').hidden = true; const r = $('#rec'); r.hidden = false;
    r.innerHTML = `<h2>Save your recovery codes</h2><p class="small mut">If you forget your password, one of these codes lets you set a new one. They are shown only once.</p><pre>${codes.join('\n')}</pre><div class="row"><button type="button" id="cc">Copy</button><button type="button" id="dc">Download</button></div><label style="display:flex;gap:8px;font-weight:400;align-items:flex-start"><input type="checkbox" id="ok"> I saved these somewhere safe</label><button class="p" id="cont" type="button" disabled style="width:100%;justify-content:center;margin-top:10px">Continue</button>`;
    $('#cc').onclick = () => RR.copy(codes.join('\n')); $('#dc').onclick = () => RR.save('revenue-rescue-recovery-codes.txt', codes.join('\n'));
    $('#ok').onchange = e => { $('#cont').disabled = !e.target.checked; }; $('#cont').onclick = () => done();
  });
}
$('#fg').onclick = e => { e.preventDefault(); $('#f').hidden = true; $('#rf').hidden = false; document.querySelector('.seg').hidden = true; $('#re').value = $('#em').value; };
$('#bk').onclick = e => { e.preventDefault(); $('#rf').hidden = true; $('#f').hidden = false; document.querySelector('.seg').hidden = false; };
$('#rf').addEventListener('submit', async e => { e.preventDefault(); $('#rerr').textContent = ''; try { await api('/api/auth/reset', { method: 'POST', body: { email: $('#re').value, code: $('#rc').value, password: $('#rp').value }, noRedirect: true }); toast('Password changed. Sign in with the new one.', 'ok'); $('#bk').click(); } catch (er) { $('#rerr').textContent = er.message; } });
