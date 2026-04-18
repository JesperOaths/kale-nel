(function(){
  const path = (location.pathname || '').toLowerCase().split('/').pop();
  if (!['pikken.html','pikken_live.html','pikken_stats.html'].includes(path)) return;
  window.GEJAST_HIDE_WATERMARK = true;

  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const CANONICAL_PARTICIPANT_KEY = 'gejast_pikken_identity_v574';
  const CANONICAL_VIEWER_KEY = 'gejast_pikken_viewer_v574';
  const CANONICAL_LEAVE_KEY = 'gejast_pikken_leave_v574';

  function currentScope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch(_) { return 'friends'; }
  }
  function scopedHref(path){
    try{
      const url = new URL(path, window.location.href);
      if (currentScope() === 'family') url.searchParams.set('scope', 'family');
      return `${url.pathname.split('/').pop()}${url.search}`;
    }catch(_){ return path; }
  }
  function playerToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  function headers(){ return { 'Content-Type':'application/json', apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }; }
  async function parse(res){ const txt = await res.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch(_) { throw new Error(txt || `HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message || data?.error || txt || `HTTP ${res.status}`); return data; }
  async function rpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers: headers(), body: JSON.stringify(payload || {}) });
    const data = await parse(res);
    return data && data[name] !== undefined ? data[name] : data;
  }
  async function rpcMaybe(name, payload){
    try { return await rpc(name, payload); } catch(err){ return { __error: String(err?.message || err || '') }; }
  }
  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function norm(v){ return String(v || '').replace(/\s+/g,' ').trim(); }
  function lower(v){ return norm(v).toLowerCase(); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  async function resolveViewerName(){
    const fromHint = readJson(CANONICAL_VIEWER_KEY);
    if (fromHint?.name) return fromHint.name;
    const token = playerToken();
    if (!token) return '';
    const attempts = [
      ['get_public_state',{ session_token: token }],
      ['get_gejast_homepage_state',{ session_token: token }],
      ['get_jas_app_state',{ session_token: token }],
      ['get_public_state',{ session_token_input: token }],
      ['get_gejast_homepage_state',{ session_token_input: token }],
      ['get_jas_app_state',{ session_token_input: token }]
    ];
    for (const [name,payload] of attempts){
      const out = await rpcMaybe(name, payload);
      if (out && !out.__error){
        const resolved = norm(out.my_name || out.display_name || out.player_name || out.viewer?.display_name || '');
        if (resolved) return resolved;
      }
    }
    return '';
  }

  function readJson(key){
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch(_) { return null; }
  }
  function writeJson(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(_) {}
  }

  async function hardenIdentity(){
    const token = playerToken();
    if (!token) return;
    const params = new URLSearchParams(location.search);
    const lobbyCode = norm(params.get('lobby_code') || params.get('match_ref') || readJson(CANONICAL_PARTICIPANT_KEY)?.lobby_code || '');
    const gameId = norm(params.get('game_id') || params.get('client_match_id') || readJson(CANONICAL_PARTICIPANT_KEY)?.game_id || '');
    if (!lobbyCode && !gameId) return;
    const tries = [
      { session_token: token, game_id_input: gameId || null, lobby_code_input: lobbyCode || null, site_scope_input: currentScope() },
      { session_token_input: token, game_id_input: gameId || null, lobby_code_input: lobbyCode || null, site_scope_input: currentScope() },
      { session_token: token, lobby_code_input: lobbyCode || null, site_scope_input: currentScope() },
      { session_token_input: token, lobby_code_input: lobbyCode || null, site_scope_input: currentScope() }
    ];
    for (const payload of tries){
      const out = await rpcMaybe('pikken_get_state_scoped', payload);
      if (out && !out.__error){
        const viewer = out.viewer || {};
        const players = Array.isArray(out.players) ? out.players : [];
        let seat = Number(viewer.seat || 0) || null;
        let name = norm(viewer.name || '');
        if (!seat){
          const resolvedViewerName = await resolveViewerName();
          const match = players.find((row)=>lower(row?.name) === lower(resolvedViewerName));
          if (match){
            seat = Number(match.seat || 0) || null;
            name = norm(match.name || resolvedViewerName);
          }
        }
        if (seat && name){
          writeJson(CANONICAL_PARTICIPANT_KEY, { game_id: norm(out.game?.id || gameId), lobby_code: norm(out.game?.lobby_code || lobbyCode).toUpperCase(), scope: currentScope(), seat, name, at: Date.now() });
          writeJson(CANONICAL_VIEWER_KEY, { game_id: norm(out.game?.id || gameId), lobby_code: norm(out.game?.lobby_code || lobbyCode).toUpperCase(), seat, name, is_host: !!viewer.is_host, at: Date.now() });
          try { localStorage.removeItem(CANONICAL_LEAVE_KEY); } catch(_) {}
          return;
        }
      }
    }
  }

  function injectCss(){
    const style = document.createElement('style');
    style.textContent = `
      .site-credit-watermark,[data-version-watermark]{display:none !important}
      @media (max-width:760px){
        body[data-pikken-page="lobby"] .brand .muted,
        body[data-pikken-page="live"] .mode-banner .muted:first-child,
        body[data-pikken-page="live"] #viewerMeta,
        body[data-pikken-page="lobby"] #pkIdentityCopy{display:none !important}
        body[data-pikken-page="lobby"] .brand h1,
        body[data-pikken-page="live"] h1{font-size:1.6rem !important}
        body[data-pikken-page="lobby"] .shell{padding-top:12px !important}
      }
      .pk-identity-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:10px 0 4px}
      .pk-identity-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#fff;border:1px solid rgba(0,0,0,.1);font-weight:800;font-size:13px}
      .pk-active-lobbies{margin-top:14px;padding:14px;border-radius:18px;background:#fff;border:1px solid rgba(0,0,0,.08);display:grid;gap:10px}
      .pk-active-lobbies-list{display:grid;gap:10px}
      .pk-room-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:12px;border-radius:16px;background:#fbfaf6;border:1px solid rgba(0,0,0,.08)}
      .pk-room-row-main{display:grid;gap:4px}
      .pk-room-code{font-size:1.1rem;font-weight:900;letter-spacing:.08em}
      .pk-room-meta{font-size:13px;color:#6d6256;line-height:1.4}
      .pk-room-actions{display:flex;gap:8px;flex-wrap:wrap}
      .pk-mini-btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:#111;color:#fff;font-weight:800;cursor:pointer;text-decoration:none}
      .pk-mini-btn.alt{background:#fff;color:#111}
    `;
    document.head.appendChild(style);
  }

  function normalizeConnectionChrome(){
    qsa('#pkConnectionPill,#pkModePill,#pkLiveModePill,#phasePill').forEach((el)=>{
      const txt = lower(el.textContent);
      if (txt.includes('hapert')){
        el.textContent = 'sync';
        el.className = (el.className || '').replace(/\bbad\b/g,'').trim() + ' wait';
      }
      if (txt === 'viewer mode') el.textContent = 'kijker';
      if (txt === 'player mode') el.textContent = 'speler';
      if (txt === 'host mode') el.textContent = 'host';
    });
    qsa('#pkStatus,#statusText').forEach((el)=>{
      if (/hapert/i.test(el.textContent || '')){
        el.textContent = 'Even verversen…';
        el.classList.remove('error');
        el.classList.add('muted');
      }
    });
    const heading = qs('#pkModeHeading');
    if (heading && /klaar om een tafel/i.test(heading.textContent || '')) heading.textContent = 'Maak of join direct een tafel';
    const copy = qs('#pkModeCopy');
    if (copy && /zonder bewezen identiteit/i.test(copy.textContent || '')) copy.textContent = 'Gebruik de lijst hieronder om een actieve lobby meteen te openen of te joinen.';
  }

  function mountIdentity(viewerName){
    const host = qs('.top > div:first-child') || qs('.top-strip > div:first-child');
    if (!host || qs('.pk-identity-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'pk-identity-bar';
    const token = playerToken();
    bar.innerHTML = `
      <span class="pk-identity-chip">${token ? 'Ingelogd' : 'Niet ingelogd'}${viewerName ? ` · ${esc(viewerName)}` : ''}</span>
      ${token ? '' : `<a class="pk-mini-btn alt" href="${esc(cfg.buildLoginUrl ? cfg.buildLoginUrl(path) : './login.html')}">Log in</a>`}`;
    host.appendChild(bar);
  }

  function ensureOpenLobbyBox(){
    if (path !== 'pikken.html') return null;
    const panel = qs('.panel');
    if (!panel) return null;
    let box = qs('#pkActiveLobbiesBox');
    if (!box){
      box = document.createElement('section');
      box.id = 'pkActiveLobbiesBox';
      box.className = 'pk-active-lobbies';
      box.innerHTML = '<strong>Actieve Pikken-lobbies</strong><div class="small" id="pkActiveLobbiesCopy">Laden…</div><div id="pkActiveLobbiesList" class="pk-active-lobbies-list"></div>';
      panel.insertAdjacentElement('afterbegin', box);
    }
    return box;
  }

  async function loadOpenLobbies(){
    const box = ensureOpenLobbyBox();
    if (!box) return;
    const copy = qs('#pkActiveLobbiesCopy');
    const list = qs('#pkActiveLobbiesList');
    const out = await rpcMaybe('pikken_get_open_lobbies_scoped', { site_scope_input: currentScope() });
    if (out.__error){
      if (copy) copy.textContent = /does not exist|schema cache|function/i.test(out.__error)
        ? 'Backend open-lobby index ontbreekt nog. Draai eerst de v578 SQL.'
        : 'Open lobbies konden nu niet geladen worden.';
      if (list) list.innerHTML = '';
      return;
    }
    const rows = Array.isArray(out?.rows) ? out.rows : (Array.isArray(out) ? out : []);
    if (!rows.length){
      if (copy) copy.textContent = 'Er staan nu geen open of joinbare Pikken-lobbies klaar.';
      if (list) list.innerHTML = '';
      return;
    }
    if (copy) copy.textContent = 'Join direct een open lobby of open een live tafel om te kijken.';
    if (list) list.innerHTML = rows.map((row)=>{
      const code = esc(row.lobby_code || row.room_code || '');
      const liveHref = scopedHref(`./pikken_live.html?match_ref=${encodeURIComponent(row.lobby_code || '')}`);
      return `<div class="pk-room-row">
        <div class="pk-room-row-main">
          <div class="pk-room-code">${code}</div>
          <div class="pk-room-meta">${esc(row.stage_label || row.stage || 'lobby')} · host ${esc(row.host_name || '—')} · ${Number(row.player_count || 0)} spelers · ${Number(row.ready_count || 0)} ready</div>
        </div>
        <div class="pk-room-actions">
          <button class="pk-mini-btn" type="button" data-pk-join="${code}">Join</button>
          <a class="pk-mini-btn alt" href="${liveHref}">Kijk live</a>
        </div>
      </div>`;
    }).join('');
    qsa('[data-pk-join]').forEach((btn)=>{
      btn.onclick = ()=>{
        const input = qs('#pkJoinCode');
        if (input) input.value = btn.getAttribute('data-pk-join') || '';
        const join = qs('#pkJoinLobbyBtn');
        if (join) join.click();
      };
    });
  }

  function bootStatsPage(){
    if (path !== 'pikken_stats.html') return;
    const style = document.createElement('style');
    style.textContent = '@media (max-width:760px){.subtitle,.eyebrow{display:none !important}} .site-credit-watermark,[data-version-watermark]{display:none !important}';
    document.head.appendChild(style);
  }

  async function boot(){
    injectCss();
    bootStatsPage();
    const viewerName = await resolveViewerName();
    mountIdentity(viewerName);
    await hardenIdentity();
    normalizeConnectionChrome();
    if (path === 'pikken.html'){
      await loadOpenLobbies();
      setInterval(()=>{ loadOpenLobbies().catch(()=>{}); normalizeConnectionChrome(); }, 4000);
    } else {
      setInterval(normalizeConnectionChrome, 1200);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ()=>boot().catch(()=>{}), { once:true });
  else boot().catch(()=>{});
})();