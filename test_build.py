import json
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

import pytest

import build


def test_normalize_url_strips_tracking():
    assert build.normalize_url("https://Example.com/a?utm_source=x&id=1&ref=hn#top") == "https://example.com/a?id=1"


def test_opml_parses():
    feeds = build.read_opml(build.ROOT / "feeds.opml")
    assert feeds and all(url.startswith("https://") for _, url in feeds)


def test_candidates_filters_and_caps():
    now = datetime.now(timezone.utc)
    t = lambda d: (now - timedelta(days=d)).timetuple()
    entries = [{"link": f"https://x.test/{n}?utm_medium=rss", "title": f"T{n}", "published_parsed": t(0)} for n in range(15)]
    entries += [
        {"link": "https://x.test/old", "title": "old", "published_parsed": t(10)},
        {"link": "https://x.test/undated", "title": "undated"},
        {"link": "javascript:alert(1)", "title": "xss", "published_parsed": t(0)},
        {"link": "https://x.test/seen", "title": "seen", "published_parsed": t(0)},
    ]
    out = build.candidates("X", entries, {"https://x.test/seen": "2026-01-01"}, now - timedelta(days=3))
    urls = {c["url"] for c in out}
    assert len(out) == build.PER_FEED
    assert not urls & {"https://x.test/old", "https://x.test/undated", "javascript:alert(1)", "https://x.test/seen"}
    assert all("utm_" not in u for u in urls)


def test_feed_health_reports_only_long_failures():
    today = date(2026, 11, 20)
    health = {"https://a": "2026-11-01", "https://b": "2026-11-19", "https://c": "2026-10-01"}
    dead = build.update_feed_health(health, {"https://a": False, "https://b": False, "https://c": True, "https://d": False}, today)
    assert dead == ["https://a"]
    assert "https://c" not in health and health["https://d"] == "2026-11-20"


def test_rss_dates_use_when_the_story_was_added():
    xml = build.rss([{"date": "2026-11-05", "added": "2026-11-05T14:30:00+00:00", "title": "T", "url": "https://x.test/a", "summary": "S", "category": "ai"},
                     {"date": "2026-11-04", "title": "Old", "url": "https://x.test/b", "summary": "S", "category": "ai"}])
    dates = [e.text for e in ET.fromstring(xml).iter("pubDate")]
    assert dates == ["Thu, 05 Nov 2026 14:30:00 +0000", "Wed, 04 Nov 2026 00:00:00 +0000"]


def test_og_image_is_a_preview_card_with_or_without_picks():
    from datetime import date
    item = {"url": "https://x.test/a", "title": "A headline " * 20, "publisher": "P", "category": "security"}
    data = {"items": [item], "weekly": {"items": [{"url": item["url"], "why": "Do the thing. " * 20}]}}
    for d in (data, {"items": []}):
        img = build.og_image(d, date(2026, 11, 7))
        assert img.size == (1200, 630)
    a, b = (build.og_image(data, date(2026, 11, 7)).tobytes() for _ in range(2))
    assert a == b  # the same inputs draw the same card, so an unchanged day commits nothing


def test_icon_candidates_prefer_big_touch_icons_and_skip_svg():
    page = """<link rel="icon" href="/favicon-16.png" sizes="16x16"><link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="mask-icon" href="/mask.png"><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/big.png" sizes="96x96">"""
    got = build.icon_candidates(page, "https://x.test/blog/")
    assert got == ["https://x.test/touch.png", "https://x.test/big.png", "https://x.test/favicon-16.png",
                   "https://x.test/apple-touch-icon.png", "https://x.test/favicon.ico"]
    assert build.icon_candidates("", "https://x.test/") == ["https://x.test/apple-touch-icon.png", "https://x.test/favicon.ico"]


def test_icon_slugs_match_the_test_fixtures_rule():
    assert build.slug("Hacker News 300+") == "hacker-news-300"
    assert build.slug("OWASP Gen AI Security Project") == "owasp-gen-ai-security-project"
    assert build.slug("Anthropic (community feed)") == "anthropic-community-feed"


def test_stories_are_dated_in_the_site_time_zone():
    import time
    late = {"link": "https://x.test/a", "title": "T", "published_parsed": time.strptime("2026-11-07 01:00", "%Y-%m-%d %H:%M")}  # 8pm on the 6th, Eastern
    (item,) = build.candidates("P", [late], {}, datetime(2026, 11, 1, tzinfo=timezone.utc))
    assert item["date"] == "2026-11-06"


def test_icon_art_flags_only_single_colour_artwork_on_transparency(tmp_path):
    from PIL import Image, ImageDraw
    def icon(name, fill, bg=(0, 0, 0, 0)):
        img = Image.new("RGBA", (64, 64), bg)
        ImageDraw.Draw(img).ellipse((12, 12, 52, 52), fill=fill)
        img.save(tmp_path / name)
        return tmp_path / name
    assert build.icon_art(icon("octocat.png", (20, 20, 20, 255))) == "dark"
    assert build.icon_art(icon("white.png", (250, 250, 250, 255))) == "light"
    assert build.icon_art(icon("red.png", (150, 20, 30, 255))) is None            # coloured: left alone
    assert build.icon_art(icon("tile.png", (20, 20, 20, 255), (255, 255, 255, 255))) is None  # on its own tile


def test_verify_tldr_drops_bullets_with_figures_the_article_lacks():
    text = "SonicWall fixed CVE-2026-19868 (CVSS 7.1). Upgrade to SonicOS 7.3.4-7013 by November 20, 2026."
    good = ["SonicWall fixed CVE-2026-19868, rated CVSS 7.1.", "Upgrade to SonicOS 7.3.4-7013 by November 20."]
    assert build.verify_tldr(good + ["Also fixes CVE-2026-99999 in version 8.0."], text) == good  # invented figures go
    assert build.verify_tldr(["Patch now.", "Upgrade to 9.9.9."], text) == []  # under two left: none at all


def test_add_tldrs_writes_once_and_retries_failures(monkeypatch):
    calls = []
    def fake(system, user, schema):
        calls.append(json.loads(user)["title"])
        if "fail" in user:
            raise RuntimeError("boom")
        return ["It happened on 5 May.", "Patch to 2.1 now."]
    monkeypatch.setattr(build, "llm", fake)
    items = [{"url": "a", "title": "A"}, {"url": "b", "title": "fail"}, {"url": "c", "title": "C", "tldr": ["old"]}, {"url": "d", "title": "D"}]
    texts = {"a": "Released 5 May; upgrade to 2.1.", "b": "fail", "c": "x", "d": "nothing numeric here"}
    build.add_tldrs(items, texts)
    assert items[0]["tldr"] == ["It happened on 5 May.", "Patch to 2.1 now."]
    assert "tldr" not in items[1]           # failed: tried again next build
    assert items[2]["tldr"] == ["old"]      # written once, never redone
    assert items[3]["tldr"] == []           # figures not in the article: kept out, and not retried
    assert sorted(calls) == ["A", "D", "fail"]
    calls.clear()
    build.add_tldrs([{"url": str(n), "title": str(n)} for n in range(5)], {str(n): "5 May 2.1" for n in range(5)}, limit=2)
    assert len(calls) == 2


def test_rss_is_well_formed():
    xml = build.rss([{"date": "2026-11-05", "title": "A & B <c>", "url": "https://x.test/?a=1&b=2",
                      "category": "ai", "summary": "s"}])
    assert ET.fromstring(xml).find("channel/item/title").text == "A & B <c>"


def test_cap_per_day_keeps_most_relevant():
    items = [{"date": "2026-01-02", "category": "other", "relevance": n, "url": str(n)} for n in range(build.DAILY_MAX + 5)]
    items.append({"date": "2026-01-01", "category": "other", "relevance": 1, "url": "old"})
    out = build.cap_per_day(items)
    today = [i for i in out if i["date"] == "2026-01-02"]
    assert len(today) == build.DAILY_MAX and today[0]["relevance"] == build.DAILY_MAX + 4  # most relevant first
    assert out[-1]["url"] == "old"                                                          # newest day first


def test_cap_per_day_keeps_everything_that_cleared_the_bar():
    day = lambda cat, rel, url: {"date": "2026-11-06", "category": cat, "relevance": rel, "publisher": "P", "url": url}
    big = [day("security", 8, f"s{n}") for n in range(6)] + [day("architecture", 6, "a1"), day("architecture", 6, "a2")]
    assert len(build.cap_per_day(big)) == 8  # no per-category quota: a big security day shows as one


def test_cap_per_day_never_drops_a_published_story():
    day = lambda rel, url: {"date": "2026-11-08", "category": "other", "relevance": rel, "publisher": "P", "url": url}
    published = [day(5, f"p{n}") for n in range(build.DAILY_MAX)]
    out = [i["url"] for i in build.cap_per_day(published + [day(9, "late")], published={id(i) for i in published})]
    assert "late" not in out and len(out) == build.DAILY_MAX  # the daily max only ever trims new stories
    some = published[:3]
    out = [i["url"] for i in build.cap_per_day(some + [day(9, "late")], published={id(i) for i in some})]
    assert out[0] == "late" and len(out) == 4  # room left: it's added, and ranked first


def test_cap_per_day_ranks_by_score_then_original_source():
    day = lambda rel, pub, url: {"date": "2026-01-02", "category": "security", "relevance": rel, "publisher": pub, "url": url}
    out = build.cap_per_day([day(8, "The Hacker News", "news"), day(8, "Rapid7", "orig"), day(9, "BleepingComputer", "top")])
    assert [i["url"] for i in out] == ["top", "orig", "news"]


def test_upgrade_source_swaps_news_for_the_original():
    r = {"category": "security", "summary": "new summary", "relevance": 8}
    old = {"title": "Big Flaw", "url": "https://news.test/a", "publisher": "BleepingComputer", "relevance": 9, "date": "2026-01-01", "minutes": 2}
    item = {"title": "Our advisory", "url": "https://vendor.test/a", "publisher": "Rapid7"}
    assert build.upgrade_source([old], "big flaw", item, r)
    assert old["url"] == "https://vendor.test/a" and old["publisher"] == "Rapid7" and old["summary"] == "new summary"
    assert old["relevance"] == 9 and old["date"] == "2026-01-01" and "minutes" not in old  # keeps its place; time refetched
    assert not build.upgrade_source([old], "our advisory", {**item, "url": "x", "publisher": "Wiz"}, r)  # already original
    other = {"title": "Other", "url": "n", "publisher": "SecurityWeek"}
    assert not build.upgrade_source([other], "Other", {**item, "publisher": "The Record"}, r)            # news for news
    assert other["url"] == "n"


def test_scoring_never_sees_recent_headlines(monkeypatch):
    sent = {}
    monkeypatch.setattr(build, "llm", lambda system, user, schema: sent.update(payload=json.loads(user)) or
                        [{"id": 0, "category": "ai", "relevance": 8, "summary": "s"}])
    out = build.classify([{"url": "https://x.test/a", "title": "T", "publisher": "P", "excerpt": "E"}])
    assert sent["payload"] == [{"id": 0, "title": "T", "publisher": "P", "excerpt": "E"}]
    assert out["https://x.test/a"]["relevance"] == 8


def test_find_repeats_sends_recent_headlines(monkeypatch):
    sent = {}
    monkeypatch.setattr(build, "llm", lambda system, user, schema: sent.update(json.loads(user)) or
                        [{"id": 0, "duplicate_of": "Old headline"}])
    out = build.find_repeats([{"url": "https://x.test/a", "title": "T", "publisher": "P", "excerpt": "E", "summary": "S"}],
                             ["Old headline"])
    assert sent["recent"] == ["Old headline"] and sent["items"][0]["summary"] == "S"
    assert out == {"https://x.test/a": "Old headline"}


def test_repeats_always_leaves_one_copy():
    recent = {build.norm("OpenSSH flaw  lets attackers in")}
    assert build.repeats("openssh flaw lets attackers in", 0, set(), recent)  # quoted, case/space-insensitive
    assert not build.repeats("OpenSSH flaw", 0, set(), recent)              # misquote is ignored
    assert build.repeats("0", 3, {0}, set())                                # earlier, covered batch item
    assert not build.repeats("0", 3, set(), set())                          # earlier item not covered
    assert not build.repeats("3", 3, {3}, set())                            # points at itself
    assert not build.repeats("5", 3, {5}, set())                            # points forward
    assert not build.repeats(None, 3, set(), set())


def test_each_story_is_scored_alone(monkeypatch):
    batches = []
    def fake_classify(batch):
        batches.append(len(batch))
        return {batch[0]["url"]: {"category": "ai", "relevance": 8, "summary": "s"}}
    monkeypatch.setattr(build, "classify", fake_classify)
    items = [{"url": f"https://x.test/{n}", "title": "T", "publisher": "P", "excerpt": "E"} for n in range(5)]
    out = build.score_each(items)
    assert batches == [1] * 5 and set(out) == {i["url"] for i in items}


def test_score_each_reports_failures_as_none(monkeypatch):
    def boom(batch):
        raise RuntimeError("402")
    monkeypatch.setattr(build, "classify", boom)
    assert build.score_each([{"url": "https://x.test/a", "title": "T", "publisher": "P", "excerpt": "E"}]) == {"https://x.test/a": None}


def fake_extract(monkeypatch, out, returncode=0):
    calls = []
    def run(cmd, input, **kw):
        calls.append(json.loads(input))
        return build.subprocess.CompletedProcess(cmd, returncode, json.dumps(out), "")
    monkeypatch.setattr(build.subprocess, "run", run)
    return calls


def test_reading_times_come_from_the_extracted_articles(monkeypatch):
    calls = fake_extract(monkeypatch, {"words": {"https://x.test/long": 690, "https://x.test/blocked": 0, "https://x.test/done": 2000}})
    items = [{"url": "https://x.test/long", "publisher": "P"}, {"url": "https://x.test/blocked"}, {"url": "https://x.test/slow"}, {"url": "https://x.test/done", "minutes": 5}]
    assert build.add_reading_times(items, feeds={"P": "https://x.test/rss"}) is None
    assert [i.get("minutes") for i in items] == [3, 0, None, 5]  # no entry means try again; a known time stays
    assert calls[0]["feeds"] == {"P": "https://x.test/rss"}


def test_reading_times_prefer_whole_articles_in_feeds(monkeypatch):
    calls = fake_extract(monkeypatch, {"words": {"https://x.test/a": 200}})
    items = [{"url": "https://x.test/a", "minutes": 0}]
    build.add_reading_times(items, {"https://x.test/a": 7})
    assert items[0]["minutes"] == 7
    assert calls[0]["items"][0]["minutes"] == 7


def test_reading_times_report_when_the_store_cant_be_updated(monkeypatch):
    fake_extract(monkeypatch, {"words": {}, "error": "KV 403"})
    assert build.add_reading_times([{"url": "https://x.test/a"}]) == "KV 403"
    fake_extract(monkeypatch, {}, returncode=1)
    assert "exited 1" in build.add_reading_times([{"url": "https://x.test/a"}])


def test_feed_minutes_ignores_teasers():
    long = "<p>" + "word " * 690 + "</p>"
    fetched = {"f": ("Feed", [{"link": "https://x.test/full", "content": [{"value": long}]},
                              {"link": "https://x.test/summary", "summary": long},
                              {"link": "https://x.test/teaser", "summary": "word " * 25}]), "dead": None}
    assert build.feed_minutes(fetched) == {"https://x.test/full": 3, "https://x.test/summary": 3}


def test_full_text_feeds_lists_only_feeds_with_whole_articles():
    long = "word " * 400
    fetched = {"https://full.test/rss": ("Full", [{"link": "a", "summary": "short"}, {"link": "b", "content": [{"value": long}]}]),
               "https://teaser.test/rss": ("Teaser", [{"link": "c", "summary": "short"}]), "https://dead.test/rss": None}
    assert build.full_text_feeds(fetched) == {"Full": "https://full.test/rss"}


def test_run_summary_counts_and_near_misses():
    new = [{"url": f"https://x.test/{n}", "title": f"T{n}", "publisher": "P"} for n in range(4)]
    scores = {new[0]["url"]: {"category": "security", "relevance": 8, "summary": "s"},
              new[1]["url"]: {"category": "security", "relevance": 7, "summary": "s"},   # one under the Security bar
              new[2]["url"]: {"category": "regulation", "relevance": 5, "summary": "s"},
              new[3]["url"]: None}                                                        # scoring failed
    out = build.run_summary(45, 1, new, scores, [(new[0], scores[new[0]["url"]])], [], [])
    assert "45 fetched, 1 failed" in out and "**New stories:** 4" in out and "**Scored:** 3 (1 failed" in out
    assert "**Kept:** 1" in out and "[T0](https://x.test/0)" in out
    near = out.split("One point under the bar")[1]
    assert "T1" in near and "T2" not in near
    assert "Over the daily max" not in out
    over = build.run_summary(45, 1, new, scores, [], [], [], [(new[0], scores[new[0]["url"]])]).split("Over the daily max")[1]
    assert "[T0](https://x.test/0)" in over


def test_llm_reads_the_cli_and_refuses_another_model(monkeypatch):
    import types
    replies = []
    monkeypatch.setattr(build.subprocess, "run", lambda *a, **k: replies.pop(0))
    ok = {"structured_output": {"items": [{"id": 0}]}, "modelUsage": {build.MODEL: {}}}
    replies.append(types.SimpleNamespace(stdout=json.dumps(ok), stderr="", returncode=0))
    assert build.llm("system", "user", {}) == [{"id": 0}]

    swapped = dict(ok, modelUsage={"claude-other": {}})  # the CLI answered with a different model
    replies.append(types.SimpleNamespace(stdout=json.dumps(swapped), stderr="", returncode=0))
    with pytest.raises(RuntimeError, match="not " + build.MODEL):
        build.llm("system", "user", {})

    replies.append(types.SimpleNamespace(stdout="", stderr="Invalid API key", returncode=1))
    with pytest.raises(RuntimeError, match="Invalid API key"):
        build.llm("system", "user", {})


def test_entry_time_reads_dates_feedparser_cant():
    when = build.entry_time({"published": "Nov 05, 2026 00:00:00-0600"})
    assert when == datetime(2026, 11, 5, 6, 0, tzinfo=timezone.utc)
    assert build.entry_time({"published": "Nov 05, 2026"}) == datetime(2026, 11, 5, tzinfo=timezone.utc)
    assert build.entry_time({"published": "sometime soon"}) is None


def test_silent_feeds_flags_empty_undated_and_quiet_feeds():
    today = date(2026, 11, 20)
    t = lambda d: time.strptime(d, "%Y-%m-%d")
    fetched = {
        "https://ok": ("OK", [{"published_parsed": t("2026-11-01")}]),
        "https://quiet": ("Quiet", [{"published_parsed": t("2026-09-01")}, {"published_parsed": t("2026-08-01")}]),
        "https://undated": ("Undated", [{"title": "x"}]),
        "https://empty": ("Empty", []),
        "https://down": None,  # failing feeds are reported separately
    }
    silent = build.silent_feeds(fetched, today)
    assert set(silent) == {"https://quiet", "https://undated", "https://empty"}
    assert silent["https://quiet"] == "last post 2026-09-01"


def test_feed_links_finds_advertised_feeds():
    page = '''<link rel="alternate" type="application/rss+xml" href="/feed.xml">
              <link type="application/atom+xml" rel="alternate" href="https://x.test/atom?a=1&amp;b=2">
              <link rel="stylesheet" href="/s.css"><link rel="alternate" hreflang="de" href="/de/">'''
    assert build.feed_links(page, "https://x.test/blog/") == ["https://x.test/feed.xml", "https://x.test/atom?a=1&b=2"]


def test_feed_health_report_is_empty_when_all_is_well():
    assert build.feed_health_report({}, [], {}, {}, {}) == ""
    md = build.feed_health_report({"https://a": "A", "https://b": "B"}, ["https://a"], {"https://b": "last post 2026-09-01"},
                                  {"https://a": "https://a2"}, {"https://a": ["https://a/new.xml"]})
    assert "**A** `https://a`: every fetch errors\n  - maybe `https://a/new.xml`" in md
    assert "**B** `https://b`: last post 2026-09-01" in md and "`https://a` → `https://a2`" in md


def test_fetch_reports_only_permanent_redirects():
    import http.server, threading
    feed = b'<rss version="2.0"><channel><title>T</title><item><title>a</title><link>https://x.test/a</link></item></channel></rss>'

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            hops = {"/old": (301, "/new"), "/temp": (302, "/new"), "/chain": (301, "/temp")}
            if self.path in hops:
                self.send_response(hops[self.path][0])
                self.send_header("Location", hops[self.path][1])
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(feed)

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    build.MOVED.clear()
    try:
        for path in ("/old", "/temp", "/chain", "/new"):
            assert len(build.fetch(("T", base + path))[1]) == 1
    finally:
        server.shutdown()
    assert build.MOVED == {base + "/old": base + "/new"}  # a 302 anywhere in the chain isn't a move
