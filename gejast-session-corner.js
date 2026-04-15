
(function(){
  const CONFIG = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = CONFIG.SUPABASE_URL || '';
  const SUPABASE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || '';
  const SESSION_KEYS = ['jas_session_token_v11','jas_session_token_v10'];
  function getToken(){ for (const key of SESSION_KEYS){ const v=localStorage.getItem(key)||sessionStorage.getItem(key); if(v) return v; } return ''; }
  function clearTokens(){ for (const key of SESSION_KEYS){ localStorage.removeItem(key); sessionStorage.removeItem(key); } }
  function rpcHeaders(){ return { 'Content-Type':'application/json', apikey: SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}` }; }
  async function fetchViewer(token){
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return { name:'', coins:0 };
    const payload = JSON.stringify({ session_token: token, session_token_input: token });
    for (const rpc of ['get_public_state','get_gejast_homepage_state','get_jas_app_state']){
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: payload });
        const data = await res.json().catch(()=>null);
        if (!res.ok) continue;
        const name = data?.my_name || data?.display_name || data?.player_name || '';
        if (name) return { name, coins: Number(data?.caute_coins ?? data?.coin_balance ?? data?.viewer?.caute_coins ?? 0) || 0 };
      } catch {}
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_caute_coins_public`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: payload });
      const data = await res.json().catch(()=>null);
      return { name:'', coins: Number(data?.balance ?? data?.caute_coins ?? 0) || 0 };
    } catch {}
    return { name:'', coins:0 };
  }
  function mount(){
    if (document.getElementById('playerSessionCorner')) return document.getElementById('playerSessionCorner');
    const box=document.createElement('div');
    box.id='playerSessionCorner'; box.className='player-session-corner'; box.setAttribute('aria-live','polite');
    box.innerHTML='<div class="player-session-corner-label">Ingelogd als</div><div id="playerSessionCornerName" class="player-session-corner-name"></div><div id="playerSessionCornerCoins" class="player-session-corner-coins"></div><div class="player-session-corner-actions"><a id="playerSessionCornerProfile" href="./player.html" class="player-session-corner-btn alt">Mijn profiel</a><button id="playerSessionCornerLogout" type="button" class="player-session-corner-btn">Log out</button></div>';
    document.body.appendChild(box);
    const style=document.createElement('style');
    style.textContent='.player-session-corner{position:fixed;top:14px;right:14px;z-index:9999;background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.08);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.12);padding:8px 10px;min-width:112px;display:none}.player-session-corner.is-visible{display:flex;flex-direction:column;align-items:flex-end;gap:8px}.player-session-corner-label{font-size:11px;line-height:1.15;color:#5f5b53;text-align:right}.player-session-corner-name{font-size:13px;line-height:1.1;font-weight:800;color:#111;text-align:right;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.player-session-corner-coins{font-size:11px;line-height:1.1;color:#7a6533;font-weight:800;text-align:right}.player-session-corner-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.player-session-corner-btn{appearance:none;border:0;border-radius:999px;background:#111;color:#fff;font:inherit;font-weight:800;font-size:11px;line-height:1;padding:8px 11px;cursor:pointer;box-shadow:none;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.player-session-corner-btn.alt{background:#f3efe6;color:#111;border:1px solid rgba(0,0,0,.08)}@media (max-width:640px){.player-session-corner{top:10px;right:10px;padding:7px 9px;min-width:100px}.player-session-corner-name{max-width:120px}}';
    document.head.appendChild(style);
    return box;
  }
  async function init(){
    const box=mount(); const nameEl=document.getElementById('playerSessionCornerName'); const coinsEl=document.getElementById('playerSessionCornerCoins'); const btn=document.getElementById('playerSessionCornerLogout');
    if(!box||!nameEl||!btn) return;
    btn.addEventListener('click', function(){ clearTokens(); box.classList.remove('is-visible'); window.location.href='./home.html'; });
    const token=getToken(); if(!token) return;
    const viewer=await fetchViewer(token);
    if(viewer && viewer.name){ nameEl.textContent=viewer.name; if (coinsEl) coinsEl.textContent=(CONFIG.formatCauteCoins?CONFIG.formatCauteCoins(viewer.coins||0):`₵ ${Math.round(Number(viewer.coins||0)||0)} caute coins`); box.classList.add('is-visible'); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
