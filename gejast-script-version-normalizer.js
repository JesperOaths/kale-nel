(function(global){
  'use strict';
  const VersionSource = global.GEJAST_VERSION_SOURCE || {};
  function effective(){ return VersionSource.getEffectiveVersion ? VersionSource.getEffectiveVersion() : ((global.GEJAST_CONFIG && global.GEJAST_CONFIG.VERSION) || global.GEJAST_PAGE_VERSION || 'v636'); }
  function versionOf(url){ const m = String(url || '').match(/[?&]v(\d+[a-z]?)/i); return m ? `v${m[1]}` : ''; }
  function isLocalAsset(url){ const raw = String(url || ''); if (!raw) return false; if (/^(https?:)?\/\//i.test(raw)) { try { return new URL(raw, location.href).origin === location.origin; } catch (_) { return false; } } return /^\.\//.test(raw) || /^[^/][^:]*\.(js|css|html)(?:[?#].*)?$/i.test(raw); }
  function collect(){ const rows=[]; Array.from(document.scripts||[]).forEach((el)=>{ const src=el.getAttribute('src')||''; if(src) rows.push({tag:'script', attr:'src', value:src, version:versionOf(src), local:isLocalAsset(src)}); }); Array.from(document.querySelectorAll('link[href]')||[]).forEach((el)=>{ const href=el.getAttribute('href')||''; if(/\.(css|js)(?:[?#].*)?$/i.test(href)) rows.push({tag:'link', attr:'href', value:href, version:versionOf(href), local:isLocalAsset(href)}); }); return rows; }
  function report(){ const want=effective(); const assets=collect(); const mismatches=assets.filter((row)=>row.local && row.version && row.version!==want); const missing=assets.filter((row)=>row.local && !row.version && /\.(js|css)(?:[?#].*)?$/i.test(row.value)); return {ok:mismatches.length===0, wanted_version:want, checked:assets.length, mismatches, missing_versions:missing, generated_at:new Date().toISOString()}; }
  function markDocument(){ try { const r=report(); document.documentElement.setAttribute('data-gejast-version-ok', r.ok?'true':'false'); document.documentElement.setAttribute('data-gejast-version-wanted', r.wanted_version); if(!r.ok && global.console && console.warn) console.warn('[GEJAST] Script/CSS version drift detected', r); return r; } catch(err){ return {ok:false,error:err&&err.message||String(err)}; } }
  global.GEJAST_SCRIPT_VERSION_NORMALIZER = { collect, report, markDocument, versionOf, isLocalAsset };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', markDocument, {once:true}); else markDocument();
})(window);
