// Public user accounts: registration, login, and profile (Phase 2).
import type { http } from 'node:http';
import { t, tf, langFromCookie, type Lang } from './i18n.ts';
import { pageShell, icon } from './render.ts';
import { escapeHtml } from './validate.ts';
import type { SessionUser, Role } from './auth.ts';

export function isStaffRole(role: string): boolean {
  return role === 'super_admin' || role === 'lga_admin' || role === 'reviewer' || role === 'analyst';
}

function roleLabel(lang: Lang, role: string): string {
  const map: Record<string, Record<string, string>> = {
    citizen: { en: 'Citizen', ha: 'Dan kasa' },
    community_rep: { en: 'Community Representative', ha: 'Wakilin Al\u2019umma' },
    government: { en: 'Government / Institution', ha: 'Gwamnati / Cibiya' },
  };
  return (map[role] && map[role][lang]) || role;
}

export function registerPage(req: http.IncomingMessage, res: http.ServerResponse): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('auth.register.title'))}</h1>
    <p>${escapeHtml(tr('auth.register.subtitle'))}</p></div></div>
  <section class="band"><div class="wrap" style="max-width:560px">
    <form id="regForm" class="stack">
      <div class="field"><label>${escapeHtml(tr('auth.name'))}</label>
        <input type="text" name="name" maxlength="80" required/></div>
      <div class="field"><label>Email</label>
        <input type="email" name="email" maxlength="120" required autocomplete="email"/></div>
      <div class="frow">
        <div class="field"><label>${escapeHtml(tr('auth.password'))}</label>
          <input type="password" name="password" minlength="8" maxlength="100" required autocomplete="new-password"/>
          <div class="hint">${escapeHtml(tr('auth.password.hint'))}</div></div>
        <div class="field"><label>${escapeHtml(tr('auth.password.confirm'))}</label>
          <input type="password" name="password2" minlength="8" maxlength="100" required autocomplete="new-password"/></div>
      </div>
      <div class="field"><label>${escapeHtml(tr('auth.role'))}</label>
        <select name="role" required>
          <option value="citizen">${escapeHtml(roleLabel(lang, 'citizen'))} — ${escapeHtml(tr('auth.role.citizen'))}</option>
          <option value="community_rep">${escapeHtml(roleLabel(lang, 'community_rep'))} — ${escapeHtml(tr('auth.role.rep'))}</option>
          <option value="government">${escapeHtml(roleLabel(lang, 'government'))} — ${escapeHtml(tr('auth.role.gov'))}</option>
        </select>
        <div class="hint">${escapeHtml(tr('auth.role.hint'))}</div></div>
      <div><button class="btn btn-primary" type="submit" id="regBtn">${icon('shield', 18)} ${escapeHtml(tr('auth.register.submit'))}</button></div>
      <div id="regErr"></div>
      <p class="muted small">${escapeHtml(tr('auth.login.here'))} <a href="/login">${escapeHtml(tr('nav.login'))}</a></p>
    </form>
  </div></section>
  <script>
  (function(){
    var T = ${JSON.stringify({ btn: tr('auth.register.submitting'), okTitle: tr('auth.register.ok.title'), okBody: tr('auth.register.ok.body'), okGov: tr('auth.register.ok.gov'), goto: tr('auth.register.ok.goto') })};
    document.getElementById('regForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      var f = ev.target;
      if (f.password.value !== f.password2.value) {
        document.getElementById('regErr').innerHTML = '<div class="notice notice-err">' + ${JSON.stringify(tr('auth.err.mismatch'))} + '</div>';
        return;
      }
      var btn = document.getElementById('regBtn');
      btn.disabled = true; btn.textContent = T.btn;
      postJson('/api/register', fd(f)).then(function(r){
        if (r.ok) {
          var gov = r.data && r.data.pendingApproval;
          document.getElementById('main').innerHTML =
            '<section class="band"><div class="wrap"><div class="card success-panel">' +
            '<span style="color:var(--ok);font-size:52px">&#10003;</span>' +
            '<h2>' + (gov ? T.okGov : T.okTitle) + '</h2>' +
            '<p class="muted">' + T.okBody + '</p>' +
            '<a class="btn btn-primary btn-sm" href="/login">' + T.goto + '</a></div></div></section>';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          btn.disabled = false; btn.textContent = T.btn;
          var fields = (r.data && r.data.fields) || {};
          var html = Object.keys(fields).map(function(k){ return '<div class="notice notice-err">' + fields[k] + '</div>'; }).join('');
          if (r.data && r.data.error) html += '<div class="notice notice-err">' + r.data.error + '</div>';
          document.getElementById('regErr').innerHTML = html || '<div class="notice notice-err">Error</div>';
        }
      }).catch(function(){ btn.disabled = false; btn.textContent = T.btn; });
    });
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('auth.register.title') + ' — AFRIPULSE AI', active: '', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function publicLoginPage(req: http.IncomingMessage, res: http.ServerResponse): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('auth.login.title'))}</h1>
    <p>${escapeHtml(tr('auth.login.subtitle'))}</p></div></div>
  <section class="band"><div class="wrap" style="max-width:460px">
    <form id="logForm" class="stack">
      <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username"/></div>
      <div class="field"><label>${escapeHtml(tr('auth.password'))}</label><input type="password" name="password" required autocomplete="current-password"/></div>
      <div><button class="btn btn-primary" type="submit" id="logBtn">${icon('shield', 18)} ${escapeHtml(tr('auth.login.submit'))}</button></div>
      <div id="logErr"></div>
      <p class="muted small"><a href="/forgot">${escapeHtml(tr('auth.forgot.link'))}</a></p>
      <p class="muted small">${escapeHtml(tr('auth.register.here'))} <a href="/register">${escapeHtml(tr('auth.register.title'))}</a> · <a href="/admin/login">${escapeHtml(tr('nav.login'))}</a></p>
    </form>
  </div></section>
  <script>
  (function(){
    document.getElementById('logForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      var btn = document.getElementById('logBtn');
      btn.disabled = true;
      postJson('/api/admin/login', fd(document.getElementById('logForm'))).then(function(r){
        if (r.ok && r.data && r.data.redirect) { location.href = r.data.redirect; }
        else {
          btn.disabled = false;
          document.getElementById('logErr').innerHTML = '<div class="notice notice-err">' + ((r.data && r.data.error) || 'Error') + '</div>';
        }
      }).catch(function(){ btn.disabled = false; });
    });
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('auth.login.title') + ' — AFRIPULSE AI', active: '', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function accountPage(req: http.IncomingMessage, res: http.ServerResponse, user: SessionUser): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  const staff = isStaffRole(user.role);
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('account.title'))}</h1>
    <p>${escapeHtml(user.name)} · ${escapeHtml(user.email)} · <strong>${escapeHtml(roleLabel(lang, user.role))}</strong></p></div></div>
  <section class="band"><div class="wrap" style="max-width:760px">
    ${staff ? `<div class="notice"><strong>${escapeHtml(tr('account.staff'))}</strong> <a href="/admin" class="btn btn-primary btn-sm" style="margin-left:8px">${escapeHtml(tr('account.goto.admin'))}</a></div>` : ''}
    <div class="card" style="margin-bottom:24px">
      <h3>${escapeHtml(tr('account.password'))}</h3>
      <form id="pwForm" class="stack">
        <div class="frow">
          <div class="field"><label>${escapeHtml(tr('auth.password.current'))}</label><input type="password" name="current" required autocomplete="current-password"/></div>
        </div>
        <div class="frow">
          <div class="field"><label>${escapeHtml(tr('auth.password.new'))}</label><input type="password" name="password" minlength="8" maxlength="100" required autocomplete="new-password"/>
            <div class="hint">${escapeHtml(tr('auth.password.hint'))}</div></div>
          <div class="field"><label>${escapeHtml(tr('auth.password.confirm'))}</label><input type="password" name="password2" minlength="8" required autocomplete="new-password"/></div>
        </div>
        <div><button class="btn btn-primary btn-sm" type="submit" id="pwBtn">${escapeHtml(tr('account.password.save'))}</button></div>
        <div id="pwErr"></div>
      </form>
    </div>
    <div class="card">
      <h3>${escapeHtml(tr('account.reports'))}</h3>
      <div id="myReports" class="muted">${escapeHtml(tr('account.loading'))}</div>
    </div>
  </div></section>
  <script>
  (function(){
    var T = ${JSON.stringify({ errGeneric: tr('err.generic'), none: tr('account.reports.none'), save: tr('account.password.save'), saved: tr('account.password.saved'), noRef: tr('account.reports.viewtrack') })};
    getJson('/api/account/reports').then(function(r){
      var box = document.getElementById('myReports');
      if (!r.ok) { box.textContent = T.errGeneric; return; }
      var rows = r.data.reports || [];
      if (!rows.length) { box.textContent = T.none; return; }
      box.innerHTML = '<table class="tbl"><thead><tr><th>Ref</th><th>' + ${JSON.stringify(tr('account.reports.title'))} + '</th><th>' + ${JSON.stringify(tr('account.reports.status'))} + '</th><th>' + ${JSON.stringify(tr('account.reports.date'))} + '</th></tr></thead><tbody>' +
        rows.map(function(x){ return '<tr><td><a href="/track?ref=' + encodeURIComponent(x.ref_no) + '">' + x.ref_no + '</a></td><td>' + x.title + '</td><td>' + x.status + '</td><td>' + x.date + '</td></tr>'; }).join('') + '</tbody></table>';
    }).catch(function(){ document.getElementById('myReports').textContent = T.errGeneric; });
    document.getElementById('pwForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      var f = ev.target;
      if (f.password.value !== f.password2.value) {
        document.getElementById('pwErr').innerHTML = '<div class="notice notice-err">' + ${JSON.stringify(tr('auth.err.mismatch'))} + '</div>';
        return;
      }
      var btn = document.getElementById('pwBtn');
      btn.disabled = true;
      postJson('/api/account/password', { current: f.current.value, password: f.password.value }).then(function(r){
        btn.disabled = false;
        if (r.ok) { document.getElementById('pwErr').innerHTML = '<div class="notice notice-ok">' + T.saved + '</div>'; f.reset(); }
        else document.getElementById('pwErr').innerHTML = '<div class="notice notice-err">' + ((r.data && (r.data.error || r.data.fields && r.data.fields.password)) || T.errGeneric) + '</div>';
      }).catch(function(){ btn.disabled = false; });
    });
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('account.title') + ' — AFRIPULSE AI', active: '', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
