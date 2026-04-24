(function(){
  const path = String(location.pathname || '').toLowerCase().split('/').pop();
  if (!/^pikken(?:_live|_stats)?\.html$/.test(path)) return;
  window.GEJAST_PAGE_VERSION='v635';
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
  if (document.getElementById('pkV591ScrollFix')) return;
  const style = document.createElement('style');
  style.id = 'pkV591ScrollFix';
  style.textContent = `
    html, body { height:auto !important; min-height:100% !important; overflow-y:auto !important; overflow-x:hidden !important; -webkit-overflow-scrolling:touch !important; }
    body[data-pikken-page="lobby"] { touch-action:pan-y !important; overscroll-behavior-y:auto !important; }
    body[data-pikken-page="lobby"] .wrap,
    body[data-pikken-page="lobby"] .shell { overflow:visible !important; max-height:none !important; }
    body[data-pikken-page="lobby"] .pk-room-shell{display:grid;gap:14px}
    body[data-pikken-page="lobby"] .pk-room-rail{display:none;gap:10px;margin-top:14px}
    body[data-pikken-page="lobby"] .pk-room-rail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    body[data-pikken-page="lobby"] .pk-rail-chip{background:#fff;border:1px solid rgba(0,0,0,.10);border-radius:18px;padding:12px 14px;display:grid;gap:4px}
    body[data-pikken-page="lobby"] .pk-rail-chip .k{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a7a55;font-weight:900}
    body[data-pikken-page="lobby"] .pk-rail-chip .v{font-size:18px;font-weight:900}
    body[data-pikken-page="lobby"] .pk-summary{margin-top:12px;padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(0,0,0,.10);font-weight:700}
    body[data-pikken-page="lobby"] .pk-room-stack{display:grid;gap:10px;margin-top:12px}
    body[data-pikken-page="lobby"] .pk-room-card{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px;border-radius:18px;background:#fff;border:1px solid rgba(0,0,0,.10);width:100%;text-align:left;cursor:pointer}
    body[data-pikken-page="lobby"] .pk-room-card .meta{font-size:12px;color:#6d6256;margin-top:4px}
    body[data-pikken-page="lobby"] .pk-room-card .badge{display:inline-flex;padding:6px 10px;border-radius:999px;background:rgba(154,130,65,.12);font-weight:800;font-size:12px}
    body[data-pikken-page="lobby"] .pk-room-card .badge.live{background:rgba(138,16,34,.10);color:#8a1022}
    body[data-pikken-page="lobby"] .pk-lobby-note{font-size:12px;color:#6d6256;margin-top:6px}
    @media (max-width:900px){ body[data-pikken-page="lobby"] .pk-room-rail-grid{grid-template-columns:repeat(2,minmax(0,1fr));} }
    @media (max-width:760px){
      body[data-pikken-page="lobby"] { padding-bottom:24px !important; }
      body[data-pikken-page="lobby"] .pk-room-rail-grid{grid-template-columns:1fr 1fr}
      body[data-pikken-page="lobby"] .pk-room-card{align-items:flex-start}
    }
    @media (max-width:520px){
      body[data-pikken-page="lobby"] .pk-room-rail-grid{grid-template-columns:1fr}
    }
  `;
  document.head.appendChild(style);
}


  function patchConnectionCopy(){
    document.querySelectorAll('#pkConnectionPill').forEach((pill)=>{
      const txt = String(pill.textContent || '').toLowerCase();
      if (txt.includes('hapert')) pill.textContent = 'sync wordt bijgewerkt';
      else if (txt.includes('verbinding ok')) pill.textContent = 'live sync';
      else if (txt.includes('speler bevestigd')) pill.textContent = 'speler bevestigd';
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

  function isLiveStage(stage){
  return /bidding|voting|finished|live|started|race|countdown/i.test(String(stage || ''));
}

function ensureLobbyCollections(){
  if (path !== 'pikken.html') return {};
  return {
    liveBox: document.getElementById('pkLiveLobbiesBox'),
    openBox: document.getElementById('pkOpenLobbiesBox'),
    roomRail: document.getElementById('pkRoomRail'),
    railCode: document.getElementById('pkRailLobbyCode'),
    railStage: document.getElementById('pkRailStage'),
    railPlayers: document.getElementById('pkRailPlayers'),
    railHeadline: document.getElementById('pkRoomHeadline'),
    railVariant: document.getElementById('pkRailVariant'),
    syncNote: document.getElementById('pkLobbySyncNote')
  };
}

function renderRoomRows(root, rows, emptyText){
  if (!root) return;
  if (!rows.length){
    root.innerHTML = `<div class="player-row"><div class="muted">${emptyText}</div></div>`;
    return;
  }
  root.innerHTML = rows.map((row)=>`
    <button type="button" class="pk-room-card" data-pk-open="${row.lobby_code}" data-pk-stage="${row.stage || ''}">
      <div>
        <strong>${row.lobby_code}</strong>
        <div class="meta">${row.host_name || 'Onbekende host'} · ${row.player_count || 0} speler(s) · ${row.stage || 'lobby'}</div>
      </div>
      <div class="badge ${isLiveStage(row.stage) ? 'live' : ''}">${isLiveStage(row.stage) ? 'LIVE' : 'Join'}</div>
    </button>
  `).join('');
  root.querySelectorAll('[data-pk-open]').forEach((btn)=>btn.addEventListener('click', ()=>{
    const code = btn.getAttribute('data-pk-open') || '';
    const stage = btn.getAttribute('data-pk-stage') || '';
    const input = document.getElementById('pkJoinCode');
    if (input) input.value = code;
    if (isLiveStage(stage)) {
      location.href = liveHrefForCode(code);
      return;
    }
    const joinBtn = document.getElementById('pkJoinLobbyBtn');
    if (joinBtn && !joinBtn.disabled) joinBtn.click();
  }));
}

function syncLobbyRail(){
  if (path !== 'pikken.html') return;
  const refs = ensureLobbyCollections();
  const code = String(document.getElementById('pkLobbyCode')?.textContent || '').trim();
  const phase = String(document.getElementById('pkPhase')?.textContent || '').trim();
  const variant = String(document.getElementById('pkVariantLabel')?.textContent || '').trim();
  const playerRows = Array.from(document.querySelectorAll('#pkPlayers .player-row'));
  const readyCount = playerRows.filter((row)=>/ready/i.test(String(row.textContent || '')) && !/wacht/i.test(String(row.textContent || ''))).length;
  if (refs.syncNote) refs.syncNote.textContent = `Live sync open lobbies elke 10 seconden · lobbystatus loopt mee met de tafel.`;
  if (!refs.roomRail) return;
  if (code && code !== '—') refs.roomRail.style.display = 'grid';
  else refs.roomRail.style.display = 'none';
  if (refs.railCode) refs.railCode.textContent = code || '—';
  if (refs.railStage) refs.railStage.textContent = phase || 'lobby';
  if (refs.railPlayers) refs.railPlayers.textContent = `${playerRows.length} / ${readyCount}`;
  if (refs.railVariant) refs.railVariant.textContent = variant || 'Normal';
  if (refs.railHeadline) {
    const heading = document.getElementById('pkModeHeading')?.textContent || 'Nog geen actieve lobby.';
    const copy = document.getElementById('pkModeCopy')?.textContent || '';
    refs.railHeadline.textContent = code && code !== '—' ? `${heading} · ${copy}` : 'Nog geen actieve lobby.';
  }
}

let lobbyRefreshInFlight = false;
async function refreshOpenLobbies(){
  if (path !== 'pikken.html' || lobbyRefreshInFlight) return;
  lobbyRefreshInFlight = true;
  try {
    const rows = normalizeRows(await firstRpc([
      'get_pikken_open_lobbies_public_scoped',
      'get_pikken_open_lobbies_public',
      'list_pikken_open_lobbies_public_scoped',
      'list_pikken_open_lobbies_public'
    ], { site_scope_input: scope(), session_token: session() || null }));
    const refs = ensureLobbyCollections();
    renderRoomRows(refs.liveBox, rows.filter((row)=>isLiveStage(row.stage)), 'Nog geen live Pikken-tafels.');
    renderRoomRows(refs.openBox, rows.filter((row)=>!isLiveStage(row.stage)), 'Nog geen open Pikken-lobbies zichtbaar.');
    syncLobbyRail();
  } catch (_) {
    const refs = ensureLobbyCollections();
    renderRoomRows(refs.liveBox, [], 'Nog geen live Pikken-tafels.');
    renderRoomRows(refs.openBox, [], 'Nog geen open Pikken-lobbies zichtbaar.');
  } finally {
    lobbyRefreshInFlight = false;
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

  function installLightUiRefresh(){
    let lastKey = '';
    const pump = ()=>{
      const key = [
        document.getElementById('pkConnectionPill')?.textContent || '',
        document.getElementById('pkModePill')?.textContent || '',
        document.getElementById('pkLiveModePill')?.textContent || '',
        document.getElementById('dockCopy')?.textContent || '',
        document.getElementById('viewerMeta')?.textContent || ''
      ].join('|');
      if (key !== lastKey) {
        lastKey = key;
        patchConnectionCopy();
        softenViewerCopy();
      }
    };
    pump();
    window.setInterval(()=>{ pump(); if (path === 'pikken.html') syncLobbyRail(); }, path === 'pikken.html' ? 2500 : 1800);
    document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) pump(); });
  }

  onReady(()=>{
    injectScrollUnlock();
    patchConnectionCopy();
    softenViewerCopy();
    addClaimHintButton();
    installLightUiRefresh();
    if (path === 'pikken.html') {
      refreshOpenLobbies().catch(()=>{});
      syncLobbyRail();
      const refreshBtn = document.getElementById('pkRefreshRoomsBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', ()=>refreshOpenLobbies().catch(()=>{}));
      window.setInterval(()=>{ if (!document.hidden) refreshOpenLobbies().catch(()=>{}); }, 10000);
    }
  });
})();
