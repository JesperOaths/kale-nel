## Storage-first continuation (2026-10-10)

Latest confirmed health report at 20:15 CEST: root free 101.4 MiB,
94.3% used; three ADB devices; voice listeners report open ports. No
C720P cleanup or S9+ transfer has been executed from the current session.

Prioritize the audited `reclaim-safe-cache-20261010.py`:
- Default invocation is read-only and shows candidate sizes and directory usage.
- `--apply` deletes only exact allowlisted regenerable cache trees when idle,
  plus best-effort `sudo -n apt-get clean` and old journal vacuum.
- Browser login state, S9+ SD, security recordings, all HA databases and
  configuration, archived clips, user documents and backups remain untouched.
- Compare `free_before_bytes` and `free_after_bytes` from the same device.
- If free space is still below 900 MiB, inspect reported top directories
  before any additional removals; do not delete protected clips automatically.

Optional `stage-c720p-clips-on-s9-microsd-20261010.py`:
- Default is inventory only; `--copy` targets only verified
  Samsung S9+ SM-G965F at `192.168.178.250:5555`, on mounted SD
  `/storage/9C33-6BBD`, preserving a 15 GiB reserve.
- Only finalized clips referenced by the existing C720P event index are
  candidates. Copied bytes are SHA-256 verified on-device.
- It writes to an isolated `C720PMigrated` folder and **never** deletes
  originals. Imported clips are not automatically in the current S9+ playback
  catalog; integrate/verify playable URLs before any source retirement.
- Thus `copied_bytes` is not `reclaimed_bytes`. Do not claim space freed
  from transfer alone.

After disk health has improved, run the Assist diagnostic then query-only
intent/TTS canary, then actual microphone and light-command acceptance.
Avoid restarting live camera or Home Assistant services for a voice probe.

---

# C720P voice restoration — execution and verification

Status: staged in GitHub, **not installed on the device**. Preserve existing
S3/S9 camera, media orchestration, bedroom eco timers and HA user session.
Never call successful CI a successful physical voice test.

## 1. Collect passive facts on device

```bash
python3 /home/jespern/c720p-home-hub/ops/c720p/voice-pipeline-diagnostic-20261010.py
```

If that checkout path is not present, use the reviewed version from:
`ops/c720p/voice-pipeline-diagnostic-20261010.py`.
The diagnostic requires no Home Assistant token. It checks:
- `arecord` and PulseAudio microphone/default input
- wake/satellite user service states, recent pattern counts (not transcripts)
- port availability 8123, 8790, 10200, 10300, 10400 and 10701
- Wyoming `describe` responses from Whisper, Piper, wake and satellite
- HA saved Assist pipeline and configured engine fields
- disk free space and HA reachability

**Do not restart Home Assistant or delete anything as a diagnostic shortcut.**
Root free space was approximately 130 MiB in the 2026-10-10 19:39 CEST
telemetry sample. If still under 512 MiB, prioritize isolated, regeneratable
browser/apt caches; protect recordings, camera archives, SQLite DBs and config.

## 2. Verify the actual command engine and TTS path

Use an **existing** operator-owned HA token, passed as `HA_TOKEN` or via a
mode-0600 local `--token-file`. Never generate, print, export to CI, or commit
an authentication token for this test.

```bash
python3 voice-assist-canary-20261010.py
```

The default phrase is query-only: `What time is it?`. It starts at the
`intent` stage and runs through `tts`. The canary reports per-event
milliseconds, structured errors, whether TTS was produced, and whether the
preferred conversation agent is currently available. It **does not** test
microphone, wake detection, transcription or physical speaker playback.

If and only if the preferred conversation agent is demonstrably unavailable
and `homeassistant` is in the live agent inventory, permit the narrowly scoped
repair:

```bash
python3 voice-assist-canary-20261010.py --repair-unavailable-agent
```

This uses HA's authenticated `assist_pipeline/pipeline/update` API, not edits
to Home Assistant's live `.storage` files. It resubmits all pipeline
settings, changes only `conversation_engine`, verifies every retained field,
and attempts rollback if verification differs. The repair does not alter
STT, TTS, language, wake or entity exposure.

Do not claim a fix if the query returns an intent error, even if a spoken
TTS error message is generated.

## 3. Separate remaining failure types

| Failure | Next action |
| --- | --- |
| USB Trust mic not listed or no source | Inspect ALSA/Pulse capture path; keep default output Bluetooth route untouched |
| Wyoming open port but no `info` | Inspect only affected service logs, configuration and subprocess load |
| Preferred HA agent unavailable | Use narrow repair above, re-test and verify settings persisted |
| `stt-no-text-recognized` | Inspect audio gain/noise floor, endpointing, Whisper language/model |
| `stt-stream-failed` | Inspect microphone stream encoding, Wyoming Whisper worker |
| `intent-failed` / `intent-not-supported` | Inspect preferred agent and exposed target entities |
| `tts-failed` or no playback | Check Piper response independently, then Bluetooth/ALSA/Pulse sink routing |
| Correct words, wrong device | Resolve exact entity/area names and Assist exposure; never expose security/lock entities broadly |
| Long latency with correct results | Benchmark wake, STT, intent, Piper and actual audio playback separately |

Home Assistant documented event timestamps:
`wake_word-start/end`, `stt-start/end`, `intent-start/end`,
`tts-start/end`. The canary currently observes only intent and TTS because
the physical microphone is not in its test path.

## 4. Live acceptance (no fabricated results)

Use a fresh, known-idle state and test:
1. "Hey Google, what time is it?" — transcript, intent success, audible reply.
2. "Hey Google, turn on the bedroom lights." — actual entity state changes,
   lamps visibly turn on, audible confirmation.
3. "Hey Google, turn off the bedroom lights." — actual state and audible reply.
4. "Hey Google, turn on the living room lights." — same.
5. Repeat during a normal background workload to measure tail latency.
6. Confirm silence/no-voice periods do not trigger false wakes or lights.

Record completion times and errors without persisting the contents of private
spoken conversations. Benchmark at least 10 real voice commands before
lowering wake threshold or changing the Whisper model. Never reduce
recognition quality blindly to meet a speed target.

## Boundaries

- These files do not install themselves and no remote C720P execution occurred.
- GitHub Actions checks Python syntax and simulated protocol/repair behavior.
- A passed code test is not a Home Assistant integration test.
- Do not use a cloud CI runner or protected database SQL to bypass a restricted
  remote-execution action; deploy through an authorized C720P session.
- No camera capture, motion lighting, TV, HTS or saved clip configuration is
  touched by the staged voice tools.
