(function(){
  const PAGE_MATCH = /admin_claims\.html/i;
  if (!PAGE_MATCH.test(String(location && location.pathname || ''))) return;

  let publicPlayerNames = [];

  function readValue(name, fallback) {
    try {
      return eval(name);
    } catch (_) {
      return fallback;
    }
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

  function improvedDisplayName(req) {
    const row = req || {};
    const candidates = [
      row.display_name,
      row.requested_name,
      row.public_display_name,
      row.chosen_username,
      row.desired_name,
      row.player_name,
      row.reserved_display_name,
      row.reserved_name,
      row.requester_name,
      row.name,
      row.requester_meta && row.requester_meta.display_name,
      row.requester_meta && row.requester_meta.player_name,
      row.requester_meta && row.requester_meta.name
    ].map(cleanName).filter(Boolean);
    return candidates[0] || `Gebruiker #${row?.id ?? row?.request_id ?? '?'}`;
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
            if (betterName && !/^Gebruiker #/.test(betterName)) row.display_name = betterName;
          }
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
          <div class="toolbar-note">Brede inventaris van bekende gebruikers: actief, wacht op activatie, verlopen, afgewezen en bekende spelersnamen.</div>
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

  function inventoryKey(item) {
    const row = item || {};
    const playerId = row.player_id ?? row.related_player_id ?? null;
    const email = String(row.requester_email || row.recipient_email || row.email || '').trim().toLowerCase();
    const requestId = row.request_id ?? row.claim_request_id ?? row.id ?? null;
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
    next.display_name = improvedDisplayName(next);
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

  function inventoryHtml(item) {
    const email = String(item?.requester_email || item?.recipient_email || item?.email || '').trim();
    const decidedAt = item?.decided_at ? formatDateTime(item.decided_at) : '';
    const createdAt = item?.created_at ? formatDateTime(item.created_at) : '';
    const requestId = item?.request_id ?? item?.claim_request_id ?? item?.id ?? null;
    return `
      <div class="request">
        <div class="entry-top">
          <div>
            <div class="state-badge ${String((typeof stateBucket === 'function' ? stateBucket(item) : item?.state_bucket) || 'pending') === 'active' ? 'state-activated' : String((typeof stateBucket === 'function' ? stateBucket(item) : item?.state_bucket) || 'pending') === 'awaiting' ? 'state-approved' : String((typeof stateBucket === 'function' ? stateBucket(item) : item?.state_bucket) || 'pending') === 'expired' ? 'state-expired' : String((typeof stateBucket === 'function' ? stateBucket(item) : item?.state_bucket) || 'pending') === 'rejected' ? 'state-rejected' : 'state-pending'}">${inventoryStatusLabel(item)}</div>
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
        </div>
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
      return [improvedDisplayName(item), item?.requester_email, item?.recipient_email, item?.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
    root.innerHTML = items.length ? items.map(inventoryHtml).join('') : '<div class="empty-state">Geen gebruikers gevonden.</div>';
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
          if (getCurrentView() === 'users') renderUsersInventory();
          else if (typeof renderAdminTabs === 'function') renderAdminTabs();
          return result;
        };
      }
    } catch (_) {}
  }

  function install() {
    ensureUsersCard();
    patchNameResolvers();
    patchViewConfig();
    patchTabRendering();
    patchSharedSearch();
    patchSwitchAdminView();
    patchRefresh();
    syncPublicPlayerNames(true).finally(() => {
      try {
        if (typeof renderAdminTabs === 'function') renderAdminTabs();
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
