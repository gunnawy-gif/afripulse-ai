// African Innovation Hub public page (Phase 5).
import type { http } from 'node:http';
import { t, tf, langFromCookie, type Lang } from './i18n.ts';
import { pageShell, icon } from './render.ts';
import { escapeHtml } from './validate.ts';

export function hubPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  data: {
    innovations: { id: number; name: string; summary: string; category: string; founder: string | null; ward: string | null }[];
    opportunities: { id: number; title: string; description: string; kind: string; provider: string | null; deadline: string | null; link: string | null }[];
  }
): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  const innovations = data.innovations.length
    ? data.innovations
        .map((i) => `<div class="card"><h3>${escapeHtml(i.name)}</h3>
          <p>${escapeHtml(i.summary)}</p>
          <p class="muted small">${escapeHtml(i.category)}${i.ward ? ' · ' + escapeHtml(i.ward) : ''}${i.founder ? ' · ' + escapeHtml(i.founder) : ''}</p></div>`)
        .join('')
    : `<p class="muted">${escapeHtml(tr('hub.none'))}</p>`;
  const opps = data.opportunities.length
    ? data.opportunities
        .map((o) => {
          const dl = o.deadline
            ? `<span class="muted small">${escapeHtml(tr('hub.deadline'))}: ${escapeHtml(o.deadline)}</span>`
            : '';
          const link = o.link
            ? ` <a href="${escapeHtml(o.link)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">Link</a>`
            : '';
          return `<div class="card"><span class="badge st-verified">${escapeHtml(t(lang, 'hub.kind.' + o.kind))}</span>
            <h3 style="margin-top:8px">${escapeHtml(o.title)}</h3>
            <p>${escapeHtml(o.description)}</p>
            <p class="muted small">${o.provider ? escapeHtml(tr('hub.provider')) + ' ' + escapeHtml(o.provider) + ' · ' : ''}${dl}</p>${link}</div>`;
        })
        .join('')
    : `<p class="muted">${escapeHtml(tr('hub.none'))}</p>`;
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('hub.title'))}</h1><p>${escapeHtml(tr('hub.subtitle'))}</p></div></div>
  <section class="band"><div class="wrap">
    <h2>${escapeHtml(tr('hub.showcase'))}</h2>
    <div class="grid-2">${innovations}</div>
    <h2 style="margin-top:34px">${escapeHtml(tr('hub.opportunities'))}</h2>
    <div class="grid-2">${opps}</div>
    <h2 style="margin-top:34px">${escapeHtml(tr('hub.submit'))}</h2>
    <p class="muted">${escapeHtml(tr('hub.submit.subtitle'))}</p>
    <form id="hubForm" class="stack" style="max-width:560px">
      <div class="field"><label>${escapeHtml(tr('hub.name'))}</label><input type="text" name="name" maxlength="150" required/></div>
      <div class="field"><label>${escapeHtml(tr('hub.summary'))}</label><textarea name="summary" rows="4" maxlength="3000" required></textarea></div>
      <div class="frow">
        <div class="field"><label>${escapeHtml(tr('hub.category'))}</label>
          <select name="category" required>
            <option value="technology">Technology</option><option value="agriculture">Agriculture</option>
            <option value="health">Health</option><option value="education">Education</option>
            <option value="energy">Energy</option><option value="other">Other</option>
          </select></div>
        <div class="field"><label>${escapeHtml(tr('hub.founder'))}</label><input type="text" name="founder" maxlength="80"/></div>
      </div>
      <div class="field"><label>${escapeHtml(tr('hub.ward'))}</label><input type="text" name="ward" maxlength="60"/></div>
      <div><button class="btn btn-primary" type="submit">${icon('brain', 18)} ${escapeHtml(tr('hub.submit.btn'))}</button></div>
      <div id="hubMsg"></div>
    </form>
  </div></section>
  <script>
  (function(){
    var T = ${JSON.stringify({ thanks: tr('hub.submit.thanks'), err: tr('err.generic') })};
    document.getElementById('hubForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      postJson('/api/hub/submit', fd(ev.target)).then(function(r){
        if (r.ok) { document.getElementById('hubMsg').innerHTML = '<div class="notice notice-ok">' + T.thanks + '</div>'; ev.target.reset(); }
        else document.getElementById('hubMsg').innerHTML = '<div class="notice notice-err">' + ((r.data && (r.data.error || (r.data.fields && r.data.fields.summary))) || T.err) + '</div>';
      });
    });
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('hub.title') + ' — AFRIPULSE AI', active: 'hub', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
