"""Voices Listen's audio. Each story on the site is read by Kokoro, as the blocks its reader page shows (audio.mjs), and
stored in the public audio bucket with the second each block starts, so the reader can mark the block being read.
Runs after each build (.github/workflows/audio.yml); the bucket and its domain are in docs/setup/configuration.md.

Env: AUDIO_URL (unset: nothing to do), CF_API_TOKEN, CF_ACCOUNT_ID and CF_KV_NAMESPACE_ID (the stored articles, and
R2 through wrangler), AUDIO_BUDGET_MIN (overrides BUDGET_MIN, for a backfill), AUDIO_DRY_RUN (voice a couple of stories
and upload nothing, as a pull request does, reading articles from SITE_URL's public reader rather than KV)."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
BUCKET = "upshot-audio"
INDEX = "_index.json"    # which stories have audio: {key: {v, at, card, r?}}, rewritten after each story; the page reads it too
INDEX_CACHE = "public, max-age=300"  # five minutes: new audio shows soon, and a visit's read is mostly served from cache
VERSION = 1              # the audio's format. A bump voices every story again, under new names, so no cache serves the old
VOICE = "af_heart"
RATE = 24000             # Kokoro's samples a second
PAUSE = 0.35             # seconds of quiet between blocks, as between paragraphs
MAX_READING_MIN = 20     # longer stories get their headline and upshot only (about 94% of stories are within it)
BUDGET_MIN = 20          # no story starts after this many minutes of a run; the rest wait for the next one
DRY_STORIES = 2          # what a dry run voices
MODEL = ROOT / "kokoro-v1.0.int8.onnx"  # audio.yml downloads both, checking their hashes
VOICES = ROOT / "voices-v1.0.bin"


def key_for(url):
    """The story's key, as worker.js keyFor makes it for the stored article."""
    return hashlib.sha256(url.encode()).hexdigest()


def wrangler(*args, **kw):
    return subprocess.run(["npx", "wrangler", "r2", "object", *args, "--remote"], capture_output=True, text=True, cwd=ROOT, **kw)


def get_index():
    r = wrangler("get", f"{BUCKET}/{INDEX}", "--pipe")
    if r.returncode == 0:
        return json.loads(r.stdout or "{}")
    if "does not exist" in r.stderr:
        return {}  # the first run
    raise RuntimeError(f"couldn't read {INDEX}: {r.stderr.strip()[-300:]}")


def put(name, path, content_type, cache):
    r = wrangler("put", f"{BUCKET}/{name}", "--file", str(path), "--content-type", content_type, "--cache-control", cache)
    if r.returncode:
        raise RuntimeError(f"couldn't upload {name}: {r.stderr.strip()[-300:]}")


def put_json(name, value, cache):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(value, f, separators=(",", ":"))
    try:
        put(name, f.name, "application/json", cache)
    finally:
        os.unlink(f.name)


def audio_name(key, r=0):
    """A story's audio and timings, less the extension. A file, once made, never changes (it's cached for a year, and the
    bucket's lifecycle rule ages it from its upload), so a story voiced again gets its next revision, `r`, in the name."""
    return f"{key}-{VERSION}" + (f"-{r}" if r else "")


def candidates(items, index):
    """Stories still to voice, newest first: those with no audio, and those voiced from their card (the article couldn't
    be stored then), whose article may be stored by now. A story waits for its upshot (no "tldr" yet means the build will
    try again), since the upshot is read second."""
    def due(i):
        had = index.get(key_for(i["url"]))
        return had is None or had.get("card")  # an entry from before "card" was kept: none was a card (checked 2026-11-20)
    todo = [i for i in items if "tldr" in i and due(i)]
    return sorted(todo, key=lambda i: (i.get("published") or i["date"], i.get("added") or ""), reverse=True)


def story_blocks(items):
    """{url: {reason, blocks}} from audio.mjs, which reads the stored articles."""
    payload = {"items": [{k: i.get(k) for k in ("url", "title", "summary")} | {"tldr": i.get("tldr") or []} for i in items]}
    r = subprocess.run(["node", str(ROOT / "audio.mjs")], input=json.dumps(payload), capture_output=True, text=True, cwd=ROOT, timeout=600)
    if r.returncode:
        raise RuntimeError(f"audio.mjs exited {r.returncode}: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout)


def what_to_read(item, story):
    """The blocks to voice and whether they're the whole page. A long article stops after the upshot; a card (the article
    couldn't be stored) is read whole: headline, upshot and summary. None: nothing stored yet, so wait."""
    if story["reason"] == "pending":
        return None
    blocks = story["blocks"]
    if story["reason"] != "ok":
        return blocks, False
    if (item.get("minutes") or 0) > MAX_READING_MIN:
        head = [b for b in blocks[:2] if b["kind"] in ("title", "upshot")]
        return head, False
    return blocks, True


_kokoro = None


def voice(blocks):
    """The blocks read aloud, as float samples, and the second each starts. A block with no letters is silent but still
    has a start, so the timings stay one per block on the page."""
    global _kokoro
    import numpy as np  # only the audio job installs these (requirements-audio.txt)
    if _kokoro is None:
        import onnxruntime as ort
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro.from_session(ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"]), str(VOICES))
    parts, starts, at = [], [], 0
    gap = np.zeros(int(PAUSE * RATE), dtype=np.float32)
    for b in blocks:
        starts.append(round(at / RATE, 2))
        if any(c.isalnum() for c in b["text"]):  # Kokoro raises on text with nothing to say (a lone zero-width joiner)
            text = b["text"] if b["kind"] in ("text", "upshot") or b["text"][-1:] in ".!?:;" else b["text"] + "."  # a pause after a heading
            samples, _ = _kokoro.create(text, voice=VOICE, speed=1.0, lang="en-us")
            parts.append(samples.astype(np.float32))
            at += len(samples)
        parts.append(gap)
        at += len(gap)
    return np.concatenate(parts), starts


def encode(samples, path):
    """AAC in an MP4 file, which every browser plays, with its index first so playback starts before it's all fetched."""
    import imageio_ffmpeg
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-",
                    "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", str(path)], input=samples.tobytes(), check=True)


def main():
    dry = bool(os.environ.get("AUDIO_DRY_RUN"))
    if not dry and not os.environ.get("AUDIO_URL"):
        print("AUDIO_URL isn't set: no audio to make")
        return
    budget = float(os.environ.get("AUDIO_BUDGET_MIN") or BUDGET_MIN)
    items = json.loads((ROOT / "site" / "data.json").read_text())["items"]
    found = {} if dry else get_index()
    live = {key_for(i["url"]) for i in items}
    index = {k: dict(v) for k, v in found.items() if k in live and v.get("v") == VERSION}  # gone from the site, or an old format
    todo = candidates(items, index)[:DRY_STORIES if dry else None]
    stories = story_blocks(todo) if todo else {}
    began, voiced, failed, waiting, deferred, audio_s, size = time.monotonic(), [], [], 0, 0, 0.0, 0
    with tempfile.TemporaryDirectory() as tmp:
        for i in todo:
            if time.monotonic() - began >= budget * 60:
                deferred += 1
                continue
            story = stories.get(i["url"]) or {"reason": "pending"}
            key = key_for(i["url"])
            had = index.get(key)  # voiced from its card: done again only once the article is stored
            plan = what_to_read(i, story)
            if had and (plan is None or story["reason"] != "ok"):
                continue
            if plan is None:
                waiting += 1
                continue
            blocks, full = plan
            r = had.get("r", 0) + 1 if had else 0
            name = audio_name(key, r)
            path = Path(tmp) / f"{name}.m4a"
            try:  # one story that can't be voiced is skipped and reported, not left blocking every older one
                samples, starts = voice(blocks)
                seconds = len(samples) / RATE
                encode(samples, path)
                meta = {"v": VERSION, "d": round(seconds, 2), "t": starts, "n": len(blocks), "full": full}
                if not dry:
                    put(f"{name}.m4a", path, "audio/mp4", "public, max-age=31536000, immutable")
                    put_json(f"{name}.json", meta, "public, max-age=31536000, immutable")
                    index[key] = {"v": VERSION, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                  "card": story["reason"] != "ok", **({"r": r} if r else {})}
                    put_json(INDEX, index, INDEX_CACHE)  # after each story, so a run cut short keeps what it made
            except Exception as e:
                failed.append((i["title"], repr(e)))
                continue
            voiced.append((i["title"], seconds, full))
            audio_s += seconds
            size += path.stat().st_size
    if not dry and index != found and not voiced:
        put_json(INDEX, index, INDEX_CACHE)  # stories that left the site
    line = (f"**Audio:** {len(voiced)} voiced ({audio_s / 60:.1f} min of audio, {size / 1e6:.1f} MB) in "
            f"{(time.monotonic() - began) / 60:.1f} min, {deferred} left for the next run, {waiting} waiting for their article"
            f"{f', {len(failed)} failed' if failed else ''}{', dry run: nothing uploaded' if dry else ''}")
    print(line)
    for title, seconds, full in voiced:
        print(f"  {seconds / 60:5.1f} min  {'' if full else '(headline and upshot) '}{title}")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(line + "\n\n")
    for title, error in failed:
        print(f"  failed: {title}: {error}", file=sys.stderr)
    return 1 if failed else None  # the run turns red, after voicing everything else


if __name__ == "__main__":
    sys.exit(main())
