# Security hub recorded-video playback

`s9_hub_playback.py` runs inside the existing authenticated archive proxy. It
creates a private, temporary 720p H.264 copy after a viewer selects a recording.
The original phone, local, or Drive video is unchanged and remains available
through its existing URL. No original phone MP4 is copied into the hub cache.

The signed relay must preserve the `playback` query parameter on archive routes:

1. Fetch `/{new|s3}/saved/clip/{basename}.mp4?playback=prepare`.
2. Poll while `state` is `queued` or `preparing`; the JSON supplies a timeout.
3. Play the signed `playback_url` when `state` is `ready`.
4. Expose the original URL without a playback query as the Original option.

The API reports a transient preparation failure once. The next prepare request
starts a fresh attempt, so the interface's Retry button does real work. A stable
`source_below_24fps` failure stays stable for an unchanged source.

The same route accepts an unsaved local video's basename only when that file
exists in the camera's fixed `clips` directory. Other archive sources must pass
the original proxy's indexed HEAD request. Arbitrary source URLs are rejected.

Copies preserve normal-speed timing and optional audio. A single worker runs at
low CPU and I/O priority with two codec threads. Haswell VAAPI decode and resize
are preferred; software decoding is the fallback. Software H.264 encoding is
used because the hub's installed Intel driver has no usable H.264 encode entry.
Output is validated for dimensions, frame rate, and full source duration before
being exposed as a seekable MP4.

The mode-0700 `/tmp/c720p-security-playback` directory holds only derived videos
and their metadata. Completed and in-progress video bytes are bounded at
96 MiB, with a 64 MiB per-copy limit. Unused copies expire after two hours and
the janitor removes them within another five minutes. The cache also disappears
on reboot. It is never served as unauthenticated static media.

## Measured deployment audit, 11 October 2026

- Modern S9 4K examples contained approximately 29.9–30 fps at 36.4 Mbps.
- The C720P browser displayed a recent original 4K clip at approximately
  2.3–4.2 fps with frequent drops and slowed media progress.
- A complete 8.866-second 4K example produced a 1280×720, 30 fps playback copy
  in 7.14 seconds with Intel decoding/resizing. The copy was 904,358 bytes,
  compared with the 40,402,536-byte original. Software-only decoding took
  30.85 seconds in the initial benchmark.
- All six remaining local unsaved originals were probed: four are 1080p24;
  `20261009-202734-1061.mp4` and `20261009-203214-1062.mp4` are 360p4.
- Four historical Drive entries were previously compacted to 720p12. Their
  originals were absent from local clip paths, the active Drive folder, and its
  recoverable Trash during this audit.
- The Drive index has another 118 entries without a recorded playback profile.
  They are probed on request; a complete source-frame-rate audit of all those
  historical videos has not been performed.

Sources below 24 fps return `state: failed`, `error: source_below_24fps`, and
`source_fps`. The interface keeps those originals playable and explains their
recorded frame-rate limit. Missing captured frames are never presented as
recovered camera evidence. The 30 fps playback container for eligible sources
does not claim that its captured source frame rate was increased.

Deploy the helper and `s9_sd_proxy_extension.py` together before updating the
shared browser player. Only the archive proxy needs to reload for these Python
changes; no camera restart or model modification is involved.

Run `test-hub-smooth-playback.py` and
`test-phone-native-media-range-proxy.py` for cache, byte-range, original-fidelity,
queue, partial-output, and low-source-frame-rate regression checks. Actual
browser rendered-FPS checks are additionally required after deployment.
