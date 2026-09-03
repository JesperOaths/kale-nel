import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SHOPIFY_API_VERSION = "2026-07";
const SHOPIFY_DOMAIN = "n75mh8-bu.myshopify.com";
const MAX_PAGES = 20;
const MAX_MEDIA = 24;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const headers = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=5, stale-while-revalidate=30",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const text = (value: unknown) => String(value ?? "").trim();
const numeric = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const gidTail = (value: unknown) => text(value).split("/").pop() || text(value);

function collectionFor(raw: any) {
  const title = text(raw?.title);
  if (/despinoza/i.test(title)) return "merch";
  const haystack = [title, raw?.productType, raw?.vendor, ...(Array.isArray(raw?.tags) ? raw.tags : [])]
    .map(text).join(" ");
  return /\b(?:oversized|boxy)\b/i.test(haystack) ? "boxy" : "normal";
}

function mediaFor(raw: any) {
  const source: Array<{ image: string; label: string; featured: boolean }> = [];
  const featuredUrl = text(raw?.featuredImage?.url);
  if (featuredUrl) source.push({ image: featuredUrl, label: text(raw?.featuredImage?.altText || "Front"), featured: true });
  for (const image of Array.isArray(raw?.images?.nodes) ? raw.images.nodes : []) {
    const url = text(image?.url);
    if (!url) continue;
    source.push({ image: url, label: text(image?.altText || "View"), featured: url === featuredUrl });
  }
  const seen = new Set<string>();
  return source
    .filter((item) => {
      if (!item.image || seen.has(item.image)) return false;
      seen.add(item.image);
      return true;
    })
    .sort((a, b) => Number(b.featured) - Number(a.featured))
    .slice(0, MAX_MEDIA)
    .map(({ image, label }) => ({ image, label }));
}

function variantsFor(raw: any) {
  return (Array.isArray(raw?.variants?.nodes) ? raw.variants.nodes : []).map((variant: any) => ({
    id: gidTail(variant?.id),
    sku: text(variant?.sku),
    title: text(variant?.title),
    price: numeric(variant?.price?.amount),
    is_enabled: true,
    is_available: variant?.availableForSale !== false,
    options: (Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : []).map((option: any) => ({
      name: text(option?.name),
      value: text(option?.value),
    })),
  }));
}

function sizesFor(variants: any[]) {
  const values: string[] = [];
  for (const variant of variants) {
    for (const option of Array.isArray(variant?.options) ? variant.options : []) {
      if (!/size/i.test(text(option?.name))) continue;
      const value = text(option?.value);
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

const QUERY = `
query KalenelCatalogV822($cursor: String) {
  products(first: 100, after: $cursor, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title description productType vendor tags updatedAt
      featuredImage { url altText }
      images(first: 50) { nodes { url altText } }
      priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      variants(first: 250) {
        nodes { id title sku availableForSale price { amount currencyCode } selectedOptions { name value } }
      }
    }
  }
}`;

async function page(cursor: string | null) {
  const response = await fetch(`https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Kalenel-Shop-Catalog/8.22" },
    body: JSON.stringify({ query: QUERY, variables: { cursor } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Array.isArray(payload?.errors)) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map((error: any) => text(error?.message)).filter(Boolean).join("; ")
      : text(payload?.error);
    throw new Error(`Shopify Storefront ${response.status}: ${detail || "request failed"}`);
  }
  return payload?.data?.products;
}

async function loadProducts() {
  const rows: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const connection = await page(cursor);
    if (!connection || !Array.isArray(connection.nodes)) throw new Error("Shopify returned no product connection");
    rows.push(...connection.nodes);
    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const rows = await loadProducts();
    const products = rows.map((raw: any) => {
      const variants = variantsFor(raw);
      const mockups = mediaFor(raw);
      return {
        id: gidTail(raw?.id),
        source: "shopify-storefront",
        name: text(raw?.title),
        description: text(raw?.description),
        collection: collectionFor(raw),
        price: numeric(raw?.priceRange?.minVariantPrice?.amount),
        priceMax: numeric(raw?.priceRange?.maxVariantPrice?.amount),
        sizes: sizesFor(variants),
        mockups,
        image: mockups[0]?.image || "",
        baseKey: text(raw?.productType || "shopify"),
        baseLabel: text(raw?.productType || "Shopify product"),
        variants,
        updatedAt: raw?.updatedAt || null,
      };
    }).filter((product: any) => product.id && product.name && product.price > 0 && product.mockups.length > 0);
    return json({ generatedAt: new Date().toISOString(), source: "shopify-storefront", products });
  } catch (error) {
    console.error("shop-catalog-v822 failed", error);
    return json({ error: "catalog_unavailable", detail: text(error instanceof Error ? error.message : error).slice(0, 500), products: [] }, 502);
  }
});
