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
    # A feed removed from the OPML (as the Feed health issue suggests) is dropped, not reported dead forever.
    health = {"https://removed": "2026-10-01", "https://kept": "2026-10-01"}
    assert build.update_feed_health(health, {"https://kept": False}, today) == ["https://kept"] and "https://removed" not in health


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
    assert item["published"] == "2026-11-07T01:00:00+00:00"  # the exact time too, for "5h ago" on the page


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
    big = [day("security", 8, f"s{n}") for n in range(6)] + [day("infrastructure", 6, "a1"), day("infrastructure", 6, "a2")]
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
    # A weekly pick follows the swap, and the old article's TL;DR goes, to be rewritten from the original.
    pick = {"title": "Pick", "url": "https://news.test/p", "publisher": "The Hacker News", "relevance": 8, "date": "2026-01-01", "tldr": ["Old fact."]}
    weekly = {"items": [{"url": "https://news.test/p", "why": "Patch now."}, {"url": "https://else.test/q", "why": "x"}]}
    assert build.upgrade_source([pick], "pick", {**item, "url": "https://vendor.test/p"}, r, weekly)
    assert weekly["items"][0]["url"] == "https://vendor.test/p" and weekly["items"][1]["url"] == "https://else.test/q"
    assert "tldr" not in pick
    other = {"title": "Other", "url": "n", "publisher": "SecurityWeek"}
    assert not build.upgrade_source([other], "Other", {**item, "publisher": "The Record"}, r)            # news for news
    assert other["url"] == "n"


def test_scoring_never_sees_recent_headlines(monkeypatch):
    sent = {}
    monkeypatch.setattr(build, "llm", lambda system, user, schema: sent.update(payload=json.loads(user)) or
                        [{"id": 0, "category": "ai", "relevance": 8, "summary": "s"}])
    out = build.classify({"url": "https://x.test/a", "title": "T", "publisher": "P", "excerpt": "E"})
    assert sent["payload"] == [{"id": 0, "title": "T", "publisher": "P", "excerpt": "E"}]
    assert out["relevance"] == 8


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
    def fake_classify(item):
        batches.append(item["url"])
        return {"category": "ai", "relevance": 8, "summary": "s"}
    monkeypatch.setattr(build, "classify", fake_classify)
    items = [{"url": f"https://x.test/{n}", "title": "T", "publisher": "P", "excerpt": "E"} for n in range(5)]
    out = build.score_each(items)
    assert sorted(batches) == sorted(i["url"] for i in items) and set(out) == {i["url"] for i in items}  # one call each, in any order: they run in parallel


def test_score_each_reports_failures_as_none(monkeypatch):
    def boom(item):
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
    flagged = {**new[1], "exploited": {"kev": [], "at": "t"}}
    out = build.run_summary(45, 1, new, scores, [(new[0], scores[new[0]["url"]]), (flagged, scores[new[1]["url"]])], [], [])
    assert "**Exploited:** 1 (1 below the bar)" in out  # how often the flag fires, and how often it bends the bar
    assert "45 fetched, 1 failed" in out and "**New stories:** 4" in out and "**Scored:** 3 (1 failed" in out
    assert "**Kept:** 2" in out and "[T0](https://x.test/0)" in out
    near = out.split("One point under the bar")[1]
    assert "T1" in near and "T2" not in near


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


def test_categories_are_defined():
    assert "architecture" not in build.CATEGORIES and "sdlc" not in build.CATEGORIES and "sdlc" not in build.CLASSIFY_PROMPT
    assert "infrastructure:" in build.CLASSIFY_PROMPT and "engineering:" in build.CLASSIFY_PROMPT  # each is defined


def test_cves_are_found_once_each_upper_cased():
    assert build.cves("Patch cve-2026-1234 and CVE-2026-123456, again CVE-2026-1234; not CVE-26-1") == ["CVE-2026-1234", "CVE-2026-123456"]
    assert build.cves(None) == []


def test_a_claim_counts_only_if_its_quote_is_in_the_story_and_about_exploitation():
    item = {"title": "Ivanti patches VPN flaw", "excerpt": "Ivanti says the flaw  is being exploited in the wild against a small number of customers."}
    claim = lambda evidence, exploited=True: build.verified_claim({"exploited": exploited, "evidence": evidence}, item)
    assert claim("is being exploited in the wild") == "is being exploited in the wild"  # spacing and case don't matter
    assert claim("being actively exploited by attackers") is None        # not in the story
    assert claim("against a small number of customers") is None         # in the story, but says nothing of exploitation
    assert claim("exploited") is None                                    # too short to check
    assert claim("is being exploited in the wild", exploited=False) is None


def test_a_story_is_flagged_by_cisas_catalog_or_a_checked_claim():
    kev = {"CVE-2026-1111": "2026-11-10"}
    item = {"title": "Router flaw", "excerpt": "CVE-2026-1111 is a zero-day under attack.", "cves": ["CVE-2026-1111"]}
    r = {"category": "infrastructure", "exploited": False, "evidence": "", "relevance": 6}
    flag = build.exploited(item, r, kev)
    assert flag["kev"] == ["CVE-2026-1111"] and "quote" not in flag  # the catalog needs no claim, in any category
    claim = {"category": "security", "exploited": True, "evidence": "is a zero-day under attack", "relevance": 7}
    assert build.exploited({**item, "cves": []}, claim, {})["quote"] == "is a zero-day under attack"
    assert build.exploited({**item, "cves": []}, {**claim, "category": "ai"}, {}) is None  # claims count for security only
    assert build.exploited({**item, "cves": []}, {**r, "category": "security"}, kev) is None  # no match, no claim



def test_the_catalog_failing_leaves_the_build_running(monkeypatch, capsys):
    def boom(*a, **k):
        raise OSError("timed out")
    monkeypatch.setattr(build.urllib.request, "urlopen", boom)
    assert build.fetch_kev() == {} and "catalog couldn't be read" in capsys.readouterr().out


def test_the_catalog_is_read_as_cve_to_date(monkeypatch):
    class Res:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, *a): return json.dumps({"vulnerabilities": [{"cveID": "cve-2026-9", "dateAdded": "2026-11-01"}]}).encode()
    monkeypatch.setattr(build.urllib.request, "urlopen", lambda req, timeout: Res())
    assert build.fetch_kev() == {"CVE-2026-9": "2026-11-01"}


def test_a_flagged_repeat_hands_its_flag_to_the_copy_on_the_site():
    on_site = {"title": "Big Flaw Exploited", "url": "a", "cves": [], "exploited": {"kev": ["CVE-2026-1"], "at": "t0"}}
    other = {"title": "Something else", "url": "b"}
    build.carry_flag([other, on_site], "big flaw  exploited", {"kev": ["CVE-2026-2"], "at": "t1", "quote": "q"})
    assert on_site["exploited"] == {"kev": ["CVE-2026-1", "CVE-2026-2"], "at": "t0", "quote": "q"}  # kept its first date
    assert "exploited" not in other
    build.carry_flag([other], "Something else", None)
    assert "exploited" not in other


def test_the_daily_cap_never_drops_a_flagged_story():
    day = lambda rel, url, **k: {"date": "2026-11-08", "category": "security", "relevance": rel, "publisher": "P", "url": url, **k}
    full = [day(9, f"p{n}") for n in range(build.DAILY_MAX)] + [day(5, "flagged", exploited={"kev": [], "at": "t", "quote": "q"})]
    assert "flagged" in [i["url"] for i in build.cap_per_day(full)]


def test_a_late_catalog_listing_tags_a_story_but_keeps_its_dates():
    old = {"title": "T", "url": "a", "added": "2026-11-01T10:00:00+00:00", "cves": ["CVE-2026-5"]}
    plain = {"title": "U", "url": "b", "cves": ["CVE-2026-6"]}
    build.tag_kev([old, plain], {"CVE-2026-5": "2026-11-12"})
    assert old["exploited"]["kev"] == ["CVE-2026-5"] and old["added"] == "2026-11-01T10:00:00+00:00"  # the pin counts from added
    assert "exploited" not in plain
    first = old["exploited"]["at"]
    build.tag_kev([old], {"CVE-2026-5": "2026-11-12"})
    assert old["exploited"]["at"] == first  # listed again: unchanged


def test_upgrading_the_source_keeps_both_copies_cves():
    r = {"category": "security", "summary": "s", "relevance": 8}
    old = {"title": "Big Flaw", "url": "n", "publisher": "BleepingComputer", "relevance": 8, "date": "2026-01-01", "cves": ["CVE-2026-1"]}
    assert build.upgrade_source([old], "big flaw", {"title": "Advisory", "url": "v", "publisher": "Rapid7", "cves": ["CVE-2026-2"]}, r)
    assert old["cves"] == ["CVE-2026-1", "CVE-2026-2"]


def test_scoring_asks_for_the_exploited_claim_in_the_same_call():
    fields = build.CLASSIFY_SCHEMA["properties"]["items"]["items"]["required"]
    assert {"exploited", "evidence"} <= set(fields) and "exploited" in build.CLASSIFY_PROMPT







def test_llm_sends_the_prompt_on_stdin_so_a_long_article_fits(monkeypatch):
    import types
    seen = {}
    def run(cmd, **k):
        seen.update(cmd=cmd, input=k.get("input"))
        return types.SimpleNamespace(stdout=json.dumps({"structured_output": {"items": []}, "modelUsage": {build.MODEL: {}}}), stderr="", returncode=0)
    monkeypatch.setattr(build.subprocess, "run", run)
    article = "word " * 60000  # 300 KB: past the 128 KB a single argument may hold
    build.llm("system", article, {})
    assert seen["input"] == article and article not in seen["cmd"]


def test_a_claim_counts_in_the_words_reporters_use():
    for title in ("Attackers Chain Three Ivanti Connect Secure Flaws to Gain Unauthenticated Root Access",
                  "Active ScreenConnect attacks breach MSPs", "cPGuard Update Channel Hijacked to Backdoor Linux Servers",
                  "Malicious bee-js npm Release Delivers SleepyDuck"):
        assert build.verified_claim({"exploited": True, "evidence": title}, {"title": title, "excerpt": ""}) == title



def test_only_a_zero_day_bends_the_bar():
    bar = build.MIN_RELEVANCE["security"]
    r = {"category": "security", "relevance": bar - 1}
    flaw = lambda fix: {"kev": [], "at": "t", "kind": "flaw", "fix": fix}
    assert build.passes(r, flaw("none"))                                    # exploited, no patch yet: a point under is enough
    assert not build.passes(r, flaw("patch")) and not build.passes(r, flaw("mitigation"))
    assert not build.passes(r, {"kev": [], "at": "t", "kind": "compromise"})
    assert not build.passes({**r, "relevance": bar - 2}, flaw("none"))     # too niche: noise
    assert build.passes({**r, "relevance": bar}, None)


def test_a_remedy_claim_counts_only_if_its_quote_is_in_the_story_and_says_so():
    item = {"title": "Fortinet zero-day exploited", "excerpt": "No patch is available yet; disable the SSL-VPN as a workaround. FortiOS 7.4.9 fixes it next week."}
    fix = lambda status, evidence: build.verified_fix({"fix": status, "fix_evidence": evidence}, item)
    assert fix("none", "No patch is available yet") == "none"
    assert fix("mitigation", "disable the SSL-VPN as a workaround") == "mitigation"
    assert fix("patch", "FortiOS 7.4.9 fixes it next week") == "patch"   # the code checks the quote, not the tense
    assert fix("patch", "disable the SSL-VPN as a workaround") is None     # a workaround isn't a patch
    assert fix("none", "Fortinet zero-day exploited") is None              # doesn't say there's no fix
    assert fix("unknown", "") is None
    assert build.best_fix("none", "mitigation", None) == "mitigation" and build.best_fix("patch", "none") == "patch" and build.best_fix(None) is None


def test_a_catalog_match_has_at_least_a_mitigation_and_a_compromise_has_no_patch_status():
    item = {"title": "T", "excerpt": "Attackers are exploiting it in the wild and no patch is available yet.", "cves": ["CVE-2026-1"]}
    claim = {"category": "security", "exploited": True, "kind": "flaw", "evidence": "exploiting it in the wild", "fix": "none", "fix_evidence": "no patch is available yet"}
    assert build.exploited(item, claim, {})["fix"] == "none"
    assert "fix" not in build.exploited(item, claim, {"CVE-2026-1": "2026-11-12"})  # listed: a remedy exists, of a kind it doesn't say
    assert build.exploited({**item, "excerpt": "Attackers are exploiting it in the wild; update to 2.0 now."},
                           {**claim, "fix": "patch", "fix_evidence": "update to 2.0 now"}, {"CVE-2026-1": "d"})["fix"] == "patch"
    worm = {"title": "Malicious npm release steals tokens", "excerpt": "Remove the malicious versions and rotate tokens.", "cves": []}
    flag = build.exploited(worm, {"category": "security", "exploited": True, "kind": "compromise", "evidence": "Malicious npm release steals tokens",
                                  "fix": "mitigation", "fix_evidence": "rotate tokens"}, {})
    assert flag["kind"] == "compromise" and "fix" not in flag  # steps, not a patch: the upshot carries them


def test_later_news_only_raises_a_flaws_remedy():
    flaw = {"title": "Zero-day", "url": "a", "cves": ["CVE-2026-7"], "exploited": {"kev": [], "at": "t", "kind": "flaw", "fix": "none"}}
    other = {"title": "Other", "url": "b", "cves": ["CVE-2026-8"], "exploited": {"kev": [], "at": "t", "kind": "flaw", "fix": "none"}}
    worm = {"title": "Worm", "url": "c", "cves": ["CVE-2026-7"], "exploited": {"kev": [], "at": "t", "kind": "compromise"}}
    build.mark_fixed([flaw, other, worm], ["CVE-2026-7"], "mitigation")
    assert flaw["exploited"]["fix"] == "mitigation" and other["exploited"]["fix"] == "none" and "fix" not in worm["exploited"]
    build.mark_fixed([flaw], ["CVE-2026-7"], "patch")
    assert flaw["exploited"]["fix"] == "patch"
    build.tag_kev([other], {"CVE-2026-8": "2026-11-12"})
    assert "fix" not in other["exploited"]             # listed: no longer "no patch yet", but no claim of which remedy
    build.tag_kev([flaw], {"CVE-2026-7": "2026-11-12"})
    assert flaw["exploited"]["fix"] == "patch"         # never lowered
    build.carry_flag([flaw], "Zero-day", {"kev": [], "at": "t1", "kind": "flaw", "fix": "none"})
    assert flaw["exploited"]["fix"] == "patch"         # a repeat's older news never un-patches it


def test_an_exploited_flaws_summary_also_reads_its_remedy_from_the_whole_article(monkeypatch):
    article = "Attackers exploit the flaw. N-able released 2026.4 HF2, which includes the necessary patches."
    calls = []
    def fake(system, user, schema, whole=False):
        calls.append((schema is build.TLDR_FIX_SCHEMA, whole))
        bullets = ["Attackers exploit the flaw in N-central.", "Update to 2026.4 HF2."]
        return {"bullets": bullets, "fix": "patch", "fix_evidence": "released 2026.4 HF2, which includes the necessary patches"} if whole else bullets
    monkeypatch.setattr(build, "llm", fake)
    flaw = {"title": "Zero-days", "url": "a", "cves": ["CVE-2026-3"], "exploited": {"kev": [], "at": "t", "kind": "flaw", "fix": "none"}}
    sibling = {"title": "Same flaw elsewhere", "url": "c", "tldr": [], "cves": ["CVE-2026-3"], "exploited": {"kev": [], "at": "t", "kind": "flaw", "fix": "none"}}
    worm = {"title": "Worm", "url": "w", "exploited": {"kev": [], "at": "t", "kind": "compromise"}}
    plain = {"title": "Release notes", "url": "b"}
    build.add_tldrs([flaw, sibling, worm, plain], {"a": article, "w": "A worm. Rotate tokens.", "b": "Release 2026.4 HF2."})
    assert sorted(calls) == [(False, False), (False, False), (True, True)]  # only the flaw's summary asks about its remedy
    assert flaw["exploited"]["fix"] == "patch" and sibling["exploited"]["fix"] == "patch"  # its excerpt said none
    assert "fix" not in worm["exploited"]


def test_wrap_ends_on_an_overlong_word():
    font = build.og_font(52, 700)
    lines = build.wrap("@scope/" + "x" * 60 + " compromised in npm attack", font, 1056, 1)  # used to loop forever
    assert len(lines) == 1 and lines[0].endswith("…") and font.getlength(lines[0]) <= 1056


def test_a_tldr_never_says_no_patch_for_a_flaw_cisa_lists(monkeypatch):
    text = "There is no patch yet for CVE-2026-7 and attackers are using it."
    monkeypatch.setattr(build, "llm", lambda *a, **k: {"bullets": ["Attackers use CVE-2026-7.", "No patch yet for CVE-2026-7."],
                                                      "fix": "none", "fix_evidence": "no patch yet"})
    listed = {"url": "a", "title": "T", "cves": ["CVE-2026-7"], "exploited": {"kev": ["CVE-2026-7"], "at": "t", "kind": "flaw"}}
    unlisted = {"url": "b", "title": "T", "cves": [], "exploited": {"kev": [], "at": "t", "kind": "flaw", "quote": "q"}}
    build.add_tldrs([listed, unlisted], {"a": text, "b": text})
    assert "fix" not in listed["exploited"]          # CISA's listing rules out "none"
    assert unlisted["exploited"]["fix"] == "none"    # the article's word stands when CISA hasn't listed it


def test_a_repeat_of_a_repeat_hands_its_flag_to_the_copy_on_the_site():
    on_site = {"title": "Big flaw exploited", "url": "a", "publisher": "P", "date": "2026-11-12", "cves": []}
    data = {"items": [on_site], "weekly": None}
    flag = {"kev": [], "at": "t", "kind": "flaw", "quote": "q"}
    item = lambda n, title, f=None: ({"url": f"u{n}", "title": title, "publisher": "The Record", "date": "2026-11-12",
                                      "published": "p", "cves": [], "exploited": f}, {"category": "security", "relevance": 9, "summary": "s"})
    chunk = [item(0, "Big flaw exploited, again"), item(1, "Same flaw, flagged", flag)]
    kept, repeated = [], []
    build.add_chunk(data, chunk, {"u0": "Big flaw exploited", "u1": "0"}, ["Big flaw exploited"], kept, repeated)
    assert len(repeated) == 2 and data["items"] == [on_site]
    assert on_site["exploited"]["quote"] == "q"      # item 1 pointed at item 0, itself a repeat: the flag still lands


def test_a_flaw_flagged_after_publication_reads_its_remedy_from_its_upshot_once(monkeypatch):
    calls = []
    def fake(system, user, schema, whole=False):
        calls.append(json.loads(user)["title"])
        return {"fix": "patch", "fix_evidence": "Update OpenSSH to version 10.6p2"} if "SSHole" in user else {"fix": "none", "fix_evidence": "no patch is available yet"}
    monkeypatch.setattr(build, "llm", fake)
    late = {"title": "SSHole", "url": "a", "tldr": ["Hackers exploit it.", "Update OpenSSH to version 10.6p2 as soon as possible."],
            "exploited": {"kev": ["CVE-2026-1"], "at": "t", "kind": "flaw"}}
    listed_unpatched = {"title": "Other", "url": "b", "tldr": ["Attackers exploit it; no patch is available yet."],
                        "exploited": {"kev": ["CVE-2026-2"], "at": "t", "kind": "flaw"}}
    known = {"title": "Known", "url": "c", "tldr": ["x"], "exploited": {"kev": [], "at": "t", "kind": "flaw", "fix": "patch"}}
    worm = {"title": "Worm", "url": "d", "tldr": ["x"], "exploited": {"kev": [], "at": "t", "kind": "compromise"}}
    bare = {"title": "No upshot", "url": "e", "exploited": {"kev": ["CVE-2026-3"], "at": "t", "kind": "flaw"}}
    assert build.add_late_fixes([late, listed_unpatched, known, worm, bare]) == 2  # only flaws with no remedy and an upshot
    assert late["exploited"]["fix"] == "patch"
    assert "fix" not in listed_unpatched["exploited"]  # CISA's listing contradicts "no patch yet"
    assert build.add_late_fixes([late, listed_unpatched]) == 0 and sorted(calls) == ["Other", "SSHole"]  # read once
    same_cve = {"title": "Analysis", "url": "f", "cves": ["CVE-2026-9"], "tldr": ["Deep dive; nothing on fixes."],
                "exploited": {"kev": ["CVE-2026-9"], "at": "t", "kind": "flaw"}}
    told = {"title": "SSHole again", "url": "g", "cves": ["CVE-2026-9"], "tldr": ["Update OpenSSH to version 10.6p2 now."],
            "exploited": {"kev": ["CVE-2026-9"], "at": "t", "kind": "flaw"}}
    build.add_late_fixes([same_cve, told])
    assert same_cve["exploited"]["fix"] == "patch"  # learned from the other story naming its CVE


def test_a_repeat_hands_over_its_cves_even_unflagged():
    on_site = {"title": "Big Flaw", "url": "a", "cves": ["CVE-2026-1"]}
    build.carry_flag([on_site], "big flaw", None, ["CVE-2026-2"])
    assert on_site["cves"] == ["CVE-2026-1", "CVE-2026-2"] and "exploited" not in on_site  # CISA may list the other one later


def test_a_retracted_story_is_never_flagged(monkeypatch, tmp_path):
    f = tmp_path / "not-exploited.txt"
    f.write_text("# wrong flags\nhttps://x.test/trend  # a trend piece\n")
    monkeypatch.setattr(build, "NOT_EXPLOITED", f)
    claim = {"category": "security", "exploited": True, "kind": "flaw", "evidence": "abuse exposed secrets in the wild", "fix": "unknown", "fix_evidence": ""}
    item = {"url": "https://x.test/trend", "title": "Threat actors abuse exposed secrets in the wild", "excerpt": "", "cves": []}
    assert build.exploited(item, claim, {}) is None and build.exploited({**item, "url": "https://x.test/other"}, claim, {})


def test_the_claim_backfill_checks_the_last_weeks_unflagged_security_stories(monkeypatch):
    seen = []
    def fake(item):
        seen.append(item["title"])
        return {"category": "security", "relevance": 8, "summary": "s", "exploited": True, "kind": "compromise",
                "evidence": item["title"], "fix": "unknown", "fix_evidence": ""}
    monkeypatch.setattr(build, "classify", fake)
    today = build.now().astimezone(build.SITE_TZ).date()
    day = lambda n: (today - build.timedelta(days=n)).isoformat()
    items = [{"url": "a", "title": "Malicious npm release steals tokens", "publisher": "P", "date": day(1), "category": "security", "summary": "s"},
             {"url": "b", "title": "Old malicious release", "publisher": "P", "date": day(30), "category": "security", "summary": "s"},
             {"url": "c", "title": "Malicious AI thing", "publisher": "P", "date": day(1), "category": "ai", "summary": "s"},
             {"url": "d", "title": "Already flagged", "publisher": "P", "date": day(1), "category": "security", "summary": "s", "exploited": {"kev": [], "at": "t", "kind": "flaw"}}]
    assert build.backfill_claims(items, {}) == 1 and seen == ["Malicious npm release steals tokens"]
    assert items[0]["exploited"]["kind"] == "compromise" and "exploited" not in items[1]


def test_rss_titles_carry_the_label():
    base = {"url": "u", "summary": "s", "category": "security", "date": "2026-11-12", "title": "T"}
    out = build.rss([{**base, "url": "a", "exploited": {"kind": "flaw", "fix": "patch"}}, {**base, "url": "b", "exploited": {"kind": "flaw", "fix": "none"}},
                     {**base, "url": "c", "exploited": {"kind": "compromise"}}, {**base, "url": "d"}])
    titles = [t.text for t in ET.fromstring(out).iter("title")][1:]
    assert titles == ["Exploited: T", "Exploited, no patch yet: T", "Compromised: T", "T"]
