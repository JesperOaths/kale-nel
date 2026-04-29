(function (global) {
  function isMobile() {
    return global.matchMedia ? global.matchMedia('(max-width: 820px)').matches : false;
  }

  function cpuCores() {
    return Number(global.navigator?.hardwareConcurrency || 0) || 0;
  }

  function memoryGiB() {
    return Number(global.navigator?.deviceMemory || 0) || 0;
  }

  function networkTier() {
    const type = String(global.navigator?.connection?.effectiveType || '').toLowerCase();
    if (['slow-2g', '2g'].includes(type)) return 'slow';
    if (['3g'].includes(type)) return 'medium';
    if (['4g', '5g'].includes(type)) return 'fast';
    return 'unknown';
  }

  function isSlowDevice() {
    return cpuCores() > 0 && cpuCores() <= 4 || memoryGiB() > 0 && memoryGiB() <= 4 || networkTier() === 'slow';
  }

  function preferLiteMode() {
    return isMobile() || isSlowDevice();
  }

  function nextFrame() {
    return new Promise((resolve) => global.requestAnimationFrame(() => resolve()));
  }

  function idle(timeout) {
    return new Promise((resolve) => {
      if (typeof global.requestIdleCallback === 'function') {
        global.requestIdleCallback(() => resolve(), { timeout: timeout || 250 });
      } else {
        global.setTimeout(resolve, Math.min(timeout || 250, 120));
      }
    });
  }

  async function renderChunked(items, renderItem, options) {
    const opts = Object.assign({ batchSize: preferLiteMode() ? 12 : 24, afterChunk: null }, options || {});
    const rows = Array.isArray(items) ? items : [];
    let html = '';
    for (let index = 0; index < rows.length; index += opts.batchSize) {
      const batch = rows.slice(index, index + opts.batchSize);
      html += batch.map((item, offset) => renderItem(item, index + offset)).join('');
      if (typeof opts.afterChunk === 'function') {
        opts.afterChunk(html, index + batch.length, rows.length);
      }
      if (index + opts.batchSize < rows.length) {
        await nextFrame();
        await idle(120);
      }
    }
    return html;
  }

  function observeVisible(element, callback, options) {
    const opts = Object.assign({ rootMargin: '180px 0px 180px 0px', once: true }, options || {});
    if (!element || typeof callback !== 'function') return () => {};
    if (typeof global.IntersectionObserver !== 'function') {
      callback();
      return () => {};
    }
    const observer = new global.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        callback(entry);
        if (opts.once) observer.disconnect();
      });
    }, { root: null, rootMargin: opts.rootMargin, threshold: 0.01 });
    observer.observe(element);
    return () => observer.disconnect();
  }

  async function runStructuredBoot(stages) {
    const cfg = Object.assign({ critical: [], deferred: [], background: [], onStage: null }, stages || {});
    const mark = async (name, tasks, useIdle) => {
      if (typeof cfg.onStage === 'function') cfg.onStage(name);
      const list = Array.isArray(tasks) ? tasks : [];
      for (const task of list) {
        if (useIdle) await idle(180);
        await Promise.resolve().then(() => task());
      }
    };
    await mark('critical', cfg.critical, false);
    await nextFrame();
    await mark('deferred', cfg.deferred, true);
    await mark('background', cfg.background, true);
  }

  global.GEJAST_HEAVY_PAGE_RUNTIME = {
    isMobile,
    isSlowDevice,
    networkTier,
    preferLiteMode,
    nextFrame,
    idle,
    renderChunked,
    observeVisible,
    runStructuredBoot
  };
})(window);
