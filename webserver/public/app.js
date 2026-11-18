// AFRIPULSE AI client helpers
(function () {
  'use strict';

  window.$ = function (sel, root) { return (root || document).querySelector(sel); };
  window.$$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  var toastEl = null;
  window.toast = function (msg, isErr) {
    if (!toastEl) { toastEl = document.createElement('div'); document.body.appendChild(toastEl); }
    toastEl.className = 'toast show' + (isErr ? ' error' : '');
    toastEl.textContent = msg;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  };

  // Mobile nav + language switch via event delegation (immune to load order)
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var burger = t.closest && t.closest('#navBurger');
    if (burger) { var links = $('.navlinks'); if (links) links.classList.toggle('open'); return; }
    var langLink = t.closest && t.closest('.lang-switch');
    if (langLink) {
      ev.preventDefault();
      var lang = langLink.getAttribute('data-lang') || 'en';
      document.cookie = 'afri_lang=' + lang + '; path=/; max-age=31536000; SameSite=Lax';
      location.reload();
    }
  });

  // GPS helper for the report form
  window.getGps = function (onDone) {
    if (!navigator.geolocation) { toast('Location not supported on this device', true); return; }
    toast('Locating\u2026');
    navigator.geolocation.getCurrentPosition(
      function (pos) { onDone(pos.coords.latitude, pos.coords.longitude); },
      function () { toast('Could not get your location', true); },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  // Form helpers
  window.fd = function (form) {
    var out = {};
    new FormData(form).forEach(function (v, k) { out[k] = v; });
    return out;
  };

  window.postJson = function (url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  };

  window.patchJson = function (url, body) {
    return fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  };

  window.getJson = function (url) {
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  };

  // ---------- Offline queue: reports saved on-device, sent when network returns ----------
  var QKEY = 'afri_offline_queue';
  function langOf() {
    var m = /(?:^|; )afri_lang=([a-z]+)/.exec(document.cookie || '');
    return (m && m[1] === 'ha') ? 'ha' : 'en';
  }
  var OFF = {
    en: { sent: 'Pending report sent \u2014 reference number: ', count: 'saved report(s) waiting to send', banner: 'You are offline. Reports you submit are saved on your device and sent automatically when network returns.', reject: 'A saved report was not accepted \u2014 please resubmit it.' },
    ha: { sent: 'Rahoton da aka jira an tura \u2014 lambar tabbatarwa: ', count: 'rahoto(r) da aka ajiye suna jiran tura', banner: 'Ba da network ba kake. Rahotannin da kake aika ana ajiye su a wayarka, suna tura da kansu lokacin da network ya dawo.', reject: 'An ki rahoto daya da aka ajiye \u2014 ka sake aika shi.' }
  };
  function qRead() {
    try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; }
  }
  function qWrite(list) {
    try { localStorage.setItem(QKEY, JSON.stringify(list)); } catch (e) { /* storage full */ }
    updateOfflineBadge();
  }
  window.afriQueueCount = function () { return qRead().length; };
  window.afriQueueAdd = function (item) { var l = qRead(); l.push(item); qWrite(l); };
  window.afriQueueRemove = function (idx) { var l = qRead(); l.splice(idx, 1); qWrite(l); };

  function rebuildFormData(item) {
    var fd = new FormData();
    Object.keys(item.fields || {}).forEach(function (k) { fd.append(k, item.fields[k]); });
    if (item.image && item.image.dataUrl && item.image.name) {
      try {
        var parts = item.image.dataUrl.split(',');
        var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
        var bin = atob(parts[1]);
        var buf = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        fd.append('image', new Blob([buf], { type: mime }), item.image.name);
      } catch (e) { /* skip bad image, send text fields */ }
    }
    return fd;
  }

  var flushing = false;
  function flushQueue() {
    if (flushing || !navigator.onLine) return;
    var list = qRead();
    if (!list.length) { updateOfflineBadge(); return; }
    flushing = true;
    var idx = 0;
    function next() {
      if (idx >= list.length) { flushing = false; updateOfflineBadge(); return; }
      var item = list[idx];
      fetch('/api/reports', { method: 'POST', body: rebuildFormData(item) })
        .then(function (res) {
          return res.json().then(function (d) { return { ok: res.ok, data: d }; });
        })
        .then(function (r) {
          var msgLang = langOf();
          if (r.ok && r.data && r.data.ref_no) {
            toast(OFF[msgLang].sent + r.data.ref_no);
            window.afriQueueRemove(idx); // removal rewrites list; indices stay aligned because we re-read
            list = qRead();
          } else if (!r.ok) {
            // Rejected by server (e.g. validation). Drop it rather than loop forever.
            toast(OFF[msgLang].reject, true);
            window.afriQueueRemove(idx);
            list = qRead();
          } else {
            idx++; // temporary failure: keep, try next
          }
          next();
        })
        .catch(function () { idx++; next(); });
    }
    next();
  }
  window.afriFlushQueue = flushQueue;

  function updateOfflineBadge() {
    var n = qRead().length;
    var badge = document.querySelector('#offlineBadge');
    if (badge) {
      badge.textContent = n ? n + ' ' + OFF[langOf()].count : '';
      badge.style.display = n ? 'inline-block' : 'none';
    }
  }

  function showOfflineBanner() {
    var old = document.querySelector('.offline-banner');
    if (navigator.onLine) { if (old) old.remove(); updateOfflineBadge(); return; }
    if (old) return;
    var div = document.createElement('div');
    div.className = 'offline-banner';
    div.textContent = OFF[langOf()].banner;
    if (document.body) document.body.insertBefore(div, document.body.firstChild);
    else document.addEventListener('DOMContentLoaded', function () { document.body.insertBefore(div, document.body.firstChild); });
  }

  window.addEventListener('online', function () { showOfflineBanner(); flushQueue(); });
  window.addEventListener('offline', showOfflineBanner);
  document.addEventListener('DOMContentLoaded', function () {
    showOfflineBanner();
    var badge = document.createElement('span');
    badge.id = 'offlineBadge'; badge.style.display = 'none';
    badge.className = 'offline-badge';
    if (document.body) document.body.appendChild(badge);
    updateOfflineBadge();
    setTimeout(flushQueue, 1200); // catch pending reports after a page load back online
  });
})();
