# Tune Rush cached multiplayer — deployment / rollback handoff

## Current verified deployment — 13 November 2026

**S21 local multiplayer is LIVE and tested:** http://192.168.178.196:8798/
The phone is Samsung SM-G991B (Android-2.local); the above IP can change.
Port 8798 serves the Solo-style UI and same-origin local room API directly.
Local room creation, phone + tablet participants, genuine 500ms cached MP3
(30,302 bytes), host-only audio, buzzer lock, forfeit, reveal, second song,
and finish have passed native HTTP acceptance.
Browser test TUNERUSH_DIRECT_S21_TWO_DEVICE_PASS passed with two independent
device contexts, tablet simultaneously host + player, answer scoring, and
zero Supabase requests. This is automated tablet/phone browser testing,
not a claim that the owner's physical tablet was operated.

Existing Solo 8797 remains healthy; 1,302 stored recordings and 1,000
playable cached songs, with no missing master-catalog tracks. The three-
service S21 watchdog now monitors Solo, phone relay and cached multiplayer.
Termux allow-external-apps remains disabled; a verified ADB app-context
command was used to install without changing that security property.

C720P tunerush-relay.service is running the new vetted multiplayer transport.
Its previous one-file backup is:
/home/jespern/tunerush-relay/hub_relay.py.pre-s21cached-20261113.
Phone file backups are retained in
$HOME/tune-rush-solo/.multiplayer-backup.* directories.

**Cloud-connected multiplayer is not yet activated.** Public Supabase
PostgREST RPC calls still time out despite the project health flag;
the anon EXECUTE grant remains closed. The public root game now links
primarily to the working local multiplayer URL (same home Wi-Fi only).
Keep /music/multi/ as optional cloud mode until public RPC verification
and a real two-client remote test pass. Legacy multiplayer is not removed.

## Verified components

* Public page: `/music/multi/` (new Solo-style layout). The existing `/music/` site remains as a rollback; the new phone service is installed and healthy.
* S21 authoritative game: `multiplayer.py` + `multiplayer_service.py` on port `8798`, separate from Solo `8797`. Only S21 selects permanent-library tracks, validates answers and scores. Guest responses never contain MP3 or hidden metadata.
* C720P outbound `tunerush-relay.service`: the new `hub_relay.py` forwards vetted multiplayer jobs only, with no local music processing.
* Supabase: pre-existing `tunerush_s21_mp_submit_v1` / `tunerush_s21_status_v1` RPCs and queue. `multiplayer-cached-relay.sql` expands the completion gate for at most 1.4MB bounded phone-host MP3 clues. **That SQL was applied 2026-11-13**, and the anon submit grant is intentionally still CLOSED.
* Initial tests: independent phone HTTP privacy, model/scoring, C720P relay unit tests and 2-device browser smoke in CI.

## Scope and safety

* **Never delete or move** the S21 permanent library `$HOME/.tunerush-solo/music-library-v1/tracks/`.
* Never alter working Solo 8797 service, solo state or imported MP3s.
* Install only the minimal cached multiplayer archive; backup only those 5 changed files.
* Do not make the phone's HTTP service publicly internet-routable. Allow LAN + existing outbound relay only.
* Do not grant public RPC access until the phone service and C720P transport both pass health.
* Do not promote `/music/multi/` as the default cloud route before public PostgREST and real remote room acceptance; local multiplayer on port 8798 already passed. Legacy `/music/` remains fallback.

## Staged on the C720P

A checksum-verified phone archive and guarded installer have been staged:
```
/home/jespern/tunerush-deploy-staging-20261113/tunerush-s21-multiplayer.tar.gz
/home/jespern/tunerush-deploy-staging-20261113/install-multiplayer.sh
```
When source code changes, rebuild both from the latest PR branch before installing. Verify archive contents against `MANIFEST.sha256`, and use a fresh SHA-256.

## Phone installation

1. First obtain a legitimate S21 Termux/ADB connection. mDNS name is `Android-2.local`, last IPv4 `192.168.178.196`. The S21 Solo health route is `http://192.168.178.196:8797/api/health`. Neither wireless ADB nor Termux SSH was accepting connections at the last audit; do not confuse the paired S9+ or S3 with S21.
2. Transfer the 12KB release archive and install script to the S21's Downloads directory using the authenticated transfer route.
3. Run the installer **in Termux's own app context** (not `adb shell run-as`, which has an incompatible SELinux network context):
   ```bash
   bash /sdcard/Download/install-multiplayer.sh /sdcard/Download/tunerush-s21-multiplayer.tar.gz
   ```
4. Verify `http://192.168.178.196:8798/api/health` responds with `ready:true`, `source:persistent-library`, and that Solo `8797` is still healthy. Verify native Termux `watchdog.py` supervision on its next controlled restart, without stopping Solo.
5. Install the tested `hub_relay.py` on C720P (backup only original `/home/jespern/tunerush-relay/hub_relay.py`, syntax-check first), restart only `tunerush-relay.service`, and verify worker health and outbound job completion. Preserve original JSON config and secrets.
6. Apply `multiplayer-activate.sql` only at this point. It grants `anon` EXECUTE on one restricted multiplayer submit function; no table grants or worker-secret exposure.
7. Use the isolated public page against real Supabase: create host tablet room, join phone and embedded tablet player, select a mix, start. Verify song chosen from actual S21 library; the tablet receives a bounded MP3 clue at 0.5s, 1.5s and 3s (no Audius); phone never receives audio or mystery answers. Check real buzz lock, wrong/correct title and artist scoring, steal, skip/reveal, next song, finish, room resumption and no duplicate songs.
8. Merge PR #1272 only after the above acceptance. Wait until Pages deploy finishes, then verify new HTML/CSS/JS by SHA-256 and exact cache-key URLs. Preserve the old URL as rollback.

## Rollback

* Disable the optional entry to `/music/multi/` or revert PR #1272 if already merged. No existing Solo or legacy game files need to change.
* Revoke only the multiplayer public activation if necessary:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.tunerush_s21_mp_submit_v1(text,text,text,jsonb,text) FROM anon;
  ```
  Preserve pre-existing RPCs and tables.
* On S21, stop only the port 8798 process (`multiplayer_service.py`), restore only those existing code files backed up by `install-multiplayer.sh`; do **not** touch MP3s, permanent library SQLite, Solo state or other processes. Installer rollback on failed health is automatic.
* On C720P, restore the single saved previous `hub_relay.py` and restart only the user's existing relay service.

## Remaining blocker — public Supabase game API

S21 ADB was connected successfully after secure wireless debugging was enabled.
Native phone port 8798 and same-origin LAN web playback are working.
**The public PostgREST RPC path remains unreliable**: repeated authenticated
RPC requests time out while the Supabase management page reports healthy.
Do not grant anonymous public multiplayer submission privileges or
promote cloud mode until the real queue, authenticated host audio and two
independent remote guests are verified end-to-end. Do not restart a shared
Supabase project without a controlled impact assessment of other apps.
