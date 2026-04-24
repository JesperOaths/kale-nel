(function(global){
  'use strict';
  const cfg = global.GEJAST_CONFIG || {};
  const FALLBACK_VERSION = 'v636';
  const SOURCE_NAME = 'gejast-version-source';
  function parseVersion(value){ const m = String(value || '').match(/v?(\d+)/i); return m ? Number(m[1]) : 0; }
  function normalizeVersion(value){ const n = parseVersion(value); return n ? `v${n}` : FALLBACK_VERSION; }
  function scriptVersions(){
    try { return Array.from(document.scripts || []).map((script)=>String(script.src || '')).map((src)=>{ const m = src.match(/[?&]v(\d+[a-z]?)(?:\b|&|$)/i); return m ? `v${m[1]}` : ''; }).filter(Boolean); }
    catch (_) { return []; }
  }
  function candidateVersions(){
    const candidates = [];
    try { if (global.GEJAST_PAGE_VERSION) candidates.push(global.GEJAST_PAGE_VERSION); } catch (_) {}
    try { if (cfg.VERSION) candidates.push(cfg.VERSION); } catch (_) {}
    candidates.push(...scriptVersions());
    candidates.push(FALLBACK_VERSION);
    return candidates.map(normalizeVersion).filter(Boolean);
  }
  function getEffectiveVersion(){ return candidateVersions().sort((a,b)=>parseVersion(b)-parseVersion(a))[0] || FALLBACK_VERSION; }
  function getLabel(){ return `${getEffectiveVersion()} · Made by Bruis`; }
  function styleWatermark(node){
    if (!node || !node.style) return;
    const compact = global.matchMedia && global.matchMedia('(max-width:640px)').matches;
    Object.assign(node.style, { position:'fixed', left:'50%', transform:'translateX(-50%)', bottom:compact?'10px':'14px', zIndex:'9999', padding:compact?'7px 11px':'8px 14px', borderRadius:'999px', background:'rgba(17,17,17,0.88)', border:'1px solid rgba(154,130,65,0.35)', color:'#f3e3a6', font:compact?'700 12px/1.2 Inter,system-ui,sans-serif':'700 13px/1.2 Inter,system-ui,sans-serif', letterSpacing:'.03em', pointerEvents:'none', userSelect:'none', boxShadow:'0 12px 24px rgba(0,0,0,0.18)', textAlign:'center' });
  }
  function ensureWatermark(){
    if (!document.body) return [];
    const selectors = ['[data-version-watermark]', '.site-credit-watermark', '#versionWatermark', '.version-tag'];
    let nodes = selectors.flatMap((sel)=>Array.from(document.querySelectorAll(sel))).filter(Boolean);
    if (!nodes.length) { const node = document.createElement('div'); node.className = 'site-credit-watermark'; node.setAttribute('data-version-watermark',''); node.setAttribute('data-version-watermark-source', SOURCE_NAME); document.body.appendChild(node); nodes = [node]; }
    const seen = new Set();
    return nodes.filter((node)=>{ if(seen.has(node)) return false; seen.add(node); return true; });
  }
  function applyVersionLabel(){
    const label = getLabel();
    global.GEJAST_PAGE_VERSION = getEffectiveVersion();
    ensureWatermark().forEach((node)=>{ node.textContent = label; styleWatermark(node); });
    try { const re = /v\d+[a-z]?\s*[·.-]?\s*Made by Bruis/i; document.querySelectorAll('body *').forEach((node)=>{ if (node.children && node.children.length) return; const txt = String(node.textContent || '').trim(); if (re.test(txt)) { node.textContent = label; styleWatermark(node); } }); } catch (_) {}
    return label;
  }
  function getVersionReport(){
    const scripts = Array.from(document.scripts || []).map((script)=>String(script.getAttribute('src') || script.src || '')).filter(Boolean);
    const versioned = scripts.map((src)=>({ src, version:(src.match(/[?&]v(\d+[a-z]?)/i)||[])[1] ? `v${(src.match(/[?&]v(\d+[a-z]?)/i)||[])[1]}` : '' }));
    const effective = getEffectiveVersion();
    const mismatches = versioned.filter((row)=>row.version && normalizeVersion(row.version) !== effective);
    return { ok:mismatches.length===0, effective_version: effective, config_version: normalizeVersion(cfg.VERSION || ''), page_version: normalizeVersion(global.GEJAST_PAGE_VERSION || ''), script_versions: versioned, mismatches, generated_at: new Date().toISOString() };
  }
  const api = { parseVersion, normalizeVersion, candidateVersions, getEffectiveVersion, getLabel, ensureWatermark, applyVersionLabel, getVersionReport };
  global.GEJAST_VERSION_SOURCE = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVersionLabel, { once:true }); else applyVersionLabel();
})(window);
