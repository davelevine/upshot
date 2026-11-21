"""audio.py, offline: the voice, the encoder, the bucket and the stored articles are scripted, so these run in build.yml's
pytest without Kokoro, ffmpeg or Cloudflare."""
import json

import pytest

import audio


def item(n, *, minutes=5, tldr=("A point.",), **extra):
    """A story on the site; higher n is newer."""
    return {"date": f"2026-11-{n:02d}", "published": f"2026-11-{n:02d}T12:00:00+00:00", "title": f"Story {n}",
            "url": f"https://example.test/{n}", "summary": f"Story {n} happened.", "minutes": minutes,
            **({"tldr": list(tldr)} if tldr is not None else {}), **extra}


def page(n, reason="ok", paragraphs=3):
    blocks = [{"kind": "title", "text": f"Story {n}"}, {"kind": "upshot", "text": "The upshot. A point."}]
    if reason == "ok":
        blocks += [{"kind": "text", "text": f"Paragraph {p}."} for p in range(paragraphs)]
    elif reason != "pending":
        blocks += [{"kind": "text", "text": f"Story {n} happened."}]
    return {"reason": reason, "blocks": blocks if reason != "pending" else []}


class Samples(list):
    def tobytes(self):
        return b"\0" * len(self)


class Bucket:
    """audio.py pointed at a temporary site, with R2, audio.mjs, Kokoro and ffmpeg scripted."""

    def __init__(self, tmp_path, monkeypatch):
        (tmp_path / "site").mkdir()
        self.tmp, self.index, self.files, self.uploads, self.pages, self.clock = tmp_path, None, {}, [], {}, [0.0]
        monkeypatch.setattr(audio, "ROOT", tmp_path)
        monkeypatch.setenv("AUDIO_URL", "https://audio.example.test")
        monkeypatch.delenv("AUDIO_DRY_RUN", raising=False)
        monkeypatch.delenv("AUDIO_BUDGET_MIN", raising=False)
        monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(tmp_path / "summary.md"))
        monkeypatch.setattr(audio, "get_index", self.get_index)
        monkeypatch.setattr(audio, "put", self.put)
        monkeypatch.setattr(audio, "story_blocks", lambda items: {i["url"]: self.pages[i["url"]] for i in items if i["url"] in self.pages})
        monkeypatch.setattr(audio, "voice", self.voice)
        monkeypatch.setattr(audio, "encode", lambda samples, path: path.write_bytes(samples.tobytes()))
        monkeypatch.setattr(audio.time, "monotonic", lambda: self.clock[0])
        self.voiced = []
        self.seconds_per_story = 60  # of the run's clock, each story takes this long to voice

    def site(self, *items):
        (self.tmp / "site" / "data.json").write_text(json.dumps({"items": list(items)}))

    def get_index(self):
        self.reads = getattr(self, "reads", 0) + 1
        return dict(self.index or {})

    def put(self, name, path, content_type, cache):
        body = open(path, "rb").read()
        self.files[name] = body
        self.uploads.append(name)
        if name == audio.INDEX:
            self.index = json.loads(body)

    def voice(self, blocks):
        self.voiced.append([b["text"] for b in blocks])
        self.clock[0] += self.seconds_per_story
        return Samples([0.0] * audio.RATE * len(blocks)), [float(n) for n in range(len(blocks))]  # a second a block

    def meta(self, n):
        return json.loads(self.files[f"{audio.key_for(f'https://example.test/{n}')}-{audio.VERSION}.json"])


@pytest.fixture
def bucket(tmp_path, monkeypatch):
    return Bucket(tmp_path, monkeypatch)


def test_voices_new_stories_newest_first_and_records_each_as_it_goes(bucket):
    bucket.site(item(3), item(5), item(4))
    bucket.pages = {f"https://example.test/{n}": page(n) for n in (3, 4, 5)}
    audio.main()
    assert [v[0] for v in bucket.voiced] == ["Story 5", "Story 4", "Story 3"]
    names = [audio.key_for(f"https://example.test/{n}") + f"-{audio.VERSION}" for n in (5, 4, 3)]
    # The audio, its timings, then the index, story by story: a run cut short keeps what it finished.
    assert bucket.uploads == [x for name in names for x in (f"{name}.m4a", f"{name}.json", audio.INDEX)]
    assert bucket.meta(5) == {"v": audio.VERSION, "d": 5.0, "t": [0.0, 1.0, 2.0, 3.0, 4.0], "n": 5, "full": True}
    assert set(bucket.index) == {audio.key_for(f"https://example.test/{n}") for n in (3, 4, 5)}
    assert "3 voiced" in (bucket.tmp / "summary.md").read_text()


def test_a_story_that_cant_be_voiced_is_skipped_and_the_rest_still_are(bucket, monkeypatch):
    bucket.site(item(3), item(5), item(4))
    bucket.pages = {f"https://example.test/{n}": page(n) for n in (3, 4, 5)}
    voice = bucket.voice
    def flaky(blocks):
        if blocks[0]["text"] == "Story 4":
            raise RuntimeError("Kokoro choked")
        return voice(blocks)
    monkeypatch.setattr(audio, "voice", flaky)
    assert audio.main() == 1  # red, so it's seen
    assert set(bucket.index) == {audio.key_for(f"https://example.test/{n}") for n in (3, 5)}  # 3, older, still voiced
    assert "1 failed" in (bucket.tmp / "summary.md").read_text()


def test_a_second_run_voices_only_whats_new_and_forgets_what_left(bucket):
    bucket.site(item(3), item(4))
    bucket.pages = {f"https://example.test/{n}": page(n) for n in (3, 4, 5)}
    audio.main()
    bucket.site(item(4), item(5))  # 3 left the site, 5 arrived
    bucket.voiced, bucket.uploads = [], []
    audio.main()
    assert [v[0] for v in bucket.voiced] == ["Story 5"]
    assert set(bucket.index) == {audio.key_for(f"https://example.test/{n}") for n in (4, 5)}


def test_an_index_left_by_an_older_format_voices_again(bucket):
    bucket.site(item(4))
    bucket.pages = {"https://example.test/4": page(4)}
    bucket.index = {audio.key_for("https://example.test/4"): {"v": audio.VERSION - 1}}
    audio.main()
    assert [v[0] for v in bucket.voiced] == ["Story 4"]


def test_a_story_waits_for_its_upshot_and_its_article(bucket):
    bucket.site(item(5, tldr=None), item(4), item(3))  # 5: no upshot yet; 4: nothing stored yet
    bucket.pages = {"https://example.test/4": page(4, "pending"), "https://example.test/3": page(3)}
    audio.main()
    assert [v[0] for v in bucket.voiced] == ["Story 3"]
    assert set(bucket.index) == {audio.key_for("https://example.test/3")}, "both wait for the next run"
    assert "1 waiting for their article" in (bucket.tmp / "summary.md").read_text()


def test_a_long_story_gets_its_headline_and_upshot_and_a_card_its_summary(bucket):
    bucket.site(item(5, minutes=audio.MAX_READING_MIN + 1), item(4, minutes=audio.MAX_READING_MIN), item(3))
    bucket.pages = {"https://example.test/5": page(5), "https://example.test/4": page(4), "https://example.test/3": page(3, "challenge")}
    audio.main()
    assert bucket.voiced[0] == ["Story 5", "The upshot. A point."]
    assert bucket.meta(5)["full"] is False and bucket.meta(5)["n"] == 2
    assert len(bucket.voiced[1]) == 5 and bucket.meta(4)["full"] is True, "at the cap: the whole article"
    assert bucket.voiced[2] == ["Story 3", "The upshot. A point.", "Story 3 happened."], "the card the reader shows, whole"
    assert bucket.meta(3)["full"] is False


def test_a_card_is_voiced_again_once_its_article_is_stored(bucket):
    bucket.site(item(4), item(3))
    bucket.pages = {"https://example.test/4": page(4, "challenge"), "https://example.test/3": page(3)}
    audio.main()
    k4, k3 = audio.key_for("https://example.test/4"), audio.key_for("https://example.test/3")
    assert bucket.index[k4]["card"] is True and bucket.index[k3]["card"] is False

    bucket.voiced, bucket.uploads = [], []
    audio.main()  # still blocked: its card's audio stands, and nothing is uploaded
    assert bucket.voiced == [] and bucket.uploads == []

    bucket.pages["https://example.test/4"] = page(4)  # a later build stored the article
    audio.main()
    assert bucket.voiced == [["Story 4", "The upshot. A point.", "Paragraph 0.", "Paragraph 1.", "Paragraph 2."]]
    assert bucket.uploads[:2] == [f"{k4}-{audio.VERSION}-1.m4a", f"{k4}-{audio.VERSION}-1.json"], "new names: a file never changes"
    assert bucket.index[k4]["card"] is False and bucket.index[k4]["r"] == 1
    assert json.loads(bucket.files[f"{k4}-{audio.VERSION}-1.json"])["full"] is True


def test_a_long_story_without_an_upshot_gets_its_headline(bucket):
    p = page(5)
    p["blocks"] = [b for b in p["blocks"] if b["kind"] != "upshot"]
    bucket.site(item(5, minutes=audio.MAX_READING_MIN + 1, tldr=()))
    bucket.pages = {"https://example.test/5": p}
    audio.main()
    assert bucket.voiced == [["Story 5"]]


def test_the_budget_stops_new_stories_and_leaves_them_for_the_next_run(bucket, monkeypatch):
    bucket.site(*[item(n) for n in range(1, 8)])
    bucket.pages = {f"https://example.test/{n}": page(n) for n in range(1, 8)}
    bucket.seconds_per_story = 9 * 60
    audio.main()  # 20 minutes: stories start at 0, 9 and 18 minutes; at 27 the rest wait
    assert [v[0] for v in bucket.voiced] == ["Story 7", "Story 6", "Story 5"]
    assert "4 left for the next run" in (bucket.tmp / "summary.md").read_text()
    monkeypatch.setenv("AUDIO_BUDGET_MIN", "300")  # a backfill
    bucket.voiced = []
    audio.main()
    assert [v[0] for v in bucket.voiced] == ["Story 4", "Story 3", "Story 2", "Story 1"]


def test_a_dry_run_voices_two_stories_and_touches_nothing(bucket, monkeypatch):
    monkeypatch.setenv("AUDIO_DRY_RUN", "1")
    monkeypatch.delenv("AUDIO_URL")
    bucket.site(*[item(n) for n in range(1, 6)])
    bucket.pages = {f"https://example.test/{n}": page(n) for n in range(1, 6)}
    audio.main()
    assert [v[0] for v in bucket.voiced] == ["Story 5", "Story 4"]
    assert bucket.uploads == [] and not hasattr(bucket, "reads"), "nothing read from the bucket or written to it"


def test_without_an_audio_bucket_nothing_runs(bucket, monkeypatch):
    monkeypatch.delenv("AUDIO_URL")
    bucket.site(item(1))
    audio.main()
    assert bucket.voiced == [] and bucket.uploads == []


def test_the_index_is_written_when_stories_leave_even_with_nothing_new(bucket):
    bucket.site(item(4))
    bucket.pages = {"https://example.test/4": page(4)}
    bucket.index = {audio.key_for("https://example.test/4"): {"v": audio.VERSION}, "gone": {"v": audio.VERSION}}
    audio.main()
    assert bucket.voiced == [] and bucket.uploads == [audio.INDEX]
    assert set(bucket.index) == {audio.key_for("https://example.test/4")}


def test_keys_match_the_stored_articles():
    # worker.js keyFor: SHA-256 hex of the URL (tests/audio.test.js checks the same URL there).
    assert audio.key_for("https://example.test/1") == "98780052059c9103799e803c8bf1e4a75c7edd58bc3e67bae3cc0a2dd1ab224a"
