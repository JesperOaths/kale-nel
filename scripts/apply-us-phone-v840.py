from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)


# Quote-only delivery preview: Printify requires a phone for US quotes.
# This fictitious NANP 555 number is never persisted to an order.
path = Path("supabase/functions/shop-delivery-preview-v833/index.ts")
s = path.read_text(encoding="utf-8")
s = replace_once(
    s,
    'const CHOICE_PROVIDER_ID = 99;\n',
    'const CHOICE_PROVIDER_ID = 99;\nconst US_QUOTE_ONLY_PHONE = "+12025550123"; // fictitious NANP 555 number; quote-only and never persisted\n',
    "preview quote-only phone constant",
)
s = replace_once(
    s,
    '    const addressTo = { first_name: "Checkout", last_name: "Estimate", email: "checkout@kalenel.nl", phone: "", country, region, address1, address2, city, zip };\n',
    '    const addressTo = { first_name: "Checkout", last_name: "Estimate", email: "checkout@kalenel.nl", phone: country === "US" ? US_QUOTE_ONLY_PHONE : "", country, region, address1, address2, city, zip };\n',
    "preview US phone",
)
path.write_text(s, encoding="utf-8")

# Checkout authority: real US orders must carry the customer's own phone.
path = Path("supabase/functions/shop-manual-checkout-v832/index.ts")
s = path.read_text(encoding="utf-8")
s = replace_once(
    s,
    '    if (fullName.length < 2 || fullName.length > 120 || !validEmail(email) || !address1 || !city || !zip || country.length !== 2) return json(req, { error: "invalid_customer_or_address" }, 400);\n    if (!items.length || items.length > MAX_ITEMS) return json(req, { error: "invalid_cart" }, 400);\n',
    '    if (fullName.length < 2 || fullName.length > 120 || !validEmail(email) || !address1 || !city || !zip || country.length !== 2) return json(req, { error: "invalid_customer_or_address" }, 400);\n    if (country === "US" && phone.replace(/\\D/g, "").length < 7) return json(req, { error: "phone_required_for_destination", country: "US" }, 400);\n    if (!items.length || items.length > MAX_ITEMS) return json(req, { error: "invalid_cart" }, 400);\n',
    "checkout US phone guard",
)
path.write_text(s, encoding="utf-8")

# Customer UI: dynamically require the phone only for US destinations.
path = Path("shop/manual-checkout-v825.js")
s = path.read_text(encoding="utf-8")
s = replace_once(
    s,
    '          <label>Phone (optional)<input name="phone" autocomplete="tel" maxlength="40"></label>\n',
    '          <label data-manual-phone-label>Phone (optional)<input data-manual-phone-input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>\n',
    "checkout phone field",
)
anchor = "  function renderCheckoutForm(){\n"
helper = """  function syncPhoneRequirement(form){
    const countryInput = form?.elements?.namedItem('country');
    const phoneInput = form?.elements?.namedItem('phone');
    const label = form?.querySelector('[data-manual-phone-label]');
    if(!(countryInput instanceof HTMLInputElement) || !(phoneInput instanceof HTMLInputElement)) return;
    const required = String(countryInput.value || '').trim().toUpperCase() === 'US';
    phoneInput.required = required;
    phoneInput.setAttribute('aria-required', required ? 'true' : 'false');
    if(label) label.childNodes[0].textContent = required ? 'Phone (required for US delivery)' : 'Phone (optional)';
  }

"""
if anchor not in s:
    raise SystemExit("missing patch anchor: checkout phone sync helper")
s = s.replace(anchor, helper + anchor, 1)
s = replace_once(
    s,
    "    const form = bodyNode().querySelector('[data-manual-checkout-form]');\n    form.addEventListener('submit', submitCheckout);\n",
    "    const form = bodyNode().querySelector('[data-manual-checkout-form]');\n    form.addEventListener('submit', submitCheckout);\n    const countryInput = form.elements.namedItem('country');\n    if(countryInput instanceof HTMLInputElement){\n      countryInput.addEventListener('input', () => syncPhoneRequirement(form));\n      countryInput.addEventListener('change', () => syncPhoneRequirement(form));\n    }\n    syncPhoneRequirement(form);\n",
    "checkout phone listeners",
)
s = replace_once(
    s,
    "    const payload = {\n      customer,\n",
    "    if(customer.country === 'US' && customer.phone.replace(/\\D/g, '').length < 7){\n      status.textContent = 'A phone number is required for delivery to the United States.';\n      const phoneInput = form.elements.namedItem('phone');\n      if(phoneInput instanceof HTMLInputElement) phoneInput.focus();\n      submit.disabled = false;\n      submit.textContent = 'Create pending order';\n      return;\n    }\n    const payload = {\n      customer,\n",
    "checkout client US phone guard",
)
path.write_text(s, encoding="utf-8")

# Storefront v840 cache/version bump for the changed assets only.
path = Path("shop/index.html")
s = path.read_text(encoding="utf-8")
s = replace_once(s, '<span class="version-watermark">v839</span>', '<span class="version-watermark">v840</span>', "shop watermark")
s = replace_once(s, 'delivery-estimate-v833.js?v=20260916-delivery-v833-r2', 'delivery-estimate-v833.js?v=20260916-delivery-v840-r1', "delivery cache token")
s = replace_once(s, 'manual-checkout-v825.js?v=20260916-storefront-v837-r1', 'manual-checkout-v825.js?v=20260916-checkout-v840-r1', "checkout cache token")
path.write_text(s, encoding="utf-8")

# Static contract checks.
path = Path("check-shop-commerce-v817.mjs")
s = path.read_text(encoding="utf-8")
s = replace_once(s, 'assert.match(index, /version-watermark[^>]*>v839</);', 'assert.match(index, /version-watermark[^>]*>v840</);', "checker watermark")
s = replace_once(s, 'assert.match(index, /20260916-delivery-v833-r2/);', 'assert.match(index, /20260916-delivery-v840-r1/);', "checker delivery token")
s = replace_once(s, 'assert.match(index, /20260916-storefront-v837-r2/);\n', 'assert.match(index, /20260916-storefront-v837-r2/);\nassert.match(index, /20260916-checkout-v840-r1/);\n', "checker checkout token")
s = replace_once(s, 'assert.match(liveShopCheck, /20260916-delivery-v833-r2/);', 'assert.match(liveShopCheck, /20260916-delivery-v840-r1/);', "checker live delivery token")
phone_asserts = r'''
// US shipping quotes require a phone. Preview uses a fictitious quote-only number
// that is never stored; real checkout requires the customer's own phone.
assert.match(deliveryPreviewEdge, /US_QUOTE_ONLY_PHONE = "\+12025550123"/);
assert.match(deliveryPreviewEdge, /phone: country === "US" \? US_QUOTE_ONLY_PHONE : ""/);
assert.match(checkoutEdge, /phone_required_for_destination/);
assert.match(checkoutEdge, /country === "US" && phone\.replace\(\/\\D\/g, ""\)\.length < 7/);
assert.match(manualCheckout, /data-manual-phone-label/);
assert.match(manualCheckout, /Phone \(required for US delivery\)/);
assert.match(manualCheckout, /syncPhoneRequirement/);
assert.match(manualCheckout, /A phone number is required for delivery to the United States/);
'''
anchor = "// Delivery preview must be address-aware, non-blocking, and explicit about the\n"
if anchor not in s:
    raise SystemExit("missing patch anchor: checker US phone asserts")
s = s.replace(anchor, phone_asserts + "\n" + anchor, 1)
path.write_text(s, encoding="utf-8")

# Live wiring checks for shipped v840 assets.
path = Path("check-live-shop.mjs")
s = path.read_text(encoding="utf-8")
s = replace_once(
    s,
    "const DELIVERY_UI_URL = 'https://kalenel.nl/shop/delivery-estimate-v833.js?v=20260916-delivery-v833-r2';\n",
    "const DELIVERY_UI_URL = 'https://kalenel.nl/shop/delivery-estimate-v833.js?v=20260916-delivery-v840-r1';\nconst MANUAL_CHECKOUT_UI_URL = 'https://kalenel.nl/shop/manual-checkout-v825.js?v=20260916-checkout-v840-r1';\n",
    "live-check asset URLs",
)
s = replace_once(s, "/version-watermark[^>]*>v839</, 'Live shop must expose v839 watermark'", "/version-watermark[^>]*>v840</, 'Live shop must expose v840 watermark'", "live-check watermark")
s = replace_once(s, "/delivery-estimate-v833\\.js\\?v=20260916-delivery-v833-r2/", "/delivery-estimate-v833\\.js\\?v=20260916-delivery-v840-r1/", "live-check delivery token")
s = replace_once(s, "/manual-checkout-v825\\.js\\?v=20260916-storefront-v837-r1/", "/manual-checkout-v825\\.js\\?v=20260916-checkout-v840-r1/", "live-check checkout token")
s = replace_once(s, "console.log(`shop page: HTTP 200, v839 present, ${pageElapsed}ms`);", "console.log(`shop page: HTTP 200, v840 present, ${pageElapsed}ms`);", "live-check version log")
live_asset = r'''
const manualCheckoutUi = await textAsset(MANUAL_CHECKOUT_UI_URL, 'manual-checkout-v825.js');
assert.match(manualCheckoutUi, /syncPhoneRequirement/, 'checkout UI must dynamically require phone for US delivery');
assert.match(manualCheckoutUi, /Phone \(required for US delivery\)/, 'checkout UI must explain why the US phone is required');
assert.match(manualCheckoutUi, /A phone number is required for delivery to the United States/, 'checkout UI must stop a US order without a phone');
'''
anchor = "const deliveryUi = await textAsset(DELIVERY_UI_URL, 'delivery-estimate-v833.js');\n"
if anchor not in s:
    raise SystemExit("missing patch anchor: live client asset assertions")
s = s.replace(anchor, live_asset + "\n" + anchor, 1)
path.write_text(s, encoding="utf-8")
