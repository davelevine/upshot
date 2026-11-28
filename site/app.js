const CATS = { ai: 'AI', infrastructure: 'Infrastructure', engineering: 'Engineering', security: 'Security', regulation: 'Regulation', other: 'Other' };  // in the topics' order
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cat = c => (c in CATS ? c : 'other');
// Removes a body class two frames on, once the page has painted with it: a change made under it skips its transition.
const nextPaint = cls => requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove(cls)));
const domain = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// Who wrote it: an aggregator's links name the site they point to, not the aggregator.
const source = i => (/^Hacker News\b/.test(i.publisher) && domain(i.url)) || i.publisher;
const PAGE = 40;
const STALE_MINUTES = 105;  // builds land every hour (the Worker's cron starts them on time): this is one running 45+ minutes late
const KEEP_DAYS = 90;  // build.py prunes older stories
// Past phone widths the reader is docked beside the list, as Feedbin does, and the list scrolls on its own; on phones the window scrolls it.
const docked = matchMedia('(min-width: 641px)');
// Below three columns, the topics and the list are two pages of one left pane, scrolled sideways (index.html).
const paged = matchMedia('(min-width: 641px) and (max-width: 1023px)');
const showList = smooth => { if (paged.matches) document.querySelector('.shell').scrollTo({ left: 1e5, behavior: smooth ? 'smooth' : 'instant' }); };
paged.addEventListener('change', () => showList(false));
const scroller = () => (docked.matches ? $('col') : document.scrollingElement);
// The latest entry decides: a batch can hold an older one from before the last redraw, and reading that stopped the feed short of its end.
// Watched against whichever scrolls the list, so the 800px head start applies to it.
let io;
function watchEnd() {
  io?.disconnect();
  io = new IntersectionObserver(es => { if (es.at(-1).isIntersecting && limit < shown.length) showMore(limit + PAGE); },
    { root: docked.matches ? $('col') : null, rootMargin: '800px' });
  io.observe($('sentinel'));
}
watchEnd();
docked.addEventListener('change', watchEnd);
let tz, iconArt = {}, icons = new Set(), items = [], filter = 'all', shown = [], limit = PAGE, generatedAt = null, picks = new Map();  // picks: url -> what to do
const NAMES = { all: 'All', essentials: 'Essentials', exploited: 'Exploited', later: 'Read later', ...CATS };
const label = f => NAMES[f];
// Exploited flaws (build.py flags them): marked where they fall in the feed, and listed under the essentials for a week.
const EXPLOITED_DAYS = 7;
const listed = i => !!i.exploited && ageMins(i) < EXPLOITED_DAYS * 1440;
const exists = f => (f === 'essentials' ? picks.size > 0 : f === 'exploited' ? items.some(listed) : true);  // the two lists come and go
const inList = (i, f) => f === 'all' || (f === 'essentials' ? picks.has(i.url) : f === 'exploited' ? listed(i) : f === 'later' ? isSaved(i.url) : cat(i.category) === f);
const plural = (n, one, many) => (n === 1 ? one : many);
// What the list showing holds, counted: a topic is where the stories are ("3 stories in Other"), not a word about them ("3 Other stories").
const listNoun = n => query ? plural(n, 'matching story', 'matching stories') : (filter === 'essentials' ? plural(n, 'essential', 'essentials') : filter === 'exploited' ? plural(n, 'exploited flaw', 'exploited flaws')
  : filter === 'later' ? plural(n, 'saved story', 'saved stories') : plural(n, 'story', 'stories') + (filter === 'all' ? '' : ` in ${label(filter)}`));
// An exploited flaw and its remedy, in CISA's terms: "Patch available" (the accent), "Mitigation only" (quiet), or "No patch
// yet", the one alarm on a row, a red pill (nothing to apply: watch it); nothing when the story doesn't say. A
// supply-chain attack says "Compromised" instead, as GitHub and OSV keep malware apart from vulnerabilities, in yellow, Carbon's
// "regular warning" (check whether you're affected; there are steps to take), with no patch to report: its steps are in the upshot. A fifth of rows can be flagged in a busy week, so only the alarm is red. The same
// in every list, and the reader.
const FIX_LABEL = { none: '<span class="fix-pill no-patch">No patch yet</span>', mitigation: '<span class="fix-pill mitigation">Mitigation only</span>',
  patch: '<span class="fix-pill patch-out">Patch available</span>' };
const exploitedLabel = x => (x.kind === 'compromise' ? '<span class="exploited"><span class="x-word compromised">Compromised</span></span>'
  : `<span class="exploited"><span class="x-word">Exploited</span>${FIX_LABEL[x.fix] || ''}</span>`);
// One label per row, in one quiet style: Exploited (whether to act), else Essential. Unread needs none (its title is bold),
// and no list repeats its own name on every row.
const label1 = (i, ess) => (i.exploited ? exploitedLabel(i.exploited) : ess && filter !== 'essentials' ? '<span class="ess">Essential</span>' : '');
// Search results carry a story's label too, as every list does: whatever list is open behind the search. On a line of its own.
const searchLabel = i => { const l = i.exploited ? exploitedLabel(i.exploited) : picks.has(i.url) ? '<span class="ess">Essential</span>' : ''; return l && `<div class="p-label">${l}</div>`; };
const unpatched = () => items.filter(i => listed(i) && i.exploited.kind !== 'compromise' && i.exploited.fix === 'none').length;

// Today in the site's time zone (data.json's tz), not the device's: some browsers report UTC for privacy, which
// turned the evening's stories into a day old.
function isoDay(d = new Date()) { return d.toLocaleDateString('en-CA', { timeZone: tz }); }  // en-CA writes YYYY-MM-DD
const dayNumber = iso => Date.UTC(...iso.split('-').map((n, k) => +n - (k === 1))) / 864e5;
// How long ago it was published, as Feedbin shows it: 21m, 5h, 3d, then the date. A calmer list than a count per day.
// Stories from before the build kept the exact time only have a date: whole days, counted in the site's time zone,
// or the time it reached the site when that was on its date (hours late at most), not a later day.
function ageMins(i) {
  const at = i.published || (i.added && isoDay(new Date(i.added)) === i.date && i.added);
  return at ? (Date.now() - Date.parse(at)) / 60e3 : Math.max(0, dayNumber(isoDay()) - dayNumber(i.date)) * 1440;
}
function age(i) {
  const mins = ageMins(i);
  if (mins < 60) return `${Math.max(1, Math.floor(mins))}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 7 * 1440) return `${Math.floor(mins / 1440)}d`;
  const d = new Date(i.date + 'T12:00:00Z'), year = i.date.slice(0, 4) !== isoDay().slice(0, 4);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }), timeZone: 'UTC' });
}
const ageHtml = i => `<time class="card-age" datetime="${esc(i.published || i.added || i.date)}">${age(i)}</time>`;
// Saved for later: a bookmark beside the age, as Feedbin marks a starred row. Every row has one, shown by the `saved` class, so saving needs no redraw.
const SAVED_MARK = '<span class="card-saved"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg><span class="sr-only">Saved</span></span>';
// A sync or another tab changes only which stories are read, never which are listed, so the rows stay: rebuilding them would
// abort every icon still loading and fetch it again.
const refreshRead = () => $('items').querySelectorAll('a.card').forEach(a => {
  a.classList.toggle('read', isRead(a.getAttribute('href')));
  a.classList.toggle('saved', isSaved(a.getAttribute('href')));
});
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
  const btn = (f, n, mark, note = '') => `<button class="filter-btn${filter === f ? ' active' : ''}" data-f="${f}" aria-pressed="${filter === f}">` +
    `<span class="f-mark" aria-hidden="true">${mark}</span><span class="f-name">${label(f)}</span>${note || (n ? `<span class="f-count">${n}<span class="sr-only"> unread</span></span>` : '')}</button>`;
  const open = unpatched();  // exploited flaws with no fix yet: in place of the unread count while there are any
  const saved = items.filter(i => isSaved(i.url)).length;
  const focused = $('filters').contains(document.activeElement) && document.activeElement.dataset.f;  // the buttons are redrawn: focus goes to the new one
  $('filters').innerHTML = btn('all', unreadAll, '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>') +
    (picks.size ? btn('essentials', unreadPicks, '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>') : '') +
    (exists('exploited') ? btn('exploited', items.filter(i => listed(i) && isUnread(i)).length, '<svg viewBox="0 0 24 24"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>',
      open ? `<span class="f-open">${open} unpatched</span>` : '') : '') +
    // Read later counts what's saved, read or not: it empties as stories are unsaved, not as they're read. Always listed:
    // it's the reader's own list, not one the news fills, and the bookmark in the reader is otherwise all that tells of it.
    btn('later', 0, '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
      saved ? `<span class="f-count">${saved}<span class="sr-only"> saved</span></span>` : '') +
    '<h2 class="f-head">Topics</h2>' + Object.keys(CATS).filter(c => counts[c] || filter === c).map(c => btn(c, unread[c] || 0, `<span class="dot" style="--c:var(--cat-${c})"></span>`)).join('');
  if (focused) $('filters').querySelector(`[data-f="${focused}"]`)?.focus();
  $('list-name').textContent = label(filter);  // phones: the list's name above it, so a filter never makes stories look missing
  syncReadAll();
  // The unread count in the tab, as mail and feed readers have it: it rises when a build lands while the tab is open.
  document.title = (unreadAll ? `(${unreadAll}) ` : '') + (filter === 'all' ? 'Upshot \u00b7 The week\u2019s tech news, minus the noise' : `${label(filter)} \u00b7 Upshot`);
  // The same count on an installed app's icon, where the system draws one (Chrome and Edge on a computer); 0 clears it.
  // Elsewhere it does nothing or refuses (iOS without notification permission, which Upshot doesn't ask for).
  navigator.setAppBadge?.(unreadAll).catch(() => {});
  syncTopicUrl();
}
// The list showing is in the address (/?topic=security), so it can be bookmarked and reloaded into. A phone's topics page
// shows no list, so its address has none.
function syncTopicUrl() {
  const search = filter === 'all' || (phone.matches && document.body.classList.contains('home')) ? '' : '?topic=' + filter;
  if (search !== location.search) history.replaceState(history.state, '', location.pathname + search + location.hash);
}

// Hide read stories, a switch in the menu kept on this device, as mail apps and NetNewsWire have it. A story read while the
// list shows stays in it until the list is drawn afresh, so reading never pulls rows out from under you. Read later ignores
// it: a story is saved from the reader, so it's always read.
let hideRead = localStorage.getItem('hideRead') === '1';
const held = new Set();
const hidesRead = () => hideRead && filter !== 'later';
// Phones search in the list itself, as Feedbin does (openSearch): `query` narrows it, within the list showing while
// `scoped` (the chip), or across every story. Read stories stay in: a search is for finding one.
let query = '', scoped = false;
const searchHit = (i, ql) => `${i.title} ${i.summary} ${i.publisher} ${domain(i.url)}`.toLowerCase().includes(ql);
// More of the list: the next rows are added under the ones showing.
function showMore(to) { const from = limit; limit = to; renderPage(from); }
function renderItems(keepLimit) {
  if (!keepLimit) { limit = PAGE; held.clear(); }
  const ql = query.toLowerCase();
  shown = ql ? items.filter(i => inList(i, scoped ? filter : 'all') && searchHit(i, ql))
    : items.filter(i => inList(i, filter) && (!hidesRead() || isUnread(i) || held.has(i.url) || i.url === readerFor));
  renderPage();
}
function setHideRead(on, fromSync = false) {
  hideRead = on;
  localStorage.setItem('hideRead', on ? '1' : '0');
  $('hide-read').setAttribute('aria-checked', String(on));
  renderItems();
  if (fromSync) return;
  $('status').textContent = on ? 'Read stories hidden' : 'Read stories shown';
  notePref('hideRead');
}
$('hide-read').setAttribute('aria-checked', String(hideRead));
$('hide-read').onclick = () => setHideRead(!hideRead);
document.addEventListener('click', e => { if (e.target.closest('.show-read')) setHideRead(false); });

// Renders the first `limit` matches; the sentinel below the list raises it as you scroll. `from`: the rows before it are
// already there and stay (showMore), so the row that has focus keeps it and nothing above moves.
function renderPage(from = 0) {
  const rows = shown.slice(from, limit).map(i => { const ess = picks.has(i.url), why = filter === 'essentials' && picks.get(i.url), preview = why || i.summary; return `
    <a class="card${isRead(i.url) ? ' read' : ''}${isSaved(i.url) ? ' saved' : ''}${ess ? ' essential' : ''}" href="${esc(i.url)}" target="_blank" rel="noopener"${i.url === currentUrl() ? ' aria-current="true"' : ''}>
      ${iconHtml(i.publisher)}
      <div class="card-body">
        <div class="card-title">${highlight(i.title, query)}</div>
        <div class="card-meta"><span class="card-src">${esc(source(i))}</span>${label1(i, ess)}</div>
        ${preview ? `<div class="card-sum${why ? ' full' : ''}">${why ? '<b>What to do: </b>' : ''}${esc(preview)}</div>` : ''}
        <div class="card-foot">${ageHtml(i)}${SAVED_MARK}</div>
      </div>
    </a>`; }).join('');
  // No headings or counts: the list starts at the top, each story says how old it is, and the sidebar says which list it is.
  const note = $('items').querySelector('.later-note');  // stays under the rows
  if (from) note ? note.insertAdjacentHTML('beforebegin', rows) : $('items').insertAdjacentHTML('beforeend', rows);
  else $('items').innerHTML = shown.length ? rows
    : `<p class="empty">${query ? `No stories match “${esc(query)}”${scoped ? ` in ${esc(label(filter))}. <button type="button" class="sync-link-btn search-all">Search all stories</button>` : '.'}`
      : filter === 'later' ? 'Nothing saved yet. Open a story and use its bookmark to save it here.' : hidesRead() && items.some(i => inList(i, filter)) ? 'No unread stories here. Read stories are hidden. <button type="button" class="sync-link-btn show-read">Show them</button>' : 'Nothing in this list right now.'}</p>`;
  // Without sync, saves stay in this browser: said once, under the list, rather than on every save. showSync hides it once syncing.
  if (!from && filter === 'later' && !query) $('items').insertAdjacentHTML('beforeend', `<p class="later-note"${syncOn ? ' hidden' : ''}>Saved on this device only. <button type="button" class="sync-link-btn">Turn on sync</button> to see them on your other devices.</p>`);
  $('items').removeAttribute('aria-busy');
  syncReadAll(); placeMore();
  if (generatedAt) showUpdated();  // the feed was just redrawn, and its "Updated" with it
  io.unobserve($('sentinel'));
  io.observe($('sentinel'));
  const ended = shown.length && limit >= shown.length && !query;  // a search's results just stop
  $('end').hidden = !ended;
  $('hidden-note').hidden = !(!query && hidesRead() && items.filter(i => inList(i, filter)).length > shown.length);  // say so where the list ends
  if (ended) {
    const n = shown.length, what = listNoun(n);
    const days = Math.min(KEEP_DAYS, Math.ceil((Date.now() - Date.parse(items.reduce((o, i) => (i.date < o ? i.date : o), items[0].date))) / 864e5));
    const scope = filter === 'all' ? ` from the last ${days} days`
      : filter === 'essentials' && weekly?.window_start ? ` from ${weekRange(weekly)}` : filter === 'exploited' ? ` from the last ${EXPLOITED_DAYS} days` : '';  // the real span: a young site hasn't reached KEEP_DAYS
    $('end-msg').textContent = `That\u2019s ${n === 1 ? 'the only' : `all ${n}`} ${hidesRead() ? 'unread ' : ''}${what}${scope}.`;
  }
}

// "Nov 3 – 9" or "Oct 29 – Nov 4": the picks come from a rolling seven days, not a calendar week.
function weekRange(w) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .formatRange(new Date(w.window_start + 'T12:00:00Z'), new Date(w.window_end + 'T12:00:00Z'));
}
// The week's essentials: their own entry in the topics, and marked where they appear in the feed.
function setPicks(weekly) {
  const urls = new Set(items.map(i => i.url));
  picks = new Map((weekly?.items || []).filter(p => urls.has(p.url)).map(p => [p.url, p.why]));
  if (!exists(filter)) filter = 'all';  // a list that's emptied since: back to All
}

const syncThemeColor = () => {
  // Both media variants: the theme toggle can disagree with the system setting they're keyed to.
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', css('--bg')));
};
// Swap every color in one frame, then let a view transition crossfade the whole page; per-element
// transitions would fade some parts and snap others. The article frame switches by message, so the
// crossfade waits for it to confirm (briefly): otherwise its "after" picture shows the old article.
let frameThemed = null, themeTo = null;  // themeTo: the theme a transition is on its way to, which data-theme shows only once it runs
function swapTheme(t) {
  const root = document.documentElement;
  if ((themeTo ?? root.dataset.theme) === t) return;
  themeTo = t;
  const swap = () => {
    themeTo = null;
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
  // A swap that lands before the last one ran skips that one's crossfade (its colors still apply), rejecting its `ready`.
  if (document.startViewTransition) document.startViewTransition(swap).ready.catch(() => {});
  else swap();
}
// Light, dark, or (Auto) the system's, followed as it changes: the display options' Theme.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function pickTheme(pick) {
  if (pick === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', pick);
  swapTheme(pick === 'auto' ? (systemDark.matches ? 'dark' : 'light') : pick);
  markTheme();
}
const markTheme = () => document.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pick === (localStorage.getItem('theme') || 'auto'))));
markTheme();
$('menu-themes').onclick = e => { const b = e.target.closest('[data-pick]'); if (b) { pickTheme(b.dataset.pick); notePref('theme'); } };  // the menu stays open, to see the change
systemDark.addEventListener('change', () => { if (!localStorage.getItem('theme')) swapTheme(systemDark.matches ? 'dark' : 'light'); });
$('filters').onclick = e => {
  const b = e.target.closest('.filter-btn');
  if (!b) return;
  const same = b.dataset.f === filter && lastList !== null;  // back into the list just left, on a phone
  filter = b.dataset.f;
  if (!same) lastClosed = null;  // a new list: nothing to swipe back into
  if (document.body.classList.contains('reading')) { if (history.state?.pushed) picked = filter; dismiss(); }  // as in Feedbin: picking a topic, even the current one, closes the story
  renderFilters();
  if (!(same && phone.matches)) renderItems();
  showList(true);  // picking a topic slides to its list, as in Feedbin
  if (phone.matches && document.body.classList.contains('home')) enterList(same);  // into the list, as a page: back returns to the topics
  else if (history.state?.list) history.replaceState({ ...history.state, f: filter }, '');
};
// A topic picked while a story was open: the list entry dismiss() goes back to still names the old one, so popstate
// gives it this one before syncHome reads it.
let picked = null;
// Phones open on the topics (home); a topic's list is a history entry above it, so back, the chevron and swipe-back return.
const phone = matchMedia('(max-width: 640px)');
phone.addEventListener('change', () => { if (searching()) closeSearch(); syncHome(); });
function syncHome() {
  const st = history.state, home = !st?.list && !st?.reader;
  document.body.classList.toggle('home', home);
  setPd(null);  // a swipe that brought it here hands over to the state's own position
  $('col').inert = phone.matches && home;  // the page that's aside can't be reached
  $('filters').inert = phone.matches && !home;
  $('list-back').inert = $('search-btn').inert = $('read-all').inert = $('bar-top').inert = phone.matches && home;  // faded out: out of reach too
  document.querySelector('.logo-h').inert = phone.matches && !home;
  syncTicker();
  if (st?.f && st.f !== filter && exists(st.f)) { filter = st.f; renderFilters(); renderItems(); }
  syncTopicUrl();
}
let lastList = null;  // the list a swipe left on the topics goes back into (the filter is still set to it)
const setPd = v => (v == null ? document.documentElement.style.removeProperty('--pd') : document.documentElement.style.setProperty('--pd', v));
function enterList(same) {
  history.pushState({ list: true, pushed: true, f: filter }, '', location.pathname + location.search);
  syncHome();  // the list slides in over the topics (CSS)
  if (!same) scrollTo(0, 0);  // the same list again keeps its place
}
function leaveList() {
  if (history.state?.search) { afterSearch = leaveList; return history.back(); }  // out of the search's entry first, then the list's
  lastList = filter;
  // Back only over an entry pushed above: a story opened from a link becomes a list in place (dismiss), with the
  // page it came from below, so going back there would leave the site.
  if (history.state?.pushed) history.back();  // popstate slides it out
  else { history.replaceState(null, ''); syncHome(); }
}
$('list-back').onclick = leaveList;
// The search bar opens the palette, the same search as ⌘K, rather than filtering the feed in place.
$('search').onclick = () => openPalette();  // on a click or Enter, not focus, so Tab passes through and Esc hands focus back
// Phones: the header's search icon opens a drawer under it, as in Feedbin, and typing narrows the list in place. It starts
// in the list showing, named by a chip; the chip's ✕ (or Backspace in an empty field) widens it to every story. The drawer
// is a history entry, so back closes it; the icon again does too.
let afterSearch = null;  // leaving the list while searching: run once the search's entry is gone
const searching = () => document.body.classList.contains('searching');
function syncChip() {
  $('search-chip').hidden = !scoped;
  if (!scoped) return;
  $('chip-mark').innerHTML = $('filters').querySelector(`[data-f="${filter}"] .f-mark`)?.innerHTML || '';
  $('chip-name').textContent = label(filter);
  $('search-chip').setAttribute('aria-label', `${label(filter)}, remove filter`);
}
function openSearch() {
  if (searching()) return $('search-q').focus();
  scoped = filter !== 'all';
  syncChip();
  document.body.classList.add('searching');
  $('search-drawer').inert = false;
  $('search-btn').setAttribute('aria-expanded', 'true');
  history.pushState({ ...history.state, search: true }, '');
  $('search-q').focus();
}
function closeSearch() {  // once its history entry is gone
  document.body.classList.remove('searching');
  $('search-drawer').inert = true;
  $('search-btn').setAttribute('aria-expanded', 'false');
  $('search-q').value = '';
  if (query) { query = ''; renderItems(); }
}
const endSearch = () => (history.state?.search ? history.back() : closeSearch());
function widenSearch() {
  scoped = false;
  syncChip();
  renderItems();
  $('search-q').focus();
}
$('search-btn').onclick = () => (!phone.matches ? openPalette() : searching() ? endSearch() : openSearch());
$('search-chip').onclick = widenSearch;
$('search-drawer').onsubmit = e => { e.preventDefault(); $('search-q').blur(); };  // the keyboard's Search key: put it away, to see the results
$('search-q').addEventListener('input', () => { query = $('search-q').value.trim(); renderItems(); scroller().scrollTo(0, 0); });
$('search-q').addEventListener('keydown', e => {
  e.stopPropagation();  // keep page shortcuts (j/k, Escape closing the reader) out of the field
  if (e.key === 'Escape') endSearch();
  else if (e.key === 'Backspace' && scoped && !$('search-q').value) widenSearch();
});
document.addEventListener('click', e => { if (e.target.closest('.search-all')) widenSearch(); });
if (history.state?.search) history.replaceState({ ...history.state, search: undefined }, '');  // a reload starts with it closed
// The phone's toolbar has Back to top, dimmed at the top as Feedbin dims Edit; elsewhere it floats once you're well down.
addEventListener('scroll', () => { const y = scroller().scrollTop; $('top').hidden = y < 800; $('bar-top').disabled = y < 1; }, { passive: true, capture: true });  // capture: the list's own scrolling doesn't bubble
$('top').onclick = $('bar-top').onclick = () => scroller().scrollTo({ top: 0, behavior: 'smooth' });

// Read state lives in this browser, and with sync on (below) in the reader's other browsers too, first-visit cutoff included.
let weekly = null;
// What a key holds, or `d` if it holds nothing, or anything unreadable (an extension, a truncated write) rather than a blank page.
const stored = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const storedList = k => { const v = stored(k, []); return Array.isArray(v) ? v : []; };
const readSet = new Set(storedList('read'));
// A first visit starts with only the last day unread, as a feed reader does with a new subscription: older stories count as
// read. After that, anything added since counts. The week's essentials always count. `kept`: older stories marked unread by hand, which the cutoff would hide.
const FRESH_MS = 864e5, FRESH_MIN = 5;  // the last day, or the newest five after a quiet stretch
const arrived = i => Date.parse(i.added || i.published || i.date);
let since = localStorage.getItem('since');
const kept = new Set(storedList('kept'));
// Stores a value as JSON, a Set as its list.
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v instanceof Set ? [...v] : v));
const saveKept = () => put('kept', kept);
const older = url => { const i = items.find(x => x.url === url); return !i || arrived(i) <= Date.parse(since); };
const isRead = url => readSet.has(url) || (older(url) && !kept.has(url) && !picks.has(url));  // essentials stay unread until opened
const isUnread = i => !isRead(i.url);
const saveRead = () => put('read', readSet);
function pruneRead() {
  loadSync();  // the marks as stored: see loadSync
  const urls = new Set(items.map(i => i.url)), weekAgo = Date.now() - 7 * 864e5;
  for (const u of readSet) if (!urls.has(u)) readSet.delete(u);
  for (const u of kept) if (!urls.has(u)) kept.delete(u);
  // A synced mark for a story this tab hasn't loaded may be for one a newer build added; it's kept for a week.
  for (const u in marks) if (!urls.has(u) && marks[u][1] < weekAgo) { delete marks[u]; pending.delete(u); }
  for (const u in later) if (!urls.has(u) && later[u][1] < weekAgo) { delete later[u]; laterPending.delete(u); }  // a save leaves with its story
  if (syncOn) fromMarks();  // with sync on, the marks are the read list
  saveRead(); saveKept(); saveMarks(); saveLater();
}

// Sync (sync/account.js, sync/worker.js): once this device is syncing, every read or unread is noted as a mark, [read, when,
// opened], and sent to /api/sync with a cursor; the answer is every change since the cursor, from any device, and the
// server's version of anything it turned down. The server's merge is the truth: its answer replaces the local mark unless
// that story changed again here since. The read list is rebuilt from the marks. The session is an HttpOnly cookie, out of
// this script's reach; `upshot_sync=1` beside it says whether to ask at all, so a browser that cleared its storage (Safari
// does after a week away) finds itself still syncing and gets its read list back, and other visitors cost no request.
const SYNC_DELAY = 3000, SYNC_BATCH = 300;  // a batch stays well under the server's size limit
let syncOn, marks, pending, cursor, takeSince, pushTimer, syncGen = 0, syncNotice = '';
// Read later: stories set aside, {url: [saved, when]}, kept with or without sync, and leaving with the story itself. With
// sync on, unsaving keeps [0, when] so it reaches the other devices; `laterPending` is what this device hasn't sent.
let later, laterPending;
// Display preferences that follow the reader: the theme, the article's typeface and Hide read stories. Each keeps its value
// where it always has (the theme is read before first paint, index.html); with sync on, `prefAt` says when it was set here
// and `prefsPending` what's unsent. Text size, fluid width and full screen suit a screen, not a reader, so they stay with
// the device.
let prefAt, prefsPending;
const PREFS = {
  theme: { get: () => localStorage.getItem('theme') || 'auto', ok: v => ['auto', 'light', 'dark'].includes(v), set: v => pickTheme(v) },
  hideRead: { get: () => (hideRead ? '1' : '0'), ok: v => v === '0' || v === '1', set: v => setHideRead(v === '1', true) },
  font: { get: () => font, ok: v => Object.hasOwn(TYPEFACES, v), set: v => setFont(v, true) },
};
// Every tab shares what's stored, and storage events tell a tab of another's writes only after a moment (much later for a
// tab frozen in the background). So a tab rereads before it changes the marks, rather than writing back its own older copy
// over another tab's newer marks, or its unsent ones. Finding sync turned on or off that way, it acts on it here.
const loadSync = () => {
  const was = syncOn;
  syncOn = !!localStorage.getItem('syncOn'); marks = stored('marks', {}); pending = new Set(storedList('syncPending'));
  cursor = +localStorage.getItem('syncCursor') || 0; takeSince = !!localStorage.getItem('syncTakeSince');
  later = stored('later', {}); laterPending = new Set(storedList('laterPending'));
  prefAt = stored('prefAt', {}); prefsPending = new Set(storedList('prefsPending'));
  if (was === undefined || syncOn === was) return;  // undefined: loading the page
  syncOn ? setTimeout(connectLive) : disconnectLive();  // later: this may be partway through a sync
  if ($('sync').open && syncViewName !== 'code') renderSync();
};
loadSync();
const saveMarks = () => { put('marks', marks); put('syncPending', pending); };
const saveLater = () => { put('later', later); put('laterPending', laterPending); };
const savePrefs = () => { put('prefAt', prefAt); put('prefsPending', prefsPending); };
const isSaved = url => later[url]?.[0] === 1;
const maySync = () => syncOn || /(?:^|;\s*)upshot_sync=1/.test(document.cookie);
// Another tab changed what's stored: take it up, so this tab never writes its older copy back over it.
addEventListener('storage', e => {
  // The theme, typeface and Hide read, set in another tab by hand or by sync: shown here too. A synced one is applied by the first tab to
  // hear of it; the rest find their stored value already matching, so this is how they follow.
  if (e.key === 'theme') { swapTheme(e.newValue || (systemDark.matches ? 'dark' : 'light')); markTheme(); return; }
  if (e.key === 'hideRead') { if (hideRead !== (e.newValue === '1')) setHideRead(e.newValue === '1', true); return; }
  if (e.key === 'font') { if (font !== e.newValue && Object.hasOwn(TYPEFACES, e.newValue)) setFont(e.newValue, true); return; }
  if (!['syncOn', 'marks', 'syncPending', 'syncCursor', 'syncTakeSince', 'since', 'read', 'kept', 'later', 'laterPending', 'prefAt', 'prefsPending'].includes(e.key)) return;
  loadSync();
  since = localStorage.getItem('since');
  readSet.clear(); for (const u of storedList('read')) readSet.add(u);
  kept.clear(); for (const u of storedList('kept')) kept.add(u);
  showSync();
  if (items.length) { renderFilters(); refreshRead(); }
  if (readerFor) syncLater();
});
const queuePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(syncNow, SYNC_DELAY); };  // a burst of changes goes as one request
function noteMark(url, read, opened) {
  loadSync();
  if (!syncOn) return;
  marks[url] = [read, Date.now(), opened]; pending.add(url); saveMarks(); queuePush();
}
function notePref(key) {
  loadSync();
  if (!syncOn) return;
  prefAt[key] = Date.now(); prefsPending.add(key); savePrefs(); queuePush();
}
// Turning sync on (or finding this browser's storage cleared): what it already knows goes in as marks older than any real
// change, so other devices' changes win, and its order holds ("Recently read" lists them in it). Joining by code doesn't.
function seedMarks() {
  let t = 1;
  for (const u of readSet) marks[u] ??= [1, t++, 1];
  for (const u of kept) marks[u] ??= [0, t++, 0];
  pending = new Set(Object.keys(marks));
  saveMarks();
}
// Read first, by when: stories marked read in bulk go at the oldest end, as markAllRead puts them, so "Recently read" starts with what was opened.
function fromMarks() {
  const all = Object.entries(marks);
  readSet.clear();
  for (const [u] of all.filter(([, m]) => m[0]).sort(([, a], [, b]) => a[2] - b[2] || a[1] - b[1])) readSet.add(u);
  kept.clear();
  for (const [u, m] of all) if (!m[0]) kept.add(u);
  saveRead(); saveKept();
}
// Joining or leaving a sync starts over; syncGen tells a sync that was already on its way to drop its answer.
// `joined` (by a code): the sync's state replaces this device's, as a feed reader's account does on a new device. Its reads
// and cutoff stay here, unsent: an unread story is only the absence of a mark, so anything sent would win against it.
// The first sync takes the sync's cutoff and rebuilds the read list from its marks (syncNow); until then the old list shows.
function signedIn(joined = false) {
  syncGen++;
  syncOn = true; localStorage.setItem('syncOn', 1); nameSheet();
  marks = {}; cursor = 0; localStorage.setItem('syncCursor', 0);
  if (joined) { pending = new Set(); saveMarks(); } else seedMarks();
  laterPending = new Set(Object.keys(later)); saveLater();  // saves are explicit, so a union is safe even on joining
  // Joining takes the sync's preferences, so a new device looks like the others; the first device's go in, older than any change.
  if (joined) { prefAt = {}; prefsPending = new Set(); } else { for (const k in PREFS) prefAt[k] ??= 1; prefsPending = new Set(Object.keys(PREFS)); }
  savePrefs();
  takeSince = joined; joined ? localStorage.setItem('syncTakeSince', 1) : localStorage.removeItem('syncTakeSince');  // stored: another tab, or a reload, mustn't send the old cutoff either
  disconnectLive(); setTimeout(connectLive);  // a new session: its own connection, once the cookie is set
}
function signedOut(notice = '') {
  syncGen++;
  syncOn = false; marks = {}; pending.clear(); cursor = 0; syncedAt = 0; takeSince = false;
  for (const k of ['syncOn', 'marks', 'syncPending', 'syncCursor', 'syncTakeSince']) localStorage.removeItem(k);
  for (const u in later) if (!later[u][0]) delete later[u];  // keeps what's saved; unsaves were only for the other devices
  laterPending.clear(); saveLater();
  prefAt = {}; prefsPending.clear(); savePrefs();  // the settings stay as they are
  syncNotice = notice;
  disconnectLive();
  showSync();  // the sync button goes
}
// Sync's state: 'busy', 'ok' (with when), or 'error'. Sync runs by itself, so it has no button: the state is a line under
// the menu's Sync settings, and a dot on the menu's button while it's failing.
let syncState = 'ok', syncedAt = 0;
const syncLabel = () => syncState === 'busy' ? 'Syncing\u2026' : syncState === 'error' ? 'Couldn\u2019t reach Upshot'
  : `Synced ${syncedAt ? agoText((Date.now() - syncedAt) / 60e3) : ''}`.trim();
function showSync() {
  const failing = syncOn && syncState === 'error', line = $('sync-status');
  line.hidden = !syncOn;
  line.textContent = syncLabel();
  line.classList.toggle('error', failing);
  $('menu-btn').classList.toggle('sync-error', failing);
  $('menu-btn').setAttribute('aria-label', failing ? 'Menu. Not synced' : 'Menu'); $('menu-btn').title = $('menu-btn').getAttribute('aria-label');
  nameSheet();
  for (const n of document.querySelectorAll('.later-note')) n.hidden = syncOn;
}
// Opening shows "Synced 2m ago" as of now; closing shuts the RSS feeds list under its row, so it starts shut next time.
$('menu').addEventListener('toggle', e => { if (e.newState === 'open') showSync(); else $('feeds').open = false; });
// The menu item and its sheet: an invitation while this device doesn't sync, and once it does, where its devices and codes
// are kept, as a browser's "Sign in" becomes its account.
function nameSheet() {
  const name = syncOn ? 'Sync settings' : 'Sync your reading';
  $('sync-btn').querySelector('.menu-label').textContent = $('sync-title').textContent = name;
}
nameSheet();
// Sync now, from the sheet's Try again. Unreachable, this retries at once rather than waiting out
// the reconnect's backoff (connectLive); one already under way is left to finish.
const syncByHand = () => syncState === 'busy' || (live ? syncNow() : connectLive());
function setSync(state) {
  syncState = state;
  if (state === 'ok') syncedAt = Date.now();
  showSync();
  if ($('sync').open && syncViewName === 'in') syncLead();
}
// The sheet's first line: when this device last synced, or that Upshot can't be reached, with Try again (syncByHand).
function syncLead() {
  const err = syncState === 'error', ago = syncedAt ? agoText((Date.now() - syncedAt) / 60e3) : '';
  $('sync-last').textContent = err ? `Couldn\u2019t reach Upshot${ago ? `. Last synced ${ago}` : ''}.`
    : `${ago ? `Synced ${ago}. ` : ''}To add a device, generate a sync code.`;
  if (!err && document.activeElement === $('sync-retry')) $('sync-add-device').focus();  // it worked: the button goes
  $('sync-retry').hidden = !err;
}
// Whatever the reason (turned off here or elsewhere, removed, the last other device gone), one thing to say.
const STOPPED = 'Sync is off on this device. It keeps what it has read.';
let syncing = null;
async function syncNow() {
  clearTimeout(pushTimer); pushTimer = null;
  if (!items.length || !maySync()) return;
  if (syncing) return syncing.then(syncNow);  // one at a time, so each picks up where the last left off
  const sendable = (map, u) => map[u] && u.length <= 256 && /^https?:\/\//.test(u);  // what the server accepts (MAX_URL in sync/account.js)
  loadSync();
  for (const u of pending) if (!sendable(marks, u)) pending.delete(u);
  for (const u of laterPending) if (!sendable(later, u)) laterPending.delete(u);
  const sent = Object.fromEntries([...pending].slice(0, SYNC_BATCH).map(u => [u, marks[u]]));
  const sentLater = Object.fromEntries([...laterPending].slice(0, SYNC_BATCH - Object.keys(sent).length).map(u => [u, later[u]]));  // one batch between them
  const sentPrefs = Object.fromEntries([...prefsPending].filter(k => Object.hasOwn(PREFS, k)).map(k => [k, [PREFS[k].get(), prefAt[k] ?? 1]]));
  const payload = { marks: sent, later: sentLater, prefs: sentPrefs, cursor, since: takeSince ? null : since }, gen = syncGen;
  if (syncOn) setSync('busy');
  // keepalive lets a send finish after the tab is hidden or closed, but only up to 64 KB.
  syncing = call('/api/sync', payload, { keepalive: JSON.stringify(payload).length < 6e4 });
  const res = await syncing;
  syncing = null;
  if (gen !== syncGen) return;  // this device joined or left a sync meanwhile
  loadSync();  // another tab may have written meanwhile
  if (res?.status === 400) { for (const u in sent) pending.delete(u); for (const u in sentLater) laterPending.delete(u); prefsPending.clear(); saveMarks(); saveLater(); savePrefs(); }  // malformed: it would never get through
  if (!res?.data) { if (syncOn) setSync('error'); return; }  // offline: the marks stay pending, sent when it's back
  if (res.data.signedIn === false) {  // removed elsewhere, or never in
    if (syncOn) { signedOut(STOPPED); if ($('sync').open && ['in', 'show'].includes(syncViewName)) syncView('out'); }
    return;
  }
  const fresh = !syncOn;
  if (fresh) signedIn();  // syncing, but nothing stored says so: this browser's storage was cleared
  setSync('ok');
  // Written back only if this sync changed them. Another tab's write reaches this one's storage a moment late, so loadSync
  // above can miss it, and writing back unchanged copies would undo it (every open tab syncs when sync turns on).
  const stash = () => JSON.stringify([marks, [...pending], later, [...laterPending], prefAt, [...prefsPending]]), was = stash();
  for (const [u, m] of Object.entries(sent)) if (marks[u]?.[1] === m[1]) pending.delete(u);  // unless changed again meanwhile
  let changed = false;
  for (const [u, m] of Object.entries(res.data.marks)) {
    if (pending.has(u) || (marks[u] && marks[u].join() === m.join())) continue;
    marks[u] = m; changed = true;
  }
  if (res.data.later) {  // a sync server from before Read later sends none: the saves stay pending until one does
    for (const [u, m] of Object.entries(sentLater)) if (later[u]?.[1] === m[1]) laterPending.delete(u);
    for (const [u, m] of Object.entries(res.data.later)) {
      if (laterPending.has(u) || later[u]?.join() === m.join()) continue;
      later[u] = m; changed = true;
    }
  }
  if (res.data.prefs) {  // the server's merge, as with marks: it wins unless the setting changed here since. One from before preferences sends none
    for (const [k, p] of Object.entries(sentPrefs)) if (prefAt[k] === p[1]) prefsPending.delete(k);
    for (const [k, [v]] of Object.entries(res.data.prefs)) {
      if (!Object.hasOwn(PREFS, k) || prefsPending.has(k) || !PREFS[k].ok(v) || PREFS[k].get() === v) continue;
      PREFS[k].set(v);
    }
  }
  if (res.data.since && (takeSince || !since || res.data.since < since)) { localStorage.setItem('since', since = res.data.since); changed = true; }
  if (takeSince) { takeSince = false; localStorage.removeItem('syncTakeSince'); changed = true; }  // joined: the read list is the sync's, even with nothing in it
  cursor = res.data.cursor; localStorage.setItem('syncCursor', cursor);
  if (stash() !== was) { saveMarks(); saveLater(); savePrefs(); }
  if (changed) {
    fromMarks();
    renderFilters(); refreshRead();
    if (readerFor) { syncUnread(); syncLater(); }
  }
  // What this browser had, or the next batch. Saves only count once the server takes them: one from before Read later never does.
  const full = Object.keys(sent).length + (res.data.later ? Object.keys(sentLater).length : 0) === SYNC_BATCH;
  if ((pending.size || laterPending.size) && (fresh || full)) syncNow();
}
// Live updates: while this device syncs and the tab is in view, a WebSocket to its sync's Durable Object, which says when
// another device changed something, rather than this page asking every few seconds. Quiet, it costs nothing (the object
// hibernates; Cloudflare bills opening it and the page's messages, and the page sends none). Hiding the tab closes it;
// showing it reopens it and catches up once. A dropped connection retries, waiting longer each time, up to a minute.
// Each attempt syncs first: that catches up, and learns whether this device is still syncing at all (removed, or the sync
// deleted, while the tab was hidden), so a connection is only tried when it can open.
let live = null, liveWait = 1, liveTimer, liveTry = 0;
async function connectLive() {
  clearTimeout(liveTimer);
  if (live || document.hidden || !maySync()) return;
  const attempt = ++liveTry;
  await syncNow();
  if (attempt !== liveTry || live || !syncOn || document.hidden) return;  // superseded, or no longer syncing
  const ws = live = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/auth/live`);
  ws.onopen = () => { liveWait = 1; };
  ws.onmessage = e => {
    if (live !== ws) return;  // a socket already closed here (disconnectLive) can still deliver: its sync isn't this one any more
    const { t } = JSON.parse(e.data);
    if (t === 'ended') return liveEnded();
    if (t === 'marks') syncNow();
    if (t === 'devices' && $('sync').open) { if (syncViewName === 'in') listDevices(true); if (syncViewName === 'show') checkJoined(); }
  };
  ws.onclose = e => {
    if (live === ws) live = null;
    if (e.code === 4001) return liveEnded();  // the backup, if the 'ended' message didn't arrive
    if (syncOn && !document.hidden) liveTimer = setTimeout(connectLive, liveWait * 1000), liveWait = Math.min(liveWait * 2, 60);
  };
}
// This device stopped syncing (sync/worker.js, #drop): say so, and reset an open sheet unless a code is being typed.
function liveEnded() {
  if (!syncOn) return;
  signedOut(STOPPED);
  if ($('sync').open && syncViewName !== 'code') syncView('out');
}
function disconnectLive() {
  clearTimeout(liveTimer); liveTry++;  // and any attempt still syncing first
  if (!live) return;
  live.onclose = null; live.close(1000); live = null;
}
// Leaving the tab (a phone may never come back to it): what's waiting goes now, and the connection closes. Coming back:
// reconnect, which catches up. Back online: the same.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return connectLive();
  disconnectLive();
  if (pending.size || laterPending.size || prefsPending.size) syncNow();
});
addEventListener('online', () => (document.hidden ? syncNow() : connectLive()));

// The sheet: Menu \u203a Sync your reading (Sync settings once syncing, nameSheet), one view at a time.
// News (ok) goes under the title, failures under the buttons; each view starts with neither.
const sayErr = (msg, ok = false) => {
  for (const [id, show] of [['sync-msg', ok], ['sync-err', !ok]]) { $(id).textContent = show ? msg : ''; $(id).hidden = !(show && msg); }
};
let linkTimer, syncViewName = null;
// Where focus goes in each view, so it never stays on a control that's just been hidden.
const VIEW_FOCUS = { out: '#sync-create', code: '#sync-code', in: '#sync-add-device', show: '#sync-show-back' };
function syncView(name, { justOn = false } = {}) {
  clearTimeout(linkTimer);
  syncViewName = name;
  sayErr('');
  for (const v of document.querySelectorAll('#sync .sync-view')) v.hidden = v.dataset.view !== name;
  if (name === 'out' && syncNotice) { sayErr(syncNotice, true); syncNotice = ''; }  // why this device stopped syncing
  if (name === 'in') {
    syncLead();
    listDevices();  // kept current while open by the live connection's 'devices' messages
  }
  if (name === 'show') { $('sync-show-on').hidden = $('sync-show-other').hidden = !justOn; showBack(!justOn); showLinkCode(); }
  if (name === 'code') { $('sync-code-switch').hidden = !syncOn; $('sync-code-inapp').hidden = true; }
  document.querySelector(VIEW_FOCUS[name])?.focus();
}
// A request that didn't work: 401 means this device was removed elsewhere meanwhile; otherwise, say what to do.
const whoAmI = () => fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)).catch(() => null);  // signed out is a 200; a 429 or 5xx says nothing about the session
const call = (path, body, init) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...init }).then(async r => ({ status: r.status, data: r.ok ? await r.json() : null })).catch(() => ({ status: 0, data: null }));
function failed(status, what) {
  if (status === 401) { signedOut(STOPPED); return syncView('out'); }
  sayErr(status === 429 ? 'Too many tries. Wait a minute, then try again.' : `Couldn\u2019t ${what}. Check the connection and try again.`);
}
const renderSync = () => syncView(syncOn ? 'in' : 'out');
// Under a code: Back to the device list, or (just after turning sync on, when there's nowhere to go back to) Done.
function showBack(back) {
  const b = $('sync-show-back');
  b.textContent = back ? 'Back' : 'Done';
  b.toggleAttribute('data-close', !back);
  if (back) b.dataset.to = 'in'; else delete b.dataset.to;
}
let shownDevices = '';
async function listDevices(recheck = false) {
  const me = await whoAmI();
  if (syncViewName !== 'in') return;  // the sheet moved on meanwhile
  if (me && !me.signedIn) { signedOut(STOPPED); return renderSync(); }
  if (recheck && (!me || JSON.stringify(me.devices.map(d => d.id)) === shownDevices)) return;  // unchanged: nothing moves under the pointer
  shownDevices = JSON.stringify((me?.devices || []).map(d => d.id));
  $('sync-devices').replaceChildren(...(me?.devices || []).map(d => {
    const li = document.createElement('li'), name = document.createElement('span'), when = document.createElement('span'), b = document.createElement('button');
    name.className = 'sync-dev'; name.textContent = d.label;
    when.className = 'sync-when'; when.textContent = d.current ? 'This device' : `Last synced ${agoText((Date.now() - d.seen) / 60e3)}`;
    li.insertAdjacentHTML('afterbegin', deviceIcon(d.label));
    li.append(name, when);
    if (d.current) return li;  // left with "Stop syncing on this device", as Signal and WhatsApp list linked devices
    b.type = 'button'; b.textContent = 'Remove'; b.setAttribute('aria-label', `Remove ${d.label}`);
    b.onclick = () => signOutDevice(d, b);
    li.append(b);
    return li;
  }));
}
// A phone, tablet or computer outline beside each device, from its label ("Safari on iPhone"), as Google lists your devices.
const deviceIcon = label => /iPhone|Android/.test(label) ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>'
  : /iPad/.test(label) ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/></svg>'
  : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>';
// `d.current`: this device, which leaves by its cookie (/api/auth/logout), so the button works before the list has loaded.
async function signOutDevice(d, b) {
  b.disabled = true;
  const { status, data: res } = await (d.current ? call('/api/auth/logout') : call('/api/auth/devices/revoke', { id: d.id }));
  b.disabled = false;
  if (!res) return failed(status, d.current ? 'stop syncing' : 'remove that device');
  if (!d.current && res.left) { await listDevices(); return $('sync-add-device').focus(); }  // its row, and the button in it, are gone
  signedOut(); syncView('out');  // this device left, or removing the other left it alone: off either way
  sayErr(STOPPED, true);
}
$('sync-retry').onclick = syncByHand;
$('sync-leave').onclick = () => signOutDevice({ current: true }, $('sync-leave'));
// Turning sync on: this device becomes the first, and the sheet goes straight to a code for the next one.
async function turnOn() {
  const b = $('sync-create');
  b.disabled = true;
  const { status, data } = await call('/api/auth/start', {});
  b.disabled = false;
  if (!data) return failed(status, 'generate a sync code');
  signedIn();  // which connects, syncing first
  syncView('show', { justOn: true });
}
// Adding a device: a code that works once, for ten minutes. Until it's used or expires, the list is checked every few
// seconds, so this device can say when the other one has joined.
async function showLinkCode() {
  $('sync-show-how').hidden = false; $('sync-show').hidden = false;
  $('sync-show').textContent = '\u2009'; $('sync-note').textContent = 'Generating a sync code\u2026';
  $('sync-qr').hidden = true;
  const [{ status, data: res }, before] = await Promise.all([call('/api/auth/link/start', { base: location.origin }), whoAmI()]);
  if (syncViewName !== 'show') return;
  if (status === 401) return failed(status);
  if (!res) { $('sync-note').textContent = 'Couldn\u2019t generate a sync code. Check the connection and try again.'; return; }
  $('sync-show').textContent = res.code.slice(0, 4) + '-' + res.code.slice(4);
  if (res.qr) { $('sync-qr-img').innerHTML = res.qr; $('sync-qr').hidden = false; }  // our own Worker's SVG
  $('sync-note').textContent = `Works once, until ${new Date(res.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
  linkTimer = setTimeout(() => {
    $('sync-show').hidden = $('sync-show-other').hidden = $('sync-qr').hidden = true;
    showBack(true);
    $('sync-note').textContent = 'That sync code has expired. Go back to generate a new one.';
  }, res.expires - Date.now());
  knownDevices = before?.devices ? new Set(before.devices.map(d => d.id)) : null;  // null if that failed: the next check sets it
}
// The live connection says the device list changed while a code is showing: has a new device joined with it?
let knownDevices = null;
async function checkJoined() {
  const me = await whoAmI();
  if (syncViewName !== 'show' || !me?.devices) return;
  if (!knownDevices) { knownDevices = new Set(me.devices.map(d => d.id)); return; }
  const added = me.devices.find(d => !knownDevices.has(d.id));
  if (!added) return;
  clearTimeout(linkTimer);
  $('sync-show-how').hidden = $('sync-show').hidden = $('sync-show-other').hidden = $('sync-qr').hidden = true;
  $('sync-note').textContent = `${added.label} is syncing now.`;
  linkTimer = setTimeout(() => $('sync').close(), 2000);  // paired: long enough to read, then closed on both devices (canceled by any change of view)
}
// Joining with a code from another device: this one takes the sync's reading, leaving any sync it was in.
async function joinWithCode() {
  const code = $('sync-code').value.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, ''), b = $('sync-code-go');
  if (code.length !== 8) { sayErr('A sync code has eight letters and numbers.'); return $('sync-code').focus(); }
  sayErr(''); b.disabled = true;
  const { status, data: res } = await call('/api/auth/link/finish', { code });
  b.disabled = false;
  if (!res) { failed(status === 401 ? 0 : status, 'reach Upshot'); return $('sync-code').focus(); }
  if (!res.ok) { sayErr('That sync code didn\u2019t work. Each one works once, for ten minutes.'); return $('sync-code').focus(); }
  $('sync-code').value = '';
  if (!res.already) signedIn(true);  // which connects, syncing first; a code for the sync this device is in changes nothing
  $('sync').close();
  $('status').textContent = 'Syncing on this device';
}
// Opening the sheet in a tab that hasn't heard this browser is syncing (joined in another tab while this one was frozen in
// the background) catches up first, so it never offers to start a sync this browser already has.
const openSheet = () => { $('sync').showModal(); renderSync(); if (!syncOn && maySync()) syncNow().then(() => { if (syncOn && syncViewName === 'out') renderSync(); }); };
$('sync-btn').onclick = () => { $('menu').hidePopover(); openSheet(); };
$('items').addEventListener('click', e => { if (e.target.closest('.later-note button')) openSheet(); });  // Read later's note, without sync
setInterval(() => { if (syncOn && !document.hidden) showSync(); }, 60e3);  // "Synced 3m ago" stays true
$('sync').addEventListener('click', e => {
  const to = e.target.closest('[data-to]')?.dataset.to;
  if (to) to === 'home' ? renderSync() : syncView(to);  // home: signed out or syncing, whichever this device is
  if (e.target.closest('[data-close]')) $('sync').close();
});
$('sync').addEventListener('close', () => clearTimeout(linkTimer));
$('sync-create').onclick = turnOn;
$('sync-use-code').onclick = () => syncView('code');
$('sync-code-go').onclick = joinWithCode;
$('sync-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinWithCode(); });
// XXXX-XXXX as it's typed or pasted: the dash goes in after the fourth character, and only while adding, so deleting
// back past it isn't undone.
$('sync-code').addEventListener('input', e => {
  const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
  e.target.value = v.length > 4 || (v.length === 4 && e.inputType?.startsWith('insert')) ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
});
$('sync-add-device').onclick = () => syncView('show');
const cardFor = url => [...document.querySelectorAll('a.card')].find(a => a.getAttribute('href') === url);
function markRead(url) {
  const was = isRead(url);
  readSet.delete(url); readSet.add(url); saveRead();
  if (kept.delete(url)) saveKept();  // most recent last: the search panel's "Recently read" reads it backwards
  noteMark(url, 1, 1);
  if (shown.some(i => i.url === url)) held.add(url);  // stays listed under Unread only
  if (!was) renderFilters();
  const card = cardFor(url);
  card?.classList.add('read');
}
// Feedbin's Read button and its "Mark above/below as read". These go in at the oldest end of the read list, so the search
// panel's "Recently read" still starts with what was actually opened.
function markAllRead(list) {
  for (const i of list) held.delete(i.url);  // under Unread only, Read clears what was opened here too
  const urls = list.filter(isUnread).map(i => i.url);
  if (!urls.length) return renderItems(true);
  const rest = [...readSet];
  readSet.clear();
  for (const u of [...urls, ...rest]) readSet.add(u);
  for (const u of urls) kept.delete(u);
  saveRead(); saveKept();
  for (const u of urls) noteMark(u, 1, 0);
  renderFilters();
  renderItems(true);
  $('status').textContent = `Marked ${urls.length} ${plural(urls.length, 'story', 'stories')} as read`;
}
const syncReadAll = () => { $('read-all').disabled = !shown.some(isUnread); };
function confirmReadAll() {
  const n = shown.filter(isUnread).length;
  if (!n) return;
  $('confirm-msg').textContent = `Mark ${n === 1 ? 'the' : n} unread ${listNoun(n)} as read?`;
  closeMenus();
  $('confirm-read').returnValue = '';
  $('confirm-read').showModal();
  $('confirm-read').querySelector('.primary').focus();
}
$('read-all').onclick = confirmReadAll;
$('bar-keys').onclick = () => $('keys').showModal();
$('confirm-read').addEventListener('close', () => { if ($('confirm-read').returnValue === 'ok') markAllRead(shown); });
// The "…" on the selected story: the one open, or the one just closed, as Feedbin keeps its row selected. It's one element,
// moved after that row; a redraw of the list detaches it, so it's held here and put back.
const more = $('card-more'), morePop = $('more-pop'), moreBtn = $('card-more-btn');  // getElementById can't find them while detached
const selectedUrl = () => readerFor ?? lastClosed;
function placeMore() {
  const card = selectedUrl() && cardFor(selectedUrl());
  if (!card) { closeMore(); more.hidden = true; return; }
  if (card.nextElementSibling !== more) { closeMore(); card.after(more); }
  more.hidden = false;
}
const closeMore = () => { morePop.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); };
moreBtn.onclick = e => {
  e.stopPropagation();
  const open = morePop.hidden;
  closeMenus();
  morePop.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
  if (open) $('read-above').focus({ preventScroll: true });
};
morePop.onclick = e => {
  e.stopPropagation();
  const id = e.target.closest('button')?.id, at = shown.findIndex(i => i.url === selectedUrl());
  if (!id || at < 0) return;
  closeMore();
  markAllRead(id === 'read-above' ? shown.slice(0, at) : shown.slice(at + 1));
  moreBtn.focus({ preventScroll: true });
};
function markUnread(url) {
  readSet.delete(url); saveRead();
  if (older(url)) { kept.add(url); saveKept(); }
  noteMark(url, 0, 0);
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
// Read later, the reader's bookmark (`s`): saving or unsaving the open story. Reading it leaves it saved.
function syncLater() {
  const on = !!readerFor && isSaved(readerFor), label = on ? 'Remove from Read later' : 'Read later';
  $('reader-later').setAttribute('aria-pressed', String(on));
  $('reader-later').setAttribute('aria-label', label);
  $('reader-later').title = label;
}
function toggleLater() {
  const url = readerFor;
  if (!url) return;
  loadSync();  // another tab's saves first: see loadSync
  const on = isSaved(url) ? 0 : 1;
  if (on || syncOn) later[url] = [on, Date.now()]; else delete later[url];
  if (syncOn) { laterPending.add(url); queuePush(); }
  saveLater();
  cardFor(url)?.classList.toggle('saved', !!on);
  renderFilters();
  syncLater();
  $('status').textContent = on ? 'Saved to Read later' : 'Removed from Read later';
}
$('reader-later').onclick = toggleLater;

// Listen (the headphones in the reader's bar, or l) plays the story's audio, made after each build by audio.py: the
// headline, the upshot, then the article, read by Kokoro and kept in the public audio bucket (data.audio) with the second
// each block of the page starts. The frame hands over its blocks and marks the one playing (SWIPE_REPORTER); a click on a
// block plays from there. It's one <audio> element, so it plays on with the phone locked, with lock-screen controls
// through the Media Session. A story without audio (not voiced yet, or a site without the bucket) has no button.
const AUDIO_VERSION = 1;  // audio.py VERSION
const RATES = [1, 1.25, 1.5];  // the rows of #listen-rates
let listenRate = RATES.includes(+localStorage.getItem('listenRate')) ? +localStorage.getItem('listenRate') : 1;
let audioBase = null, voiced = new Map();  // the bucket, and the stories in its index: key → { card, r }
let heard = null;   // the open story's audio, once its timings are in: { url, src, meta: { d, t, n, full, card } }
let listen = null;  // while it plays: { url, meta: its timings, kept with it (heard moves on as the next story opens), blocks, marks: whether the frame's blocks are the ones timed, at: the block playing }
const player = new Audio();
player.preload = 'none';
const audioKey = async url => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)))].map(b => b.toString(16).padStart(2, '0')).join('');  // worker.js keyFor
const frameNow = () => $('reader-body').querySelector('iframe[srcdoc]:not(.loading)')?.contentWindow;
// Which stories have audio: the bucket's index, read on load and with each build (kept five minutes), so the page never asks for one that isn't there.
function loadVoiced(base) {
  audioBase = base || null;
  if (!audioBase) return;
  fetch(`${audioBase}/_index.json`).then(r => r.ok ? r.json() : {}).then(index => {
    voiced = new Map(Object.entries(index).filter(([, e]) => e?.v === AUDIO_VERSION));
    if (readerFor) findAudio(readerFor);
  }).catch(() => {});
}
// The open story's timings, if it has audio; the button shows once they're in.
async function findAudio(url) {
  if (heard?.url === url) return void ($('reader-listen').hidden = false);
  heard = null;
  $('reader-listen').hidden = true;
  if (!audioBase || !voiced.size) return;
  const key = await audioKey(url), entry = voiced.get(key);
  if (!entry || readerFor !== url) return;
  const name = `${key}-${AUDIO_VERSION}${entry.r ? `-${entry.r}` : ''}`;  // a story voiced again has its revision in the name (audio.py audio_name)
  try {
    const meta = await (await fetch(`${audioBase}/${name}.json`)).json();
    if (readerFor !== url || !Array.isArray(meta?.t) || !(meta.d > 0)) return;
    heard = { url, src: `${audioBase}/${name}.m4a`, meta: { ...meta, card: !!entry.card } };
    $('reader-listen').hidden = false;
  } catch {}  // no timings, no button
}
function toggleListen() {
  if (listen) return stopListening();
  if (!heard || heard.url !== readerFor) return;
  if (player.src !== heard.src || player.error) player.src = heard.src;  // again after a failed load: the element won't retry the same file by itself
  player.currentTime = 0;
  player.playbackRate = listenRate;
  player.play().catch(() => drawListen());  // in the tap itself, which Safari requires; refused, the bar offers Play
  listen = { url: heard.url, meta: heard.meta, blocks: [], marks: false, at: -1 };
  frameNow()?.postMessage({ tw: 'listen' }, '*');  // the frame answers with its blocks (sayable)
  setMediaSession();
  drawListen();
}
// The frame's blocks: marked while the audio plays if they're the ones audio.py timed. A long story's audio stops after
// the upshot, so its page holds more blocks than were timed. A card's audio is the card whole: once the article has
// replaced it, until the story is voiced again, its paragraphs aren't what's playing.
function heardBlocks(blocks) {
  if (!listen || !Array.isArray(blocks)) return;
  const { n, full, card } = listen.meta;
  listen.blocks = blocks;
  listen.marks = full || card ? blocks.length === n : blocks.length >= n;
  listen.at = -1;
  followAudio();
}
function blockAt(time) {
  const t = listen.meta.t;
  let n = 0;
  while (n + 1 < t.length && t[n + 1] <= time + 0.05) n++;
  return n;
}
function followAudio() {
  if (!listen) return;
  if (listen.marks) {
    const n = blockAt(player.currentTime);
    if (n !== listen.at) { listen.at = n; toFrame({ tw: 'said', n }); }
  }
  drawListen();
}
function seekBlock(n) {
  if (!listen) return;
  const t = listen.meta.t;
  if (listen.marks) player.currentTime = t[Math.max(0, Math.min(t.length - 1, n))];
  else player.currentTime = Math.max(0, Math.min(listen.meta.d, player.currentTime + (n < listen.at ? -15 : 15)));  // no marks: 15 seconds a step
  if (player.paused) player.play().catch(() => {});
  followAudio();
}
const stepBlock = dir => seekBlock((listen?.at ?? 0) + dir);
function stopListening() {
  if (!listen) return;
  listen = null;
  player.pause();
  toFrame({ tw: 'said', n: -1 });
  navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null;  // off the lock screen
  $('listen-rates').hidePopover();
  drawListen();
}
function setMediaSession() {
  const i = items.find(x => x.url === listen.url);
  navigator.mediaSession.metadata = new MediaMetadata({ title: i?.title || '', artist: i ? source(i) : '', album: 'Upshot',
    artwork: [{ src: new URL('/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }] });
  const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };  // an action the browser doesn't know
  on('play', () => player.play());
  on('pause', () => player.pause());
  on('stop', stopListening);
  on('seekbackward', () => { player.currentTime = Math.max(0, player.currentTime - 15); });
  on('seekforward', () => { if (listen) player.currentTime = Math.min(listen.meta.d, player.currentTime + 15); });
  on('previoustrack', () => stepBlock(-1));
  on('nexttrack', () => stepBlock(1));
}
function drawListen() {
  const l = listen;
  $('listen-bar').hidden = !l;
  $('reader-listen').setAttribute('aria-pressed', String(!!l));
  $('reader-listen').title = $('reader-listen').ariaLabel = l ? 'Stop listening' : 'Listen';
  if (!l) return;
  const playing = !player.paused, { d, t, full } = l.meta, at = Math.max(0, l.at);
  $('listen-bar').classList.toggle('playing', playing);
  $('listen-play').title = $('listen-play').ariaLabel = playing ? 'Pause' : 'Play';
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  $('listen-prev').disabled = l.marks ? at === 0 : player.currentTime < 1;
  $('listen-next').disabled = l.marks && at === t.length - 1;
  // Where it is: the upshot, or the heading above (the story's own title before its first).
  const b = l.marks && l.blocks[at];
  $('listen-what').textContent = b?.kind === 'upshot' ? 'The upshot'
    : (b && l.blocks.slice(0, at + 1).findLast(x => x.kind === 'title' || x.kind === 'head')?.text) || items.find(x => x.url === l.url)?.title || '';
  const left = Math.max(0, d - player.currentTime) / listenRate;
  $('listen-left').textContent = `${Math.max(1, Math.round(left / 60))} min left${full ? '' : ' · Summary only'}`;
  $('listen-done').style.width = `${Math.min(100, 100 * player.currentTime / d)}%`;
  $('listen-rate').textContent = `${listenRate}×`;
  $('listen-rate').ariaLabel = `Speed, ${listenRate} times`;
  for (const b of $('listen-rates').children) b.ariaPressed = String(+b.dataset.rate === listenRate);
}
player.addEventListener('timeupdate', followAudio);
// Audio plays only while a story is being listened to: after Stop, a media key or the lock screen's Play (its handler, or the
// browser's own) would otherwise play it with no bar on the page to stop it. toggleListen sets `listen` before this fires.
player.addEventListener('play', () => (listen ? drawListen() : player.pause()));
player.addEventListener('pause', drawListen);
player.addEventListener('ended', stopListening);
player.addEventListener('error', () => { if (listen) { stopListening(); $('reader-listen').hidden = true; } });  // the file's gone: no button for it
$('reader-listen').onclick = toggleListen;
$('listen-play').onclick = () => player.paused ? player.play().catch(() => {}) : player.pause();
$('listen-prev').onclick = () => stepBlock(-1);
$('listen-next').onclick = () => stepBlock(1);
$('listen-stop').onclick = stopListening;
// The speeds open above their button, its right edge to theirs. The browser opens and dismisses them, and gives focus back.
$('listen-rates').addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  const r = $('listen-rate').getBoundingClientRect(), html = document.documentElement;
  $('listen-rates').style.inset = `auto ${html.clientWidth - r.right}px ${html.clientHeight - r.top + 6}px auto`;
});
$('listen-rates').onclick = e => {
  const b = e.target.closest('[data-rate]');
  if (!b) return;
  $('listen-rates').hidePopover();
  listenRate = +b.dataset.rate;
  localStorage.setItem('listenRate', String(listenRate));
  player.playbackRate = listenRate;
  drawListen();
};
addEventListener('pagehide', stopListening);

// "Updated 2h ago" at the top of the feed; a number that keeps growing means builds have stopped.
const agoText = mins => (mins < 1 ? 'just now' : mins < 60 ? `${Math.floor(mins)}m ago`
  : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`);
function showUpdated() {
  const mins = Math.max(0, (Date.now() - Date.parse(generatedAt)) / 60e3), ago = agoText(mins);  // none on an empty feed
  $('stale').hidden = mins < STALE_MINUTES;
  for (const el of [$('updated'), $('bar-updated')]) {  // the sidebar's foot, or a phone's bottom bar
    el.dateTime = generatedAt;
    el.title = new Date(generatedAt).toLocaleString();
    el.innerHTML = `<span>Updated </span>${ago}`;
    el.hidden = !$('stale').hidden;  // one slot, two states: the late bar says the same thing, where it can be acted on
  }
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
  // The first load takes the request index.html's inline script started, so the stories don't wait for this file (data.json
  // is max-age=0, so that one revalidates too); later loads ask afresh.
  const res = window.firstData || fetch('/data.json', { cache: 'no-cache' });  // absolute: the page is also served at /read/…
  window.firstData = null;
  return res.then(r => r.json()).then(data => {
    if (generatedAt !== null && !(Date.parse(data.generated_at) > Date.parse(generatedAt))) return;  // the same build, or an older one answering late
    const refresh = generatedAt !== null;
    generatedAt = data.generated_at;
    showUpdated();
    items = data.items || [];
    loadVoiced(data.audio);  // each build, as audio for its stories arrives
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
    if (!refresh) {  // a list named in the address: opened in place of the topics, on a phone too
      const t = new URLSearchParams(location.search).get('topic');
      if (t && Object.hasOwn(NAMES, t)) { filter = t; if (!history.state) history.replaceState({ list: true, f: t }, ''); }
    }
    setPicks(data.weekly);
    renderFilters();
    renderItems(refresh);
    if (!refresh) {  // where the page starts is no move: no slide
      document.body.classList.add('paging');
      syncFromUrl(); syncHome(); showList(false);  // opens on the stories
      nextPaint('paging');
      if (passDue()) { if (document.hidden) tickOnShow = true; else playTicker(); }  // opened, not just refreshed: one pass
    }
    (window.requestIdleCallback || (f => setTimeout(f, 1000)))(prefetchArticles);  // the new top stories, after a refresh too
  });
}
let readerFor = null;
// Docked, the list stays usable while an article is open, unless the reader's full screen; the header's menu stays either way.
const setInert = () => {
  const off = document.body.classList.contains('reading') && !docked.matches, full = document.body.classList.contains('full') && docked.matches;
  // The header's hidden but its controls (CSS). The phone's search drawer is one of these, and stays out of reach while closed.
  document.querySelectorAll('.feed, #top').forEach(el => { el.inert = off || (full && el.tagName !== 'HEADER') || (el.id === 'search-drawer' && !searching()); });
  // Docked, the reader's pane and its display options are there with no story open, so it's never hidden from a screen reader.
  $('reader').setAttribute('aria-hidden', String(!document.body.classList.contains('reading') && !docked.matches));
  $('reader').setAttribute('aria-modal', String(!docked.matches));
};
docked.addEventListener('change', setInert);  // resizing never strands an inert list
setInert();
// Crossing the breakpoint changes where the reader sits, not whether it's open: no slide (a closed one would fly off).
docked.addEventListener('change', () => {
  document.body.classList.add('dragging');
  nextPaint('dragging');
});
// The row that's selected: the story open, or on a phone the one just closed, still highlighted as Feedbin's is.
const currentUrl = () => readerFor ?? (phone.matches ? lastClosed : null);
const markCurrent = url => {
  document.querySelectorAll('a.card').forEach(a => {
    if (url && a.getAttribute('href') === url) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
  placeMore();
};

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// Inside the article frame, the only script allowed is this one. It must pass two policies: the frame's own (by nonce)
// and the page's, which a srcdoc frame inherits (by hash, in site/_headers; tests/csp.test.js keeps it current). It reports rightward swipes to the
// page so the reader can follow the finger, forwards Escape, j/k, ←/→ and Cmd/Ctrl+K, and takes theme and typeface changes. The frame has no same-origin access; it can only postMessage.
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
addEventListener('message', e => {
  if (e.source !== parent || !e.data) return;
  if (e.data.tw === 'page') page(e.data.up);
  if (e.data.tw === 'theme') {  // the page's theme toggle
    document.documentElement.dataset.theme = e.data.theme;
    getComputedStyle(document.body).color;  // apply the new colors now, not at a paint the page's crossfade is holding back
    parent.postMessage({ tw: 'themed' }, '*');
  }
  if (e.data.tw === 'font') {  // a typeface picked: its stylesheet in place of the last, in this frame
    // The text reflows, so the block at the top of the view is held there, as scroll anchoring does where the browser has it.
    const held = [...document.querySelector('main').children].find(n => n.getBoundingClientRect().bottom > 0), was = held && held.getBoundingClientRect().top;
    document.getElementById('faces').textContent = e.data.css;
    document.documentElement.dataset.font = e.data.font;
    if (held) document.fonts.ready.then(() => scrollBy(0, held.getBoundingClientRect().top - was));
  }
  if (e.data.tw === 'size' || e.data.tw === 'fluid') {
    const root = document.documentElement, k = e.data.tw;
    if (root.dataset[k] === e.data[k]) return;
    root.classList.add('glide'); clearTimeout(glideTimer); glideTimer = setTimeout(() => root.classList.remove('glide'), 400);  // see main's glide
    root.dataset[k] = e.data[k];
  }
});
let glideTimer;
// Space pages through the article; at its end, the page opens the next unread story.
const page = up => {
  if (!up && scrollY + innerHeight >= document.documentElement.scrollHeight - 2) return parent.postMessage({ tw: 'next' }, '*');
  scrollBy({ top: (up ? -1 : 1) * (innerHeight - 40), behavior: 'smooth' });
};
// Listen: the page plays the story's audio; this frame hands it the page's blocks (headings, paragraphs, list items,
// quotes, and the upshot as one: audio.mjs builds the same list to time the audio), marks the block playing, and on a
// click says which block to play from.
let said = null;
addEventListener('message', e => {
  if (e.source !== parent || !e.data) return;
  if (e.data.tw === 'listen') {
    said = [...document.querySelectorAll('main :is(h1, h2, h3, h4, h5, h6, p, li, blockquote, dt, dd), .todo')]
      .filter(n => !n.parentElement.closest('p, li, blockquote, dt, dd, .todo') && !n.closest('.meta, .status') && n.innerText.trim());
    said.forEach(n => n.classList.add('sayable'));
    parent.postMessage({ tw: 'sayable', blocks: said.map(n => ({
      text: n.innerText.trim().split('\\n').map(l => l.trim()).filter(Boolean).join('. '),  // the upshot's lines: a pause after each
      kind: n.tagName === 'H1' ? 'title' : /^H[2-6]$/.test(n.tagName) ? 'head' : n.matches('.todo') ? 'upshot' : 'text' })) }, '*');
  }
  if (e.data.tw === 'said') {
    document.documentElement.classList.toggle('listening', e.data.n >= 0);
    const was = document.querySelector('.said'), n = said && said[e.data.n];
    if (was && was !== n) was.classList.remove('said');
    if (!n) return;
    n.classList.add('said');
    const r = n.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) n.scrollIntoView({ block: r.height > innerHeight * .8 ? 'start' : 'center', behavior: 'smooth' });
  }
});
addEventListener('click', e => {
  if (!said || !document.documentElement.classList.contains('listening') || e.target.closest('a') || !getSelection().isCollapsed) return;
  const n = said.findIndex(b => b.contains(e.target));
  if (n >= 0) parent.postMessage({ tw: 'seek', n: n }, '*');
});
addEventListener('keydown', e => {  // keys pressed while the article has focus never reach the page
  const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
  if (e.altKey) return;
  if (k === ' ' && !mod) { e.preventDefault(); return page(e.shiftKey); }
  // Letters only without ⌘/Ctrl, so the browser keeps ⌘L, ⌘A and the rest.
  if (['escape', 'k', '?', '/'].includes(k) || (!mod && (['j', 'm', 's', 'arrowleft', 'arrowright', 'v', 'g', 'e', 'l', 'a'].includes(k) || (e.shiftKey && (k === 'c' || k === 'f'))))) { e.preventDefault(); parent.postMessage({ tw: 'key', key: k, mod: mod, shift: e.shiftKey }, '*'); }
});`;

// The article frame's fonts. The article is set in the reader's typeface (Display options; it syncs, PREFS.font), Domaine
// by default, and the rest (the upshot, the date line) in Söhne, as on the page. Domaine and Söhne are licensed, Literata
// and Atkinson Hyperlegible Next open; all four are served from R2 by the Worker (worker.js), so no request leaves the
// site. A sandboxed frame has an opaque origin, which the browser caches apart every time, so a font loaded there by URL
// would download afresh for every frame (two per article) and flash the fallback meanwhile. The page fetches each once
// instead, cached as usual, and hands it to every frame inline. Until one arrives, a frame loads it by URL.
// Literata and Atkinson come as Google's latin and latin-ext subsets. Only latin is handed over; latin-ext stays a URL, so
// the browser fetches it just for an article with one of its letters (ł, ő).
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
const face = (file, family, weight, style = 'normal', more = {}) => ({ file, family, weight, style, ...more });
const openFaces = (file, family) => ['Roman', 'Italic'].flatMap(n => [
  face(`${file}-${n}-Latin`, family, '400 700', n === 'Roman' ? 'normal' : 'italic', { range: LATIN }),
  face(`${file}-${n}-LatinExt`, family, '400 700', n === 'Roman' ? 'normal' : 'italic', { range: LATIN_EXT, byUrl: true }),
]);
// Söhne's three uprights, as on the page (index.html): every frame has them, for the upshot and the date line.
const SOHNE = [['Buch', '100 549'], ['Kraftig', '550 649'], ['Halbfett', '650 900']].map(([n, w]) => face(`Sohne-${n}`, 'Sohne', w, 'normal', { css: 'size-adjust: 108%;' }));
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', SERIF = 'ui-serif, "New York", "Iowan Old Style", Charter, Georgia, serif';
// `text` and `head`: the article's and the headline's families. Domaine is tuned with size-adjust (an x-height of 0.505em),
// Söhne as on the page; the others, system fonts included, are brought to Domaine's x-height by font-size-adjust (articleDoc).
const TYPEFACES = {
  system: { text: SANS, faces: [] },
  serif: { text: SERIF, faces: [] },
  atkinson: { text: `"Atkinson Hyperlegible Next", ${SANS}`, faces: openFaces('AtkinsonNext', '"Atkinson Hyperlegible Next"') },
  domaine: {
    text: `"Domaine Text", ${SERIF}`, head: `"Domaine Display", "Domaine Text", ${SERIF}`,  // Domaine's headline cut, finer than Text at this size
    faces: [
      ...[['Regular', 400, 'normal'], ['Italic', 400, 'italic'], ['Bold', 700, 'normal'], ['BoldItalic', 700, 'italic']].map(([n, w, slant]) => face(`Domaine-Text${n}`, '"Domaine Text"', w, slant, { css: 'size-adjust: 104%;' })),
      // The Medium, declared 600 for the h1: Domaine's Semibold sets heavier than the rest of the site. Its own ascent (1.08em)
      // drops the baseline so low in a 1.25 line that the clamp clips g's tail; 97% leaves room for both g (0.233em down) and Å (0.948em up).
      face('Domaine-DisplayMedium', '"Domaine Display"', 600, 'normal', { css: 'size-adjust: 104%; ascent-override: 97%;' }),
    ],
  },
  // The page's Söhne, with its two italics; Kräftig has none, so a 600 italic takes Halbfett's.
  sohne: { text: `Sohne, ${SANS}`, faces: [face('Sohne-BuchKursiv', 'Sohne', '100 549', 'italic', { css: 'size-adjust: 108%;' }), face('Sohne-HalbfettKursiv', 'Sohne', '550 900', 'italic', { css: 'size-adjust: 108%;' })] },
  literata: { text: `Literata, ${SERIF}`, faces: openFaces('Literata', 'Literata') },
};
const savedFont = localStorage.getItem('font');
let font = Object.hasOwn(TYPEFACES, savedFont) ? savedFont : 'domaine';
const frameFonts = {};
const frameFont = f => (!f.byUrl && frameFonts[f.file]) || `${location.origin}/fonts/licensed/${f.file}`;
const facesFor = k => [...SOHNE, ...TYPEFACES[k].faces];
// The frame's @font-face rules and families for a typeface, as one stylesheet: the relay swaps it in place to change typeface.
const facesCss = k => facesFor(k).map(f => `@font-face { font-family: ${f.family}; src: url("${frameFont(f)}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style};${f.range ? ` unicode-range: ${f.range};` : ''} ${f.css || ''} font-display: swap; }`).join('\n')
  + `\n:root { --face: ${TYPEFACES[k].text}; --face-head: ${TYPEFACES[k].head || 'var(--face)'}; }`;
// Fetched when the first story opens, or a typeface is picked: a visit that opens nothing never downloads them, and only
// the typeface in use is fetched. That story's frame waits for them (briefly; then it loads them by URL), so it doesn't draw
// in a fallback first.
const fontsReady = {}, fontsDone = new Set();
const frameFontsReady = k => (fontsReady[k] ||= Promise.race([loadFrameFonts(facesFor(k)), new Promise(done => setTimeout(done, 1500))]).then(() => { fontsDone.add(k); }));
function loadFrameFonts(faces) {
  return Promise.all(faces.filter(f => !f.byUrl && !frameFonts[f.file]).map(f =>
    // Without credentials, as the page's preload of Söhne asks, so the preloaded copy is reused rather than fetched again.
    fetch(frameFont(f), { credentials: 'omit' }).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => new Promise(done => {
      const read = new FileReader();
      read.onload = () => { frameFonts[f.file] = read.result; done(); };
      read.readAsDataURL(b);
    })).catch(() => {})));  // the URL still works
}
// The article frame can't see the page's CSS variables, so it gets both palettes, read from the page's own
// tokens, and the relay flips data-theme on it when the theme changes.
function frameVars(theme) {
  const probe = Object.assign(document.createElement('div'), { hidden: true });
  probe.dataset.theme = theme;
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const out = `color-scheme: ${theme}; ` + ["--accent", "--accent-soft", "--bg", "--bg-card", "--border", "--border-strong", "--text", "--text-muted", "--exploited", "--exploited-text", "--exploited-ink", "--accent-contrast", "--caution-ink"].map(v => `${v}: ${cs.getPropertyValue(v).trim()};`).join(' ');
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
  const x = i.exploited, exploited = x ? `${exploitedLabel(x)}${x.kev?.length ? ' · confirmed by CISA' : ''}` : '';  // the list's label, as is
  return `<div class="meta">${exploited ? `<p class="flag">${exploited}</p>` : ''}${esc(when)}${by ? ` by ${esc(by)}` : ''}${minutes ? ` · ${minutes} min read` : ''}</div>`;
}
// The upshot (written and checked by the build) with, for weekly essentials, the hand-picked "What to do" as its last line.
function summaryBox(tldr, why) {
  if (!tldr?.length) return why ? `<div class="todo"><b>What to do</b>${esc(why)}</div>` : '';
  return `<div class="todo tldr"><b>The upshot</b><ul>${tldr.map(t => `<li>${esc(t)}</li>`).join('')}</ul>${why ? `<p class="do"><b>What to do</b>${esc(why)}</p>` : ''}</div>`;
}
function articleDoc(i, html, nonce, why, minutes, byline) {
  return `<!doctype html><html data-theme="${document.documentElement.dataset.theme}" data-size="${textSize}" data-fluid="${fluid}" data-font="${font}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${location.origin} data:; img-src https: data:; media-src https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<base target="_blank"><style id="faces">${facesCss(font)}</style><style>
:root { ${frameVars('light')} } :root[data-theme="dark"] { ${frameVars('dark')} }
body { margin: 0; background: var(--bg); color: var(--text); font: 1.125rem/1.65 var(--face); overflow-wrap: break-word; }
:root:is([data-font="system"], [data-font="serif"], [data-font="atkinson"], [data-font="literata"]) body { font-size-adjust: 0.505; } .meta, .todo, .status, .pill { font-size-adjust: none; }  /* at Domaine's x-height (TYPEFACES), so a text size reads the same in each. Söhne keeps the page's tuning, which reads small at its x-height; the upshot and date line stay as they are */
main { --pad: 24px; box-sizing: border-box; max-width: calc(35.5em + 2 * var(--pad)); margin: 0 auto; padding: 32px var(--pad) 96px; }  /* em, not px: about 70 characters a line at every text size (640px at the default) */
.glide main { transition: max-width .3s ease, padding .3s ease; }  /* a change of text size or fluid width glides, as Feedbin's; a resize (full screen, the columns) doesn't, or the padding that changes at 600px would slide the story into place */
a { color: var(--accent); }
h1 { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; margin: 0 -.1em .4em; padding: 0 .1em; font-size: clamp(1.2444em, .8889em + 2vw, 1.5556em); font-weight: 600; line-height: 1.25; }  /* the clamp's overflow clips, so Domaine Display's ascent-override (below) keeps g, p and y inside the line; the side padding, canceled by the margin, is for a line-initial f, whose tip reaches left of its box; em, so it follows the text size (22.4–28px at the default 18px) */
h1 a { color: inherit; text-decoration: none; } h1 a:hover { text-decoration: underline; text-decoration-thickness: 2px; }
h1 { font-family: var(--face-head); }
[data-size="0"] body { font-size: 1.0625rem; } [data-size="2"] body { font-size: 1.25rem; } [data-size="3"] body { font-size: 1.375rem; }  /* sized for an x-height of about half the em: Domaine Text's is 0.486, which size-adjust: 104% above brings to 0.505 */
.meta { margin-bottom: 1.8em; color: var(--text-muted); font: 370 .88em/1.45 Sohne, system-ui, sans-serif; }  /* em: follows the text size */
.todo { margin: 0 0 1.8em; padding: 12px 16px; border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; background: var(--bg-card); }
.tldr ul { margin: .35em 0 0; padding-left: 1.15em; font: 370 .94em/1.5 Sohne, system-ui, sans-serif; } .tldr li + li { margin-top: .45em; }  /* sans: scanned, not read */
.tldr .do { margin: .8em 0 0; padding-top: .7em; border-top: 1px solid var(--border); font: 500 .94em/1.5 Sohne, system-ui, sans-serif; } .tldr .do b { font-size: .875em; }
.todo b { display: block; margin-bottom: 2px; color: var(--accent); font: 700 .82em/1.5 Sohne, system-ui, sans-serif; letter-spacing: .07em; text-transform: uppercase; }  /* the box's sizes are em too */
h2, h3, h4 { margin: 1.8em 0 .5em; font-weight: 700; line-height: 1.3; }
h2 { font-size: 1.2222em; } h3 { font-size: 1em; } h4 { font-size: .8889em; }  /* em: 22, 18 and 16px at the default, scaled with the text size */
ul, ol { padding-left: 1.4em; } li + li { margin-top: .35em; }
img, video { max-width: 100%; height: auto; border-radius: 8px; }
figure { margin: 1.6em 0; } figcaption { margin-top: .4em; color: var(--text-muted); font-size: .85em; }
blockquote { margin: 1.4em 0; padding-left: 1em; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
code { padding: .1em .3em; border-radius: 4px; background: var(--bg-card); font: .875em ui-monospace, SFMono-Regular, Consolas, monospace; }
pre { overflow-x: auto; padding: 12px 14px; border-radius: 8px; background: var(--bg-card); font: .7222em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; }
pre code { padding: 0; background: none; font: inherit; }
table { display: block; overflow-x: auto; border-collapse: collapse; font-size: .7778em; } th, td { padding: 4px 8px; border: 1px solid var(--border); } th { font-weight: 700; }
hr { border: 0; border-top: 1px solid var(--border); }
.flag { margin: 0 0 .35em; } .exploited { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; } .x-word { color: var(--text); } .x-word.compromised { color: var(--caution-ink); }
.fix-pill { padding: 1px 8px; border-radius: 999px; font-size: .9em; font-weight: 700; line-height: 1.35; }  /* a chip, as in the list; not .pill, the "Read it on" button's */ .no-patch { background: var(--exploited); color: var(--exploited-text); } .patch-out, .mitigation { padding: 0; color: var(--accent); font-size: 1em; font-weight: 600; line-height: inherit; }
.mitigation { color: var(--text-muted); font-weight: 500; } .patch-out::before, .mitigation::before { content: "·"; margin-right: 6px; color: var(--text-muted); }
.late { animation: late .2s ease .4s both; } @keyframes late { from { opacity: 0; } }
.status { color: var(--text-muted); font: 370 .9375rem/1.5 Sohne, system-ui, sans-serif; }
.pill { display: inline-block; padding: 10px 18px; border: 1px solid var(--accent); border-radius: 999px; font: 600 .9375rem/1.4 Sohne, system-ui, sans-serif; text-decoration: none; }
@media (max-width: 600px) { main { --pad: 18px; padding-top: 24px; padding-bottom: 80px; } .pill { padding: 12px 18px; } }
[data-fluid="1"] main { max-width: 100%; padding-left: max(var(--pad), 6% - 20px); padding-right: max(var(--pad), 6% - 20px); }  /* Fluid width: the pane's width, its margins growing with it (66px at 1440), never narrower than the column it replaces */
/* Listen: the block being read, in a soft wash a little wider than its text; a click on any block reads from there */
.sayable:not(.todo) { border-radius: .25em; } .sayable { transition: background-color .2s, box-shadow .2s; } .listening .sayable { cursor: pointer; }
.said { background: var(--accent-soft); box-shadow: 0 0 0 .35em var(--accent-soft); } .todo.said { box-shadow: none; }
</style><script nonce="${nonce}">${SWIPE_REPORTER}<\/script></head><body><main><h1><a href="${esc(i.url)}" target="_blank" rel="noopener" title="Open the original">${esc(i.title)}</a></h1>${storyMeta(i, byline, minutes || i.minutes)}${summaryBox(i.tldr, why)}${html}</main></body></html>`;
}
// What we already know about a story, from data.json: shown at once, and all that's left if the article can't be fetched.
// While loading, the body holds back a moment: most articles arrive before the panel has landed, and then just appear.
const storyCard = (i, status, loading) => `<div${loading ? ' class="late"' : ''}>${i.summary ? `<p>${esc(i.summary)}</p>` : ''}<p class="status">${status}</p>
<a class="pill" href="${esc(i.url)}" target="_blank" rel="noopener">Read it on ${esc(domain(i.url))}</a></div>`;
// Scripts run only by nonce (the swipe reporter); without allow-same-origin the frame can't touch this page.
function showInReader(i, html, why, minutes, byline) {
  if (!fontsDone.has(font)) return void frameFontsReady(font).then(() => { if (readerFor === i.url) showInReader(i, html, why, minutes, byline); });
  if (listen && listen.url !== i.url) stopListening();  // another story; this one's article in place of its card plays on
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
  frame.title = i.title;
  const built = font;
  frame.srcdoc = articleDoc(i, html, btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))), why, minutes, byline);  // not randomUUID: that needs HTTPS, which a dev server reached by address isn't
  // It loads behind whatever's showing and takes over once drawn, so the pane never blinks empty between frames.
  frame.classList.add('loading');
  frame.onload = () => {
    if (!frame.parentNode) return;
    while (frame.previousSibling) frame.previousSibling.remove();
    frame.classList.remove('loading');
    // Its srcdoc baked in the theme, size, width and typeface from when it was built; any may have changed while it loaded.
    if (font !== built) setFrameFont();
    frame.contentWindow.postMessage({ tw: 'theme', theme: document.documentElement.dataset.theme }, '*');
    frame.contentWindow.postMessage({ tw: 'size', size: String(textSize) }, '*');
    frame.contentWindow.postMessage({ tw: 'fluid', fluid: String(fluid) }, '*');
    if (listen?.url === i.url) frame.contentWindow.postMessage({ tw: 'listen' }, '*');  // playing: mark this frame's blocks instead
  };
  $('reader-body').append(frame);
}

// About 230 words a minute, the usual adult reading speed for this kind of text.
const readingMinutes = html => Math.max(1, Math.round(html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length / 230));
// Reader links are /read/<the headline's first words>. A clash gets a short hash of the article's URL; storyBySlug
// finds a story by either form, so a shared link outlives a clash coming or going.
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
// A link keeps working as the stories around it change: one with a hash still finds its story after the clash has left,
// and one with only the headline's words, once a later story shares them, finds the earliest, which had them alone.
const storyBySlug = slug => items.find(i => [slugBase(i.title), shortHash(i.url)].filter(Boolean).join('-') === slug)
  ?? items.filter(i => slugBase(i.title) === slug).sort((a, b) => Date.parse(a.published || a.date) - Date.parse(b.published || b.date))[0];
const readPath = url => '/read/' + slugFor(url);
// Articles fetched this visit, so reopening one is instant; only full articles, since a pending one may arrive later.
const articles = new Map();
// One request per article at a time: the reader and the prefetch below share it, so opening a story that's on its way
// waits for that fetch rather than starting another.
const fetching = new Map();
function fetchArticle(url) {
  if (!fetching.has(url)) fetching.set(url, fetch('/api/read?url=' + encodeURIComponent(url)).then(r => r.json()).then(r => {  // the Worker says what may be kept
    if (r.content) articles.set(url, { content: r.content, minutes: readingMinutes(r.content), byline: r.byline });
    return r;
  }).finally(() => fetching.delete(url)));
  return fetching.get(url);
}
// The top few unread stories in the list, fetched while the page is idle, one at a time, so opening one is instant. Not
// when the browser asks to save data.
const PREFETCH = 6;
async function prefetchArticles() {
  if (navigator.connection?.saveData) return;
  for (const i of shown.filter(isUnread).slice(0, PREFETCH)) {
    if (!articles.has(i.url)) await fetchArticle(i.url).catch(() => {});  // the reader asks again when it's opened
  }
}
let frameFor = null;  // whose article the reader's frame holds
function openReader(i, { fromHash = false } = {}) {
  const fresh = !document.body.classList.contains('reading');
  readerFor = i.url;
  findAudio(i.url);
  markRead(i.url);
  syncUnread();
  syncLater();
  const why = picks.get(i.url);
  const icon = iconFor(i.publisher);
  $('reader-icon').hidden = !icon.has;
  if (icon.has) $('reader-icon').src = icon.src;
  $('reader-icon').dataset.art = icon.art;
  $('reader-mono').hidden = icon.has;
  $('reader-mono').textContent = icon.mono;
  $('reader-source').textContent = source(i);
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
  setInert();
  markCurrent(i.url);
  syncTicker();
  if (docked.matches) cardFor(i.url)?.scrollIntoView({ block: 'nearest' });
  // pushed: this entry sits on top of the feed, so closing goes back. Opened from a link, it doesn't, or it would leave
  // the site. Kept in the entry, so it survives back and forward.
  if (fresh && !fromHash) history.pushState({ reader: true, pushed: true }, '', readPath(i.url) + location.search);
  else history.replaceState({ ...history.state, reader: true }, '', readPath(i.url) + location.search);
  if (fresh && !docked.matches) (lastInput === 'key' ? $('reader-close') : $('reader')).focus({ preventScroll: true });  // no ring after a tap; docked, focus stays in the list
  if (articles.has(i.url)) return;  // read once already this visit: articles don't change once stored
  let unreadable = 'The reader view isn\u2019t available right now.';
  fetchArticle(i.url).then(r => {
    if (readerFor !== i.url) { if (frameFor === i.url) frameFor = null; return; }  // another was opened meanwhile, or this one closed: its kept frame is still the loading card, so it's drawn afresh next time
    if (r.content) {
      const { minutes } = articles.get(i.url);
      showInReader(i, r.content, why, minutes, r.byline);
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
// The reader's display options: the theme (above), the typeface, the text size, and full screen and fluid width, each kept
// on this device.
// Text sizes: small, medium (the default), large, larger.
const SIZES = ['small', 'medium', 'large', 'larger'];
let textSize = Math.min(3, Math.max(0, +(localStorage.getItem('textSize') ?? 1) || 0));
let fluid = localStorage.getItem('fluid') === '1' ? 1 : 0;
const toFrame = msg => $('reader-body').querySelector('iframe[srcdoc]')?.contentWindow.postMessage(msg, '*');
// The typeface: the open article changes in place once its fonts are in (they're fetched on first use, frameFontsReady).
const markFont = () => $('format-pop').querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.font === font)));
// With no article showing, nothing is fetched: the next story fetches its typeface as it opens.
const setFrameFont = () => {
  const k = font;
  if ($('reader-body').querySelector('iframe[srcdoc]')) frameFontsReady(k).then(() => { if (font === k) toFrame({ tw: 'font', font: k, css: facesCss(k) }); });
};
function setFont(k, fromSync = false) {
  font = k;
  localStorage.setItem('font', k);
  markFont();
  setFrameFont();
  if (fromSync) return;
  $('status').textContent = `Typeface ${$('format-pop').querySelector(`[data-font="${k}"]`).textContent}`;
  notePref('font');
}
markFont();
const markSize = () => $('format-pop').querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.size === textSize)));
markSize();
$('format-fluid').setAttribute('aria-checked', String(!!fluid));
const closeFormat = () => { $('format-pop').hidden = true; $('reader-format').setAttribute('aria-expanded', 'false'); };
$('reader-format').onclick = e => {
  e.stopPropagation();
  const open = $('format-pop').hidden;
  closeMenus();  // one menu at a time: these clicks don't reach the page-wide close
  $('format-pop').hidden = !open;
  $('reader-format').setAttribute('aria-expanded', String(open));
  if (open) $('format-pop').querySelector('[aria-pressed="true"]').focus({ preventScroll: true });  // the theme, at the top
};
$('format-pop').onclick = e => {
  e.stopPropagation();  // it stays open, to see each change
  const b = e.target.closest('button');
  if (b?.dataset.pick) { pickTheme(b.dataset.pick); notePref('theme'); }
  else if (b?.dataset.font) setFont(b.dataset.font);
  else if (b?.dataset.size) {
    textSize = +b.dataset.size;
    localStorage.setItem('textSize', textSize);
    markSize();
    $('status').textContent = `Text size ${SIZES[textSize]}`;
    toFrame({ tw: 'size', size: String(textSize) });
  } else if (b?.id === 'format-full') setFull(!document.body.classList.contains('full'));
  else if (b?.id === 'format-fluid') {
    fluid = fluid ? 0 : 1;
    localStorage.setItem('fluid', String(fluid));
    b.setAttribute('aria-checked', String(!!fluid));
    toFrame({ tw: 'fluid', fluid: String(fluid) });
  }
};
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
  stopListening();
  document.body.classList.remove('reading');
  setFull(false);  // full screen is the open story's
  setInert();
  // Read later holds still while a story is open, so the list doesn't shift under the reader; closing it, a story unsaved
  // meanwhile leaves, and one saved from elsewhere (search) joins.
  if (filter === 'later' && (shown.some(i => !isSaved(i.url)) || shown.length !== items.filter(i => isSaved(i.url)).length)) renderItems(true);
  markCurrent(currentUrl());
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
  const decode = s => { try { return decodeURIComponent(s); } catch { return null; } };  // a mangled link (%E0) is just not a story
  const url = path ? storyBySlug(decode(path[1]))?.url
    : location.hash.startsWith('#read=') ? decode(location.hash.slice(6)) : null;
  const i = url && items.find(x => x.url === url);
  if (i && readerFor !== url) openReader(i, { fromHash: true });
  else if (!i && document.body.classList.contains('reading')) closeReader();
  else if (!i && path) history.replaceState(null, '', '/' + location.search);  // a story that's since left the site
}
addEventListener('popstate', e => {
  if (searching() && !history.state?.search) closeSearch();
  // Forward, onto the entry of a search since closed: it's the list's entry now, so the next search pushes its own above it.
  if (!searching() && history.state?.search) history.replaceState({ ...history.state, search: undefined }, '');
  if (afterSearch) { const then = afterSearch; afterSearch = null; return then(); }
  if (picked !== null && history.state?.f) history.replaceState({ ...history.state, f: picked }, '');
  picked = null;
  syncFromUrl();
  const home = !history.state?.list && !history.state?.reader;
  if (home && !document.body.classList.contains('home')) lastList = filter;
  // Safari's own swipe-back already animates the page: don't slide it a second time.
  if (e.hasUAVisualTransition) { document.body.classList.add('paging'); nextPaint('paging'); }
  syncHome();
});
// Swipe right to close: the reader follows the finger, then closes past a third of its width or on a flick
// (judged on the finger's speed at release, px/ms).
let drag = null;
const setDrag = f => document.documentElement.style.setProperty('--drag', f);
function dragStart(x) {
  if (docked.matches) return;  // docked, the reader doesn't slide: there's nothing to swipe away
  drag = { x, dx: 0, lx: x, lt: performance.now(), v: 0 };
  document.body.classList.add('dragging');
}
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
const touchEnd = () => { if (touch?.ax === 'x') dragEnd(); touch = null; };
$('reader').addEventListener('touchend', touchEnd); $('reader').addEventListener('touchcancel', touchEnd);
// Swipes inside the article frame arrive as messages from the swipe reporter.
addEventListener('message', e => {
  // The loading one too, but only article frames: a framed original page is the publisher's code, not the relay.
  const ours = [...$('reader-body').querySelectorAll('iframe[srcdoc]')].some(f => e.source === f.contentWindow);
  if (!ours || typeof e.data?.tw !== 'string') return;
  if (e.data.tw === 'start') dragStart(e.data.x);
  else if (e.data.tw === 'move') dragMove(e.data.x);
  else if (e.data.tw === 'end') dragEnd();
  else if (e.data.tw === 'key') { lastInput = 'key'; onKey(e.data.key, !!e.data.mod, { shiftKey: !!e.data.shift, preventDefault() {} }); }  // a key in the article: the keyboard's in use
  else if (e.data.tw === 'themed') frameThemed?.();
  else if (e.data.tw === 'next') nextUnread();  // Space at the article's end
  else if (e.data.tw === 'sayable' && e.source === frameNow()) heardBlocks(e.data.blocks);
  else if (e.data.tw === 'seek' && Number.isInteger(e.data.n)) seekBlock(e.data.n);  // a click on a block
});

// Phone swipes, after Feedbin's: the topics sit left of a list, and a list left of its story, and each page follows the
// finger. In a list, right goes back to the topics and left brings back the story just closed; on the topics, left goes
// back into the list just left. Past a third of the way, or on a flick, it goes; otherwise it springs back.
let pan = null;
addEventListener('touchstart', e => {
  const t = e.touches[0];
  pan = phone.matches && !document.body.classList.contains('reading') && !$('palette').open && !$('confirm-read').open
    ? { x: t.screenX, y: t.screenY, lx: t.screenX, lt: performance.now(), v: 0, mode: null } : null;
}, { passive: true });
addEventListener('touchmove', e => {
  if (!pan) return;
  const t = e.touches[0], dx = t.screenX - pan.x, dy = t.screenY - pan.y, w = innerWidth, home = document.body.classList.contains('home');
  if (!pan.mode) {
    if (Math.hypot(dx, dy) < 10) return;
    if (Math.abs(dy) > Math.abs(dx)) { pan = null; return; }  // a scroll
    const story = lastClosed && items.find(x => x.url === lastClosed);
    pan.mode = home ? (dx < 0 && lastList !== null && exists(lastList) ? 'list' : 'none')
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
    if (shown.indexOf(next) >= limit) showMore(limit + PAGE);
    return openReader(next);
  }
  const cards = [...document.querySelectorAll('a.card')];
  const at = cards.indexOf(document.activeElement);
  const target = cards[at < 0 ? 0 : Math.min(cards.length - 1, Math.max(0, at + dir))];
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'nearest' });
}
// Space: the article scrolls a screen at a time (in its frame, which reports back when it's at the end); then the next
// unread story in the list, after the one open or focused, as Feedbin's Space does.
function nextUnread() {
  const from = shown.findIndex(i => i.url === (readerFor ?? document.activeElement?.closest('a.card')?.getAttribute('href')));
  const at = shown.findIndex((i, n) => n > from && isUnread(i));
  if (at < 0) { $('status').textContent = 'No more unread stories in this list'; return; }
  if (at >= limit) showMore(at + PAGE);
  openReader(shown[at]);
}
// Full screen (Shift F, or the display options): the reader takes the whole window, the topics and the list hidden.
function setFull(on) {
  document.body.classList.toggle('full', on);
  $('format-full').setAttribute('aria-checked', String(on));
  setInert();
}
let goAt = 0;
function onKey(key, mod, e) {
  const reading = document.body.classList.contains('reading');
  if ($('keys').open && key === '?') { e?.preventDefault(); return $('keys').close(); }  // ? shows the list and hides it again
  if ($('keys').open || $('confirm-read').open || $('sync').open) return;  // the dialogs handle their own Esc
  if ($('palette').open) {  // so does this one; j/k and Esc mustn't reach the reader behind it
    if (key === 'k' && mod) { e?.preventDefault(); openPalette(); }
    return;
  }
  if (key === 'escape' && !$('format-pop').hidden) { closeFormat(); return $('reader-format').focus(); }
  if (key === 'escape' && !$('send-pop').hidden) { closeShare(); return $('reader-send').focus(); }
  if (key === 'escape' && !morePop.hidden) { closeMore(); return moreBtn.focus(); }
  if (key === 'escape' && document.querySelector('[popover]:popover-open')) return;  // a popover (the header's menu, the speeds) closes itself, and only that
  if (key === 'escape' && document.body.classList.contains('full')) return setFull(false);  // out of full screen first, then the reader
  if (key === 'escape' && reading) return dismiss();
  if (key === 'k' && mod) { e?.preventDefault(); return openPalette(); }
  if (mod || e?.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (key === ' ' && document.activeElement?.closest('button, summary, [role="menuitem"]')) return;  // Space presses a focused button
  // Feedbin's "go to" pairs: g, then a, e or l within a moment.
  const go = Date.now() - goAt < 1500 && { a: 'all', e: 'essentials', l: 'later' }[key];
  goAt = key === 'g' ? Date.now() : 0;
  if (go) { e?.preventDefault(); return $('filters').querySelector(`[data-f="${go}"]`)?.click(); }  // as a click: closes the story, slides to the list
  const url = readerFor ?? document.activeElement?.closest('a.card')?.getAttribute('href');  // the story open, or the row focused
  if (key === '?') { e?.preventDefault(); $('keys').showModal(); }
  else if (key === '/') { e?.preventDefault(); openPalette(); }
  else if (key === 'm' && reading) { e?.preventDefault(); toggleRead(); }
  else if (key === 's' && reading) { e?.preventDefault(); toggleLater(); }
  else if (key === 'l' && reading) { e?.preventDefault(); toggleListen(); }
  else if (key === 'a' && e?.shiftKey) { e.preventDefault(); confirmReadAll(); }  // Feedbin's: the list's Read button
  else if (key === ' ' && (reading || !e?.shiftKey)) { e?.preventDefault(); if (reading) toFrame({ tw: 'page', up: e?.shiftKey }); else nextUnread(); }  // Shift Space on the list scrolls it, as usual
  else if (key === 'v' && url) { e?.preventDefault(); window.open(url, '_blank', 'noopener'); }
  else if (key === 'c' && e?.shiftKey && url) { e.preventDefault(); copyLink(url); }
  else if (key === 'f' && e?.shiftKey && reading && docked.matches) { e.preventDefault(); setFull(!document.body.classList.contains('full')); }
  else if (key === 'j' || key === 'arrowright') { e?.preventDefault(); step(1); }
  else if (key === 'k' || key === 'arrowleft') { e?.preventDefault(); step(-1); }
}
addEventListener('keydown', e => onKey(e.key.toLowerCase(), e.metaKey || e.ctrlKey, e));

// Share the publisher's article, not this site's reader link: that's what the recipient wants.
// The browser's own share sheet where it has one (phones, and Chrome, Edge and Safari on Windows and Mac); otherwise a menu.
// The same menu everywhere; where the browser has a share sheet, "More…" opens it.
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
function closeMenus() { closeFormat(); closeShare(); closeMore(); }
// A click anywhere closes them (clicks on their own buttons stop short of this); so does a tap into the article, which lands
// in its frame and blurs this window.
document.addEventListener('click', closeMenus);
addEventListener('blur', closeMenus);
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
$('send-copy').onclick = () => { closeShare(); if (readerFor) copyLink(readerFor); };
async function copyLink(url) {
  let msg = 'Copied';
  try { await navigator.clipboard.writeText(url); } catch { msg = 'Couldn\u2019t copy'; }
  const done = $('send-done');
  done.textContent = msg; done.hidden = false; $('status').textContent = msg === 'Copied' ? 'Link copied' : msg;
  clearTimeout(done.timer);
  done.timer = setTimeout(() => { done.hidden = true; }, 1600);
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
      ${iconHtml(i.publisher)}
      <div><div class="p-title">${highlight(i.title, q)}</div><div class="p-meta">${esc(source(i))} · ${CATS[c]} · ${age(i)}</div>${searchLabel(i)}</div>
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
  $('palette').close();
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
// A click on any dialog's backdrop closes it. The dialog is the target there, but also in its own padding and when a drag
// (selecting the code, say) ends off the element it began on, so the press and the release must both fall outside its box.
const onBackdrop = (d, e) => { const r = d.getBoundingClientRect(); return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom); };
document.querySelectorAll('dialog').forEach(d => {
  let pressed = false;
  d.addEventListener('pointerdown', e => { pressed = onBackdrop(d, e); });
  d.addEventListener('click', e => { if (pressed && onBackdrop(d, e)) d.close(); });
});
$('palette-close').addEventListener('click', () => $('palette').close());
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
  if (localStorage.getItem(k + 'Width')) setCol(k, +localStorage.getItem(k + 'Width'), false);  // index.html's head script applied it before the first paint; this fits it to the window
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
const BUILD_AT_MINUTE = 27;  // cron "27 * * * *" UTC, in wrangler.jsonc (which starts the build) and build.yml
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
  t.setUTCMinutes(BUILD_AT_MINUTE, 0, 0);
  if (t <= now) t.setUTCHours(t.getUTCHours() + 1);
  return Math.round((t - now) / 60e3);
}
function tickerLines() {
  const mins = Math.max(0, (Date.now() - Date.parse(generatedAt)) / 60e3);
  return [new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()),
    `Updated ${agoText(mins)}`,
    ...(mins < STALE_MINUTES ? [`Next update in ${nextBuildMinutes()}m`] : [])];  // late: no promise of when
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
// The first load failed: say so where the stories go, and on a phone's topics (the page in view there), with a way to try again.
// The 15-minute check keeps trying too, and its redraw replaces this.
function loadFailed() {
  const msg = '<p class="empty">Couldn\u2019t load the news.<button class="retry" type="button">Try again</button></p>';
  $('items').innerHTML = msg;
  $('items').removeAttribute('aria-busy');
  $('filters').innerHTML = phone.matches ? msg : '';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.retry')) return;
  document.querySelectorAll('.retry').forEach(b => { b.disabled = true; b.textContent = 'Trying\u2026'; });
  load().catch(loadFailed);
});
// A scanned sync code (/#sync=XXXX-XXXX, from the QR code): out of the address bar at once, then shown in the code sheet,
// which tells a device already syncing that it would move to that sync.
const scanned = location.hash.match(/^#sync=([0-9A-Za-z]{4}-?[0-9A-Za-z]{4})$/)?.[1];
if (scanned) history.replaceState(history.state, '', location.pathname + location.search);
load().then(() => (document.hidden ? syncNow() : connectLive())).then(() => {  // connectLive syncs first
  if (!scanned) return;
  $('sync').showModal(); syncView('code');
  $('sync-code').value = scanned.toUpperCase().replace(/^(.{4})-?/, '$1-');
  // An app's built-in browser (the Google app's, opened by a camera's QR scan) keeps its own storage: joining there would
  // sync it, not the reader's browser. The code stays unused, for the reader to enter in their browser.
  if (/GSA\/|; wv\)|FBAN|FBAV|Instagram/.test(navigator.userAgent)) { $('sync-code-inapp').hidden = false; return; }
  // Filled in, never sent: a link can't be told from a scan, and a link from someone else would join their sync and send
  // them this device's reading. Continue is the choice.
  $('sync-code-go').focus();
}).catch(loadFailed);
// Builds land every hour: check every 15 min while visible, and when the tab comes back into view.
const check = () => { if (!document.hidden) return load().catch(() => {}); };
setInterval(check, 15 * 60e3);
setInterval(() => { if (generatedAt && !document.hidden) { showUpdated(); refreshAges(); } }, 60e3);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return stopTicker(); }
  const back = tickOnShow || (Date.now() - hiddenAt > REOPEN_MINUTES * 60e3 && passDue());  // a phone reopens from the background, not a fresh load
  tickOnShow = false;
  check()?.then(() => { if (back) playTicker(); });
});
