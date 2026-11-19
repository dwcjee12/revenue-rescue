(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Math.round(n || 0).toLocaleString('en-CA');
  const when = t => t ? new Date(t).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  try { const t = localStorage.getItem('rr-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

  async function api(path, opts = {}) {
    const o = { method: opts.method || 'GET', headers: { 'X-RR': '1' }, credentials: 'same-origin' };
    if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch(path, o); let j = null; try { j = await r.json(); } catch (e) {}
    if (r.status === 401 && !opts.noRedirect) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sign in required'); }
    if (!r.ok) throw new Error((j && j.error) || 'Request failed (' + r.status + ')');
    return j;
  }
  let tt; function toast(msg, kind) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.className = 'toast ' + (kind || ''); t.textContent = msg; clearTimeout(tt); tt = setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500); }
  const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } };
  async function save(name, data, type) { const b = new Blob([data], { type: type || 'text/plain' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  const copy = async (t, m) => { try { await navigator.clipboard.writeText(t); toast(m || 'Copied', 'ok'); } catch (e) { toast('Copy failed. Select the text and copy it yourself.', 'err'); } };
  function on(root, ev, sel, fn) { root.addEventListener(ev, e => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(t, e); }); }

  const NAV = [['dashboard', 'Dashboard'], ['pipeline', 'Pipeline'], ['inbox', 'Inbox'], ['plan', 'Follow-ups'], ['outreach', 'Outreach'], ['contracts', 'Contracts'], ['integrations', 'Integrations'], ['developer', 'Developer'], ['team', 'Team'], ['settings', 'Settings']];
  async function boot(page) {
    const me = await api('/api/me');
    let wid = new URLSearchParams(location.search).get('ws'); try { wid = wid || localStorage.getItem('rr-ws'); } catch (e) {}
    const w = me.workspaces.find(x => x.id === wid) || me.workspaces[0];
    if (!w) { location.href = '/login.html'; return new Promise(() => {}); }
    try { localStorage.setItem('rr-ws', w.id); } catch (e) {}
    $('#side').innerHTML = `<a class="brand" href="/dashboard.html"><i></i>Revenue Rescue</a>
      <label for="wsel" class="small mut" style="margin:0">Workspace</label><select id="wsel">${me.workspaces.map(x => `<option value="${esc(x.id)}"${x.id === w.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">+ New workspace</option></select>
      <nav aria-label="Main">${NAV.map(n => `<a href="/${n[0]}.html"${n[0] === page ? ' aria-current="page"' : ''}>${n[1]}</a>`).join('')}</nav>
      <div class="sidefoot"><div class="small mut">${esc(me.user.email)}<br>Role: <b>${esc(w.role)}</b></div><div class="row" style="margin:0"><a class="btn sm" href="/account.html">Account</a><button class="sm" id="theme" type="button">Theme</button><button class="sm" id="out" type="button">Sign out</button></div></div>`;
    $('#wsel').addEventListener('change', guard(async e => { if (e.target.value === '__new') { const name = window.prompt('Name the new workspace'); if (name && name.trim()) { const r = await api('/api/workspaces', { method: 'POST', body: { name } }); localStorage.setItem('rr-ws', r.id); location.reload(); } else e.target.value = w.id; return; } localStorage.setItem('rr-ws', e.target.value); location.reload(); }));
    $('#out').addEventListener('click', guard(async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.href = '/login.html'; }));
    $('#theme').addEventListener('click', () => { const r = document.documentElement, cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'), n = cur === 'dark' ? 'light' : 'dark'; r.dataset.theme = n; try { localStorage.setItem('rr-theme', n); } catch (e) {} });
    const can = p => w.role === 'owner' || w.perms.includes(p);
    return { me, w, ws: w.id, can, wapi: (p, o) => api(`/api/w/${w.id}${p}`, o) };
  }
  window.RR = { $, $$, esc, money, when, api, toast, guard, save, copy, on, boot };
})();
