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

The code does not inspect or infer scene orientation automatically. An operator
must view each clip and choose its upright angle. Clips that already display
upright should remain at 0° correction. CSS display rotation may not apply when
the player enters a browser/OS-managed fullscreen mode.

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

The source now supports an explicit `recording_rotation` Camera2 control
with exact values `0`, `90`, `180`, or `270` degrees, retained by Android
SharedPreferences. The default stays **90°** for backward compatibility until
the correct stationary camera mounting orientation has been visually verified.
Changing this option while watching affects **future MP4 display matrices only**,
not the current preview, frames, motion detection, stored clips, or stream.
It is disabled while recording.

**A repository change is not a live APK install.** Deploy Camera2 changes only
with the previously verified signed-APK rollback procedure in a healthy idle
window. Then record a short controlled test clip with a recognizable vertical
reference and review playback. If the orientation is wrong, adjust the control
and create another test clip; do not rewrite earlier evidence.

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
