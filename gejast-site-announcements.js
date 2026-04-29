(function(global){
  const STATE = { timer:null, showing:false };
  function cfg(){ return global.GEJAST_CONFIG || {}; }
  function hasPlayer(){ try { return !!(cfg().getPlayerSessionToken && cfg().getPlayerSessionToken()); } catch(_) { return false; } }
  function scope(){
    try { if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') return global.GEJAST_SCOPE_UTILS.getScope(); } catch(_) {}
    try { return new URLSearchParams(global.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_) {}
    return 'friends';
  }
  function esc(v){ return String(v??'').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function shortDate(v){ if(!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString('nl-NL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); }
  function money(v){ const n=Number(v||0); return `${Number.isFinite(n)?Math.round(n):0} ₵`; }
  function routeMarket(row){
    const id = row?.market_id || row?.payload?.market_id || 0;
    const qs = scope()==='family' ? '&scope=family' : '';
    return `./despimarkt_market.html?market=${encodeURIComponent(id)}${qs}`;
  }
  async function rpc(name, payload){
    if (global.GEJAST_SCOPED_RPC && typeof global.GEJAST_SCOPED_RPC.callRpc === 'function') return await global.GEJAST_SCOPED_RPC.callRpc(name, payload || {});
    const c = cfg();
    const res = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:{ apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify(payload||{}) });
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch(_) { throw new Error(txt || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || txt || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  function normalizeRows(v){ return Array.isArray(v) ? v : Array.isArray(v?.rows) ? v.rows : []; }
  function ensureStyles(){
    if (global.document.getElementById('despimarkt-announcement-style')) return;
    const style = global.document.createElement('style');
    style.id = 'despimarkt-announcement-style';
    style.textContent = `
      .dm-ann-overlay{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;background:radial-gradient(circle at center, rgba(255,242,204,.22), rgba(12,10,7,.72));padding:18px;animation:dmAnnFade .25s ease}
      .dm-ann-shell{position:relative;max-width:720px;width:min(100%,720px);background:linear-gradient(180deg,#fffdfa,#f8eed0);border:1px solid rgba(154,130,65,.34);border-radius:30px;padding:28px;box-shadow:0 30px 70px rgba(0,0,0,.28);overflow:hidden}
      .dm-ann-kicker{display:inline-flex;padding:7px 11px;border-radius:999px;background:#111;color:#fff;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
      .dm-ann-title{margin:14px 0 10px;font-size:clamp(2rem,4vw,3.2rem);line-height:1.02;color:#201b16}
      .dm-ann-body{color:#5f5649;font-size:1.02rem}
      .dm-ann-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
      .dm-ann-card{padding:16px;border-radius:22px;background:rgba(255,255,255,.72);border:1px solid rgba(54,40,20,.08)}
      .dm-ann-card span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:900;color:#7f6a3d;margin-bottom:6px}
      .dm-ann-card strong{font-size:1.22rem}
      .dm-ann-payouts{display:grid;gap:10px;margin-top:18px}
      .dm-ann-row{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:18px;border:1px solid rgba(54,40,20,.08);background:#fff}
      .dm-ann-row strong{font-size:1rem}
      .dm-ann-row .pill{display:inline-flex;align-items:center;justify-content:center;padding:5px 10px;border-radius:999px;background:#e3f0e5;color:#2e5232;font-size:12px;font-weight:900}
      .dm-ann-close{margin-top:18px;display:inline-flex;align-items:center;justify-content:center;padding:11px 16px;border-radius:999px;border:1px solid rgba(54,40,20,.14);background:#111;color:#fff;font-weight:800;cursor:pointer}
      .dm-ann-burst,.dm-ann-burst:before,.dm-ann-burst:after{position:absolute;inset:auto;content:"";border-radius:50%;pointer-events:none}
      .dm-ann-burst{top:-50px;right:-40px;width:200px;height:200px;background:radial-gradient(circle, rgba(255,215,0,.28), transparent 62%)}
      .dm-ann-burst:before{top:340px;left:-40px;width:170px;height:170px;background:radial-gradient(circle, rgba(154,130,65,.18), transparent 62%)}
      .dm-ann-burst:after{top:120px;left:220px;width:120px;height:120px;background:radial-gradient(circle, rgba(135,183,223,.18), transparent 62%)}
      .dm-toast-stack{position:fixed;right:16px;bottom:84px;z-index:10019;display:grid;gap:12px;max-width:min(92vw,360px)}
      .dm-toast{background:linear-gradient(180deg,#fffdfa,#f7f1e4);border:1px solid rgba(54,40,20,.1);border-radius:22px;box-shadow:0 22px 48px rgba(0,0,0,.18);padding:16px}
      .dm-toast .kicker{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:900;color:#866d32}
      .dm-toast strong{display:block;margin-top:6px;font-size:1.05rem}
      .dm-toast p{margin:8px 0 0;color:#5f5649;font-size:.95rem}
      .dm-toast .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .dm-toast .btn{display:inline-flex;align-items:center;justify-content:center;padding:9px 12px;border-radius:999px;border:1px solid rgba(54,40,20,.1);background:#111;color:#fff;font-weight:800;text-decoration:none}
      .dm-toast .btn.alt{background:#fff;color:#201b16}
      @keyframes dmAnnFade{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:scale(1)}}
      @media (max-width:640px){ .dm-ann-grid{grid-template-columns:1fr} .dm-ann-shell{padding:22px} .dm-toast-stack{left:12px;right:12px;bottom:74px;max-width:none} }
    `;
    global.document.head.appendChild(style);
  }
  async function consumeAnnouncement(row){
    try { await rpc('consume_player_site_announcement_scoped', { announcement_id_input: row.announcement_id, site_scope_input: scope() }); } catch(_){}
  }
  async function showResolvedOverlay(row){
    ensureStyles();
    STATE.showing = true;
    const overlay = global.document.createElement('div');
    overlay.className = 'dm-ann-overlay';
    const winners = normalizeRows(row.payload?.winner_payouts || row.payload?.winners).slice(0,8);
    overlay.innerHTML = `
      <div class="dm-ann-shell" role="dialog" aria-modal="true" aria-label="Beurs d'Espinoza settlement">
        <div class="dm-ann-burst"></div>
        <div class="dm-ann-kicker">Beurs d'Espinoza · Settlement</div>
        <div class="dm-ann-title">${esc(row.payload?.title || 'Markt resolved!')}</div>
        <div class="dm-ann-body">De markt is beslist. Winnaars en uitbetalingen staan nu server-side vast in cautes.</div>
        <div class="dm-ann-grid">
          <div class="dm-ann-card"><span>Winnende kant</span><strong>${esc(row.payload?.winning_outcome_label || row.payload?.winning_label || row.payload?.winning_outcome_key || '—')}</strong></div>
          <div class="dm-ann-card"><span>Totale pot</span><strong>${money(row.payload?.total_pot_cautes || 0)}</strong></div>
        </div>
        <div class="dm-ann-payouts">${winners.length ? winners.map((w)=>`<div class="dm-ann-row"><div><strong>${esc(w.player_name || '')}</strong><div>${money(w.winning_stake_cautes || 0)} winnende stake</div></div><div class="pill">${money(w.payout_cautes || 0)}</div></div>`).join('') : '<div class="dm-ann-row"><div><strong>Geen payoutdetails</strong><div>Open de markt voor de volledige settlement.</div></div></div>'}</div>
        <div class="actions"><a class="dm-ann-close" href="${routeMarket(row)}">Open markt</a><button class="dm-ann-close" type="button" id="dmResolvedDismiss">Lekker</button></div>
      </div>`;
    global.document.body.appendChild(overlay);
    const finish = async ()=>{ await consumeAnnouncement(row); try { overlay.remove(); } catch(_){} STATE.showing = false; };
    overlay.querySelector('#dmResolvedDismiss').onclick = finish;
    const openLink = overlay.querySelector('a.dm-ann-close');
    if (openLink) openLink.addEventListener('click', ()=>{ consumeAnnouncement(row); });
    overlay.addEventListener('click', (ev)=>{ if (ev.target === overlay) finish(); });
    global.setTimeout(finish, 9000);
  }
  async function showToast(row){
    ensureStyles();
    const stack = global.document.querySelector('.dm-toast-stack') || (()=>{ const s=global.document.createElement('div'); s.className='dm-toast-stack'; global.document.body.appendChild(s); return s; })();
    const toast = global.document.createElement('div');
    toast.className = 'dm-toast';
    const kind = row.announcement_kind || row.announcement_type || '';
    const title = row.payload?.title || 'Marktupdate';
    const body = kind === 'despimarkt_follow_close_soon'
      ? `Deze gevolgde markt sluit om ${shortDate(row.payload?.closes_at)}.`
      : kind === 'despimarkt_promotional_market_live'
        ? `${money(row.payload?.promo_seed_cautes || 0)} officiële backing op ${esc(row.payload?.backed_label || row.payload?.backed_outcome_key || 'een kant')}. Perfect om mee te oefenen.`
        : `${esc(row.payload?.bettor_name || 'Iemand')} zette ${money(row.payload?.stake_cautes || 0)} op ${esc(row.payload?.outcome_label || row.payload?.outcome_key || 'een kant')}.`;
    const kicker = kind === 'despimarkt_follow_close_soon'
      ? 'Watchlist · Sluit bijna'
      : kind === 'despimarkt_promotional_market_live'
        ? 'Beurs d\'Espinoza · Nieuwe oefenmarkt'
        : 'Watchlist · Nieuwe inzet';
    toast.innerHTML = `<div class="kicker">${kicker}</div><strong>${esc(title)}</strong><p>${body}</p><div class="actions"><a class="btn" href="${routeMarket(row)}">Open markt</a><button class="btn alt" type="button">Sluiten</button></div>`;
    stack.appendChild(toast);
    const done = async ()=>{ await consumeAnnouncement(row); try { toast.remove(); } catch(_){} };
    toast.querySelector('button').onclick = done;
    const openBtn = toast.querySelector('a.btn');
    if (openBtn) openBtn.addEventListener('click', ()=>{ consumeAnnouncement(row); });
    global.setTimeout(done, 7000);
  }
  async function poll(){
    if (!hasPlayer() || STATE.showing) return;
    try {
      const data = await rpc('get_player_site_announcements_scoped', { site_scope_input: scope(), limit_count: 8 });
      const rows = normalizeRows(data?.rows || data);
      if (!rows.length) return;
      const first = rows[0];
      const kind = first.announcement_kind || first.announcement_type || '';
      if (kind === 'despimarkt_market_resolved') await showResolvedOverlay(first);
      else if (kind === 'despimarkt_follow_bet' || kind === 'despimarkt_follow_close_soon' || kind === 'despimarkt_promotional_market_live') await showToast(first);
      else await consumeAnnouncement(first);
    } catch(_){}
  }
  function shouldRun(){
    try { const path = (global.location.pathname || '').toLowerCase(); return !/\/admin/.test(path); } catch(_) { return true; }
  }
  function start(){
    if (!shouldRun()) return;
    poll();
    if (STATE.timer) global.clearInterval(STATE.timer);
    STATE.timer = global.setInterval(poll, 20000);
  }
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})(window);
