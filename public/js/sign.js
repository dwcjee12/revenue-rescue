const { $, esc, api, when } = RR; const t = new URLSearchParams(location.search).get('t');
(async () => {
  try {
    const c = await api('/api/sign/' + encodeURIComponent(t), { noRedirect: true });
    $('#h').textContent = 'Agreement from ' + c.company;
    if (c.status === 'signed') { $('#c').innerHTML = `<pre>${esc(c.text)}</pre><p class="notice">Signed by ${esc(c.signed_by)} on ${esc(when(c.signed_at))}.</p>`; return; }
    $('#c').innerHTML = `<pre>${esc(c.text)}</pre><label for="n">Type your full name</label><input id="n" autocomplete="name"><label style="display:flex;gap:8px;align-items:flex-start;font-weight:400"><input type="checkbox" id="a"> I have read this agreement and agree to be bound by it, and I agree to sign electronically.</label><p class="small mut">Your name, the time and your IP address are recorded with a fingerprint of this document.</p><p id="e" class="small" style="color:var(--bad)" role="alert"></p><button class="p" id="s" type="button">Sign</button>`;
    $('#s').onclick = async () => { try { await api('/api/sign/' + encodeURIComponent(t), { method: 'POST', body: { name: $('#n').value, agree: $('#a').checked }, noRedirect: true }); $('#c').innerHTML += '<p class="notice">Thank you. Your signature was recorded.</p>'; $('#s').remove(); } catch (e) { $('#e').textContent = e.message; } };
  } catch (e) { $('#c').innerHTML = `<p class="notice">${esc(e.message)}</p>`; }
})();
