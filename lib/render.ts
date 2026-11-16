import { escapeHtml } from './validate.ts';
import { LANGS, t, type Lang } from './i18n.ts';

export function logoSvg(size = 34): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <circle cx="24" cy="24" r="22" fill="#0B3D2E"/>
    <circle cx="24" cy="24" r="22" stroke="#C9A227" stroke-width="1.6"/>
    <path d="M9 26h7l4-11 6 18 4-11 4 4h5" stroke="#E9B949" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="24" cy="24" r="2.4" fill="#fff"/>
  </svg>`;
}

export function icon(name: string, size = 20): string {
  const paths: Record<string, string> = {
    report: '<path d="M12 2 4 6v6c0 5 3.4 8.9 8 10 4.6-1.1 8-5 8-10V6l-8-4z"/>',
    track: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
    map: '<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z"/><path d="M9 3v16M15 5v16"/>',
    shield: '<path d="M12 2 4 6v6c0 5 3.4 8.9 8 10 4.6-1.1 8-5 8-10V6l-8-4z"/><path d="m8.5 12 2.5 2.5L15.5 10"/>',
    brain: '<path d="M12 3a4 4 0 0 0-4 4 4 4 0 0 0-3 6.5A4 4 0 0 0 8 21h8a4 4 0 0 0 3-7.5A4 4 0 0 0 16 7a4 4 0 0 0-4-4z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18-3-4-3-14.5 0-18z"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 14c2.8 0 5 2.2 5 5"/>',
    check: '<path d="m4 12.5 5 5L20 6.5"/>',
    alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".5"/>',
    doc: '<path d="M6 2h9l5 5v15H6V2z"/><path d="M14 2v6h6"/>',
  };
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}

export function statusBadge(status: string, lang: Lang): string {
  return `<span class="badge st-${escapeHtml(status)}">${escapeHtml(t(lang, `status.${status}`))}</span>`;
}

export function priorityBadge(priority: string | null, lang: Lang): string {
  if (!priority) return '<span class="badge p-unknown">—</span>';
  return `<span class="badge pr-${escapeHtml(priority)}">${escapeHtml(t(lang, `priority.${priority}`))}</span>`;
}

export function langSwitcher(lang: Lang, currentPath: string): string {
  const target = lang === 'en' ? 'ha' : 'en';
  return `<a class="lang-switch" href="#" data-lang="${target}" title="${t(lang, 'lang.switch')}">
    ${LANGS.find((l) => l.code === target)!.label} ${icon('globe', 16)}</a>`;
}

export function pageShell(opts: {
  lang: Lang;
  title: string;
  active?: string;
  content: string;
  extraHead?: string;
  scripts?: string;
  bare?: boolean;
}): string {
  const { lang, title, active, content, extraHead = '', scripts = '', bare = false } = opts;
  const nav = bare ? '' : `
  <header class="topbar">
    <div class="wrap nav-row">
      <a class="brand" href="/">${logoSvg()}<span class="brand-name">AFRIPULSE<span class="brand-ai">AI</span></span></a>
      <nav class="navlinks">
        <a href="/" class="${active === 'home' ? 'on' : ''}">${t(lang, 'nav.home')}</a>
        <a href="/report" class="${active === 'report' ? 'on' : ''}">${t(lang, 'nav.report')}</a>
        <a href="/track" class="${active === 'track' ? 'on' : ''}">${t(lang, 'nav.track')}</a>
        <a href="/map" class="${active === 'map' ? 'on' : ''}">${t(lang, 'nav.map')}</a>
        <a href="/about" class="${active === 'about' ? 'on' : ''}">${t(lang, 'nav.about')}</a>
        <a href="/civic" class="${active === 'civic' ? 'on' : ''}">${t(lang, 'nav.civic')}</a>
        <a href="/development" class="${active === 'dev' ? 'on' : ''}">${t(lang, 'nav.dev')}</a>
        <a href="/register" class="${active === 'register' ? 'on' : ''}">${t(lang, 'auth.register.title')}</a>
        <a href="/login" class="${active === 'login' ? 'on' : ''}">${t(lang, 'auth.login.title')}</a>
        <a href="/admin/login" class="nav-admin">${t(lang, 'nav.login')}</a>
        ${langSwitcher(lang, active === 'admin' ? '/admin' : `/${active ?? ''}`)}
      </nav>
      <button class="nav-burger" id="navBurger" aria-label="Menu">${icon('map', 22)}</button>
    </div>
  </header>`;
  const footer = bare ? '' : `
  <footer class="footer">
    <div class="wrap foot-grid">
      <div>
        <div class="brand" style="margin-bottom:10px">${logoSvg(28)}<span class="brand-name">AFRIPULSE<span class="brand-ai">AI</span></span></div>
        <p class="muted small">${escapeHtml(t(lang, 'brand.tagline'))}</p>
      </div>
      <div>
        <h4>${t(lang, 'nav.about')}</h4>
        <a href="/about">${t(lang, 'nav.home')}</a>
        <a href="/map">${t(lang, 'nav.map')}</a>
        <a href="/track">${t(lang, 'nav.track')}</a>
      </div>
      <div>
        <h4>${t(lang, 'nav.report')}</h4>
        <a href="/report">${t(lang, 'form.submit')}</a>
        <a href="/admin/login">${t(lang, 'nav.login')}</a>
      </div>
      <div>
        <h4>${t(lang, 'contact.title')}</h4>
        <p class="muted small">Kagara, Rafi LGA,<br/>Niger State, Nigeria</p>
      </div>
    </div>
    <div class="wrap foot-base">
      <span class="muted small">${escapeHtml(t(lang, 'footer.rights'))}</span>
      <span class="muted small">\u00a9 ${new Date().getFullYear()} AFRIPULSE AI</span>
    </div>
  </footer>`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="AFRIPULSE AI \u2014 Africa's Living Intelligence & Innovation Network. ${t(lang, 'brand.tagline')}"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/assets/app.css?v=3"/>
<script src="/assets/app.js?v=3"></script>
<link rel="manifest" href="/manifest.json"/>
<meta name="theme-color" content="#0B3D2E"/>
<link rel="apple-touch-icon" href="/assets/icon-192.png?v=2"/>
<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js?v=1').catch(function(){});});}</script>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(logoSvg(64).replace('width="64" height="64"', ''))}"/>
${extraHead}
</head>
<body>
${nav}
<main id="main">${content}</main>
${footer}
${scripts}
</body>
</html>`;
}
