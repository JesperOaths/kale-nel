import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SHOPIFY_API_VERSION = "2026-07";
const SHOPIFY_DOMAIN = "n75mh8-bu.myshopify.com";
const MAX_PAGES = 20;
const MAX_MEDIA = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gidTail(value: unknown) {
  const raw = text(value);
  const match = raw.match(/\/([^/]+)$/);
  return match ? match[1] : raw;
}

function mediaFor(raw: any) {
  const featuredUrl = text(raw?.featuredImage?.url);
  const nodes = Array.isArray(raw?.images?.nodes) ? raw.images.nodes : [];
  const source: Array<{ image: string; label: string; featured: boolean }> = [];
  if (featuredUrl) {
    source.push({
      image: featuredUrl,
      label: text(raw?.featuredImage?.altText || "Front"),
      featured: true,
    });
  }
  for (const image of nodes) {
    const url = text(image?.url);
    if (!url) continue;
    source.push({
      image: url,
      label: text(image?.altText || "View"),
      featured: url === featuredUrl,
    });
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

const PRICE_QUERY = `
  query KalenelLivePrices($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        updatedAt
        featuredImage { url altText }
        images(first: 50) { nodes { url altText } }
        priceRange {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        variants(first: 250) {
          nodes {
            id
            title
            sku
            availableForSale
            price { amount currencyCode }
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

async function storefrontGraphql(variables: Record<string, unknown>) {
  const response = await fetch(`https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Kalenel-Shop-Price/1.1",
    },
    body: JSON.stringify({ query: PRICE_QUERY, variables }),
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
  const products: any[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const connection = await storefrontGraphql({ cursor });
    if (!connection || !Array.isArray(connection.nodes)) {
      throw new Error("Shopify Storefront returned no product connection");
    }
    products.push(...connection.nodes);
    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }
  return products;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const rows = await loadProducts();
    const products = rows.map((raw: any) => {
      const variants = Array.isArray(raw?.variants?.nodes) ? raw.variants.nodes : [];
      const mockups = mediaFor(raw);
      return {
        id: gidTail(raw?.id),
        name: text(raw?.title),
        price: numeric(raw?.priceRange?.minVariantPrice?.amount),
        priceMax: numeric(raw?.priceRange?.maxVariantPrice?.amount),
        currency: text(raw?.priceRange?.minVariantPrice?.currencyCode || "EUR"),
        updatedAt: raw?.updatedAt || null,
        mockups,
        image: mockups[0]?.image || "",
        variants: variants.map((variant: any) => ({
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
        })),
      };
    }).filter((product: any) => product.id && product.name && product.price > 0);

    return json({
      generatedAt: new Date().toISOString(),
      source: "shopify-storefront",
      products,
    });
  } catch (error) {
    console.error("shop-price-v818 failed", error);
    return json({
      error: "shopify_price_unavailable",
      detail: text(error instanceof Error ? error.message : error).slice(0, 500),
      products: [],
    }, 502);
  }
});
