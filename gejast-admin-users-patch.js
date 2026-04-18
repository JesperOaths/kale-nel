(function(){
  const PAGE_MATCH = /admin_claims\.html/i;
  if (!PAGE_MATCH.test(String((location && location.pathname) || ''))) return;

  let publicPlayerNames = [];

  function readValue(name, fallback) {
    try { return eval(name); } catch (_) { return fallback; }
  }

  function writeCurrentView(value) {
    try { currentAdminView = value; } catch (_) {}
  }

  function getCurrentView() {
    try { return String(currentAdminView || 'pending'); } catch (_) { return 'pending'; }
  }

  function cleanName(value) {
    if (typeof cleanDisplayCandidate === 'function') return cleanDisplayCandidate(value);
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(onbekend|unknown|n\/a|null|undefined|geen)$/i.test(text)) return '';
    return text;
  }

  function rowEmail(row) {
    return String(row?.requester_email || row?.recipient_email || row?.email || '').trim().toLowerCase();
  }

  function rowRequestId(row) {
    return row?.request_id ?? row?.claim_request_id ?? row?.id ?? null;
  }

  function rowPlayerId(row) {
    return row?.player_id ?? row?.related_player_id ?? null;
  }

  function directNameCandidates(row) {
    const item = row || {};
    return [
      item.display_name,
      item.public_display_name,
      item.chosen_username,
      item.requested_name,
      item.desired_name,
      item.player_name,
      item.reserved_display_name,
      item.reserved_name,
      item.requester_name,
      item.name,
      item.profile_name,
      item.allowed_username,
      item.allowed_username_name,
      item.username,
      item.nickname,
      item.requester_meta && item.requester_meta.display_name,
      item.requester_meta && item.requester_meta.player_name,
      item.requester_meta && item.requester_meta.public_display_name,
      item.requester_meta && item.requester_meta.chosen_username,
      item.requester_meta && item.requester_meta.requested_name,
      item.requester_meta && item.requester_meta.name
    ].map(cleanName).filter(Boolean);
  }

  function relatedCanonicalName(row) {
    const email = rowEmail(row);
    const requestId = rowRequestId(row);
    const playerId = rowPlayerId(row);
    const pools = []
      .concat(Array.isArray(readValue('lastRequests', [])) ? readValue('lastRequests', []) : [])
      .concat(Array.isArray(readValue('lastHistory', [])) ? readValue('lastHistory', []) : []);
    for (const candidate of pools) {
      if (!candidate || typeof candidate !== 'object') continue;
      const samePlayer = playerId != null && rowPlayerId(candidate) != null && String(rowPlayerId(candidate)) === String(playerId);
      const sameRequest = requestId != null && rowRequestId(candidate) != null && String(rowRequestId(candidate)) === String(requestId);
      const sameEmail = email && rowEmail(candidate) && rowEmail(candidate) === email;
      if (!samePlayer && !sameRequest && !sameEmail) continue;
      const names = directNameCandidates(candidate);
      if (names.length) return names[0];
    }
    return '';
  }

  function improvedDisplayName(req) {
    const direct = directNameCandidates(req);
    if (direct.length) return direct[0];
    const related = relatedCanonicalName(req);
    if (related) return related;
    return 'Onbekende naam';
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
          if (row && typeof row === 'object') {
            const betterName = improvedDisplayName(row);
            if (betterName && betterName !== 'Onbekende naam') row.display_name = betterName;
          }
          return row;
        };
      }
    } catch (_) {}
  }

  function injectLayoutStyles() {
    if (document.getElementById('gejast-admin-users-layout-v562')) return;
    const style = document.createElement('style');
    style.id = 'gejast-admin-users-layout-v562';
    style.textContent = `
      #statsGrid {
        display: grid !important;
        grid-template-columns: repeat(6, minmax(118px, 1fr)) !important;
        gap: 10px !important;
        overflow-x: auto;
        padding-bottom: 2px;
      }
      #statsGrid .stat-card {
        min-width: 118px;
        padding: 14px 12px;
        border-radius: 16px;
      }
      #statsGrid .stat-card .label {
        font-size: 11px;
        line-height: 1.15;
        min-height: 28px;
        display: block;
      }
      #statsGrid .stat-card .value {
        font-size: 28px;
        margin-top: 4px;
      }
      #adminTabs {
        display: grid !important;
        grid-template-columns: repeat(6, minmax(110px, 1fr)) !important;
        gap: 8px !important;
        align-items: stretch;
      }
      #adminTabs .tab-btn {
        width: 100%;
        min-width: 0;
        justify-content: space-between;
        padding: 9px 10px;
        border-radius: 14px;
        gap: 8px;
      }
      #adminTabs .tab-btn span:first-child {
        white-space: normal;
        line-height: 1.1;
        text-align: left;
      }
      #adminTabs .tab-count {
        flex: 0 0 auto;
      }
      @media (max-width: 980px) {
        #statsGrid, #adminTabs {
          overflow-x: auto;
          grid-auto-flow: column;
          grid-auto-columns: minmax(132px, 1fr);
          grid-template-columns: none !important;
        }
      }
    `;
    document.head.appendChild(style);
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
          <div class="toolbar-note">Brede inventaris van bekende gebruikers: actief, wacht op activatie, verlopen, afgewezen, open aanvragen en bekende spelernamen.</div>
        </div>
        <input id="usersSearch" class="search-input" type="search" placeholder="Zoek gebruiker op naam of e-mail" />
        <div id="usersList"></div>
      `;
      workspace.appendChild(card);
    }
    const search = document.getElementById('usersSearch');
    if (search && !search.dataset.boundUsersSearch) {
      search.dataset.boundUsersSearch = '1';
      search.addEventListener('input', () => { if (getCurrentView() === 'users') renderUsersInventory(); });
    }
    return card;
  }

  function ensureUsersStatCard() {
    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return null;
    let card = document.getElementById('statUsersCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'statUsersCard';
      card.className = 'stat-card clickable';
      card.setAttribute('data-admin-view-card', 'users');
      card.innerHTML = `<div class="label">Gebruikers</div><div id="statUsers" class="value">0</div>`;
      statsGrid.appendChild(card);
      card.addEventListener('click', () => {
        if (typeof switchAdminView === 'function') switchAdminView('users');
      });
    }
    return card;
  }

  function inventoryKey(item) {
    const row = item || {};
    const playerId = rowPlayerId(row);
    const email = rowEmail(row);
    const requestId = rowRequestId(row);
    const name = improvedDisplayName(row).toLowerCase();
    if (playerId != null && playerId !== '') return `player:${playerId}`;
    if (email) return `email:${email}`;
    if (requestId != null && requestId !== '') return `request:${requestId}`;
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
    const existingBucket = (typeof stateBucket === 'function') ? stateBucket(existing) : (existing.state_bucket || 'pending');
    const incomingBucket = (typeof stateBucket === 'function') ? stateBucket(source) : (source.state_bucket || 'pending');
    if (bucketRank(incomingBucket) >= bucketRank(existingBucket)) {
      next.state_bucket = incomingBucket;
      next.status = source.status || next.status;
      next.request_status = source.request_status || next.request_status;
    }
    const betterName = improvedDisplayName(next);
    if (betterName && betterName !== 'Onbekende naam') next.display_name = betterName;
    return next;
  }

  async function syncPublicPlayerNames(force) {
    try {
      const getter = window.GEJAST_CONFIG && window.GEJAST_CONFIG.fetchScopedActivePlayerNames;
      if (typeof getter !== 'function') return;
      const scope = (window.GEJAST_ADMIN_RPC && window.GEJAST_ADMIN_RPC.getScope && window.GEJAST_ADMIN_RPC.getScope()) || 'friends';
      const names = await getter(scope);
      publicPlayerNames = Array.isArray(names) ? names.filter(Boolean) : [];
    } catch (_) {
      if (force) publicPlayerNames = publicPlayerNames || [];
    }
  }

  function buildUsersInventory() {
    const requests = readValue('lastRequests', []);
    const history = readValue('lastHistory', []);
    const map = new Map();
    ([]).concat(Array.isArray(history) ? history : [], Array.isArray(requests) ? requests : []).forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const key = inventoryKey(row);
      map.set(key, mergeInventoryRows(map.get(key), row));
    });
    const knownNames = new Set();
    Array.from(map.values()).forEach((row) => knownNames.add(improvedDisplayName(row).toLowerCase()));
    (Array.isArray(publicPlayerNames) ? publicPlayerNames : []).forEach((name) => {
      const clean = cleanName(name);
      if (!clean) return;
      const lower = clean.toLowerCase();
      if (knownNames.has(lower)) return;
      const stub = { display_name: clean, state_bucket: 'known_player', status: 'known_player', request_status: 'known_player' };
      map.set(`known:${lower}`, stub);
      knownNames.add(lower);
    });
    return Array.from(map.values()).sort((a, b) => {
      const bucketDiff = bucketRank((typeof stateBucket === 'function' ? stateBucket(b) : b.state_bucket)) - bucketRank((typeof stateBucket === 'function' ? stateBucket(a) : a.state_bucket));
      if (bucketDiff) return bucketDiff;
      return improvedDisplayName(a).localeCompare(improvedDisplayName(b), 'nl');
    });
  }

  function inventoryStatusLabel(item) {
    const bucket = (typeof stateBucket === 'function') ? stateBucket(item) : String(item?.state_bucket || '').toLowerCase();
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

  function inventorySourceLabel(item) {
    if (String(item?.state_bucket || '').toLowerCase() === 'known_player') return 'Publieke spelerslijst';
    if (item?.player_id != null && item?.player_id !== '') return 'Speler / aanvraag';
    if (item?.request_id != null || item?.claim_request_id != null || item?.id != null) return 'Aanvraag / geschiedenis';
    return 'Bekend record';
  }

  function yesNoLabel(value) {
    return value ? 'Ja' : 'Nee';
  }

  function inventoryHtml(item) {
    const email = String(item?.requester_email || item?.recipient_email || item?.email || '').trim();
    const decidedAt = item?.decided_at ? formatDateTime(item.decided_at) : '';
    const createdAt = item?.created_at ? formatDateTime(item.created_at) : '';
    const activatedAt = item?.activated_at || item?.activated_on || item?.player_activation_used_at || item?.activation_used_at || item?.link_used_at || item?.used_at || '';
    const requestId = rowRequestId(item);
    const bucket = String((typeof stateBucket === 'function' ? stateBucket(item) : item?.state_bucket) || 'pending');
    const badgeClass = bucket === 'active' ? 'state-activated' : bucket === 'awaiting' ? 'state-approved' : bucket === 'expired' ? 'state-expired' : bucket === 'rejected' ? 'state-rejected' : 'state-pending';
    const hasPin = Boolean(item?.hasPin || item?.has_pin || item?.pin_is_set || item?.player_has_pin || item?.pin_set || item?.pin_hash_set || item?.pin_hash_present || item?.player_pin_hash_set || item?.pin_hash || item?.player_pin_hash);
    return `
      <div class="request">
        <div class="entry-top">
          <div>
            <div class="state-badge ${badgeClass}">${inventoryStatusLabel(item)}</div>
            <div class="entry-title">${escapeHtml(improvedDisplayName(item))}</div>
            <div class="muted">${email ? escapeHtml(email) : 'Geen e-mailadres in admindata'}${requestId != null ? ` · verzoek #${escapeHtml(requestId)}` : ''}</div>
          </div>
          <div class="muted" style="text-align:right;">${createdAt ? `Aangemaakt<br><strong>${createdAt}</strong>` : ''}${decidedAt ? `<br><span>Beslist: ${escapeHtml(decidedAt)}</span>` : ''}</div>
        </div>
        <div class="request-grid">
          ${metaBox('Bron', inventorySourceLabel(item))}
          ${metaBox('Status', inventoryStatusLabel(item))}
          ${metaBox('Speler-ID', item?.player_id ?? 'Onbekend')}
          ${metaBox('E-mail', email || 'Geen e-mailadres')}
          ${metaBox('Pincode ingesteld', yesNoLabel(hasPin))}
          ${metaBox('Activatielink gebruikt', activatedAt ? formatDateTime(activatedAt) : 'Nee / onbekend')}
        </div>
      </div>
    `;
  }

  function renderUsersInventory() {
    ensureUsersCard();
    const root = document.getElementById('usersList');
    if (!root) return;
    const q = String(document.getElementById('usersSearch')?.value || '').trim().toLowerCase();
    const allItems = buildUsersInventory();
    const items = allItems.filter((item) => {
      if (!q) return true;
      return [improvedDisplayName(item), item?.requester_email, item?.recipient_email, item?.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
    root.innerHTML = items.length ? items.map(inventoryHtml).join('') : '<div class="empty-state">Geen gebruikers gevonden.</div>';
    const statUsers = document.getElementById('statUsers');
    if (statUsers) statUsers.textContent = String(allItems.length);
  }

  function patchViewConfig() {
    try {
      if (typeof getAdminViewConfig === 'function') {
        const oldGetAdminViewConfig = getAdminViewConfig;
        getAdminViewConfig = function() {
          const cfg = oldGetAdminViewConfig();
          cfg.users = { title: 'Gebruikers', subtitle: 'Brede inventaris van bekende gebruikers en spelers.', card: 'usersCard' };
          return cfg;
        };
      }
    } catch (_) {}
  }

  function patchTabRendering() {
    try {
      if (typeof renderAdminTabs === 'function') {
        const oldRenderAdminTabs = renderAdminTabs;
        renderAdminTabs = function() {
          oldRenderAdminTabs();
          ensureUsersCard();
          injectLayoutStyles();
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
            btn.addEventListener('click', () => switchAdminView('users'));
          }
          const countNode = btn.querySelector('.tab-count');
          if (countNode) countNode.textContent = String(count);
          btn.classList.toggle('active', getCurrentView() === 'users');
          const statValue = document.getElementById('statUsers');
          if (statValue) statValue.textContent = String(count);
        };
      }
    } catch (_) {}
  }

  function patchRenderStats() {
    try {
      if (typeof renderStats === 'function') {
        const oldRenderStats = renderStats;
        renderStats = function(requests, history) {
          const result = oldRenderStats(requests, history);
          injectLayoutStyles();
          ensureUsersStatCard();
          const statUsers = document.getElementById('statUsers');
          if (statUsers) statUsers.textContent = String(buildUsersInventory().length);
          return result;
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
          if (usersSearch) usersSearch.value = getCurrentView() === 'users' ? String(document.getElementById('adminSearchGlobal')?.value || '').trim() : '';
        };
      }
    } catch (_) {}
  }

  function patchSwitchAdminView() {
    try {
      if (typeof switchAdminView === 'function') {
        const oldSwitch = switchAdminView;
        switchAdminView = function(view) {
          ensureUsersCard();
          injectLayoutStyles();
          ensureUsersStatCard();
          if (view !== 'users') {
            const result = oldSwitch(view);
            const card = document.getElementById('usersCard');
            if (card) {
              card.classList.remove('current-view');
              card.style.display = 'none';
            }
            return result;
          }
          writeCurrentView('users');
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
          if (active) {
            active.style.display = 'block';
            active.classList.add('current-view');
          }
          if (typeof applySharedSearchToVisibleCard === 'function') applySharedSearchToVisibleCard();
          renderUsersInventory();
          if (typeof renderAdminTabs === 'function') renderAdminTabs();
        };
      }
    } catch (_) {}
  }

  function patchRefresh() {
    try {
      if (typeof refreshAdminLists === 'function') {
        const oldRefresh = refreshAdminLists;
        refreshAdminLists = async function(force) {
          await syncPublicPlayerNames(force);
          const result = await oldRefresh(force);
          const statUsers = document.getElementById('statUsers');
          if (statUsers) statUsers.textContent = String(buildUsersInventory().length);
          if (getCurrentView() === 'users') renderUsersInventory();
          else if (typeof renderAdminTabs === 'function') renderAdminTabs();
          return result;
        };
      }
    } catch (_) {}
  }

  function install() {
    ensureUsersCard();
    injectLayoutStyles();
    ensureUsersStatCard();
    patchNameResolvers();
    patchViewConfig();
    patchRenderStats();
    patchTabRendering();
    patchSharedSearch();
    patchSwitchAdminView();
    patchRefresh();
    syncPublicPlayerNames(true).finally(() => {
      try {
        if (typeof renderAdminTabs === 'function') renderAdminTabs();
        const statUsers = document.getElementById('statUsers');
        if (statUsers) statUsers.textContent = String(buildUsersInventory().length);
        if (getCurrentView() === 'users') renderUsersInventory();
      } catch (_) {}
    });
    setTimeout(() => {
      try {
        if (document.getElementById('adminView') && !document.getElementById('adminView').classList.contains('hidden') && typeof refreshAdminLists === 'function') {
          refreshAdminLists(true).catch(() => {});
        }
      } catch (_) {}
    }, 80);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
