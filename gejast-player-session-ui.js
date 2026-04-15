
(function(){
  const CONFIG = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = CONFIG.SUPABASE_URL || '';
  const SUPABASE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || '';
  const SESSION_KEYS = Array.isArray(CONFIG.PLAYER_SESSION_KEYS) && CONFIG.PLAYER_SESSION_KEYS.length ? CONFIG.PLAYER_SESSION_KEYS : ['jas_session_token_v11','jas_session_token_v10'];

  function getToken(){
    if (CONFIG.getPlayerSessionToken) return String(CONFIG.getPlayerSessionToken() || '').trim();
    for (const key of SESSION_KEYS){
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return String(value).trim();
    }
    return '';
  }
  function clearTokens(){
    if (CONFIG.clearPlayerSessionTokens) return CONFIG.clearPlayerSessionTokens();
    for (const key of SESSION_KEYS){ localStorage.removeItem(key); sessionStorage.removeItem(key); }
  }
  function rpcHeaders(){ return { 'Content-Type':'application/json', apikey: SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}` }; }
  async function parseJson(res){ const txt = await res.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); } if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`); return data; }
  function inferScope(){
    try {
      const qs = new URLSearchParams(location.search || '');
      return String(qs.get('scope') || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
    } catch (_) { return 'friends'; }
  }

  function normalizeName(value){ return String(value || '').replace(/\s+/g, ' ').trim(); }
  function uniqueNames(values){ const seen = new Set(); return (Array.isArray(values)?values:[]).map(normalizeName).filter((name)=>{ const key=name.toLowerCase(); if(!name||seen.has(key)) return false; seen.add(key); return true; }); }
  async function fetchAllowedNames(scope){
    const helper = CONFIG && typeof CONFIG.fetchScopedActivePlayerNames === 'function' ? CONFIG.fetchScopedActivePlayerNames : null;
    if (helper) {
      try { const names = await helper(scope); if (names.length) return names; } catch (_) {}
    }
    let raw = null;
    try {
      const scoped = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_login_names_scoped`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({ site_scope_input: scope }) });
      raw = await parseJson(scoped);
    } catch (_) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_login_names`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({}) });
        raw = await parseJson(res);
      } catch (_2) { raw = { names: [] }; }
    }
    const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.names) ? raw.names : (Array.isArray(raw?.data) ? raw.data : []));
    let names = uniqueNames(rows.map((row)=> typeof row === 'string' ? row : (row?.display_name || row?.name || row?.desired_name || row?.slug || row?.player_name || '')));
    if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.filterNames === 'function') names = window.GEJAST_SCOPE_UTILS.filterNames(names, scope);
    return names;
  }
  async function fetchViewer(token){
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null;
    const payloads = [
      ['get_public_state', { session_token: token }],
      ['get_gejast_homepage_state', { session_token: token }],
      ['get_jas_app_state', { session_token: token }],
      ['get_public_state', { session_token_input: token }],
      ['get_gejast_homepage_state', { session_token_input: token }],
      ['get_jas_app_state', { session_token_input: token }]
    ];
    for (const [rpc, body] of payloads){
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify(body) });
        const data = await parseJson(res);
        const name = data?.my_name || data?.display_name || data?.player_name || data?.viewer?.display_name || '';
        if (name) {
          return {
            name,
            avatar: data?.my_avatar_url || data?.avatar_url || data?.viewer?.avatar_url || '',
            coins: Number(data?.caute_coins ?? data?.coin_balance ?? data?.viewer?.caute_coins ?? data?.viewer?.coin_balance ?? 0) || 0,
            profileHref: './my_profile.html'
          };
        }
      } catch (_) {}
    }
    return null;
  }

  async function fetchCoins(token){
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return 0;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_caute_coins_public`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({ session_token: token, session_token_input: token }) });
      const data = await parseJson(res);
      return Number(data?.balance ?? data?.caute_coins ?? data?.viewer_balance ?? 0) || 0;
    } catch (_) { return 0; }
  }

  function ensureStyles(){
    if (document.getElementById('gejast-player-session-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'gejast-player-session-ui-style';
    style.textContent = `
      .gejast-session-ui{position:fixed;top:14px;right:14px;z-index:10002;display:none;align-items:flex-start;gap:10px;pointer-events:none}
      .gejast-session-ui.is-visible{display:flex}
      .gejast-session-toggle,.gejast-session-panel{pointer-events:auto}
      .gejast-session-toggle{appearance:none;border:1px solid rgba(17,17,17,.08);background:rgba(255,251,245,.96);box-shadow:0 16px 34px rgba(0,0,0,.14);border-radius:999px;min-height:54px;padding:10px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;color:#16120d;backdrop-filter:blur(12px)}
      .gejast-session-toggle:hover{transform:translateY(-1px)}
      .gejast-session-avatar{width:34px;height:34px;border-radius:50%;background:#111;color:#fff;display:grid;place-items:center;font-size:15px;font-weight:900;overflow:hidden;flex:0 0 auto}
      .gejast-session-avatar img{width:100%;height:100%;object-fit:cover;display:block}
      .gejast-session-toggle-copy{display:grid;gap:2px;text-align:left}
      .gejast-session-kicker{font-size:11px;line-height:1;color:#6a6255;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
      .gejast-session-name{font-size:15px;line-height:1.1;font-weight:900;max-width:min(26vw,220px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gejast-session-panel{width:min(320px,calc(100vw - 28px));border:1px solid rgba(17,17,17,.08);background:rgba(255,251,245,.985);box-shadow:0 18px 44px rgba(0,0,0,.16);border-radius:24px;padding:16px;display:none;grid-template-columns:1fr;gap:12px;backdrop-filter:blur(16px)}
      .gejast-session-ui.is-open .gejast-session-panel{display:grid}
      .gejast-session-head{display:flex;align-items:center;gap:12px}
      .gejast-session-meta{min-width:0;display:grid;gap:4px}
      .gejast-session-label{font-size:12px;line-height:1.2;color:#6a6255;font-weight:700}
      .gejast-session-fullname{font-size:22px;line-height:1.05;font-weight:900;letter-spacing:-.04em;color:#13100c;word-break:break-word}
      .gejast-session-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .gejast-session-btn{appearance:none;border:0;border-radius:999px;background:#111;color:#fff;font:inherit;font-weight:800;font-size:14px;line-height:1;padding:14px 16px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;min-height:48px}
      .gejast-session-btn.alt{background:#f3eee3;color:#14110d;border:1px solid rgba(17,17,17,.08)}
      .gejast-session-btn:hover{opacity:.94}
      .gejast-session-close{appearance:none;border:0;background:transparent;color:#6a6255;font:inherit;font-size:12px;font-weight:700;justify-self:end;cursor:pointer;padding:0}
      @media (max-width:760px){
        .gejast-session-ui{top:12px;right:12px;left:auto;flex-direction:column;align-items:flex-end}
        .gejast-session-toggle{min-height:50px;padding:9px 12px;max-width:min(82vw,320px)}
        .gejast-session-name{max-width:44vw}
        .gejast-session-panel{width:min(86vw,360px);padding:14px;border-radius:22px}
        .gejast-session-head .gejast-session-avatar{width:42px;height:42px}
        .gejast-session-fullname{font-size:18px}
        .gejast-session-actions{grid-template-columns:1fr 1fr}
      }
    `;
    document.head.appendChild(style);
  }
  function buildAvatar(name, avatar){
    const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
    if (avatar) return `<span class="gejast-session-avatar"><img src="${String(avatar).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}" alt="${initial}"></span>`;
    return `<span class="gejast-session-avatar">${initial}</span>`;
  }
  function mount(){
    ensureStyles();
    let shell = document.getElementById('gejastPlayerSessionUI');
    if (shell) return shell;
    const old = document.getElementById('playerSessionCorner');
    if (old) old.remove();
    shell = document.createElement('div');
    shell.id = 'gejastPlayerSessionUI';
    shell.className = 'gejast-session-ui';
    shell.innerHTML = `
      <button type="button" class="gejast-session-toggle" id="gejastSessionToggle" aria-expanded="false" aria-controls="gejastSessionPanel">
        <span id="gejastSessionToggleAvatar"></span>
        <span class="gejast-session-toggle-copy">
          <span class="gejast-session-kicker">Ingelogd als</span>
          <span class="gejast-session-name" id="gejastSessionToggleName"></span>
        </span>
      </button>
      <aside class="gejast-session-panel" id="gejastSessionPanel" aria-hidden="true">
        <button type="button" class="gejast-session-close" id="gejastSessionClose">sluiten</button>
        <div class="gejast-session-head">
          <span id="gejastSessionPanelAvatar"></span>
          <div class="gejast-session-meta">
            <div class="gejast-session-label">Jouw spelersessie</div>
            <div class="gejast-session-fullname" id="gejastSessionPanelName"></div>
            <div class="gejast-session-label" id="gejastSessionCoins"></div>
          </div>
        </div>
        <div class="gejast-session-actions">
          <a href="./my_profile.html" class="gejast-session-btn alt" id="gejastSessionProfileBtn">Mijn profiel</a>
          <button type="button" class="gejast-session-btn" id="gejastSessionLogoutBtn">Log out</button>
        </div>
      </aside>`;
    document.body.appendChild(shell);
    return shell;
  }
  function hide(shell){
    shell.classList.remove('is-visible','is-open');
    const toggle = shell.querySelector('#gejastSessionToggle');
    const panel = shell.querySelector('#gejastSessionPanel');
    if (toggle) toggle.setAttribute('aria-expanded','false');
    if (panel) panel.setAttribute('aria-hidden','true');
  }
  function apply(shell, viewer){
    shell.querySelector('#gejastSessionToggleName').textContent = viewer.name || 'Speler';
    shell.querySelector('#gejastSessionPanelName').textContent = viewer.name || 'Speler';
    const coinsNode = shell.querySelector('#gejastSessionCoins');
    if (coinsNode) { const coinText=(CONFIG.formatCauteCoins ? CONFIG.formatCauteCoins(viewer.coins || 0) : `₵ ${Math.round(Number(viewer.coins||0)||0)} caute coins`); coinsNode.textContent = coinText; coinsNode.title = coinText; }
    shell.querySelector('#gejastSessionToggleAvatar').innerHTML = buildAvatar(viewer.name, viewer.avatar);
    shell.querySelector('#gejastSessionPanelAvatar').innerHTML = buildAvatar(viewer.name, viewer.avatar);
    shell.classList.add('is-visible');
  }
  function setOpen(shell, open){
    shell.classList.toggle('is-open', !!open);
    const toggle = shell.querySelector('#gejastSessionToggle');
    const panel = shell.querySelector('#gejastSessionPanel');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (panel) panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  async function init(){
    const shell = mount();
    const token = getToken();
    if (!token) return hide(shell);
    const viewer = await fetchViewer(token);
    if (!viewer || !viewer.name) return hide(shell);
    if (!Number.isFinite(Number(viewer.coins))) viewer.coins = await fetchCoins(token);
    try {
      const allowed = await fetchAllowedNames(inferScope());
      if (allowed.length && !allowed.includes(normalizeName(viewer.name))) {
        clearTokens();
        hide(shell);
        const target = CONFIG.buildHomeUrl ? CONFIG.buildHomeUrl(CONFIG.currentReturnTarget ? CONFIG.currentReturnTarget('index.html') : 'index.html', inferScope()) : './home.html';
        window.location.href = target;
        return;
      }
    } catch (_) {}
    apply(shell, viewer);
    const toggle = shell.querySelector('#gejastSessionToggle');
    const close = shell.querySelector('#gejastSessionClose');
    const logout = shell.querySelector('#gejastSessionLogoutBtn');
    const profile = shell.querySelector('#gejastSessionProfileBtn');
    profile.href = viewer.profileHref || './my_profile.html';
    toggle.addEventListener('click', ()=> setOpen(shell, !shell.classList.contains('is-open')));
    close.addEventListener('click', ()=> setOpen(shell, false));
    logout.addEventListener('click', ()=>{
      clearTokens();
      hide(shell);
      const target = CONFIG.buildHomeUrl ? CONFIG.buildHomeUrl(CONFIG.currentReturnTarget ? CONFIG.currentReturnTarget('index.html') : 'index.html', inferScope()) : './home.html';
      window.location.href = target;
    });
    document.addEventListener('keydown', (ev)=>{ if (ev.key === 'Escape') setOpen(shell, false); });
    document.addEventListener('click', (ev)=>{ if (!shell.contains(ev.target)) setOpen(shell, false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
