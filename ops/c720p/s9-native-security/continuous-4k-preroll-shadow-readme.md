# S9+ continuous 4K pre-event recorder — staged shadow prototype

**14 October 2026 — NOT deployed / NOT enabled on S9+.**

The production S9+ is running the guarded **v3** 640×480 pre-roll + 4K event recorder.
That fallback was live-verified using a **7.595s 640×480** prelude plus an
**8.795s 3840×2160** event, both decoded and original footage retained.
Do not change or disable it simply because this prototype compiles.

## Verified device conditions

Read-only C720P → authorized S9+ ADB diagnostic job 10927:
- Device: **SM-G965F**, Exynos 9810.
- Native GPU person detection works. Phone reports 4K events active.
- 640×480 preview-only session currently feeds the low-resolution buffer.
- At that diagnostic: 8.992s buffered, no reported pre-roll encoder drops,
  35.1°C reported temperature, camera `watching`, no frame gap.
- Device vendor `/vendor/etc/media_codecs.xml` inspection (job 10929)
  lists `OMX.Exynos.AVC.Encoder` up to 3840×2160; declared support is
  **not proof** of 24/7 temperature stability or this stream combination.

## Shadow components

- `Encoded4KRing.java`: immutable compressed AVC access units with
  monotonic microsecond PTS, nine-second / 72 MiB bounded in-memory retention,
  select keyframe BEFORE seven-second target, refuse prefixes under 5.5 seconds.
  No 4K pixels or raw YUV frames stored in the ring.
- `Continuous4KEncoder.java`: separate opt-in hardware codec component using
  `COLOR_FormatSurface`; can receive a 3840×2160 Camera2 stream and write
  prefix + live AVC frames through **one** `MediaMuxer` without 640p→4K
  resolution conversion. Bounded disk-writing queue, atomic final publish,
  4K metadata validation, and failure callback preserving .recording partials.
  It is **not** yet integrated into `CameraService`.
- `tests/Encoded4KRingTest.java`: JVM simulation validates seven-second
  keyframe selection, cold-ring refusal, byte limit, PTS ordering and
  continuous packet lineage. Passed on C720P (jobs 10932 and 10935).
- Compiled Android codec prototype on C720P against installed Android SDK
  (jobs 10935 and 10937). Compilation is not on-device runtime validation.

## Correct architecture (remaining)

1. Integrate `Continuous4KEncoder.inputSurface()` with existing 640×480
   YUV detector surface in **one persistent** Camera2 capture session using
   RECORD request, while replacing only low-res pre-roll—not GPU classification.
   Do not run competing 4K MediaRecorder encoders in parallel.
2. Gate enabling behind authenticated, **disabled-by-default** setting, idle
   and healthy checks, signed APK backup, codec surface/capture-session
   verification and automatic rollback. Preserve the verified v3 fallback.
3. One-shot 4K diagnostic: measure actual hardware output format,
   frame timestamps, ≥5.5-second decoded pre-event prefix, 4K event,
   contiguous timestamp handoff, final single MP4 duration, retained 4K
   resolution and zero missing frames at trigger.
4. Do sustained temperature, battery, GPU inference, FPS, memory, microSD
   availability and repeated-motion testing on the real SM-G965F.
   **Fail closed** and switch back to working v3 if camera failures,
   unacceptable thermal load, frame loss, invalid 4K, missing pre-roll,
   high-memory pressure or delayed video finalization occur.
5. Update archive to distinguish archival full-resolution MP4 from low-power
   360p/720p **playback** derivative; never label an exported 720p copy as
   original 4K. User-visible 4K download must be retained.

## Policy

No timers, ChatGPT background jobs, changes to unrelated phones, cloud
uploads, or deletion of production original MP4s. Compile and JVM-test alone
**must never be represented as a deployed continuous 4K recorder**.
