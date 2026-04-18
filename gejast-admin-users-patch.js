(function(){
  const isAdminPage = /(?:^|\/)admin/i.test(String(location && location.pathname || ''));
  if (!isAdminPage) return;

  function pageName() {
    try { return (location.pathname || '').split('/').pop() || ''; } catch (_) { return ''; }
  }
  function isClaimsPage() {
    return /admin_claims\.html/i.test(pageName());
  }

  function cleanName(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(onbekend|unknown|n\/a|null|undefined|geen|gebruiker\s*#\d+)$/i.test(text)) return '';
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return '';
    return text;
  }

  function collectNameCandidates(value, out, depth){
    if (!value || depth > 2) return;
    if (typeof value === 'string') {
      const clean = cleanName(value);
      if (clean) out.push(clean);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collectNameCandidates(entry, out, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, entry]) => {
        if (!/name|username|display|chosen|desired|public|reserved|player|canonical|full|label/i.test(String(key))) return;
        collectNameCandidates(entry, out, depth + 1);
      });
    }
  }

  function improvedDisplayName(req) {
    const row = req || {};
    const candidates = [];
    const relatedRows = []
      .concat(Array.isArray(window.lastRequests) ? window.lastRequests : [])
      .concat(Array.isArray(window.lastHistory) ? window.lastHistory : [])
      .filter((peer) => {
        if (!peer || typeof peer !== 'object' || peer === row) return false;
        const samePlayer = playerIdOf(row) && String(playerIdOf(peer) || '') === String(playerIdOf(row) || '');
        const sameEmail = emailOf(row) && emailOf(peer) === emailOf(row);
        const sameRequest = requestIdOfItem(row) && String(requestIdOfItem(peer) || '') === String(requestIdOfItem(row) || '');
        return samePlayer || sameEmail || sameRequest;
      });
    [
      row.display_name,
      row.requested_name,
      row.public_display_name,
      row.chosen_username,
      row.desired_name,
      row.player_name,
      row.reserved_display_name,
      row.reserved_name,
      row.requester_name,
      row.canonical_name,
      row.full_name,
      row.allowed_username_display_name,
      row.granted_display_name,
      row.name,
      row.requester_meta,
      row.player,
      row.viewer,
      row.payload
    ].forEach((value) => collectNameCandidates(value, candidates, 0));
    relatedRows.forEach((peer) => {
      [
        peer.display_name,
        peer.requested_name,
        peer.public_display_name,
        peer.chosen_username,
        peer.desired_name,
        peer.player_name,
        peer.reserved_display_name,
        peer.reserved_name,
        peer.requester_name,
        peer.canonical_name,
        peer.full_name,
        peer.allowed_username_display_name,
        peer.granted_display_name,
        peer.name,
        peer.requester_meta,
        peer.player,
        peer.viewer,
        peer.payload
      ].forEach((value) => collectNameCandidates(value, candidates, 0));
    });
    const seen = new Set();
    for (const candidate of candidates) {
      const clean = cleanName(candidate);
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      return clean;
    }
    return 'Onbekende naam';
  }

  function stateBucketSafe(item) {
    try {
      if (typeof stateBucket === 'function') return stateBucket(item);
    } catch (_) {}
    return String(item?.state_bucket || item?.status || item?.request_status || '').toLowerCase() || 'pending';
  }

  function truthyAny(item, keys) {
    return keys.some((key) => {
      const value = item?.[key];
      return value !== undefined && value !== null && value !== '' && value !== false && value !== 'false';
    });
  }
  function dateAny(item, keys) {
    for (const key of keys) {
      const value = item?.[key];
      if (value) return value;
    }
    return '';
  }
  function activationUsed(item) {
    return truthyAny(item, ['link_used_at','activation_used_at','player_activation_used_at','used_at']) || Boolean(dateAny(item, ['link_used_at','activation_used_at','player_activation_used_at','used_at']));
  }
  function pinSet(item) {
    return truthyAny(item, ['has_pin','pin_is_set','player_has_pin','pin_set','pin_hash_set','pin_hash_present','has_pin_hash','player_pin_hash_set','pin_hash','player_pin_hash']);
  }
  function activatedAt(item) {
    return dateAny(item, ['activated_at','activated_on','activation_used_at','player_activation_used_at','link_used_at','used_at']);
  }
  function expiresAt(item) {
    return dateAny(item, ['expires_at','activation_expires_at','link_expires_at','player_activation_expires_at','expired_at']);
  }
  function requestIdOfItem(item) {
    return item?.request_id ?? item?.claim_request_id ?? item?.id ?? '';
  }
  function emailOf(item) {
    return String(item?.requester_email || item?.recipient_email || item?.email || '').trim().toLowerCase();
  }
  function playerIdOf(item) {
    return item?.player_id ?? item?.related_player_id ?? '';
  }

  function metaBoxSafe(label, value) {
    if (typeof metaBox === 'function') return metaBox(label, value);
    return `<div class="data-box"><span class="label">${String(label)}</span>${String(value)}</div>`;
  }
  function formatDateSafe(value) {
    if (!value) return 'Onbekend';
    try {
      if (typeof formatDateTime === 'function') return formatDateTime(value);
    } catch (_) {}
    return String(value);
  }
  function escapeHtmlSafe(value) {
    const text = String(value ?? '');
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function currentScope() {
    try {
      if (window.GEJAST_ADMIN_RPC && typeof window.GEJAST_ADMIN_RPC.getScope === 'function') return window.GEJAST_ADMIN_RPC.getScope();
      if (window.GEJAST_SCOPE_CONTEXT && typeof window.GEJAST_SCOPE_CONTEXT.getScope === 'function') return window.GEJAST_SCOPE_CONTEXT.getScope();
      return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends';
    } catch (_) { return 'friends'; }
  }
  function scopeHref(scope) {
    const url = new URL(location.href);
    if (String(scope) === 'family') url.searchParams.set('scope', 'family');
    else url.searchParams.delete('scope');
    return url.pathname.split('/').pop() + url.search + url.hash;
  }

  function injectAdminScopeSwitcher() {
    const topbar = document.querySelector('.topbar') || document.querySelector('.top') || document.querySelector('.main-card');
    if (!topbar || document.getElementById('adminScopeSwitcher')) return;
    const scope = currentScope();
    const wrap = document.createElement('div');
    wrap.id = 'adminScopeSwitcher';
    wrap.className = 'admin-scope-switcher';
    wrap.innerHTML = `
      <div class="scope-chip-label">Beheermodus</div>
      <div class="scope-chip-row">
        <a class="scope-chip ${scope !== 'family' ? 'active' : ''}" href="${scopeHref('friends')}">Vrienden</a>
        <a class="scope-chip ${scope === 'family' ? 'active' : ''}" href="${scopeHref('family')}">Familie</a>
      </div>
    `;
    topbar.appendChild(wrap);
  }

  function patchNonBlockingAutomaticMakeWake() {
    if (!isClaimsPage()) return;
    try {
      if (typeof window.triggerMakeScenario !== 'function' || window.triggerMakeScenario.__nonBlockingWrapped) return;
      const original = window.triggerMakeScenario;
      window.triggerMakeScenario = async function(meta = {}) {
        try {
          return await original(meta);
        } catch (error) {
          const reason = String(meta?.reason || '').trim().toLowerCase();
          const source = String(meta?.source || '').trim().toLowerCase();
          const isManual = reason === 'manual_admin_kick' || /manual_admin_kick/.test(source);
          if (isManual) throw error;
          console.warn('Niet-blokkerende Make wake-fout onderdrukt', error);
          return {
            ok: false,
            via: 'non-blocking-browser-wake-fallback',
            warning: String(error?.message || error || 'Failed to fetch')
          };
        }
      };
      window.triggerMakeScenario.__nonBlockingWrapped = true;
    } catch (_) {}
  }

  function patchInlineFailedToFetchCopy() {
    if (!isClaimsPage()) return;
    const rewrite = () => {
      try {
        document.querySelectorAll('.inline-msg').forEach((node) => {
          const text = String(node.textContent || '').trim();
          if (text === 'Failed to fetch') {
            node.textContent = 'Automatische Make-wake vanuit de browser kon niet worden bevestigd. De admin-actie zelf is wel doorgezet.';
            if (!/error|warn/i.test(String(node.className || ''))) node.classList.add('ok');
          }
        });
      } catch (_) {}
    };
    rewrite();
    if (window.__GEJAST_FAILED_FETCH_COPY_PATCHED) return;
    window.__GEJAST_FAILED_FETCH_COPY_PATCHED = true;
    const observer = new MutationObserver(() => rewrite());
    const start = () => {
      try { observer.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    window.setTimeout(() => { try { observer.disconnect(); } catch (_) {} }, 120000);
  }

  function injectStyles() {
    if (document.getElementById('gejast-admin-users-enhance-style')) return;
    const style = document.createElement('style');
    style.id = 'gejast-admin-users-enhance-style';
    style.textContent = `
      #statsGrid, #adminTabs, .stats {
        display: grid !important;
        grid-auto-flow: column;
        grid-auto-columns: minmax(155px, 1fr);
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 4px;
        scrollbar-width: thin;
      }
      #statsGrid::-webkit-scrollbar, #adminTabs::-webkit-scrollbar, .stats::-webkit-scrollbar { height: 8px; }
      #statsGrid::-webkit-scrollbar-thumb, #adminTabs::-webkit-scrollbar-thumb, .stats::-webkit-scrollbar-thumb { background: rgba(0,0,0,.14); border-radius: 999px; }
      #statsGrid .stat-card, #adminTabs .tab-btn, .stats .stat {
        min-width: 155px;
      }
      #adminTabs .tab-btn {
        min-height: 64px;
        border-radius: 18px;
        justify-content: space-between;
        padding: 12px 14px;
      }
      #statsGrid .stat-card .value, .stats .stat strong { font-size: 26px; }
      .admin-scope-switcher {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
      }
      .scope-chip-label {
        font-size: 12px;
        color: #777;
        font-weight: 700;
      }
      .scope-chip-row {
        display: flex;
        gap: 8px;
        flex-wrap: nowrap;
      }
      .scope-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 104px;
        padding: 10px 14px;
        border-radius: 999px;
        text-decoration: none;
        color: #111;
        background: #fff;
        border: 1px solid rgba(0,0,0,.08);
        font-weight: 800;
        box-shadow: 0 8px 18px rgba(0,0,0,.04);
      }
      .scope-chip.active {
        background: #111;
        color: #fff;
        border-color: #111;
      }
      .users-extra-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0,1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .users-extra-note {
        margin-top: 12px;
        background: #f6f3eb;
        border: 1px solid rgba(0,0,0,.06);
        border-radius: 14px;
        padding: 12px 14px;
        color: #4d463c;
        font-size: 14px;
      }
      @media (max-width: 900px) {
        .users-extra-grid { grid-template-columns: 1fr; }
        .admin-scope-switcher { width: 100%; align-items: flex-start; }
      }
    `;
    document.head.appendChild(style);
  }

  function patchNameResolvers() {
    try {
      if (typeof displayNameOf === 'function') {
        displayNameOf = function(req) { return improvedDisplayName(req); };
      }
    } catch (_) {}
    try {
      if (typeof normalizeAdminRow === 'function') {
        const oldNormalize = normalizeAdminRow;
        normalizeAdminRow = function(input) {
          const row = oldNormalize(input);
          if (row && typeof row === 'object') row.display_name = improvedDisplayName(row);
          return row;
        };
      }
    } catch (_) {}
  }

  function ensureUsersCard() {
    const workspace = document.getElementById('workspace');
    if (!workspace) return null;
    let card = document.getElementById('usersCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'usersCard';
      card.className = 'card';
      card.innerHTML = `
        <div class="panel-head">
          <h2 id="usersTitle">Gebruikers</h2>
          <div class="toolbar-note">Brede inventaris van bekende gebruikers met canonieke naam, activatieklik, pincode-status en openstaande punten.</div>
        </div>
        <input id="usersSearch" class="search-input" type="search" placeholder="Zoek gebruiker op naam of e-mail" />
        <div id="usersList"></div>
      `;
      workspace.appendChild(card);
    }
    const search = document.getElementById('usersSearch');
    if (search && !search.dataset.boundUsersSearch) {
      search.dataset.boundUsersSearch = '1';
      search.addEventListener('input', () => { if (getCurrentViewSafe() === 'users') renderUsersInventory(); });
    }
    return card;
  }

  function getCurrentViewSafe() {
    try { return String(currentAdminView || 'pending'); } catch (_) { return 'pending'; }
  }

  function inventoryKey(item) {
    const email = emailOf(item);
    const playerId = playerIdOf(item);
    const requestId = requestIdOfItem(item);
    const name = improvedDisplayName(item).toLowerCase();
    if (playerId) return `player:${playerId}`;
    if (email) return `email:${email}`;
    if (requestId) return `request:${requestId}`;
    return `name:${name}`;
  }

  function bucketRank(bucket) {
    switch (String(bucket || '').toLowerCase()) {
      case 'active': return 5;
      case 'awaiting': return 4;
      case 'expired': return 3;
      case 'pending': return 2;
      case 'rejected': return 1;
      case 'known_player': return 0;
      default: return 0;
    }
  }

  function mergeInventoryRows(existing, incoming) {
    if (!existing) return { ...(incoming || {}) };
    const next = { ...existing };
    const source = incoming || {};
    Object.entries(source).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (next[key] === undefined || next[key] === null || next[key] === '') next[key] = value;
    });
    const existingBucket = stateBucketSafe(existing);
    const incomingBucket = stateBucketSafe(source);
    if (bucketRank(incomingBucket) >= bucketRank(existingBucket)) {
      next.state_bucket = incomingBucket;
      next.status = source.status || next.status;
      next.request_status = source.request_status || next.request_status;
    }
    next.display_name = improvedDisplayName(next);
    return next;
  }

  let publicPlayerNames = [];

  async function syncPublicPlayerNames(force) {
    try {
      const getter = window.GEJAST_CONFIG && window.GEJAST_CONFIG.fetchScopedActivePlayerNames;
      if (typeof getter !== 'function') return;
      publicPlayerNames = await getter(currentScope());
    } catch (_) {
      if (force) publicPlayerNames = publicPlayerNames || [];
    }
  }

  function buildUsersInventory() {
    const requests = Array.isArray(window.lastRequests) ? window.lastRequests : [];
    const history = Array.isArray(window.lastHistory) ? window.lastHistory : [];
    const map = new Map();
    history.concat(requests).forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const key = inventoryKey(row);
      map.set(key, mergeInventoryRows(map.get(key), row));
    });
    const knownNames = new Set(Array.from(map.values()).map((row) => improvedDisplayName(row).toLowerCase()));
    (Array.isArray(publicPlayerNames) ? publicPlayerNames : []).forEach((name) => {
      const clean = cleanName(name);
      if (!clean) return;
      const lower = clean.toLowerCase();
      if (knownNames.has(lower)) return;
      map.set(`known:${lower}`, { display_name: clean, state_bucket: 'known_player', status: 'known_player', request_status: 'known_player' });
      knownNames.add(lower);
    });
    return Array.from(map.values()).sort((a, b) => {
      const bucketDiff = bucketRank(stateBucketSafe(b)) - bucketRank(stateBucketSafe(a));
      if (bucketDiff) return bucketDiff;
      return improvedDisplayName(a).localeCompare(improvedDisplayName(b), 'nl');
    });
  }

  function inventoryStatusLabel(item) {
    const bucket = stateBucketSafe(item);
    switch (bucket) {
      case 'active': return 'Actief';
      case 'awaiting': return 'Wacht op activatie';
      case 'expired': return 'Verlopen';
      case 'rejected': return 'Afgewezen / ingetrokken';
      case 'pending': return 'Open aanvraag';
      case 'known_player': return 'Bekende spelernaam';
      default: return bucket || 'Onbekend';
    }
  }

  function pendingIssues(item) {
    const issues = [];
    const bucket = stateBucketSafe(item);
    if (bucket === 'awaiting' && !activationUsed(item)) issues.push('Activatielink nog niet gebruikt');
    if (bucket === 'expired') issues.push('Activatielink verlopen');
    if (!pinSet(item) && bucket !== 'pending' && bucket !== 'rejected' && bucket !== 'known_player') issues.push('Nog geen pincode zichtbaar');
    if (!emailOf(item)) issues.push('Geen e-mailadres in admindata');
    return issues.length ? issues.join(' · ') : 'Geen duidelijke openstaande punten';
  }

  function inventorySourceLabel(item) {
    if (String(item?.state_bucket || '').toLowerCase() === 'known_player') return 'Publieke spelerslijst';
    if (playerIdOf(item)) return 'Speler / aanvraag';
    if (requestIdOfItem(item)) return 'Aanvraag / geschiedenis';
    return 'Bekend record';
  }

  function inventoryHtml(item) {
    const bucket = stateBucketSafe(item);
    const badgeClass = bucket === 'active' ? 'state-activated' : bucket === 'awaiting' ? 'state-approved' : bucket === 'expired' ? 'state-expired' : bucket === 'rejected' ? 'state-rejected' : 'state-pending';
    const email = emailOf(item);
    const requestId = requestIdOfItem(item);
    const used = activationUsed(item) ? 'Ja' : 'Nee';
    const pin = pinSet(item) ? 'Ja' : 'Nee';
    return `
      <div class="request">
        <div class="entry-top">
          <div>
            <div class="state-badge ${badgeClass}">${inventoryStatusLabel(item)}</div>
            <div class="entry-title">${escapeHtmlSafe(improvedDisplayName(item))}</div>
            <div class="muted">${email ? escapeHtmlSafe(email) : 'Geen e-mailadres'}${requestId ? ` · verzoek #${escapeHtmlSafe(requestId)}` : ''}</div>
          </div>
          <div class="muted" style="text-align:right;">${activatedAt(item) ? `Laatste activatiespoor<br><strong>${escapeHtmlSafe(formatDateSafe(activatedAt(item)))}</strong>` : ''}</div>
        </div>
        <div class="request-grid">
          ${metaBoxSafe('Bron', inventorySourceLabel(item))}
          ${metaBoxSafe('Status', inventoryStatusLabel(item))}
          ${metaBoxSafe('Speler-ID', playerIdOf(item) || 'Onbekend')}
          ${metaBoxSafe('Canonieke naam', improvedDisplayName(item))}
        </div>
        <div class="users-extra-grid">
          ${metaBoxSafe('Activatielink gebruikt', used)}
          ${metaBoxSafe('Pincode ingesteld', pin)}
          ${metaBoxSafe('Verloopt / verliep op', expiresAt(item) ? formatDateSafe(expiresAt(item)) : 'Onbekend')}
        </div>
        <div class="users-extra-note">${escapeHtmlSafe(pendingIssues(item))}</div>
      </div>
    `;
  }

  function renderUsersInventory() {
    ensureUsersCard();
    const root = document.getElementById('usersList');
    if (!root) return;
    const q = String(document.getElementById('usersSearch')?.value || '').trim().toLowerCase();
    const items = buildUsersInventory().filter((item) => {
      if (!q) return true;
      return [improvedDisplayName(item), emailOf(item), playerIdOf(item), requestIdOfItem(item)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
    root.innerHTML = items.length ? items.map(inventoryHtml).join('') : '<div class="empty-state">Geen gebruikers gevonden.</div>';
  }

  function patchViewConfig() {
    try {
      if (typeof getAdminViewConfig === 'function') {
        const oldGet = getAdminViewConfig;
        getAdminViewConfig = function() {
          const cfg = oldGet();
          cfg.users = { title: 'Gebruikers', subtitle: 'Brede inventaris van bekende gebruikers en spelers.', card: 'usersCard' };
          return cfg;
        };
      }
    } catch (_) {}
  }

  function ensureUsersStatCard() {
    const grid = document.getElementById('statsGrid');
    if (!grid) return;
    const count = buildUsersInventory().length;
    let card = grid.querySelector('[data-admin-view-card="users"]');
    if (!card) {
      const div = document.createElement('div');
      div.className = 'stat-card clickable';
      div.dataset.adminViewCard = 'users';
      div.innerHTML = `<div class="label">Gebruikers</div><div id="statUsers" class="value">${count}</div>`;
      grid.appendChild(div);
      div.addEventListener('click', () => { if (typeof switchAdminView === 'function') switchAdminView('users'); });
      card = div;
    }
    const value = card.querySelector('.value');
    if (value) value.textContent = String(count);
  }


  async function ensureHubUsersStatCard(force) {
    const grid = document.querySelector('.stats');
    if (!grid || !window.GEJAST_ADMIN_CLAIMS_SOURCE || typeof window.GEJAST_ADMIN_CLAIMS_SOURCE.load !== 'function') return;
    let count = 0;
    try {
      await syncPublicPlayerNames(force);
      const bundle = await window.GEJAST_ADMIN_CLAIMS_SOURCE.load(
        window.GEJAST_SCOPE_CONTEXT && typeof window.GEJAST_SCOPE_CONTEXT.getAdminSessionToken === 'function'
          ? window.GEJAST_SCOPE_CONTEXT.getAdminSessionToken()
          : '',
        { force: !!force, scope: currentScope() }
      );
      const requests = Array.isArray(bundle?.requests) ? bundle.requests : [];
      const history = []
        .concat(Array.isArray(bundle?.history) ? bundle.history : [])
        .concat(Array.isArray(bundle?.expired_queue) ? bundle.expired_queue : [])
        .concat(Array.isArray(bundle?.expiredQueue) ? bundle.expiredQueue : []);
      const map = new Map();
      history.concat(requests).forEach((row) => {
        if (!row || typeof row !== 'object') return;
        map.set(inventoryKey(row), mergeInventoryRows(map.get(inventoryKey(row)), row));
      });
      const knownNames = new Set(Array.from(map.values()).map((row) => improvedDisplayName(row).toLowerCase()));
      (Array.isArray(publicPlayerNames) ? publicPlayerNames : []).forEach((name) => {
        const clean = cleanName(name);
        if (!clean) return;
        const lower = clean.toLowerCase();
        if (knownNames.has(lower)) return;
        map.set(`known:${lower}`, { display_name: clean, state_bucket: 'known_player', status: 'known_player', request_status: 'known_player' });
        knownNames.add(lower);
      });
      count = map.size;
    } catch (_) {}
    let card = grid.querySelector('[data-users-hub-card]');
    if (!card) {
      const link = document.createElement('a');
      link.className = 'stat stat-link';
      link.dataset.usersHubCard = '1';
      const href = scopeHref(currentScope(), 'admin_claims.html');
      link.href = href.includes('#') ? href : `${href}#view=users`;
      link.innerHTML = `<span>Gebruikers</span><strong id="statUsersHub">${count}</strong>`;
      grid.appendChild(link);
      card = link;
    }
    const value = card.querySelector('strong');
    if (value) value.textContent = String(count);
  }

  function patchTabRendering() {
    try {
      if (typeof renderAdminTabs === 'function') {
        const oldRender = renderAdminTabs;
        renderAdminTabs = function() {
          oldRender();
          ensureUsersCard();
          ensureUsersStatCard();
          const root = document.getElementById('adminTabs');
          if (!root) return;
          const count = buildUsersInventory().length;
          let btn = root.querySelector('[data-admin-view="users"]');
          if (!btn) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `<button type="button" class="tab-btn" data-admin-view="users"><span>Gebruikers</span><span class="tab-count">${count}</span></button>`;
            btn = wrapper.firstElementChild;
            root.appendChild(btn);
            btn.addEventListener('click', () => { if (typeof switchAdminView === 'function') switchAdminView('users'); });
          }
          const countNode = btn.querySelector('.tab-count');
          if (countNode) countNode.textContent = String(count);
          btn.classList.toggle('active', getCurrentViewSafe() === 'users');
        };
      }
    } catch (_) {}
  }

  function patchSharedSearch() {
    try {
      if (typeof applySharedSearchToVisibleCard === 'function') {
        const oldApply = applySharedSearchToVisibleCard;
        applySharedSearchToVisibleCard = function() {
          oldApply();
          const usersSearch = document.getElementById('usersSearch');
          if (usersSearch) usersSearch.value = getCurrentViewSafe() === 'users' ? String(document.getElementById('adminSearchGlobal')?.value || '').trim() : '';
        };
      }
    } catch (_) {}
  }

  function patchSwitchAdminView() {
    try {
      if (typeof switchAdminView !== 'function') return;
      const oldSwitch = switchAdminView;
      switchAdminView = function(view) {
        ensureUsersCard();
        if (view !== 'users') {
          const result = oldSwitch(view);
          const card = document.getElementById('usersCard');
          if (card) { card.classList.remove('current-view'); card.style.display = 'none'; }
          return result;
        }
        try { currentAdminView = 'users'; } catch (_) {}
        try { history.replaceState(null, '', '#view=users'); } catch (_) {}
        const cfg = (typeof getAdminViewConfig === 'function' ? getAdminViewConfig() : {}).users || { title: 'Gebruikers', subtitle: 'Brede inventaris van bekende gebruikers en spelers.', card: 'usersCard' };
        const title = document.getElementById('currentListTitle');
        const subtitle = document.getElementById('currentListSubtitle');
        if (title) title.textContent = cfg.title;
        if (subtitle) subtitle.textContent = cfg.subtitle;
        ['requestsCard','historyCard','approvedUsersCard','usersCard'].forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.classList.remove('current-view');
          el.style.display = 'none';
        });
        const active = document.getElementById('usersCard');
        if (active) { active.style.display = 'block'; active.classList.add('current-view'); }
        if (typeof applySharedSearchToVisibleCard === 'function') applySharedSearchToVisibleCard();
        renderUsersInventory();
        if (typeof renderAdminTabs === 'function') renderAdminTabs();
      };
    } catch (_) {}
  }

  function patchRefresh() {
    try {
      if (typeof refreshAdminLists !== 'function') return;
      const oldRefresh = refreshAdminLists;
      refreshAdminLists = async function(force) {
        await syncPublicPlayerNames(force);
        const result = await oldRefresh(force);
        ensureUsersStatCard();
        if (getCurrentViewSafe() === 'users') renderUsersInventory();
        else if (typeof renderAdminTabs === 'function') renderAdminTabs();
        return result;
      };
    } catch (_) {}
  }

  function installClaimsEnhancements() {
    if (!isClaimsPage()) return;
    ensureUsersCard();
    patchNameResolvers();
    patchViewConfig();
    patchTabRendering();
    patchSharedSearch();
    patchSwitchAdminView();
    patchRefresh();
    syncPublicPlayerNames(true).finally(() => {
      try {
        ensureUsersStatCard();
        if (typeof renderAdminTabs === 'function') renderAdminTabs();
        if (getCurrentViewSafe() === 'users') renderUsersInventory();
      } catch (_) {}
    });
    setTimeout(() => {
      try {
        if (document.getElementById('adminView') && !document.getElementById('adminView').classList.contains('hidden') && typeof refreshAdminLists === 'function') {
          refreshAdminLists(true).catch(() => {});
        }
      } catch (_) {}
    }, 100);
  }

  function install() {
    injectStyles();
    injectAdminScopeSwitcher();
    patchNonBlockingAutomaticMakeWake();
    patchInlineFailedToFetchCopy();
    installClaimsEnhancements();
    if (/admin\.html/i.test(pageName())) {
      try { ensureHubUsersStatCard(true); } catch (_) {}
      const refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn && !refreshBtn.dataset.boundUsersHubRefresh) {
        refreshBtn.dataset.boundUsersHubRefresh = '1';
        refreshBtn.addEventListener('click', () => { window.setTimeout(() => { try { ensureHubUsersStatCard(true); } catch (_) {} }, 120); });
      }
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { try { ensureHubUsersStatCard(false); } catch (_) {} }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
