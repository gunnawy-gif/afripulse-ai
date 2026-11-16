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
})();
