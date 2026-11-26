"""Whole builds: build.main() over scripted feeds, a scripted model, CISA's catalog and the reader's extract step, checked
against the rules in docs/architecture/pipeline.md. test_build.py proves each rule alone; this proves main() wires them
together. It runs before every hourly build (.github/workflows/build.yml), so it stays offline and deterministic."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from PIL import Image

import build
from test_build import fake_extract

REPO = Path(__file__).parent
NOW = datetime(2026, 11, 17, 15, 0, tzinfo=timezone.utc)  # 10:00 in New York, the default SITE_TZ
DAY = timedelta(days=1)


def entry(url, title, hours_ago=2, excerpt="", when=None):
    """A feed entry as feedparser gives it."""
    e = {"link": url, "title": title, "summary": excerpt or f"{title}."}
    if hours_ago is not None:
        e["published_parsed"] = (when or NOW - timedelta(hours=hours_ago)).timetuple()
    return e


def score(category, relevance, exploited=False, kind="flaw", evidence="", fix="unknown", fix_evidence=""):
    """What the model returns for one story."""
    return {"category": category, "relevance": relevance, "summary": "It happened.", "exploited": exploited, "kind": kind,
            "evidence": evidence, "fix": fix, "fix_evidence": fix_evidence}


class Sandbox:
    """build.py pointed at a temporary directory, with the network, the clock, Node and the model scripted."""

    def __init__(self, tmp_path, monkeypatch):
        self.root, self.site = tmp_path, tmp_path / "site"
        self.site.mkdir()
        (self.site / "index.html").write_text('<head><meta property="og:image" content="https://upshot.me/og.png"></head>\n')
        (tmp_path / "fonts").symlink_to(REPO / "fonts")  # write_og draws the share image for real
        for name, path in {"ROOT": tmp_path, "SITE": self.site, "STATE": tmp_path / "state.json",
                           "ICONS": self.site / "icons", "NOT_EXPLOITED": tmp_path / "not-exploited.txt"}.items():
            monkeypatch.setattr(build, name, path)
        monkeypatch.setattr(build, "SITE_LINKS", {})
        monkeypatch.setattr(build, "MOVED", {})
        monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary.md"))
        self.now = NOW
        monkeypatch.setattr(build, "now", lambda: self.now)
        self.feeds = {}    # publisher -> [entries], or an exception to raise
        self.scores = {}   # title -> score(), or an exception
        self.repeats = {}  # title -> the title it repeats (a headline on the site, or an earlier story in its batch)
        self.repeat_error = None
        self.weekly_error = None
        self.upshot_fix = {"fix": "unknown", "fix_evidence": ""}
        self.kev = {}
        self.extract = {"words": {}, "texts": {}, "error": None}
        self.scored = []   # the title of every scoring call
        monkeypatch.setattr(build, "fetch", self.fetch)
        monkeypatch.setattr(build, "llm", self.llm)
        monkeypatch.setattr(build, "fetch_kev", lambda: dict(self.kev))
        monkeypatch.setattr(build, "fetch_icon", lambda site: Image.new("RGBA", (64, 64), (200, 40, 40, 255)))
        monkeypatch.setattr(build, "discover_feeds", lambda site: [])
        fake_extract(monkeypatch, self.extract)

    def url(self, publisher):
        return f"https://{publisher.lower().replace(' ', '')}.test/feed.xml"

    def fetch(self, feed):
        title, url = feed
        got = self.feeds[title]
        if isinstance(got, Exception):
            raise got
        build.SITE_LINKS[title] = f"https://{title.lower().replace(' ', '')}.test/"
        return title, got

    def llm(self, system, user, schema, whole=False, model=None):
        payload = json.loads(user)
        if system == build.CLASSIFY_PROMPT:
            assert len(payload) == 1, "each story is scored alone"
            self.scored.append(payload[0]["title"])
            got = self.scores[payload[0]["title"]]
            if isinstance(got, Exception):
                raise got
            return [got | {"id": 0}]
        if system == build.REPEATS_PROMPT:
            if self.repeat_error:
                raise self.repeat_error
            ids = {i["title"]: i["id"] for i in payload["items"]}
            out = []
            for i in payload["items"]:
                target = self.repeats.get(i["title"])
                earlier = target in ids and ids[target] < i["id"]
                out.append({"id": i["id"], "duplicate_of": str(ids[target]) if earlier else target})
            return out
        if system == build.WEEKLY_PROMPT:
            if self.weekly_error:
                raise self.weekly_error
            ranked = sorted(payload, key=lambda i: ("remedy" not in i, i["id"]))  # flagged flaws first
            return [{"id": i["id"], "why": "Patch it now."} for i in ranked]
        if system.startswith(build.TLDR_PROMPT):
            bullets = ["Something happened to a widely used product.", "Teams running it should update now."]
            return {"bullets": bullets, "fix": "unknown", "fix_evidence": ""} if whole else bullets
        if system == build.UPSHOT_FIX_PROMPT:
            return dict(self.upshot_fix)
        raise AssertionError(f"unexpected prompt: {system[:60]}")

    def seed(self, items=(), seen=None, weekly=None):
        (self.site / "data.json").write_text(json.dumps({"items": list(items), "weekly": weekly}))
        (self.root / "state.json").write_text(json.dumps({"seen": seen or {}, "failing_since": {}}))

    def run(self):
        opml = "".join(f'<outline type="rss" text="{t}" xmlUrl="{self.url(t)}"/>' for t in self.feeds)
        (self.root / "feeds.opml").write_text(f'<?xml version="1.0"?><opml version="2.0"><body>{opml}</body></opml>\n')
        self.scored.clear()
        build.main()
        return json.loads((self.site / "data.json").read_text()), json.loads((self.root / "state.json").read_text())


def story(title, publisher, date, category="ai", relevance=8, **extra):
    """A story already on the site."""
    return {"date": date.isoformat(), "published": f"{date.isoformat()}T12:00:00+00:00", "title": title,
            "url": f"https://{publisher.lower().replace(' ', '')}.test/{title.lower().replace(' ', '-')}",
            "publisher": publisher, "cves": [], "category": category, "summary": f"{title}.", "relevance": relevance,
            "added": f"{date.isoformat()}T12:00:00+00:00", **extra}


def check_contract(data):
    """The shape site/app.js reads. Run on the build's output, never on the committed data.json, so a quirk in live data
    can't block an hourly build."""
    assert set(data) >= {"items", "weekly", "generated_at", "tz", "icons", "iconArt", "audio"}
    datetime.fromisoformat(data["generated_at"])
    assert data["audio"] is None or data["audio"].startswith("https://") and not data["audio"].endswith("/")
    assert isinstance(data["icons"], list) and isinstance(data["iconArt"], dict)
    urls = [i["url"] for i in data["items"]]
    assert len(urls) == len(set(urls)), "a story appears twice"
    for i in data["items"]:
        for k in ("url", "title", "publisher", "date", "published", "added", "category", "summary"):
            assert isinstance(i.get(k), str) and i[k], f"{k} missing on {i.get('url')}"
        assert i["url"].startswith(("https://", "http://"))
        assert i["category"] in build.CATEGORIES
        for k in ("published", "added"):
            datetime.fromisoformat(i[k])
        assert isinstance(i.get("minutes", 0), int)
        assert isinstance(i.get("tldr", []), list)
        if x := i.get("exploited"):
            assert x["kind"] in ("flaw", "compromise") and isinstance(x["kev"], list)
            datetime.fromisoformat(x["at"])
            assert x.get("fix") in (None, "patch", "mitigation", "none")
    if w := data["weekly"]:
        assert w["window_start"] <= w["window_end"]
        assert all(p["url"] in urls and p["why"] for p in w["items"]), "an essential points at a story not on the site"


@pytest.fixture
def box(tmp_path, monkeypatch):
    return Sandbox(tmp_path, monkeypatch)


def by_title(data):
    return {i["title"]: i for i in data["items"]}


def test_two_builds_follow_every_pipeline_rule(box):
    today = NOW.astimezone(build.SITE_TZ).date()
    v, n = "Vendor Blog", "BleepingComputer"  # an original source, and a news outlet (NEWS_SOURCES)
    full_day = today - 2 * DAY
    box.seed(
        items=[story("Ancient story", v, today - 91 * DAY),
               story("Acme ships Widget 2", n, today - DAY),  # a news outlet's copy; the original arrives below
               story("Router flaw CVE-2026-1111 disclosed", v, today - DAY, category="security", cves=["CVE-2026-1111"]),
               story("Wrongly flagged", v, today - DAY, category="security",
                     exploited={"kev": [], "at": "2026-11-16T12:00:00+00:00", "kind": "flaw", "quote": "attackers exploited it"}),
               *[story(f"Busy day {k}", v, full_day, relevance=7) for k in range(build.DAILY_MAX)]],
        seen={"https://vendorblog.test/already-seen": today.isoformat(), "https://vendorblog.test/long-ago": (today - 91 * DAY).isoformat()})
    (box.root / "not-exploited.txt").write_text("https://vendorblog.test/wrongly-flagged  # a trend piece\n")
    u = lambda slug: f"https://vendorblog.test/{slug}"
    box.feeds = {
        v: [entry(u("widget-2"), "Acme ships Widget 2"),
            entry(u("at-bar"), "Cluster scheduler at the bar"),
            entry(u("below-bar"), "Minor linter release"),
            entry(u("zero-day"), "Zero-day in Gizmo, no patch yet", excerpt="Attackers are exploiting Gizmo; there is no patch yet."),
            entry(u("patched"), "Gadget flaw exploited", excerpt="Attackers exploited Gadget; the vendor released a patch."),
            entry(u("fails"), "Scoring fails here"),
            entry(u("fake-claim"), "Security trends report", excerpt="A report on the year in security."),
            entry(u("kev"), "Widget flaw CVE-2026-2222 patched", excerpt="Fixed in version 4.2."),
            entry(u("supply-chain"), "Malicious pkg releases", excerpt="Malicious versions of pkg were published by a compromised account."),
            entry(u("newcomer"), "Busy day newcomer", when=datetime.combine(full_day, datetime.min.time(), timezone.utc) + timedelta(hours=17)),
            entry(u("old"), "Ten days old", hours_ago=240),
            entry(u("undated"), "Undated story", hours_ago=None),
            entry("javascript:alert(1)", "Script link"),
            entry(u("already-seen"), "Already seen")],
        n: [entry("https://bleepingcomputer.test/gizmo", "Gizmo zero-day under attack, CVE-2026-3333", excerpt="Gizmo is under attack.")],
        "Broken Feed": OSError("connection reset"),
    }
    box.scores = {
        "Acme ships Widget 2": score("ai", 8),
        "Cluster scheduler at the bar": score("infrastructure", build.MIN_RELEVANCE["infrastructure"]),
        "Minor linter release": score("engineering", build.MIN_RELEVANCE["engineering"] - 1),
        "Zero-day in Gizmo, no patch yet": score("security", 7, exploited=True, evidence="Attackers are exploiting Gizmo",
                                                 fix="none", fix_evidence="there is no patch yet"),
        "Gadget flaw exploited": score("security", 7, exploited=True, evidence="Attackers exploited Gadget",
                                       fix="patch", fix_evidence="the vendor released a patch"),
        "Scoring fails here": RuntimeError("402"),
        "Security trends report": score("security", 8, exploited=True, evidence="attackers are actively exploiting this"),
        "Widget flaw CVE-2026-2222 patched": score("security", 8),
        "Malicious pkg releases": score("security", 8, exploited=True, kind="compromise",
                                        evidence="published by a compromised account"),
        "Busy day newcomer": score("ai", 10),
        "Gizmo zero-day under attack, CVE-2026-3333": score("security", 8, exploited=True, evidence="Gizmo is under attack"),
    }
    box.repeats = {"Acme ships Widget 2": "Acme ships Widget 2",  # the outlet's headline on the site
                   "Gizmo zero-day under attack, CVE-2026-3333": "Zero-day in Gizmo, no patch yet"}  # earlier in the batch
    box.kev = {"CVE-2026-2222": "2026-11-16"}
    box.extract["words"] = {u("at-bar"): 2300, u("kev"): 0}
    box.extract["texts"] = {u("at-bar"): "The scheduler shipped.", u("supply-chain"): "Malicious versions were published."}

    data, state = box.run()
    check_contract(data)
    s, seen = by_title(data), state["seen"]

    # Fetch: a broken feed is skipped, and recorded.
    assert state["failing_since"] == {box.url("Broken Feed"): today.isoformat()}
    # Filter: too old, undated, unsafe and already-seen entries are never scored.
    scored = box.scored
    assert not {"Ten days old", "Undated story", "Script link", "Already seen"} & set(scored)
    # Score: one call per new story, each alone; a failed call is tried three times.
    assert len(set(scored)) == 11
    assert {t: scored.count(t) for t in scored if scored.count(t) > 1} == {"Scoring fails here": 3}
    # Bars: at the bar, and an unpatched exploited flaw a point under it, publish; below it, and a patched flaw a point
    # under it, don't, but are still seen.
    assert "Cluster scheduler at the bar" in s and "Zero-day in Gizmo, no patch yet" in s
    assert "Minor linter release" not in s and "Gadget flaw exploited" not in s
    assert u("below-bar") in seen and u("patched") in seen
    # A failed score is left unseen, so the next build retries it.
    assert "Scoring fails here" not in s and u("fails") not in seen
    # Repeats: the original source replaces the outlet's copy in place; a repeat in the batch is dropped and hands its
    # CVE and flag to the copy on the site.
    widget = s["Acme ships Widget 2"]
    assert widget["url"] == u("widget-2") and widget["publisher"] == v
    assert "https://bleepingcomputer.test/gizmo" not in {i["url"] for i in data["items"]}
    assert "CVE-2026-3333" in s["Zero-day in Gizmo, no patch yet"]["cves"]
    # Flags: a checked claim, a CISA listing and a compromise are flagged; a claim whose quote isn't in the story isn't;
    # a retracted story loses its flag.
    gizmo = s["Zero-day in Gizmo, no patch yet"]["exploited"]
    assert gizmo["kind"] == "flaw" and gizmo["fix"] == "none" and gizmo["quote"] == "Attackers are exploiting Gizmo"
    assert s["Widget flaw CVE-2026-2222 patched"]["exploited"]["kev"] == ["CVE-2026-2222"]
    assert s["Malicious pkg releases"]["exploited"]["kind"] == "compromise"
    assert "exploited" not in s["Security trends report"]
    assert "exploited" not in s["Wrongly flagged"]
    # Pruning and the cap: past KEEP_DAYS goes, from the site and from seen; a full day keeps every story already on the
    # site, so a new one that day doesn't fit.
    assert "Ancient story" not in s and "https://vendorblog.test/long-ago" not in seen
    assert all(f"Busy day {k}" in s for k in range(build.DAILY_MAX)) and "Busy day newcomer" not in s
    assert u("newcomer") in seen
    # Essentials: at most five, three per topic, each with what to do; "patch" is never the advice for an unpatched flaw.
    w = data["weekly"]
    assert w["window_end"] == today.isoformat() and 0 < len(w["items"]) <= build.WEEKLY_PICKS
    cats = [{i["url"]: i["category"] for i in data["items"]}[p["url"]] for p in w["items"]]
    assert max(cats.count(c) for c in set(cats)) <= build.WEEKLY_PER_CATEGORY
    picks = {p["url"]: p["why"] for p in w["items"]}
    assert picks[u("zero-day")] == build.NO_PATCH_WHY["none"]
    # Reader: minutes from the stored article (0 when blocked), and an upshot written from the article's text.
    assert s["Cluster scheduler at the bar"]["minutes"] == 10 and s["Widget flaw CVE-2026-2222 patched"]["minutes"] == 0
    assert len(s["Cluster scheduler at the bar"]["tldr"]) == 2 and "tldr" not in s["Busy day 0"]  # no text, no upshot
    # Publish: every output is written; RSS carries the labels; the share image's URL carries its hash.
    rss = (box.site / "rss.xml").read_text()
    assert "<title>Exploited, no patch yet: Zero-day in Gizmo, no patch yet</title>" in rss
    assert "<title>Compromised: Malicious pkg releases</title>" in rss
    assert "<title>Exploited: Widget flaw CVE-2026-2222 patched</title>" in rss
    assert (box.site / "og.png").stat().st_size > 0 and "og.png?v=" in (box.site / "index.html").read_text()
    assert (box.root / "feed-health.md").exists() and (box.root / "reader-error.txt").read_text() == ""
    assert "**Kept:**" in (box.root / "summary.md").read_text()
    published_once = {i["url"] for i in data["items"]}

    # Build 2, a day later: the failed story is retried, nothing seen is scored again, a later CISA listing flags a story
    # already on the site, and nothing published goes away.
    box.now = NOW + DAY
    box.scores["Scoring fails here"] = score("ai", 9)
    box.kev["CVE-2026-1111"] = "2026-11-18"
    # A later story says Gizmo's patch is out: the flagged story on the site moves up to it, though this one doesn't publish.
    box.feeds[v].append(entry(u("gizmo-fix"), "Gizmo fixes CVE-2026-3333", excerpt="Gizmo released version 2.1, which patches it."))
    box.scores["Gizmo fixes CVE-2026-3333"] = score("security", 5, fix="patch", fix_evidence="released version 2.1")
    # The newly listed router flaw gets its remedy read from its upshot, once.
    box.extract["texts"] = {"https://vendorblog.test/router-flaw-cve-2026-1111-disclosed": "Routers need the new update."}
    box.upshot_fix = {"fix": "patch", "fix_evidence": "should update now"}
    data, state = box.run()
    check_contract(data)
    s = by_title(data)
    assert sorted(box.scored) == ["Gizmo fixes CVE-2026-3333", "Scoring fails here"]
    assert "Gizmo fixes CVE-2026-3333" not in s and s["Zero-day in Gizmo, no patch yet"]["exploited"]["fix"] == "patch"
    assert "Scoring fails here" in s and u("fails") in state["seen"]
    router = s["Router flaw CVE-2026-1111 disclosed"]["exploited"]
    assert router["kev"] == ["CVE-2026-1111"] and router["fix"] == "patch" and router["fix_read"]
    assert published_once <= {i["url"] for i in data["items"]}
    assert data["weekly"]["window_end"] == (today + DAY).isoformat()


def test_a_failed_repeat_check_leaves_its_stories_unseen(box):
    box.seed()
    box.feeds = {"Vendor Blog": [entry("https://vendorblog.test/a", "Story A")]}
    box.scores = {"Story A": score("ai", 9)}
    box.repeat_error = RuntimeError("overloaded")
    data, state = box.run()
    check_contract(data)
    assert data["items"] == [] and state["seen"] == {}, "unseen, so the next build scores and checks it again"


def test_a_feed_whose_entries_cant_be_read_is_skipped_alone(box):
    today = NOW.astimezone(build.SITE_TZ).date()
    box.seed()
    box.feeds = {"Odd Feed": [{"link": "https://oddfeed.test/a", "title": 5, "published_parsed": NOW.timetuple()},  # not text: candidates raises
                              entry("https://oddfeed.test/b", "Story B")],
                 "Vendor Blog": [entry("http://[bad/x", "Bad link", excerpt="<p>" + "word " * 690 + "</p>"),
                                 {**entry("https://vendorblog.test/year-0", "Year 0"), "published_parsed": (-1, 11, 30, 0, 0, 0, 0, 0, 0)},
                                 entry("https://vendorblog.test/a", "Story A")]}
    box.scores = {"Story A": score("ai", 9)}
    data, state = box.run()
    check_contract(data)
    assert [i["title"] for i in data["items"]] == ["Story A"]  # the entries around the unreadable ones still publish
    assert state["failing_since"] == {box.url("Odd Feed"): today.isoformat()}  # recorded like a feed that didn't load
    assert "1 failed" in (box.root / "summary.md").read_text()


def test_every_scoring_call_failing_stops_the_build(box):
    box.seed()
    box.feeds = {"Vendor Blog": [entry("https://vendorblog.test/a", "Story A")]}
    box.scores = {"Story A": RuntimeError("401")}
    with pytest.raises(SystemExit, match="every scoring call failed"):
        box.run()


def test_a_reader_outage_still_publishes_and_is_reported(box):
    box.seed()
    box.feeds = {"Vendor Blog": [entry("https://vendorblog.test/a", "Story A")]}
    box.scores = {"Story A": score("ai", 9)}
    box.extract["error"] = "KV write failed: 503"
    data, _ = box.run()
    check_contract(data)
    assert [i["title"] for i in data["items"]] == ["Story A"]
    assert "KV write failed: 503" in (box.root / "reader-error.txt").read_text()


def test_the_page_learns_where_listens_audio_is(box, monkeypatch):
    box.seed()
    box.feeds = {"Vendor Blog": []}
    data, _ = box.run()
    assert data["audio"] is None, "no AUDIO_URL: no audio, so no Listen"
    monkeypatch.setattr(build, "AUDIO_URL", "https://audio.example.test")
    data, _ = box.run()
    check_contract(data)
    assert data["audio"] == "https://audio.example.test"


def test_a_failed_essentials_pick_keeps_last_weeks(box):
    old = {"window_start": "2026-11-10", "window_end": "2026-11-16", "items": [{"url": "https://vendorblog.test/a", "why": "Read it."}]}
    box.seed(items=[story("A", "Vendor Blog", NOW.date() - DAY)], weekly=old)
    box.feeds = {"Vendor Blog": []}
    box.weekly_error = RuntimeError("overloaded")
    data, _ = box.run()
    check_contract(data)
    assert data["weekly"] == old
