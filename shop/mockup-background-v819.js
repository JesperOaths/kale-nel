(() => {
  'use strict';

  const BACKDROP = '#ded6ca';
  const TARGET = [222, 214, 202];
  const MAX_SIDE = 1600;
  const processed = new Map();
  const seen = new WeakSet();

  const isRasterMockup = url => /^https?:/i.test(url) && /\.(?:jpe?g)(?:[?#]|$)/i.test(url);

  function colorDistance(a, b){
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function cornerStats(data, width, height){
    const patch = Math.max(8, Math.min(32, Math.floor(Math.min(width, height) * 0.025)));
    const corners = [
      [0, 0],
      [width - patch, 0],
      [0, height - patch],
      [width - patch, height - patch]
    ];

    const means = corners.map(([x0, y0]) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for(let y = y0; y < y0 + patch; y += 2){
        for(let x = x0; x < x0 + patch; x += 2){
          const i = (y * width + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count += 1;
        }
      }
      return [r / count, g / count, b / count];
    });

    const mean = [0, 1, 2].map(channel => means.reduce((sum, color) => sum + color[channel], 0) / means.length);
    const spread = Math.max(...means.map(color => colorDistance(color, mean)));
    const lightness = (mean[0] + mean[1] + mean[2]) / 3;

    let variance = 0;
    let samples = 0;
    corners.forEach(([x0, y0]) => {
      for(let y = y0; y < y0 + patch; y += 2){
        for(let x = x0; x < x0 + patch; x += 2){
          const i = (y * width + x) * 4;
          const dr = data[i] - mean[0];
          const dg = data[i + 1] - mean[1];
          const db = data[i + 2] - mean[2];
          variance += (dr * dr + dg * dg + db * db) / 3;
          samples += 1;
        }
      }
    });

    return {
      mean,
      spread,
      lightness,
      sigma: Math.sqrt(variance / Math.max(1, samples))
    };
  }

  function floodBackdrop(imageData){
    const { data, width, height } = imageData;
    const stats = cornerStats(data, width, height);

    // Only alter flat, light studio-style backgrounds. Lifestyle/photo backgrounds
    // are deliberately left untouched rather than risking the garment itself.
    if(stats.lightness < 185 || stats.spread > 24 || stats.sigma > 12) return false;

    const threshold = Math.max(6, Math.min(16, stats.sigma * 2.5 + 5));
    const thresholdSq = threshold * threshold;
    const total = width * height;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    let matched = 0;

    const matchesBackground = index => {
      const i = index * 4;
      const dr = data[i] - stats.mean[0];
      const dg = data[i + 1] - stats.mean[1];
      const db = data[i + 2] - stats.mean[2];
      return dr * dr + dg * dg + db * db <= thresholdSq;
    };

    const enqueue = index => {
      if(index < 0 || index >= total || visited[index] || !matchesBackground(index)) return;
      visited[index] = 1;
      queue[tail++] = index;
    };

    for(let x = 0; x < width; x += 1){
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for(let y = 1; y < height - 1; y += 1){
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }

    while(head < tail){
      const index = queue[head++];
      matched += 1;
      const x = index % width;
      const y = (index / width) | 0;
      if(x > 0) enqueue(index - 1);
      if(x + 1 < width) enqueue(index + 1);
      if(y > 0) enqueue(index - width);
      if(y + 1 < height) enqueue(index + width);
    }

    const ratio = matched / total;
    if(ratio < 0.08 || ratio > 0.88) return false;

    for(let index = 0; index < total; index += 1){
      if(!visited[index]) continue;
      const i = index * 4;
      data[i] = TARGET[0];
      data[i + 1] = TARGET[1];
      data[i + 2] = TARGET[2];
    }
    return true;
  }

  async function transformedUrl(url){
    if(processed.has(url)) return processed.get(url);

    const task = (async () => {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'force-cache'
      });
      if(!response.ok) return url;

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
        if(!context) return url;

        context.drawImage(bitmap, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        if(!floodBackdrop(imageData)) return url;
        context.putImageData(imageData, 0, 0);

        const output = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.94));
        return output ? URL.createObjectURL(output) : url;
      } finally {
        bitmap.close?.();
      }
    })().catch(() => url);

    processed.set(url, task);
    return task;
  }

  // v820 uses the exact same conservative transformer in the enlarged gallery,
  // including for mockups whose small thumbnail has not entered the viewport yet.
  window.BRUIS_MATCH_MOCKUP_BACKGROUND = url =>
    isRasterMockup(url) ? transformedUrl(url) : Promise.resolve(url);

  async function matchImage(img){
    if(seen.has(img)) return;
    const raw = img.currentSrc || img.src || '';
    if(!isRasterMockup(raw)) return;
    seen.add(img);
    img.dataset.mockupBackground = 'processing';

    const next = await transformedUrl(raw);
    if(next !== raw){
      img.src = next;
      img.dataset.mockupBackground = 'matched';
    } else {
      img.dataset.mockupBackground = 'preserved';
    }
  }

  const intersection = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if(!entry.isIntersecting) return;
          intersection.unobserve(entry.target);
          matchImage(entry.target);
        });
      }, { rootMargin: '600px 0px' })
    : null;

  function observe(root = document){
    root.querySelectorAll?.('.mockup img').forEach(img => {
      if(seen.has(img)) return;
      if(intersection) intersection.observe(img);
      else matchImage(img);
    });
  }

  const boot = () => {
    document.documentElement.style.setProperty('--shop-image-backdrop', BACKDROP);
    observe(document);
    const mutation = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if(node.nodeType !== 1) return;
        if(node.matches?.('.mockup img')) observe(node.parentElement || node);
        else observe(node);
      }));
    });
    mutation.observe(document.body, { childList: true, subtree: true });
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
