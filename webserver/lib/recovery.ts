// Password recovery: forgot + reset pages (email link flow).
import type { http } from 'node:http';
import { t, tf, langFromCookie, type Lang } from './i18n.ts';
import { pageShell, icon } from './render.ts';
import { escapeHtml } from './validate.ts';

export function forgotPage(req: http.IncomingMessage, res: http.ServerResponse): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('auth.forgot.title'))}</h1>
    <p>${escapeHtml(tr('auth.forgot.subtitle'))}</p></div></div>
  <section class="band"><div class="wrap" style="max-width:460px">
    <form id="fgForm" class="stack">
      <div class="field"><label>${escapeHtml(tr('auth.forgot.email'))}</label><input type="email" name="email" required autocomplete="email"/></div>
      <div><button class="btn btn-primary" type="submit" id="fgBtn">${icon('shield', 18)} ${escapeHtml(tr('auth.forgot.submit'))}</button></div>
      <div id="fgMsg"></div>
      <p class="muted small"><a href="/login">${escapeHtml(t(lang, 'auth.login.title'))}</a></p>
    </form>
  </div></section>
  <script>
  (function(){
    var T = ${JSON.stringify({ sending: tr('auth.forgot.sending'), sent: tr('auth.forgot.sent'), err: tr('err.generic') })};
    document.getElementById('fgForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      var btn = document.getElementById('fgBtn');
      btn.disabled = true; btn.textContent = T.sending;
      postJson('/api/forgot', fd(ev.target)).then(function(r){
        btn.disabled = false; btn.textContent = ${JSON.stringify(tr('auth.forgot.submit'))};
        // Always show the neutral sent message (never reveals whether the email exists)
        document.getElementById('fgMsg').innerHTML = '<div class="notice notice-ok">' + (r.ok ? T.sent : T.sent) + '</div>';
      }).catch(function(){ btn.disabled = false; btn.textContent = ${JSON.stringify(tr('auth.forgot.submit'))}; });
    });
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('auth.forgot.title') + ' — AFRIPULSE AI', active: '', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function resetPage(req: http.IncomingMessage, res: http.ServerResponse, token: string, state: 'form' | 'invalid'): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  if (state === 'invalid') {
    const content = `
    <section class="band"><div class="wrap" style="max-width:460px;text-align:center">
      <div style="font-size:48px;color:var(--danger)">&#9888;</div>
      <h1>${escapeHtml(tr('auth.reset.title'))}</h1>
      <div class="notice notice-err">${escapeHtml(tr('auth.reset.invalid'))}</div>
      <a class="btn btn-primary" href="/forgot">${escapeHtml(tr('auth.forgot.title'))}</a>
    </div></section>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(pageShell({ lang, title: tr('auth.reset.title') + ' — AFRIPULSE AI', active: '', content }));
    return;
  }
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('auth.reset.title'))}</h1></div></div>
  <section class="band"><div class="wrap" style="max-width:460px">
    <form id="rsForm" class="stack">
      <input type="hidden" name="token" value="${escapeHtml(token)}"/>
      <div class="field"><label>${escapeHtml(t(lang, 'auth.password.new'))}</label><input type="password" name="password" minlength="8" maxlength="100" required autocomplete="new-password"/></div>
      <div class="field"><label>${escapeHtml(t(lang, 'auth.password.confirm'))}</label><input type="password" name="password2" minlength="8" required autocomplete="new-password"/></div>
      <div><button class="btn btn-primary" type="submit" id="rsBtn">${escapeHtml(tr('auth.reset.submit'))}</button></div>
      <div id="rsMsg"></div>
    </form>
  </div></section>
  <script>
  (function(){
    var T = ${JSON.stringify({ ok: tr('auth.reset.ok'), mismatch: tr('auth.err.mismatch'), err: tr('err.generic'), login: tr('auth.login.title') })};
    document.getElementById('rsForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      var f = ev.target;
      if (f.password.value !== f.password2.value) {
        document.getElementById('rsMsg').innerHTML = '<div class="notice notice-err">' + T.mismatch + '</div>';
        return;
      }
      postJson('/api/reset', { token: f.token.value, password: f.password.value }).then(function(r){
        if (r.ok) {
          document.getElementById('main').innerHTML =
            '<section class="band"><div class="wrap" style="max-width:460px;text-align:center"><div class="card success-panel">' +
            '<span style="color:var(--ok);font-size:52px">&#10003;</span><h2>' + T.ok + '</h2>' +
            '<a class="btn btn-primary btn-sm" href="/login">' + T.login + '</a></div></div></section>';
        } else {
          document.getElementById('rsMsg').innerHTML = '<div class="notice notice-err">' + ((r.data && (r.data.error || (r.data.fields && r.data.fields.password))) || T.err) + '</div>';
        }
      });
    });
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('auth.reset.title') + ' — AFRIPULSE AI', active: '', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
