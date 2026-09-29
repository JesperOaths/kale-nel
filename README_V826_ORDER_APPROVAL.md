# v826 shop order approval

Protected admin page: `admin_shop_orders.html`.

Default view shows orders that still need action: pending payment or paid but not yet released to Printify. The page shows order reference/ID, customer and delivery data, items, subtotal, shipping, total due, amount received, payment status, confirmation email state, Printify state, tracking, shipment email state, and errors.

Payment verification requires entering the amount actually received. The server refuses verification when the received amount is below the authoritative order total. `Send to Printify` remains a separate explicit action and the server checks the verified amount again before creating/releasing the Printify order.

## Clone-free fulfillment routing

The Printify catalog keeps **one real product per design**. Alternate fulfillment providers are never represented by hidden or duplicate Printify products.

Checkout and delivery preview use `shop_provider_routes_v1` as a private allow-list of provider alternatives. For each cart line they:

1. Re-fetch the one canonical Printify product and selected variant.
2. Revalidate the approved blueprint, current source provider, target provider, destination, variant availability, reusable artwork, and stored production-cost snapshot.
3. Quote Printify directly with `blueprint_id + print_provider_id + variant_id` for an alternate provider, while the canonical route continues to use the canonical `product_id`.
4. Select the route according to the shipping/cost policy. EU destinations prioritize the customer's shipping charge first, then total fulfillment cost and consolidation.
5. Persist the selected direct-provider approval ID in the pending order so production cannot silently switch to another route later.

When a direct-provider route is released to production, `shop-admin-orders-v825` sends the blueprint, provider, variant, quantity, and reusable print-area artwork directly in the Printify order line item. It does **not** create or depend on a second Printify product.

The two Despinoza shirts have a native Printify text layer that is not portable in a direct order. Their production path replaces that layer at order time with the already-uploaded static `Despinoza` artwork while preserving its geometry. This keeps those shirts clone-free too.

The legacy `shop_fulfillment_mappings` product-to-product route model is retired. Historical shipped/canceled orders retain their embedded route audit data, but new checkout, delivery preview, and production all use direct provider routing.
