const FALLBACK_PRODUCTS = [];
const cartKey = 'bruisCartV3';
const COLLECTIONS = {
  normal: { label: 'Normal', heading: 'Normal shirts', empty: 'No Normal shirts are available yet.' },
  boxy: { label: 'Boxy', heading: 'Boxy shirts', empty: 'No Boxy shirts yet. This collection is coming soon.' },
  'all-over': { label: 'All Over Print', heading: 'All Over Print shirts', empty: 'No All Over Print shirts yet. This collection is coming soon.' }
};
let products = [];
let selectedCollection = 'normal';
let cart = JSON.parse(localStorage.getItem(cartKey) || '[]');

const qs = sel => document.querySelector(sel);
const qsa = sel => [...document.querySelectorAll(sel)];
const money = value => `€${Math.ceil(Number(value || 0))}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const slug = text => String(text || 'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'product';

function normalizeCollection(value){
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if(raw === 'boxy') return 'boxy';
  if(raw === 'all-over' || raw === 'all over' || raw === 'all-over-print' || raw === 'all over print') return 'all-over';
  return 'normal';
}

function normalizeProduct(raw){
  const mockups = Array.isArray(raw.mockups) ? raw.mockups.filter(m => m && m.image) : [];
  return {
    id: String(raw.id || slug(raw.name)),
    name: raw.name || 'Untitled tee',
    price: Math.ceil(Number(raw.price || 0)),
    sizes: Array.isArray(raw.sizes) && raw.sizes.length ? raw.sizes : ['S','M','L','XL','2XL'],
    mockups,
    image: mockups[0]?.image || raw.image || '',
    baseLabel: raw.baseLabel || 'Shirt base pending',
    // Current products do not yet carry a collection field, so they intentionally
    // resolve to Normal. Future catalog rows can set boxy or all-over explicitly.
    collection: normalizeCollection(raw.collection || raw.shirtCollection || raw.fit)
  };
}

function sortByShirtBase(list){
  return [...list].sort((a, b) =>
    String(a.baseLabel || '').localeCompare(String(b.baseLabel || '')) || a.price - b.price || a.name.localeCompare(b.name)
  );
}

async function loadCatalog(){
  if(window.BRUIS_CATALOG){
    const rawProducts = Array.isArray(window.BRUIS_CATALOG) ? window.BRUIS_CATALOG : (window.BRUIS_CATALOG.products || []);
    const imported = rawProducts.map(normalizeProduct).filter(p => p.name && p.mockups.length && p.price > 0);
    if(imported.length) return sortByShirtBase(imported);
  }
  try {
    const response = await fetch('catalog.json?v=20260830-collections-v1', { cache: 'no-store' });
    if(response.ok){
      const payload = await response.json();
      const rawProducts = Array.isArray(payload) ? payload : (payload.products || []);
      const imported = rawProducts.map(normalizeProduct).filter(p => p.name && p.mockups.length && p.price > 0);
      if(imported.length) return sortByShirtBase(imported);
    }
  } catch {}
  return FALLBACK_PRODUCTS;
}

function productsForCollection(collection = selectedCollection){
  return products.filter(product => product.collection === collection);
}

function updateCollectionCounts(){
  Object.keys(COLLECTIONS).forEach(key => {
    const count = productsForCollection(key).length;
    qsa(`[data-collection-count="${key}"]`).forEach(el => {
      el.textContent = count === 0 && key !== 'normal'
        ? 'Coming soon'
        : `${count} ${count === 1 ? 'shirt' : 'shirts'}`;
    });
  });
}

function renderProducts(){
  const wrap = qs('[data-products]');
  const empty = qs('[data-collection-empty]');
  const collection = COLLECTIONS[selectedCollection] || COLLECTIONS.normal;
  const list = productsForCollection();

  qs('[data-collection-title]').textContent = collection.heading;
  qsa('[data-collection]').forEach(button => {
    const active = button.dataset.collection === selectedCollection;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if(!list.length){
    wrap.innerHTML = '';
    empty.hidden = false;
    empty.textContent = collection.empty;
    return;
  }

  empty.hidden = true;
  empty.textContent = '';
  wrap.innerHTML = list.map(product => `
    <article class="product-card" data-product-collection="${esc(product.collection)}">
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
            <select data-size="${esc(product.id)}">${product.sizes.map(s => `<option>${esc(s)}</option>`).join('')}</select>
          </label>
          <label>Qty
            <input data-qty="${esc(product.id)}" type="number" min="1" max="9" value="1" />
          </label>
          <button type="button" class="button primary" data-add="${esc(product.id)}">Add to cart</button>
        </div>
      </div>
    </article>`).join('');
  initializeGalleries();
}

function setCollection(collection, { scroll = true } = {}){
  const next = COLLECTIONS[collection] ? collection : 'normal';
  selectedCollection = next;
  const url = new URL(window.location.href);
  if(next === 'normal') url.searchParams.delete('collection');
  else url.searchParams.set('collection', next);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  renderProducts();
  if(scroll) qs('#shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initializeGalleries(){
  qsa('.product-card').forEach(card => {
    const rail = card.querySelector('.mockup-rail');
    const slides = [...card.querySelectorAll('.mockup')];
    const dots = [...card.querySelectorAll('[data-gallery-dot]')];
    if(!rail || !slides.length || !dots.length) return;
    const setActive = index => dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
    const currentIndex = () => {
      const nearest = slides.reduce((best, slide, index) => {
        const dist = Math.abs(slide.offsetLeft - rail.scrollLeft - rail.offsetLeft);
        return dist < best.dist ? { index, dist } : best;
      }, { index: 0, dist: Infinity });
      return nearest.index;
    };
    const goTo = index => {
      const next = (index + slides.length) % slides.length;
      rail.scrollTo({ left: slides[next].offsetLeft - rail.offsetLeft - 14, behavior: 'smooth' });
      setActive(next);
    };
    dots.forEach((dot, index) => dot.addEventListener('click', () => goTo(index)));
    card.querySelector('[data-gallery-prev]')?.addEventListener('click', () => goTo(currentIndex() - 1));
    card.querySelector('[data-gallery-next]')?.addEventListener('click', () => goTo(currentIndex() + 1));
    rail.addEventListener('scroll', () => window.requestAnimationFrame(() => setActive(currentIndex())), { passive: true });
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

function clearCart(){
  cart = [];
  saveCart();
  renderCart();
  closeCart();
}

function openCart(){ qs('[data-cart-drawer]').classList.add('open'); qs('[data-cart-drawer]').setAttribute('aria-hidden','false'); }
function closeCart(){ qs('[data-cart-drawer]').classList.remove('open'); qs('[data-cart-drawer]').setAttribute('aria-hidden','true'); }

document.addEventListener('click', event => {
  const collection = event.target.closest('[data-collection]');
  if(collection) setCollection(collection.dataset.collection);
  const change = event.target.closest('[data-scroll-collections]');
  if(change) qs('.collection-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const add = event.target.closest('[data-add]');
  if(add) addToCart(add.dataset.add);
  const remove = event.target.closest('[data-remove]');
  if(remove){ cart.splice(Number(remove.dataset.remove),1); saveCart(); renderCart(); }
  if(event.target.closest('[data-open-cart]')) openCart();
  if(event.target.closest('[data-close-cart]') || event.target === qs('[data-cart-drawer]')) closeCart();
});
window.addEventListener('bruis:cart-clear', clearCart);

loadCatalog().then(list => {
  products = list;
  const requested = new URLSearchParams(window.location.search).get('collection');
  selectedCollection = COLLECTIONS[requested] ? requested : 'normal';
  updateCollectionCounts();
  renderProducts();
  renderCart();
});
