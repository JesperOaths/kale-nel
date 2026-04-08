(function (global) {
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

  async function callRpc(name, payload) {
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
    cfg
  };
})(window);
