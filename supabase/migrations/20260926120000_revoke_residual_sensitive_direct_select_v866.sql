begin;
revoke select on table
  public.players,
  public.beerpong_matches_v668,
  public.boerenbridge_matches_v668,
  public.klaverjas_active_match_presence,
  public.paardenrace_room_players
from anon, authenticated;
commit;
