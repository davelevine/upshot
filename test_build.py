import json
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


def test_cap_per_day_balances_categories_and_prefers_original_sources():
    day = lambda cat, rel, pub, url: {"date": "2026-01-02", "category": cat, "relevance": rel, "publisher": pub, "url": url}
    out = build.cap_per_day([
        day("security", 8, "The Hacker News", "news"), day("security", 8, "Rapid7", "orig-1"),
        day("security", 8, "Wiz", "orig-2"), day("security", 9, "BleepingComputer", "top"),
        day("architecture", 6, "Figma", "a1"), day("architecture", 6, "Cloudflare Blog", "a2"),
        day("regulation", 8, "The Record", "r1"),
    ])
    urls = [i["url"] for i in out]
    assert {"top", "orig-1"} <= set(urls) and "news" not in urls and "orig-2" not in urls  # score, then original source
    assert "a1" in urls and "a2" not in urls  # max 1, first one kept
    assert "r1" in urls                       # no limit set for this category


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
