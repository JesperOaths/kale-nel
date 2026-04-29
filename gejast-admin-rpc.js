(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_ADMIN_RPC = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const ADMIN_SCOPE_KEY = 'jas_admin_scope_v1';
  const RPC_TIMEOUT_MS = 12000;

  function cfg() {
    const value = root.GEJAST_CONFIG || {};
    if (!value.SUPABASE_URL || !value.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('GEJAST_CONFIG ontbreekt of is incompleet.');
    }
    return value;
  }

  function headers() {
    const value = cfg();
    return {
      apikey: value.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${value.SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }



  async function fetchWithTimeout(url, init, timeoutMs = RPC_TIMEOUT_MS) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? root.setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs) : null;
    try {
      return await root.fetch(url, controller ? { ...(init || {}), signal: controller.signal } : init);
    } catch (error) {
      if (controller && error && error.name === 'AbortError') {
        throw new Error(`Admin-RPC timeout na ${Math.round(timeoutMs/1000)}s`);
      }
      throw error;
    } finally {
      if (timer) root.clearTimeout(timer);
    }
  }

  async function parseResponse(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(text || `HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    }
    return data;
  }

  function getSessionToken() {
    if (root.GEJAST_ADMIN_SESSION && typeof root.GEJAST_ADMIN_SESSION.getToken === 'function') {
      return root.GEJAST_ADMIN_SESSION.getToken() || '';
    }
    return sessionStorage.getItem('jas_admin_session_v8') || localStorage.getItem('jas_admin_session_v8') || '';
  }

  function getScope() {
    const query = new URLSearchParams(root.location.search).get('scope');
    const local = root.localStorage.getItem(ADMIN_SCOPE_KEY);
    const raw = String(query || local || 'friends').toLowerCase();
    return raw === 'family' ? 'family' : 'friends';
  }

  function normalizeError(error) {
    const message = String(error?.message || error || 'Onbekende fout');
    const normalized = new Error(message);
    normalized.raw = error;
    normalized.code =
      /geen adminsessie|niet ingelogd|invalid_admin_session|session/i.test(message) ? 'INVALID_ADMIN_SESSION' :
      /not allowed|niet toegestaan|forbidden/i.test(message) ? 'NOT_ALLOWED' :
      /not found|niet gevonden/i.test(message) ? 'NOT_FOUND' :
      'ADMIN_RPC_ERROR';
    return normalized;
  }

  async function rpc(name, payload) {
    const value = cfg();
    const res = await fetchWithTimeout(`${value.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: headers(),
      body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }

  async function validateSession(pageName) {
    try {
      if (root.GEJAST_ADMIN_SESSION && typeof root.GEJAST_ADMIN_SESSION.validate === 'function') {
        return await root.GEJAST_ADMIN_SESSION.validate();
      }
      return await rpc('admin_check_session', { admin_session_token: getSessionToken() });
    } catch (error) {
      const normalized = normalizeError(error);
      if (pageName) {
        const here = encodeURIComponent(pageName);
        root.location.href = `./admin.html?reason=${encodeURIComponent(normalized.message)}&return_to=${here}`;
      }
      throw normalized;
    }
  }

  async function requirePage(pageName) {
    try {
      await validateSession(pageName);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function secureRead(domain, payload) {
    try {
      return await rpc('admin_secure_read_v356', {
        admin_session_token: getSessionToken(),
        domain,
        payload: {
          ...(payload || {}),
          site_scope_input: payload?.site_scope_input || getScope()
        }
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function secureWrite(domain, action, payload) {
    try {
      return await rpc('admin_secure_write_v356', {
        admin_session_token: getSessionToken(),
        domain,
        action,
        payload: {
          ...(payload || {}),
          site_scope_input: payload?.site_scope_input || getScope()
        }
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return {
    headers,
    parseResponse,
    getSessionToken,
    getScope,
    normalizeError,
    validateSession,
    requirePage,
    rpc,
    secureRead,
    secureWrite
  };
});
