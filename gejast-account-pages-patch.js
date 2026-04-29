(function(){
  function currentPage() {
    try { return (location.pathname || '').split('/').pop() || ''; } catch (_) { return ''; }
  }
  function currentScope() {
    try {
      if (window.GEJAST_ACCOUNT_SCOPE && typeof window.GEJAST_ACCOUNT_SCOPE.currentScope === 'function') return window.GEJAST_ACCOUNT_SCOPE.currentScope();
      return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends';
    } catch (_) { return 'friends'; }
  }
  function cleanName(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (/^(onbekend|unknown|n\/a|null|undefined|geen)$/i.test(text)) return '';
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return '';
    return text;
  }
  function uniqueNames(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(cleanName).filter((name) => {
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.localeCompare(b, 'nl'));
  }
  function extractNamesFromRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      if (typeof row === 'string') return row;
      return row?.display_name || row?.public_display_name || row?.chosen_username || row?.desired_name || row?.player_name || row?.name || row?.slug || '';
    }).filter(Boolean);
  }
  async function fetchAllowedUsernamesScoped(scope) {
    const cfg = window.GEJAST_CONFIG || {};
    const url = `${cfg.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,slug,status,site_scope&status=eq.available&order=display_name.asc`;
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      headers: {
        apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
        Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
        Accept: 'application/json'
      }
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.hint || `HTTP ${res.status}`);
    const rows = Array.isArray(data) ? data : [];
    return uniqueNames(rows.filter((row) => !row?.site_scope || String(row.site_scope).toLowerCase() === scope).map((row) => row?.display_name || row?.slug || ''));
  }

  function patchRequestPage() {
    const note = document.getElementById('requestNoteInput');
    if (note) {
      note.required = false;
      note.removeAttribute('required');
      note.setAttribute('aria-required', 'false');
      note.dataset.optionalHardcoded = '1';
    }
    const button = document.getElementById('requestBtn');
    if (button) button.dataset.optionalNoteHardcoded = '1';
    const labels = Array.from(document.querySelectorAll('label'));
    labels.forEach((label) => {
      if (/notitie/i.test(String(label.textContent || ''))) label.textContent = 'Notitie (optioneel)';
    });
    if (typeof requestClaim === 'function' && !requestClaim.__optionalNoteWrapped) {
      const originalRequestClaim = requestClaim;
      const optionalPlaceholder = 'Geen notitie opgegeven';
      requestClaim = async function() {
        const noteEl = document.getElementById('requestNoteInput');
        const hadBlank = !!noteEl && !String(noteEl.value || '').trim();
        const previous = noteEl ? noteEl.value : '';
        if (noteEl && hadBlank) noteEl.value = optionalPlaceholder;
        try {
          return await originalRequestClaim();
        } finally {
          if (noteEl && hadBlank && String(noteEl.value || '').trim() === optionalPlaceholder) noteEl.value = previous;
        }
      };
      requestClaim.__optionalNoteWrapped = true;
    }
    if (typeof getRequestableNames !== 'function') return;
    const original = getRequestableNames;
    getRequestableNames = async function() {
      const scope = currentScope();
      try {
        const scoped = await fetchAllowedUsernamesScoped(scope);
        if (scoped.length) return scoped;
      } catch (_) {}
      try {
        const payload = await original();
        return uniqueNames(Array.isArray(payload) ? payload : []);
      } catch (_) {
        return [];
      }
    };
  }

  function patchLoginPage() {
    if (typeof getLoginNames !== 'function') return;
    const original = getLoginNames;
    getLoginNames = async function() {
      const names = [];
      try {
        if (window.GEJAST_ACCOUNT_SCOPE && typeof window.GEJAST_ACCOUNT_SCOPE.callRpcCompat === 'function') {
          const scoped = await window.GEJAST_ACCOUNT_SCOPE.callRpcCompat('get_login_names', {});
          names.push(...extractNamesFromRows(Array.isArray(scoped) ? scoped : scoped?.names));
        }
      } catch (_) {}
      try {
        const helper = window.GEJAST_CONFIG && window.GEJAST_CONFIG.fetchScopedActivePlayerNames;
        if (typeof helper === 'function') names.push(...await helper(currentScope()));
      } catch (_) {}
      try {
        const payload = await original();
        names.push(...extractNamesFromRows(Array.isArray(payload) ? payload : payload?.names));
      } catch (_) {}
      try {
        names.push(...await fetchAllowedUsernamesScoped(currentScope()));
      } catch (_) {}
      return { names: uniqueNames(names) };
    };
  }

  function install() {
    const page = currentPage().toLowerCase();
    if (page === 'request.html') patchRequestPage();
    if (page === 'login.html') patchLoginPage();
    setTimeout(() => {
      try {
        if (page === 'request.html' && typeof load === 'function') load().catch(() => {});
        if (page === 'login.html' && typeof load === 'function') load().catch(() => {});
      } catch (_) {}
    }, 60);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
