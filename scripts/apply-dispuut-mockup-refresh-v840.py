from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)


path = Path("supabase/functions/shop-catalog-v828/index.ts")
s = path.read_text(encoding="utf-8")
anchor = "function mediaFor(product: any) {\n"
helper = '''function versionedMockupUrl(src: string, updatedAt: unknown) {
  const raw = text(src);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname === "images.printify.com") {
      const stamp = Date.parse(text(updatedAt));
      if (Number.isFinite(stamp)) url.searchParams.set("kv", String(stamp));
    }
    return url.toString();
  } catch {
    return raw;
  }
}
'''
if anchor not in s:
    raise SystemExit("missing patch anchor: mediaFor")
s = s.replace(anchor, helper + anchor, 1)
s = replace_once(
    s,
    "    image: text(image?.src),\n",
    "    image: versionedMockupUrl(text(image?.src), product?.updated_at),\n",
    "version Printify mockups by product update",
)
path.write_text(s, encoding="utf-8")

path = Path("check-shop-commerce-v817.mjs")
s = path.read_text(encoding="utf-8")
anchor = "assert.match(catalogEdge, /EdgeRuntime\\.waitUntil/);\n"
addition = anchor + "assert.match(catalogEdge, /function versionedMockupUrl/);\nassert.match(catalogEdge, /url\\.searchParams\\.set\\(\"kv\", String\\(stamp\\)\\)/);\nassert.match(catalogEdge, /versionedMockupUrl\\(text\\(image\\?\\.src\\), product\\?\\.updated_at\\)/);\n"
s = replace_once(s, anchor, addition, "catalog mockup cache-bust assertions")
path.write_text(s, encoding="utf-8")

path = Path("check-live-shop.mjs")
s = path.read_text(encoding="utf-8")
anchor = "const hydrangea = liveCatalog.products.find(product => /^hydrangea$/i.test(String(product?.name || '').trim()));\n"
proof = '''const dispuutShirts = liveCatalog.products.filter(product => /^Dispuut Despinoza(?: Lange Roos)?$/i.test(String(product?.name || '').trim()));
assert.equal(dispuutShirts.length, 2, 'both Dispuut shirt products must exist');
for (const product of dispuutShirts) {
  const back = (Array.isArray(product?.mockups) ? product.mockups : []).find(item => String(item?.label || '').toLowerCase() === 'back');
  assert.ok(back?.image, `${product.name} must expose a back mockup`);
  assert.match(String(back.image), /[?&]kv=\\d+/, `${product.name} back mockup must be cache-busted by product updated_at`);
}
'''
if anchor not in s:
    raise SystemExit("missing patch anchor: live Dispuut proof")
s = s.replace(anchor, proof + anchor, 1)
path.write_text(s, encoding="utf-8")
