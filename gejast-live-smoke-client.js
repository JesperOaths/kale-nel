(function(){
  const cfg = window.GEJAST_CONFIG || {};
  async function smokeFetch(url, timeoutMs){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(()=>controller.abort(), timeoutMs || 5000) : null;
    try { const res = await fetch(url, { cache:'no-store', mode:'cors', signal: controller ? controller.signal : undefined }); return { ok:res.ok, status:res.status, url }; }
    catch (err) { return { ok:false, status:0, url, error:String(err && err.message || err) }; }
    finally { if(timer) clearTimeout(timer); }
  }
  async function runLiveSmoke(){
    const origin = location.origin;
    const checks = await Promise.all(['./VERSION','./gejast-config.js','./admin.html'].map((p)=>smokeFetch(new URL(p, origin).toString(), 5000)));
    return { version:(cfg.VERSION||window.GEJAST_PAGE_VERSION||''), checks };
  }
  window.GEJAST_LIVE_SMOKE_CLIENT = { runLiveSmoke };
})();
