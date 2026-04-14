(function(){
  const CONFIG = {
    VERSION:'v430',
    SUPABASE_URL: 'https://uiqntazgnrxwliaidkmy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA',
    PLAYER_SESSION_KEYS: ['jas_session_token_v11','jas_session_token_v10'],
    PLAYER_LAST_ACTIVITY_KEY: 'jas_last_activity_at_v1',
    PLAYER_SESSION_IDLE_MS: 12 * 60 * 60 * 1000
  };
  function detectScriptVersion(){ try { const scripts = Array.from(document.scripts || []); const match = scripts.map((s)=>s.src||'').find((src)=>/gejast-config\.js\?v\d+/i.test(src)); const m = match && match.match(/\?v(\d+)/i); return m ? `v${m[1]}` : null; } catch (_) { return null; } }
  function parseVersion(v){ const m=String(v||'').match(/v?(\d+)/i); return m?Number(m[1]):0; }
  const effectiveVersion = [detectScriptVersion(), window.GEJAST_PAGE_VERSION, CONFIG.VERSION].filter(Boolean).sort((a,b)=>parseVersion(b)-parseVersion(a))[0] || CONFIG.VERSION;
  const label = `${effectiveVersion} · Made by Bruis`;
  function watermarkStyles(node){ if (!node || !node.style) return; Object.assign(node.style,{position:'fixed',left:'50%',transform:'translateX(-50%)',bottom:'14px',zIndex:'9999',padding:'8px 14px',borderRadius:'999px',background:'rgba(17,17,17,0.88)',border:'1px solid rgba(212,175,55,0.35)',color:'#f3e3a6',font:'700 13px/1.2 Inter,system-ui,sans-serif',letterSpacing:'.03em',pointerEvents:'none',userSelect:'none'}); }
  function applyVersionLabel(){ document.querySelectorAll('[data-version-watermark],.site-credit-watermark').forEach((node)=>{ node.textContent = label; watermarkStyles(node); }); }
  function getPlayerSessionToken(){ for(const key of CONFIG.PLAYER_SESSION_KEYS){ const value = localStorage.getItem(key) || sessionStorage.getItem(key); if (value) return value; } return ''; }
  window.GEJAST_CONFIG = Object.assign(window.GEJAST_CONFIG||{}, CONFIG, { applyVersionLabel, getPlayerSessionToken });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', applyVersionLabel, { once:true }); else applyVersionLabel();
})();
