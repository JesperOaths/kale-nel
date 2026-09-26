begin;

-- v870: the previously approved EU Dogwood fulfillment clone was removed from
-- Printify. Point the eight already-approved white Gildan 5000 variants at the
-- recreated provider-30 clone. Checkout still re-fetches and re-validates the
-- target product/variant/artwork before this route may be used.
update public.shop_fulfillment_mappings
set target_product_id = '6ab7eb21260d6d35e403a875',
    updated_at = now(),
    notes = case
      when notes is null or notes = '' then
        'EU Dogwood route refreshed to recreated provider-30 internal product.'
      when notes not like '%6ab7eb21260d6d35e403a875%' then
        notes || ' Refreshed 2026-09-26 to recreated provider-30 internal product 6ab7eb21260d6d35e403a875.'
      else notes
    end
where approved = true
  and source_product_id = '6a97d552b3fdf6e3e5005804'
  and source_print_provider_id = 99
  and target_print_provider_id = 30
  and countries @> array['NL']::text[]
  and target_product_id in (
    '6aa9e8f8c5b546463b0c04d4',
    '6ab7eb21260d6d35e403a875'
  );

commit;
