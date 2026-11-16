// Civic engagement + community development public pages (Phase 3).
import type { http } from 'node:http';
import { t, tf, langFromCookie, type Lang } from './i18n.ts';
import { pageShell, icon } from './render.ts';
import { escapeHtml } from './validate.ts';

export function civicPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  data: {
    polls: { id: number; q_en: string; q_ha: string; options: { id: number; l_en: string; l_ha: string; votes: number }[]; total: number; myVote: number | null }[];
    petitions: { id: number; t_en: string; t_ha: string; b_en: string; b_ha: string; status: string; signatures: number; target: number; signed: boolean }[];
  }
): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  const pollHtml = data.polls.length
    ? data.polls.map((p) => {
        const q = escapeHtml(lang === 'ha' ? p.q_ha : p.q_en);
        const opts = p.options
          .map((o) => {
            const label = escapeHtml(lang === 'ha' ? o.l_ha : o.l_en);
            const pct = p.total ? Math.round((o.votes / p.total) * 100) : 0;
            if (p.myVote !== null) {
              const mine = p.myVote === o.id;
              return `<div class="poll-row${mine ? ' mine' : ''}"><span>${label}</span><span class="muted small">${o.votes} · ${pct}%</span></div>`;
            }
            return `<label class="poll-row"><input type="radio" name="poll${p.id}" value="${o.id}" required/> <span>${label}</span></label>`;
          })
          .join('');
        const inner =
          p.myVote !== null
            ? opts
            : `<form class="stack" data-poll="${p.id}">${opts}<div><button class="btn btn-primary btn-sm" type="submit">${icon('shield', 16)} ${escapeHtml(tr('civic.vote'))}</button></div></form>`;
        return `<div class="card"><h3>${q}</h3><p class="muted small">${p.total} ${escapeHtml(tr('civic.results'))}</p>${inner}</div>`;
      })
      .join('')
    : `<p class="muted">${escapeHtml(t(lang, 'dev.none'))}</p>`;
  const petHtml = data.petitions.length
    ? data.petitions
        .map((p) => {
          const title = escapeHtml(lang === 'ha' ? p.t_ha : p.t_en);
          const body = escapeHtml(lang === 'ha' ? p.b_ha : p.b_en);
          const closed = p.status === 'closed';
          const action = closed
            ? `<span class="badge st-rejected">${escapeHtml(tr('civic.closed'))}</span>`
            : p.signed
              ? `<span class="badge st-resolved">&#10003;</span>`
              : `<form class="sign-form" data-pet="${p.id}" style="display:flex;gap:8px;flex-wrap:wrap">
                  <input type="text" name="name" maxlength="80" placeholder="${escapeHtml(tr('civic.sign.name'))}" required style="flex:1;min-width:180px;padding:10px 14px;border:1.5px solid var(--line);border-radius:10px;font:inherit"/>
                  <button class="btn btn-primary btn-sm" type="submit">${escapeHtml(tr('civic.sign'))}</button>
                </form>`;
          const pct = p.target ? Math.min(100, Math.round((p.signatures / p.target) * 100)) : 0;
          return `<div class="card"><h3>${title}</h3><p>${body}</p>
            <p class="muted small"><b>${p.signatures}</b> ${escapeHtml(tr('civic.sign.count'))} · ${escapeHtml(tr('civic.sign.target'))}: ${p.target}</p>
            <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
            ${action}</div>`;
        })
        .join('')
    : '';
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('civic.title'))}</h1><p>${escapeHtml(tr('civic.subtitle'))}</p></div></div>
  <section class="band"><div class="wrap">
    <h2>${escapeHtml(tr('civic.polls'))}</h2>
    <div class="grid-2">${pollHtml}</div>
    <h2 style="margin-top:34px">${escapeHtml(tr('civic.petitions'))}</h2>
    <div class="stack">${petHtml || `<p class="muted">${escapeHtml(t(lang, 'dev.none'))}</p>`}</div>
    <h2 style="margin-top:34px">${escapeHtml(tr('civic.feedback'))}</h2>
    <form id="fbForm" class="stack" style="max-width:560px">
      <div class="field"><label>${escapeHtml(tr('civic.fb.name'))}</label><input type="text" name="name" maxlength="80" placeholder="Anonymous"/></div>
      <div class="field"><label>${escapeHtml(tr('civic.fb.message'))}</label><textarea name="message" rows="4" maxlength="3000" required></textarea></div>
      <div><button class="btn btn-primary" type="submit">${icon('report', 18)} ${escapeHtml(tr('civic.fb.submit'))}</button></div>
      <div id="fbMsg"></div>
    </form>
  </div></section>
  <script>
  (function(){
    var T = ${JSON.stringify({ voted: tr('civic.voted'), thanks: tr('civic.sign.thanks'), fbThanks: tr('civic.fb.thanks'), closed: tr('civic.sign.closed'), err: tr('err.generic') })};
    Array.prototype.forEach.call(document.querySelectorAll('form[data-poll]'), function(f){
      f.addEventListener('submit', function(ev){
        ev.preventDefault();
        var choice = f.querySelector('input[type=radio]:checked');
        if (!choice) return;
        postJson('/api/polls/' + f.dataset.poll + '/vote', { option_id: Number(choice.value) }).then(function(r){
          if (r.ok) { toast(T.voted); setTimeout(function(){ location.reload(); }, 900); }
          else toast((r.data && r.data.error) || T.err, true);
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.sign-form'), function(f){
      f.addEventListener('submit', function(ev){
        ev.preventDefault();
        postJson('/api/petitions/' + f.dataset.pet + '/sign', { name: f.name.value }).then(function(r){
          if (r.ok) { toast(T.thanks); setTimeout(function(){ location.reload(); }, 900); }
          else toast((r.data && r.data.error) || T.err, true);
        });
      });
    });
    document.getElementById('fbForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      var f = ev.target;
      postJson('/api/feedback', fd(f)).then(function(r){
        if (r.ok) { document.getElementById('fbMsg').innerHTML = '<div class="notice notice-ok">' + T.fbThanks + '</div>'; f.reset(); }
        else document.getElementById('fbMsg').innerHTML = '<div class="notice notice-err">' + ((r.data && (r.data.error || (r.data.fields && r.data.fields.message))) || T.err) + '</div>';
      });
    });
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('civic.title') + ' — AFRIPULSE AI', active: 'civic', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function developmentPage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projects: { id: number; name: string; description: string; ward: string | null; status: string; progress: number; updates: { note: string; created_at: string }[] }[]
): void {
  const lang = langFromCookie(req);
  const tr = tf(lang);
  const cards = projects.length
    ? projects
        .map((p) => {
          const updates = p.updates.length
            ? `<details><summary class="muted small">${escapeHtml(tr('dev.updates'))} (${p.updates.length})</summary><ul class="muted small">${p.updates
                .map((u) => `<li>${escapeHtml(u.note)} <span class="muted">· ${new Date(u.created_at).toISOString().slice(0, 10)}</span></li>`)
                .join('')}</ul></details>`
            : '';
          return `<div class="card">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
              <h3 style="margin:0">${escapeHtml(p.name)}</h3>
              <span class="badge st-${p.status === 'completed' ? 'resolved' : p.status === 'ongoing' ? 'in_progress' : p.status === 'suspended' ? 'rejected' : 'submitted'}">${escapeHtml(t(lang, 'dev.status.' + p.status))}</span>
            </div>
            ${p.ward ? `<p class="muted small">${escapeHtml(p.ward)}</p>` : ''}
            <p>${escapeHtml(p.description)}</p>
            <p class="muted small">${escapeHtml(tr('dev.progress'))}: <b>${p.progress}%</b></p>
            <div class="progress"><div class="progress-fill" style="width:${p.progress}%"></div></div>
            ${updates}
          </div>`;
        })
        .join('')
    : `<p class="muted">${escapeHtml(tr('dev.none'))}</p>`;
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('dev.title'))}</h1><p>${escapeHtml(tr('dev.subtitle'))}</p></div></div>
  <section class="band"><div class="wrap">
    <h2>${escapeHtml(tr('dev.projects'))}</h2>
    <div class="grid-2">${cards}</div>
  </div></section>`;
  const html = pageShell({ lang, title: tr('dev.title') + ' — AFRIPULSE AI', active: 'dev', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
