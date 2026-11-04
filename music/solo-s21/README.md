TUNE RUSH SOLO FOR SAMSUNG S21
================================
Architecture
- Samsung S21 Termux/Python: session/score authority, Audius catalog and track
  selection, answer matching, state persistence and remote music relay.
- Laptop browser: renders UI, takes keyboard input and plays short audio clues.
- No Supabase, Home Assistant, C720P process, cloud game backend or downloaded
  track library is needed. Existing multiplayer site is unchanged.

On-phone application: ~/tune-rush-solo
On-phone service port: 8797 (dual-stack LAN HTTP)
Persistence: ~/.tunerush-solo/state.json, readable only by Termux app user
Phone program start: ~/tune-rush-solo/start-solo.sh

Once started, open this URL from the laptop while connected to the same local
IPv6 network as the S21:
http://[S21_IPV6_ADDRESS]:8797/
The S21's IPv6 prefix can change if the Wi-Fi network changes. Discover the phone's IPv6 address from Android Wi-Fi details or ADB. Hostnames and IPv6 prefixes may change.

IMPORTANT:
The service restricts clients to local/private LAN addresses and, for public
IPv6 addresses, the S21's own /64 subnet. No inbound internet access is
intended. Use the URL on a trusted Wi-Fi/LAN only. No HTTPS/mixed-content
shortcut through https://kalenel.nl/music/ is attempted.

The official Audius catalog does not guarantee famous chart hits. Decade
filters use Audius metadata rather than the year a song was first written.
Audio is streamed from Audius to S21 and relayed to the laptop; no music bytes
are intentionally saved by the service. The browser may temporarily buffer
clues.

Single-player rules: one attempt per field per clue; each correct title or
artist +0.5 points, wrong attempt -0.5 with score floor at 0. Up to seven
clues (0.5 to 20 seconds) per track. Songs are not repeated within a session.
After revealing a song, progress to next, or finish and copy the setlist.

Service starts when invoked, not automatically at Android reboot.
If Android terminates Termux, restart using start-solo.sh. On some devices
Termux battery optimization settings affect long-running background sessions.



Repository packaging and CI
---------------------------
The phone UI is intentionally stored as web/index.html.src rather than a
publishable .html file. This keeps an account-free, S21-LAN-only interface out
of the authenticated public GEJAST site's HTML route inventory. Do not expose
it at https://kalenel.nl/ or weaken any site-wide login gate for it.

Run from the repository root:
    sh music/solo-s21/package.sh /tmp/tunerush-s21-solo.tar.gz
The archive contains web/index.html and can be extracted into
/data/data/com.termux/files/home/tune-rush-solo on the phone.

Start start-solo.sh from the actual Termux app/service context. Launching
Python directly from adb shell run-as uses Android's runas_app SELinux context,
which cannot reliably resolve DNS or accept connections from the LAN. On
Samsung Android 15, permitting Termux foreground/background activity may be
needed to keep the process alive when the screen locks. The server is not a
replacement for the public multiplayer service.
