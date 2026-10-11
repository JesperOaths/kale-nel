# S9+ Security interface V4 — C720P HTML-only release

**Deployed to C720P on 11 October 2026, 05:37 UTC; verified at 05:39 UTC.**

This is **step 1 only** of the surveillance rebuild. No changes were made to the S9+ APK, live person detector, microSD recordings, face models or video relay implementation.

## Actual installation evidence

A purpose-specific transaction installer ran as C720P agent job **10050**, finished **done**, exit code **0**, one attempt, no stderr, and confirmed both page contents by readback and reapplication stability.

Pinned tested HTML-only source commit:

`7683150199ca2f69ac4b238c0a01502c0fb137c7`

Installed paths and SHA-256 of HTML content:

| C720P path | SHA-256 |
| --- | --- |
| `/opt/homeassistant/config/www/frontyard-security-new/clips.html` | `6ed2065c4ce55e32bd700689c07db2d3a7ff1e1e3717e6e3d80edc8c03e08bd9` |
| `/opt/homeassistant/config/www/c720p-surveillance.html` | `80b3b87bd065b5f3f20c9175fc14e43c8fc27537244894df550c71fc1e220d2d` |

Automatic rollback backup folder:

`/home/jespern/c720p-home-hub/backups/security-ui-v4/20261011T053734275099Z`

The installer saved the pre-change originals before writing either HTML target; after writing, it read the installed files back and confirmed every new patch was idempotent.

## UI behavior

- A **single recording browser** embedded in Home Assistant Security Saved Clips.
- Horizontal dates, previous/next navigation, compact cards with a time and direct one-click playback.
- Date colour markers and visible legend for *Person likely* (green), *Possible person* (amber), *Animal* (purple), *Vehicle* (blue), *Other motion* (slate) and *Unreviewed* (light grey).
- True saved-player maximum **360 px wide × 220 px high** on desktop; remaining width is available for the selector.
- Live camera pane constrained to **70dvh** for tall displays, with mobile/short-screen rules and scrolling. Native capture and stream bitrate/resolution remain untouched.
- Existing face, manual-thumbnail-review and anonymous appearances panels preserved in source; historical Drive tab retained.
- Existing authenticated signed playback and MP4 rotation helper retained.

## Scope and acceptance limits

The remote job verified **HTML files and code contracts** on C720P. It did **not** capture a rendered browser screenshot, measure actual CSS boxes in the kiosk, prove a particular recording was successfully played, or modify any model-generated category labels. Visual/kiosk acceptance and signed playback acceptance are separate checks. Source-only tests also pass in the dedicated GitHub Actions UI workflow.

For source-level validation:

```bash
python3 ops/c720p/s9-native-security/test-security-date-category-folders.py
python3 ops/c720p/s9-native-security/test-security-compact-layout.py
python3 ops/c720p/s9-native-security/test-deploy-security-ui-v4.py
```

The installer is `ops/c720p/s9-native-security/deploy-security-ui-v4.py`; by default it is dry-run and requires `--apply` to write pages. The One-Time Dispatch GitHub workflow was removed after verified installation.

**Rollback:** use the two original backup files from the timestamped backup directory to restore the corresponding HTML files atomically if rendered UI validation fails. This release does not alter source MP4s or the camera package.
