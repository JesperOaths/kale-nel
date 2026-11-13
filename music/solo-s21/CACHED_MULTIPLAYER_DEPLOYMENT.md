# Tune Rush cached multiplayer — deployment / rollback handoff

## Verified components

* Public page: `/music/multi/` (new Solo-style layout). Production legacy `/music/` remains the working rollback while native S21 port 8798 is not installed.
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
* Do not merge PR #1272 or put `/music/multi/` as the default multiplayer route before **actual** phone+tablet acceptance. Legacy `/music/` remains fallback.

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

## Outstanding blocker (2026-11-13)

S21 native Solo service is healthy but no authorized remote shell is available: wireless ADB is not advertised, and ports 5555/8022/2222 are closed. **Do not pretend the cached multiplayer is live until that access is restored and a real two-client game passes.**
