(() => {
  'use strict';

  const MAX_SIDE = 1800;
  const ALPHA_THRESHOLD = 8;
  const fitCache = new Map();
  const requestTokens = new WeakMap();

  const sourceOf = image => String(image?.currentSrc || image?.src || '').trim();
  const isFirstImage = overlay => /^1\s*\/\s*\d+/.test(
    String(overlay?.querySelector('[data-lightbox-count]')?.textContent || '').trim()
  );

  async function cropTransparentMargins(source){
    if(!source) return source;
    if(fitCache.has(source)) return fitCache.get(source);

    const task = (async () => {
      const response = await fetch(source, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'force-cache'
      });
      if(!response.ok) return source;

      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if(!context) return source;

        context.clearRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        let visible = 0;

        for(let y = 0; y < height; y += 1){
          for(let x = 0; x < width; x += 1){
            const alpha = pixels[(y * width + x) * 4 + 3];
            if(alpha <= ALPHA_THRESHOLD) continue;
            visible += 1;
            if(x < minX) minX = x;
            if(x > maxX) maxX = x;
            if(y < minY) minY = y;
            if(y > maxY) maxY = y;
          }
        }

        if(!visible || maxX < minX || maxY < minY) return source;

        const contentWidth = maxX - minX + 1;
        const contentHeight = maxY - minY + 1;
        const occupiedWidth = contentWidth / width;
        const occupiedHeight = contentHeight / height;
        const opaqueRatio = visible / (width * height);

        // Opaque photos/mockups already fill their canvas. v821 only trims genuine
        // transparent padding from the first/front artwork and leaves later mockups alone.
        if(opaqueRatio > 0.985 || (occupiedWidth > 0.97 && occupiedHeight > 0.97)) return source;

        const padX = Math.max(10, Math.round(contentWidth * 0.045));
        const padY = Math.max(10, Math.round(contentHeight * 0.045));
        const cropX = Math.max(0, minX - padX);
        const cropY = Math.max(0, minY - padY);
        const cropRight = Math.min(width, maxX + 1 + padX);
        const cropBottom = Math.min(height, maxY + 1 + padY);
        const cropWidth = cropRight - cropX;
        const cropHeight = cropBottom - cropY;

        // If trimming would be visually negligible, keep the original source.
        if(cropWidth / width > 0.96 && cropHeight / height > 0.96) return source;

        const output = document.createElement('canvas');
        output.width = cropWidth;
        output.height = cropHeight;
        const outputContext = output.getContext('2d');
        if(!outputContext) return source;
        outputContext.clearRect(0, 0, cropWidth, cropHeight);
        outputContext.drawImage(
          canvas,
          cropX, cropY, cropWidth, cropHeight,
          0, 0, cropWidth, cropHeight
        );

        const fittedBlob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
        return fittedBlob ? URL.createObjectURL(fittedBlob) : source;
      } finally {
        bitmap.close?.();
      }
    })().catch(() => source);

    fitCache.set(source, task);
    return task;
  }

  function clearFrontMode(overlay){
    const media = overlay?.querySelector('[data-lightbox-media]');
    const image = overlay?.querySelector('[data-lightbox-image]');
    media?.classList.remove('is-front-fit-v821');
    if(image){
      delete image.dataset.frontFitSource;
      delete image.dataset.frontFitResult;
    }
  }

  async function fitFrontImage(overlay){
    if(!overlay?.isConnected) return;
    const media = overlay.querySelector('[data-lightbox-media]');
    const image = overlay.querySelector('[data-lightbox-image]');
    if(!media || !image) return;

    if(!isFirstImage(overlay)){
      clearFrontMode(overlay);
      return;
    }

    media.classList.add('is-front-fit-v821');
    const source = sourceOf(image);
    if(!source) return;
    if(image.dataset.frontFitResult === source) return;

    const token = Symbol('front-fit');
    requestTokens.set(image, token);
    const fitted = await cropTransparentMargins(source);

    if(
      !overlay.isConnected ||
      requestTokens.get(image) !== token ||
      !isFirstImage(overlay) ||
      sourceOf(image) !== source
    ) return;

    image.dataset.frontFitSource = source;
    image.dataset.frontFitResult = fitted;
    if(fitted && fitted !== source) image.src = fitted;
  }

  function scheduleFit(overlay){
    window.requestAnimationFrame(() => fitFrontImage(overlay));
  }

  const observer = new MutationObserver(records => {
    const overlays = new Set();
    records.forEach(record => {
      const targetOverlay = record.target?.closest?.('.shop-lightbox');
      if(targetOverlay) overlays.add(targetOverlay);
      record.addedNodes.forEach(node => {
        if(node.nodeType !== 1) return;
        if(node.matches?.('.shop-lightbox')) overlays.add(node);
        node.querySelectorAll?.('.shop-lightbox').forEach(overlay => overlays.add(overlay));
      });
    });
    overlays.forEach(scheduleFit);
  });

  const start = () => {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src']
    });
    document.querySelectorAll('.shop-lightbox').forEach(scheduleFit);
  };

  const style = document.createElement('style');
  style.dataset.frontLightboxFitV821 = 'true';
  style.textContent = `
    .shop-lightbox-media.is-front-fit-v821 {
      display: grid !important;
      place-items: center !important;
      padding: clamp(5px, .8vw, 12px) !important;
    }
    .shop-lightbox-media.is-front-fit-v821 img {
      width: 100% !important;
      height: 100% !important;
      max-width: 100% !important;
      max-height: 100% !important;
      object-fit: contain !important;
      object-position: 50% 50% !important;
      margin: auto !important;
    }
  `;
  document.head.appendChild(style);

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();