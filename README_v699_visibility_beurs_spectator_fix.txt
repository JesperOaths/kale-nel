GEJAST v699 - visibility, Beurs speed, spectator instances

Run this SQL after copying the files:

GEJAST_v699_visibility_beurs_spectator_fix.sql

Fixes included:

1. Pikken logged-in detection
- The player session token lookup now checks the known session keys and also scans account/login/session JSON payloads in localStorage and sessionStorage.
- This prevents the live page from saying "Je bent niet ingelogd" when the account runtime stored the token under a newer/different key.

2. Paardenrace lobby visibility
- The page now accepts open-room RPC responses as arrays or as { rows/items/lobbies/rooms } objects.
- The SQL recreates get_paardenrace_open_rooms_fast_v687 as a public read that returns visible rooms for everyone in the scope.

3. Beurs d'Espinoza
- Dashboard loads cache-first and refreshes live data after first paint.
- The Beurs page now has an inline "Maak market" box.
- The Beurs page now has a "Mijn/admin markets" management box with resolve/refund/delete controls when an admin token is present.

4. Spectator instances
- klaverjas_spectator.html redirects to klaverjas_live.html?spectator=1.
- klaverjas_live.html hides host update controls in spectator mode and polls faster.
- boerenbridge_spectator.html redirects to boerenbridge_live.html?spectator=1.

No zip is created for this update.
