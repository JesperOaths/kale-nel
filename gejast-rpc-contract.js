(function (global) {
  const COMPATIBLE_PARAM_RENAMES = {
    get_public_shared_player_stats_scoped: {
      game_key: 'game_key_input',
      player_name: 'player_name_input'
    },
    get_public_player_game_insights_scoped: {
      game_key: 'game_key_input',
      player_name: 'player_name_input'
    }
  };

  function cfg() {
    return global.GEJAST_CONFIG || {};
  }

  function rpcHeaders() {
    const c = cfg();
    return {
      apikey: c.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${c.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function parseJson(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(text || `HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(data?.message || data?.error || text || `HTTP ${res.status}`);
    return data;
  }

  function buildCompatPayload(name, payload) {
    const renameMap = COMPATIBLE_PARAM_RENAMES[name];
    if (!renameMap || !payload || typeof payload !== 'object') return null;
    let changed = false;
    const next = { ...payload };
    for (const [oldKey, newKey] of Object.entries(renameMap)) {
      if (next[oldKey] !== undefined && next[newKey] === undefined) {
        next[newKey] = next[oldKey];
        delete next[oldKey];
        changed = true;
      }
    }
    return changed ? next : null;
  }

  function isCompatRetryable(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('schema cache') || message.includes('could not find the function');
  }

  async function fetchRpc(name, payload) {
    const c = cfg();
    const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: rpcHeaders(),
      body: JSON.stringify(payload || {})
    }).then(parseJson);
    return raw?.[name] || raw;
  }

  async function callRpc(name, payload) {
    try {
      return await fetchRpc(name, payload);
    } catch (error) {
      const compatPayload = buildCompatPayload(name, payload);
      if (compatPayload && isCompatRetryable(error)) {
        return await fetchRpc(name, compatPayload);
      }
      throw error;
    }
  }

  function normalizeContractError(errorLike) {
    if (errorLike && errorLike.error && typeof errorLike.error === 'object') {
      const e = new Error(errorLike.error.message || 'Contract error');
      e.code = errorLike.error.code || 'CONTRACT_ERROR';
      e.details = errorLike.error.details || {};
      return e;
    }
    if (errorLike instanceof Error) return errorLike;
    return new Error(String(errorLike || 'Unknown error'));
  }

  async function callContract(contractName, payload, fallbackReader) {
    try {
      const result = await callRpc(contractName, payload);
      if (result && typeof result.ok === 'boolean') {
        if (!result.ok) throw normalizeContractError(result);
        return result.data ?? {};
      }
      return result ?? {};
    } catch (err) {
      if (typeof fallbackReader === 'function') return await fallbackReader(err);
      throw err;
    }
  }

  async function callContractWriter(contractName, payload, fallbackWriter) {
    try {
      const result = await callRpc(contractName, payload);
      if (result && typeof result.ok === 'boolean') {
        if (!result.ok) throw normalizeContractError(result);
        return result.data ?? {};
      }
      return result ?? {};
    } catch (err) {
      if (typeof fallbackWriter === 'function') return await fallbackWriter(err);
      throw err;
    }
  }

  global.GEJAST_RPC_CONTRACT = {
    rpcHeaders,
    parseJson,
    callRpc,
    callContract,
    callContractWriter,
    normalizeContractError,
    cfg,
    buildCompatPayload,
    isCompatRetryable
  };
})(window);
