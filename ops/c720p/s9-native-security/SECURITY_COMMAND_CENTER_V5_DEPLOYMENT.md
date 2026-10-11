# Security Command Center V5 — C720P production installation

On 11 October 2026, C720P agent job **10068** completed `done`, exit code `0`, first attempt, no stderr. The C720P ran pinned source `34dd6dcef35c124c5daa7d7bb2764b4e88f1898d`, verified all staged Git blob digests, passed local V5 tests, dry-ran four HTML targets and applied a transactional install with readback.

Backup: `/home/jespern/c720p-home-hub/backups/security-command-center-v5/20261011T054941606634Z`.

| Installed page | SHA-256 verified on C720P |
| --- | --- |
| `/opt/homeassistant/config/www/c720p-surveillance.html` | `e1413558441b646fce82f4483f26e6e1e750385a0f47fafba0932f171095522d` |
| `/opt/homeassistant/config/www/frontyard-security-new/clips.html` | `9c4c8a2da3fd81eb797d005ac7ca7979db723937366cb65c182dc0b7a05c9b2b` |
| `/opt/homeassistant/config/www/frontyard-security-new/face-appearances.html` | `dcef35e0ee41186a1828ba632daabf0b53d804845e8f60e5907fd5c0b60e4ab3` |
| `/opt/homeassistant/config/www/c720p-drive-saved.html` | `beaa904ebf414fc41a61201eaeaa9205ba618ae776d6b689f1db32e0d75bd6cb` |

Changes: full viewport dark responsive navigation, a new health/recordings/person evidence/storage overview, separate live preview and diagnostics rail, microSD gallery, consistent Faces and Drive archive styling. Existing live-stream tab transitions are called through original event handlers. Signed media relay, recorders, clips, face data and APK were **not changed**. Original HTML files backed up and atomic restoration is available.

**Verification limit:** HTML source, JavaScript syntax, four-page update and installed SHA-256 have passed. A live, authenticated browser interaction/screenshot and actual 4K playback remain separate runtime acceptance tests; do not infer their success from HTML readback alone.

Source tests: `python3 ops/c720p/s9-native-security/test-security-command-center-v5.py`.
