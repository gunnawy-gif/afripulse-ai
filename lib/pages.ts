import { pageShell, icon } from './render.ts';
import { t, tf, langFromCookie, type Lang } from './i18n.ts';
import { escapeHtml, CATEGORIES } from './validate.ts';
import { many, one } from './db.ts';

function langOf(req: import('node:http').IncomingMessage): Lang {
  return langFromCookie(req.headers.cookie?.match(/afri_lang=(\w+)/)?.[1]);
}

export async function publicStats() {
  // Includes clearly-flagged demonstration data so the pilot homepage shows a
  // live-looking picture; the admin queue still tags DEMO rows explicitly.
  const row = await one<{ total: string; resolved: string; communities: string; ai: string }>(
    `SELECT count(*)::text total,
            count(*) FILTER (WHERE status='resolved')::text resolved,
            count(DISTINCT COALESCE(community, ward, lga))::text communities,
            count(*) FILTER (WHERE ai_assessed_at IS NOT NULL)::text ai
     FROM reports`
  );
  const n = (s: string | undefined) => Number(s ?? 0);
  return { total: n(row?.total), resolved: n(row?.resolved), communities: n(row?.communities), ai: n(row?.ai) };
}

export async function homePage(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const lang = langOf(req);
  const tr = tf(lang);
  // A Neon cold-start 502 must not take the whole homepage down; degrade to
  // zeroed stats and let the page render (the DB usually warms up in seconds).
  let stats = { total: 0, resolved: 0, communities: 0, ai: 0 };
  try {
    stats = await publicStats();
  } catch (err) {
    console.error('[webserver] publicStats degraded to zeros:', err instanceof Error ? err.message : err);
  }
  const count = (n: number) => n.toLocaleString('en-NG');

  const feature = (id: string, ic: string) => `
    <div class="card">
      <h3>${icon(ic, 22)} ${escapeHtml(tr(`f${id}.title`))}</h3>
      <p>${escapeHtml(tr(`f${id}.body`))}</p>
    </div>`;

  const step = (n: number) => `
    <div class="card">
      <div class="step-num">0${n}</div>
      <h3>${escapeHtml(tr(`how.s${n}.title`))}</h3>
      <p>${escapeHtml(tr(`how.s${n}.body`))}</p>
    </div>`;

  const content = `
  <section class="hero">
    <div class="wrap">
      <span class="kicker">${icon('map', 15)} ${escapeHtml(tr('hero.kicker'))}</span>
      <h1>${escapeHtml(tr('hero.title'))}</h1>
      <p>${escapeHtml(tr('hero.body'))}</p>
      <div class="hero-cta">
        <a class="btn btn-gold" href="/report">${icon('report', 18)} ${escapeHtml(tr('hero.cta'))}</a>
        <a class="btn btn-ghost" style="border-color:rgba(255,255,255,.35);color:#fff !important" href="/track">${icon('track', 18)} ${escapeHtml(tr('hero.cta2'))}</a>
      </div>
      <div class="hero-stats">
        <div class="hstat"><b data-stat="total">${count(stats.total)}</b><span>${escapeHtml(tr('stats.reports'))}</span></div>
        <div class="hstat"><b>${count(stats.resolved)}</b><span>${escapeHtml(tr('stats.resolved'))}</span></div>
        <div class="hstat"><b>${count(stats.communities)}</b><span>${escapeHtml(tr('stats.communities'))}</span></div>
        <div class="hstat"><b>${count(stats.ai)}</b><span>${escapeHtml(tr('stats.ai'))}</span></div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="sec-head"><h2>${escapeHtml(tr('how.title'))}</h2></div>
      <div class="grid g4">${step(1)}${step(2)}${step(3)}${step(4)}</div>
      <div class="ai-note">${icon('brain', 20)}<span>${escapeHtml(tr('note.ai'))}</span></div>
    </div>
  </section>

  <section class="band alt">
    <div class="wrap">
      <div class="sec-head"><h2>${escapeHtml(tr('features.title'))}</h2></div>
      <div class="grid g3">
        ${feature('1', 'globe')}${feature('2', 'brain')}${feature('3', 'map')}
        ${feature('4', 'doc')}${feature('5', 'check')}${feature('6', 'shield')}
      </div>
    </div>
  </section>

  <section class="band">
    <div class="wrap center">
      <h2>${escapeHtml(tr('cta.title'))}</h2>
      <p class="muted" style="max-width:56ch;margin:0 auto 26px">${escapeHtml(tr('cta.body'))}</p>
      <a class="btn btn-primary" href="/report">${icon('report', 18)} ${escapeHtml(tr('form.submit'))}</a>
    </div>
  </section>`;

  const html = pageShell({ lang, title: 'AFRIPULSE AI — ' + tr('brand.tagline'), active: 'home', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export async function aboutPage(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const lang = langOf(req);
  const tr = tf(lang);
  const content = `
  <div class="page-head"><div class="wrap"><h1>${escapeHtml(tr('about.title'))}</h1></div></div>
  <section class="band">
    <div class="wrap">
      <p style="max-width:70ch;font-size:1.05rem">${escapeHtml(tr('about.body'))}</p>
      <div class="grid g3" style="margin-top:34px">
        <div class="card"><h3>${icon('check', 20)} Mission</h3><p>Connect citizens, communities, institutions and government through AI so local challenges are seen, understood and addressed.</p></div>
        <div class="card"><h3>${icon('map', 20)} Vision</h3><p>A scalable African community-intelligence network, beginning in Rafi LGA and growing across Niger State and beyond.</p></div>
        <div class="card"><h3>${icon('shield', 20)} Principles</h3><p>Human oversight of every AI assessment, verified locations only, and privacy-conscious handling of citizen data.</p></div>
      </div>
      <div class="card" style="margin-top:24px"><h3>${icon('users', 20)} ${escapeHtml(tr('contact.title'))}</h3><p>${escapeHtml(tr('contact.body'))}</p>
      <p class="muted small" style="margin-top:8px">Project founder &amp; initiator: Usman Musa</p></div>
    </div>
  </section>`;
  const html = pageShell({ lang, title: tr('about.title') + ' — AFRIPULSE AI', active: 'about', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export async function reportPage(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const lang = langOf(req);
  const tr = tf(lang);
  const wardOptions = (await many<{ name: string }>(`SELECT name FROM wards WHERE lga='Rafi' ORDER BY name`, []))
    .map((w) => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`).join('');
  const catOptions = CATEGORIES.map((c) => `<option value="${c}">${escapeHtml(tr(`cat.${c}`))}</option>`).join('');

  const content = `
  <div class="page-head"><div class="wrap">
    <h1>${escapeHtml(tr('form.title'))}</h1>
    <p>${escapeHtml(tr('form.subtitle'))}</p>
  </div></div>
  <section class="band">
    <div class="wrap">
      <form id="reportForm" class="stack" enctype="multipart/form-data" novalidate>
        <div class="field"><label for="rtitle">${escapeHtml(tr('form.title.label'))} *</label>
          <input type="text" id="rtitle" name="title" maxlength="150" required/>
        </div>
        <div class="field"><label for="rdesc">${escapeHtml(tr('form.desc.label'))} *</label>
          <textarea id="rdesc" name="description" maxlength="5000" required></textarea>
          <div class="hint">${escapeHtml(tr('form.desc.hint'))}</div>
        </div>
        <div class="frow">
          <div class="field"><label>${escapeHtml(tr('form.category.label'))} *</label>
            <select name="category" required><option value="" disabled selected>—</option>${catOptions}</select>
          </div>
          <div class="field"><label>${escapeHtml(tr('form.language.label'))} *</label>
            <select name="language"><option value="en">English</option><option value="ha">Hausa</option><option value="mixed">Hausa + English</option></select>
          </div>
        </div>
        <div class="frow3">
          <div class="field"><label>${escapeHtml(tr('form.state.label'))} *</label>
            <select name="state" id="fstate"><option>Niger</option></select>
          </div>
          <div class="field"><label>${escapeHtml(tr('form.lga.label'))} *</label>
            <select name="lga" id="flga"><option>Rafi</option></select>
          </div>
          <div class="field"><label>${escapeHtml(tr('form.ward.label'))} *</label>
            <select name="ward" required><option value="" disabled selected>—</option>${wardOptions}</select>
          </div>
        </div>
        <div class="frow">
          <div class="field"><label>${escapeHtml(tr('form.community.label'))} *</label>
            <input type="text" name="community" maxlength="100"/>
          </div>
          <div class="field"><label>${escapeHtml(tr('form.location.label'))} *</label>
            <input type="text" name="specific_location" maxlength="200"/>
            <div class="hint">${escapeHtml(tr('form.location.hint'))}</div>
          </div>
        </div>
        <div class="field"><label>${escapeHtml(tr('form.gps.label'))}</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <input type="text" name="gps" id="gpsField" placeholder="9.9322, 6.0814" style="flex:1;min-width:220px;padding:12px 14px;border:1.5px solid var(--line);border-radius:10px;font:inherit"/>
            <button type="button" class="btn btn-ghost btn-sm" id="gpsBtn">${icon('map', 16)} ${escapeHtml(tr('form.gps.button'))}</button>
          </div>
          <div class="hint">${escapeHtml(tr('form.gps.hint'))}</div>
        </div>
        <div class="field"><label>${escapeHtml(tr('form.image.label'))}</label>
          <label class="file-drop" for="imageInput" id="fileDrop">${icon('doc', 18)} JPG or PNG, up to 4 MB</label>
          <input type="file" id="imageInput" name="image" accept="image/png,image/jpeg" style="display:none"/>
          <div class="hint" id="fileName"></div>
        </div>
        <div class="frow">
          <div class="field"><label>${escapeHtml(tr('form.contact.label'))}</label>
            <input type="text" name="contact_name" maxlength="80" placeholder="${lang === 'ha' ? 'Sunanka' : 'Your name'}"/>
          </div>
          <div class="field"><label>&nbsp;</label>
            <input type="tel" name="contact_phone" maxlength="20" placeholder="+234 ..."/>
            <div class="hint">${escapeHtml(tr('form.contact.hint'))}</div>
          </div>
        </div>
        <div class="ai-note">${icon('brain', 20)}<span>${escapeHtml(tr('note.ai'))}</span></div>
        <div><button type="submit" class="btn btn-primary" id="submitBtn">${icon('report', 18)} ${escapeHtml(tr('form.submit'))}</button></div>
        <div id="formErrors"></div>
      </form>
    </div>
  </section>`;

  const scripts = `<script>
  (function(){
    var T = ${JSON.stringify({
      submitting: tr('form.submitting'), submit: tr('form.submit'),
      successTitle: tr('form.success.title'), successBody: tr('form.success.body'),
      trackNow: tr('form.tracknow'), another: tr('form.another'), errGeneric: tr('err.generic'),
      offlineTitle: tr('form.offline.title'), offlineBody: tr('form.offline.body'),
      offlinePending: tr('form.offline.pending'), refLabel: tr('form.ref')
    })};
    var fileInput = document.getElementById('imageInput');
    fileInput.addEventListener('change', function(){
      var f = fileInput.files[0];
      document.getElementById('fileName').textContent = f ? f.name + ' (' + Math.round(f.size/1024) + ' KB)' : '';
    });
    document.getElementById('gpsBtn').addEventListener('click', function(){
      getGps(function(lat, lng){
        document.getElementById('gpsField').value = lat.toFixed(6) + ', ' + lng.toFixed(6);
        toast('GPS: ' + lat.toFixed(5) + ', ' + lng.toFixed(5));
      });
    });
    var form = document.getElementById('reportForm');
    var btn = document.getElementById('submitBtn');
    var btnHtml = btn.innerHTML;
    function showOfflineSuccess(pendingCode) {
      document.getElementById('main').innerHTML =
        '<section class="band"><div class="wrap"><div class="card success-panel">' +
        '<span style="color:#b7791f;font-size:52px">&#9888;</span>' +
        '<h2>' + T.offlineTitle + '</h2>' +
        '<p class="muted">' + T.offlineBody + '</p>' +
        '<div><span class="muted small">' + T.offlinePending + '</span><br>' +
        '<div class="ref-chip">' + pendingCode + '</div></div>' +
        '<div style="margin-top:10px"><span id="offlineBadge" class="offline-badge"></span></div>' +
        '</div></div></section>';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function queueOffline(data, done) {
      var fields = {};
      data.forEach(function (v, k) { if (k !== 'image' && typeof v === 'string') fields[k] = v; });
      var item = { queuedAt: Date.now(), pendingCode: 'AFR-PEND-' + Math.random().toString(36).slice(2, 8).toUpperCase(), fields: fields, image: null };
      var file = data.get('image');
      var finish = function () { window.afriQueueAdd(item); done(item.pendingCode); };
      if (file && file.size && file.size <= 1500000) {
        var fr = new FileReader();
        fr.onload = function () { item.image = { name: file.name || 'photo.jpg', dataUrl: fr.result }; finish(); };
        fr.onerror = finish;
        fr.readAsDataURL(file);
      } else { finish(); }
    }
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      var data = new FormData(form);
      data.delete('gps');
      data.append('gps_text', document.getElementById('gpsField').value);
      btn.disabled = true; btn.textContent = T.submitting;
      fetch('/api/reports', { method: 'POST', body: data })
        .then(function(res){ return res.json().then(function(d){ return { ok: res.ok, data: d }; }); })
        .then(function(r){
          if (r.ok && r.data.ref_no) { showSuccess(r.data.ref_no); return; }
          btn.disabled = false; btn.innerHTML = btnHtml;
          var fields = (r.data && r.data.fields) || {};
          var html = Object.keys(fields).map(function(k){ return '<div class="notice notice-err">' + fields[k] + '</div>'; }).join('');
          if (r.d && r.data.error) html += '<div class="notice notice-err">' + r.data.error + '</div>';
          var box = document.getElementById('formErrors');
          box.innerHTML = html || '<div class="notice notice-err">' + T.errGeneric + '</div>';
          box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
        .catch(function(){
          btn.disabled = false; btn.innerHTML = btnHtml;
          if (typeof window.afriQueueAdd === 'function') {
            queueOffline(data, function (pendingCode) { showOfflineSuccess(pendingCode); });
          } else {
            toast(T.errGeneric, true);
          }
        });
    });
    function showSuccess(refNo) {
      document.getElementById('main').innerHTML =
        '<section class="band"><div class="wrap"><div class="card success-panel">' +
        '<span style="color:var(--ok);font-size:52px">&#10003;</span>' +
        '<h2>' + T.successTitle + '</h2>' +
        '<p class="muted">' + T.successBody + '</p>' +
        '<div><span class="muted small">${escapeHtml(t('en','form.ref'))} / ${escapeHtml(t('ha','form.ref'))}</span><br>' +
        '<div class="ref-chip">' + refNo + '</div></div>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:10px">' +
        '<a class="btn btn-primary btn-sm" href="/track?ref=' + encodeURIComponent(refNo) + '">' + T.trackNow + '</a>' +
        '<a class="btn btn-ghost btn-sm" href="/report">' + T.another + '</a></div>' +
        '</div></div></section>';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('form.title') + ' — AFRIPULSE AI', active: 'report', content, scripts });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export async function trackPage(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const lang = langOf(req);
  const tr = tf(lang);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const prefill = url.searchParams.get('ref') ?? '';
  const content = `
  <div class="page-head"><div class="wrap">
    <h1>${escapeHtml(tr('track.title'))}</h1>
    <p>${escapeHtml(tr('track.subtitle'))}</p>
  </div></div>
  <section class="band">
    <div class="wrap" style="max-width:760px">
      <form id="trackForm" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px">
        <input type="text" id="refInput" name="ref" placeholder="${escapeHtml(tr('track.placeholder'))}"
          value="${escapeHtml(prefill)}" required
          style="flex:1;min-width:240px;padding:12px 16px;border:1.5px solid var(--line);border-radius:10px;font:inherit;text-transform:uppercase"/>
        <button class="btn btn-primary" type="submit">${icon('track', 18)} ${escapeHtml(tr('track.button'))}</button>
      </form>
      <div id="trackResult"></div>
    </div>
  </section>
  <script>
  (function(){
    var form = document.getElementById('trackForm');
    var box = document.getElementById('trackResult');
    function lookup() {
      var ref = document.getElementById('refInput').value.trim().toUpperCase();
      if (!ref) return;
      box.innerHTML = '<p class="muted">...</p>';
      getJson('/api/track/' + encodeURIComponent(ref)).then(function(r){
        if (!r.ok || !r.data.report) {
          box.innerHTML = '<div class="notice notice-err">${escapeHtml(t('en','track.notfound'))}</div>';
          return;
        }
        var rp = r.data.report;
        var hist = (r.data.history || []).map(function(h){
          return '<li><div class="tl-when">' + h.created_at + '</div><div><b>' + h.new_status_label + '</b>' +
                 (h.note ? '<div class="muted small">' + h.note + '</div>' : '') + '</div></li>';
        }).join('');
        box.innerHTML =
          '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
          '<div><h3 style="margin:0">' + rp.title + '</h3><span class="muted small">' + rp.ref_no + '</span></div>' +
          '<div>' + rp.status_badge + ' ' + rp.priority_badge + '</div></div>' +
          '<dl class="kv">' +
          '<dt>${escapeHtml(t('en','track.category'))}</dt><dd>' + rp.category_label + '</dd>' +
          '<dt>${escapeHtml(t('en','track.location'))}</dt><dd>' + rp.location_label + '</dd>' +
          '<dt>${escapeHtml(t('en','track.submitted'))}</dt><dd>' + rp.created_at + '</dd>' +
          '</dl>' +
          (rp.rejection_reason ? '<div class="notice notice-err" style="margin-top:12px"><b>Rejected:</b> ' + rp.rejection_reason + '</div>' : '') +
          '</div>' +
          '<div class="card" style="margin-top:18px"><h3>${escapeHtml(t('en','track.history'))}</h3><ul class="timeline">' + hist + '</ul></div>';
      });
    }
    form.addEventListener('submit', function(ev){ ev.preventDefault(); lookup(); });
    ${prefill ? 'lookup();' : ''}
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('track.title') + ' — AFRIPULSE AI', active: 'track', content });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export async function mapPage(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const lang = langOf(req);
  const tr = tf(lang);
  const content = `
  <div class="page-head"><div class="wrap">
    <h1>${escapeHtml(tr('map.title'))}</h1>
    <p>${escapeHtml(tr('map.subtitle'))}</p>
  </div></div>
  <section class="band">
    <div class="wrap">
      <div class="filterbar" id="mapFilters">
        <div><label>${escapeHtml(tr('form.category.label'))}</label><select id="mf-cat"><option value="">${escapeHtml(tr('map.filter.all'))}</option>
          ${CATEGORIES.map((c) => `<option value="${c}">${escapeHtml(tr(`cat.${c}`))}</option>`).join('')}</select></div>
        <div><label>${escapeHtml(t('en','track.priority'))}</label><select id="mf-pri"><option value="">${escapeHtml(tr('map.filter.all'))}</option>
          ${['critical','high','medium','low'].map((p) => `<option value="${p}">${escapeHtml(tr(`priority.${p}`))}</option>`).join('')}</select></div>
        <div><label>${escapeHtml(t('en','track.status'))}</label><select id="mf-st"><option value="">${escapeHtml(tr('map.filter.all'))}</option>
          ${['submitted','under_review','verified','assigned','in_progress','resolved','rejected'].map((s) => `<option value="${s}">${escapeHtml(tr(`status.${s}`))}</option>`).join('')}</select></div>
        <div><label>${escapeHtml(tr('form.ward.label'))}</label><select id="mf-ward"><option value="">${escapeHtml(tr('map.filter.all'))}</option>
          ${(await many<{ name: string }>(`SELECT name FROM wards WHERE lga='Rafi' ORDER BY name`, [])).map((w) => `<option>${escapeHtml(w.name)}</option>`).join('')}</select></div>
      </div>
      <div id="map"></div>
      <p class="muted small" style="margin-top:10px">${escapeHtml(tr('map.disclaimer'))}</p>
      <div class="ai-note">${icon('brain', 20)}<span>${escapeHtml(tr('note.ai'))}</span></div>
    </div>
  </section>`;
  const scripts = `
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <script>
  (function(){
    var map = L.map('map').setView([9.93, 6.08], 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    var markers = [];
    function load() {
      var p = new URLSearchParams({
        category: document.getElementById('mf-cat').value,
        priority: document.getElementById('mf-pri').value,
        status: document.getElementById('mf-st').value,
        ward: document.getElementById('mf-ward').value
      });
      getJson('/api/map/reports?' + p.toString()).then(function(r){
        markers.forEach(function(m){ map.removeLayer(m); }); markers = [];
        var pins = r.data.reports || [];
        if (!pins.length) { toast('${escapeHtml(t('en','map.nopins'))}'); }
        var colors = { critical: '#b42318', high: '#fda29b', medium: '#fdba8c', low: '#146b3a' };
        pins.forEach(function(rp){
          var m = L.circleMarker([rp.lat, rp.lng], {
            radius: 9, color: '#fff', weight: 2, fillColor: colors[rp.priority] || '#146b3a', fillOpacity: 0.95
          }).addTo(map);
          m.bindPopup('<div class="pin-pop"><h4>' + rp.title + '</h4>' +
            '<span class="small muted">' + rp.category_label + (rp.ward ? ' \\u00b7 ' + rp.ward : '') + '</span>' +
            '<div>' + rp.status_badge + ' ' + rp.priority_badge + '</div>' +
            '<a class="small" href="/track?ref=' + encodeURIComponent(rp.ref_no) + '">' + rp.ref_no + '</a></div>');
          markers.push(m);
        });
      });
    }
    ['mf-cat','mf-pri','mf-st','mf-ward'].forEach(function(id){ document.getElementById(id).addEventListener('change', load); });
    load();
  })();
  </script>`;
  const html = pageShell({ lang, title: tr('map.title') + ' — AFRIPULSE AI', active: 'map', content, scripts });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
