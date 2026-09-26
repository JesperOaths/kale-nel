# v826 shop order approval

Protected admin page: `admin_shop_orders.html`.

Default view shows orders that still need action: pending payment or paid but not yet released to Printify. The page shows order reference/ID, customer and delivery data, items, subtotal, shipping, total due, amount received, payment status, confirmation email state, Printify state, tracking, shipment email state, and errors.

Payment verification requires entering the amount actually received. The server refuses verification when the received amount is below the authoritative order total. `Send to Printify` remains a separate explicit action and the server checks the verified amount again before creating/releasing the Printify order.

## v832 fulfillment routing

Checkout always asks Printify for the available shipping methods and selects the cheapest valid quote. It also compares production plus shipping cost across the catalog product and any explicitly approved regional routes. Customer pricing remains based on the selected catalog variant's current Printify production cost plus exactly EUR 5, rounded up to a whole euro; a cheaper internal route never changes the displayed or charged product price.

Regional routing now uses only rows in the server-side `shop_fulfillment_mappings` table with `approved=true` and a matching destination country. The browser never receives these routes or the Printify token. Checkout and delivery preview re-fetch both source and target products from Printify and revalidate the exact variant, blueprint, provider, size, color and artwork before a mapped route can be quoted. A deleted/stale regional target is ignored and the canonical product remains available as the safe fallback.

The logical mapping schema remains:

```json
{
  "version": 1,
  "mappings": [
    {
      "approved": true,
      "approval_id": "change-record-id",
      "countries": ["NL", "BE"],
      "source": {
        "product_id": "catalog-product-id",
        "variant_id": 1001,
        "blueprint_id": 10,
        "print_provider_id": 20
      },
      "target": {
        "product_id": "approved-regional-product-id",
        "variant_id": 2001,
        "blueprint_id": 10,
        "print_provider_id": 30
      }
    }
  ]
}
```

Each entry is exact and variant-specific. At checkout the server re-fetches both products and accepts a mapped route only when country, product, variant, blueprint, provider, size, color, availability, and the set of artwork file IDs by print position still match the approval. Otherwise it safely ignores that mapping and retains the original catalog route. The chosen source and fulfillment IDs plus the approval ID are recorded in the pending order line item for audit. Checkout still does not create or release a Printify order.

Approved mappings are maintained in `shop_fulfillment_mappings`. Changes to an approved target should be persisted by migration. Both `shop-manual-checkout-v832` and `shop-delivery-preview-v833` must use the same mapping table and validation logic so the amount shown before checkout is the amount checkout re-verifies.
