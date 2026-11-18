-- Klaverjassen guest room: preserve complete 16-round games and untimed roem decisions.
-- Existing SECURITY DEFINER function and grants are preserved by CREATE OR REPLACE.
-- Does not touch any game rows, auth grants, RLS policies or other functions.
-- A 120 KB state limit rejected fifth-round saves because previous rounds and
-- their recovery snapshots were duplicated. Client snapshots are now compact,
-- but full 16-round history is retained. Raise the bound to 500 KB.
-- Once a human explicitly declines roem, allow collecting after the normal
-- 1-second animation floor; do not force the old 5-second pending-roem window.
DO $kj_room_guard$
DECLARE
  source_body text;
  old_size constant text := 'octet_length(incoming::text)>120000';
  new_size constant text := 'octet_length(incoming::text)>500000';
  old_roem constant text := E'      and coalesce((s->''pending_trick''->>''klopped'')::boolean,false)=false\n      and now() < r.trick_completed_at + interval ''5 seconds'' then';
  new_roem constant text := E'      and coalesce((s->''pending_trick''->>''klopped'')::boolean,false)=false\n      and coalesce((s->''pending_trick''->>''roem_declined'')::boolean,false)=false\n      and now() < r.trick_completed_at + interval ''5 seconds'' then';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO STRICT source_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='klaverjassen_guest_v1';
  IF position(old_size IN source_body)>0 THEN
    source_body := replace(source_body,old_size,new_size);
  ELSIF position(new_size IN source_body)=0 THEN
    RAISE EXCEPTION 'Unexpected guest-room state-size guard, no changes applied';
  END IF;
  IF position(old_roem IN source_body)>0 THEN
    source_body := replace(source_body,old_roem,new_roem);
  ELSIF position(new_roem IN source_body)=0 THEN
    RAISE EXCEPTION 'Unexpected guest-room roem guard, no changes applied';
  END IF;
  EXECUTE source_body;
END;
$kj_room_guard$;

-- Verification (read-only):
-- SELECT position('octet_length(incoming::text)>500000' IN pg_get_functiondef(p.oid))>0,
--        position('roem_declined' IN pg_get_functiondef(p.oid))>0
-- FROM pg_proc p WHERE p.proname='klaverjassen_guest_v1';

-- Rollback, only if necessary: in a guarded DO block targeting this same function,
-- replace new_size with old_size and new_roem with old_roem. Consider active games
-- before reducing the size limit because their saved state may exceed 120 KB.
