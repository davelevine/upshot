const CATS = { security: 'Security', ai: 'AI', infrastructure: 'Infrastructure', engineering: 'Engineering', regulation: 'Regulation', other: 'Other' };
const ORDER = ['ai', 'infrastructure', 'engineering', 'security', 'regulation', 'other'];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cat = c => (c in CATS ? c : 'other');
const domain = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const PAGE = 40;
const STALE_MINUTES = 5 * 60;  // builds land every 4h, give or take GitHub's scheduling: this is one running 45+ minutes late
const KEEP_DAYS = 90;  // build.py prunes older stories
// Wide screens dock the reader beside the list, as Feedbin does, and the list scrolls on its own; elsewhere the window scrolls it.
const docked = matchMedia('(min-width: 1024px)');
const scroller = () => (docked.matches ? $('col') : document.scrollingElement);
// The latest entry decides: a batch can hold an older one from before the last redraw, and reading that stopped the feed short of its end.
// Watched against whichever scrolls the list, so the 800px head start applies to it.
let io;
function watchEnd() {
  io?.disconnect();
  io = new IntersectionObserver(es => { if (es.at(-1).isIntersecting && limit < shown.length) { limit += PAGE; renderPage(); } },
    { root: docked.matches ? $('col') : null, rootMargin: '800px' });
  io.observe($('sentinel'));
}
watchEnd();
docked.addEventListener('change', watchEnd);
let tz, iconArt = {}, icons = new Set(), items = [], filter = 'all', shown = [], limit = PAGE, generatedAt = null, picks = new Map();  // picks: url -> what to do
const label = f => (f === 'all' ? 'All' : f === 'essentials' ? 'Essentials' : CATS[f]);

// Today in the site's time zone (data.json's tz), not the device's: some browsers report UTC for privacy, which
// turned the evening's stories into a day old.
function todayIso() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const dayNumber = iso => Date.UTC(...iso.split('-').map((n, k) => +n - (k === 1))) / 864e5;
// How long ago it was published, as Feedbin shows it: 21m, 5h, 3d, then the date. A calmer list than a count per day.
// Stories from before the build kept the exact time only have a date: whole days, counted in the site's time zone,
// or the time it reached the site when that was the same day.
function ageMins(i) {
  const days = dayNumber(todayIso()) - dayNumber(i.date);
  return !i.published && !(i.added && days <= 0) ? Math.max(0, days) * 1440 : (Date.now() - Date.parse(i.published || i.added)) / 60e3;
}
function age(i) {
  const mins = ageMins(i);
  if (mins < 60) return `${Math.max(1, Math.floor(mins))}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 7 * 1440) return `${Math.floor(mins / 1440)}d`;
  const d = new Date(i.date + 'T12:00:00Z'), year = i.date.slice(0, 4) !== todayIso().slice(0, 4);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }), timeZone: 'UTC' });
}
const ageHtml = i => `<time class="card-age" datetime="${esc(i.published || i.added || i.date)}">${age(i)}</time>`;
const refreshAges = () => document.querySelectorAll('a.card').forEach(a => {
  const i = items.find(x => x.url === a.getAttribute('href')), t = a.querySelector('.card-age');
  if (i && t) t.textContent = age(i);
});

function highlight(text, q) {
  if (!q) return esc(text);
  // Split the raw text, then escape each piece, so a <mark> never lands inside an entity like &#39;.
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.split(re).map((part, n) => n % 2 ? `<mark>${esc(part)}</mark>` : esc(part)).join('');
}

function renderFilters() {
  // Unread stories, as in a feed reader: the counts go down as you read. Topics with stories stay listed at 0.
  const counts = {}, unread = {}, unreadAll = items.filter(isUnread).length;
  for (const i of items) {
    counts[cat(i.category)] = (counts[cat(i.category)] || 0) + 1;
    if (isUnread(i)) unread[cat(i.category)] = (unread[cat(i.category)] || 0) + 1;
  }
  const unreadPicks = items.filter(i => picks.has(i.url) && isUnread(i)).length;
  const btn = (f, n, mark) => `<button class="filter-btn${filter === f ? ' active' : ''}" data-f="${f}" aria-pressed="${filter === f}">` +
    `<span class="f-mark" aria-hidden="true">${mark}</span><span class="f-name">${label(f)}</span>${n ? `<span class="f-count">${n}<span class="sr-only"> unread</span></span>` : ''}</button>`;
  $('filters').innerHTML = btn('all', unreadAll, '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>') +
    (picks.size ? btn('essentials', unreadPicks, '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>') : '') +
    '<h2 class="f-head">Topics</h2>' + ORDER.filter(c => counts[c] || filter === c).map(c => btn(c, unread[c] || 0, `<span class="dot" style="--c:var(--cat-${c})"></span>`)).join('');
  $('list-name').textContent = label(filter);  // phones: the list's name above it, so a filter never makes stories look missing
  document.title = filter === 'all' ? 'Upshot \u00b7 The week\u2019s tech news, minus the noise' : `${label(filter)} \u00b7 Upshot`;
}

function renderItems(keepLimit) {
  const ql = $('search').value.trim().toLowerCase();
  shown = items.filter(i => (filter === 'all' || (filter === 'essentials' ? picks.has(i.url) : cat(i.category) === filter)) &&
    (!ql || `${i.title} ${i.summary} ${i.publisher} ${domain(i.url)}`.toLowerCase().includes(ql)));
  $('status').textContent = ql ? `${shown.length} articles found` : '';
  if (!keepLimit) limit = PAGE;
  renderPage();
}

// Renders the first `limit` matches; the sentinel below the list raises it as you scroll.
function renderPage() {
  const q = $('search').value.trim();
  // No headings or counts: the list starts at the top, each story says how old it is, and the sidebar says which list it is.
  $('items').innerHTML = shown.length ? `
    ${shown.slice(0, limit).map(i => { const ess = picks.has(i.url), why = filter === 'essentials' && picks.get(i.url), preview = why || i.summary; return `
    <a class="card${isRead(i.url) ? ' read' : ''}${ess ? ' essential' : ''}" href="${esc(i.url)}" target="_blank" rel="noopener"${i.url === readerFor ? ' aria-current="true"' : ''}>
      ${iconHtml(i.publisher)}
      <div class="card-body">
        <div class="card-title">${highlight(i.title, q)}</div>
        <div class="card-meta"><span class="card-src">${esc(i.publisher)}</span>${ess && filter !== 'essentials' ? '<span class="ess">Essential</span>' : ''}${isNew(i) ? '<span class="new">New</span>' : ''}</div>
        ${preview ? `<div class="card-sum">${why ? '<b>What to do: </b>' : ''}${highlight(preview, q)}</div>` : ''}
        ${ageHtml(i)}
      </div>
    </a>`; }).join('')}`
    : '<p class="empty">No articles match your search.</p>';
  $('items').removeAttribute('aria-busy');
  if (generatedAt) showUpdated();  // the feed was just redrawn, and its "Updated" with it
  io.unobserve($('sentinel'));
  io.observe($('sentinel'));
  const ended = shown.length && limit >= shown.length;
  $('end').hidden = !ended;
  if (ended) {
    // A topic is where the stories are ("3 stories in Other"), not a word about them ("3 Other stories").
    const n = shown.length, what = filter === 'essentials' ? `essential${n === 1 ? '' : 's'}`
      : `stor${n === 1 ? 'y' : 'ies'}${filter === 'all' ? '' : ` in ${label(filter)}`}`;
    const days = Math.min(KEEP_DAYS, Math.ceil((Date.now() - Date.parse(items.reduce((o, i) => (i.date < o ? i.date : o), items[0].date))) / 864e5));
    const scope = q ? ` matching \u201c${q}\u201d` : filter === 'all' ? ` from the last ${days} days`
      : filter === 'essentials' && weekly?.window_start ? ` from ${weekRange(weekly)}` : '';  // the real span: a young site hasn't reached KEEP_DAYS
    $('end-msg').textContent = `That\u2019s ${n === 1 ? 'the only' : `all ${n}`} ${what}${scope}.`;
  }
}

// "Nov 3–9", or "Oct 29 – Nov 4": the picks come from a rolling seven days, not a calendar week.
function weekRange(w) {
  const md = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const [a, b] = [md(w.window_start), md(w.window_end)];
  return a.split(' ')[0] === b.split(' ')[0] ? `${a}–${b.split(' ')[1]}` : `${a} – ${b}`;
}
// The week's essentials: their own entry in the topics, and marked where they appear in the feed.
function setPicks(weekly) {
  const urls = new Set(items.map(i => i.url));
  picks = new Map((weekly?.items || []).filter(p => urls.has(p.url)).map(p => [p.url, p.why]));
  if (filter === 'essentials' && !picks.size) filter = 'all';
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
$('filters').onclick = e => {
  const b = e.target.closest('.filter-btn');
  if (!b) return;
  const same = b.dataset.f === filter && lastList !== null;  // back into the list just left, on a phone
  filter = b.dataset.f;
  if (!same) lastClosed = null;  // a new list: nothing to swipe back into
  if (document.body.classList.contains('reading')) dismiss();  // as in Feedbin: picking a topic, even the current one, closes the story
  renderFilters();
  if (!(same && phone.matches)) renderItems();
  if (phone.matches && document.body.classList.contains('home')) enterList(same);  // into the list, as a page: back returns to the topics
  else if (history.state?.list) history.replaceState({ ...history.state, f: filter }, '');
};
// Phones open on the topics (home); a topic's list is a history entry above it, so back, the chevron and swipe-back return.
const phone = matchMedia('(max-width: 640px)');
phone.addEventListener('change', () => syncHome());
function syncHome() {
  const st = history.state, home = !st?.list && !st?.reader;
  document.body.classList.toggle('home', home);
  setPd(null);  // a swipe that brought it here hands over to the state's own position
  $('col').inert = phone.matches && home;  // the page that's aside can't be reached
  $('filters').inert = phone.matches && !home;
  $('list-back').inert = $('search-btn').inert = phone.matches && home;  // faded out: out of reach too
  document.querySelector('.logo-h').inert = phone.matches && !home;
  syncTicker();
  if (st?.f && st.f !== filter && (st.f !== 'essentials' || picks.size)) { filter = st.f; renderFilters(); renderItems(); }
}
let lastList = null;  // the list a swipe left on the topics goes back into (the filter is still set to it)
const setPd = v => (v == null ? document.documentElement.style.removeProperty('--pd') : document.documentElement.style.setProperty('--pd', v));
function enterList(same) {
  history.pushState({ list: true, f: filter }, '', location.pathname + location.search);
  syncHome();  // the list slides in over the topics (CSS)
  if (!same) scrollTo(0, 0);  // the same list again keeps its place
}
function leaveList() {
  lastList = filter;
  if (history.state?.list) history.back();  // popstate slides it out
  else { history.replaceState(null, ''); syncHome(); }
}
$('list-back').onclick = leaveList;
// The search bar opens the palette, the same search as ⌘K, rather than filtering the feed in place.
$('search').addEventListener('focus', () => { $('search').blur(); openPalette(); });
$('search-btn').onclick = () => openPalette();  // phones: the header's own
addEventListener('scroll', () => { $('top').hidden = scroller().scrollTop < 800; }, { passive: true, capture: true });  // capture: the list's own scrolling doesn't bubble
$('top').onclick = () => scroller().scrollTo({ top: 0, behavior: 'smooth' });

// Read and "new since last visit" state lives only in this browser.
let weekly = null;
const readSet = new Set(JSON.parse(localStorage.getItem('read') || '[]'));
const seenUntil = localStorage.getItem('seenUntil');  // the build you'd seen by the end of your last visit
// A first visit starts with only the last day unread, as a feed reader does with a new subscription: older stories count as
// read. After that, anything added since counts. `kept`: older stories marked unread by hand, which the cutoff would hide.
const FRESH_MS = 864e5, FRESH_MIN = 5;  // the last day, or the newest five after a quiet stretch
const arrived = i => Date.parse(i.added || i.published || i.date);
let since = localStorage.getItem('since');
const kept = new Set(JSON.parse(localStorage.getItem('kept') || '[]'));
const saveKept = () => localStorage.setItem('kept', JSON.stringify([...kept]));
const older = url => { const i = items.find(x => x.url === url); return !i || arrived(i) <= Date.parse(since); };
const isRead = url => readSet.has(url) || (older(url) && !kept.has(url));
const isUnread = i => !isRead(i.url);
const isNew = i => !!(seenUntil && i.added && i.added > seenUntil && !readSet.has(i.url));
const saveRead = () => localStorage.setItem('read', JSON.stringify([...readSet]));
function pruneRead() {
  const urls = new Set(items.map(i => i.url));
  for (const u of readSet) if (!urls.has(u)) readSet.delete(u);
  for (const u of kept) if (!urls.has(u)) kept.delete(u);
  saveRead(); saveKept();
}
const cardFor = url => [...document.querySelectorAll('a.card')].find(a => a.getAttribute('href') === url);
function markRead(url) {
  const was = isRead(url);
  readSet.delete(url); readSet.add(url); saveRead();
  if (kept.delete(url)) saveKept();  // most recent last: the search panel's "Recently read" reads it backwards
  if (!was) renderFilters();
  const card = cardFor(url);
  card?.classList.add('read');
  card?.querySelector('.new')?.remove();
}
function markUnread(url) {
  readSet.delete(url); saveRead();
  if (older(url)) { kept.add(url); saveKept(); }
  cardFor(url)?.classList.remove('read');
  renderFilters();
}
// The reader's read/unread switch, after Feedbin's: opening a story marks it read; this takes that back.
function syncUnread() {
  const unread = !!readerFor && !isRead(readerFor), label = unread ? 'Mark as read' : 'Mark as unread';
  $('reader-unread').classList.toggle('unread', unread);
  $('reader-unread').setAttribute('aria-label', label);
  $('reader-unread').title = label;
}
function toggleRead() {
  if (!readerFor) return;
  if (isRead(readerFor)) markUnread(readerFor); else markRead(readerFor);
  syncUnread();
  $('status').textContent = isRead(readerFor) ? 'Marked as read' : 'Marked as unread';
}
$('reader-unread').onclick = toggleRead;
const rememberSeen = () => { if (generatedAt) localStorage.setItem('seenUntil', generatedAt); };
addEventListener('pagehide', rememberSeen);
document.addEventListener('visibilitychange', () => { if (document.hidden) rememberSeen(); });

// "Updated 2h ago" at the top of the feed; a number that keeps growing means builds have stopped.
const agoText = mins => (mins < 1 ? 'just now' : mins < 60 ? `${Math.floor(mins)}m ago`
  : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`);
function showUpdated() {
  const el = $('updated'), mins = Math.max(0, (Date.now() - Date.parse(generatedAt)) / 60e3);  // none on an empty feed
  el.dateTime = generatedAt;
  el.title = new Date(generatedAt).toLocaleString();
  const ago = agoText(mins);
  el.innerHTML = `<span>Updated </span>${ago}`;
  $('stale').hidden = mins < STALE_MINUTES;
  el.hidden = !$('stale').hidden;  // one slot, two states: the bar says the same thing, where it can be acted on
  if (!checking) $('stale-msg').textContent = `Last updated ${ago}`;
}
// The late bar's one action: look for a new build now, rather than at the next 15-minute check.
let checking = false;
$('stale-check').onclick = async () => {
  const b = $('stale-check'), before = generatedAt;
  checking = true; b.disabled = true; b.classList.add('checking');
  try { await load(); } catch {}
  b.disabled = false; b.classList.remove('checking');
  if (generatedAt !== before) { checking = false; return showUpdated(); }  // new stories: the list redrew, and the bar goes
  $('stale-msg').textContent = $('status').textContent = 'No new stories yet';
  setTimeout(() => { checking = false; showUpdated(); }, 2500);
};
// Redraws only when a new build has landed, keeping the filter, search and loaded depth.
function load() {
  return fetch('/data.json', { cache: 'no-cache' })  // absolute: the page is also served at /read/…
.then(r => r.json()).then(data => {
    if (data.generated_at === generatedAt) return;
    const refresh = generatedAt !== null;
    generatedAt = data.generated_at;
    showUpdated();
    items = data.items || [];
    if (!since) {  // just before the fifth newest, if the last day holds fewer
      const fifth = items.map(arrived).sort((a, b) => b - a)[FRESH_MIN - 1] ?? Infinity;
      localStorage.setItem('since', since = new Date(Math.min(Date.parse(generatedAt) - FRESH_MS, fifth - 1)).toISOString());
    }
    try { tz = data.tz && new Intl.DateTimeFormat('en-US', { timeZone: data.tz }) && data.tz; } catch { tz = undefined; }  // unknown zone: the device's
    indexSlugs();
    // Newest first, by the same age each row shows, so the list never reads 7h, 15h, 11h. Stable: score breaks ties.
    items = items.map(i => [ageMins(i), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    weekly = data.weekly;
    icons = new Set(data.icons || []);
    iconArt = data.iconArt || {};
    pruneRead();
    setPicks(data.weekly);
    renderFilters();
    renderItems(refresh);
    if (!refresh) {  // where the page starts is no move: no slide
      document.body.classList.add('paging');
      syncFromUrl(); syncHome();
      requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('paging')));
      if (passDue()) { if (document.hidden) tickOnShow = true; else playTicker(); }  // opened, not just refreshed: one pass
      (window.requestIdleCallback || (f => setTimeout(f, 1000)))(loadFrameFonts);  // ahead of the first article
    }
  });
}
let readerFor = null;
// Docked, the list stays usable while an article is open.
const setInert = () => {
  const off = document.body.classList.contains('reading') && !docked.matches;
  document.querySelectorAll('.feed, #top').forEach(el => { el.inert = off; });
  $('reader').setAttribute('aria-modal', String(!docked.matches));
};
docked.addEventListener('change', setInert);  // resizing never strands an inert list
const markCurrent = url => document.querySelectorAll('a.card').forEach(a => {
  if (url && a.getAttribute('href') === url) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
});

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// Inside the article frame, the only script allowed is this one. It must pass two policies: the frame's own (by nonce)
// and the page's, which a srcdoc frame inherits (by hash, in site/_headers; tests/csp.test.js keeps it current). It reports rightward swipes to the
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
  if (!e.altKey && ['escape', 'j', 'k', 'm', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); parent.postMessage({ tw: 'key', key: k, mod: e.metaKey || e.ctrlKey }, '*'); }
});`;

// The article frame's fonts: Inter for its headings, Literata for the article. A sandboxed frame has an opaque origin,
// which the browser caches apart every time, so a font loaded there by URL was downloaded afresh for every frame (two
// per article) and flashed the fallback meanwhile. The page fetches each once instead, cached as usual, and hands it to
// every frame inline. Until one arrives, a frame loads it by URL as before.
const FRAME_FONTS = { inter: '/fonts/InterVariable.woff2', literata: '/fonts/LiterataVariable.woff2', literataItalic: '/fonts/LiterataVariable-Italic.woff2' };
const frameFonts = {};
const frameFont = k => frameFonts[k] || location.origin + FRAME_FONTS[k];
function loadFrameFonts() {
  for (const [k, url] of Object.entries(FRAME_FONTS)) {
    // Without credentials, as the page's preload of Inter asks, so the preloaded copy is reused rather than fetched again.
    fetch(url, { credentials: 'omit' }).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => new Promise(done => {
      const read = new FileReader();
      read.onload = () => { frameFonts[k] = read.result; done(); };
      read.readAsDataURL(b);
    })).catch(() => {});  // the URL still works
  }
}
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
// The publisher's icon, or its initial when the build found none, so a row or the reader bar never starts blank.
function iconFor(publisher) {
  const slug = iconSlug(publisher);
  return { has: icons.has(slug), src: `/icons/${slug}.png`, art: iconArt[slug] || '', mono: (publisher.match(/[a-z0-9]/i) || ['·'])[0].toUpperCase() };
}
const iconHtml = publisher => { const f = iconFor(publisher); return f.has
  ? `<img class="src-icon" src="${f.src}" alt="" width="20" height="20" loading="lazy" decoding="async" data-art="${f.art}">`
  : `<span class="src-icon src-mono" aria-hidden="true">${esc(f.mono)}</span>`; };
// Under the title, like Feedbin: when and by whom, and how long. Where it's from is in the bar above.
function storyMeta(i, byline, minutes) {
  const [y, m, d] = i.date.split('-').map(Number);
  const when = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  // Bylines sometimes carry their own date: "Posted on November 8, 2026 by audra", "By Ada | Tuesday, October 27, 2026".
  let by = (byline || '').replace(/\s+/g, ' ').replace(/\s*\|.*$/, '').replace(/^(posted|published|updated)\b.*?\bby\s+/i, '').replace(/^by\s+/i, '').trim();
  if (/\b\d{4}\b/.test(by) && !Number.isNaN(Date.parse(by))) by = '';  // nothing left but a date
  return `<div class="meta">${esc(when)}${by ? ` by ${esc(by)}` : ''}${minutes ? ` · ${minutes} min read` : ''}</div>`;
}
// The upshot (written and checked by the build) with, for weekly essentials, the hand-picked "What to do" as its last line.
function summaryBox(tldr, why) {
  if (!tldr?.length) return why ? `<div class="todo"><b>What to do</b>${esc(why)}</div>` : '';
  return `<div class="todo tldr"><b>The upshot</b><ul>${tldr.map(t => `<li>${esc(t)}</li>`).join('')}</ul>${why ? `<p class="do"><b>What to do</b>${esc(why)}</p>` : ''}</div>`;
}
function articleDoc(i, html, nonce, why, minutes, byline) {
  return `<!doctype html><html data-theme="${document.documentElement.dataset.theme}" data-size="${textSize}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${location.origin} data:; img-src https: data:; media-src https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<base target="_blank"><style>
:root { ${frameVars('light')} } :root[data-theme="dark"] { ${frameVars('dark')} }
body { margin: 0; background: var(--bg); color: var(--text); font: 1.125rem/1.65 Literata, "Iowan Old Style", Charter, Georgia, serif; overflow-wrap: break-word; }
main { max-width: 640px; margin: 0 auto; padding: 32px 24px 96px; }
a { color: var(--accent); }
h1 { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; margin: 0 0 .4em; font-size: clamp(1.4rem, 1rem + 2vw, 1.75rem); font-weight: 700; line-height: 1.2; letter-spacing: -.01em; }
h1 a { color: inherit; text-decoration: none; } h1 a:hover { text-decoration: underline; text-decoration-thickness: 2px; }
@font-face { font-family: Inter; src: url("${frameFont('inter')}") format("woff2"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: Literata; src: url("${frameFont('literata')}") format("woff2"); font-weight: 400 700; font-style: normal; font-display: swap; }
@font-face { font-family: Literata; src: url("${frameFont('literataItalic')}") format("woff2"); font-weight: 400 700; font-style: italic; font-display: swap; }
h1 { font-family: Inter, system-ui, sans-serif; letter-spacing: -.01em; }
[data-size="0"] body { font-size: 1.0625rem; } [data-size="2"] body { font-size: 1.25rem; } [data-size="3"] body { font-size: 1.375rem; }  /* a step up for Literata's smaller x-height (0.507) */
.meta { margin-bottom: 1.8em; color: var(--text-muted); font: .88em/1.45 Inter, system-ui, sans-serif; }  /* em: follows the text size */
.todo { margin: 0 0 1.8em; padding: 12px 16px; border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; background: var(--bg-card); }
.tldr ul { margin: .35em 0 0; padding-left: 1.15em; font: .94em/1.5 Inter, system-ui, sans-serif; } .tldr li + li { margin-top: .45em; }  /* sans: scanned, not read */
.tldr .do { margin: .8em 0 0; padding-top: .7em; border-top: 1px solid var(--border); font: 500 .94em/1.5 Inter, system-ui, sans-serif; } .tldr .do b { font-size: .875em; }
.todo b { display: block; margin-bottom: 2px; color: var(--accent); font: 700 .82em/1.5 Inter, system-ui, sans-serif; letter-spacing: .07em; text-transform: uppercase; }  /* the box's sizes are em too */
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
</style><script nonce="${nonce}">${SWIPE_REPORTER}<\/script></head><body><main><h1><a href="${esc(i.url)}" target="_blank" rel="noopener" title="Open the original">${esc(i.title)}</a></h1>${storyMeta(i, byline, minutes || i.minutes)}${summaryBox(i.tldr, why)}${html}</main></body></html>`;
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
  frame.srcdoc = articleDoc(i, html, btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))), why, minutes, byline);  // not randomUUID: that needs HTTPS, which a dev server reached by address isn't
  mountFrame(frame);
}
// Loads behind whatever's showing and takes over once drawn, so the pane never blinks empty between frames.
function mountFrame(frame) {
  frame.classList.add('loading');
  frame.onload = () => {
    if (!frame.parentNode) return;
    while (frame.previousSibling) frame.previousSibling.remove();
    frame.classList.remove('loading');
    // Its srcdoc baked in the theme and size from when it was built; either may have changed while it loaded.
    frame.contentWindow.postMessage({ tw: 'theme', theme: document.documentElement.dataset.theme }, '*');
    frame.contentWindow.postMessage({ tw: 'size', size: String(textSize) }, '*');
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
// Articles fetched this visit, so reopening one is instant; only full articles, since a pending one may arrive later.
const articles = new Map();
let frameFor = null;  // whose article the reader's frame holds
function openReader(i, { fromHash = false } = {}) {
  const fresh = !document.body.classList.contains('reading');
  readerFor = i.url;
  markRead(i.url);
  syncUnread();
  const why = picks.get(i.url);
  const icon = iconFor(i.publisher);
  $('reader-icon').hidden = !icon.has;
  if (icon.has) $('reader-icon').src = icon.src;
  $('reader-icon').dataset.art = icon.art;
  $('reader-mono').hidden = icon.has;
  $('reader-mono').textContent = icon.mono;
  $('reader-source').textContent = i.publisher;
  const at = shown.findIndex(x => x.url === i.url);
  $('reader-prev').disabled = at <= 0;
  $('reader-next').disabled = at < 0 || at >= shown.length - 1;
  // Back into the story just closed: its frame is still there, scrolled where it was. Otherwise a stored article shows at
  // once, and a new one shows its card until the fetch upgrades it.
  const again = frameFor === i.url && articles.has(i.url) && $('reader-body').querySelector('iframe:not(.loading)');
  if (!again) showInReader(i, articles.has(i.url) ? articles.get(i.url).content : storyCard(i, 'Loading the full article…', true), why,
    articles.get(i.url)?.minutes, articles.get(i.url)?.byline);
  frameFor = i.url;
  document.body.classList.add('reading');
  $('reader').setAttribute('aria-hidden', 'false');
  setInert();
  markCurrent(i.url);
  syncTicker();
  if (docked.matches) cardFor(i.url)?.scrollIntoView({ block: 'nearest' });
  // pushed: this entry sits on top of the feed, so closing goes back. Opened from a link, it doesn't, or it would leave
  // the site. Kept in the entry, so it survives back and forward.
  if (fresh && !fromHash) history.pushState({ reader: true, pushed: true }, '', readPath(i.url));
  else history.replaceState({ ...history.state, reader: true }, '', readPath(i.url));
  if (fresh && !docked.matches) (lastInput === 'key' ? $('reader-close') : $('reader')).focus({ preventScroll: true });  // no ring after a tap; docked, focus stays in the list
  if (articles.has(i.url)) return;  // read once already this visit: articles don't change once stored
  let unreadable = 'The reader view isn\u2019t available right now.';
  fetch('/api/read?url=' + encodeURIComponent(i.url), { cache: 'no-store' }).then(r => r.json()).then(r => {
    if (r.content) articles.set(i.url, { content: r.content, minutes: readingMinutes(r.content), byline: r.byline });
    if (readerFor !== i.url) return;  // another article was opened meanwhile
    if (r.content) {
      const { minutes } = articles.get(i.url);
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
let lastClosed = null;  // what a swipe left on a phone's list brings back
function closeReader() {
  const url = readerFor;
  lastClosed = url;
  readerFor = null;
  document.body.classList.remove('reading');
  $('reader').setAttribute('aria-hidden', 'true');
  setInert();
  markCurrent(null);
  syncTicker();
  const card = url && cardFor(url);  // back to where you were, even after j/k through several articles
  if (card) {
    // Focus goes back to the row only after a key (no ring after a tap or swipe: one in the article's frame never reaches
    // this page, so the browser would take it for the keyboard).
    if (lastInput === 'key') card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest' });
  }
  // Docked, the pane empties at once. Sliding away, the frame stays, hidden, so swiping back into it finds it as it was.
  if (docked.matches) { $('reader-body').replaceChildren(); frameFor = null; }
}
function dismiss() {
  if (history.state?.pushed) return history.back();
  history.replaceState({ list: true, f: filter }, '', '/' + location.search);  // opened from a link: closing lands in its list, not the topics
  closeReader();
  syncHome();
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
addEventListener('popstate', e => {
  syncFromUrl();
  const home = !history.state?.list && !history.state?.reader;
  if (home && !document.body.classList.contains('home')) lastList = filter;
  // Safari's own swipe-back already animates the page: don't slide it a second time.
  if (e.hasUAVisualTransition) { document.body.classList.add('paging'); requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('paging'))); }
  syncHome();
});
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
  const ours = [...$('reader-body').querySelectorAll('iframe')].some(f => e.source === f.contentWindow);  // the loading one too
  if (!ours || typeof e.data?.tw !== 'string') return;
  if (e.data.tw === 'start') dragStart(e.data.x);
  else if (e.data.tw === 'move') dragMove(e.data.x);
  else if (e.data.tw === 'end') dragEnd();
  else if (e.data.tw === 'key') { lastInput = 'key'; onKey(e.data.key, !!e.data.mod); }  // a key in the article: the keyboard's in use
  else if (e.data.tw === 'themed') frameThemed?.();
});

// Phone swipes, after Feedbin's: the topics sit left of a list, and a list left of its story, and each page follows the
// finger. In a list, right goes back to the topics and left brings back the story just closed; on the topics, left goes
// back into the list just left. Past a third of the way, or on a flick, it goes; otherwise it springs back.
let pan = null;
addEventListener('touchstart', e => {
  const t = e.touches[0];
  pan = phone.matches && !document.body.classList.contains('reading') && !$('palette').open
    ? { x: t.screenX, y: t.screenY, lx: t.screenX, lt: performance.now(), v: 0, mode: null } : null;
}, { passive: true });
addEventListener('touchmove', e => {
  if (!pan) return;
  const t = e.touches[0], dx = t.screenX - pan.x, dy = t.screenY - pan.y, w = innerWidth, home = document.body.classList.contains('home');
  if (!pan.mode) {
    if (Math.hypot(dx, dy) < 10) return;
    if (Math.abs(dy) > Math.abs(dx)) { pan = null; return; }  // a scroll
    const story = lastClosed && items.find(x => x.url === lastClosed);
    pan.mode = home ? (dx < 0 && lastList !== null && (lastList !== 'essentials' || picks.size) ? 'list' : 'none')
      : dx > 0 ? 'topics' : story ? 'story' : 'none';
    if (pan.mode === 'none') { pan = null; return; }
    if (pan.mode === 'story') { document.body.classList.add('dragging'); setDrag(1); openReader(story); }  // in from the right, under the finger
    else document.body.classList.add('paging');
  }
  e.preventDefault();  // sideways now: the page moves, not the list
  const now = performance.now();
  if (now > pan.lt) pan.v = 0.6 * pan.v + 0.4 * (t.screenX - pan.lx) / (now - pan.lt);
  pan.lx = t.screenX; pan.lt = now;
  if (pan.mode === 'topics') setPd(Math.min(1, Math.max(0, dx / w)));
  else if (pan.mode === 'list') setPd(Math.min(1, Math.max(0, 1 + dx / w)));
  else setDrag(Math.min(1, Math.max(0, 1 + dx / w)));
}, { passive: false });
addEventListener('touchend', e => {
  if (!pan?.mode) { pan = null; return; }
  const { mode, x, v } = pan, dx = e.changedTouches[0].screenX - x, go = Math.abs(dx) > innerWidth / 3 || Math.abs(v) > 0.4 && Math.sign(v) === Math.sign(dx);
  pan = null;
  document.body.classList.remove('paging', 'dragging');  // from here the pages animate to where they settle
  if (mode === 'topics') { if (go) { setPd(1); leaveList(); } else setPd(null); }
  else if (mode === 'list') { if (go) enterList(true); else setPd(null); }
  else if (go) setDrag(0);
  else { setDrag(0); dismiss(); }
}, { passive: true });
addEventListener('touchcancel', () => { if (pan?.mode) { document.body.classList.remove('paging', 'dragging'); setPd(null); setDrag(0); } pan = null; });
$('reader-close').onclick = dismiss;
$('reader-backdrop').onclick = dismiss;
// j/k or →/←: next/previous article (in the reader it switches articles in place); /: search bar; Cmd/Ctrl+K: search palette.
function step(dir) {
  if (document.body.classList.contains('reading')) {
    const at = shown.findIndex(i => i.url === readerFor);
    const next = at < 0 ? null : shown[at + dir];  // filtered out: nowhere to step, as the disabled buttons say
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
  if ($('palette').open) {  // so does this one; j/k and Esc mustn't reach the reader behind it
    if (key === 'k' && mod) { e?.preventDefault(); openPalette(); }
    return;
  }
  if (key === 'escape' && !$('size-pop').hidden) { closeSize(); return $('reader-size').focus(); }
  if (key === 'escape' && !$('send-pop').hidden) { closeShare(); return $('reader-send').focus(); }
  if (key === 'escape' && reading) return dismiss();
  if (key === 'k' && mod) { e?.preventDefault(); return openPalette(); }
  if (mod || e?.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (key === '?') { e?.preventDefault(); $('keys').showModal(); }
  else if (key === '/' && !reading) { e?.preventDefault(); openPalette(); }
  else if (key === 'm' && reading) { e?.preventDefault(); toggleRead(); }
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
// A native modal <dialog>: the page behind goes inert, and Esc or the phone's back button close it.
const pal = { results: [], sel: 0 };
function openPalette() {
  if ($('palette').open) return $('palette-q').select();
  $('palette-q').value = '';
  renderPalette();
  $('palette').showModal();
  $('palette-q').focus();
}
function closePalette() { $('palette').close(); }
function renderPalette() {
  const q = $('palette-q').value.trim(), ql = q.toLowerCase();
  // Title matches rank above summary/publisher matches; within a rank, items stay newest first.
  const rank = i => {
    if (!ql) return 1;
    const t = i.title.toLowerCase();
    if (t.includes(ql)) return t.startsWith(ql) ? 3 : 2;
    return `${i.summary} ${i.publisher} ${domain(i.url)}`.toLowerCase().includes(ql) ? 1 : 0;
  };
  // Before typing: what you read last (or the newest few), not the whole feed again. Typing searches every story.
  let head = '';
  if (!ql) {
    const byUrl = Object.fromEntries(items.map(i => [i.url, i]));
    const recent = [...readSet].reverse().map(u => byUrl[u]).filter(Boolean).slice(0, 8);
    pal.results = recent.length ? recent : items.slice(0, 5);
    head = `<li class="palette-head" role="presentation">${recent.length ? 'Recently read' : 'Latest'}</li>`;
  } else {
    pal.results = items.map(i => [rank(i), i]).filter(([r]) => r).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  }
  pal.sel = 0;
  $('palette-list').innerHTML = head + (pal.results.length ? pal.results.map((i, n) => { const c = cat(i.category); return `
    <li role="option" id="p-${n}" data-n="${n}" aria-selected="${n === 0}">
      <span class="dot" style="--c:var(--cat-${c})"></span>
      <div><div class="p-title">${highlight(i.title, q)}</div><div class="p-meta">${esc(i.publisher)} · ${CATS[c]} · ${age(i)}</div></div>
    </li>`; }).join('') : `<li class="palette-empty">No articles match “${esc(q)}”.</li>`);
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
  closePalette();
  openReader(i);
}
$('palette-q').addEventListener('input', renderPalette);
$('palette-q').addEventListener('keydown', e => {
  e.stopPropagation();  // keep page shortcuts (Escape closing the reader, j/k) out of the palette
  if (e.key === 'ArrowDown') { e.preventDefault(); selectPalette(pal.sel + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectPalette(pal.sel - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); choosePalette(); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette-q').select(); }
});
$('palette-list').addEventListener('click', e => { const li = e.target.closest('li[data-n]'); if (li) choosePalette(+li.dataset.n); });
$('palette-list').addEventListener('mousemove', e => { const li = e.target.closest('li[data-n]'); if (li && +li.dataset.n !== pal.sel) selectPalette(+li.dataset.n, false); });
$('palette').addEventListener('click', e => { if (e.target === $('palette')) closePalette(); });  // the backdrop
$('palette-close').addEventListener('click', () => closePalette());
document.addEventListener('auxclick', e => { const a = e.target.closest('a.card'); if (a && e.button === 1) markRead(a.getAttribute('href')); });
// Plain clicks on an article open the reader; modified and middle clicks still open the site.
document.addEventListener('click', e => {
  const a = e.target.closest('a.card');
  if (!a) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return markRead(a.getAttribute('href'));
  const i = items.find(x => x.url === a.getAttribute('href'));
  if (!i) return;
  e.preventDefault();
  openReader(i);
});

// Desktop: drag the topics' or the list's right edge to resize it, as in Feedbin. Kept on this device; double-click resets.
// The reader keeps at least READER_MIN beside them, so a narrower window narrows the columns rather than the article.
const COLS = { side: { el: 'resize-side', v: '--side-w', min: 180, max: 360 }, list: { el: 'resize-list', v: '--list-w', min: 320, max: 720 } };
const READER_MIN = 440;
const colWidth = k => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(COLS[k].v));
function setCol(k, px, keep = true) {
  const c = COLS[k], others = k === 'side' ? (docked.matches ? colWidth('list') : 320) : colWidth('side');
  const room = innerWidth - (docked.matches ? READER_MIN : 0) - others;
  const w = Math.round(Math.max(c.min, Math.min(c.max, room, px)));
  document.documentElement.style.setProperty(c.v, w + 'px');
  $(c.el).setAttribute('aria-valuenow', w);
  if (keep) localStorage.setItem(k + 'Width', w);
}
for (const [k, c] of Object.entries(COLS)) {
  const el = $(c.el);
  el.setAttribute('aria-valuemin', c.min); el.setAttribute('aria-valuemax', c.max);
  if (localStorage.getItem(k + 'Width')) setCol(k, +localStorage.getItem(k + 'Width'), false);
  el.setAttribute('aria-valuenow', colWidth(k));
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('active'); document.body.classList.add('resizing');
    const start = e.clientX - colWidth(k);
    el.onpointermove = m => setCol(k, m.clientX - start);
    el.onpointerup = el.onpointercancel = () => { el.onpointermove = el.onpointerup = el.onpointercancel = null; el.classList.remove('active'); document.body.classList.remove('resizing'); };
  });
  el.addEventListener('dblclick', () => { document.documentElement.style.removeProperty(c.v); localStorage.removeItem(k + 'Width'); el.setAttribute('aria-valuenow', colWidth(k)); });
  el.addEventListener('keydown', e => {
    const by = { arrowleft: -16, arrowright: 16 }[e.key.toLowerCase()];
    if (!by) return;
    e.preventDefault(); e.stopPropagation();  // not j/k-style navigation
    setCol(k, colWidth(k) + by);
  });
}
addEventListener('resize', () => { for (const k in COLS) if (localStorage.getItem(k + 'Width')) setCol(k, +localStorage.getItem(k + 'Width'), false); });

// The wordmark's spot, once each time Upshot opens: the date, when it updated and when it's next due, then the wordmark
// again (after Kagi News). Under five seconds, so it never needs a pause control (WCAG 2.2.2); a tap ends it at once.
const BUILD_EVERY_HOURS = 4, BUILD_AT_MINUTE = 17;  // cron "17 */4 * * *" UTC, in wrangler.jsonc (which starts the build) and build.yml
const HOLD_MS = 1200, TICK_MS = 1500, FADE_MS = 300, REOPEN_MINUTES = 15;  // the wordmark first, long enough to be seen
let tickTimers = [], tickOnShow = false, tickPending = false, hiddenAt = Date.now();
// An opening, not a refresh: the pass plays only if the last one seen was a while ago, so reloading (or a new tab,
// or relaunching the app) moments later shows the wordmark rather than the pass again.
const passDue = () => Date.now() - (+localStorage.getItem('lastPass') || 0) >= REOPEN_MINUTES * 60e3;
// Where the wordmark can be seen: on a phone only the topics screen shows it; elsewhere a reader sliding over the page hides it.
const wordmarkShown = () => {
  const reading = document.body.classList.contains('reading');
  return phone.matches ? document.body.classList.contains('home') && !reading : !reading || docked.matches;
};
// After the page changes: a pass waiting for the wordmark plays once it's in view; one running out of view stops, as seen.
function syncTicker() {
  if (!wordmarkShown()) { if (tickTimers.length) stopTicker(); return; }
  if (tickPending) { tickPending = false; playTicker(); }
}
function nextBuildMinutes(now = Date.now()) {
  const t = new Date(now);
  t.setUTCHours(t.getUTCHours() - t.getUTCHours() % BUILD_EVERY_HOURS, BUILD_AT_MINUTE, 0, 0);
  while (t <= now) t.setUTCHours(t.getUTCHours() + BUILD_EVERY_HOURS);
  return Math.round((t - now) / 60e3);
}
const hoursMinutes = m => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
function tickerLines() {
  const mins = Math.max(0, (Date.now() - Date.parse(generatedAt)) / 60e3);
  return [new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()),
    `Updated ${agoText(mins)}`,
    ...(mins < STALE_MINUTES ? [`Next update in ${hoursMinutes(nextBuildMinutes())}`] : [])];  // late: no promise of when
}
function stopTicker() {
  tickTimers.forEach(clearTimeout); tickTimers = [];
  $('ticker').classList.remove('on');
  document.body.classList.remove('ticking');
}
function playTicker() {
  if (!generatedAt) return;
  stopTicker();
  if (!wordmarkShown()) { tickPending = true; return; }  // opened on a story, say: it waits for the wordmark, rather than running unseen
  const lines = tickerLines(), at = (ms, f) => tickTimers.push(setTimeout(f, HOLD_MS + ms));
  at(0, () => { document.body.classList.add('ticking'); localStorage.setItem('lastPass', Date.now()); });  // seen: counts from here
  lines.forEach((line, n) => {
    if (n) at(n * TICK_MS, () => $('ticker').classList.remove('on'));
    at(n * TICK_MS + FADE_MS, () => { $('ticker').textContent = line; $('ticker').classList.add('on'); });
  });
  at(lines.length * TICK_MS, () => $('ticker').classList.remove('on'));
  at(lines.length * TICK_MS + FADE_MS, stopTicker);
}
// A tap or click on the wordmark mid-pass just ends it.
document.querySelector('.logo-h').addEventListener('click', e => { if (document.body.classList.contains('ticking')) { e.preventDefault(); stopTicker(); } });

syncThemeColor();
load().catch(() => { $('items').innerHTML = '<p class="empty">Couldn’t load the news. Try again in a bit.</p>'; });
// Builds land every ~4h: check every 15 min while visible, and when the tab comes back into view.
const check = () => { if (!document.hidden) return load().catch(() => {}); };
setInterval(check, 15 * 60e3);
setInterval(() => { if (generatedAt && !document.hidden) { showUpdated(); refreshAges(); } }, 60e3);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return stopTicker(); }
  const back = tickOnShow || (Date.now() - hiddenAt > REOPEN_MINUTES * 60e3 && passDue());  // a phone reopens from the background, not a fresh load
  tickOnShow = false;
  check()?.then(() => { if (back) playTicker(); });
});
