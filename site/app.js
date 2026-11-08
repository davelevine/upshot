const CATS = { security: 'Security', ai: 'AI', architecture: 'Architecture', sdlc: 'SDLC', regulation: 'Regulation', other: 'Other' };
const ORDER = ['ai', 'architecture', 'sdlc', 'security', 'regulation', 'other'];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cat = c => (c in CATS ? c : 'other');
const domain = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const PAGE = 40;
const STALE_MINUTES = 12 * 60;  // three missed builds
const KEEP_DAYS = 90;  // build.py prunes older stories
const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && limit < shown.length) { limit += PAGE; renderPage(); } }, { rootMargin: '800px' });
let tz, iconArt = {}, icons = new Set(), items = [], filter = 'all', shown = [], limit = PAGE, generatedAt = null;

// Today in the site's time zone (data.json's tz), not the device's: some browsers report UTC for privacy, which
// turned the evening's stories into "Yesterday".
function todayIso() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const dayNumber = iso => Date.UTC(...iso.split('-').map((n, k) => +n - (k === 1))) / 864e5;
function dayLabel(iso) {
  const days = dayNumber(todayIso()) - dayNumber(iso);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', days < 7 ? { weekday: 'long', timeZone: 'UTC' } : { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function highlight(text, q) {
  const s = esc(text);
  if (!q) return s;
  const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return s.replace(re, m => `<mark>${m}</mark>`);
}

function renderFilters() {
  const counts = {};
  for (const i of items) counts[cat(i.category)] = (counts[cat(i.category)] || 0) + 1;
  $('filters').innerHTML = [`<button class="filter-btn${filter === 'all' ? ' active' : ''}" data-f="all">All</button>`]
    .concat(ORDER.filter(c => counts[c] || filter === c).map(c => `<button class="filter-btn${filter === c ? ' active' : ''}" data-f="${c}">` +
      `<span class="dot" style="--c:var(--cat-${c})"></span>${CATS[c]} (${counts[c] || 0})</button>`)).join('');
  const name = filter === 'all' ? '' : CATS[filter];
  $('filter-label').textContent = name;  // a hidden filter must still show, or stories look missing
  $('filter-toggle').classList.toggle('active', !!name);
  $('filter-toggle').setAttribute('aria-label', name ? `Filters: ${name}` : 'Filters');
}

function renderItems(keepLimit) {
  const ql = $('search').value.trim().toLowerCase();
  shown = items.filter(i => (filter === 'all' || cat(i.category) === filter) &&
    (!ql || `${i.title} ${i.summary} ${i.publisher} ${domain(i.url)}`.toLowerCase().includes(ql)));
  $('status').textContent = ql ? `${shown.length} articles found` : '';
  if (!keepLimit) limit = PAGE;
  renderPage();
}

// Renders the first `limit` matches; the sentinel below the list raises it as you scroll.
function renderPage() {
  const q = $('search').value.trim();
  const counts = {}, groups = {};
  // By label, not date: dates are UTC, so in the evening west of UTC two of them can both read "Today".
  const minutes = {}, unknown = {};
  for (const i of shown) {
    const d = dayLabel(i.date);
    counts[d] = (counts[d] || 0) + 1;
    minutes[d] = (minutes[d] || 0) + (i.minutes || 0);
    if (!i.minutes) unknown[d] = true;
  }
  const dayMeta = d => `· ${counts[d]} ${counts[d] === 1 ? 'story' : 'stories'}${unknown[d] ? '' : ` · ${minutes[d]} min`}`;  // only a full count: a floor would teach people to ignore it
  for (const i of shown.slice(0, limit)) (groups[dayLabel(i.date)] ||= []).push(i);
  $('items').innerHTML = shown.length ? Object.entries(groups).map(([d, list]) => `
    <div class="date-label"><span>${d}</span><span class="day-meta">${dayMeta(d)}</span></div>
    ${list.map(i => { const c = cat(i.category); return `
    <a class="card${readSet.has(i.url) ? ' read' : ''}" href="${esc(i.url)}" target="_blank" rel="noopener">
      <span class="dot" style="--c:var(--cat-${c})"></span>
      <div class="card-body">
        <div class="card-title">${highlight(i.title, q)}</div>
        ${i.summary ? `<p class="card-summary">${highlight(i.summary, q)}</p>` : ''}
        <div class="card-meta">${isNew(i) ? '<span class="new">New</span>' : ''}<span class="card-cat">${CATS[c]}</span><span>·</span><span class="card-url">${esc(domain(i.url))}</span></div>
      </div>
    </a>`; }).join('')}`).join('')
    : '<p class="empty">No articles match your search.</p>';
  $('items').removeAttribute('aria-busy');
  io.unobserve($('sentinel'));
  io.observe($('sentinel'));
  const ended = shown.length && limit >= shown.length;
  $('end').hidden = !ended;
  if (ended) {
    const n = shown.length, what = `${filter === 'all' ? '' : `${CATS[filter]} `}stor${n === 1 ? 'y' : 'ies'}`;
    const days = Math.min(KEEP_DAYS, Math.ceil((Date.now() - Date.parse(items.reduce((o, i) => (i.date < o ? i.date : o), items[0].date))) / 864e5));
    const scope = q ? ` matching \u201c${q}\u201d` : filter === 'all' ? ` from the last ${days} days` : '';  // the real span: a young site hasn't reached KEEP_DAYS
    $('end-msg').textContent = `That\u2019s ${n === 1 ? 'the only' : `all ${n}`} ${what}${scope}.`;
  }
}

function renderWeekly(weekly) {
  const byUrl = Object.fromEntries(items.map(i => [i.url, i]));
  const picks = (weekly?.items || []).filter(p => byUrl[p.url]);
  if (!picks.length) { $('weekly').hidden = true; return; }  // the placeholder tiles go too
  $('rail').innerHTML = picks.map((p, n) => { const i = byUrl[p.url]; return `
    <a class="weekly-card" href="${esc(i.url)}" target="_blank" rel="noopener">
      <div class="weekly-top"><span class="rank">${n + 1}</span>
        <span class="weekly-cat"><span class="dot" style="--c:var(--cat-${cat(i.category)})"></span>${CATS[cat(i.category)]}</span></div>
      <div class="weekly-card-title">${esc(i.title)}</div>
      <p class="weekly-why">${esc(p.why)}</p>
      <div class="weekly-meta"><span class="weekly-source">${esc(i.publisher)}</span><span>· ${dayLabel(i.date)}</span></div>
    </a>`; }).join('');
  $('weekly').hidden = false;
  const rail = $('rail');
  const step = () => rail.firstElementChild.offsetWidth + 10;
  const sync = () => { $('prev').disabled = rail.scrollLeft < 4; $('next').disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4; };
  $('prev').onclick = () => rail.scrollBy({ left: -step() });
  $('next').onclick = () => rail.scrollBy({ left: step() });
  rail.onscroll = sync;
  sync();
}

const syncThemeColor = () => {
  // Both media variants: the theme toggle can disagree with the system setting they're keyed to.
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', css('--bg')));
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  for (const b of [$('theme'), $('reader-theme')]) { b.setAttribute('aria-label', `Switch to ${next} mode`); b.title = `Switch to ${next} mode`; }
};
// Swap every color in one frame, then let a view transition crossfade the whole page; per-element
// transitions would fade some parts and snap others. The article frame switches by message, so the
// crossfade waits for it to confirm (briefly): otherwise its "after" picture shows the old article.
let frameThemed = null;
$('theme').onclick = $('reader-theme').onclick = () => {
  const root = document.documentElement, t = root.dataset.theme === 'dark' ? 'light' : 'dark';
  const swap = () => {
    root.classList.add('theme-switching');
    root.dataset.theme = t;
    getComputedStyle(root).color;  // commit the new colors before transitions come back
    root.classList.remove('theme-switching');
    syncThemeColor();
    const frame = $('reader-body').querySelector('iframe[srcdoc]');
    if (!frame) return;
    const themed = new Promise(done => { frameThemed = done; setTimeout(done, 150); });
    frame.contentWindow.postMessage({ tw: 'theme', theme: t }, '*');
    return themed.then(() => { frameThemed = null; });
  };
  if (document.startViewTransition) document.startViewTransition(swap);
  else swap();
  localStorage.setItem('theme', t);
};
$('info').onclick = e => {
  e.stopPropagation();
  const open = $('info-pop').hidden;
  $('info-pop').hidden = !open;
  $('info').setAttribute('aria-expanded', open);
};
document.addEventListener('click', () => { $('info-pop').hidden = true; $('info').setAttribute('aria-expanded', false); });
$('filters').onclick = e => {
  const b = e.target.closest('.filter-btn');
  if (!b) return;
  filter = b.dataset.f;
  renderFilters();
  renderItems();
  if ($('filters').matches(':popover-open')) $('filters').hidePopover();
};
// The search bar opens the palette, the same search as ⌘K, rather than filtering the feed in place.
$('search').addEventListener('focus', () => { $('search').blur(); openPalette(); });
io.observe($('sentinel'));
addEventListener('scroll', () => { $('top').hidden = scrollY < 800; }, { passive: true });
$('top').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });

// Read and "new since last visit" state lives only in this browser.
let weekly = null;
const readSet = new Set(JSON.parse(localStorage.getItem('read') || '[]'));
const seenUntil = localStorage.getItem('seenUntil');  // the build you'd seen by the end of your last visit
const isNew = i => !!(seenUntil && i.added && i.added > seenUntil && !readSet.has(i.url));
const saveRead = () => localStorage.setItem('read', JSON.stringify([...readSet]));
function pruneRead() {
  const urls = new Set(items.map(i => i.url));
  for (const u of readSet) if (!urls.has(u)) readSet.delete(u);
  saveRead();
}
const cardFor = url => [...document.querySelectorAll('a.card')].find(a => a.getAttribute('href') === url);
function markRead(url) {
  if (!readSet.has(url)) { readSet.add(url); saveRead(); }
  const card = cardFor(url);
  card?.classList.add('read');
  card?.querySelector('.new')?.remove();
}
const rememberSeen = () => { if (generatedAt) localStorage.setItem('seenUntil', generatedAt); };
addEventListener('pagehide', rememberSeen);
document.addEventListener('visibilitychange', () => { if (document.hidden) rememberSeen(); });

// "Updated 2h ago" in the header; a number that keeps growing means builds have stopped.
function showUpdated() {
  const el = $('updated'), mins = Math.max(0, (Date.now() - Date.parse(generatedAt)) / 60e3);
  el.dateTime = generatedAt;
  el.title = new Date(generatedAt).toLocaleString();
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${Math.floor(mins)}m ago`
    : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
  el.innerHTML = `<span>Updated </span>${ago}`;
  $('stale').hidden = mins < STALE_MINUTES;
  el.hidden = !$('stale').hidden;  // one slot, two states: the band says the same thing, louder
  $('stale').textContent = `Last updated ${ago} · the build may be stalled`;
}
// Redraws only when a new build has landed, keeping the filter, search and loaded depth.
function load() {
  return fetch('/data.json', { cache: 'no-cache' })  // absolute: the page is also served at /read/…
.then(r => r.json()).then(data => {
    if (data.generated_at === generatedAt) return;
    const refresh = generatedAt !== null;
    generatedAt = data.generated_at;
    showUpdated();
    items = data.items || [];
    try { tz = data.tz && new Intl.DateTimeFormat('en-US', { timeZone: data.tz }) && data.tz; } catch { tz = undefined; }  // unknown zone: the device's
    indexSlugs();
    weekly = data.weekly;
    icons = new Set(data.icons || []);
    iconArt = data.iconArt || {};
    pruneRead();
    renderFilters();
    renderWeekly(data.weekly);
    renderItems(refresh);
    if (!refresh) syncFromUrl();
  });
}
let readerFor = null;

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// Inside the article frame, the only script allowed is this one (by nonce): it reports rightward swipes to the
// page so the reader can follow the finger, forwards Escape, j/k, ←/→ and Cmd/Ctrl+K, and takes theme changes. The frame has no same-origin access; it can only postMessage.
const SWIPE_REPORTER = `let s = null;
const send = (tw, t) => parent.postMessage({ tw, x: t && t.screenX }, '*');
addEventListener('touchstart', e => { const t = e.touches[0]; s = { x: t.screenX, y: t.screenY, ax: null }; }, { passive: true });
addEventListener('touchmove', e => {
  if (!s) return;
  const t = e.touches[0], dx = t.screenX - s.x, dy = t.screenY - s.y;
  if (!s.ax && Math.hypot(dx, dy) > 10) { s.ax = dx > Math.abs(dy) ? 'x' : 'y'; if (s.ax === 'x') send('start', { screenX: s.x }); }
  if (s.ax === 'x') { e.preventDefault(); send('move', t); }
}, { passive: false });
const end = () => { if (s && s.ax === 'x') send('end'); s = null; };
addEventListener('touchend', end); addEventListener('touchcancel', end);
addEventListener('message', e => {  // the page's theme toggle
  if (e.source === parent && e.data && e.data.tw === 'theme') {
    document.documentElement.dataset.theme = e.data.theme;
    getComputedStyle(document.body).color;  // apply the new colors now, not at a paint the page's crossfade is holding back
    parent.postMessage({ tw: 'themed' }, '*');
  }
  if (e.source === parent && e.data && e.data.tw === 'size') document.documentElement.dataset.size = e.data.size;
});
addEventListener('keydown', e => {  // keys pressed while the article has focus never reach the page
  const k = e.key.toLowerCase();
  if (!e.altKey && ['escape', 'j', 'k', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); parent.postMessage({ tw: 'key', key: k, mod: e.metaKey || e.ctrlKey }, '*'); }
});`;

// The article frame can't see the page's CSS variables, so it gets both palettes, read from the page's own
// tokens, and the relay flips data-theme on it when the theme changes.
function frameVars(theme) {
  const probe = Object.assign(document.createElement('div'), { hidden: true });
  probe.dataset.theme = theme;
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const out = `color-scheme: ${theme}; ` + ["--accent", "--bg", "--bg-card", "--border", "--border-strong", "--text", "--text-muted"].map(v => `${v}: ${cs.getPropertyValue(v).trim()};`).join(' ');
  probe.remove();
  return out;
}
const iconSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');  // same rule as build.py slug()
// Under the title, like Feedbin: when and by whom, then where from and how long.
function storyMeta(i, byline, minutes) {
  const [y, m, d] = i.date.split('-').map(Number);
  const when = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const by = (byline || '').replace(/^by\s+/i, '').trim();
  return `<div class="meta">${esc(when)}${by ? ` by ${esc(by)}` : ''}<br>${esc(i.publisher)}${minutes ? ` · ${minutes} min read` : ''}</div>`;
}
// The upshot (written and checked by the build) with, for weekly essentials, the hand-picked "What to do" as its last line.
function summaryBox(tldr, why) {
  if (!tldr?.length) return why ? `<div class="todo"><b>What to do</b>${esc(why)}</div>` : '';
  return `<div class="todo tldr"><b>The upshot</b><ul>${tldr.map(t => `<li>${esc(t)}</li>`).join('')}</ul>${why ? `<p class="do"><b>What to do</b>${esc(why)}</p>` : ''}</div>`;
}
function articleDoc(i, html, nonce, why, minutes, byline) {
  return `<!doctype html><html data-theme="${document.documentElement.dataset.theme}" data-size="${textSize}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${location.origin}; img-src https: http: data:; media-src https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<base target="_blank"><style>
:root { ${frameVars('light')} } :root[data-theme="dark"] { ${frameVars('dark')} }
body { margin: 0; background: var(--bg); color: var(--text); font: 1.0625rem/1.65 "Iowan Old Style", Charter, Georgia, serif; overflow-wrap: break-word; }
main { max-width: 640px; margin: 0 auto; padding: 32px 24px 96px; }
a { color: var(--accent); }
h1 { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; margin: 0 0 .4em; font-size: clamp(1.4rem, 1rem + 2vw, 1.75rem); font-weight: 700; line-height: 1.2; letter-spacing: -.01em; }
h1 a { color: inherit; text-decoration: none; } h1 a:hover { text-decoration: underline; text-decoration-thickness: 2px; }
@font-face { font-family: Inter; src: url("${location.origin}/fonts/InterVariable.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
h1 { font-family: Inter, system-ui, sans-serif; letter-spacing: -.01em; }
[data-size="0"] body { font-size: 1rem; } [data-size="2"] body { font-size: 1.1875rem; } [data-size="3"] body { font-size: 1.3125rem; }
.meta { margin-bottom: 1.8em; color: var(--text-muted); font: .9375rem/1.45 Inter, system-ui, sans-serif; }
.todo { margin: 0 0 1.8em; padding: 12px 16px; border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; background: var(--bg-card); }
.tldr ul { margin: .35em 0 0; padding-left: 1.15em; font: 1rem/1.5 Inter, system-ui, sans-serif; } .tldr li + li { margin-top: .45em; }  /* sans: scanned, not read */
.tldr .do { margin: .8em 0 0; padding-top: .7em; border-top: 1px solid var(--border); font: 500 1rem/1.5 Inter, system-ui, sans-serif; }
.todo b { display: block; margin-bottom: 2px; color: var(--accent); font: 700 .875rem/1.5 Inter, system-ui, sans-serif; letter-spacing: .07em; text-transform: uppercase; }
h2, h3, h4 { margin: 1.8em 0 .5em; font-weight: 700; line-height: 1.3; }
h2 { font-size: 1.375rem; } h3 { font-size: 1.125rem; } h4 { font-size: 1rem; }
ul, ol { padding-left: 1.4em; } li + li { margin-top: .35em; }
img, video { max-width: 100%; height: auto; border-radius: 8px; }
figure { margin: 1.6em 0; } figcaption { margin-top: .4em; color: var(--text-muted); font-size: .85em; }
blockquote { margin: 1.4em 0; padding-left: 1em; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
code { padding: .1em .3em; border-radius: 4px; background: var(--bg-card); font: .875em ui-monospace, SFMono-Regular, Consolas, monospace; }
pre { overflow-x: auto; padding: 12px 14px; border-radius: 8px; background: var(--bg-card); font: .8125rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; }
pre code { padding: 0; background: none; font: inherit; }
table { display: block; overflow-x: auto; border-collapse: collapse; font-size: .875rem; } th, td { padding: 4px 8px; border: 1px solid var(--border); } th { font-weight: 700; }
hr { border: 0; border-top: 1px solid var(--border); }
.late { animation: late .2s ease .4s both; } @keyframes late { from { opacity: 0; } }
.status { color: var(--text-muted); font: .9375rem/1.5 Inter, system-ui, sans-serif; }
.pill { display: inline-block; padding: 10px 18px; border: 1px solid var(--accent); border-radius: 999px; font: 600 .9375rem/1.4 Inter, system-ui, sans-serif; text-decoration: none; }
@media (max-width: 600px) { main { padding: 24px 18px 80px; } .pill { padding: 12px 18px; } }
</style><script nonce="${nonce}">${SWIPE_REPORTER}<\/script></head><body><main><h1><a href="${esc(i.url)}" target="_blank" rel="noopener" title="Open the original">${esc(i.title)}</a></h1>${storyMeta(i, byline, minutes)}${summaryBox(i.tldr, why)}${html}</main></body></html>`;
}
// What we already know about a story, from data.json: shown at once, and all that's left if the article can't be fetched.
// While loading, the body holds back a moment: most articles arrive before the panel has landed, and then just appear.
const storyCard = (i, status, loading) => `<div${loading ? ' class="late"' : ''}>${i.summary ? `<p>${esc(i.summary)}</p>` : ''}<p class="status">${status}</p>
<a class="pill" href="${esc(i.url)}" target="_blank" rel="noopener">Read it on ${esc(domain(i.url))}</a></div>`;
// Scripts run only by nonce (the swipe reporter); without allow-same-origin the frame can't touch this page.
function showInReader(i, html, why, minutes, byline) {
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
  frame.title = i.title;
  frame.srcdoc = articleDoc(i, html, crypto.randomUUID(), why, minutes, byline);
  mountFrame(frame);
}
// Loads behind whatever's showing and takes over once drawn, so the pane never blinks empty between frames.
function mountFrame(frame) {
  frame.classList.add('loading');
  frame.onload = () => {
    if (!frame.parentNode) return;
    while (frame.previousSibling) frame.previousSibling.remove();
    frame.classList.remove('loading');
  };
  $('reader-body').append(frame);
}

// About 230 words a minute, the usual adult reading speed for this kind of text.
const readingMinutes = html => Math.max(1, Math.round(html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length / 230));
// Reader links are /read/<the headline's first words>. A clash gets a short hash of the article's URL, so a story's
// link doesn't depend on which other stories happen to be on the site.
const slugBase = t => t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f'’]/g, '').replace(/[^a-z0-9]+/g, ' ')
  .trim().split(' ').slice(0, 8).join('-').slice(0, 60).replace(/-+$/, '');
const shortHash = s => { let h = 5381; for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h.toString(36).slice(0, 5); };
let slugs = new Map();  // slug -> url
function indexSlugs() {
  const count = new Map();
  for (const i of items) count.set(slugBase(i.title), (count.get(slugBase(i.title)) || 0) + 1);
  slugs = new Map(items.map(i => {
    const base = slugBase(i.title);
    return [base && count.get(base) === 1 ? base : [base, shortHash(i.url)].filter(Boolean).join('-'), i.url];
  }));
}
const slugFor = url => [...slugs].find(([, u]) => u === url)?.[0];
const readPath = url => '/read/' + slugFor(url);
let readerPushed = false;  // false when the reader was opened from a link, so closing mustn't go back off the site
function openReader(i, { fromHash = false } = {}) {
  const fresh = !document.body.classList.contains('reading');
  readerFor = i.url;
  markRead(i.url);
  const why = weekly?.items?.find(p => p.url === i.url)?.why;
  const icon = iconSlug(i.publisher);
  $('reader-icon').hidden = !icons.has(icon);
  if (icons.has(icon)) $('reader-icon').src = `/icons/${icon}.png`;
  $('reader-icon').dataset.art = iconArt[icon] || '';
  const at = shown.findIndex(x => x.url === i.url);
  $('reader-prev').disabled = at <= 0;
  $('reader-next').disabled = at < 0 || at >= shown.length - 1;
  showInReader(i, storyCard(i, 'Loading the full article…', true), why);  // before the fetch: the fetch can only upgrade this
  document.body.classList.add('reading');
  $('reader').setAttribute('aria-hidden', 'false');
  document.querySelectorAll('.feed, #top').forEach(el => { el.inert = true; });
  if (fromHash) { history.replaceState({ reader: true }, '', readPath(i.url)); readerPushed = false; }
  else if (fresh) { history.pushState({ reader: true }, '', readPath(i.url)); readerPushed = true; }
  else history.replaceState({ reader: true }, '', readPath(i.url));
  if (fresh) (lastInput === 'key' ? $('reader-close') : $('reader')).focus({ preventScroll: true });  // no ring after a tap
  let unreadable = 'The reader view isn\u2019t available right now.';
  fetch('/api/read?url=' + encodeURIComponent(i.url), { cache: 'no-store' }).then(r => r.json()).then(r => {
    if (readerFor !== i.url) return;  // another article was opened meanwhile
    if (r.content) {
      const minutes = readingMinutes(r.content);
      showInReader(i, r.content, why, minutes, r.byline);
    } else if (r.frameable) {
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms';
      frame.referrerPolicy = 'no-referrer';
      frame.src = i.url;
      frame.title = i.title;
      mountFrame(frame);
    } else {
      if (['shell', 'short', 'not_html'].includes(r.reason)) unreadable = 'This page needs the original site to display.';
      if (r.reason === 'challenge') unreadable = 'This publisher doesn\u2019t allow a reader view.';
      if (r.reason === 'timeout') unreadable = 'This publisher took too long to respond.';
      if (r.reason === 'pending') unreadable = 'The reader view isn\u2019t ready yet.';
      throw new Error(r.reason);
    }
  }).catch(() => {
    if (readerFor !== i.url) return;
    showInReader(i, storyCard(i, unreadable), why);
  });
}
// Article text size, kept on this device: small, medium (the default), large, larger.
const SIZES = ['small', 'medium', 'large', 'larger'];
let textSize = Math.min(3, Math.max(0, +(localStorage.getItem('textSize') ?? 1) || 0));
const markSize = () => $('size-pop').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.size === textSize)));
markSize();
const closeSize = () => { $('size-pop').hidden = true; $('reader-size').setAttribute('aria-expanded', 'false'); };
$('reader-size').onclick = e => {
  e.stopPropagation();
  const open = $('size-pop').hidden;
  closeMenus();  // one menu at a time: these clicks don't reach the page-wide close
  $('size-pop').hidden = !open;
  $('reader-size').setAttribute('aria-expanded', String(open));
  if (open) $('size-pop').querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
};
$('size-pop').onclick = e => {
  e.stopPropagation();
  const b = e.target.closest('button');
  if (!b) return;
  textSize = +b.dataset.size;
  localStorage.setItem('textSize', textSize);
  markSize();
  $('status').textContent = `Text size ${SIZES[textSize]}`;
  $('reader-body').querySelector('iframe[srcdoc]')?.contentWindow.postMessage({ tw: 'size', size: String(textSize) }, '*');
};
document.addEventListener('click', closeSize);
addEventListener('blur', closeSize);  // a tap into the article lands in its frame, which blurs this window
let lastInput = 'pointer';
addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
addEventListener('keydown', () => { lastInput = 'key'; }, true);
$('reader-prev').onclick = () => step(-1);
$('reader-next').onclick = () => step(1);
function closeReader() {
  const url = readerFor;
  readerFor = null;
  document.body.classList.remove('reading');
  $('reader').setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.feed, #top').forEach(el => { el.inert = false; });
  const card = url && cardFor(url);  // back to where you were, even after j/k through several articles
  if (card) { card.focus({ preventScroll: true }); card.scrollIntoView({ block: 'nearest' }); }
  setTimeout(() => { if (!readerFor) $('reader-body').replaceChildren(); }, 350);  // after the slide out
}
function dismiss() {
  if (readerPushed && history.state?.reader) return history.back();
  history.replaceState(null, '', '/' + location.search);
  closeReader();
}
// Back/forward and reader links: the URL decides whether the reader is open and on what. Old #read=<url> links
// still open, and are rewritten to the short form.
function syncFromUrl() {
  const path = location.pathname.match(/^\/read\/([^/]+)/);
  const url = path ? slugs.get(decodeURIComponent(path[1]))
    : location.hash.startsWith('#read=') ? decodeURIComponent(location.hash.slice(6)) : null;
  const i = url && items.find(x => x.url === url);
  if (i && readerFor !== url) openReader(i, { fromHash: true });
  else if (!i && document.body.classList.contains('reading')) closeReader();
  else if (!i && path) history.replaceState(null, '', '/' + location.search);  // a story that's since left the site
}
addEventListener('popstate', syncFromUrl);
// Swipe right to close: the reader follows the finger, then closes past a third of its width or on a flick
// (judged on the finger's speed at release, px/ms).
let drag = null;
const setDrag = f => document.documentElement.style.setProperty('--drag', f);
function dragStart(x) { drag = { x, dx: 0, lx: x, lt: performance.now(), v: 0 }; document.body.classList.add('dragging'); }
function dragMove(x) {
  if (!drag) return;
  const now = performance.now();
  if (now > drag.lt) drag.v = 0.6 * drag.v + 0.4 * (x - drag.lx) / (now - drag.lt);
  drag.lx = x; drag.lt = now;
  drag.dx = Math.max(0, x - drag.x);
  setDrag(Math.min(1, drag.dx / $('reader').offsetWidth));
}
function dragEnd() {
  if (!drag) return;
  const { dx, v } = drag, flick = dx > 40 && v > 0.4;
  drag = null;
  document.body.classList.remove('dragging');
  if (dx > $('reader').offsetWidth / 3 || flick) dismiss();
  setDrag(0);  // the closed state ignores --drag; the open state springs back
}
// Touches on the reader's own chrome (the bar, messages). Framed original pages can't report touches.
let touch = null;
$('reader').addEventListener('touchstart', e => { const t = e.touches[0]; touch = { x: t.screenX, y: t.screenY, ax: null }; }, { passive: true });
$('reader').addEventListener('touchmove', e => {
  if (!touch) return;
  const t = e.touches[0], dx = t.screenX - touch.x, dy = t.screenY - touch.y;
  if (!touch.ax && Math.hypot(dx, dy) > 10) { touch.ax = dx > Math.abs(dy) ? 'x' : 'y'; if (touch.ax === 'x') dragStart(touch.x); }
  if (touch.ax === 'x') { e.preventDefault(); dragMove(t.screenX); }
}, { passive: false });
$('reader').addEventListener('touchend', () => { if (touch?.ax === 'x') dragEnd(); touch = null; });
$('reader').addEventListener('touchcancel', () => { if (touch?.ax === 'x') dragEnd(); touch = null; });
// Swipes inside the article frame arrive as messages from the swipe reporter.
addEventListener('message', e => {
  const frame = $('reader-body').querySelector('iframe');
  if (!frame || e.source !== frame.contentWindow || typeof e.data?.tw !== 'string') return;
  if (e.data.tw === 'start') dragStart(e.data.x);
  else if (e.data.tw === 'move') dragMove(e.data.x);
  else if (e.data.tw === 'end') dragEnd();
  else if (e.data.tw === 'key') onKey(e.data.key, !!e.data.mod);
  else if (e.data.tw === 'themed') frameThemed?.();
});

$('reader-close').onclick = dismiss;
$('reader-backdrop').onclick = dismiss;
// j/k or →/←: next/previous article (in the reader it switches articles in place); /: search bar; Cmd/Ctrl+K: search palette.
function step(dir) {
  if (document.body.classList.contains('reading')) {
    const next = shown[shown.findIndex(i => i.url === readerFor) + dir];
    if (!next) return;
    if (shown.indexOf(next) >= limit) { limit += PAGE; renderPage(); }
    return openReader(next);
  }
  const cards = [...document.querySelectorAll('a.card')];
  const at = cards.indexOf(document.activeElement);
  const target = cards[at < 0 ? 0 : Math.min(cards.length - 1, Math.max(0, at + dir))];
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'nearest' });
}
function onKey(key, mod, e) {
  const reading = document.body.classList.contains('reading');
  if ($('keys').open) return;  // the dialog handles its own Esc
  if (key === 'escape' && !$('size-pop').hidden) { closeSize(); return $('reader-size').focus(); }
  if (key === 'escape' && !$('send-pop').hidden) { closeShare(); return $('reader-send').focus(); }
  if (key === 'escape' && reading) return dismiss();
  if (key === 'k' && mod) { e?.preventDefault(); return openPalette(); }
  if (mod || e?.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (key === '?') { e?.preventDefault(); $('keys').showModal(); }
  else if (key === '/' && !reading) { e?.preventDefault(); openPalette(); }
  else if (key === 'j' || key === 'arrowright') { e?.preventDefault(); step(1); }
  else if (key === 'k' || key === 'arrowleft') { e?.preventDefault(); step(-1); }
}
addEventListener('keydown', e => onKey(e.key.toLowerCase(), e.metaKey || e.ctrlKey, e));
$('keys').addEventListener('click', e => { if (e.target === $('keys')) $('keys').close(); });  // a click on the backdrop

// Share the publisher's article, not this site's reader link: that's what the recipient wants.
// The browser's own share sheet where it has one (phones, and Chrome, Edge and Safari on Windows and Mac); otherwise a menu.
// The same menu everywhere; where the browser has a share sheet, "More…" opens it.
const shareKind = /Android/i.test(navigator.userAgent) ? 'android' : 'apple';  // which icon
$('reader-send').dataset.kind = shareKind;
$('send-more').hidden = !navigator.share;
const closeShare = () => { $('send-pop').hidden = true; $('reader-send').setAttribute('aria-expanded', 'false'); };
$('reader-send').onclick = async e => {
  e.stopPropagation();
  const i = items.find(x => x.url === readerFor);
  if (!i) return;
  const open = $('send-pop').hidden;
  closeMenus();
  if (!open) return;
  const u = encodeURIComponent(i.url), t = encodeURIComponent(i.title);
  sendTo = {
    'send-email': `mailto:?subject=${t}&body=${u}`,
    'send-bluesky': `https://bsky.app/intent/compose?text=${encodeURIComponent(`${i.title} ${i.url}`)}`,
    'send-reddit': `https://www.reddit.com/submit?url=${u}&title=${t}`,
    'send-linkedin': `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
  };
  $('send-pop').hidden = false;
  $('reader-send').setAttribute('aria-expanded', 'true');
  $('send-copy').focus({ preventScroll: true });
};
function closeMenus() { closeSize(); closeShare(); }
let sendTo = {};
// Opened on click, not as links: ad blockers hide links whose address is a share page.
$('send-pop').onclick = e => {
  e.stopPropagation();
  const id = e.target.closest('button')?.id;
  if (id === 'send-more') {
    closeShare();
    const i = items.find(x => x.url === readerFor);
    if (i) navigator.share({ title: i.title, url: i.url }).catch(() => {});  // dismissed
    return;
  }
  const url = sendTo[id];
  if (!url) return;
  closeShare();
  if (url.startsWith('mailto:')) location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');
};
document.addEventListener('click', closeShare);
addEventListener('blur', closeShare);
$('send-copy').onclick = async () => {
  closeShare();
  const i = items.find(x => x.url === readerFor);
  if (!i) return;
  let msg = 'Copied';
  try { await navigator.clipboard.writeText(i.url); } catch { msg = 'Couldn\u2019t copy'; }
  const done = $('send-done');
  done.textContent = msg; done.hidden = false; $('status').textContent = msg === 'Copied' ? 'Link copied' : msg;
  clearTimeout(done.timer);
  done.timer = setTimeout(() => { done.hidden = true; }, 1600);
};
if (matchMedia('(pointer: fine)').matches) {
  $('search-kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  $('search-kbd').hidden = false;
}

// Cmd/Ctrl+K palette: find any article and open it in the reader. Works over the reader too.
const pal = { results: [], sel: 0, returnTo: null };
const LAYERS = '.feed, #top, #reader';
function openPalette() {
  if (!$('palette').hidden) return $('palette-q').select();
  pal.returnTo = document.activeElement;
  document.querySelectorAll(LAYERS).forEach(el => { el.dataset.wasInert = el.inert ? '1' : ''; el.inert = true; });
  $('palette').hidden = $('palette-backdrop').hidden = false;
  $('palette-q').value = '';
  renderPalette();
  $('palette-q').focus();
}
function closePalette(restoreFocus = true) {
  $('palette').hidden = $('palette-backdrop').hidden = true;
  document.querySelectorAll(LAYERS).forEach(el => { el.inert = el.dataset.wasInert === '1'; });
  if (restoreFocus) pal.returnTo?.focus?.({ preventScroll: true });
}
function renderPalette() {
  const q = $('palette-q').value.trim(), ql = q.toLowerCase();
  // Title matches rank above summary/publisher matches; within a rank, items stay newest first.
  const rank = i => {
    if (!ql) return 1;
    const t = i.title.toLowerCase();
    if (t.includes(ql)) return t.startsWith(ql) ? 3 : 2;
    return `${i.summary} ${i.publisher} ${domain(i.url)}`.toLowerCase().includes(ql) ? 1 : 0;
  };
  // Every match: it's the only search now, and 90 days of stories is a few hundred at most.
  pal.results = items.map(i => [rank(i), i]).filter(([r]) => r).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  pal.sel = 0;
  $('palette-list').innerHTML = pal.results.length ? pal.results.map((i, n) => { const c = cat(i.category); return `
    <li role="option" id="p-${n}" data-n="${n}" aria-selected="${n === 0}">
      <span class="dot" style="--c:var(--cat-${c})"></span>
      <div><div class="p-title">${highlight(i.title, q)}</div><div class="p-meta">${esc(i.publisher)} · ${CATS[c]} · ${dayLabel(i.date)}</div></div>
    </li>`; }).join('') : `<li class="palette-empty">No articles match “${esc(q)}”.</li>`;
  $('palette-q').setAttribute('aria-activedescendant', pal.results.length ? 'p-0' : '');
}
function selectPalette(n, scroll = true) {
  if (!pal.results.length) return;
  pal.sel = (n + pal.results.length) % pal.results.length;
  $('palette-list').querySelectorAll('li[data-n]').forEach(li => li.setAttribute('aria-selected', +li.dataset.n === pal.sel));
  $('palette-q').setAttribute('aria-activedescendant', 'p-' + pal.sel);
  if (scroll) $('p-' + pal.sel).scrollIntoView({ block: 'nearest' });
}
function choosePalette(n = pal.sel) {
  const i = pal.results[n];
  if (!i) return;
  closePalette(false);
  openReader(i);
}
$('palette-q').addEventListener('input', renderPalette);
$('palette-q').addEventListener('keydown', e => {
  e.stopPropagation();  // keep page shortcuts (Escape closing the reader, j/k) out of the palette
  if (e.key === 'ArrowDown') { e.preventDefault(); selectPalette(pal.sel + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectPalette(pal.sel - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); choosePalette(); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette-q').select(); }
});
$('palette-list').addEventListener('click', e => { const li = e.target.closest('li[data-n]'); if (li) choosePalette(+li.dataset.n); });
$('palette-list').addEventListener('mousemove', e => { const li = e.target.closest('li[data-n]'); if (li && +li.dataset.n !== pal.sel) selectPalette(+li.dataset.n, false); });
$('palette-backdrop').addEventListener('click', () => closePalette());
document.addEventListener('auxclick', e => { const a = e.target.closest('a.card, a.weekly-card'); if (a && e.button === 1) markRead(a.getAttribute('href')); });
// Plain clicks on an article open the reader; modified and middle clicks still open the site.
document.addEventListener('click', e => {
  const a = e.target.closest('a.card, a.weekly-card');
  if (!a) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return markRead(a.getAttribute('href'));
  const i = items.find(x => x.url === a.getAttribute('href'));
  if (!i) return;
  e.preventDefault();
  openReader(i);
});

syncThemeColor();
load().catch(() => { $('items').innerHTML = '<p class="empty">Couldn’t load the news. Try again in a bit.</p>'; });
// Builds land every ~4h: check every 15 min while visible, and when the tab comes back into view.
const check = () => { if (!document.hidden) load().catch(() => {}); };
setInterval(check, 15 * 60e3);
setInterval(() => { if (generatedAt && !document.hidden) showUpdated(); }, 60e3);
document.addEventListener('visibilitychange', check);
