GEJAST v697 - Pikken, Paardenrace responsiveness, Profiles speed

Upload/copy the included site files, then run:

GEJAST_v697_pikken_paardenrace_profiles_speed.sql

What this patch fixes:

1. Pikken live bid error
- Adds public._pikken_count_bid_hits(integer[], integer).
- Adds a numeric overload that delegates to the integer helper.
- Counts normal bids by matching the bid face plus piks/ones.
- Counts a bid on pik/one as piks only, except a full 1-2-3-4-5-6 straight counts as 6 piks.
- Keeps dice totals in the state payload so the live page can show the correct 12/12 style table total instead of falling to 0/0.

2. Pikken live table behavior
- Dice render in the former status layer area.
- Dice are ordered 2, 3, 4, 5, 6, pik.
- Lobby participants are sent to the live page once the game starts.
- Deleted/ended games clear the local participant pointer and return to the lobby instead of hanging.

3. Paardenrace lobby responsiveness
- Maak lobby now creates an optimistic local lobby instantly while the server confirms.
- The open-lobbies list gets an immediate local lobby card.
- Destroy/hef room op clears the lobby instantly and then confirms with the backend.
- Polling is shortened from 1.2s to 0.8s and avoids overwriting optimistic UI while create/destroy is in flight.
- The hot room-state loader no longer runs cleanup before every state fetch, preventing the half-second show-then-disappear behavior.

4. Profiles page speed
- Active player names load first through the lightweight active-login/name RPCs.
- Full profile stats hydrate afterward.
- Badge gallery rendering is deferred to idle/background time.
- Profile cache now uses sessionStorage and localStorage for faster repeat opens.

Notes:
- This patch does not fake admin/account RPCs.
- If Supabase reports overloaded/ambiguous functions, drop the older overloaded signatures first as in v692-v694 cleanup patches, then rerun this SQL.
