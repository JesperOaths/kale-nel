-- Remove the redundant v825 status/created_at index.
-- shop_orders_status_idx already covers (status, created_at DESC).

drop index if exists public.shop_orders_status_created_idx;
