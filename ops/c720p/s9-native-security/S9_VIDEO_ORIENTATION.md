# S9+ saved video orientation: non-destructive correction

## Known source issue

The standalone Camera2 recorder previously fixed its MP4 playback orientation hint
to 90 degrees, independent of the S9+ physical mounting angle. That can make
some clips look sideways or upside down. The older S9 recording applications
may have different policies, so **do not rotate all archived files by 90 degrees**.

A MediaRecorder orientation hint is MP4 display metadata; it does not rotate
3840×2160 encoded pixels. The authenticated archive proxy streams exact MP4
bytes and supports byte ranges; it does not transcode or rotate video.

## Safe playback correction

`patch-s9-saved-video-orientation.py` adds Rotate left 90°, Rotate right 90°,
and Reset display controls to HTML5 video players in the existing Home Assistant
Security saved-clips page. Each selected correction is saved per MP4 **filename**
in that browser's localStorage. It is not an edit to the phone, microSD, signed
manifest, video, or Home Assistant API; browser storage does not synchronize
between different browsers or devices. Old MP4s remain verifiable and unmodified.

The first production player (deployed 10 October 2026) provides manual, per-clip
rotation controls. A subsequent source revision (PR #442) additionally suggests
a +90° CSS correction for native `motion_*.mp4` clips that Chromium reports as
portrait despite 3840×2160 landscape pixels; manual per-clip choices override it.
**Do not claim that the PR #442 auto-correction is deployed until an actual
Home Assistant browser confirms it.** Legacy `rec_*.mp4` clips are never
auto-rotated. CSS display rotation may not apply inside browser/OS-managed
fullscreen playback.

The tool defaults to a dry run. On the C720P, after reviewing source pinned to
a specific revision and running the regression test:

```bash
python3 ops/c720p/s9-native-security/test-s9-saved-video-orientation.py
python3 ops/c720p/s9-native-security/patch-s9-saved-video-orientation.py
python3 ops/c720p/s9-native-security/patch-s9-saved-video-orientation.py --apply
```

The patch writes only `clips.html`, creates a timestamped private backup
under `/home/jespern/c720p-home-hub/backups/s9-orientation/` (mode 0600),
and performs an atomic replace. It does not restart Home Assistant, the signed archive, or Camera2.
Only run `--apply` from an authorized C720P shell after checking the page
contract and ensuring no concurrent HTML deployment.

## Fixing future recordings

The native Camera2 source supports `recording_rotation` values `auto`, `0`,
`90`, `180` and `270`, retained in Android SharedPreferences. `auto` uses the
rear-camera sensor and Android display orientation; it was **not reliable for
this stationary S9+**, where multiple real 3840×2160 clips carried a `-90°`
display matrix. Locking Android's display to landscape did **not** fix it and
was reverted. The correct stationary-camera setting is **`0°`**, verified
through the native `/controls` and `/status` APIs. Changes apply to future
MP4 display matrices only; old recordings, thumbnails, classifiers and stored
files remain untouched. Control changes are refused during active recording.

**A repository change is not a live APK install.** Deploy Camera2 changes only
with the previously verified signed-APK rollback procedure in a healthy idle
window. Then record a short controlled test clip with a recognizable vertical
reference and review playback. If the orientation is wrong, adjust the control
and create another test clip; do not rewrite earlier evidence.

## Verified 10 October 2026 production actions

- Merged PR #440 (manual playback rotation) and PR #441 (restored source
  sensor-aware default); the HTML-only patch was deployed and browser-rendered
  successfully on the C720P
- Inspected eight saved-video frames: four native Camera2 and four legacy S9+.
  Three of the four native examples appeared sideways/portrait; four legacy
  examples appeared upright
- Direct `ffprobe` on the faulty native samples found `rotation: -90`, while
  their encoded dimensions remained 3840 × 2160
- Reverted a trial Android landscape lock after two **post-lock** recordings
  still contained the same faulty rotation matrix
- Fixed immutable APK source fetch/staging to include CameraOrientation.java
  in PR #445, then built and signed source `8488f25bc8cecd0d7985d233a7733a9064288624`
- Installed APK SHA-256
  `b4f8e95ca9a7019860f876ef3338922b15ca0232deb9ea4fc785d38ac1f592e7`
  with matching existing signing certificate, rollback APK saved, camera and
  GPU pipeline healthy
- Saved `recording_rotation=0` through the new Camera2 native control API;
  both `/controls` and `/status` reported effective 0°
- Preserve original MP4 bytes and manifests. A fresh post-override recorded
  MP4 must still be checked for a zero rotation matrix before declaring
  complete end-to-end capture acceptance

On the C720P only, read the current effective native rotation without a
restart via `http://127.0.0.1:18808/controls`; the same loopback bridge
provides `/status`. The native `/control` endpoint accepts a bounded JSON
POST with `{"key":"recording_rotation","value":"0"}` while the camera is in
`watching` mode. Keep this endpoint on local authenticated/trusted paths
only, never expose it publicly.

## Metadata inspection and genuinely embedded wrong rotation

Before deciding any original file needs editing, compare the physical scene,
actual displayed video, coded dimensions, and MP4 display matrix, e.g.:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height:stream_side_data=rotation \
  -of json sample.mp4
```

A display-matrix correction can sometimes be performed by an MP4 stream-copy
remux rather than re-encoding. However, even a lossless remux changes the MP4
bytes and invalidates the SHA-256 in its verified manifest. Therefore there is
**no unattended batch remux, overwrite, or archive promotion** in this release.
A separate process must first produce independent reviewable outputs, retain
originals, verify duration and decoding, record new hashes and preserve
provenance. Rotation direction cannot be inferred reliably from dimensions alone.

## Acceptance checklist

- New correction widget is visible for an authenticated saved MP4.
- 90°/180°/270°/reset show the expected physical upright picture.
- The correction reappears when reopening the same clip in the same browser.
- A second unrelated clip starts with its own saved correction (or 0°).
- A clip without filename metadata is not given another clip's persisted angle.
- MP4 byte-range seeking, camera MJPEG, and archive counters remain unchanged.
- On a signed APK upgrade, Camera2 resumes watching and a new verified 4K test
  clip reflects the selected recording rotation.

No device-level acceptance was performed by merely committing this source.
