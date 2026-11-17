-- Run only after kalenel-kj-turn-push Edge Function exists and /public-key returns VAPID key.
-- No scheduled task; this is a state-change trigger for opt-in browser subscriptions.
drop trigger if exists kalenel_kj_turn_push_trigger on public.kalenel_klaverjassen_guest_rooms;
create trigger kalenel_kj_turn_push_trigger after update of state
on public.kalenel_klaverjassen_guest_rooms
for each row execute function kalenel_internal.kj_turn_push_hook();
