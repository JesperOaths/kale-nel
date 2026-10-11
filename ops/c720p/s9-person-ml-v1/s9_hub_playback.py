"""Private, temporary 720p playback copies for the C720P Security browser.

The S9 originals remain unchanged. A single low-priority worker reads a source
only after a user requests playback; no original MP4 is cached on the hub.
This module is installed inside the authenticated archive proxy, never exposed
as an independent service or an unauthenticated static media directory.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path("/tmp/c720p-security-playback")
CACHE_MAX = 96 * 1024 * 1024
FILE_MAX = 64 * 1024 * 1024
TTL = 2 * 60 * 60
JOB_TIMEOUT = 600
QUEUE_TTL = 45
MAX_PENDING = 8
PROFILE = "720p30-v2"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}[.]mp4")
ROUTE = re.compile(r"/(new|s3)/saved/clip/([A-Za-z0-9._-]+[.]mp4)")
ROOTS = {"new": Path("/opt/homeassistant/config/www/frontyard-security-new/clips"),
         "s3": Path("/opt/homeassistant/config/www/frontyard-security/clips")}
LOCK = threading.Lock()
JOBS = {}
WORKER = None
JANITOR = None


class SourceFrameRateError(ValueError):
    def __init__(self, fps):
        super().__init__("source_below_24fps")
        self.source_fps = fps


def cache_home():
    CACHE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if CACHE.is_symlink() or CACHE.stat().st_uid != os.getuid():
        raise OSError("playback_cache_owner_mismatch")
    os.chmod(CACHE, 0o700)


def trim_cache(protected=(), budget=None):
    """Delete derived copies only; this directory never contains originals."""
    cache_home()
    now = time.time()
    files = []
    for path in CACHE.glob("*.mp4"):
        if not re.fullmatch(r"[a-f0-9]{64}[.]mp4", path.name) or path.is_symlink():
            continue
        try:
            stat = path.stat()
            if path not in protected and now - stat.st_mtime > TTL:
                path.unlink()
                path.with_suffix(".json").unlink(missing_ok=True)
            else:
                files.append((path, stat))
        except OSError:
            continue
    total = sum(stat.st_size for _, stat in files)
    maximum = CACHE_MAX if budget is None else budget
    for path, stat in sorted(files, key=lambda pair: pair[1].st_mtime):
        if total <= maximum:
            break
        if path in protected:
            continue
        try:
            path.unlink()
            path.with_suffix(".json").unlink(missing_ok=True)
            total -= stat.st_size
        except OSError:
            pass


def source(camera, name, phone_rows):
    if camera not in ROOTS or not NAME.fullmatch(name):
        raise ValueError("invalid_playback_source")
    record = phone_rows().get(name) if camera == "new" else None
    route = f"/{camera}/saved/clip/{name}"
    url = "http://127.0.0.1:8795" + route
    if record:
        size = int(record.get("size") or 0)
        kind = "phone"
        identity = str(record.get("sha256") or size)
    else:
        root = ROOTS[camera].resolve()
        local = (root / name).resolve()
        if local.parent == root and local.is_file() and not (ROOTS[camera] / name).is_symlink():
            stat = local.stat()
            size, kind = stat.st_size, "local"
            identity = f"{size}:{stat.st_mtime_ns}"
            url = str(local)
        else:
            # An archive HEAD already enforces its verified index. Never accept
            # a caller-provided URL, host, path, or shell command as an input.
            request = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(request, timeout=12) as response:
                if response.status != 200 or "video/mp4" not in response.headers.get("Content-Type", ""):
                    raise ValueError("archive_source_not_video")
                size = int(response.headers.get("Content-Length", "0"))
                identity = response.headers.get("ETag") or str(size)
            kind = "archive"
    if not 10000 <= size <= 4 * 1024 * 1024 * 1024:
        raise ValueError("invalid_playback_source_size")
    key = hashlib.sha256(f"{PROFILE}:{camera}:{name}:{identity}".encode()).hexdigest()
    return {"key": key, "url": url, "size": size, "source_kind": kind,
            "name": name, "camera": camera, "route": route}


def probe(url, timeout=30):
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height,avg_frame_rate,duration:format=duration",
        "-of", "json", str(url)], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise OSError("playback_video_probe_failed")
    data = json.loads(result.stdout)
    stream = data.get("streams", [{}])[0]
    numerator, denominator = str(stream.get("avg_frame_rate", "0/1")).split("/")
    fps = float(numerator) / max(float(denominator), 1)
    duration = float(stream.get("duration") or data.get("format", {}).get("duration") or 0)
    if not 0 < duration <= 600 or not 0 < fps <= 240:
        raise ValueError("invalid_video_timing")
    return {"fps": round(fps, 3), "duration": duration,
            "width": int(stream.get("width") or 0), "height": int(stream.get("height") or 0)}


def transcode_command(src, target, hardware=False):
    prefix = ["nice", "-n", "19", "ionice", "-c", "3", "ffmpeg", "-hide_banner",
        "-loglevel", "error", "-nostdin", "-y", "-threads", "2", "-filter_threads", "1"]
    if hardware:
        # Debian's i965 driver permits H.264 decode/resize on Haswell, while
        # hardware encoding is unavailable. Resize before the software encoder.
        prefix += ["-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/renderD128",
                   "-hwaccel_output_format", "vaapi"]
        filters = "scale_vaapi=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2:format=nv12,hwdownload,format=nv12,fps=30"
    else:
        filters = "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,fps=30"
    return prefix + ["-i", src["url"], "-map", "0:v:0", "-map", "0:a:0?", "-vf", filters,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-profile:v", "baseline",
        "-level:v", "3.1", "-pix_fmt", "yuv420p", "-threads", "2", "-g", "60",
        "-maxrate", "3500k", "-bufsize", "7000k", "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart", "-fs", str(FILE_MAX), "-f", "mp4", str(target)]


def cached(src):
    path = CACHE / (src["key"] + ".mp4")
    meta = path.with_suffix(".json")
    if path.is_symlink() or meta.is_symlink() or not path.is_file() or not meta.is_file():
        return None
    try:
        data = json.loads(meta.read_text())
        if data.get("key") != src["key"] or not 10000 <= path.stat().st_size <= FILE_MAX:
            return None
        if time.time() - path.stat().st_mtime > TTL:
            return None
        os.utime(path, None)
        return path, data
    except (OSError, ValueError):
        return None


def build(src):
    cache_home()
    # Reserve space for the one in-progress copy: completed + partial video
    # bytes remain bounded by CACHE_MAX throughout generation.
    trim_cache(budget=CACHE_MAX - FILE_MAX)
    target = CACHE / (src["key"] + ".mp4")
    part = CACHE / (src["key"] + ".part")
    temporary_meta = CACHE / (src["key"] + ".json.part")
    started = time.monotonic()
    def remaining(reserve=0):
        seconds = JOB_TIMEOUT - (time.monotonic() - started) - reserve
        if seconds <= 0:
            raise OSError("playback_copy_deadline_exceeded")
        return seconds
    try:
        if shutil.disk_usage(CACHE).free < 160 * 1024 * 1024:
            raise OSError("insufficient_temporary_playback_space")
        original = probe(src["url"], timeout=min(30, remaining()))
        if original["fps"] < 24:
            raise SourceFrameRateError(original["fps"])
        hardware = (Path("/dev/dri/renderD128").exists() and
                    Path("/usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so").is_file())
        decoder = "software"
        if hardware:
            environment = dict(os.environ, LIBVA_DRIVER_NAME="i965")
            try:
                result = subprocess.run(transcode_command(src, part, hardware=True),
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=environment,
                    timeout=min(remaining(30), max(45, original["duration"] * 3 + 30)))
            except subprocess.TimeoutExpired:
                result = None
            if result is not None and result.returncode == 0:
                decoder = "vaapi"
        if decoder == "software":
            # Unsupported old codecs/orientation filters fail into the tested
            # low-priority software path, never back into the original file.
            part.unlink(missing_ok=True)
            result = subprocess.run(transcode_command(src, part), stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, timeout=remaining(30))
        if result.returncode or not part.is_file() or not 10000 <= part.stat().st_size <= FILE_MAX:
            raise OSError("playback_copy_generation_failed")
        output = probe(part, timeout=min(30, remaining()))
        if (output["width"] > 1280 or output["height"] > 720 or output["fps"] < 29.9 or
                abs(output["duration"] - original["duration"]) > max(.5, original["duration"] * .015)):
            raise OSError("playback_copy_validation_failed")
        data = {"key": src["key"], "profile": "720p30", "fps": output["fps"],
                "width": output["width"], "height": output["height"],
                "duration": output["duration"], "source_fps": original["fps"],
                "source_kind": src["source_kind"], "bytes": part.stat().st_size,
                "decoder": decoder,
                "generated_seconds": round(time.monotonic() - started, 2),
                "original_unchanged": True}
        temporary_meta.write_text(json.dumps(data))
        os.chmod(part, 0o600)
        os.chmod(temporary_meta, 0o600)
        os.replace(part, target)
        os.replace(temporary_meta, target.with_suffix(".json"))
        trim_cache(protected=(target,))
        return data
    finally:
        part.unlink(missing_ok=True)
        temporary_meta.unlink(missing_ok=True)


def worker():
    global WORKER
    while True:
        with LOCK:
            candidates = [(key, job) for key, job in JOBS.items() if job["state"] == "queued"]
            for key, job in candidates:
                if time.monotonic() - job["touched"] > QUEUE_TTL:
                    JOBS.pop(key, None)
            candidates = [(key, job) for key, job in JOBS.items() if job["state"] == "queued"]
            if not candidates:
                WORKER = None
                return
            key, job = min(candidates, key=lambda item: item[1]["created"])
            job["state"] = "preparing"
            job["started"] = time.monotonic()
        try:
            data = build(job["source"])
            with LOCK:
                job.update(state="ready", data=data, finished_at=time.monotonic())
        except (OSError, ValueError, IndexError, subprocess.SubprocessError, urllib.error.URLError) as error:
            with LOCK:
                job.update(state="failed", error="source_below_24fps" if str(error) == "source_below_24fps" else "smooth_playback_unavailable",
                           source_fps=getattr(error, "source_fps", None),
                           failed_at=time.monotonic(), failure_reported=False)


def prepare(src):
    global WORKER
    cache_home()
    ready = cached(src)
    if ready:
        return {"ok": True, "state": "ready", **ready[1], "playback_url": src["route"] + "?playback=hub"}
    with LOCK:
        now = time.monotonic()
        for key, old in list(JOBS.items()):
            terminal_at = old.get("failed_at", old.get("finished_at", old["touched"]))
            if (old["state"] in ("ready", "failed") and
                    old.get("error") != "source_below_24fps" and now - terminal_at > 90):
                JOBS.pop(key, None)
        job = JOBS.get(src["key"])
        retry = (job and job["state"] == "failed" and job.get("failure_reported") and
                 job.get("error") != "source_below_24fps")
        if job and (job["state"] == "ready" or retry):
            # A bounded cache can evict an older result. It must be generated
            # again before the UI is told that its byte-range URL is ready.
            # Report each transient failure once, then allow the existing UI's
            # next prepare request (Retry) to start a genuinely new attempt.
            JOBS.pop(src["key"], None)
            job = None
        if not job:
            if sum(x["state"] in ("queued", "preparing") for x in JOBS.values()) >= MAX_PENDING:
                return {"ok": False, "state": "failed", "error": "playback_queue_busy"}
            job = {"state": "queued", "source": src, "created": now, "touched": now}
            JOBS[src["key"]] = job
        job["touched"] = now
        if WORKER is None and job["state"] == "queued":
            WORKER = threading.Thread(target=worker, daemon=True, name="security-playback-copy")
            WORKER.start()
        if job["state"] == "failed":
            job["failure_reported"] = True
        return {"ok": job["state"] != "failed", "state": job["state"], "profile": "720p30",
                "source_kind": src["source_kind"], "playback_url": src["route"] + "?playback=hub",
                "elapsed_seconds": round(now - job.get("started", job["created"]), 1),
                "timeout_seconds": JOB_TIMEOUT + 40, **job.get("data", {}),
                **({"source_fps": job["source_fps"]} if job.get("source_fps") else {}),
                **({"error": job["error"]} if job.get("error") else {})}


def serve(handler, path, data):
    size = path.stat().st_size
    start, end, code = 0, size - 1, 200
    value = handler.headers.get("Range", "").strip()
    if value:
        match = re.fullmatch(r"bytes=([0-9]*)-([0-9]*)", value)
        if not match or not any(match.groups()):
            return range_error(handler, size)
        a, b = match.groups()
        if a:
            start = int(a)
            end = min(size - 1, int(b)) if b else end
        else:
            start = max(0, size - int(b))
        if start >= size or end < start:
            return range_error(handler, size)
        code = 206
    # Open before headers: cache eviction cannot invalidate an active response.
    with path.open("rb") as file:
        file.seek(start)
        handler.send_response(code)
        for key, value in {"Content-Type": "video/mp4", "Content-Length": str(end - start + 1),
                           "Accept-Ranges": "bytes", "Cache-Control": "private,no-store",
                           "X-Content-Type-Options": "nosniff", "X-S9-Media-Source": "hub-derived-720p30",
                           "X-S9-Source-FPS": str(data["source_fps"])}.items():
            handler.send_header(key, value)
        if code == 206:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        handler.end_headers()
        if handler.command == "HEAD":
            return
        remaining = end - start + 1
        try:
            while remaining:
                chunk = file.read(min(65536, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


def range_error(handler, size):
    handler.send_response(416)
    handler.send_header("Content-Range", f"bytes */{size}")
    handler.send_header("Content-Length", "0")
    handler.end_headers()


def janitor():
    while True:
        try:
            trim_cache()
        except OSError:
            pass
        threading.Event().wait(300)


def install(handler_class, phone_rows):
    global JANITOR
    if JANITOR is None:
        JANITOR = threading.Thread(target=janitor, daemon=True, name="security-playback-expiry")
        JANITOR.start()
    original = handler_class.go
    def go(handler):
        parsed = urllib.parse.urlsplit(handler.path)
        query = urllib.parse.parse_qs(parsed.query)
        mode = query.get("playback", [""])[0]
        match = ROUTE.fullmatch(parsed.path)
        if mode not in ("prepare", "hub") or not match:
            return original(handler)
        try:
            src = source(match.group(1), match.group(2), phone_rows)
            if mode == "prepare":
                handler.js(200, prepare(src))
                return
            ready = cached(src)
            if ready:
                return serve(handler, *ready)
            handler.js(409, {"ok": False, "state": "preparing", "error": "playback_copy_not_ready"})
        except (OSError, ValueError, urllib.error.URLError):
            handler.js(503, {"ok": False, "state": "failed", "error": "smooth_playback_source_unavailable"})
    handler_class.go = go
