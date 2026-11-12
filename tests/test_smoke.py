"""Browser smoke test: the feed, reader, palette and swipe work under the real CSP, with no CSP violations,
console errors or page errors. Runs against `npx wrangler dev` (CI starts one); skipped without SMOKE_URL.
/api/read is stubbed because it needs the articles the build stores; tests/read.test.js covers the function."""
import json
import os
import re
import urllib.parse
from datetime import date, datetime, timedelta, timezone

import pytest

URL = os.environ.get("SMOKE_URL")
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
pytestmark = pytest.mark.skipif(not URL, reason="set SMOKE_URL to a running `npx wrangler dev`")

PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw="
BODY = "".join(f"<p>Paragraph {n} of the stub article, long enough to read like the real thing.</p>" for n in range(30))


@pytest.fixture(scope="module")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("PW_CHROMIUM") or None)
        yield b
        b.close()


def open_site(browser, patch=None, **context):
    """The site in a fresh browser, on the All list. `patch` edits data.json on its way in."""
    ctx = browser.new_context(**context)
    if patch:
        def patched(route):
            data = route.fetch().json()
            patch(data)
            route.fulfill(json=data)
        ctx.route("**/data.json*", patched)
    # A reader from before the first story, so everything counts as unread. A first visit has its own test.
    ctx.add_init_script("try { localStorage.getItem('since') || localStorage.setItem('since', '1970-01-01T00:00:00Z'); } catch {}")  # not in the sandboxed article frame
    pg = ctx.new_page()
    pg.problems = []
    pg.on("pageerror", lambda e: pg.problems.append(f"page error: {e}"))
    pg.on("console", lambda m: pg.problems.append(f"console: {m.text}") if m.type == "error" else None)

    def stub(route):
        url = urllib.parse.parse_qs(urllib.parse.urlsplit(route.request.url).query)["url"][0]
        route.fulfill(content_type="application/json",
                      body=json.dumps({"url": url, "frameable": False, "content": f'<img src="{PIXEL}" alt="">{BODY}'}))
    ctx.route("**/api/read?*", stub)
    pg.goto(URL)
    enter_list(pg)
    return pg


def enter_list(pg):
    """Phones open on the topics; this steps into the All list, as a tap on it would. Elsewhere the list is already there."""
    pg.wait_for_selector("a.card", state="attached")
    if pg.evaluate("document.body.classList.contains('home') && matchMedia('(max-width: 640px)').matches"):
        pg.evaluate("document.querySelector(\"#filters [data-f='all']\").click()")
    pg.wait_for_selector("a.card")


def first_card(pg):
    card = pg.locator("a.card").first
    return card, card.locator(".card-title").text_content()  # inner_text is empty until content-visibility renders the card


def reading(pg):
    return pg.evaluate("document.body.classList.contains('reading')")


def wait_until_closed(pg, timeout=5000):
    # Not page.wait_for_function: it evaluates a string, which the CSP (rightly) blocks.
    for _ in range(timeout // 100):
        # Closed, and done sliding out. The article frame runs in its own process, which gets clicks by hit-test data
        # that lags on a slow runner: a click while the panel still moves can go to the old frame, never reaching the page.
        if not reading(pg) and not pg.evaluate("document.getElementById('reader').getAnimations().length"):
            return
        pg.wait_for_timeout(100)
    state = pg.evaluate("({ messages: window.__tw || null, drag: getComputedStyle(document.documentElement).getPropertyValue('--drag'),"
                        " frames: document.querySelectorAll('#reader-body iframe:not(.loading)').length, hash: location.hash.slice(0, 40) })")
    raise AssertionError(f"the reader didn't close: {state}")


def test_csp_header_is_served(browser):
    pg = open_site(browser)
    csp = pg.request.get(URL).headers.get("content-security-policy", "")
    assert re.search(r"script-src ('nonce-[^']+' )?'self' 'sha256-", csp) and "object-src 'none'" in csp  # pages carry a nonce from the Worker
    assert pg.problems == []


def test_feed_renders(browser):
    pg = open_site(browser)
    assert pg.locator("a.card").count() > 0
    assert pg.locator(".filter-btn").count() >= 2  # All + each category with stories
    assert "0" not in pg.locator("#filters .f-count").all_inner_texts()  # no empty topics
    assert re.fullmatch(r"Updated (just now|\d+[mhd] ago)", pg.inner_text(".side-foot #updated"))
    assert pg.locator("#end").is_hidden()  # not until the list runs out
    # No headings or counts over the list, as in Feedbin: it starts at the top, and each story says how old it is.
    assert pg.locator("#items > :not(a.card)").count() == 0
    assert pg.evaluate("document.querySelector('a.card').getBoundingClientRect().top - document.getElementById('items').getBoundingClientRect().top") < 12
    assert all(re.fullmatch(r"\d+[mhd]|[A-Z][a-z]{2} \d{1,2}(, \d{4})?", t) for t in pg.locator("a.card .card-age").all_text_contents())
    assert pg.locator(".card-arrow").count() == 0 and pg.locator(".card-time").count() == 0
    # After Feedbin: the publisher's icon, then title, source, the one-line summary and how old it is. The topic is the sidebar's job.
    first = pg.locator("a.card").first
    assert pg.evaluate("[...document.querySelector('a.card .card-body').children].map(e => e.className)") == ["card-title", "card-meta", "card-sum", "card-age"]
    assert first.locator("> .src-icon").count() == 1 and pg.locator("a.card .dot").count() == 0
    assert first.locator(".card-src").inner_text() == pg.evaluate("source(items[0])")
    hn = pg.evaluate("items.find(i => i.publisher.startsWith('Hacker News '))?.url")  # who wrote it, not where it was found
    assert hn and pg.locator(f'a.card[href="{hn}"] .card-src').text_content() == urllib.parse.urlsplit(hn).hostname.removeprefix("www.")
    assert first.locator(".card-sum").inner_text() == pg.evaluate("items[0].summary")
    assert first.evaluate("e => [getComputedStyle(e).borderTopWidth, getComputedStyle(e).boxShadow]") == ["0px", "none"]  # rows, not boxes
    assert pg.locator("#weekly, .weekly-card").count() == 0  # the essentials are an entry in the topics now
    assert pg.problems == []


def test_phone_menu(browser):
    pg = open_site(browser, viewport={"width": 320, "height": 700}, has_touch=True, is_mobile=True)
    assert pg.locator("#theme").is_hidden()
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    pg.tap("#menu-btn")
    assert pg.locator("#menu a[href='/rss.xml']").is_visible()
    theme = pg.evaluate("document.documentElement.dataset.theme")
    pg.tap("#theme")
    pg.wait_for_function("t => document.documentElement.dataset.theme !== t", arg=theme)  # swaps inside a view transition
    pg.keyboard.press("Escape")
    pg.locator("#theme").wait_for(state="hidden")  # after the closing fade
    # Tapping away closes the menu without opening the article underneath.
    pg.tap("#menu-btn")  # before measuring: playwright's tap may scroll the page to reach the button
    x, y = pg.evaluate("""() => { const r = [...document.querySelectorAll('a.card')].map(c => c.getBoundingClientRect())
        .find(r => r.bottom > 340 && r.top < innerHeight - 40); return [r.left + r.width / 2, Math.max(r.top, 300) + 20]; }""")  # below the drawer
    assert pg.evaluate("document.getElementById('menu').getBoundingClientRect().width") == 320  # full width
    pg.wait_for_timeout(300)
    pg.touchscreen.tap(x, y)
    pg.locator("#theme").wait_for(state="hidden")
    assert not reading(pg)
    pg.touchscreen.tap(x, y)
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert pg.problems == []


def test_animations_run_under_reduced_motion(browser):
    pg = open_site(browser, viewport={"width": 412, "height": 800}, has_touch=True, is_mobile=True, reduced_motion="reduce")
    running = "s => getComputedStyle(document.querySelector(s)).transitionDuration !== '0s' && getComputedStyle(document.querySelector(s)).transitionProperty !== 'none'"
    for selector in ("#menu", "#reader"):
        assert pg.evaluate(running, selector), selector
    pg.tap("#menu-btn")
    pg.wait_for_function("() => document.getElementById('menu').getAnimations().length > 0 || getComputedStyle(document.getElementById('menu')).clipPath.includes('-40px')")
    pg.evaluate("document.getElementById('theme').click()")
    pg.wait_for_function("() => document.getAnimations().some(a => a.effect.pseudoElement?.includes('view-transition'))")
    assert pg.problems == []


def test_phones_open_on_the_topics(browser):
    ctx = browser.new_context(viewport={"width": 320, "height": 700}, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    problems = []
    pg.on("pageerror", lambda e: problems.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector("#filters .filter-btn")
    # The topics are the page: the list waits off to the right, out of reach, and every entry is a full-size row.
    aside = "() => document.getElementById('col').getBoundingClientRect().left >= innerWidth && document.getElementById('col').inert"
    shown_ = "s => +getComputedStyle(document.querySelector(s)).opacity"
    assert pg.evaluate(aside) and pg.evaluate(shown_, ".logo-h") == 1 and pg.evaluate(shown_, "#list-back") == 0
    assert pg.evaluate("document.getElementById('list-back').inert")  # faded out, and out of reach
    assert pg.evaluate(shown_, "#search-btn") == 0 and pg.evaluate("document.getElementById('search-btn').inert")  # search is for lists
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert pg.locator(".resizer").evaluate_all("els => els.every(e => getComputedStyle(e).display === 'none')")  # desktop's column edges
    for row in pg.locator("#filters .filter-btn").all():
        box = row.bounding_box()
        assert box["height"] >= 44 and box["x"] + box["width"] <= 320
        for x in range(10, 320, 20):  # nothing sits over a row: every point of it taps the row
            assert pg.evaluate("([x, y, f]) => document.elementFromPoint(x, y)?.closest('.filter-btn')?.dataset.f === f",
                               [x, box["y"] + box["height"] / 2, row.get_attribute("data-f")]), x
    pg.tap("#filters .filter-btn[data-f='security']")
    # It slides in over the topics, the way a story slides over the list, rather than jumping.
    pg.wait_for_function("() => document.getAnimations().some(a => a.transitionProperty === 'transform' && a.effect.target?.id === 'col')")
    # The header crossfades with it: the wordmark out, the list's chevron and name in, together.
    pg.wait_for_function("() => document.getAnimations().some(a => a.transitionProperty === 'opacity' && a.effect.target?.id === 'list-name')")
    pg.wait_for_function("() => document.getElementById('col').getBoundingClientRect().left === 0")
    pg.wait_for_function("() => +getComputedStyle(document.querySelector('.logo-h')).opacity === 0 && document.querySelector('.logo-h').inert")
    assert pg.evaluate(shown_, "#search-btn") == 1 and not pg.evaluate("document.getElementById('search-btn').inert")
    # Its list, as a page: a back chevron and its name in the header, in place of the logo, and the topics out of reach.
    assert pg.evaluate("document.getElementById('filters').inert") and pg.locator("#list-back").is_visible() and pg.inner_text("#list-name") == "Security"
    assert pg.evaluate("shown.length > 0 && shown.every(i => cat(i.category) === 'security')")
    assert pg.title() == "Security \u00b7 Upshot"
    pg.go_back()  # the phone's back button
    pg.wait_for_function(aside)
    pg.go_forward()  # and forward again, to the same list
    pg.wait_for_selector("a.card")
    assert pg.inner_text("#list-name") == "Security"
    pg.tap("#list-back")  # the chevron goes back too
    pg.wait_for_function(aside)
    assert problems == []


def test_essentials_have_their_own_entry_and_show_once(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    picks = pg.evaluate("weekly.items.filter(p => items.some(i => i.url === p.url))")
    hrefs = pg.locator("a.card").evaluate_all("els => els.map(e => e.getAttribute('href'))")
    assert len(hrefs) == len(set(hrefs))  # nothing listed twice
    marked = pg.locator("a.card.essential").evaluate_all("els => els.map(e => e.getAttribute('href'))")
    assert set(marked) == {p["url"] for p in picks} & set(hrefs)
    assert all(t == "Essential" for t in pg.locator("a.card.essential .ess").all_text_contents())  # text_content: off-screen rows aren't rendered yet
    pg.click("#filters .filter-btn[data-f='essentials']")
    assert pg.locator("#filters .filter-btn[data-f='essentials'] .f-count").text_content() == f"{len(picks)} unread"  # nothing read yet
    cards = pg.locator("a.card")
    assert cards.count() == len(picks)
    # One week, not days, and each pick previews what to do rather than its summary.
    pg.locator("#end").wait_for()  # five fit on one page: the end says which week they're from
    assert pg.inner_text("#end-msg") == f"That\u2019s all {len(picks)} essentials from {pg.evaluate('weekRange(weekly)')}."
    for n, p in enumerate(picks):
        sel = f'a.card[href="{p["url"]}"]'
        assert pg.locator(f"{sel} .card-sum").inner_text() == f"What to do: {p['why']}"
        assert pg.locator(f"{sel} .card-sum").evaluate("e => e.scrollHeight <= e.clientHeight")  # never cut short
        assert pg.locator(f"{sel} .ess").count() == 0  # the view says it already
    assert pg.problems == []


def stale_site(browser, hours, **context):
    ctx = browser.new_context(**context)
    pg = ctx.new_page()
    built = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")  # once: every fetch sees the same build
    def patched(route):
        data = route.fetch().json()
        data["generated_at"] = built
        route.fulfill(json=data)
    ctx.route("**/data.json*", patched)
    pg.goto(URL)
    enter_list(pg)
    return pg


def test_late_bar_appears_once_a_build_is_late_and_can_check_again(browser):
    pg = stale_site(browser, 4.5, viewport={"width": 1300, "height": 900})  # due, but GitHub runs schedules late
    assert pg.locator("#stale").is_hidden() and pg.locator("#updated").is_visible()
    pg = stale_site(browser, 6, viewport={"width": 1440, "height": 900})
    bar, col = pg.locator("#stale").bounding_box(), pg.locator("#col").bounding_box()
    assert pg.inner_text("#stale-msg") == "Last updated 6h ago" and pg.locator("#updated").is_hidden()  # one slot, two states
    assert bar["y"] + bar["height"] == 900 and bar["x"] == col["x"] and bar["width"] <= col["width"]  # at the list's foot
    fetches = []
    pg.on("request", lambda r: fetches.append(r.url) if "/data.json" in r.url else None)
    check = pg.locator("#stale-check")
    assert check.inner_text() == "" and check.get_attribute("aria-label") == "Check again"  # a reload icon, named for screen readers
    held = []
    pg.route("**/data.json*", lambda r: held.append(r))  # held, so the check is caught in the act
    check.click()
    pg.wait_for_function("() => document.getElementById('stale-check').classList.contains('checking')")
    assert check.is_disabled()
    for _ in range(50):
        if held:
            break
        pg.wait_for_timeout(20)
    held[0].fallback()
    pg.locator("#stale-msg", has_text="No new stories yet").wait_for()  # it looked, now, and says so
    assert "checking" not in check.get_attribute("class").split()
    assert fetches and pg.inner_text("#status") == "No new stories yet"
    pg.locator("#stale-msg", has_text="Last updated").wait_for()
    assert pg.problems == [] if hasattr(pg, "problems") else True


def test_late_bar_is_a_bottom_bar_on_a_phone(browser):
    pg = stale_site(browser, 6, viewport={"width": 320, "height": 700}, has_touch=True, is_mobile=True)
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    bar, tools = pg.locator("#stale").bounding_box(), pg.locator("#list-bar").bounding_box()
    assert bar["x"] == 0 and bar["width"] == 320 and bar["y"] + bar["height"] == tools["y"]  # on top of the list's toolbar
    assert tools["width"] == 320 and tools["y"] + tools["height"] == 700
    assert pg.locator("#stale-check").bounding_box()["height"] >= 44


def test_each_story_says_how_long_ago_it_was_published(browser):
    ctx = browser.new_context(viewport={"width": 1300, "height": 900}, timezone_id="UTC")
    pg = ctx.new_page()
    now = datetime.now(timezone.utc)
    ago = lambda **d: (now - timedelta(**d)).isoformat(timespec="seconds")
    day = lambda n: (now.date() - timedelta(days=n)).isoformat()
    def patched(route):
        data = route.fetch().json()
        a, b, c, d, e, f, g = data["items"][:7]
        data["items"] = [
            {**a, "date": day(0), "published": ago(minutes=5)},
            {**b, "date": day(0), "published": ago(hours=5, minutes=10)},
            {**c, "date": day(3), "published": ago(days=3, hours=2)},
            {**d, "date": day(2), "added": ago(minutes=30)},  # before the exact time was kept: whole days by its date
            {**e, "date": day(0), "added": ago(hours=2)},  # ...or when it arrived, the same day
            {**f, "date": "2026-01-05", "published": "2026-01-05T09:00:00+00:00"},
            {**g, "date": (now - timedelta(hours=20)).date().isoformat(), "added": ago(hours=20)},  # ...on its date, even if that was yesterday
        ]
        for i in data["items"][3:5] + data["items"][6:]:
            i.pop("published", None)
        data["tz"] = "UTC"
        data["weekly"] = None
        route.fulfill(json=data)
    ctx.route("**/data.json*", patched)
    pg.goto(URL)
    enter_list(pg)
    old = "Jan 5" if now.year == 2026 else "Jan 5, 2026"
    assert pg.locator("a.card .card-age").all_text_contents() == ["5m", "2h", "5h", "20h", "2d", "3d", old]  # newest first


def test_end_of_feed_message(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    pg.mouse.move(460, 450)  # over the list, which scrolls on its own here
    end = pg.locator("#end")
    # Scrolling loads every page, then the message appears.
    for _ in range(40):
        if end.is_visible():
            break
        pg.mouse.wheel(0, 3000)
        pg.wait_for_timeout(100)
    assert re.fullmatch(r"That\u2019s all \d+ stories from the last \d+ days\.", pg.inner_text("#end-msg"))
    assert end.locator("a, button").count() == 0  # just the line: RSS and GitHub live in the menu
    # It respects what's on screen.
    pg.evaluate("scroller().scrollTo({top:0,behavior:'instant'})")
    pg.click("#filters .filter-btn[data-f='security']")
    pg.wait_for_function("() => document.getElementById('end-msg').textContent.includes('Security') || document.getElementById('end').hidden")
    pg.mouse.move(460, 450)
    security = pg.evaluate("String(items.filter(i => cat(i.category) === 'security').length)")
    for _ in range(40):
        if end.is_visible():
            break
        pg.mouse.wheel(0, 3000)
        pg.wait_for_timeout(100)
    assert pg.inner_text("#end-msg") == f"That\u2019s all {re.search(r'\d+', security).group()} stories in Security."
    # One story reads as one: "the only story in Other".
    pg.evaluate("() => { filter = 'other'; items = items.filter((i, n) => cat(i.category) !== 'other' || n === items.findIndex(x => cat(x.category) === 'other')); renderFilters(); renderItems(); }")
    pg.locator("#end").wait_for()
    assert pg.inner_text("#end-msg") == "That\u2019s the only story in Other."
    assert pg.problems == []


def test_the_phone_toolbar_never_covers_the_end_message(browser):
    pg = open_site(browser, viewport={"width": 412, "height": 520}, has_touch=True, is_mobile=True)
    for _ in range(300):  # until the feed runs out, not a fixed count: a busy machine loads pages more slowly
        pg.evaluate("window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'})")
        if pg.evaluate("!document.getElementById('end').hidden"):
            break
        pg.wait_for_timeout(50)
    pg.evaluate("window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'})")
    pg.wait_for_timeout(100)
    msg, bar = pg.locator("#end-msg").bounding_box(), pg.locator("#list-bar").bounding_box()
    assert pg.evaluate("!document.getElementById('end').hidden") and msg["y"] + msg["height"] <= bar["y"]
    assert pg.locator("#top").is_hidden()  # no floating button here: it's in the toolbar


def test_back_to_top_reacts_to_hover(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 700})
    pg.evaluate("scroller().scrollTo({top: 2000, behavior: 'instant'})")
    top = pg.locator("#top")
    top.wait_for()
    look = "e => { const c = getComputedStyle(e); return [c.backgroundColor, c.color]; }"
    before = top.evaluate(look)
    top.hover()
    pg.wait_for_timeout(250)
    assert top.evaluate(look) != before and top.evaluate("e => getComputedStyle(e).transform") == "none"


def show_essentials(pg):
    """The essentials entry, whether it sits in the sidebar or behind the phone's topic picker."""
    pg.evaluate("document.querySelector(\"#filters [data-f='essentials']\").click()")
    pg.wait_for_function("() => shown.length && shown.every(i => picks.has(i.url))")


def held_reader(browser, **context):
    """Opens the top essentials story with /api/read held, so the test decides when (and how) the fetch resolves."""
    ctx = browser.new_context(**context)
    pg = ctx.new_page()
    held = []
    ctx.route("**/api/read?*", lambda route: held.append(route))
    pg.goto(URL)
    enter_list(pg)
    show_essentials(pg)
    card = pg.locator("a.card").first
    title = card.locator(".card-title").text_content()
    card.click()
    return pg, held, title, pg.frame_locator("#reader-body iframe:not(.loading)")


def test_reader_shows_the_story_before_the_fetch_finishes(browser):
    pg, held, title, frame = held_reader(browser, viewport={"width": 1300, "height": 900})
    frame.locator("h1").wait_for()
    assert frame.locator("h1").inner_text() == title
    assert frame.locator(".todo b").last.inner_text().lower() == "what to do"  # last, after any upshot label
    assert frame.locator(".status").inner_text() == "Loading the full article\u2026"
    assert frame.locator("main p").first.inner_text() != ""  # the summary
    # Its body holds back past the panel's slide, so a fast article replaces the card before it's ever seen.
    assert frame.locator(".late").evaluate("e => getComputedStyle(e).animationDelay") == "0.4s"
    for _ in range(50):
        if held:
            break
        pg.wait_for_timeout(20)
    assert len(held) == 1  # still in flight: nothing above waited for it
    url = urllib.parse.parse_qs(urllib.parse.urlsplit(held[0].request.url).query)["url"][0]
    held[0].fulfill(content_type="application/json", body=json.dumps({"url": url, "frameable": False, "byline": "By Ada Lovelace", "content": f"<p>{'word ' * 700}</p>"}))
    frame.locator(".meta", has_text="3 min read").wait_for()
    frame.locator(".status").wait_for(state="detached")
    meta = frame.locator(".meta").inner_text()
    assert "by Ada Lovelace" in meta and "By By" not in meta  # Feedbin-style: date by author, then minutes
    assert "\n" not in meta and pg.evaluate("readerFor && items.find(i => i.url === readerFor).publisher") == pg.inner_text("#reader-source")  # the source sits in the bar
    assert frame.locator("h1").evaluate("e => getComputedStyle(e).fontFamily").startswith('"Public Sans"')
    assert frame.locator("h1").inner_text() == title and frame.locator(".todo").count() == 1


def test_reader_swaps_frames_without_a_blank_gap(browser):
    pg, held, _, frame = held_reader(browser, viewport={"width": 1300, "height": 900})
    frame.locator("h1").wait_for()
    for _ in range(50):
        if held:
            break
        pg.wait_for_timeout(20)
    # The old frame must outlive the new one's arrival: it leaves only once the new one has loaded, as it's revealed.
    pg.evaluate("""() => { window.__swap = [];
        new MutationObserver(ms => __swap.push(ms.flatMap(m => m.type === 'attributes' ? ['revealed']
            : [...[...m.addedNodes].map(() => 'added'), ...[...m.removedNodes].map(() => 'removed')])))
            .observe(document.getElementById('reader-body'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }""")
    url = urllib.parse.parse_qs(urllib.parse.urlsplit(held[0].request.url).query)["url"][0]
    held[0].fulfill(content_type="application/json", body=json.dumps({"url": url, "frameable": False, "content": BODY}))
    frame.locator("p").nth(29).wait_for()
    batches = pg.evaluate("__swap")
    assert batches[0] == ["added"] and batches[1] == ["removed", "revealed"], batches  # separate moments, then together
    assert pg.locator("#reader-body iframe").count() == 1


def test_reader_keeps_the_card_when_the_article_is_blocked(browser):
    pg, held, title, frame = held_reader(browser, viewport={"width": 412, "height": 800}, has_touch=True, is_mobile=True)
    frame.locator("h1").wait_for()
    for _ in range(50):
        if held:
            break
        pg.wait_for_timeout(20)
    url = urllib.parse.parse_qs(urllib.parse.urlsplit(held[0].request.url).query)["url"][0]
    held[0].fulfill(content_type="application/json", body=json.dumps({"url": url, "frameable": False, "reason": "challenge"}))
    frame.locator(".status", has_text="doesn\u2019t allow a reader view").wait_for()
    assert frame.locator("h1").inner_text() == title and frame.locator(".todo").count() == 1
    assert frame.locator("a.pill").get_attribute("href") == url
    assert frame.locator(".late").count() == 0  # no second hold-back once it's the final state
    # Pinned to the top of the pane, not centred in it.
    assert frame.locator("h1").bounding_box()["y"] < 120


def test_reader_message_follows_the_reason(browser):
    pg, held, _, frame = held_reader(browser, viewport={"width": 1300, "height": 900})
    frame.locator("h1").wait_for()
    for _ in range(50):
        if held:
            break
        pg.wait_for_timeout(20)
    url = urllib.parse.parse_qs(urllib.parse.urlsplit(held[0].request.url).query)["url"][0]
    held[0].fulfill(content_type="application/json", body=json.dumps({"url": url, "frameable": False, "reason": "not_html"}))
    frame.locator(".status", has_text="needs the original site").wait_for()


def test_reader_says_when_an_article_isnt_stored_yet(browser):
    pg, held, _, frame = held_reader(browser, viewport={"width": 1300, "height": 900})
    frame.locator("h1").wait_for()
    for _ in range(50):
        if held:
            break
        pg.wait_for_timeout(20)
    url = urllib.parse.parse_qs(urllib.parse.urlsplit(held[0].request.url).query)["url"][0]
    held[0].fulfill(content_type="application/json", body=json.dumps({"url": url, "frameable": False, "reason": "pending"}))
    frame.locator(".status", has_text="ready yet").wait_for()


def test_public_sans_is_served_from_the_site(browser):
    pg = browser.new_context().new_page()
    fonts = []
    pg.on("response", lambda r: fonts.append((r.url, r.status)) if "/fonts/" in r.url else None)
    pg.goto(URL)
    enter_list(pg)
    pg.evaluate("document.fonts.ready")
    assert any(u.endswith("/fonts/PublicSansVariable.woff2") and s == 200 for u, s in fonts)
    assert pg.evaluate("""document.fonts.check('16px "Public Sans"')""")
    # Public Sans's regular is heavier than Inter's (its other weights match), so regular text sits at 370.
    assert pg.evaluate("[document.body, document.querySelector('.card-sum')].map(e => getComputedStyle(e).fontWeight)") == ["370", "370"]


def test_articles_are_set_in_literata_without_downloading_fonts_each_time(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("**/api/read?*", lambda route: route.fulfill(content_type="application/json", body=json.dumps(
        {"frameable": False, "content": f'{BODY}<p><em>An italic line.</em></p>'})))
    pg = ctx.new_page()
    fonts = []
    pg.on("response", lambda r: fonts.append(r.url.rsplit("/", 1)[-1]) if "/fonts/" in r.url else None)
    pg.goto(URL)
    enter_list(pg)
    pg.wait_for_function("() => Object.keys(frameFonts).length === 3")  # fetched once, in the background, after the list
    assert {"LiterataVariable.woff2", "LiterataVariable-Italic.woff2"} <= set(fonts)
    before = len(fonts)
    for n in (0, 1, 0):  # including one opened again
        pg.evaluate("n => openReader(items[n])", n)
        frame = pg.frame_locator("#reader-body iframe:not(.loading)")
        frame.locator("p").nth(29).wait_for()
        faces = frame.locator("body").evaluate("() => document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))")
        assert "Literata" in faces and "Public Sans" in faces  # the article in Literata, its headings in Public Sans
        assert frame.locator("em").evaluate("e => document.fonts.check('italic 17px Literata')")  # real italics, not slanted
        assert frame.locator("main p").nth(3).evaluate("e => getComputedStyle(e).fontFamily").startswith("Literata")
    # A sandboxed frame caches apart every time, so fonts loaded there by URL came down again for every article.
    assert fonts[before:] == []
    assert pg.problems == [] if hasattr(pg, "problems") else True


def test_escape_returns_focus_to_the_row_for_the_keyboard(browser):
    pg = open_site(browser, viewport={"width": 1024, "height": 800})
    pg.locator("a.card").nth(1).focus()
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.keyboard.press("Escape")
    wait_until_closed(pg)
    assert pg.evaluate("document.activeElement === document.querySelectorAll('a.card')[1]")  # back where the keyboard was
    assert pg.problems == []


@pytest.mark.parametrize("scheme", ["dark", "light"])
def test_new_stories_are_marked_legibly(browser, scheme):
    from axe_playwright_python.sync_playwright import Axe
    ctx = browser.new_context(viewport={"width": 1300, "height": 900}, color_scheme=scheme)
    ctx.add_init_script("localStorage.setItem('seenUntil', '2000-01-01T00:00:00+00:00')")  # a long-ago visit: everything since is new
    pg = ctx.new_page()
    pg.goto(URL)
    pg.wait_for_selector("a.card .new")
    pill = pg.locator("a.card .new").first
    assert pill.inner_text().upper() == "NEW"
    contrast = Axe().run(pg, options={"runOnly": {"type": "rule", "values": ["color-contrast"]}}).response["violations"]
    assert [n["html"] for v in contrast for n in v["nodes"] if "new" in n["html"]] == []


def test_question_mark_lists_the_shortcuts(browser):
    pg = browser.new_context(viewport={"width": 1300, "height": 900}).new_page()
    pg.goto(URL)
    enter_list(pg)
    pg.keyboard.press("?")
    assert pg.locator("#keys").is_visible()
    assert "Search every article" in pg.locator("#keys").inner_text()
    pg.keyboard.press("j")  # inert while the list is open
    pg.keyboard.press("Escape")
    assert not pg.locator("#keys").is_visible()
    assert not pg.evaluate("document.body.classList.contains('reading')")
    pg.keyboard.press("?")
    pg.keyboard.press("?")  # the same key hides it again
    assert not pg.locator("#keys").is_visible()


def test_page_shortcuts_work_from_inside_an_open_article(browser):
    # Keys pressed in the article's frame reach the page only if its relay forwards them: ?, / and Shift+A as well as j/k/m/Esc.
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    pg.locator("a.card").first.click()
    frame = pg.frame_locator("#reader-body iframe:not(.loading)")
    frame.locator("main p").first.click()  # focus in the article
    pg.keyboard.press("?")
    pg.locator("#keys").wait_for()
    pg.keyboard.press("?")
    pg.locator("#keys").wait_for(state="hidden")
    frame.locator("main p").first.click()
    pg.keyboard.press("/")  # search from a story too, as ⌘K does
    pg.locator("#palette").wait_for()
    pg.keyboard.press("Escape")
    pg.locator("#palette").wait_for(state="hidden")
    frame.locator("main p").first.click()
    pg.keyboard.press("Shift+A")
    pg.locator("#confirm-read").wait_for()
    pg.keyboard.press("Escape")
    assert reading(pg) and pg.problems == []


def test_share_copies_the_publishers_url_on_desktop(browser):
    ctx = browser.new_context(viewport={"width": 1300, "height": 900})
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    pg = ctx.new_page()
    pg.goto(URL)
    enter_list(pg)
    url = pg.locator("a.card").first.get_attribute("href")
    pg.locator("a.card").first.click()
    pg.locator("#reader-send").click()
    names = pg.locator("#send-pop [role=menuitem]:not([hidden])").all_inner_texts()  # no share sheet here, so no "More…"
    assert names == ["Copy link", "Email", "Bluesky", "Reddit", "LinkedIn"]
    box = pg.locator("#send-pop").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 1300  # fully on screen
    enc = urllib.parse.quote(url, safe="")
    pg.evaluate("window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }")
    for sel in ("#send-bluesky", "#send-reddit", "#send-linkedin"):
        pg.locator(sel).click()
        pg.locator("#reader-send").click()  # choosing one closes the menu
    opened = [u for u in pg.evaluate("window.__opened") if u]
    assert opened[0].startswith("https://bsky.app/intent/compose?text=") and enc in opened[1] and enc in opened[2]
    assert pg.locator("#send-pop [role=menuitem]:not([hidden]) svg").count() == 5  # an icon for each; no "More…" without a share sheet
    pg.locator("#reader-size").click()  # opening the text size menu closes this one
    assert pg.locator("#send-pop").is_hidden() and pg.locator("#size-pop").is_visible()
    pg.locator("#reader-send").click()  # and the other way round
    assert pg.locator("#size-pop").is_hidden() and pg.locator("#send-pop").is_visible()
    pg.keyboard.press("Escape")  # closes the menu, not the reader
    assert pg.locator("#send-pop").is_hidden() and pg.evaluate("document.body.classList.contains('reading')")
    pg.locator("#reader-send").click()
    pg.locator("#send-copy").click()
    pg.locator("#send-done", has_text="Copied").wait_for()
    assert pg.evaluate("navigator.clipboard.readText()") == url and pg.locator("#send-pop").is_hidden()


def test_share_opens_the_share_sheet_on_a_phone(browser):
    ctx = browser.new_context(viewport={"width": 412, "height": 800}, is_mobile=True, has_touch=True)
    ctx.add_init_script("window.__shared = null; navigator.share = d => { window.__shared = d; return Promise.resolve(); };")
    pg = ctx.new_page()
    pg.goto(URL)
    enter_list(pg)
    url = pg.locator("a.card").first.get_attribute("href")
    pg.locator("a.card").first.tap()
    pg.locator("#reader-send").tap()  # the same menu as desktop, with the system sheet under "More…"
    names = pg.locator("#send-pop [role=menuitem]").all_inner_texts()
    assert names == ["Copy link", "Email", "Bluesky", "Reddit", "LinkedIn", "More\u2026"], names
    box = pg.locator("#send-pop").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 412
    pg.locator("#send-more").tap()
    pg.wait_for_function("() => window.__shared")
    shared = pg.evaluate("window.__shared")
    assert shared["url"] == url and shared["title"]


def test_reader_links_are_short_and_survive_a_reload(browser):
    pg = browser.new_context(viewport={"width": 1300, "height": 900}).new_page()
    pg.goto(URL)
    enter_list(pg)
    card = pg.locator("a.card").first
    url, title = card.get_attribute("href"), card.locator(".card-title").inner_text()
    card.click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    path = pg.evaluate("location.pathname")
    assert path.startswith("/read/") and "%" not in path and "http" not in path and len(path) <= 70, path
    pg.keyboard.press("j")  # stepping to the next story updates the link
    pg.wait_for_function(f"location.pathname !== {path!r}")
    assert pg.evaluate("location.pathname").startswith("/read/")
    pg.goto(URL.rstrip("/") + path)  # a shared link opens that story
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert pg.frame_locator("#reader-body iframe:not(.loading)").locator("h1 a").get_attribute("href") == url
    pg.keyboard.press("Escape")
    pg.wait_for_function("!document.body.classList.contains('reading')")
    assert pg.evaluate("location.pathname") == "/"
    # Old links still work, and become the short form.
    pg.goto(URL.rstrip("/") + "/#read=" + urllib.parse.quote(url, safe=""))
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert pg.evaluate("location.pathname") == path and pg.evaluate("location.hash") == ""
    # A story that has left the site falls back to the front page.
    pg.goto(URL.rstrip("/") + "/read/a-story-that-is-not-here")
    pg.wait_for_selector("a.card")
    assert pg.evaluate("location.pathname") == "/" and not pg.evaluate("document.body.classList.contains('reading')")
    assert title


def test_reader_bar_after_feedbin(browser):
    ctx = browser.new_context(viewport={"width": 412, "height": 800}, is_mobile=True, has_touch=True)
    def with_icons(route):  # data.json only lists icons after a build, so give the first story's publisher one
        res = route.fetch()
        data = res.json()
        slugs = []
        for i in data["items"]:  # every publisher: the list is newest first, so the first card needn't be the first item
            slug = "".join(c if c.isalnum() else "-" for c in i["publisher"].lower()).strip("-")
            while "--" in slug:
                slug = slug.replace("--", "-")
            slugs.append(slug)
        data["icons"] = slugs
        route.fulfill(response=res, json=data)
    ctx.route("**/data.json", with_icons)
    ctx.route("**/icons/*.png", lambda r: r.fulfill(content_type="image/png", body=PNG))
    pg = ctx.new_page()
    pg.problems = []
    pg.on("console", lambda m: pg.problems.append(m.text) if m.type == "error" else None)
    pg.goto(URL)
    enter_list(pg)
    first = pg.locator("a.card").first
    url = first.get_attribute("href")
    first.tap()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    # A tap leaves no focus ring on the close button, which shows a back chevron on a phone.
    assert pg.evaluate("document.activeElement.id") == "reader"
    assert pg.locator(".close-back").is_visible() and not pg.locator(".close-x").is_visible()
    assert pg.locator("#reader-original").count() == 0  # the title already links to the article
    assert pg.locator("#reader-icon").is_visible() and pg.locator("#reader-source").is_hidden()  # on a phone the icon alone says who
    # Previous is off at the first story; next moves on, and back again.
    assert pg.locator("#reader-prev").is_disabled()
    before = pg.evaluate("location.pathname")
    pg.locator("#reader-next").tap()
    pg.wait_for_function(f"() => location.pathname !== {before!r}")
    assert not pg.locator("#reader-prev").is_disabled()
    pg.locator("#reader-prev").tap()
    pg.wait_for_function("() => document.getElementById('reader-prev').disabled")
    assert pg.problems == []
    # A small desktop window, where the reader is docked: an X, no bottom bar, and the keyboard stays in the list.
    dc = browser.new_context(viewport={"width": 900, "height": 800})
    def no_icons(route):  # a publisher with no icon listed
        res = route.fetch()
        route.fulfill(response=res, json={**res.json(), "icons": []})
    dc.route("**/data.json", no_icons)
    dk = dc.new_page()
    dk.goto(URL)
    enter_list(dk)
    dk.locator("a.card").first.focus()
    dk.keyboard.press("Enter")
    dk.wait_for_selector("#reader-body iframe:not(.loading)")
    assert dk.evaluate("document.activeElement.classList.contains('card')")
    assert dk.locator(".close-x").is_visible() and not dk.locator(".reader-nav").is_visible()
    assert not dk.locator("#reader-icon").is_visible()  # no icon listed for it: hidden, never a 404


def test_text_size_steps_and_is_remembered(browser):
    ctx = browser.new_context(viewport={"width": 412, "height": 800}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.goto(URL)
    enter_list(pg)
    pg.locator("a.card").first.tap()
    frame = pg.frame_locator("#reader-body iframe:not(.loading)")
    frame.locator("h1").wait_for()
    size = lambda: frame.locator("body").evaluate("e => parseFloat(getComputedStyle(e).fontSize)")
    start = size()
    pg.locator("#reader-size").tap()
    sizes = pg.locator("#size-pop button")
    assert sizes.count() == 4 and pg.locator("#size-pop [aria-pressed='true']").get_attribute("data-size") == "1"
    sizes.nth(3).tap()  # straight to the largest, no cycling through the others
    frame.locator("html[data-size='3']").wait_for(state="attached")
    assert size() > start
    assert pg.locator("#size-pop [aria-pressed='true']").get_attribute("data-size") == "3"
    sizes.nth(2).tap()
    frame.locator("html[data-size='2']").wait_for(state="attached")
    pg.keyboard.press("Escape")  # closes the panel, not the reader
    assert not pg.locator("#size-pop").is_visible() and pg.evaluate("document.body.classList.contains('reading')")
    pg.reload()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert pg.frame_locator("#reader-body iframe:not(.loading)").locator("html").get_attribute("data-size") == "2"
    pg.locator("#reader-size").tap()
    pg.mouse.click(200, 600)  # a tap on the article closes the panel
    pg.wait_for_function("() => document.getElementById('size-pop').hidden")


def test_ages_count_days_in_the_sites_time_zone_whatever_the_device_reports(browser):
    from zoneinfo import ZoneInfo
    site = datetime.now(ZoneInfo("America/New_York")).date()
    for device_tz in ("UTC", "Asia/Tokyo", "Pacific/Honolulu"):
        ctx = browser.new_context(timezone_id=device_tz)
        def dated(route):
            res = route.fetch()
            data = res.json()
            data["tz"] = "America/New_York"
            a, b = data["items"][:2]
            for i in (a, b):
                i.pop("published", None); i.pop("added", None)  # only a date, as stories from before the exact time was kept
            a["date"], b["date"] = site.isoformat(), (site - timedelta(days=1)).isoformat()
            data["items"] = [a, b]
            route.fulfill(response=res, json=data)
        ctx.route("**/data.json", dated)
        pg = ctx.new_page()
        pg.goto(URL)
        enter_list(pg)
        assert pg.locator("a.card .card-age").all_text_contents() == ["1m", "1d"], device_tz  # today is today, never a negative or a day early


def test_reader_opens_with_the_tldr_and_what_to_do_last(browser):
    ctx = browser.new_context(viewport={"width": 600, "height": 800})  # the sliding reader: this checks a click during its slide out
    picked = []
    def with_tldr(route):
        res = route.fetch()
        data = res.json()
        top = data["weekly"]["items"][0]["url"]
        picked.append(top)
        for i in data["items"]:
            i.pop("tldr", None)
            if i["url"] == top:
                i["tldr"] = ["First fact & <detail>.", "Second fact.", "Third fact."]
        route.fulfill(response=res, json=data)
    ctx.route("**/data.json", with_tldr)
    ctx.route("**/api/read?*", lambda r: r.fulfill(content_type="application/json", body=json.dumps({"reason": "pending", "frameable": False})))
    pg = ctx.new_page()
    pg.goto(URL)
    enter_list(pg)
    show_essentials(pg)
    pg.locator(f'a.card[href="{picked[0]}"]').click()  # an essential with an upshot: not always listed first, which goes by age
    frame = pg.frame_locator("#reader-body iframe:not(.loading)")
    box = frame.locator(".tldr")
    box.wait_for()
    assert box.locator("> b").inner_text().upper() == "THE UPSHOT"
    assert box.locator("li").all_inner_texts() == ["First fact & <detail>.", "Second fact.", "Third fact."]  # escaped, as text
    assert box.locator(".do b").inner_text().upper() == "WHAT TO DO"  # the hand-picked note, last
    assert frame.locator(".todo").count() == 1  # one box, not two
    # The text size control scales the box and the byline with the article, not just the body text.
    sizes = """() => ['body', '.tldr > b', '.tldr li', '.tldr .do', '.tldr .do b', '.meta'].map(s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize))"""
    before = frame.locator("body").evaluate(f"({sizes})")
    assert [round(v) for v in before] == [18, 15, 17, 17, 15, 16]  # the default size: 18px, a step up for Literata
    pg.locator("#reader-size").click()
    pg.locator("#size-pop button[data-size='3']").click()
    frame.locator("html[data-size='3']").wait_for(state="attached")
    after = frame.locator("body").evaluate(f"({sizes})")
    assert all(abs(a / b - after[0] / before[0]) < 0.02 for a, b in zip(after, before))  # all grow by the body's ratio
    pg.keyboard.press("Escape")  # closes the size menu, leaving the reader open
    pg.keyboard.press("Escape")
    wait_until_closed(pg)  # Esc closes through history.back(), which lands a moment later: click before it and the tile is still inert
    second = pg.locator(f'a.card:not([href="{picked[0]}"])').first
    # Still sliding out over this tile for a moment: a click meant for the tile must not land in the old article.
    assert pg.evaluate("getComputedStyle(document.getElementById('reader')).pointerEvents") == "none"
    title = second.locator(".card-title").inner_text()
    # Still flaky on CI runners: log what the click does, so a failure says which of "never arrived", "landed elsewhere"
    # and "opened then closed" it was.
    popups = []
    pg.context.on("page", lambda p: popups.append(p.url))
    pg.evaluate("""() => { const t = () => Math.round(performance.now()), log = window.__log = [];
        addEventListener('click', e => log.push([t(), 'click', e.target.closest('a')?.getAttribute('href')?.slice(-40) || e.target.tagName,
          e.defaultPrevented ? 'handled' : 'unhandled']));  // window, bubbling: runs after the app's own listener
        addEventListener('popstate', () => log.push([t(), 'popstate', location.pathname]));
        new MutationObserver(() => log.push([t(), 'reading', document.body.classList.contains('reading')])).observe(document.body, { attributeFilter: ['class'] }); }""")
    second.click()  # an essential without one: the old callout
    frame = pg.frame_locator("#reader-body iframe:not(.loading)")
    try:
        frame.locator("h1", has_text=title[:30]).wait_for(timeout=15000)  # this article's frame, not the last one's
    except Exception:  # intermittent on CI runners only: say what the page was doing
        state = pg.evaluate("""() => ({ path: location.pathname, reading: document.body.classList.contains('reading'), readerFor,
            active: document.activeElement?.className, frames: [...document.querySelectorAll('#reader-body iframe')].map(f => f.className) })""")
        state["h1s"] = [f.locator("h1").first.text_content(timeout=1000) for f in pg.frames if f != pg.main_frame]  # sandboxed: only Playwright can look in
        state["log"], state["popups"] = pg.evaluate("window.__log"), popups
        raise AssertionError(f"{title[:30]!r} never opened: {json.dumps(state)}")
    assert frame.locator(".tldr").count() == 0 and "what to do" in frame.locator(".todo").inner_text().lower()


def test_unknown_paths_are_real_404s(browser):
    # A real 404 (not_found_handling in wrangler.jsonc), not index.html for everything: that breaks robots.txt and any tool probing for a file.
    pg = browser.new_context().new_page()
    for path in ("/no-such-page", "/llms.txt", "/.well-known/ard.json"):
        res = pg.goto(URL.rstrip("/") + path)
        assert res.status == 404, path
        assert pg.locator("h1").inner_text() == "Page not found"
    assert pg.goto(URL).status == 200
    assert pg.locator("a.card").first.is_visible() or pg.wait_for_selector("a.card")


def test_pages_get_a_fresh_csp_nonce(browser):
    # For the inline script Cloudflare's Bot Fight Mode injects on the live domain (not under wrangler dev).
    req = browser.new_context().request
    nonce = lambda path: re.search(r"script-src 'nonce-([^']+)'", req.get(URL.rstrip("/") + path).headers["content-security-policy"] or "")
    first, second, deep = nonce("/"), nonce("/"), nonce("/read/anything")
    assert first and second and deep and first[1] != second[1]
    assert "nonce-" not in (req.get(URL.rstrip("/") + "/data.json").headers.get("content-security-policy") or "")  # files stay static


def test_the_reader_endpoint_reaches_the_worker(browser):
    # The browser tests stub /api/read; this asks the real route, which is the only path that runs code.
    res = browser.new_context().request.get(URL.rstrip("/") + "/api/read?url=" + urllib.parse.quote("https://x.test/not-stored", safe=""))
    assert res.status == 200 and res.headers["content-type"].startswith("application/json")
    assert res.json() == {"url": "https://x.test/not-stored", "frameable": False, "reason": "pending"}


def test_wide_screens_keep_the_filter_row(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    assert pg.locator("#list-back").is_hidden() and pg.locator("#filters .filter-btn").first.is_visible()
    pg.click("#filters .filter-btn[data-f='ai']")
    assert pg.locator("#filters .filter-btn.active").get_attribute("data-f") == "ai"
    assert pg.locator("#filters .filter-btn").first.is_visible()  # picking one leaves the row in place
    assert pg.problems == []


def test_wide_screens_keep_the_controls_in_a_small_menu(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    assert pg.locator("#menu-btn").is_visible() and pg.locator("#theme").is_hidden()  # tucked away, as in Feedbin
    pg.click("#menu-btn")
    menu = pg.locator("#menu").bounding_box()
    assert pg.locator("#menu a[href='/rss.xml']").is_visible() and pg.locator("#theme").is_visible()
    assert menu["width"] < 300 and menu["x"] + menu["width"] <= 1300 and menu["y"] >= 52  # a dropdown at the top right, not a drawer
    pg.keyboard.press("Escape")
    pg.locator("#theme").wait_for(state="hidden")
    assert pg.problems == []


@pytest.mark.parametrize("scheme", ["dark", "light"])
def test_wcag(browser, scheme):
    from axe_playwright_python.sync_playwright import Axe
    tags = {"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]}}
    pg = open_site(browser, viewport={"width": 412, "height": 915}, has_touch=True, is_mobile=True, color_scheme=scheme)
    def violations():
        return [(v["id"], v["nodes"][0]["html"][:80]) for v in Axe().run(pg, options=tags).response["violations"]]
    assert violations() == []
    # Every control on a phone is at least 44px. The info button reaches it through ::after, which a rect can't see.
    small = """() => [...document.querySelectorAll('a, button, input')].filter(e => e.id !== 'info').map(e => [e, e.getBoundingClientRect()])
        .filter(([, r]) => r.width && r.height && (r.width < 44 || r.height < 44)).map(([e, r]) => `${e.id || e.className} ${r.width}x${r.height}`)"""
    assert pg.evaluate(small) == []
    pg.tap("#menu-btn")
    pg.wait_for_function("() => !document.getElementById('menu').getAnimations().length")  # let the drawer finish opening
    assert violations() == [] and pg.evaluate(small) == []
    assert pg.get_attribute("#theme", "aria-label") == f"Switch to {'light' if scheme == 'dark' else 'dark'} mode"
    pg.keyboard.press("Escape")
    pg.locator("#theme").wait_for(state="hidden")
    pg.tap("#list-back")  # the topics, which phones open on
    pg.wait_for_function("() => !document.getAnimations().length")  # once the pages and header have settled, as a reader sees them
    assert violations() == [] and pg.evaluate(small) == []
    assert pg.problems == []


def test_reader_and_frame_relay_run_under_csp(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    card, title = first_card(pg)
    card.click()
    frame = pg.frame_locator("#reader-body iframe:not(.loading)")
    assert frame.locator("h1").inner_text() == title
    assert frame.locator("h1 a").get_attribute("href") == card.get_attribute("href")
    frame.locator("p").nth(29).wait_for()  # the card shows first, then the article replaces it
    assert frame.locator("p").count() == 30
    # Escape pressed inside the article only reaches the page through the frame's relay script,
    # so closing proves the CSP lets that hashed script run.
    frame.locator("p").first.click()
    pg.keyboard.press("Escape")
    wait_until_closed(pg)
    assert pg.problems == []


def test_the_search_bar_and_slash_open_the_palette(browser):
    for opener in ("click", "slash"):
        pg = browser.new_context(viewport={"width": 1300, "height": 900}).new_page()
        pg.goto(URL)
        enter_list(pg)
        pg.click("#search") if opener == "click" else pg.keyboard.press("/")
        pg.locator("#palette").wait_for()
        assert pg.evaluate("document.getElementById('palette').matches(':modal')")  # native: Esc and the phone's back button close it
        assert pg.evaluate("document.activeElement.id") == "palette-q"
        pg.keyboard.type("openai")
        assert pg.locator("#palette-list li[data-n]").count() > 0
        pg.keyboard.press("Escape")
        pg.locator("#palette").wait_for(state="hidden")
        pg.wait_for_timeout(200)
        assert pg.locator("#palette").is_hidden()  # closing doesn't bounce focus back into the bar and reopen it
    ph = browser.new_context(viewport={"width": 412, "height": 800}, is_mobile=True, has_touch=True).new_page()
    ph.goto(URL)
    enter_list(ph)
    box = ph.locator("#search-btn").bounding_box()  # in the header on phones, beside the menu
    assert box["width"] == 44 and box["height"] == 44 and box["y"] + 44 <= 52
    ph.tap("#search-btn")
    ph.locator("#palette").wait_for()
    # Below the header, and the search icon becomes the close button (no Esc key on a phone).
    assert ph.locator("#palette").bounding_box()["y"] >= 52
    close, icon = ph.locator("#palette-close").bounding_box(), ph.locator("#search-btn").bounding_box()
    assert (close["x"], close["y"], close["width"], close["height"]) == (icon["x"], icon["y"], 44, 44)
    ph.locator("#palette-close").tap()
    ph.locator("#palette").wait_for(state="hidden")
    ph.wait_for_timeout(200)
    assert ph.locator("#palette").is_hidden()
    ph.tap("#search-btn")
    ph.locator("#palette").wait_for()
    ph.mouse.click(20, 26)  # anywhere on the header closes it too
    ph.locator("#palette").wait_for(state="hidden")


def test_share_icon_matches_the_device(browser):
    desktop = browser.new_context(viewport={"width": 1300, "height": 900}).new_page()
    desktop.goto(URL)
    enter_list(desktop)
    assert desktop.locator("#reader-send").get_attribute("data-kind") == "apple"
    assert desktop.locator("#reader-send .send-apple").evaluate("e => getComputedStyle(e).display") == "block"  # the box and arrow, not a link icon
    mac = browser.new_context(viewport={"width": 1300, "height": 900})
    mac.add_init_script("navigator.share = () => Promise.resolve();")  # a desktop browser with a share sheet uses it
    mp = mac.new_page()
    mp.goto(URL)
    enter_list(mp)
    assert mp.locator("#reader-send").get_attribute("data-kind") == "apple"
    for ua, kind in (("Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36", "android"),
                     ("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1", "apple")):
        ctx = browser.new_context(viewport={"width": 412, "height": 800}, is_mobile=True, has_touch=True, user_agent=ua)
        ctx.add_init_script("navigator.share = () => Promise.resolve();")
        pg = ctx.new_page()
        pg.goto(URL)
        enter_list(pg)
        assert pg.locator("#reader-send").get_attribute("data-kind") == kind, ua


def test_share_survives_ad_blockers_social_lists(browser):
    # Ad blockers' social lists hide share widgets by name and by link address, which removed the whole button.
    pg = browser.new_context(viewport={"width": 1300, "height": 900}).new_page()
    pg.goto(URL)
    enter_list(pg)
    named = pg.evaluate("[...document.querySelectorAll('[id*=share], [class*=share]')].map(e => e.id || e.className)")
    assert named == [], named
    links = pg.evaluate("[...document.querySelectorAll('#send-pop a, #reader-send a')].length")
    assert links == 0


def test_back_to_top_survives_annoyance_lists(browser):
    # Fanboy's Annoyance list (in Brave and uBlock) hides any element named "Back to top", which took the phone's Top button away.
    pg = open_site(browser, viewport={"width": 390, "height": 800}, has_touch=True, is_mobile=True)
    hidden = ['[aria-label="Back to top"]', '[title="Back to Top"]', '[title="Back to top"]', '[title="Go to Top"]', '#back-to-top', '#BackToTop']
    assert pg.evaluate("s => s.filter(q => document.querySelector(q))", hidden) == []
    assert pg.locator("#bar-top").is_visible()


def test_palette_lists_every_match(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    total = pg.evaluate("fetch('/data.json').then(r => r.json()).then(d => d.items.length)")
    pg.keyboard.press("/")
    pg.locator("#palette").wait_for()
    # Nothing typed, nothing read yet: the newest five, not the whole feed again.
    assert pg.inner_text(".palette-head") == "LATEST" and pg.locator("#palette-list li[data-n]").count() == 5 < total
    assert pg.locator("#palette-list .p-title").first.inner_text() == pg.evaluate("items[0].title")
    word = pg.evaluate("fetch('/data.json').then(r => r.json()).then(d => d.items.filter(i => i.category === 'ai').length)")
    pg.keyboard.type("a")  # a broad query, matching well over the old cap of 30
    shown = pg.locator("#palette-list li[data-n]").count()
    expected = pg.evaluate("""fetch('/data.json').then(r => r.json()).then(d => d.items.filter(i =>
        `${i.title} ${i.summary} ${i.publisher} ${new URL(i.url).hostname.replace(/^www\\./, '')}`.toLowerCase().includes('a')).length)""")
    assert shown == expected and shown > 30, (shown, expected, word)


def test_search_palette(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    _, title = first_card(pg)
    pg.keyboard.press("Control+K")
    assert pg.locator("#palette").is_visible()
    pg.keyboard.type(title.split()[0])
    assert pg.locator("#palette-list li[data-n]").count() > 0
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert reading(pg) and pg.locator("#palette").is_hidden()
    assert pg.problems == []


def test_swipe_back_on_a_phone(browser):
    pg = open_site(browser, viewport={"width": 412, "height": 915}, has_touch=True, is_mobile=True)
    card, _ = first_card(pg)
    card.scroll_into_view_if_needed()
    pg.wait_for_timeout(300)
    card.tap()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.frame_locator("#reader-body iframe:not(.loading)").locator("p").nth(29).wait_for()  # the article, not the card before it
    # Wait for the slide-in to finish: until then the touch lands on the (inert) feed behind it.
    for _ in range(50):
        if pg.evaluate("new DOMMatrix(getComputedStyle(document.getElementById('reader')).transform).m41") == 0:
            break
        pg.wait_for_timeout(100)
    # Open, the story's bar has taken the header's place: it sits still at the top while the story slides, and crossfades.
    bar = "() => [Math.round(document.querySelector('.reader-bar').getBoundingClientRect().left), +getComputedStyle(document.querySelector('.reader-bar')).opacity, +getComputedStyle(document.querySelector('header')).opacity]"
    assert pg.evaluate(bar)[1:] == [1, 0] and pg.evaluate(bar)[0] <= 1
    pg.evaluate("window.__tw = []; addEventListener('message', e => __tw.push(e.data && e.data.tw))")
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 80, "y": 600}]})
    for k in range(1, 13):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": 80 + 22 * k, "y": 602}]})
        pg.wait_for_timeout(16)
        if k == 5:  # partway: the bar holds still under the finger, half faded into the list's header
            left, shown, header = pg.evaluate(bar)
            assert left <= 1 and 0 < shown < 1 and 0 < header < 1 and abs(shown + header - 1) < 0.05
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    wait_until_closed(pg)
    assert pg.evaluate("!document.querySelector('a.card:focus')")  # no focus ring on the row after a swipe
    # A swipe the other way, across the list, brings the story back, as in Feedbin.
    url = card.get_attribute("href")
    pg.wait_for_timeout(400)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 360, "y": 500}]})
    for k in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": 360 - 30 * k, "y": 504}]})
        pg.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    pg.wait_for_function("u => readerFor === u", arg=url)
    assert reading(pg)
    assert pg.problems == []


def test_search_highlight_never_splits_an_entity(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    assert pg.evaluate("highlight(\"Tom & Jerry's\", 'm')") == "To<mark>m</mark> &amp; Jerry&#39;s"  # not &a<mark>m</mark>p;
    assert pg.evaluate("highlight('a.b', '.')") == "a<mark>.</mark>b"  # the query is literal, not a pattern
    assert pg.problems == []


def test_page_keys_stay_out_of_the_open_search_panel(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    pg.locator("a.card").first.click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    url = pg.url
    pg.keyboard.press("Control+k")
    pg.locator("#palette").wait_for()
    pg.locator(".palette-foot").click()  # focus leaves the input for the dialog itself
    pg.keyboard.press("j")
    assert pg.url == url  # the reader behind didn't move
    pg.keyboard.press("Escape")
    pg.locator("#palette").wait_for(state="hidden")
    assert reading(pg)  # Esc closed only the panel
    assert pg.problems == []


def test_j_does_nothing_when_the_open_story_is_filtered_out(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    pg.locator(".filter-btn", has_text="Security").click()
    pg.keyboard.press("Control+k")
    other = pg.evaluate("items.find(i => i.category !== 'security').title")
    pg.keyboard.type(other)
    pg.keyboard.press("Enter")
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    url = pg.url
    assert pg.locator("#reader-next").is_disabled()
    pg.keyboard.press("j")
    pg.wait_for_timeout(200)
    assert pg.url == url
    assert pg.problems == []


def test_closing_after_forward_doesnt_strand_a_history_entry(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    pg.locator("a.card").first.click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.go_back()
    wait_until_closed(pg)
    pg.go_forward()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.locator("#reader-close").click()
    wait_until_closed(pg)
    assert pg.evaluate("location.pathname") == "/"
    pg.go_back()  # one Back leaves, not a second copy of the feed
    assert pg.url == "about:blank"
    assert pg.problems == []


def test_reader_header_tidies_bylines_and_never_starts_blank(browser):
    ctx = browser.new_context(viewport={"width": 1300, "height": 900})
    def article(route):
        url = urllib.parse.parse_qs(urllib.parse.urlsplit(route.request.url).query)["url"][0]
        route.fulfill(content_type="application/json", body=json.dumps(
            {"url": url, "frameable": False, "byline": "Posted on November 8, 2026\n\t\tby audra", "content": f"<p>{'word ' * 400}</p>"}))
    ctx.route("**/api/read?*", article)
    pg = ctx.new_page()
    pg.goto(URL)
    enter_list(pg)
    icons = pg.evaluate("[...icons]")
    no_icon = pg.evaluate("p => items.find(i => !p.includes(iconSlug(i.publisher)))?.url", icons)
    with_icon = pg.evaluate("p => items.find(i => p.includes(iconSlug(i.publisher)))?.url", icons)
    for url, mono in ((no_icon, True), (with_icon, False)):
        if not url:
            continue
        pg.evaluate("u => openReader(items.find(i => i.url === u))", url)
        frame = pg.frame_locator("#reader-body iframe:not(.loading)")
        frame.locator(".meta", has_text="by audra").wait_for()
        assert "Posted" not in frame.locator(".meta").inner_text()  # the byline's own date is dropped
        assert pg.locator("#reader-mono").is_visible() == mono and pg.locator("#reader-icon").is_visible() != mono
        if mono:
            assert len(pg.locator("#reader-mono").inner_text()) == 1


def test_essentials_say_which_days_and_updated_sits_on_the_feed(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    assert re.fullmatch(r"[A-Z][a-z]{2} \d{1,2}(–\d{1,2}| – [A-Z][a-z]{2} \d{1,2})", pg.evaluate("weekRange(weekly)"))
    assert pg.evaluate("weekRange({window_start: '2026-10-29', window_end: '2026-11-04'})") == "Oct 29 – Nov 4"
    assert pg.locator(".side-foot #updated").count() == 1
    pg.locator(".filter-btn", has_text="Security").click()  # a redraw keeps it filled in
    assert re.fullmatch(r"Updated (just now|\d+[mhd] ago)", pg.inner_text(".side-foot #updated"))
    assert pg.problems == []


def test_palette_opens_on_what_you_read_last(browser):
    pg = open_site(browser, viewport={"width": 1300, "height": 900})
    titles = pg.evaluate("items.slice(2, 5).map(i => i.title)")
    for n in (2, 3, 4):  # read three stories, oldest first
        pg.evaluate("n => openReader(items[n])", n)
        pg.wait_for_selector("#reader-body iframe:not(.loading)")
        pg.keyboard.press("Escape")
        wait_until_closed(pg)
    pg.keyboard.press("/")
    pg.locator("#palette").wait_for()
    assert pg.inner_text(".palette-head") == "RECENTLY READ"
    assert pg.locator("#palette-list .p-title").all_inner_texts() == titles[::-1]  # most recent first
    pg.keyboard.press("Escape")
    pg.evaluate("openReader(items[2])")  # reading one again moves it to the top
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.keyboard.press("Escape")
    wait_until_closed(pg)
    pg.keyboard.press("/")
    pg.locator("#palette").wait_for()
    assert pg.locator("#palette-list .p-title").first.inner_text() == titles[0]
    pg.keyboard.press("Enter")  # the first entry is selected, so Enter opens it
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert pg.evaluate("readerFor") == pg.evaluate("items[2].url")
    assert pg.problems == []


def test_wide_screens_dock_the_reader_beside_the_list(browser):
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    reader, backdrop = pg.locator("#reader"), pg.locator("#reader-backdrop")
    # Docked before anything opens: an empty pane that says what it's for, no backdrop, a live list, and no bar to mark off.
    assert reader.is_visible() and backdrop.is_hidden()
    rule = "getComputedStyle(document.querySelector('.reader-bar')).borderBottomColor"
    assert pg.evaluate(rule) == "rgba(0, 0, 0, 0)"
    assert pg.evaluate("getComputedStyle(document.getElementById('reader-body'), '::before').maskImage").startswith('url("data:image/svg+xml')  # the site's mark, faint
    side, items, pane = (pg.locator(s).bounding_box() for s in (".side", "#items", "#reader"))
    assert side["x"] + side["width"] <= items["x"] and items["x"] + items["width"] <= pane["x"] + 1 and pane["x"] + pane["width"] <= 1440
    cards = pg.locator("a.card")
    cards.nth(1).click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert reading(pg) and backdrop.is_hidden() and pg.evaluate(rule) != "rgba(0, 0, 0, 0)"  # the bar's line comes with the story
    assert not pg.evaluate("document.getElementById('items').inert") and reader.get_attribute("aria-modal") == "false"
    assert cards.nth(1).get_attribute("aria-current") == "true" and pg.locator("a.card[aria-current]").count() == 1
    assert pg.evaluate("document.activeElement.closest('#reader')") is None  # focus stays in the list, so j/k work there
    # The list still takes clicks and scrolls while an article is open, and j moves through it.
    cards.nth(3).click()
    pg.locator("a.card").nth(3).and_(pg.locator("[aria-current='true']")).wait_for()
    second = pg.evaluate("readerFor")
    pg.keyboard.press("j")
    pg.wait_for_function("u => readerFor && readerFor !== u", arg=second)
    assert pg.evaluate("shown.findIndex(i => i.url === readerFor)") == 4
    assert pg.locator("a.card").nth(4).get_attribute("aria-current") == "true"
    pg.keyboard.press("Escape")
    wait_until_closed(pg)
    pg.locator("#reader-body iframe").first.wait_for(state="detached")  # cleared at once: nothing slides out
    assert pg.locator("a.card[aria-current]").count() == 0
    assert pg.problems == []


def test_resizing_to_a_wide_screen_frees_the_list(browser):
    pg = open_site(browser, viewport={"width": 600, "height": 800})
    pg.locator("a.card").first.click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert pg.evaluate("document.getElementById('items').inert")  # sliding over the list: the list waits
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.wait_for_function("() => !document.getElementById('items').inert")
    assert pg.locator("#reader-backdrop").is_hidden()
    pg.set_viewport_size({"width": 1100, "height": 800})  # a laptop docks the reader too, as Feedbin does
    pg.wait_for_function("() => !document.getElementById('items').inert")
    pg.set_viewport_size({"width": 900, "height": 800})  # a small window docks it too, beside the list
    pg.wait_for_function("() => !document.getElementById('items').inert")
    pg.set_viewport_size({"width": 600, "height": 800})
    pg.wait_for_function("() => document.getElementById('items').inert")
    assert pg.problems == []


def test_narrowing_the_window_doesnt_fling_a_closed_reader(browser):
    # Docked, a story opened then closed by picking a topic; zooming in (or narrowing) past the breakpoint used to slide
    # the closed panel across the screen, since the overlay's closed state is off to the right.
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    pg.locator("a.card").first.click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.locator("#filters [data-f='all']").click()
    wait_until_closed(pg)
    pg.set_viewport_size({"width": 600, "height": 800})
    pg.wait_for_timeout(50)  # mid-slide, if there were one
    assert pg.evaluate("getComputedStyle(document.getElementById('reader')).visibility") == "hidden"
    assert pg.evaluate("document.getElementById('reader').getAnimations().length") == 0
    assert pg.problems == []


def test_mid_width_docks_the_reader_and_pages_topics_and_list(browser):
    # Between phone and three columns, as in Feedbin: the reader stays docked, and the topics and the list are two pages of one
    # left pane, scrolled sideways.
    pg = open_site(browser, viewport={"width": 900, "height": 800})
    shell = "document.querySelector('.shell')"
    box = lambda s: pg.locator(s).bounding_box()
    pg.wait_for_function(f"() => {shell}.scrollLeft > 0")  # opens on the stories
    assert pg.locator("#reader").is_visible() and pg.locator("#reader-backdrop").is_hidden()
    assert box("#col")["x"] == 0 and box("#reader")["x"] == 360 and box(".side")["x"] < 0
    assert pg.locator("#resize-side").is_hidden() and pg.locator("#resize-list").is_hidden()  # no columns to resize
    pg.locator("a.card").nth(1).click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert box("#col")["x"] == 0 and box("#reader")["x"] == 360  # the list stays beside the story
    assert not pg.evaluate("document.getElementById('items').inert") and pg.get_attribute("#reader", "aria-modal") == "false"
    pg.mouse.move(180, 400)  # over the list, not the scrollbar: a sideways swipe there pages back to the topics
    pg.mouse.wheel(-400, 0)
    pg.wait_for_function("() => document.querySelector('.side').getBoundingClientRect().left === 0")
    pg.locator("#filters [data-f='security']").click()
    pg.wait_for_function("() => document.getElementById('col').getBoundingClientRect().left === 0")  # slides to its list
    assert pg.evaluate("shown.every(i => cat(i.category) === 'security')")
    # The narrow end: the pane gives way so the article keeps 360px.
    pg.set_viewport_size({"width": 641, "height": 800})
    pane, reader = box("#col"), box("#reader")
    assert pane["width"] >= 280 and reader["width"] >= 360 and abs(reader["x"] - pane["width"]) <= 1
    assert pg.problems == []


def test_the_reader_marks_a_story_unread_and_read_again(browser):
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    card = pg.locator("a.card").nth(1)
    url = card.get_attribute("href")
    assert card.locator(".card-meta").inner_text().count("min") == 0  # reading time lives in the reader now
    card.click()
    frame = pg.frame_locator("#reader-body iframe:not(.loading)")
    frame.locator(".meta", has_text="min read").wait_for()
    btn = pg.locator("#reader-unread")
    assert "read" in card.get_attribute("class").split() and btn.get_attribute("aria-label") == "Mark as unread"
    btn.click()
    assert "read" not in card.get_attribute("class").split() and btn.get_attribute("aria-label") == "Mark as read"
    assert not pg.evaluate("u => readSet.has(u)", url) and pg.inner_text("#status") == "Marked as unread"
    pg.keyboard.press("m")  # the shortcut toggles it back
    assert "read" in card.get_attribute("class").split() and pg.evaluate("u => readSet.has(u)", url)
    # Docked under the header, the reader doesn't repeat the theme switch in the header's menu.
    assert pg.locator("#reader-theme").is_hidden() and pg.locator("#menu-btn").is_visible()
    assert pg.problems == []


def test_read_marks_the_list_read_once_confirmed(browser):
    # Feedbin's toolbar at the sidebar's foot, Shortcuts and Read each centred in half of it. Read asks first, and marks only
    # the list that's showing.
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    count = lambda f: pg.locator(f"#filters .filter-btn[data-f='{f}'] .f-count")
    opened = pg.evaluate("items.find(i => cat(i.category) !== 'security').title")
    pg.evaluate("openReader(items.find(i => cat(i.category) !== 'security'))")  # read by hand: "Recently read" keeps it first
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.click("#filters [data-f='security']")
    wait_until_closed(pg)
    bar, side, col = (pg.locator(s).bounding_box() for s in ("#list-bar", ".side", "#col"))
    assert bar["x"] == 0 and bar["width"] == side["width"] and bar["y"] + bar["height"] == 900  # the sidebar's foot
    assert pg.locator("a.card").first.bounding_box()["y"] < 20 and col["y"] == 0  # the list runs to the top
    keys, read = pg.locator("#bar-keys").bounding_box(), pg.locator("#read-all").bounding_box()
    centre = lambda b: b["x"] + b["width"] / 2
    assert abs(centre(keys) - bar["width"] / 4) <= 1 and abs(centre(read) - bar["width"] * 3 / 4) <= 1  # balanced halves
    assert pg.locator("#bar-top").is_hidden()
    pg.click("#bar-keys")
    assert pg.locator("#keys").is_visible()
    pg.keyboard.press("Escape")
    n, others = pg.evaluate("shown.length"), count("all").text_content()
    pg.click("#read-all")
    assert pg.locator("#confirm-read").is_visible() and pg.inner_text("#confirm-msg") == f"Mark {n} unread stories in Security as read?"
    pg.click("#confirm-read button[value='cancel']")
    assert pg.locator("a.card.read").count() == 0 and pg.locator("#confirm-read").is_hidden()
    pg.click("#read-all")
    pg.click("#confirm-read .primary")
    pg.locator("a.card:not(.read)").first.wait_for(state="detached")  # the dialog's close event comes a moment after
    assert pg.locator("a.card:not(.read)").count() == 0 and count("security").count() == 0
    assert int(count("all").text_content().split()[0]) == int(others.split()[0]) - n  # other topics untouched
    assert pg.locator("#read-all").is_disabled() and pg.inner_text("#status") == f"Marked {n} stories as read"
    assert pg.evaluate("shown.every(i => readSet.has(i.url))")
    pg.keyboard.press("/")
    pg.locator("#palette").wait_for()
    assert pg.locator("#palette-list .p-title").first.inner_text() == opened  # "Recently read" still starts with what was opened
    pg.keyboard.press("Escape")
    pg.reload()  # kept in the browser
    pg.wait_for_selector("a.card")
    assert pg.evaluate("items.filter(i => cat(i.category) === 'security').every(i => isRead(i.url))")
    assert pg.problems == []


def test_shift_a_asks_to_mark_the_list_read_and_escape_cancels(browser):
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    pg.keyboard.press("Shift+A")
    assert pg.locator("#confirm-read").is_visible() and "Mark" in pg.inner_text("#confirm-msg")
    pg.keyboard.press("j")  # page keys stay out of it
    pg.keyboard.press("Escape")
    assert pg.locator("#confirm-read").is_hidden() and pg.evaluate("readSet.size") == 0 and not reading(pg)
    assert pg.problems == []


def test_mark_above_and_below_as_read(browser):
    # Feedbin's "…" on the selected story: above is newer, below older, including stories not loaded yet.
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    assert pg.locator("#card-more").is_hidden()
    pg.locator("a.card").nth(2).click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    url = pg.evaluate("readerFor")
    assert pg.evaluate("document.getElementById('card-more').previousElementSibling.getAttribute('href')") == url
    btn = pg.locator("#card-more-btn")
    btn.click()
    assert btn.get_attribute("aria-expanded") == "true"
    pg.click("#read-above")
    assert pg.evaluate("shown.slice(0, 3).every(i => isRead(i.url)) && !shown.slice(3).some(i => isRead(i.url))")
    assert pg.locator("#more-pop").is_hidden() and pg.evaluate("document.activeElement.id") == "card-more-btn"
    btn.click()
    pg.keyboard.press("Escape")  # closes the menu, not the story
    assert pg.locator("#more-pop").is_hidden() and reading(pg)
    btn.click()
    pg.click("#read-below")
    assert pg.evaluate("shown.length > limit && shown.every(i => isRead(i.url))")  # beyond the loaded page too
    assert pg.evaluate("[...readSet].at(-1)") == url  # still the one read last
    assert pg.problems == []


def test_phones_get_feedbins_toolbar_and_keep_the_closed_story_selected(browser):
    # As in Feedbin's app: a bottom bar, two buttons each centred in half of it. Back to top takes the left, dimmed at the top
    # as Feedbin dims Edit; Read the right.
    pg = open_site(browser, viewport={"width": 320, "height": 700}, has_touch=True, is_mobile=True)
    bar, top, read = (pg.locator(s).bounding_box() for s in ("#list-bar", "#bar-top", "#read-all"))
    assert bar["x"] == 0 and bar["width"] == 320 and bar["y"] + bar["height"] == 700
    assert abs(top["x"] + top["width"] / 2 - 80) <= 1 and abs(read["x"] + read["width"] / 2 - 240) <= 1 and read["height"] >= 44
    assert pg.locator("#bar-keys").is_hidden() and pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert pg.locator("#bar-top").is_disabled()
    pg.evaluate("scrollTo(0, 1500)")
    pg.wait_for_function("() => !document.getElementById('bar-top').disabled")
    pg.tap("#bar-top")
    pg.wait_for_function("() => scrollY === 0 && document.getElementById('bar-top').disabled")
    pg.tap("#read-all")
    assert pg.locator("#confirm-read").is_visible()
    pg.tap("#confirm-read button[value='cancel']")
    pg.locator("a.card").nth(1).tap()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.click("#reader-close")
    wait_until_closed(pg)
    card = pg.locator("a.card").nth(1)
    assert card.get_attribute("aria-current") == "true" and pg.locator("#card-more").is_visible()  # still selected, as in Feedbin
    pg.click("#card-more-btn")
    pg.click("#read-above")
    assert pg.evaluate("isRead(shown[0].url) && !isRead(shown[2].url)")
    pg.click("#list-back")
    pg.wait_for_function("() => getComputedStyle(document.getElementById('list-bar')).opacity === '0'")
    assert pg.evaluate("document.getElementById('read-all').inert")  # on the topics: gone, and out of reach
    assert pg.problems == []


def unflag(data):
    for i in data["items"]:
        i.pop("exploited", None)


def flag_some(data):
    """Flags the newest security story, the newest infrastructure one, and one from more than a week ago, and nothing else."""
    unflag(data)
    newest = lambda c: max((i for i in data["items"] if i["category"] == c), key=lambda i: i.get("published") or i["date"])
    old = min(data["items"], key=lambda i: i["date"])
    for i, kev in ((newest("security"), ["CVE-2026-1"]), (newest("infrastructure"), []), (old, ["CVE-2025-9"])):
        i["exploited"] = {"kev": kev, "at": i.get("added") or i["date"]} | ({"fix": "available"} if kev else {"quote": "is being exploited in the wild", "fix": "none"})
    data["flagged"] = [newest("security")["url"], newest("infrastructure")["url"], old["url"]]  # for the test; the site ignores it


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_exploited_stories_are_tagged_in_place_and_listed_for_a_week(browser, scheme):
    from axe_playwright_python.sync_playwright import Axe
    pg = open_site(browser, patch=flag_some, viewport={"width": 1440, "height": 900}, color_scheme=scheme)
    sec, infra, old = pg.evaluate("fetch('/data.json').then(r => r.json()).then(d => d.flagged)")  # patched too
    by_age = lambda: pg.evaluate("shown.every((i, n, a) => !n || ageMins(a[n - 1]) <= ageMins(i))")
    card = lambda u: pg.locator(f'a.card[href="{u}"]')
    assert by_age()  # tagged where they fall: nothing jumps the order
    pill = lambda u: " ".join(card(u).locator(".exploited > span").all_inner_texts()).lower()
    assert pill(sec) == "exploited patched" and pill(infra) == "exploited no patch"  # whether the vendor's fix is out
    assert pg.evaluate("u => items.find(i => i.url === u).exploited && !listed(items.find(i => i.url === u))", old)  # tagged, but too old to list
    entry = pg.locator("#filters [data-f='exploited']")
    assert entry.locator(".f-name").inner_text() == "Exploited" and entry.locator(".f-open").inner_text() == "1 unpatched"
    assert entry.locator(".f-count").count() == 0  # in place of the unread count, while a flaw has no fix
    entry.click()
    assert sorted(pg.evaluate("shown.map(i => i.url)")) == sorted([sec, infra]) and by_age()  # the last week's, newest first
    assert pg.locator("a.card .exploited").count() == 2  # marked in every list, this one too
    assert pg.inner_text("#end-msg") == "That\u2019s all 2 exploited flaws from the last 7 days."
    pg.click("#filters [data-f='all']")
    tags = {"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]}}
    assert [(v["id"], v["nodes"][0]["html"][:80]) for v in Axe().run(pg, options=tags).response["violations"]] == []
    card(sec).click()
    flag = pg.frame_locator("#reader-body iframe:not(.loading)").locator(".meta .flag")
    assert " ".join(flag.inner_text().split()).lower() == "actively exploited · patch available · confirmed by cisa"
    assert pg.problems == []


def test_a_row_shows_one_label_the_one_that_matters_most(browser):
    # Several at once is noise: Exploited, then Essential, then New.
    def everything(data):
        flag_some(data)
        sec = data["flagged"][0]
        data["weekly"]["items"][0]["url"] = sec  # exploited and essential
        for i in data["items"]:
            i["added"] = "2099-01-01T00:00:00+00:00"  # and new, as every story is
    pg = open_site(browser, patch=everything, viewport={"width": 390, "height": 800}, has_touch=True, is_mobile=True)
    pg.add_init_script("localStorage.setItem('seenUntil', '2000-01-01T00:00:00Z')")
    pg.reload()
    enter_list(pg)
    sec = pg.evaluate("fetch('/data.json').then(r => r.json()).then(d => d.flagged[0])")
    meta = lambda u: pg.locator(f'a.card[href="{u}"] .card-meta > :not(.card-src)')
    assert meta(sec).count() == 1 and meta(sec).first.get_attribute("class") == "exploited"
    ess = pg.evaluate("[...picks.keys()].find(u => !items.find(i => i.url === u).exploited)")
    assert meta(ess).count() == 1 and meta(ess).first.text_content() == "Essential"  # over New (text_content: offscreen rows aren't rendered)
    card = pg.locator(f'a.card[href="{sec}"]')
    assert card.locator(".card-src").evaluate("e => e.scrollWidth <= e.clientWidth")  # the source stays whole on a phone
    assert pg.problems == []


def test_the_exploited_list_is_only_there_when_it_has_stories(browser):
    pg = open_site(browser, patch=unflag, viewport={"width": 1440, "height": 900})
    assert pg.locator("#filters [data-f='exploited']").count() == 0


def test_picking_a_topic_closes_the_open_story(browser):
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    for topic in ("all", "security"):  # the current topic too, as in Feedbin
        pg.locator("a.card").first.click()
        pg.wait_for_selector("#reader-body iframe:not(.loading)")
        pg.click(f"#filters .filter-btn[data-f='{topic}']")
        wait_until_closed(pg)
        pg.locator("#reader-body iframe").first.wait_for(state="detached")
        assert pg.evaluate("location.pathname") == "/" and pg.locator("a.card[aria-current]").count() == 0
        assert pg.locator(f"#filters .filter-btn.active").get_attribute("data-f") == topic
    assert pg.problems == []


def test_sidebar_counts_unread_stories(browser):
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    count = lambda f: pg.locator(f"#filters .filter-btn[data-f='{f}'] .f-count").text_content()
    total = pg.evaluate("items.length")
    first = pg.evaluate("shown[0]")
    topic = pg.evaluate("c => cat(c)", first["category"])
    before = int(count(topic).split()[0])
    assert count("all") == f"{total} unread"
    pg.locator("a.card").first.click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    assert count("all") == f"{total - 1} unread" and count(topic) == f"{before - 1} unread"
    pg.click("#reader-unread")  # marking it unread puts it back
    assert count("all") == f"{total} unread" and count(topic) == f"{before} unread"
    pg.evaluate("items.forEach(i => readSet.add(i.url)); renderFilters()")
    assert pg.locator("#filters .f-count").count() == 0 and pg.locator("#filters .filter-btn").count() > 2  # all read: no counts, topics stay
    assert pg.problems == []


def test_a_first_visit_counts_only_the_last_day_as_unread(browser):
    ctx = browser.new_context(viewport={"width": 1100, "height": 900})
    pg = ctx.new_page()
    pg.goto(URL)
    enter_list(pg)
    count = lambda: pg.locator("#filters .filter-btn[data-f='all'] .f-count").text_content()
    # The essentials count too, however old: they're the stories not to miss.
    fresh = pg.evaluate("items.filter(i => Date.parse(i.added || i.published || i.date) > Date.parse(generatedAt) - 864e5 || picks.has(i.url)).length")
    assert 0 < fresh < pg.evaluate("items.length") and count() == f"{fresh} unread"
    assert pg.evaluate("picks.size > 0 && [...picks.keys()].every(u => !isRead(u))")
    # Older stories show as read, and one marked unread by hand stays unread.
    old = pg.locator("a.card.read").first
    url = old.get_attribute("href")
    old.click()
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    pg.click("#reader-unread")
    assert count() == f"{fresh + 1} unread"
    assert pg.evaluate("JSON.parse(localStorage.getItem('read'))") == []  # nothing in "Recently read" it wasn't
    pg.goto(URL)
    enter_list(pg)
    assert count() == f"{fresh + 1} unread" and not pg.evaluate("u => isRead(u)", url)
    # Newest first: no row is older than the one below it.
    ages = pg.evaluate("shown.map(ageMins)")
    assert ages == sorted(ages)


def test_a_first_visit_after_a_quiet_stretch_still_counts_the_newest_five(browser):
    ctx = browser.new_context(viewport={"width": 1100, "height": 900})
    def quiet(route):  # a Monday morning: builds kept running, but nothing new since Friday
        data = route.fetch().json()
        data["generated_at"] = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(timespec="seconds")
        route.fulfill(json=data)
    ctx.route("**/data.json*", quiet)
    pg = ctx.new_page()
    pg.goto(URL)
    enter_list(pg)
    # The newest five, plus any that arrived in the same build as the fifth: a build's stories stay together.
    want = pg.evaluate("(() => { const t = items.map(arrived).sort((a, b) => b - a); return items.filter(i => arrived(i) >= t[4] || picks.has(i.url)).length; })()")
    assert want >= 5 and pg.locator("#filters .filter-btn[data-f='all'] .f-count").text_content() == f"{want} unread"


def test_wide_screens_scroll_the_list_by_itself(browser):
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    col = pg.locator("#col").bounding_box()
    assert pg.evaluate("document.documentElement.scrollHeight <= innerHeight")  # the window doesn't scroll
    assert pg.evaluate("e => e.scrollHeight > e.clientHeight", pg.locator("#col").element_handle())
    assert col["x"] + col["width"] <= pg.locator("#reader").bounding_box()["x"] + 1  # its scrollbar sits beside the list
    pg.mouse.move(460, 450)
    for _ in range(40):  # the next pages load as the list nears its end
        if pg.locator("#end").is_visible():
            break
        pg.mouse.wheel(0, 3000)
        pg.wait_for_timeout(100)
    assert pg.locator("#end").is_visible() and pg.evaluate("limit >= shown.length")
    pg.locator("#top").click()  # back to the top of the list
    pg.wait_for_function("() => document.getElementById('col').scrollTop === 0")
    assert pg.problems == []


def test_phone_swipes_move_between_the_topics_and_a_list(browser):
    pg = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True).new_page()
    pg.goto(URL)
    pg.wait_for_selector("#filters .filter-btn")
    cdp = pg.context.new_cdp_session(pg)
    def swipe(x0, x1, y=500):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
        for k in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * k / 8, "y": y + 2}]})
            pg.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    home = lambda: pg.evaluate("document.body.classList.contains('home')")
    swipe(330, 80)  # nothing to go back into yet
    pg.wait_for_timeout(400)
    assert home()
    pg.tap("#filters .filter-btn[data-f='ai']")
    pg.wait_for_selector("a.card")
    swipe(60, 320)  # right: back to the topics
    pg.wait_for_function("() => document.body.classList.contains('home')")
    swipe(330, 80)  # left: back into the list just left
    pg.wait_for_selector("a.card")
    assert not home() and pg.inner_text("#list-name") == "AI"
    pg.go_back()  # it's a page in history, as a tap makes it
    pg.wait_for_function("() => document.body.classList.contains('home')")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 300, "y": 700}]})  # mostly down: a scroll, not a swipe
    for k in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": 300 - 10 * k, "y": 700 - 40 * k}]})
        pg.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    pg.wait_for_timeout(400)
    assert home()


def test_a_story_read_once_reopens_without_fetching_again(browser):
    pg = open_site(browser, viewport={"width": 412, "height": 915}, has_touch=True, is_mobile=True)
    fetches = []
    pg.on("request", lambda r: fetches.append(r.url) if "/api/read" in r.url else None)
    card = pg.locator("a.card").nth(1)
    card.tap()
    pg.frame_locator("#reader-body iframe:not(.loading)").locator("p").nth(29).wait_for()
    frame = pg.locator("#reader-body iframe:not(.loading)").element_handle()
    pg.go_back()
    wait_until_closed(pg)
    card.tap()  # the same story again
    pg.wait_for_function("() => document.body.classList.contains('reading')")
    pg.wait_for_timeout(300)
    assert len(fetches) == 1  # stored this visit: no second fetch
    assert pg.evaluate("f => f.isConnected && document.querySelectorAll('#reader-body iframe').length === 1", frame)  # the same frame, where it was
    assert pg.problems == []


def test_wide_screens_resize_the_topics_and_the_list(browser):
    pg = open_site(browser, viewport={"width": 1440, "height": 900})
    width = lambda v: pg.evaluate(f"parseFloat(getComputedStyle(document.documentElement).getPropertyValue('{v}'))")
    def drag(sel, by):
        box = pg.locator(sel).bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, 400)
        pg.mouse.down()
        pg.mouse.move(box["x"] + box["width"] / 2 + by, 400, steps=5)
        pg.mouse.up()
    side, lst = width("--side-w"), width("--list-w")
    drag("#resize-list", 120)
    drag("#resize-side", -40)
    assert width("--list-w") == lst + 120 and width("--side-w") == side - 40
    assert abs(pg.locator("#reader").bounding_box()["x"] - (side - 40 + lst + 120)) <= 1  # the reader moves over
    drag("#resize-list", 2000)  # the reader keeps room to read in
    assert pg.locator("#reader").bounding_box()["width"] >= 480
    pg.locator("#resize-side").focus()
    pg.keyboard.press("ArrowRight")  # and from the keyboard
    assert width("--side-w") == side - 40 + 16 and pg.get_attribute("#resize-side", "aria-valuenow") == str(int(side - 40 + 16))
    kept = width("--side-w")
    pg.reload()
    enter_list(pg)
    assert width("--side-w") == kept  # kept on this device
    pg.locator("#resize-side").dblclick()
    assert width("--side-w") == side  # double-click: back to the default
    assert pg.locator("#resize-side").is_hidden() is False and pg.problems == []


def ticker_site(browser, built_hours_ago, now="2026-11-10T14:00:00Z", **context):
    """The site on a fake clock (so the pass can be stepped through exactly), with data built some hours before `now`."""
    ctx = browser.new_context(**context)
    pg = ctx.new_page()
    built = (datetime.fromisoformat(now.replace("Z", "+00:00")) - timedelta(hours=built_hours_ago)).isoformat(timespec="seconds")
    def patched(route):
        data = route.fetch().json()
        data["generated_at"], data["tz"] = built, "America/New_York"
        route.fulfill(json=data)
    ctx.route("**/data.json*", patched)
    pg.clock.install(time=now)
    pg.clock.pause_at(now)  # time moves only when the test says: a slow machine can't run the pass early
    pg.goto(URL)
    pg.wait_for_selector("#filters .filter-btn")
    pg.clock.run_for(50)
    assert not pg.evaluate("document.body.classList.contains('ticking')")  # the wordmark first, to be seen on arrival
    pg.clock.run_for(1100)
    assert not pg.evaluate("document.body.classList.contains('ticking')")
    pg.clock.run_for(100)  # 1.2s in: the pass begins
    return pg


def test_opening_runs_the_wordmark_through_how_fresh_the_news_is_once(browser):
    pg = ticker_site(browser, 1, viewport={"width": 1440, "height": 900})
    ticking = lambda: pg.evaluate("document.body.classList.contains('ticking')")
    assert ticking() and pg.get_attribute("#ticker", "aria-hidden") == "true"  # screen readers get the sidebar's "Updated" instead
    seen = []
    for _ in range(4):
        pg.clock.run_for(400)  # into the line, past its fade
        seen.append(pg.inner_text("#ticker"))
        pg.clock.run_for(1100)
    # The date where the site is (9am in New York), when it updated, when the next build is due (16:17 UTC), then the wordmark.
    assert seen[:3] == ["Tuesday, November 10", "Updated 1h ago", "Next update in 2h 17m"]
    pg.clock.run_for(400)
    assert not ticking()  # back on the wordmark, in under five seconds all told (WCAG 2.2.2), and it stays there
    pg.clock.run_for(60_000)
    assert not ticking()


def test_a_late_build_skips_the_promise_and_a_tap_ends_the_pass(browser):
    pg = ticker_site(browser, 6, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    lines = []
    for _ in range(3):
        pg.clock.run_for(400)
        lines.append(pg.inner_text("#ticker"))
        pg.clock.run_for(1100)
    assert lines[:2] == ["Tuesday, November 10", "Updated 6h ago"] and not any("Next update" in l for l in lines)  # late: no promise
    pg = ticker_site(browser, 1, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    pg.clock.run_for(400)
    pg.tap(".logo-h")  # mid-pass: it just ends, rather than navigating
    assert not pg.evaluate("document.body.classList.contains('ticking')") and pg.evaluate("location.pathname") == "/"


def test_coming_back_after_a_while_plays_the_pass_again(browser):
    pg = ticker_site(browser, 1, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    ticking = lambda: pg.evaluate("document.body.classList.contains('ticking')")
    pg.clock.run_for(6000)
    assert not ticking()
    away = "h => { Object.defineProperty(document, 'hidden', { get: () => h, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }"
    pg.evaluate(away, True)  # to the background, as a phone does when Upshot is closed
    pg.clock.run_for(5 * 60_000)
    pg.evaluate(away, False)  # back within minutes: still the same visit
    pg.clock.run_for(500)
    assert not ticking()
    pg.evaluate(away, True)
    pg.clock.run_for(20 * 60_000)
    pg.evaluate(away, False)  # back after a while: an opening, so one pass, after the wordmark's moment
    pg.wait_for_timeout(300)
    pg.clock.run_for(1300)
    assert ticking()


def test_a_pass_waits_for_the_wordmark_to_be_in_view(browser):
    # Reloaded on a story, on a phone: the pass waits under it, and plays from the top on reaching the topics.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.goto(URL)
    pg.wait_for_selector("#filters .filter-btn")
    path = pg.evaluate("readPath(items[0].url)")
    start = datetime.now(timezone.utc)
    pg.clock.install(time=start)
    pg.clock.pause_at(start)  # time moves only when the test says
    pg.goto(URL.rstrip("/") + path)
    pg.wait_for_selector("#reader-body iframe:not(.loading)")
    ticking = lambda: pg.evaluate("document.body.classList.contains('ticking')")
    pg.clock.run_for(8000)  # longer than a whole pass
    assert not ticking() and pg.evaluate("tickPending")
    pg.locator("#reader-close").click()  # back to the list: the wordmark's still out of view
    pg.wait_for_function("() => !document.body.classList.contains('reading')")
    pg.clock.run_for(3000)
    assert not ticking()
    pg.locator("#list-back").click()  # the topics: now it plays, wordmark first
    pg.wait_for_function("() => document.body.classList.contains('home')")
    pg.clock.run_for(600)
    assert not ticking()
    pg.clock.run_for(1000)
    assert ticking()
    # Leaving mid-pass stops it: back on the topics later, it's the wordmark, not the middle of the pass.
    pg.locator("#filters .filter-btn[data-f='all']").click()
    pg.clock.run_for(300)
    assert not ticking()
    pg.locator("#list-back").click()
    pg.wait_for_function("() => document.body.classList.contains('home')")
    pg.clock.run_for(3000)
    assert not ticking()


def test_a_refresh_is_not_an_opening(browser):
    pg = ticker_site(browser, 1, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)  # one pass, now
    ticking = lambda: pg.evaluate("document.body.classList.contains('ticking')")
    assert ticking()
    pg.clock.run_for(6000)
    for wait, plays in ((0, False), (5 * 60_000, False), (16 * 60_000, True)):  # moments, minutes, then a while after
        pg.clock.run_for(wait)
        pg.reload()
        pg.wait_for_selector("#filters .filter-btn")
        pg.clock.run_for(1300)  # past the wordmark's moment
        assert ticking() == plays, wait
        pg.clock.run_for(6000)
