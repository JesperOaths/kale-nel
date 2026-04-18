(function(){
  const path = String(location.pathname || '').toLowerCase().split('/').pop();
  if (!/^pikken(?:_live|_stats)?\.html$/.test(path)) return;
  window.GEJAST_PAGE_VERSION = 'v581';
  window.GEJAST_HIDE_WATERMARK = true;

  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function scope(){ try{ return (new URLSearchParams(location.search).get('scope') === 'family') ? 'family' : 'friends'; }catch(_){ return 'friends'; } }
  function session(){ try{ return cfg().getPlayerSessionToken ? cfg().getPlayerSessionToken() : ''; }catch(_){ return ''; } }
  async function callRpc(name, payload){
    const c = cfg();
    const headers = { apikey: c.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${c.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' };
    const res = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(payload || {}) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  async function firstRpc(names, payload){ let lastError = null; for (const name of names){ try { return await callRpc(name, payload); } catch (err) { lastError = err; } } if (lastError) throw lastError; return []; }
  function normalizeRows(raw){
    const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.rows) ? raw.rows : (Array.isArray(raw?.lobbies) ? raw.lobbies : (Array.isArray(raw?.rooms) ? raw.rooms : [])));
    return rows.map((row)=>({
      lobby_code: row.lobby_code || row.room_code || row.code || row.join_code || '',
      stage: row.stage || row.status || 'lobby',
      host_name: row.host_name || row.created_by_name || row.submitter_name || '',
      player_count: Number(row.player_count || row.players || row.active_players || 0),
      updated_at: row.updated_at || row.modified_at || row.created_at || '',
      can_join: row.can_join !== false && !/finished|closed|disbanded/i.test(String(row.stage || row.status || ''))
    })).filter((row)=>row.lobby_code);
  }

  function injectScrollUnlock(){
    if (document.getElementById('pkV581ScrollFix')) return;
    const style = document.createElement('style');
    style.id = 'pkV581ScrollFix';
    style.textContent = `
      html, body { height:auto !important; min-height:100% !important; overflow-y:auto !important; overflow-x:hidden !important; -webkit-overflow-scrolling:touch !important; }
      body[data-pikken-page="lobby"] { touch-action:pan-y !important; overscroll-behavior-y:auto !important; }
      body[data-pikken-page="lobby"] .wrap,
      body[data-pikken-page="lobby"] .shell { overflow:visible !important; max-height:none !important; }
      @media (max-width:760px){ body[data-pikken-page="lobby"] { padding-bottom:24px !important; } }
    `;
    document.head.appendChild(style);
  }

  function patchConnectionCopy(){
    document.querySelectorAll('#pkConnectionPill').forEach((pill)=>{
      const txt = String(pill.textContent || '').toLowerCase();
      if (txt.includes('hapert')) pill.textContent = 'sync wordt bijgewerkt';
      else if (txt.includes('verbinding ok')) pill.textContent = 'live sync';
    });
  }

  function softenViewerCopy(){
    document.querySelectorAll('#pkModePill,#pkLiveModePill').forEach((pill)=>{
      if (/viewer mode/i.test(pill.textContent || '')) pill.textContent = 'kijkmodus';
    });
    const hasSession = !!session();
    const modeCopy = document.getElementById('pkModeCopy');
    if (modeCopy && hasSession) modeCopy.textContent = 'Je bent ingelogd. Join een open lobby of open je actieve tafel. Kijkmodus is alleen een veilige fallback als de spelerstoel nog niet bewezen is.';
    const viewerMeta = document.getElementById('viewerMeta');
    if (viewerMeta && hasSession && /alleen zichtbaar|veilig in viewer mode/i.test(viewerMeta.textContent || '')) viewerMeta.textContent = 'Je bent ingelogd. Als jouw stoel nog niet bevestigd is, blijf je tijdelijk in kijkmodus totdat de tafel jouw spelersidentiteit herkent.';
    const dockTitle = document.getElementById('dockTitle');
    const dockCopy = document.getElementById('dockCopy');
    if (dockTitle && /viewer mode/i.test(dockTitle.textContent || '')) dockTitle.textContent = 'Kijkmodus / spelersmodus';
    if (dockCopy && hasSession) dockCopy.textContent = 'Je bent ingelogd. Gebruik de lobby of open lobbies hieronder om je tafel snel terug te vinden.';
  }

  function injectLobbyPanel(){
    if (path !== 'pikken.html') return null;
    if (document.getElementById('pkOpenLobbyPanel')) return document.getElementById('pkOpenLobbyPanel');
    const joinField = document.getElementById('pkJoinCode');
    if (!joinField) return null;
    const field = joinField.closest('.field');
    if (!field) return null;
    const panel = document.createElement('section');
    panel.id = 'pkOpenLobbyPanel';
    panel.className = 'helper-card';
    panel.innerHTML = '<strong>Actieve / open lobbies</strong><div class="muted" style="margin-top:4px">Direct zichtbaar voor mobiel testen. Tik op een room om hem meteen te joinen of te openen.</div><div id="pkOpenLobbyList" class="players-list" style="margin-top:10px"><div class="player-row"><div class="muted">Lobbies laden…</div></div></div>';
    field.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function renderLobbyRows(rows){
    const root = document.getElementById('pkOpenLobbyList');
    if (!root) return;
    if (!rows.length) {
      root.innerHTML = '<div class="player-row"><div class="muted">Nog geen open Pikken-lobbies zichtbaar.</div></div>';
      return;
    }
    root.innerHTML = rows.map((row)=>`<div class="player-row"><div><strong>${row.lobby_code}</strong><div class="muted">${row.host_name || 'Onbekende host'} · ${row.player_count || 0} speler(s) · ${row.stage || 'lobby'}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn alt" type="button" data-pk-open="${row.lobby_code}">${row.can_join ? 'Join lobby' : 'Open live'}</button></div></div>`).join('');
    root.querySelectorAll('[data-pk-open]').forEach((btn)=>btn.addEventListener('click', ()=>{
      const code = btn.getAttribute('data-pk-open') || '';
      const input = document.getElementById('pkJoinCode');
      if (input) input.value = code;
      const joinBtn = document.getElementById('pkJoinLobbyBtn');
      if (joinBtn && !joinBtn.disabled) joinBtn.click();
      else location.href = `./pikken_live.html?lobby=${encodeURIComponent(code)}`;
    }));
  }

  async function refreshOpenLobbies(){
    if (path !== 'pikken.html') return;
    injectLobbyPanel();
    try {
      const rows = normalizeRows(await firstRpc([
        'get_pikken_open_lobbies_public_scoped',
        'get_pikken_open_lobbies_public',
        'list_pikken_open_lobbies_public_scoped',
        'list_pikken_open_lobbies_public'
      ], { site_scope_input: scope(), session_token: session() || null }));
      renderLobbyRows(rows);
    } catch (_) {
      renderLobbyRows([]);
    }
  }

  function addClaimHintButton(){
    if (path !== 'pikken_live.html') return;
    const actions = document.querySelector('.top-actions');
    if (!actions || document.getElementById('pkClaimSeatBtn')) return;
    const btn = document.createElement('a');
    btn.id = 'pkClaimSeatBtn';
    btn.className = 'soft-btn';
    btn.textContent = 'Terug naar lobby';
    btn.href = './pikken.html';
    actions.appendChild(btn);
  }

  onReady(()=>{
    injectScrollUnlock();
    patchConnectionCopy();
    softenViewerCopy();
    addClaimHintButton();
    if (path === 'pikken.html') refreshOpenLobbies().catch(()=>{});
    const observer = new MutationObserver(()=>{ patchConnectionCopy(); softenViewerCopy(); });
    observer.observe(document.body, { childList:true, subtree:true, characterData:true });
    if (path === 'pikken.html') window.setInterval(()=>{ refreshOpenLobbies().catch(()=>{}); }, 5000);
  });
})();
