/* GEJAST v711 version source-of-truth runtime
   Purpose: make ./VERSION the practical browser source of truth for all visible version labels.
   This does not move game truth into the browser. It only synchronizes the UI/runtime version label. */
(function(){
  'use strict';
  if (window.__GEJAST_VERSION_SOURCE_OF_TRUTH_V711__) return;
  window.__GEJAST_VERSION_SOURCE_OF_TRUTH_V711__ = true;

  const FALLBACK_VERSION = 'v711';
  const VERSION_FILE = './VERSION';

  function parseVersion(value){
    const match = String(value || '').match(/v?\s*(\d+)/i);
    return match ? `v${match[1]}` : '';
  }

  function versionNumber(value){
    const match = String(value || '').match(/v?\s*(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  function bestKnownVersion(){
    const candidates = [
      window.GEJAST_SITE_VERSION,
      window.GEJAST_PAGE_VERSION,
      window.GEJAST_CONFIG && window.GEJAST_CONFIG.VERSION,
      FALLBACK_VERSION
    ].map(parseVersion).filter(Boolean);
    return candidates.sort((a,b)=>versionNumber(b)-versionNumber(a))[0] || FALLBACK_VERSION;
  }

  function versionLabel(version){
    return `${parseVersion(version) || FALLBACK_VERSION}  -  Made by Bruis`;
  }

  function styleWatermark(node){
    if (!node || !node.style) return;
    const compact = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    Object.assign(node.style, {
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: compact ? '10px' : '14px',
      zIndex: '9999',
      padding: compact ? '7px 11px' : '8px 14px',
      borderRadius: '999px',
      background: 'rgba(17,17,17,0.88)',
      border: '1px solid rgba(212,175,55,0.35)',
      color: '#f3e3a6',
      font: compact ? '700 12px/1.2 Inter,system-ui,sans-serif' : '700 13px/1.2 Inter,system-ui,sans-serif',
      letterSpacing: '.03em',
      pointerEvents: 'none',
      userSelect: 'none',
      boxShadow: '0 12px 24px rgba(0,0,0,0.18)',
      textAlign: 'center',
      maxWidth: compact ? 'calc(100vw - 24px)' : '',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)'
    });
  }

  function updateKnownGlobals(version){
    const clean = parseVersion(version) || FALLBACK_VERSION;
    const label = versionLabel(clean);
    window.GEJAST_SITE_VERSION = clean;
    window.GEJAST_PAGE_VERSION = clean;
    if (window.GEJAST_CONFIG) {
      window.GEJAST_CONFIG.VERSION = clean;
      window.GEJAST_CONFIG.VERSION_LABEL = label;
      window.GEJAST_CONFIG.VERSION_SOURCE = VERSION_FILE;
    }
    return { version: clean, label };
  }

  function applyVisibleVersion(version){
    const { label } = updateKnownGlobals(version);
    if (!document.body) return;
    const selectors = ['[data-version-watermark]','.site-credit-watermark','#versionWatermark','.version-tag','.watermark'];
    const nodes = selectors.flatMap((selector)=>Array.from(document.querySelectorAll(selector))).filter(Boolean);
    if (!nodes.length) {
      const node = document.createElement('div');
      node.setAttribute('data-version-watermark','');
      node.setAttribute('data-version-watermark-source','VERSION');
      document.body.appendChild(node);
      nodes.push(node);
    }
    const seen = new Set();
    nodes.forEach((node)=>{
      if (!node || seen.has(node)) return;
      seen.add(node);
      node.textContent = label;
      styleWatermark(node);
    });
    const labelRegex = /v\d+\s*[\-. ]+\s*Made by Bruis/i;
    document.querySelectorAll('body *').forEach((node)=>{
      if (!node || node.children.length) return;
      const text = String(node.textContent || '').trim();
      if (labelRegex.test(text)) {
        node.textContent = label;
        styleWatermark(node);
      }
    });
  }

  async function readVersionFile(){
    try {
      const response = await fetch(`${VERSION_FILE}?ts=${Date.now()}`, { cache:'no-store' });
      if (!response.ok) return '';
      return parseVersion(await response.text());
    } catch (_) {
      return '';
    }
  }

  async function syncVersion(){
    applyVisibleVersion(bestKnownVersion());
    const versionFromFile = await readVersionFile();
    applyVisibleVersion(versionFromFile || bestKnownVersion());
    return window.GEJAST_SITE_VERSION || FALLBACK_VERSION;
  }

  window.GEJAST_VERSION_SOURCE_OF_TRUTH = {
    version: FALLBACK_VERSION,
    file: VERSION_FILE,
    sync: syncVersion,
    apply: applyVisibleVersion,
    parse: parseVersion
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{ syncVersion(); }, { once:true });
  } else {
    syncVersion();
  }
})();
