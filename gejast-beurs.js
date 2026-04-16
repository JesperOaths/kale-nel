(function(){
  const CONFIG = window.GEJAST_CONFIG || {};
  const UI = {
    hero: document.getElementById('beursHeroStatus'),
    viewerCoins: document.getElementById('beursViewerCoins'),
    viewerName: document.getElementById('beursViewerName'),
    leaderboard: document.getElementById('beursLeaderboard'),
    marketStatus: document.getElementById('beursMarketStatus'),
    correctionStatus: document.getElementById('beursCorrectionStatus'),
    correctionButton: document.getElementById('beursCorrectionBtn')
  };

  function headers(){
    return {
      apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function parse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_){ throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`);
    return data;
  }

  async function rpc(name, payload){
    const raw = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: headers(),
      body: JSON.stringify(payload || {})
    }).then(parse);
    return raw?.[name] !== undefined ? raw[name] : raw;
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, (ch)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  function fmtCoins(value){
    const n = Math.round(Number(value || 0) || 0);
    return `₵ ${n}`;
  }

  function sessionToken(){
    return CONFIG.getPlayerSessionToken ? (CONFIG.getPlayerSessionToken() || '') : '';
  }

  async function loadViewer(){
    const token = sessionToken();
    if (!token){
      UI.viewerName.textContent = 'Niet ingelogd';
      UI.viewerCoins.textContent = 'Log in om je saldo te zien.';
      return;
    }
    try {
      const balance = await rpc('get_my_caute_coins_public', { session_token: token, session_token_input: token });
      const name = await (CONFIG.fetchViewerProfile ? CONFIG.fetchViewerProfile().then((v)=>v?.player_name || v?.chosen_username || v?.public_display_name || '') : Promise.resolve(''));
      UI.viewerName.textContent = name || 'Ingelogde speler';
      UI.viewerCoins.textContent = fmtCoins(balance?.balance ?? balance?.caute_coins ?? balance?.viewer_balance ?? 0);
    } catch (error) {
      UI.viewerName.textContent = 'Ingelogde speler';
      UI.viewerCoins.textContent = error?.message ? `Saldo niet geladen: ${error.message}` : 'Saldo niet geladen.';
    }
  }

  async function loadLeaderboard(){
    try {
      const payload = await rpc('get_caute_coin_top5_public', {});
      const rows = Array.isArray(payload?.rows) ? payload.rows : (Array.isArray(payload) ? payload : []);
      if (!rows.length){
        UI.leaderboard.innerHTML = '<div class="empty">Nog geen coin-ranglijst gevonden.</div>';
        return;
      }
      UI.leaderboard.innerHTML = rows.map((row, idx)=>`
        <div class="leader-row">
          <div class="leader-rank">${idx + 1}</div>
          <div>
            <strong>${esc(row.player_name || row.display_name || row.public_display_name || 'Onbekend')}</strong>
            <div class="muted">${esc(row.note || 'Publieke coin-stand')}</div>
          </div>
          <div class="leader-coins">${fmtCoins(row.coins || row.caute_coins || row.balance || 0)}</div>
        </div>
      `).join('');
    } catch (error) {
      UI.leaderboard.innerHTML = `<div class="empty">Ranglijst niet geladen: ${esc(error.message || String(error))}</div>`;
    }
  }

  function renderMissingMarketTruth(){
    UI.marketStatus.innerHTML = `
      <div class="notice-card warn">
        <strong>Geen markt-owner pad in deze repo</strong>
        <p>De huidige codebasis en de live homepage tonen Beurs d'Espinoza nog als placeholder. Ik heb in deze repo geen concrete beurs-pagina, marktbied-helper, beurs-RPC of markt-SQL gevonden om echte biedingen veilig op te corrigeren.</p>
      </div>
      <div class="notice-card">
        <strong>Wat hier nu wel vaststaat</strong>
        <p>Caute Coins bestaan al als backend-waarheid via de coin-RPC's. Daarom laat deze eerste pagina wel het coin-saldo en de publieke coin-ranglijst zien, zonder te doen alsof de handelslaag al bestaat.</p>
      </div>
    `;
    UI.correctionStatus.innerHTML = `
      <div class="notice-card warn">
        <strong>Bid-correctie nog niet uitvoerbaar</strong>
        <p>De concrete markt-opslag voor de gemelde foutieve bieding van Bruis is niet aanwezig in de geüploade repo. Daarom is er nu geen eerlijke delete- of rollback-actie die ik kan uitvoeren zonder een niet-bestaand backendpad te verzinnen.</p>
      </div>
    `;
  }

  function wireCorrectionButton(){
    if (!UI.correctionButton) return;
    UI.correctionButton.addEventListener('click', ()=>{
      UI.correctionStatus.innerHTML = `
        <div class="notice-card warn">
          <strong>Handmatige correctie blijft geblokkeerd</strong>
          <p>Ik heb bewust geen nep-adminknop gebouwd. Zodra de echte beurs-RPC en de bied-tabel of correctiefunctie in de repo staan, kan deze sectie worden omgezet naar een veilige admin-correctieflow.</p>
        </div>
      `;
    });
  }

  async function boot(){
    UI.hero.textContent = 'Eerste echte Beurs-pagina op basis van de coin-laag die al wél bestaat.';
    renderMissingMarketTruth();
    wireCorrectionButton();
    await Promise.allSettled([loadViewer(), loadLeaderboard()]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
