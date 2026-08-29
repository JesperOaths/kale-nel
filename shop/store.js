const products = [
  { id:'jellyfish', name:'Pastel Jellyfish Illustration Tee', type:'marine', typeLabel:'Marine', price:35.44, priceMax:40.14, description:'Soft sea-life artwork with a dreamy jellyfish glow and calm ocean feel.', image:'https://images.printify.com/mockup/6a878552828b6188a0031a81/12100/92570/pastel-jellyfish-illustration-tee-watercolor-sea-life-shirt.jpg?camera_label=front&s=640&use_cdn_redirect=true&t=1787432257261' },
  { id:'hydrangea', name:'Hydrangea Watercolor Shirt', type:'floral', typeLabel:'Flowers', price:30.02, priceMax:38.75, description:'A gentle hydrangea bloom with airy petals and a fresh botanical look.', image:'https://images.printify.com/mockup/6a877906eb76ae387b05cc0f/73207/98445/hydrangea-watercolor-shirt-floral-botanical-tee.jpg?camera_label=front&s=640&use_cdn_redirect=true&t=1787265232256' },
  { id:'lace', name:'Queen Anne’s Lace Illustration Tee', type:'floral', typeLabel:'Flowers', price:27.25, priceMax:33.38, description:'Delicate Queen Anne’s lace with airy stems and pressed-flower elegance.', image:'https://images.printify.com/mockup/6a877defbecced59b0037078/12100/92570/queen-annes-lace-illustration-tee-botanical-flower-shirt.jpg?camera_label=front&s=640&use_cdn_redirect=true&t=1787265185363' },
  { id:'thistle', name:'Scottish Thistle T-Shirt', type:'botanical', typeLabel:'Botanical', price:27.25, priceMax:33.38, description:'A crisp thistle study with spiky leaves, soft bloom, and field-guide character.', image:'https://images.printify.com/mockup/6a8769e26a41fe0f530b538f/12100/92570/scottish-thistle-t-shirt-botanical-floral-illustration.jpg?camera_label=front&s=640&use_cdn_redirect=true&t=1787265262278' },
  { id:'mantis', name:'Pink Flower Mantis T-Shirt', type:'insect', typeLabel:'Insects', price:27.25, priceMax:33.38, description:'A floral mantis motif with delicate petals and a strange garden charm.', image:'https://images.printify.com/mockup/6a8781c676f52ce62f082d19/12100/102005/pink-flower-mantis-t-shirt-botanical-insect-illustration-floral-praying-mantis.jpg?camera_label=front-2&s=640&use_cdn_redirect=true&t=1787265529973' },
  { id:'fly', name:'Realistic Green Fly Illustration T-Shirt', type:'insect', typeLabel:'Insects', price:39.83, priceMax:44.13, description:'A sharp green fly illustration for people who like curious, unusual nature details.', image:'https://images.printify.com/mockup/6a871b6035cea7fe2c005ee6/103548/100285/realistic-green-fly-illustration-t-shirt-insect-nature-tee.jpg?camera_label=front&s=640&use_cdn_redirect=true&t=1787265166493' },
  { id:'axolotl', name:'Pink Axolotl Illustration T-Shirt', type:'aquatic', typeLabel:'Aquatic', price:27.25, priceMax:33.38, description:'A playful axolotl with soft aquatic character and a sweet pond-life mood.', image:'https://images.printify.com/mockup/6a877d2aeb76ae387b05cfae/12100/102005/pink-axolotl-illustration-t-shirt-cute-aquatic-creature-tee.jpg?camera_label=front-2&s=640&use_cdn_redirect=true&t=1787265207176' },
];

const typeOrder = ['floral','botanical','insect','marine','aquatic'];
const sizes = ['S','M','L','XL','2XL','3XL','4XL','5XL'];
const cartKey = 'bruisCartV1';
let filter = 'all';
let sort = 'type';
let cart = JSON.parse(localStorage.getItem(cartKey) || '[]');

const money = value => `$${value.toFixed(2)}`;
const priceRange = product => `${money(product.price)}–${money(product.priceMax)}`;
const qs = sel => document.querySelector(sel);
const qsa = sel => [...document.querySelectorAll(sel)];

function mockupUrl(image, label){
  const url = new URL(image);
  url.searchParams.set('camera_label', label);
  url.searchParams.set('s', '640');
  return url.toString();
}
function mockups(product){
  return [
    { label:'Front', cls:'mock-front', image:mockupUrl(product.image, 'front') },
    { label:'Alternate front', cls:'mock-alt', image:mockupUrl(product.image, 'front-2') },
    { label:'Back', cls:'mock-back', image:mockupUrl(product.image, 'back') },
    { label:'Alternate back', cls:'mock-back2', image:mockupUrl(product.image, 'back-2') },
    { label:'Side', cls:'mock-side', image:mockupUrl(product.image, 'side') },
    { label:'Lifestyle', cls:'mock-life', image:mockupUrl(product.image, 'lifestyle') },
    { label:'Flat lay', cls:'mock-flat', image:mockupUrl(product.image, 'flat') },
    { label:'On body', cls:'mock-person', image:mockupUrl(product.image, 'person') },
    { label:'Folded', cls:'mock-folded', image:mockupUrl(product.image, 'folded') },
  ];
}

function sortedProducts(){
  let list = filter === 'all' ? [...products] : products.filter(p => p.type === filter);
  if(sort === 'type') list.sort((a,b) => typeOrder.indexOf(a.type)-typeOrder.indexOf(b.type) || a.name.localeCompare(b.name));
  if(sort === 'name') list.sort((a,b) => a.name.localeCompare(b.name));
  if(sort === 'price-low') list.sort((a,b) => a.price-b.price);
  if(sort === 'price-high') list.sort((a,b) => b.price-a.price);
  return list;
}

function renderProducts(){
  const wrap = qs('[data-products]');
  wrap.innerHTML = sortedProducts().map(product => `
    <article class="product-card" data-type="${product.type}">
      <div class="mockup-rail" aria-label="${product.name} mockups">
        ${mockups(product).map(m => `
          <figure class="mockup ${m.cls}">
            <img src="${m.image}" alt="${product.name} — ${m.label}" loading="lazy" />
            <figcaption>${m.label}</figcaption>
          </figure>`).join('')}
      </div>
      <div class="mockup-hint">9 matching views · scroll sideways</div>
      <div class="product-copy">
        <div class="product-meta"><span class="tag">${product.typeLabel}</span><strong>${priceRange(product)}</strong></div>
        <p class="price-note">Retail range by size · 8 sizes</p>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <div class="buy-box">
          <label>Size
            <select data-size="${product.id}">${sizes.map(s => `<option>${s}</option>`).join('')}</select>
          </label>
          <label>Qty
            <input data-qty="${product.id}" type="number" min="1" max="9" value="1" />
          </label>
          <button type="button" class="button primary small" data-add="${product.id}">Add to cart</button>
        </div>
      </div>
    </article>`).join('');
}

function saveCart(){ localStorage.setItem(cartKey, JSON.stringify(cart)); }
function cartTotal(){ return cart.reduce((sum,item) => sum + item.price * item.qty, 0); }
function cartCount(){ return cart.reduce((sum,item) => sum + item.qty, 0); }

function renderCart(){
  qsa('[data-cart-count]').forEach(el => el.textContent = cartCount());
  qs('[data-cart-subtotal]').textContent = money(cartTotal());
  const items = qs('[data-cart-items]');
  if(!cart.length){
    items.innerHTML = '<p class="empty-cart">Your cart is empty. Add a shirt from the collection.</p>';
  } else {
    items.innerHTML = cart.map((item, index) => `
      <article class="cart-line">
        <img src="${item.image}" alt="${item.name}" />
        <div>
          <strong>${item.name}</strong>
          <span>${item.size} · ${item.qty} × ${money(item.price)} from-price</span>
          <button type="button" data-remove="${index}">Remove</button>
        </div>
      </article>`).join('');
  }
  const summary = cart.map(i => `${i.qty}× ${i.name} (${i.size})`).join('%0A');
  qs('[data-mail-order]').href = `mailto:hello@example.com?subject=Bruis%20order%20request&body=${summary || 'I would like to order Bruis shirts.'}`;
}

function addToCart(id){
  const product = products.find(p => p.id === id);
  const size = qs(`[data-size="${id}"]`).value;
  const qty = Math.max(1, Math.min(9, Number(qs(`[data-qty="${id}"]`).value || 1)));
  const existing = cart.find(item => item.id === id && item.size === size);
  if(existing) existing.qty += qty;
  else cart.push({ id, size, qty, name:product.name, price:product.price, image:product.image });
  saveCart(); renderCart(); openCart();
}

function openCart(){ qs('[data-cart-drawer]').classList.add('open'); qs('[data-cart-drawer]').setAttribute('aria-hidden','false'); }
function closeCart(){ qs('[data-cart-drawer]').classList.remove('open'); qs('[data-cart-drawer]').setAttribute('aria-hidden','true'); }

renderProducts(); renderCart();

document.addEventListener('click', event => {
  const add = event.target.closest('[data-add]');
  if(add) addToCart(add.dataset.add);
  if(event.target.closest('[data-open-cart]')) openCart();
  if(event.target.closest('[data-close-cart]') || event.target === qs('[data-cart-drawer]')) closeCart();
  const remove = event.target.closest('[data-remove]');
  if(remove){ cart.splice(Number(remove.dataset.remove), 1); saveCart(); renderCart(); }
  const pill = event.target.closest('[data-filter]');
  if(pill){ filter = pill.dataset.filter; qsa('[data-filter]').forEach(p => p.classList.toggle('active', p === pill)); renderProducts(); }
});

qs('[data-sort]').addEventListener('change', event => { sort = event.target.value; renderProducts(); });
document.addEventListener('keydown', event => { if(event.key === 'Escape') closeCart(); });
