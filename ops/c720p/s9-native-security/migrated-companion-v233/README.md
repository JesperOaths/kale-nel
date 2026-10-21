# S9 migrated metadata companion V233

This is a **source-pinned, unsigned, unenrolled build artifact**, not a live Save/Delete service or permission to install it.

## Packaging and evidence

- Dedicated Android package: nl.kalenel.s9migrated; separate UID from Camera2.
- Source revision f3d5c00006d5147f1cff08e02c70c367e81533bb; 20 Java source SHA-256 values in source-pins.json.
- Android min SDK 29, target SDK 28 (Android 10 storage compatibility), and READ_EXTERNAL_STORAGE declaration. User/device permission is NOT granted by packaging.
- Manifest has no exported components, activities, services, receivers, providers or autostart; debuggable, backups and cleartext traffic are disabled.
- Python build_unsigned.py compiles against Android SDK 36, using javac/d8/aapt/zipalign. It verifies source hashes and rejects a pre-signed result. It never signs, installs, enrolls a key, opens a network listener, removes media or changes human reviews.
- Physical C720P host proof on 2026-10-21: 20 pinned Java sources, 57 Java class outputs, dex and exact package in a 36,236-byte unsigned APK. SHA-256: 56faffdf005532eac66f95ed0ede132538b008b840e2d97fc9e51d6ab02e992a. Android apksigner correctly refuses it as unsigned.

## Trusted enrollment requirements, not performed

1. A separately authenticated human **owner or explicitly delegated release administrator** must independently validate the exact six copied original MP4 SHA-256 digests, names and sizes against independently obtained C720P original evidence. The six total 214,181,934 bytes. S9MigratedApprovedSixDigestV230 computes the canonical SHA-256 over the V216 six-source manifest preimage, generation 1. The human must explicitly approve that exact digest; neither a browser nor a packaged app can self-attest it.
2. The approved release administrator must safeguard and approve a separately controlled APK signing identity and verify the final dedicated package UID and signing certificate. No debug-key fallback or Camera2 UID sharing. The real Android permission grant requires normal platform consent.
3. A future authenticated local enrollment entrypoint **must be implemented**: it passes an actual once-only human VirginApproval into S9MigratedAndroidThreeKeyOwnerV227.enrollFirstOnly, writes a fsynced irreversible intent BEFORE generating distinct NONEXPORTABLE Android Keystore HmacSHA256 keys for the internal checkpoint, microSD journal and source manifest. After a partial failure it must not silently rotate, clear or retry keys. S9MigratedSealedManifestEnrollmentV220 creates the first private, HMAC-sealed six-source manifest. The independently protected source digest and minimum generation cannot come from a remote request or microSD.
4. A future authenticated on-phone service **must be implemented**. It must independently verify the actual S9 original SHA and current source generation on each action. Hub/Chat3 relay signs separately approved user intent; V231 strict canonical 14-field wire, V198 HMAC/time, V201 human/source gates, V197 journal-and-checkpoint fsync and V232 lock-consistent head/decision readback are mandatory in that order. Typed state saved_metadata/deleted_tombstone, plus no_remote_decision in read-only V225, is not physical deletion permission. A pending/unbound state is never local Unsaved.
5. Before accepting live Save/Delete, prove a real signed installed companion, owner-approved enrollment, source bytes, network outage and reconnect, process restart and **physical phone reboot**, replay/nonce refusal, truncated journal/power-failure behavior, signed browser action, and independent HA fallback. Six C720P original MP4s, 17 JPEGs, every human decision and 48 historically unbound decisions remain untouched until separately authorized.

V233 has **no operational Android component or remote action handler**. Do not treat package compilation or host-JVM synthetic tests as production acceptance. No first-enrollment trust decision, production signer, app-private running service, UI/relay activation, or remote Save/Delete receipt exists yet.

## Reproducibility and rollback

Run python3 build_unsigned.py with Android SDK platform 36 plus javac, d8, aapt, zipalign, apksigner. The script obtains SHA-pinned source bytes from the immutable revision. For already checked local source copies, set S9_COMPANION_PINNED_SOURCE_DIR and S9_COMPANION_STAGING_DIR. The output root is private (0700); unsigned APK owner-only (0600). No installation or original-media action occurs, so rollback requires only retaining/removing the disposable unsigned build output. Future production key custody must be separate and owner-approved.
