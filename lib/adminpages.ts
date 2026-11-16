import { pageShell, logoSvg, icon, statusBadge, priorityBadge } from './render.ts';
import { escapeHtml } from './validate.ts';
import type { SessionUser } from './auth.ts';

export function loginPage(res: import('node:http').ServerResponse, error?: string) {
  const content = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand">${logoSvg(40)}<span class="brand-name">AFRIPULSE<span class="brand-ai">AI</span></span></div>
      <p class="center muted small" style="margin-bottom:22px">Smart Governance Dashboard</p>
      ${error ? `<div class="notice notice-err">${escapeHtml(error)}</div>` : ''}
      <form id="loginForm" class="stack" style="max-width:none">
        <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username"/></div>
        <div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password"/></div>
        <button class="btn btn-primary" type="submit" style="width:100%">Sign in</button>
        <div id="loginErr"></div>
      </form>
    </div>
  </div>
  <script>
  (function(){
    document.getElementById('loginForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      postJson('/api/admin/login', fd(this)).then(function(r){
        if (r.ok) { location.href = '/admin'; }
        else {
          document.getElementById('loginErr').innerHTML = '<div class="notice notice-err">' + (r.data.error || 'Sign-in failed') + '</div>';
        }
      });
    });
  })();
  </script>`;
  const html = pageShell({ lang: 'en', title: 'Admin Sign-in — AFRIPULSE AI', active: 'admin', content, bare: true });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function adminShell(user: SessionUser, active: string, title: string, content: string, scripts = ''): string {
  const roleLabel = { super_admin: 'Super Admin', lga_admin: 'LGA Admin', reviewer: 'Reviewer', analyst: 'Analyst' }[user.role];
  const link = (href, id, label, ic) => `<a href="${href}" class="${active === id ? 'on' : ''}">${icon(ic, 18)} ${label}</a>`;
  const nav = `
    ${link('/admin', 'dashboard', 'Dashboard', 'doc')}
    ${link('/admin/reports', 'reports', 'Reports', 'report')}
    ${link('/admin/intelligence', 'intelligence', 'Intelligence', 'brain')}
    ${link('/admin/audit', 'audit', 'Audit Log', 'shield')}
    ${user.role === 'super_admin' ? link('/admin/users', 'users', 'Users', 'users') : ''}`;
  return `
  <div class="admin-shell">
    <aside class="admin-side">
      <a class="brand" href="/admin">${logoSvg(30)}<span class="brand-name">AFRIPULSE<span class="brand-ai">AI</span></span></a>
      <div class="muted small" style="margin-top:4px">Governance Console</div>
      <nav>${nav}</nav>
      <div style="margin-top:auto;padding-top:26px">
        <div style="font-weight:700">${escapeHtml(user.name)}</div>
        <div class="muted small">${roleLabel}</div>
        <a href="#" id="logoutLink" class="muted small" style="display:inline-block;margin-top:8px">Sign out</a>
      </div>
    </aside>
    <main class="admin-main">
      <div class="admin-top"><h1>${escapeHtml(title)}</h1><span class="pill-user">${escapeHtml(user.name)} \u00b7 ${roleLabel}</span></div>
      ${content}
    </main>
  </div>
  <script>document.getElementById('logoutLink').addEventListener('click', function(ev){ ev.preventDefault(); postJson('/api/admin/logout', {}).then(function(){ location.href = '/'; }); });</script>
  ${scripts}`;
}

export function adminHtml(user: SessionUser, active: string, title: string, content: string, scripts = '') {
  return pageShell({
    lang: 'en', title: title + ' — AFRIPULSE AI Admin', active: 'admin', bare: true,
    content: adminShell(user, active, title, content, scripts),
    extraHead: '<style>body{background:var(--green-950)}</style>',
  });
}
