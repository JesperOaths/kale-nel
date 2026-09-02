(() => {
  'use strict';

  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const SWIPE_THRESHOLD = 56;
  let active = null;

  const clampIndex = (index, length) => ((index % length) + length) % length;
  const imageSource = img => String(img?.currentSrc || img?.src || '').trim();

  function productImages(sourceImg){
    const card = sourceImg.closest('.product-card');
    if(!card) return [];
    return [...card.querySelectorAll('.mockup img')]
      .map((img, index) => ({
        img,
        src: imageSource(img),
        alt: img.alt || `Product image ${index + 1}`,
        label: img.closest('.mockup')?.querySelector('figcaption')?.textContent?.trim() || `Image ${index + 1}`
      }))
      .filter(item => item.src);
  }

  function stageTransformFrom(source, stage){
    const sourceRect = source?.getBoundingClientRect?.();
    const stageRect = stage.getBoundingClientRect();
    if(!sourceRect || !sourceRect.width || !sourceRect.height || !stageRect.width || !stageRect.height){
      return { dx: 0, dy: 0, sx: 0.72, sy: 0.72 };
    }
    return {
      dx: sourceRect.left + sourceRect.width / 2 - (stageRect.left + stageRect.width / 2),
      dy: sourceRect.top + sourceRect.height / 2 - (stageRect.top + stageRect.height / 2),
      sx: Math.max(0.08, Math.min(1, sourceRect.width / stageRect.width)),
      sy: Math.max(0.08, Math.min(1, sourceRect.height / stageRect.height))
    };
  }

  function setStageOrigin(stage, source){
    const { dx, dy, sx, sy } = stageTransformFrom(source, stage);
    stage.style.setProperty('--lb-dx', `${dx}px`);
    stage.style.setProperty('--lb-dy', `${dy}px`);
    stage.style.setProperty('--lb-sx', String(sx));
    stage.style.setProperty('--lb-sy', String(sy));
  }

  function buildOverlay(items, startIndex, sourceImg){
    const overlay = document.createElement('div');
    overlay.className = 'shop-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Expanded product images');
    overlay.innerHTML = `
      <div class="shop-lightbox-stage" data-lightbox-stage>
        <button class="shop-lightbox-close" type="button" data-lightbox-close aria-label="Close enlarged image">×</button>
        <button class="shop-lightbox-nav shop-lightbox-prev" type="button" data-lightbox-prev aria-label="Previous image">‹</button>
        <div class="shop-lightbox-media" data-lightbox-media>
          <img data-lightbox-image alt="" draggable="false" />
        </div>
        <button class="shop-lightbox-nav shop-lightbox-next" type="button" data-lightbox-next aria-label="Next image">›</button>
        <div class="shop-lightbox-meta">
          <span data-lightbox-label></span>
          <span data-lightbox-count></span>
        </div>
        <div class="shop-lightbox-dots" data-lightbox-dots aria-label="Choose enlarged image"></div>
      </div>`;

    document.body.appendChild(overlay);
    const stage = overlay.querySelector('[data-lightbox-stage]');
    const image = overlay.querySelector('[data-lightbox-image]');
    const media = overlay.querySelector('[data-lightbox-media]');
    const dots = overlay.querySelector('[data-lightbox-dots]');

    active = {
      overlay,
      stage,
      image,
      media,
      dots,
      items,
      index: clampIndex(startIndex, items.length),
      origin: sourceImg,
      focusBefore: document.activeElement,
      pointerId: null,
      pointerX: 0,
      pointerY: 0,
      moved: false,
      closing: false
    };

    items.forEach((item, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.dataset.lightboxDot = String(index);
      dot.setAttribute('aria-label', `Show enlarged image ${index + 1}`);
      dots.appendChild(dot);
    });

    renderActive(0, false);
    setStageOrigin(stage, sourceImg);
    document.documentElement.classList.add('shop-lightbox-open');

    if(REDUCED_MOTION){
      overlay.classList.add('is-open');
    } else {
      requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));
    }

    overlay.querySelector('[data-lightbox-close]')?.focus({ preventScroll: true });
    return active;
  }

  function animateImage(direction){
    if(!active || REDUCED_MOTION || !active.image.animate || direction === 0) return;
    const from = direction > 0 ? 28 : -28;
    active.image.animate(
      [
        { opacity: 0.35, transform: `translateX(${from}px) scale(.985)` },
        { opacity: 1, transform: 'translateX(0) scale(1)' }
      ],
      { duration: 210, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
  }

  function renderActive(direction = 0, animate = true){
    if(!active) return;
    const item = active.items[active.index];
    active.image.src = item.src;
    active.image.alt = item.alt;
    active.overlay.querySelector('[data-lightbox-label]').textContent = item.label;
    active.overlay.querySelector('[data-lightbox-count]').textContent = `${active.index + 1} / ${active.items.length}`;
    [...active.dots.children].forEach((dot, index) => {
      const selected = index === active.index;
      dot.classList.toggle('active', selected);
      dot.setAttribute('aria-current', selected ? 'true' : 'false');
    });
    const multiple = active.items.length > 1;
    active.overlay.querySelector('[data-lightbox-prev]').hidden = !multiple;
    active.overlay.querySelector('[data-lightbox-next]').hidden = !multiple;
    active.dots.hidden = !multiple;
    if(animate) animateImage(direction);
  }

  function goTo(index, directionHint = 0){
    if(!active || active.items.length < 2) return;
    const previous = active.index;
    const next = clampIndex(index, active.items.length);
    if(next === previous) return;
    active.index = next;
    let direction = directionHint;
    if(!direction){
      direction = next > previous ? 1 : -1;
      if(previous === active.items.length - 1 && next === 0) direction = 1;
      if(previous === 0 && next === active.items.length - 1) direction = -1;
    }
    renderActive(direction, true);
  }

  function closeLightbox(){
    if(!active || active.closing) return;
    active.closing = true;
    const state = active;
    const source = state.items[state.index]?.img?.isConnected ? state.items[state.index].img : state.origin;
    if(source?.isConnected) setStageOrigin(state.stage, source);

    const finish = () => {
      if(active !== state) return;
      state.overlay.remove();
      document.documentElement.classList.remove('shop-lightbox-open');
      const focusTarget = state.origin?.isConnected ? state.origin : state.focusBefore;
      active = null;
      focusTarget?.focus?.({ preventScroll: true });
    };

    if(REDUCED_MOTION){
      finish();
      return;
    }

    state.overlay.classList.remove('is-open');
    window.setTimeout(finish, 290);
  }

  function openLightbox(sourceImg){
    if(active || !sourceImg) return;
    const items = productImages(sourceImg);
    if(!items.length) return;
    const startIndex = Math.max(0, items.findIndex(item => item.img === sourceImg));
    buildOverlay(items, startIndex, sourceImg);
  }

  document.addEventListener('click', event => {
    const sourceImg = event.target.closest('.product-card .mockup img');
    if(sourceImg && !active){
      event.preventDefault();
      openLightbox(sourceImg);
      return;
    }

    if(!active) return;
    const target = event.target;
    if(target.closest('[data-lightbox-close]')){
      closeLightbox();
      return;
    }
    if(target.closest('[data-lightbox-prev]')){
      goTo(active.index - 1, -1);
      return;
    }
    if(target.closest('[data-lightbox-next]')){
      goTo(active.index + 1, 1);
      return;
    }
    const dot = target.closest('[data-lightbox-dot]');
    if(dot){
      goTo(Number(dot.dataset.lightboxDot));
      return;
    }
    if(target === active.overlay) closeLightbox();
  });

  document.addEventListener('keydown', event => {
    if(!active) return;
    if(event.key === 'Escape'){
      event.preventDefault();
      closeLightbox();
      return;
    }
    if(event.key === 'ArrowLeft'){
      event.preventDefault();
      goTo(active.index - 1, -1);
      return;
    }
    if(event.key === 'ArrowRight'){
      event.preventDefault();
      goTo(active.index + 1, 1);
      return;
    }
    if(event.key === 'Tab'){
      const focusable = [...active.stage.querySelectorAll('button:not([hidden])')];
      if(!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if(event.shiftKey && document.activeElement === first){
        event.preventDefault();
        last.focus();
      } else if(!event.shiftKey && document.activeElement === last){
        event.preventDefault();
        first.focus();
      }
    }
  });

  document.addEventListener('pointerdown', event => {
    if(!active || !event.target.closest('[data-lightbox-media]')) return;
    active.pointerId = event.pointerId;
    active.pointerX = event.clientX;
    active.pointerY = event.clientY;
    active.moved = false;
    active.media.setPointerCapture?.(event.pointerId);
  });

  document.addEventListener('pointermove', event => {
    if(!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.pointerX;
    const dy = event.clientY - active.pointerY;
    if(Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)){
      active.moved = true;
      active.image.style.transform = `translateX(${Math.max(-90, Math.min(90, dx * 0.32))}px)`;
    }
  });

  document.addEventListener('pointerup', event => {
    if(!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.pointerX;
    const dy = event.clientY - active.pointerY;
    active.image.style.transform = '';
    active.pointerId = null;
    if(Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)){
      goTo(active.index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }
  });

  const style = document.createElement('style');
  style.dataset.shopLightboxV820 = 'true';
  style.textContent = `
    html.shop-lightbox-open,
    html.shop-lightbox-open body { overflow: hidden !important; }
    .product-card .mockup img { cursor: zoom-in; }
    .shop-lightbox {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: block;
      background: rgba(20, 18, 16, 0);
      backdrop-filter: blur(0px);
      -webkit-backdrop-filter: blur(0px);
      transition: background 260ms ease, backdrop-filter 260ms ease;
    }
    .shop-lightbox.is-open {
      background: rgba(20, 18, 16, .68);
      backdrop-filter: blur(7px);
      -webkit-backdrop-filter: blur(7px);
    }
    .shop-lightbox-stage {
      --lb-dx: 0px;
      --lb-dy: 0px;
      --lb-sx: .72;
      --lb-sy: .72;
      position: fixed;
      left: 50%;
      top: 50%;
      width: min(94vw, 1180px);
      height: min(91vh, 940px);
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr) 58px;
      grid-template-rows: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px 12px;
      padding: clamp(12px, 2vw, 22px);
      background: #ded6ca;
      border-radius: 22px;
      box-shadow: 0 28px 90px rgba(0,0,0,.36);
      transform: translate(-50%, -50%) translate(var(--lb-dx), var(--lb-dy)) scale(var(--lb-sx), var(--lb-sy));
      transform-origin: center;
      opacity: .3;
      overflow: hidden;
      transition: transform 280ms cubic-bezier(.2,.85,.2,1), opacity 180ms ease, border-radius 280ms ease;
      will-change: transform, opacity;
    }
    .shop-lightbox.is-open .shop-lightbox-stage {
      transform: translate(-50%, -50%) translate(0, 0) scale(1);
      opacity: 1;
    }
    .shop-lightbox-media {
      grid-column: 2;
      grid-row: 1;
      width: 100%;
      height: 100%;
      min-height: 0;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 16px;
      background: #ded6ca;
      touch-action: pan-y;
      user-select: none;
    }
    .shop-lightbox-media img {
      display: block;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      object-position: center;
      user-select: none;
      -webkit-user-drag: none;
      transition: transform 120ms ease-out;
    }
    .shop-lightbox-close,
    .shop-lightbox-nav {
      border: 0;
      background: rgba(255,255,255,.72);
      color: #1f1c18;
      box-shadow: 0 4px 16px rgba(0,0,0,.12);
      cursor: pointer;
    }
    .shop-lightbox-close {
      position: absolute;
      top: 14px;
      right: 14px;
      z-index: 2;
      width: 44px;
      height: 44px;
      border-radius: 999px;
      font: 400 30px/1 system-ui, sans-serif;
    }
    .shop-lightbox-nav {
      width: 50px;
      height: 58px;
      border-radius: 14px;
      font: 300 42px/1 system-ui, sans-serif;
    }
    .shop-lightbox-prev { grid-column: 1; grid-row: 1; }
    .shop-lightbox-next { grid-column: 3; grid-row: 1; }
    .shop-lightbox-meta {
      grid-column: 1 / -1;
      grid-row: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 24px;
      font: 600 13px/1.35 system-ui, sans-serif;
      color: rgba(31,28,24,.78);
    }
    .shop-lightbox-dots {
      grid-column: 1 / -1;
      grid-row: 3;
      display: flex;
      justify-content: center;
      gap: 7px;
      min-height: 12px;
    }
    .shop-lightbox-dots button {
      width: 8px;
      height: 8px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: rgba(31,28,24,.28);
      cursor: pointer;
      transition: width 150ms ease, background 150ms ease;
    }
    .shop-lightbox-dots button.active {
      width: 24px;
      background: rgba(31,28,24,.82);
    }
    .shop-lightbox button:focus-visible {
      outline: 3px solid rgba(31,28,24,.65);
      outline-offset: 3px;
    }
    @media (max-width: 700px) {
      .shop-lightbox-stage {
        width: 96vw;
        height: 88dvh;
        grid-template-columns: 42px minmax(0, 1fr) 42px;
        gap: 6px;
        padding: 10px;
        border-radius: 18px;
      }
      .shop-lightbox-nav {
        width: 40px;
        height: 48px;
        border-radius: 12px;
        font-size: 34px;
      }
      .shop-lightbox-close {
        top: 10px;
        right: 10px;
        width: 40px;
        height: 40px;
      }
      .shop-lightbox-meta { font-size: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .shop-lightbox,
      .shop-lightbox-stage,
      .shop-lightbox-media img { transition: none !important; animation: none !important; }
    }
  `;
  document.head.appendChild(style);
})();
