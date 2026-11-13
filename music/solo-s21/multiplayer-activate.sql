-- ACTIVATE ONLY AFTER 8798 is healthy and the C720P relay supports multiplayer.
-- Public browser uses a publishable key (anon), but every game mutation remains
-- subject to a 256-bit room capability and an S21-native first-buzz/score guard.
-- The existing queue saturation limit applies equally to anonymous clients.
-- Do NOT grant privileges on the underlying relay job tables.
GRANT EXECUTE ON FUNCTION public.tunerush_s21_mp_submit_v1(text,text,text,jsonb,text) TO anon;
-- Keep the existing private worker-only function guards and poll-hash checks.
