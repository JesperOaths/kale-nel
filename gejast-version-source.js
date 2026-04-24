(function(){
  const TARGET='v654';
  function parse(v){const m=String(v||'').match(/v?(\d+)/i);return m?Number(m[1]):0;}
  function scripts(){return Array.from(document.scripts||[]).map(s=>s.getAttribute('src')||s.src||'').filter(Boolean);}
  function detect(){const vals=[window.GEJAST_PAGE_VERSION,window.GEJAST_CONFIG&&window.GEJAST_CONFIG.VERSION];scripts().forEach(src=>{const m=src.match(/[?&]v(\d+)/i); if(m) vals.push('v'+m[1]);});return vals.filter(Boolean);}
  function effective(){return detect().sort((a,b)=>parse(b)-parse(a))[0]||TARGET;}
  function applyVersionLabel(){const label=effective()+' · Made by Bruis';document.querySelectorAll('[data-version-watermark],.site-credit-watermark,#versionWatermark,.version-tag,.watermark').forEach(n=>{n.textContent=label;});window.GEJAST_PAGE_VERSION=effective();return label;}
  function getVersionReport(){const versions=detect();const stale=versions.filter(v=>parse(v)!==parse(TARGET));return{ok:stale.length===0,target:TARGET,effective_version:effective(),versions,stale,script_count:scripts().length};}
  window.GEJAST_VERSION_SOURCE={TARGET,detect,effective,applyVersionLabel,getVersionReport};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyVersionLabel,{once:true});else applyVersionLabel();
})();
