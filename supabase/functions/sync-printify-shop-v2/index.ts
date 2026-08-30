import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  HttpError,
  dbRequest,
  jsonResponse,
  normalizeColor,
  normalizeSize,
  printifyRequest,
  requiredEnv,
  safeError,
  timingSafeEqual,
} from "../_shared/shop-v2.ts";

type StorefrontProduct = {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  sizes?: unknown;
  currency?: unknown;
};

function optionLookup(product: any) {
  const map = new Map<number, { kind: string; title: string }>();
  for (const option of product?.options || []) {
    const name = String(option?.name || option?.type || "").toLowerCase();
    const kind = name.includes("size") ? "size" : name.includes("color") || name.includes("colour") ? "color" : name;
    for (const value of option?.values || []) {
      const id = Number(value?.id);
      if (Number.isFinite(id)) map.set(id, { kind, title: String(value?.title || value?.name || id) });
    }
  }
  return map;
}

function dimensions(product: any, variant: any) {
  const lookup = optionLookup(product);
  let size: string | null = null;
  let color: string | null = null;
  for (const optionId of variant?.options || []) {
    const option = lookup.get(Number(optionId));
    if (!option) continue;
    if (option.kind === "size") size = option.title;
    if (option.kind === "color") color = option.title;
  }
  const title = String(variant?.title || "");
  if (!size) {
    const match = title.match(/(?:^|\s\/\s|\s-\s)(5XL|4XL|3XL|2XL|XXXL|XXL|XL|L|M|S|XS)(?:$|\s\/\s|\s-\s)/i);
    if (match) size = match[1].toUpperCase().replace("XXXL", "3XL").replace("XXL", "2XL");
  }
  if (!color && title.includes(" / ")) color = title.split(" / ")[0].trim();
  return { size, color };
}

function preferredVariant(candidates: any[], colorPriority: string[]) {
  for (const wanted of colorPriority) {
    const matches = candidates.filter((v) => normalizeColor(v._color) === wanted);
    if (matches.length === 1) return matches[0];
  }
  return candidates.length === 1 ? candidates[0] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const supplied = req.headers.get("x-shop-sync-key") || "";
    const expected = requiredEnv("SHOP_SYNC_KEY");
    if (!timingSafeEqual(supplied, expected)) throw new HttpError(401, "Unauthorized");

    const catalogUrl = Deno.env.get("SHOP_STOREFRONT_CATALOG_URL") || "https://kalenel.nl/shop/catalog.printify.json";
    const catalogResponse = await fetch(catalogUrl, { headers: { accept: "application/json" } });
    if (!catalogResponse.ok) throw new Error(`Storefront catalog request failed (${catalogResponse.status})`);
    const catalog = await catalogResponse.json();
    const sourceProducts: StorefrontProduct[] = Array.isArray(catalog?.products) ? catalog.products : [];
    if (!sourceProducts.length) throw new Error("Storefront catalog is empty; database was not changed");

    const products = sourceProducts.map((raw) => {
      const id = String(raw.id || "").trim();
      const title = String(raw.name || "").trim();
      const currency = String(raw.currency || "EUR").trim().toLowerCase();
      const euroPrice = Number(raw.price);
      const sizes = Array.isArray(raw.sizes) ? raw.sizes.map(normalizeSize).filter(Boolean) : [];
      if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id) || !title || currency !== "eur" || !Number.isFinite(euroPrice) || euroPrice <= 0 || !sizes.length) {
        throw new Error(`Invalid storefront catalog product ${id || title || "unknown"}`);
      }
      return { id, title, currency, priceCents: Math.round(euroPrice * 100), sizes: [...new Set(sizes)] };
    });

    const colorPriority = (Deno.env.get("SHOP_STOREFRONT_COLORS") || "White,Natural,Ivory,Ecru,Off White,Off-White")
      .split(",").map(normalizeColor).filter(Boolean);
    const shopId = requiredEnv("PRINTIFY_SHOP_ID");
    const now = new Date().toISOString();
    const generatedAt = catalog?.generatedAt ? new Date(String(catalog.generatedAt)).toISOString() : null;
    const productRows: any[] = [];
    const variantRows: any[] = [];
    const warnings: string[] = [];

    for (const storefront of products) {
      const product = await printifyRequest(`shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(storefront.id)}.json`);
      const variants = (product?.variants || []).map((variant: any) => {
        const d = dimensions(product, variant);
        return { ...variant, _size: d.size, _color: d.color };
      });
      const selected = new Map<string, number>();

      for (const size of storefront.sizes) {
        const candidates = variants.filter((variant: any) =>
          variant?.is_enabled !== false && variant?.is_available !== false && normalizeSize(variant._size) === size
        );
        const choice = preferredVariant(candidates, colorPriority);
        if (choice) selected.set(size, Number(choice.id));
        else warnings.push(`${storefront.id}:${size}: no unique storefront color variant`);
      }

      if (!selected.size) throw new Error(`${storefront.title} has no uniquely selectable Printify variants`);
      productRows.push({
        printify_product_id: storefront.id,
        title: storefront.title,
        description: String(product?.description || ""),
        currency: storefront.currency,
        storefront_price_cents: storefront.priceCents,
        storefront_sizes: storefront.sizes,
        active: product?.visible !== false,
        source_catalog_generated_at: generatedAt,
        last_synced_at: now,
      });

      for (const variant of variants) {
        const size = normalizeSize(variant._size);
        const selectedForStorefront = Boolean(size && selected.get(size) === Number(variant.id));
        variantRows.push({
          printify_product_id: storefront.id,
          printify_variant_id: Number(variant.id),
          title: String(variant.title || `${storefront.title} variant`),
          size: variant._size ? String(variant._size) : null,
          color: variant._color ? String(variant._color) : null,
          sku: variant.sku ? String(variant.sku) : null,
          storefront_price_cents: storefront.priceCents,
          printify_retail_price_cents: Number.isFinite(Number(variant.price)) ? Math.floor(Number(variant.price)) : null,
          printify_cost_cents: Number.isFinite(Number(variant.cost)) ? Math.floor(Number(variant.cost)) : null,
          enabled: variant.is_enabled !== false,
          available: variant.is_available !== false,
          selected_for_storefront: selectedForStorefront,
          metadata: { grams: Number.isFinite(Number(variant.grams)) ? Number(variant.grams) : null },
          last_synced_at: now,
        });
      }
    }

    await dbRequest("shop_products?on_conflict=printify_product_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(productRows),
    });
    await dbRequest("shop_variants?on_conflict=printify_product_id%2Cprintify_variant_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(variantRows),
    });

    const ids = products.map((p) => p.id);
    if (ids.length) {
      await dbRequest(`shop_products?printify_product_id=not.in.(${ids.map(encodeURIComponent).join(",")})`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }),
      });
    }

    return jsonResponse({
      ok: true,
      products: productRows.length,
      variants: variantRows.length,
      selected_variants: variantRows.filter((v) => v.selected_for_storefront).length,
      warnings: warnings.slice(0, 100),
      synced_at: now,
      catalog_url: catalogUrl,
    });
  } catch (error) {
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status);
  }
});
