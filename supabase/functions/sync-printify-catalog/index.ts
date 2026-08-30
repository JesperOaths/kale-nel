import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { HttpError, dbRequest, jsonResponse, printifyRequest, requiredEnv, safeError } from "../_shared/shop.ts";

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

function variantDimensions(product: any, variant: any) {
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const expected = requiredEnv("SHOP_SYNC_KEY");
    if ((req.headers.get("x-shop-sync-key") || "") !== expected) throw new HttpError(401, "Unauthorized");
    const shopId = requiredEnv("PRINTIFY_SHOP_ID");

    const allProducts: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await printifyRequest(`shops/${encodeURIComponent(shopId)}/products.json?page=${page}&limit=100`);
      const data = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
      allProducts.push(...data);
      const lastPage = Number(result?.last_page || result?.meta?.last_page || page);
      if (!data.length || page >= lastPage) break;
    }
    if (!allProducts.length) throw new Error("Printify returned no products; catalog was not changed");

    const now = new Date().toISOString();
    const productRows = allProducts.map((product) => ({
      printify_product_id: String(product.id),
      title: String(product.title || product.name || "Untitled product"),
      description: String(product.description || ""),
      active: product.visible !== false,
      last_synced_at: now,
    }));

    await dbRequest("shop_products?on_conflict=printify_product_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(productRows),
    });

    let variantCount = 0;
    for (const product of allProducts) {
      const productId = String(product.id);
      await dbRequest(`shop_variants?printify_product_id=eq.${encodeURIComponent(productId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ enabled: false, available: false, last_synced_at: now }),
      });

      const rows = (product.variants || []).map((variant: any) => {
        const dimensions = variantDimensions(product, variant);
        const price = Math.max(0, Math.floor(Number(variant.price || 0)));
        return {
          printify_product_id: productId,
          printify_variant_id: Number(variant.id),
          title: String(variant.title || `${product.title || "Product"} variant`),
          size: dimensions.size,
          color: dimensions.color,
          sku: variant.sku ? String(variant.sku) : null,
          retail_price_cents: price,
          enabled: variant.is_enabled !== false,
          available: variant.is_available !== false,
          metadata: {
            cost_cents: Number.isFinite(Number(variant.cost)) ? Number(variant.cost) : null,
            grams: Number.isFinite(Number(variant.grams)) ? Number(variant.grams) : null,
          },
          last_synced_at: now,
        };
      }).filter((row: any) => Number.isFinite(row.printify_variant_id) && row.retail_price_cents > 0);

      if (rows.length) {
        variantCount += rows.length;
        await dbRequest("shop_variants?on_conflict=printify_product_id%2Cprintify_variant_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        });
      }
    }

    const seen = productRows.map((row) => row.printify_product_id);
    const staleFilter = seen.map((id) => `\"${id.replaceAll("\"", "")}\"`).join(",");
    if (staleFilter) {
      await dbRequest(`shop_products?printify_product_id=not.in.(${encodeURIComponent(staleFilter)})`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: false }),
      }).catch((error) => console.warn("Could not mark stale products inactive", error));
    }

    return jsonResponse({ ok: true, products: productRows.length, variants: variantCount, synced_at: now });
  } catch (error) {
    const safe = safeError(error);
    return jsonResponse({ error: safe.message }, safe.status);
  }
});
