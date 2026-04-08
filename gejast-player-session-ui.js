(function(global){
  const cfg = global.GEJAST_CONFIG || {};
  const gate = global.GEJAST_PUBLIC_PAGE_GATE || {};

  function getToken(){
    return cfg.getPlayerSessionToken ? String(cfg.getPlayerSessionToken() || '') : '';
  }

  function clearTokens(){
    if (cfg.clearPlayerSessionTokens) cfg.clearPlayerSessionTokens();
  }

  function normalizeScope(input){
    return gate.normalizeScope ? gate.normalizeScope(input) : (String(input || '').toLowerCase() === 'family' ? 'family' : 'friends');
  }

  function logoutTarget(scope){
    if (gate.buildHomeUrl) return gate.buildHomeUrl('', normalizeScope(scope));
    return './home.html';
  }

  function rpcHeaders(){
    return {
      'Content-Type': 'application/json',
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`
    };
  }

  async function fetchMyName(token){
    if (!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return '';
    const payload = JSON.stringify({ session_token: token });
    for (const rpc of ['get_public_state','get_gejast_homepage_state','get_jas_app_state']) {
      try {
        const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          headers: rpcHeaders(),
          body: payload
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) continue;
        const name = data?.my_name || data?.display_name || data?.player_name || '';
        if (name) return name;
      } catch (_) {}
    }
    return '';
  }

  function ensureStyle(){
    if (global.document.getElementById('gejastPlayerSessionUiStyle')) return;
    const style = global.document.createElement('style');
    style.id = 'gejastPlayerSessionUiStyle';
    style.textContent = [
      '.player-session-corner{position:fixed;top:14px;right:14px;z-index:9999;background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.08);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.12);padding:8px 10px;min-width:112px;display:none;backdrop-filter:blur(8px)}',
      '.player-session-corner.is-visible{display:flex;flex-direction:column;align-items:flex-end;gap:8px}',
      '.player-session-corner-label{font-size:11px;line-height:1.15;color:#5f5b53;text-align:right}',
      '.player-session-corner-name{font-size:13px;line-height:1.1;font-weight:800;color:#111;text-align:right;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.player-session-corner-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
      '.player-session-corner-btn{appearance:none;border:0;border-radius:999px;background:#111;color:#fff;font:inherit;font-weight:800;font-size:11px;line-height:1;padding:8px 11px;cursor:pointer;box-shadow:none;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}',
      '.player-session-corner-btn.alt{background:#f3efe6;color:#111;border:1px solid rgba(0,0,0,.08)}',
      '@media (max-width:640px){.player-session-corner{top:10px;right:10px;padding:7px 9px;min-width:100px}.player-session-corner-name{max-width:120px}}'
    ].join('');
    global.document.head.appendChild(style);
  }

  function mount(options){
    const opts = Object.assign({ profileHref: './my_profile.html' }, options || {});
    ensureStyle();
    let box = global.document.getElementById('playerSessionCorner');
    if (!box) {
      box = global.document.createElement('div');
      box.id = 'playerSessionCorner';
      box.className = 'player-session-corner';
      box.setAttribute('aria-live', 'polite');
      box.innerHTML = [
        '<div class="player-session-corner-label">Ingelogd als</div>',
        '<div id="playerSessionCornerName" class="player-session-corner-name"></div>',
        '<div class="player-session-corner-actions">',
        `<a id="playerSessionCornerProfile" href="${opts.profileHref}" class="player-session-corner-btn alt">Mijn profiel</a>`,
        '<button id="playerSessionCornerLogout" type="button" class="player-session-corner-btn">Uitloggen</button>',
        '</div>'
      ].join('');
      global.document.body.appendChild(box);
    } else {
      const profile = box.querySelector('#playerSessionCornerProfile');
      if (profile && opts.profileHref) profile.href = opts.profileHref;
      const logout = box.querySelector('#playerSessionCornerLogout');
      if (logout) logout.textContent = 'Uitloggen';
    }
    return box;
  }

  function hide(){
    const box = global.document.getElementById('playerSessionCorner');
    const nameEl = global.document.getElementById('playerSessionCornerName');
    if (nameEl) nameEl.textContent = '';
    if (box) box.classList.remove('is-visible');
  }

  async function init(options){
    const opts = Object.assign({ profileHref: './my_profile.html', scope: '' }, options || {});
    const box = mount(opts);
    const nameEl = box.querySelector('#playerSessionCornerName');
    const logoutBtn = box.querySelector('#playerSessionCornerLogout');
    if (logoutBtn && !logoutBtn.dataset.bound) {
      logoutBtn.dataset.bound = '1';
      logoutBtn.addEventListener('click', function(){
        clearTokens();
        hide();
        global.location.href = logoutTarget(opts.scope);
      });
    }

    let token = getToken();
    if (cfg.isPlayerSessionExpired && cfg.isPlayerSessionExpired()) {
      clearTokens();
      token = '';
    }
    if (!token) {
      hide();
      return false;
    }
    const name = await fetchMyName(token);
    if (!name) {
      hide();
      return false;
    }
    nameEl.textContent = name;
    box.classList.add('is-visible');
    return true;
  }

  async function refresh(options){
    return init(options);
  }

  global.GEJAST_PLAYER_SESSION_UI = {
    init,
    refresh,
    hide,
    mount,
    fetchMyName
  };
})(window);
