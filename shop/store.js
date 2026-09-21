const FALLBACK_PRODUCTS = [];
const cartKey = 'bruisCartV3';
const LIVE_CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v828';
// Supabase legacy anon key is intentionally publishable/browser-safe. RLS blocks
// direct reads/writes to the private production catalog; the Edge Function returns
// only the sanitized catalog projection.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpcW50YXpnbnJ4d2xpYWlka215Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MjkxNDUsImV4cCI6MjA4OTUwNTE0NX0.w21i9sYLybl0auVSJpc0OFwRoE3a-rRcJG8NtUF_xn8';
const SIZE_ORDER = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
const SIZE_GUIDES = {
  '6': {
    base: 'Classic T-Shirt',
    illustration: './assets/size-guide-classic.svg?v=20260921-v855-r1',
    illustrationAlt: 'Classic T-Shirt measurement diagram showing width, length and sleeve from center back',
    sizes: ['S','M','L','XL','2XL','3XL','4XL','5XL'],
    metric: {
      'Width': [45.7,50.8,55.9,61.0,66.0,71.1,76.2,81.3],
      'Length': [71.1,73.7,76.2,78.7,81.3,83.8,86.4,88.9],
      'Sleeve from center back': [38.4,41.9,45.7,49.5,53.3,56.9,60.2,63.5],
      'Tolerance': [3.8,3.8,3.8,3.8,3.8,3.8,3.8,3.8]
    },
    imperial: {
      'Width': [18,20,22,24,26,28,30,32],
      'Length': [28,29,30,31,32,33,34,35],
      'Sleeve from center back': [15.1,16.5,18,19.5,21,22.4,23.7,25],
      'Tolerance': [1.5,1.5,1.5,1.5,1.5,1.5,1.5,1.5]
    }
  },
  '1382': {
    base: 'Oversized Boxy T-Shirt',
    illustration: './assets/size-guide-boxy.svg?v=20260921-v855-r1',
    illustrationAlt: 'Oversized Boxy T-Shirt measurement diagram showing width and length',
    sizes: ['XS','S','M','L','XL','2XL','3XL'],
    metric: {
      'Width': [47.6,50.2,52.7,57.8,62.9,67.9,73.0],
      'Length': [66.7,69.2,70.5,73.0,75.6,76.8,79.4],
      'Tolerance': [2.5,2.5,2.5,2.5,2.5,2.5,2.5]
    },
    imperial: {
      'Width': [18.75,19.75,20.75,22.75,24.75,26.75,28.75],
      'Length': [26.25,27.25,27.75,28.75,29.75,30.25,31.25],
      'Tolerance': [1,1,1,1,1,1,1]
    }
  }
};
let sizeGuideUnit = 'metric';
let activeSizeGuideProductId = '';

function shirtSizes(raw, baseKey){
  if(!SIZE_GUIDES[baseKey]) return Array.isArray(raw.sizes) ? raw.sizes : [];
  const variants = Array.isArray(raw.variants) ? raw.variants : [];
  const found = [...new Set(variants.map(variant => String(variant?.size || '').trim().toUpperCase()).filter(Boolean))];
  return found.sort((a,b) => {
    const ai = SIZE_ORDER.indexOf(a);
    const bi = SIZE_ORDER.indexOf(b);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
  });
}

const COLLECTIONS = {
  normal: {
    label: 'Classic',
    heading: 'Classic shirts',
    empty: 'No Classic shirts are available yet.'
  },
  boxy: {
    label: 'Oversized Boxy',
    heading: 'Oversized Boxy shirts',
    empty: 'No Oversized Boxy shirts are available yet.'
  },
  merch: {
    label: 'Merch',
    heading: 'Merch',
    empty: 'No Merch products are available yet.'
  }
};

let products = [];
let selectedCollection = null;
let cart = JSON.parse(localStorage.getItem(cartKey) || '[]');

const qs = sel => document.querySelector(sel);
const qsa = sel => [...document.querySelectorAll(sel)];
const wholeEuro = value => Math.ceil(Math.max(0, Number(value || 0)) - 1e-9);
const money = value => `€${wholeEuro(value)}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const slug = text => String(text || 'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'product';

function normalizeCollection(value){
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if(raw === 'merch') return 'merch';
  if(raw === 'boxy' || raw === 'oversized' || raw === 'oversized-boxy' || raw === 'oversized boxy') return 'boxy';
  return 'normal';
}

function normalizeProduct(raw){
  const name = raw.name || raw.title || 'Untitled product';
  const baseKey = String(raw.baseKey || raw.base_key || '');
  const mockups = (Array.isArray(raw.mockups) ? raw.mockups.filter(m => m && m.image) : [])
    .filter((mockup, index) => !(
      index === 0 &&
      /^jellyfish$/i.test(String(name).trim()) &&
      /jellyfish-front-artwork/i.test(String(mockup.image || ''))
    ));
  const collection = /despinoza/i.test(name)
    ? 'merch'
    : normalizeCollection(raw.collection || raw.shirtCollection || raw.fit);
  return {
    id: String(raw.id || slug(name)),
    name,
    price: wholeEuro(raw.price),
    priceMax: wholeEuro(raw.priceMax || raw.price),
    sizes: shirtSizes(raw, baseKey),
    mockups,
    image: mockups[0]?.image || raw.image || '',
    baseLabel: baseKey === '6' ? 'Classic T-Shirt' : (baseKey === '1382' ? 'Oversized Boxy T-Shirt' : (raw.baseLabel || 'Product')),
    baseKey: String(raw.baseKey || raw.blueprintId || raw.blueprint_id || ''),
    variants: Array.isArray(raw.variants) ? raw.variants.map(variant => ({ ...variant, price: wholeEuro(variant.price) })) : [],
    shopId: String(raw.shopId || raw.shop_id || ''),
    baseKey,
    collection
  };
}

function sortByShirtBase(list){
  return [...list].sort((a, b) =>
    String(a.baseLabel || '').localeCompare(String(b.baseLabel || '')) || a.price - b.price || a.name.localeCompare(b.name)
  );
}

async function loadLiveCatalog(){
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(LIVE_CATALOG_URL, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if(!response.ok) return [];
    const payload = await response.json();
    const rawProducts = Array.isArray(payload) ? payload : (payload.products || []);
    return rawProducts.map(normalizeProduct).filter(p => p.name && p.mockups.length && p.price > 0);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadCatalog(){
  for(let attempt = 0; attempt < 3; attempt += 1){
    const liveProducts = await loadLiveCatalog();
    if(liveProducts.length) return sortByShirtBase(liveProducts);
    if(attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 1200 * (attempt + 1)));
  }
  return [];
}

function setCollectionCountsStatus(label){
  Object.keys(COLLECTIONS).forEach(key => {
    qsa(`[data-collection-count="${key}"]`).forEach(el => {
      el.textContent = label;
    });
  });
}

function productsForCollection(collection = selectedCollection){
  if(!collection) return [];
  return products.filter(product => product.collection === collection);
}

function updateCollectionCounts(){
  Object.keys(COLLECTIONS).forEach(key => {
    const count = productsForCollection(key).length;
    const noun = key === 'merch' ? (count === 1 ? 'product' : 'products') : (count === 1 ? 'shirt' : 'shirts');
    qsa(`[data-collection-count="${key}"]`).forEach(el => {
      el.textContent = `${count} ${noun}`;
    });
  });
}

function updateShapeControls(){
  qsa('[data-collection]').forEach(button => {
    const active = button.dataset.collection === selectedCollection;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function sizeGuideForProduct(product){
  if(!product) return null;
  return SIZE_GUIDES[String(product.baseKey || '')] || null;
}

function activeSizeGuideProduct(){
  return products.find(item => item.id === activeSizeGuideProductId) || null;
}

function renderSizeGuideContents(product){
  const guide = sizeGuideForProduct(product);
  if(!guide) return false;

  qs('[data-size-guide-product]').textContent = product.name;
  qs('[data-size-guide-base]').textContent = guide.base;
  const visual = qs('[data-size-guide-visual]');
  const illustration = qs('[data-size-guide-illustration]');
  if(visual && illustration){
    if(guide.illustration){
      illustration.src = guide.illustration;
      illustration.alt = guide.illustrationAlt || `${guide.base} measurement guide`;
      visual.hidden = false;
    } else {
      illustration.removeAttribute('src');
      illustration.alt = '';
      visual.hidden = true;
    }
  }
  qsa('[data-size-guide-unit]').forEach(button => {
    const active = button.dataset.sizeGuideUnit === sizeGuideUnit;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const unitLabel = sizeGuideUnit === 'metric' ? 'cm' : 'in';
  const rows = guide[sizeGuideUnit];
  qs('[data-size-guide-table]').innerHTML = `
    <thead><tr><th scope="col">Measurement</th>${guide.sizes.map(size => `<th scope="col">${esc(size)}</th>`).join('')}</tr></thead>
    <tbody>${Object.entries(rows).map(([label, values]) => `
      <tr><th scope="row">${esc(label)}</th>${values.map(value => `<td>${esc(value)} <span>${unitLabel}</span></td>`).join('')}</tr>
    `).join('')}</tbody>`;
  return true;
}

function setActiveSizeGuideProduct(product){
  const button = qs('[data-open-size-guide]');
  const guide = sizeGuideForProduct(product);
  if(!guide){
    activeSizeGuideProductId = '';
    if(button) button.hidden = true;
    closeSizeGuide();
    return;
  }

  activeSizeGuideProductId = product.id;
  if(button){
    button.hidden = false;
    button.setAttribute('aria-label', `Open size chart for ${product.name}`);
    button.title = `${product.name} size chart`;
  }

  const overlay = qs('[data-size-guide-overlay]');
  if(overlay && !overlay.hidden) renderSizeGuideContents(product);
}

function openSizeGuide(){
  const product = activeSizeGuideProduct();
  const overlay = qs('[data-size-guide-overlay]');
  const panel = qs('[data-size-guide-panel]');
  const button = qs('[data-open-size-guide]');
  if(!overlay || !panel || !button || !renderSizeGuideContents(product)) return;
  overlay.hidden = false;
  document.body.classList.add('size-guide-open');
  button.setAttribute('aria-expanded','true');
  window.requestAnimationFrame(() => qs('[data-close-size-guide]')?.focus());
}

function closeSizeGuide(){
  const overlay = qs('[data-size-guide-overlay]');
  const button = qs('[data-open-size-guide]');
  const wasOpen = overlay && !overlay.hidden;
  if(overlay) overlay.hidden = true;
  document.body.classList.remove('size-guide-open');
  if(button){
    button.setAttribute('aria-expanded','false');
    if(wasOpen) button.focus({ preventScroll: true });
  }
}

function syncSizeGuideToViewport(){
  const cards = qsa('.product-card[data-product-id]');
  if(!cards.length){
    setActiveSizeGuideProduct(null);
    return;
  }

  const viewportCenter = window.innerHeight / 2;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  cards.forEach(card => {
    const product = products.find(item => item.id === card.dataset.productId);
    if(!sizeGuideForProduct(product)) return;
    const rect = card.getBoundingClientRect();
    if(rect.bottom < 0 || rect.top > window.innerHeight) return;
    const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter);
    if(distance < bestDistance){
      bestDistance = distance;
      best = product;
    }
  });

  if(best) setActiveSizeGuideProduct(best);
  else setActiveSizeGuideProduct(null);
}

function initializeSizeGuide(){
  qsa('.product-card[data-product-id]').forEach(card => {
    const activate = () => {
      const product = products.find(item => item.id === card.dataset.productId);
      setActiveSizeGuideProduct(product);
    };
    card.addEventListener('pointerenter', activate);
    card.addEventListener('focusin', activate);
    card.addEventListener('click', activate);
  });

  const firstShirt = productsForCollection().find(product => sizeGuideForProduct(product));
  setActiveSizeGuideProduct(firstShirt || null);
  window.requestAnimationFrame(syncSizeGuideToViewport);
}

function renderProducts(){
  const wrap = qs('[data-products]');
  const empty = qs('[data-collection-empty]');
  if(!selectedCollection){
    wrap.innerHTML = '';
    empty.hidden = true;
    return;
  }

  const collection = COLLECTIONS[selectedCollection] || COLLECTIONS.normal;
  const list = productsForCollection();
  qs('[data-collection-title]').textContent = collection.heading;
  updateShapeControls();

  if(!list.length){
    wrap.innerHTML = '';
    empty.hidden = false;
    empty.textContent = collection.empty;
    return;
  }

  empty.hidden = true;
  empty.textContent = '';
  wrap.innerHTML = list.map(product => `
    <article class="product-card" data-product-id="${esc(product.id)}" data-product-collection="${esc(product.collection)}">
      <div class="mockup-rail" aria-label="${esc(product.name)} images">
        ${product.mockups.map(m => `
          <figure class="mockup mock-${slug(m.label)}">
            <img src="${esc(m.image)}" alt="${esc(product.name)}" loading="lazy" />
            <figcaption>${esc(m.label || 'View')}</figcaption>
          </figure>`).join('')}
      </div>
      <div class="gallery-controls" aria-label="Image controls">
        <button type="button" data-gallery-prev aria-label="Previous image">Prev</button>
        <div class="gallery-dots" role="tablist" aria-label="Choose image">
          ${product.mockups.map((m, index) => `<button type="button" data-gallery-dot="${index}" aria-label="Show image ${index + 1}"${index === 0 ? ' class="active"' : ''}></button>`).join('')}
        </div>
        <button type="button" data-gallery-next aria-label="Next image">Next</button>
      </div>
      <div class="product-copy">
        <div class="product-top">
          <div>
            <span class="product-collection-label">${esc(collection.label)}</span>
            <h3>${esc(product.name)}</h3>
            <p class="shirt-base">${esc(product.baseLabel)}</p>
          </div>
          <strong class="price">${money(product.price)}</strong>
        </div>
        <div class="buy-box">
          <label>Size
            <select data-size="${esc(product.id)}">${product.sizes.map((s, index) => `<option${String(s).trim().toUpperCase() === 'M' || (!product.sizes.some(size => String(size).trim().toUpperCase() === 'M') && index === 0) ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
          </label>
          <label>Qty
            <input data-qty="${esc(product.id)}" type="number" min="1" max="9" value="1" />
          </label>
          <button type="button" class="button primary" data-add="${esc(product.id)}">Add to cart</button>
        </div>
      </div>
    </article>`).join('');
  initializeGalleries();
  initializeSizeGuide();
}

function openShoppingView({ scroll = true } = {}){
  qs('[data-shape-entry]').hidden = true;
  qs('[data-shop-section]').hidden = false;
  if(scroll) qs('#shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openShapeEntry({ scroll = true, updateUrl = true } = {}){
  qs('[data-shop-section]').hidden = true;
  setActiveSizeGuideProduct(null);
  qs('[data-shape-entry]').hidden = false;
  updateShapeControls();
  if(updateUrl){
    const url = new URL(window.location.href);
    url.searchParams.delete('collection');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  if(scroll) qs('[data-shape-entry]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setCollection(collection, { scroll = true } = {}){
  const next = COLLECTIONS[collection] ? collection : 'normal';
  selectedCollection = next;
  const url = new URL(window.location.href);
  url.searchParams.set('collection', next);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  renderProducts();
  openShoppingView({ scroll });
}

function initializeGalleries(){
  qsa('.product-card').forEach(card => {
    const rail = card.querySelector('.mockup-rail');
    const slides = [...card.querySelectorAll('.mockup')];
    const dots = [...card.querySelectorAll('[data-gallery-dot]')];
    if(!rail || !slides.length || !dots.length) return;
    let activeIndex = 0;
    let previousWidth = Math.max(1, rail.clientWidth);
    const setActive = index => {
      activeIndex = Math.max(0, Math.min(slides.length - 1, index));
      dots.forEach((dot, i) => dot.classList.toggle('active', i === activeIndex));
    };
    const currentIndex = () => Math.max(0, Math.min(slides.length - 1,
      Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth))));
    const goTo = (index, behavior = 'smooth') => {
      const next = (index + slides.length) % slides.length;
      rail.scrollTo({ left: next * Math.max(1, rail.clientWidth), behavior });
      setActive(next);
    };
    dots.forEach((dot, index) => dot.addEventListener('click', () => goTo(index)));
    card.querySelector('[data-gallery-prev]')?.addEventListener('click', () => goTo(currentIndex() - 1));
    card.querySelector('[data-gallery-next]')?.addEventListener('click', () => goTo(currentIndex() + 1));
    rail.addEventListener('scroll', () => window.requestAnimationFrame(() => setActive(currentIndex())), { passive: true });
    rail.addEventListener('scrollend', () => goTo(currentIndex(), 'auto'), { passive: true });
    if('ResizeObserver' in window){
      const resizeObserver = new ResizeObserver(() => {
        const width = Math.max(1, rail.clientWidth);
        if(Math.abs(width - previousWidth) < 1) return;
        previousWidth = width;
        goTo(activeIndex, 'auto');
      });
      resizeObserver.observe(rail);
    }
  });
}

function saveCart(){ localStorage.setItem(cartKey, JSON.stringify(cart)); }
function cartTotal(){ return cart.reduce((sum,item) => sum + item.price * item.qty, 0); }
function cartCount(){ return cart.reduce((sum,item) => sum + item.qty, 0); }

function renderCart(){
  qsa('[data-cart-count]').forEach(el => el.textContent = cartCount());
  qs('[data-cart-subtotal]').textContent = money(cartTotal());
  const items = qs('[data-cart-items]');
  if(!cart.length){
    items.innerHTML = '<p class="empty-cart">Your cart is empty.</p>';
  } else {
    items.innerHTML = cart.map((item, index) => `
      <article class="cart-line">
        <img src="${esc(item.image)}" alt="${esc(item.name)}" />
        <div>
          <strong>${esc(item.name)}</strong>
          <span>${esc(item.size)} - ${item.qty} x ${money(item.price)}</span>
          <button type="button" data-remove="${index}">Remove</button>
        </div>
      </article>`).join('');
  }
  const summary = cart.map(i => `${i.qty} x ${i.name} (${i.size})`).join('\n') || 'I would like to order Bruis tees.';
  const mailOrder = qs('[data-mail-order]');
  if(mailOrder) mailOrder.href = `mailto:hello@example.com?subject=Bruis%20order%20request&body=${encodeURIComponent(summary)}`;
}

function addToCart(id){
  const product = products.find(p => p.id === id);
  if(!product) return;
  const size = qs(`[data-size="${CSS.escape(id)}"]`)?.value || product.sizes[0];
  const qty = Math.max(1, Math.min(9, Number(qs(`[data-qty="${CSS.escape(id)}"]`)?.value || 1)));
  const existing = cart.find(item => item.id === id && item.size === size);
  if(existing) existing.qty = Math.min(10, existing.qty + qty);
  else cart.push({ id, name: product.name, price: product.price, size, qty, image: product.image, collection: product.collection });
  saveCart();
  renderCart();
  openCart();
}

function openCart(){
  closeSizeGuide();
  qs('[data-cart-drawer]').classList.add('open');
  qs('[data-cart-drawer]').setAttribute('aria-hidden','false');
}

function closeCart(){
  qs('[data-cart-drawer]').classList.remove('open');
  qs('[data-cart-drawer]').setAttribute('aria-hidden','true');
}

document.addEventListener('click', event => {
  const collection = event.target.closest('[data-collection]');
  if(collection){
    setCollection(collection.dataset.collection);
    return;
  }

  if(event.target.closest('[data-expand-shapes]')){
    openShapeEntry();
    return;
  }

  const add = event.target.closest('[data-add]');
  if(add) addToCart(add.dataset.add);

  const remove = event.target.closest('[data-remove]');
  if(remove){
    cart.splice(Number(remove.dataset.remove),1);
    saveCart();
    renderCart();
  }

  if(event.target.closest('[data-open-cart]')) openCart();
  if(event.target.closest('[data-close-cart]') || event.target === qs('[data-cart-drawer]')) closeCart();
});

loadCatalog().then(list => {
  products = list;
  if(products.length) updateCollectionCounts();
  else setCollectionCountsStatus('Refreshing live catalog…');
  renderCart();

  const requested = new URLSearchParams(window.location.search).get('collection');
  if(products.length && COLLECTIONS[requested]){
    selectedCollection = requested;
    renderProducts();
    openShoppingView({ scroll: false });
  } else {
    selectedCollection = null;
    updateShapeControls();
    openShapeEntry({ scroll: false, updateUrl: false });
  }
});

document.addEventListener('click', event => {
  const open = event.target.closest('[data-open-size-guide]');
  if(open){
    const overlay = qs('[data-size-guide-overlay]');
    if(overlay?.hidden) openSizeGuide();
    else closeSizeGuide();
    return;
  }

  if(event.target.closest('[data-close-size-guide]')){
    closeSizeGuide();
    return;
  }

  const sizeGuideOverlay = qs('[data-size-guide-overlay]');
  if(sizeGuideOverlay && event.target === sizeGuideOverlay){
    closeSizeGuide();
    return;
  }

  const unitButton = event.target.closest('[data-size-guide-unit]');
  if(unitButton){
    sizeGuideUnit = unitButton.dataset.sizeGuideUnit === 'imperial' ? 'imperial' : 'metric';
    renderSizeGuideContents(activeSizeGuideProduct());
  }
});

document.addEventListener('keydown', event => {
  if(event.key === 'Escape') closeSizeGuide();
});

let sizeGuideScrollFrame = 0;
window.addEventListener('scroll', () => {
  if(sizeGuideScrollFrame) return;
  sizeGuideScrollFrame = window.requestAnimationFrame(() => {
    sizeGuideScrollFrame = 0;
    syncSizeGuideToViewport();
  });
}, { passive: true });
