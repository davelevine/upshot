"""Fetch feeds, classify + summarize new items with an LLM, write the static site data."""
import gzip
import hashlib
import html
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import feedparser
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
SITE = ROOT / "site"
STATE = ROOT / "state.json"
# Stories are dated, and days labelled, in one time zone, so "Today" means the same thing on every device.
SITE_TZ = ZoneInfo(os.environ.get("SITE_TZ") or "America/New_York")
SITE_URL = (os.environ.get("SITE_URL") or "https://upshot.levine.io").rstrip("/")  # forks set the SITE_URL repo variable
MODEL = os.environ.get("UPSHOT_MODEL", "claude-haiku-5-5")
CLAUDE = os.environ.get("CLAUDE_BIN", "claude")  # Claude Code CLI
CATEGORIES = ["ai", "security", "architecture", "sdlc", "regulation", "other"]
KEEP_DAYS = 90        # items and seen-URLs older than this are pruned
FRESH_DAYS = int(os.environ.get("FRESH_DAYS", 3))  # ignore feed entries published longer ago than this
PER_FEED = int(os.environ.get("PER_FEED", 10))     # newest N entries per feed per run (caps huge feeds)
# The one rule: a story is published if it clears its category's bar and isn't a repeat. The bars differ only to
# calibrate for how Haiku scores: plenty of security stories get an 8, a strong architecture or SDLC piece a 6.
MIN_RELEVANCE = {"ai": 7, "security": 8, "architecture": 6, "sdlc": 6, "regulation": 8, "other": 7}
# Report on stories first published elsewhere: the original source wins ties and replaces their copy of a repeat.
NEWS_SOURCES = {"Ars Technica", "BleepingComputer", "InfoQ", "SecurityWeek", "The Hacker News", "The Record"}
DEDUPE_DAYS = 7       # new items are checked for repeats of the last N days' headlines
DAILY_MAX = 20        # anomaly guard (a broken feed, a scoring bug), set above the busiest real day
DEAD_AFTER_DAYS = 14  # a feed failing this long gets reported
SILENT_AFTER_DAYS = 45  # a feed that loads but hasn't posted in this long gets reported
BATCH = 20            # stories per repeat check
SCORE_WORKERS = 6     # parallel scoring calls (each is a CLI process)
UA = "upshot/1.0 (+https://github.com/davelevine/upshot)"
WORDS_PER_MINUTE = 230
MIN_ARTICLE_WORDS = 300  # less than this in a feed or page is probably a teaser, not the article
TRACKING = re.compile(r"^(utm_|ref$|source$|fbclid$|gclid$)")


def now():
    return datetime.now(timezone.utc)


def read_opml(path):
    return [(o.get("text"), o.get("xmlUrl")) for o in ET.parse(path).iter("outline") if o.get("xmlUrl")]


def normalize_url(url):
    p = urllib.parse.urlsplit(url.strip())
    query = urllib.parse.urlencode([(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not TRACKING.match(k)])
    return urllib.parse.urlunsplit((p.scheme, p.netloc.lower(), p.path, query, ""))


def clean_text(s, limit=600):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()[:limit]


class PermanentRedirects(urllib.request.HTTPRedirectHandler):
    """Notes where a URL now lives, but only if every hop was permanent: a 302 says nothing about the feed moving."""
    def __init__(self):
        self.hops = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops.append(code)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


MOVED = {}  # feed URL -> where it permanently redirects now


def fetch(feed):
    title, url = feed
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    redirects = PermanentRedirects()
    with urllib.request.build_opener(redirects).open(req, timeout=20) as resp:
        body = resp.read()
        if redirects.hops and all(c in (301, 308) for c in redirects.hops) and resp.geturl() != url:
            MOVED[url] = resp.geturl()
    if body[:2] == b"\x1f\x8b":  # some servers gzip regardless of Accept-Encoding
        body = gzip.decompress(body)
    parsed = feedparser.parse(body)
    if not parsed.entries and parsed.bozo:
        raise ValueError(f"unparseable feed: {parsed.bozo_exception}")
    first = next((e.get("link") for e in parsed.entries if e.get("link")), None)  # for feeds that don't name their site
    SITE_LINKS[title] = parsed.feed.get("link") or (first and urllib.parse.urljoin(first, "/"))  # for the publisher's icon
    return title, parsed.entries


LOOSE_DATES = ("%b %d, %Y %H:%M:%S%z", "%b %d, %Y")  # "Nov 05, 2026 00:00:00-0600": feedparser can't read these


def entry_time(e):
    t = e.get("published_parsed") or e.get("updated_parsed")
    if t:
        return datetime(*t[:6], tzinfo=timezone.utc)
    for raw in (e.get("published"), e.get("updated")):
        for fmt in LOOSE_DATES:
            try:
                when = datetime.strptime((raw or "").strip(), fmt)
            except ValueError:
                continue
            return (when if when.tzinfo else when.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    return None


def candidates(publisher, entries, seen, cutoff):
    """New, dated, recent entries from one feed, newest first, capped at PER_FEED."""
    out = []
    for e in entries:
        link, when = e.get("link"), entry_time(e)
        if not link or not e.get("title") or not when or when < cutoff:
            continue
        url = normalize_url(link)
        if not url.startswith(("https://", "http://")) or url in seen:  # links render as hrefs
            continue
        out.append({
            "url": url,
            "title": clean_text(e["title"], 300),
            "publisher": publisher,
            "date": when.astimezone(SITE_TZ).date().isoformat(),
            "excerpt": clean_text(e.get("summary") or e.get("description")),
        })
    return sorted(out, key=lambda i: i["date"], reverse=True)[:PER_FEED]


def llm(system, user, schema):
    """One structured call to Claude through the Claude Code CLI, which runs on the subscription
    (CLAUDE_CODE_OAUTH_TOKEN in CI). Tools, settings, MCP and sessions are off, so a call carries only
    the prompt. Returns the list of result objects."""
    r = subprocess.run(
        [CLAUDE, "-p", "--model", MODEL, "--system-prompt", system, "--tools", "", "--no-session-persistence",
         "--setting-sources", "", "--strict-mcp-config", "--output-format", "json", "--json-schema", json.dumps(schema), user],
        capture_output=True, text=True, timeout=300, cwd=tempfile.gettempdir())
    try:
        out = json.loads(r.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"claude exited {r.returncode}: {(r.stderr or r.stdout)[:300]}") from None
    if out.get("is_error") or "structured_output" not in out:
        raise RuntimeError(f"claude error: {str(out.get('result'))[:300]}")
    # An unrecognized model name makes the CLI quietly answer with another model; scores would drift.
    if MODEL not in out.get("modelUsage", {}):
        raise RuntimeError(f"answered by {list(out.get('modelUsage', {}))}, not {MODEL}")
    res = out["structured_output"]
    return res if isinstance(res, list) else next(v for v in res.values() if isinstance(v, list))


CLASSIFY_PROMPT = f"""You curate a tech news digest for a senior infrastructure/platform engineer
interested in AI, security, architecture, software delivery (sdlc) and tech regulation.
For each item return:
- category: one of {", ".join(CATEGORIES)}
- relevance: 1-10, judged within the item's category, for a reader who follows that category closely
  (an architecture piece is compared with other architecture news, not with security incidents):
  10 = a once-a-month event the whole field will discuss: a frontier model launch, a mass-exploited
       critical flaw, a landmark regulation;
  8-9 = clearly one of this week's notable stories: a significant release, an actively exploited flaw in
       widely used software, a major outage or postmortem with real lessons, a substantive research result;
  6-7 = solid but routine: product updates, typical CVE advisories, vendor how-tos, narrow research;
  4-5 = minor, incremental or niche;
  1-3 = marketing, hiring, events, webinars, customer stories, off-topic.
  Most items are 4-7; reserve 8+ for roughly the top tenth of a day's news.
- summary: one plain factual sentence (max 30 words) saying what happened. No hype, no "this article".
Return JSON: {{"items": [{{"id", "category", "relevance", "summary"}}, ...]}} covering every input id."""

# A separate call, so the recent headlines can't skew relevance: shown alongside scoring, the model
# graded new items against the week's biggest stories and scored borderline ones a point low.
REPEATS_PROMPT = """You check a batch of tech news items for repeats of stories already on a digest.
For each item return duplicate_of: if it reports the same specific event as a "recent" headline, that
headline copied exactly; if it repeats an EARLIER item in this batch, that item's id as a string (e.g. "2");
else null. Coverage of the same launch, release or incident by a different outlet IS a duplicate, even from
another angle. A different version number, or a later development (a patch, a follow-up attack, new findings)
is NOT. When unsure, null.
Return JSON: {"items": [{"id", "duplicate_of"}, ...]} covering every input id."""

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "id": {"type": "integer"},
            "category": {"type": "string", "enum": CATEGORIES},
            "relevance": {"type": "integer"},
            "summary": {"type": "string"},
        },
        "required": ["id", "category", "relevance", "summary"], "additionalProperties": False,
    }}},
    "required": ["items"], "additionalProperties": False,
}

REPEATS_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "duplicate_of": {"anyOf": [{"type": "string"}, {"type": "null"}]}},
        "required": ["id", "duplicate_of"], "additionalProperties": False,
    }}},
    "required": ["items"], "additionalProperties": False,
}


def classify(batch):
    """Returns {url: result} for the batch; items the model skipped are simply absent."""
    payload = [{"id": n, "title": i["title"], "publisher": i["publisher"], "excerpt": i["excerpt"]}
               for n, i in enumerate(batch)]
    res = llm(CLASSIFY_PROMPT, json.dumps(payload), CLASSIFY_SCHEMA)
    return {batch[r["id"]]["url"]: r for r in res if 0 <= r["id"] < len(batch)}


def score_each(items):
    """Scores every story in its own call, in parallel. Scored in a batch, the model rationed high
    scores across the batch, so a story's score depended on its neighbours. Returns {url: result or None}."""
    def one(item):
        for attempt in range(3):
            try:
                return item["url"], classify([item]).get(item["url"])
            except Exception as e:
                if attempt == 2:
                    print(f"::warning::scoring failed for {item['url']}: {e}")
        return item["url"], None
    with ThreadPoolExecutor(SCORE_WORKERS) as ex:
        return dict(ex.map(one, items))


def find_repeats(batch, recent):
    """Returns {url: duplicate_of} for items the model flags; recent: headlines already on the site."""
    payload = {"recent": recent, "items": [
        {"id": n, "title": i["title"], "publisher": i["publisher"], "summary": i.get("summary", i["excerpt"])}
        for n, i in enumerate(batch)]}
    res = llm(REPEATS_PROMPT, json.dumps(payload), REPEATS_SCHEMA)
    return {batch[r["id"]]["url"]: r.get("duplicate_of") for r in res if 0 <= r["id"] < len(batch)}


WEEKLY_PROMPT = """From this week's tech news, pick the 5 items a busy senior engineer most needs to know about.
Prefer concrete releases, incidents and shifts over opinion. Avoid picking two items about the same story.
For each give the item id and "why": what a reader should do or what the consequence is, in one sentence of at
most 15 words. Don't restate the headline or describe the story; assume they've just read the title.
Return JSON: {"picks": [{"id", "why"}, ...]}."""

WEEKLY_SCHEMA = {
    "type": "object",
    "properties": {"picks": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "why": {"type": "string"}},
        "required": ["id", "why"], "additionalProperties": False,
    }}},
    "required": ["picks"], "additionalProperties": False,
}


def pick_weekly(items, today):
    start = (today - timedelta(days=6)).isoformat()
    week = [i for i in items if i["date"] >= start]
    if not week:
        return None
    payload = [{"id": n, "title": i["title"], "publisher": i["publisher"], "summary": i["summary"]}
               for n, i in enumerate(week)]
    res = llm(WEEKLY_PROMPT, json.dumps(payload), WEEKLY_SCHEMA)
    picks = [{"url": week[p["id"]]["url"], "why": p["why"]} for p in res if 0 <= p["id"] < len(week)]
    return {"window_start": start, "window_end": today.isoformat(), "selected_on": today.isoformat(), "items": picks[:5]}


OG = {"w": 1200, "h": 630, "pad": 72, "bg": "#15161e", "text": "#eceff4", "muted": "#a3abbb", "accent": "#73dbcc", "dot": "#d9485a",
      "cats": {"security": "#f7a3ad", "ai": "#d3abed", "architecture": "#80c7f8", "sdlc": "#b7b5fc", "regulation": "#ebb077", "other": "#b6becb"}}


def og_font(size, weight, opsz=14):
    font = ImageFont.truetype(str(SITE / "fonts" / "InterVariable.woff2"), size)
    font.set_variation_by_axes([opsz, weight])
    return font


def wrap(text, font, width, max_lines):
    """Lines that fit `width`, the last one ending in an ellipsis if the text runs over."""
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if font.getlength(trial) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    if len(lines) > max_lines:
        last = lines[max_lines - 1]
        while font.getlength(last + "…") > width:
            last = last.rsplit(" ", 1)[0]
        lines = lines[:max_lines - 1] + [last.rstrip(",;:") + "…"]
    return lines


def og_image(data, today):
    """The link-preview card: this week's #1 essential with what to do, or the site's tagline before there is one."""
    c, img = OG, Image.new("RGB", (OG["w"], OG["h"]), OG["bg"])
    d, x, right = ImageDraw.Draw(img), OG["pad"], OG["w"] - OG["pad"]
    logo = og_font(46, 760, 32)
    d.text((x, 62), "upshot", font=logo, fill=c["text"])
    end = x + logo.getlength("upshot")
    d.ellipse((end + 2, 98, end + 12, 108), fill=c["dot"])
    small, small_bold = og_font(22, 450), og_font(22, 600)
    d.text((right, 80), f"{today:%A}, {today:%B} {today.day}", font=small, fill=c["muted"], anchor="ra")

    picks = (data.get("weekly") or {}).get("items") or []
    by_url = {i["url"]: i for i in data.get("items", [])}
    top = by_url.get(picks[0]["url"]) if picks else None
    if not top:
        y = 230
        for line in wrap("AI, security and architecture news, summarized.", og_font(56, 700, 32), right - x, 3):
            d.text((x, y), line, font=og_font(56, 700, 32), fill=c["text"])
            y += 70
        d.text((x, y + 20), "Five weekly essentials, each with what to do.", font=og_font(30, 400), fill=c["muted"])
        d.text((x, 550), SITE_URL.split("//")[-1], font=small, fill=c["muted"])
        return img

    y = 184
    d.text((x, y), "THIS WEEK'S #1", font=small_bold, fill=c["muted"])
    cx = x + small_bold.getlength("THIS WEEK'S #1") + 26
    d.ellipse((cx, y + 7, cx + 12, y + 19), fill=c["cats"].get(top["category"], c["cats"]["other"]))
    d.text((cx + 22, y), top["category"].upper() if top["category"] != "ai" else "AI", font=small_bold, fill=c["muted"])
    y += 52
    head = og_font(52, 700, 32)
    lines = wrap(top["title"], head, right - x, 3)
    for line in lines:
        d.text((x, y), line, font=head, fill=c["text"])
        y += 66
    why = picks[0].get("why")
    if why:
        note = og_font(30, 400)
        note_lines = wrap(why, note, right - x - 28, 2 if len(lines) < 3 else 1)
        top_y = y + 18
        for n, line in enumerate(note_lines):
            d.text((x + 28, top_y + n * 42), line, font=note, fill=c["muted"])
        d.rectangle((x, top_y + 2, x + 3, top_y + 42 * len(note_lines) - 4), fill=c["accent"])
    d.text((x, 550), SITE_URL.split("//")[-1], font=small, fill=c["muted"])
    d.text((right, 550), f"{top['publisher']}  ·  {len(picks)} essential{'s' if len(picks) != 1 else ''} this week", font=small, fill=c["muted"], anchor="ra")
    return img


SITE_LINKS = {}
ICONS = SITE / "icons"
ICON_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"


def slug(name):
    """Same rule as tests/fixtures/fetch.mjs slug() and app.js iconSlug()."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def icon_candidates(page_html, base):
    """Icon URLs to try for a site, best first: apple-touch-icon, then the largest declared icon, then the usual paths."""
    found = []
    for tag in re.findall(r"<link\b[^>]*>", page_html, re.I):
        rel = (re.search(r'rel=["\']([^"\']+)', tag, re.I) or [None, ""])[1].lower()
        href = re.search(r'href=["\']([^"\']+)', tag, re.I)
        if not href or "icon" not in rel or "mask" in rel or href[1].lower().split("?")[0].endswith(".svg"):
            continue
        size = max((int(n) for n in re.findall(r"(\d+)x\d+", tag)), default=180 if "apple" in rel else 16)
        found.append((("apple" in rel), size, urllib.parse.urljoin(base, html.unescape(href[1]))))
    ranked = [u for _, _, u in sorted(found, key=lambda f: (f[0], f[1]), reverse=True)]
    return list(dict.fromkeys(ranked + [urllib.parse.urljoin(base, "/apple-touch-icon.png"), urllib.parse.urljoin(base, "/favicon.ico")]))


def fetch_icon(site):
    """A 64px PNG of a site's icon, or None. Pillow reads PNG, ICO, JPEG, GIF and WebP; SVG-only sites get nothing."""
    get = lambda u, n: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": ICON_UA}), timeout=10).read(n)
    try:
        page = get(site, 400_000).decode("utf-8", "replace")
    except Exception:
        page = ""
    for url in icon_candidates(page, site):
        try:
            img = Image.open(io.BytesIO(get(url, 2_000_000)))
            if hasattr(img, "ico"):  # an .ico holds several sizes; take the biggest
                img.size = max(img.ico.sizes())
            img = img.convert("RGBA")
        except Exception:
            continue
        if min(img.size) >= 16:
            img = img.resize((64, 64), Image.LANCZOS)
            if sum(a > 128 for a in img.getchannel("A").get_flattened_data()) < 64 * 64 * 0.05:
                continue  # nearly all transparent: draws as nothing
            return img
    return None


def fetch_icons(publishers):
    """Saves an icon for each publisher that doesn't have one yet; misses are retried next build. Returns the slugs with icons."""
    ICONS.mkdir(exist_ok=True)
    todo = {p: SITE_LINKS.get(p) for p in publishers if SITE_LINKS.get(p) and not (ICONS / f"{slug(p)}.png").exists()}
    with ThreadPoolExecutor(8) as ex:
        for p, img in zip(todo, ex.map(fetch_icon, todo.values())):
            if img:
                img.save(ICONS / f"{slug(p)}.png", optimize=True)
            else:
                print(f"no icon found for {p} ({todo[p]})")
    return sorted(f.stem for f in ICONS.glob("*.png"))


def icon_art(path):
    """"dark" or "light" for single-colour artwork on a transparent background, which would vanish against a background
    of the same tone: the reader inverts it there. Coloured icons, and ones on their own solid tile, get None."""
    img = Image.open(path).convert("RGBA")
    ink = [(r, g, b) for r, g, b, a in img.get_flattened_data() if a > 128]
    if not ink or len(ink) > 64 * 64 * 0.9:
        return None
    if sum(max(p) - min(p) for p in ink) / len(ink) > 40:  # coloured: inverting would wreck it
        return None
    light = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in ink) / len(ink)
    return "dark" if light < 80 else "light" if light > 200 else None


def write_og(data, today):
    """Writes site/og.png and points index.html's og:image at it. The URL carries a hash of the image, because Slack and
    iMessage cache previews by URL for days; it only changes, and index.html with it, when the picture does."""
    path = SITE / "og.png"
    og_image(data, today).save(path, optimize=True)
    version = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
    page = SITE / "index.html"
    html_text = page.read_text()
    updated = re.sub(r'(<meta property="og:image" content=")[^"]*(")', rf"\g<1>{SITE_URL}/og.png?v={version}\g<2>", html_text, count=1)
    if updated != html_text:
        page.write_text(updated)
    return version


def published(item):
    """When the story was added, so feed readers sort it correctly; midnight on its date for items from before that was kept."""
    when = datetime.fromisoformat(item.get("added") or item["date"])
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def rss(items):
    def esc(s):
        return html.escape(s, quote=False)
    entries = "".join(
        f"<item><title>{esc(i['title'])}</title><link>{esc(i['url'])}</link><guid>{esc(i['url'])}</guid>"
        f"<description>{esc(i['summary'])}</description><category>{i['category']}</category>"
        f"<pubDate>{format_datetime(published(i))}</pubDate></item>"
        for i in items[:50]
    )
    return ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Upshot</title>'
            f"<link>{SITE_URL}/</link><description>AI, security and architecture news, summarized.</description>"
            f"{entries}</channel></rss>\n")


def norm(title):
    return " ".join(title.lower().split())


def repeats(dup_of, n, covered_ids, recent_titles):
    """True if batch item n validly points at a recent headline (quoted exactly), or at an earlier batch item
    whose story is already covered (kept, or itself a repeat). Batch refs must point backwards, so every chain
    ends at a story that's on the site; misquotes, self/forward refs and low-relevance targets are ignored."""
    dup_of = str(dup_of or "").strip()
    if dup_of.isdigit():
        return int(dup_of) < n and int(dup_of) in covered_ids
    return bool(dup_of) and norm(dup_of) in recent_titles


def cap_per_day(items, published=()):
    """Newest day first. Each day keeps every story already on the site (`published`: ids of their dicts), then the
    best new ones up to DAILY_MAX. Within a day: most relevant first, the original source ahead of a news outlet."""
    rank = lambda i: (-i.get("relevance", 0), i.get("publisher") in NEWS_SOURCES)
    by_day = {}
    for i in items:
        by_day.setdefault(i["date"], []).append(i)
    out = []
    for day in sorted(by_day, reverse=True):
        kept = [i for i in by_day[day] if id(i) in published]
        fresh = sorted((i for i in by_day[day] if id(i) not in published), key=rank)[:max(0, DAILY_MAX - len(kept))]
        out += sorted(kept + fresh, key=rank)
    return out


def upgrade_source(items, title, item, result):
    """If the story headlined `title` came from a news outlet and `item` is the original source, swap it in, keeping
    the story's place in the feed. Returns whether it did."""
    if item["publisher"] in NEWS_SOURCES:
        return False
    for old in items:
        if norm(old["title"]) == norm(title) and old.get("publisher") in NEWS_SOURCES:
            old.pop("minutes", None)
            old.update({k: item[k] for k in ("title", "url", "publisher")},
                       category=result["category"], summary=result["summary"], relevance=max(old.get("relevance", 0), result["relevance"]))
            return True
    return False


def words_in(html):
    return len(re.sub(r"<[^>]+>", " ", html or "").split())


def feed_minutes(fetched):
    """{url: minutes} for feeds that publish whole articles, which some do for sites the reader can't get into."""
    out = {}
    for res in fetched.values():
        for e in (res[1] if res else ()):
            words = max([words_in(c.get("value")) for c in e.get("content", [])] + [words_in(e.get("summary"))])
            if e.get("link") and words >= MIN_ARTICLE_WORDS:
                out[normalize_url(e["link"])] = max(1, round(words / WORDS_PER_MINUTE))
    return out


def full_text_feeds(fetched):
    """{publisher: feed url} for feeds that publish whole articles. extract.mjs falls back to these when a page is blocked."""
    return {res[0]: url for url, res in fetched.items()
            if res and any(max([words_in(c.get("value")) for c in e.get("content", [])] + [words_in(e.get("summary"))]) >= MIN_ARTICLE_WORDS for e in res[1])}


def add_reading_times(items, known=None, feeds=None, texts=None):
    """Runs extract.mjs, which stores each new story's article for the reader, and fills in "minutes" from it or from whole
    articles in feeds (`known`). Only the number is kept here. 0 means blocked: shown as nothing, and retried. Never estimated
    from a summary, which would make every article about a minute. Returns an error if the reader's store couldn't be updated."""
    for i in items:
        if not i.get("minutes") and (known or {}).get(i["url"]):
            i["minutes"] = known[i["url"]]
    payload = {"items": [{k: i.get(k) for k in ("url", "publisher", "title", "minutes")} for i in items], "feeds": feeds or {},
               "textFor": [i["url"] for i in items if "tldr" not in i] if texts is not None else []}
    try:
        r = subprocess.run(["node", str(ROOT / "extract.mjs")], input=json.dumps(payload), capture_output=True, text=True, timeout=1800)
    except (OSError, subprocess.TimeoutExpired) as e:
        return str(e)
    if r.stderr:
        print(r.stderr, end="")
    if r.returncode:
        return f"extract.mjs exited {r.returncode}"
    out = json.loads(r.stdout)
    if texts is not None:
        texts.update(out.get("texts") or {})  # article text for TL;DRs, handed back rather than kept
    for i in items:
        words = out["words"].get(i["url"])
        if not i.get("minutes") and words is not None:
            i["minutes"] = max(1, round(words / WORDS_PER_MINUTE)) if words else 0
    return out.get("error")


TLDR_LIMIT = 60  # summaries written per build; the first rollout spreads over two
TLDR_PROMPT = """You write the TL;DR at the top of a tech news article, for a senior engineer who wants to act on it
straight away. Return 2 to 4 bullets, each under 25 words. Lead with what happened, then who or what is affected,
then the fix or action if the article gives one (if it gives none, leave action out rather than saying so). Use only facts stated in the article: never add a version, CVE,
number, date or name that isn't in the text, and copy any you use exactly. No hype, no speculation, no
"this article" framing. Plain sentences, no markdown."""
TLDR_SCHEMA = {
    "type": "object",
    "properties": {"bullets": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 4}},
    "required": ["bullets"], "additionalProperties": False,
}


def verify_tldr(bullets, text):
    """Keeps the bullets whose every figure (anything with a digit: CVE IDs, versions, counts, dates, amounts) appears
    word for word in the article. A wrong number in an "act now" summary is worse than no summary. [] under two left."""
    flat = " ".join(text.lower().split())
    def grounded(b):
        figures = (t.strip("()[]{}\"'“”‘’.,;:!?") for t in b.split())
        return all(f.lower() in flat for f in figures if any(c.isdigit() for c in f))
    kept = [b.strip() for b in bullets if b.strip() and grounded(b)]
    return kept if len(kept) >= 2 else []


def add_tldrs(items, texts, limit=TLDR_LIMIT):
    """Writes each story's TL;DR once, from its article text (`texts`, {url: text}), checked by verify_tldr. A story
    whose summary didn't survive the check gets [], so it isn't retried; a failed call leaves it for the next build."""
    todo = [i for i in items if "tldr" not in i and texts.get(i["url"])][:limit]

    def one(item):
        try:
            bullets = llm(TLDR_PROMPT, json.dumps({"title": item["title"], "article": texts[item["url"]]}), TLDR_SCHEMA)
        except Exception as e:
            print(f"::warning::TL;DR failed for {item['url']}: {e}")
            return item, None
        return item, verify_tldr(bullets, texts[item["url"]])

    with ThreadPoolExecutor(SCORE_WORKERS) as ex:
        for item, tldr in ex.map(one, todo):
            if tldr is not None:
                item["tldr"] = tldr
    return len(todo)


def run_summary(feeds, feeds_failed, new, scores, kept, repeated, health):
    """Markdown for the Actions run page: what this build saw, kept and nearly kept."""
    title = {i["url"]: i for i in new}
    scored = {u: r for u, r in scores.items() if r}
    near = sorted(((r, title[u]) for u, r in scored.items() if r["relevance"] == MIN_RELEVANCE.get(r["category"], 8) - 1),
                  key=lambda x: (x[0]["category"], x[1]["title"]))
    row = lambda r, i: f"| {r['category']} | {r['relevance']} | {i['publisher']} | [{i['title']}]({i['url']}) |"
    lines = [
        "## Upshot build", "",
        f"**Feeds:** {feeds} fetched, {feeds_failed} failed · **New stories:** {len(new)} · **Scored:** {len(scored)}"
        f" ({len(new) - len(scored)} failed, retried next run) · **Kept:** {len(kept)} · **Dropped as repeats:** {len(repeated)}", "",
    ]
    if kept:
        lines += ["### Kept", "", "| Category | Score | Source | Story |", "|---|---|---|---|", *(row(r, i) for i, r in kept), ""]
    if repeated:
        lines += ["### Dropped as repeats", "", *(f"- {i['publisher']}: {i['title']}" for i in repeated), ""]
    if near:
        lines += ["### One point under the bar", "", "| Category | Score | Source | Story |", "|---|---|---|---|", *(row(r, i) for r, i in near), ""]
    if health:
        lines += ["## Feed health", "", health, ""]
    return "\n".join(lines) + "\n"


def write_summary(*args):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(run_summary(*args))


def update_feed_health(health, results, today):
    """health: {feed_url: first_failure_date}. Returns feeds dead for DEAD_AFTER_DAYS+."""
    for url, ok in results.items():
        if ok:
            health.pop(url, None)
        else:
            health.setdefault(url, today.isoformat())
    limit = (today - timedelta(days=DEAD_AFTER_DAYS)).isoformat()
    return sorted(u for u, since in health.items() if since <= limit)


def silent_feeds(fetched, today):
    """Feeds that load but have stopped saying anything usable: no entries, no readable dates, or no recent post."""
    out = {}
    for url, res in fetched.items():
        if res is None:
            continue
        dated = [t for e in res[1] if (t := entry_time(e))]
        if not res[1]:
            out[url] = "no entries"
        elif not dated:
            out[url] = "entries have no readable dates, so every story is skipped"
        elif (newest := max(dated).date()) < today - timedelta(days=SILENT_AFTER_DAYS):
            out[url] = f"last post {newest.isoformat()}"
    return out


def feed_links(page_html, base):
    """Feeds a page advertises with <link rel="alternate" type="application/rss+xml"> (or atom)."""
    found = []
    for tag in re.findall(r"<link\b[^>]*>", page_html, re.I):
        kind = re.search(r'type=["\']application/(rss|atom)\+xml', tag, re.I)
        href = re.search(r'href=["\']([^"\']+)', tag, re.I)
        if kind and href and "alternate" in tag.lower():
            found.append(urllib.parse.urljoin(base, html.unescape(href[1])))
    return list(dict.fromkeys(found))


def discover_feeds(site):
    try:
        req = urllib.request.Request(site, headers={"User-Agent": ICON_UA})
        page = urllib.request.urlopen(req, timeout=10).read(400_000).decode("utf-8", "replace")
    except Exception:
        return []
    return feed_links(page, site)


def feed_health_report(names, dead, silent, moved, suggestions):
    """Markdown for the Feed health issue and the run summary; empty when every feed is fine."""
    line = lambda u, why: f"- **{names.get(u, u)}** `{u}`: {why}" + "".join(f"\n  - maybe `{s}`" for s in suggestions.get(u, []))
    out = []
    if dead:
        out += [f"### Failing for {DEAD_AFTER_DAYS}+ days", "", *(line(u, "every fetch errors") for u in dead), ""]
    if silent:
        out += ["### Loading, but silent", "", *(line(u, why) for u, why in sorted(silent.items())), ""]
    if moved:
        out += ["### Moved (permanent redirect)", "", *(f"- **{names.get(u, u)}** `{u}` → `{to}`" for u, to in sorted(moved.items())), ""]
    if not out:
        return ""
    return "Fix these in `feeds.opml`. This issue updates every build and closes itself once all feeds are healthy.\n\n" + "\n".join(out)


def main():
    today = now().astimezone(SITE_TZ).date()
    state = json.loads(STATE.read_text()) if STATE.exists() else {"seen": {}, "failing_since": {}}
    data_path = SITE / "data.json"
    data = json.loads(data_path.read_text()) if data_path.exists() else {"items": [], "weekly": None}
    published = {id(i) for i in data["items"]}  # on the site already: these never give up their place
    seen = state["seen"]
    feeds = read_opml(ROOT / "feeds.opml")

    def safe_fetch(feed):
        try:
            return feed[1], fetch(feed)
        except Exception as e:
            print(f"::warning::feed failed: {feed[1]}: {e}")
            return feed[1], None

    with ThreadPoolExecutor(12) as ex:
        fetched = dict(ex.map(safe_fetch, feeds))
    dead = update_feed_health(state["failing_since"], {u: r is not None for u, r in fetched.items()}, today)
    # Feeds removed from the OPML stop being tracked.
    state["failing_since"] = {u: d for u, d in state["failing_since"].items() if u in fetched}

    cutoff = now() - timedelta(days=FRESH_DAYS)
    new, urls = [], set()
    for res in fetched.values():
        if res:
            for c in candidates(*res, seen, cutoff):
                if c["url"] not in urls:
                    urls.add(c["url"])
                    new.append(c)
    print(f"{len(feeds)} feeds, {sum(r is None for r in fetched.values())} failed, {len(new)} new items")

    week_ago = (today - timedelta(days=DEDUPE_DAYS)).isoformat()
    recent = [i["title"] for i in data["items"] if i["date"] >= week_ago]
    scores = score_each(new)
    failed = sum(1 for r in scores.values() if r is None)
    passing = []
    for item in new:
        r = scores.get(item["url"])
        if not r:  # left unseen, so the next run retries it
            continue
        seen[item["url"]] = item["date"]
        if r["relevance"] >= MIN_RELEVANCE.get(r["category"], 8):
            passing.append((item | {"summary": r["summary"]}, r))

    kept, repeated = [], []
    for n0 in range(0, len(passing), BATCH):
        chunk = passing[n0:n0 + BATCH]
        try:
            dups = find_repeats([i for i, _ in chunk], recent)
        except Exception as e:  # unsee them so the next run scores and checks them again
            print(f"::warning::repeat check failed: {e}")
            for item, _ in chunk:
                seen.pop(item["url"], None)
            continue
        recent_titles, covered = {norm(t) for t in recent}, set()
        for n, (item, r) in enumerate(chunk):
            dup_of = dups.get(item["url"])
            repeat = repeats(dup_of, n, covered, recent_titles)
            covered.add(n)
            if repeat:
                target = chunk[int(dup_of)][0]["title"] if str(dup_of).strip().isdigit() else dup_of
                if upgrade_source(data["items"], target, item, r):
                    kept.append((item, r))
                    recent.append(item["title"])
                else:
                    repeated.append(item)
                continue
            kept.append((item, r))
            recent.append(item["title"])
            data["items"].append({k: item[k] for k in ("date", "title", "url", "publisher")}
                                 | {"category": r["category"], "summary": r["summary"], "relevance": r["relevance"],
                                    "added": now().isoformat(timespec="seconds")})  # drives "new since last visit"

    keep = (today - timedelta(days=KEEP_DAYS)).isoformat()
    data["items"] = cap_per_day([i for i in data["items"] if i["date"] >= keep], published)
    on_site = {i["url"] for i in data["items"]}
    kept = [(i, r) for i, r in kept if i["url"] in on_site]
    state["seen"] = {u: d for u, d in seen.items() if d >= keep}

    weekly = data.get("weekly")
    if not weekly or weekly["selected_on"] != today.isoformat():
        try:
            data["weekly"] = pick_weekly(data["items"], today) or weekly
        except Exception as e:
            print(f"::warning::weekly pick failed: {e}")

    texts = {}
    reader_error = add_reading_times(data["items"], feed_minutes(fetched), full_text_feeds(fetched), texts)
    print(f"TL;DRs written: {add_tldrs(data['items'], texts)}")
    data["generated_at"] = now().isoformat(timespec="seconds")
    SITE.mkdir(exist_ok=True)
    data["tz"] = SITE_TZ.key
    data["icons"] = fetch_icons({i["publisher"] for i in data["items"]} | set(SITE_LINKS))
    data["iconArt"] = {s: art for s in data["icons"] if (art := icon_art(ICONS / f"{s}.png"))}
    data_path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    (SITE / "rss.xml").write_text(rss(data["items"]))
    write_og(data, today)
    STATE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
    names = {u: t for t, u in feeds}
    silent = silent_feeds(fetched, today)
    with ThreadPoolExecutor(8) as ex:  # rare: only feeds already in trouble
        sites = {u: SITE_LINKS.get(names[u]) or urllib.parse.urljoin(u, "/") for u in [*dead, *silent]}
        suggestions = dict(zip(sites, ex.map(lambda u: [f for f in discover_feeds(sites[u]) if f != u], sites)))
    health = feed_health_report(names, dead, silent, {u: m for u, m in MOVED.items() if u in names}, suggestions)
    (ROOT / "feed-health.md").write_text(health)

    write_summary(len(feeds), sum(r is None for r in fetched.values()), new, scores, kept, repeated, health)

    if new and failed == len(new):
        sys.exit("every scoring call failed; check CLAUDE_CODE_OAUTH_TOKEN and the Claude Code CLI")
    if reader_error:
        sys.exit(f"couldn't update the reader's articles: {reader_error}")


if __name__ == "__main__":
    main()
