# Bruis shop catalog import

The shop is static and reads `shop/catalog.json` when that file exists, falling back to `shop/catalog.printify.json` and then the built-in catalog.

## Safe import flow

1. Export/download product JSON from the Printify dashboard or API outside the repo.
2. Keep API tokens out of the repository.
3. Run:

```bash
node scripts/import-printify-catalog.mjs path/to/printify-products.json --out shop/catalog.json
```

This writes `shop/catalog.json` with only public catalog data: product title, description, enabled variant prices, sizes, base shirt identifiers, and mockup image URLs.

## Supported input shapes

The importer accepts:

- one Printify product object
- an array of product objects
- `{ "products": [...] }`
- `{ "data": [...] }`

The frontend can also read a raw Printify-like catalog JSON directly, but the importer is cleaner because it strips private/unneeded fields.

## What the storefront uses

- `images[]` / `mockups[]` for distinct mockup rails
- `variants[].price` for min/max price sorting
- `variants[].options` + `options[]` for sizes
- `blueprint_id` + `print_provider_id` for base-shirt sorting

No live checkout is enabled here. Payment links still need explicit approval before they are connected.
