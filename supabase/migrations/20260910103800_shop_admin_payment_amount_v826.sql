-- v826: record the amount actually received before an order can be released.
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS paid_amount_cents integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shop_orders_paid_amount_cents_check'
      AND conrelid = 'public.shop_orders'::regclass
  ) THEN
    ALTER TABLE public.shop_orders
      ADD CONSTRAINT shop_orders_paid_amount_cents_check
      CHECK (paid_amount_cents IS NULL OR (paid_amount_cents >= 0 AND paid_amount_cents <= 100000000));
  END IF;
END $$;

-- Preserve compatibility for any orders that were verified before v826.
UPDATE public.shop_orders
SET paid_amount_cents = total_cents
WHERE payment_verified_at IS NOT NULL
  AND paid_amount_cents IS NULL;
