(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;

  const CANONICAL_SPEED_TYPES = [
    { key: 'bier', label: 'Bier' },
    { key: '2_bakken', label: '2 bakken' },
    { key: 'liter_bier', label: 'Liter bier' },
    { key: 'ice', label: 'Ice' },
    { key: 'fles_wijn', label: 'Fles wijn' }
  ];

  function token() { return CTX.getPlayerSessionToken(); }
  function headers() { return RPC.rpcHeaders(); }

  function normalizeSpeedKey(value) {
    const key = String(value || '').trim().toLowerCase();
    if (key === '2bakken') return '2_bakken';
    if (key === 'wijnfles') return 'fles_wijn';
    return key;
  }

  function mergeSpeedTypes(...sources) {
    const map = new Map(CANONICAL_SPEED_TYPES.map((x) => [x.key, { key: x.key, label: x.label, rows: [] }]));
    sources.flat().forEach((item) => {
      const key = normalizeSpeedKey(item?.speed_type_key || item?.event_type_key || item?.key || '');
      if (!key || key === 'shot' || key === 'shots') return;
      const prev = map.get(key) || { key, label: key, rows: [] };
      map.set(key, {
        key,
        label: item?.speed_type_label || item?.event_type_label || item?.label || prev.label || key,
        rows: Array.isArray(item?.rows) ? item.rows : prev.rows || []
      });
    });
    return Array.from(map.values()).sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'nl'));
  }

  function canonicalSpeedSets(sets) {
    return mergeSpeedTypes(Array.isArray(sets) ? sets : []);
  }

  async function legacyRead(payload) {
    const sessionToken = CTX.getPlayerSessionToken();
    const [pageRaw, pendingRaw, mineRaw, historyRaw, speedRaw] = await Promise.allSettled([
      RPC.callRpc('get_drinks_page_public', payload),
      RPC.callRpc('get_all_pending_drink_event_verifications_public', { session_token: sessionToken }),
      RPC.callRpc('get_my_pending_drink_requests_public', { session_token: sessionToken }),
      RPC.callRpc('get_verified_drinks_history_public', { limit_count: payload.history_limit || 40 }),
      RPC.callRpc('get_drink_speed_page_public', payload)
    ]);

    const page = pageRaw.status === 'fulfilled' ? (pageRaw.value || {}) : {};
    const verifyQueue = pendingRaw.status === 'fulfilled' ? (pendingRaw.value || []) : (page.verify_queue || []);
    const myPending = mineRaw.status === 'fulfilled' ? (mineRaw.value || []) : (page.my_pending_events || []);
    const history = historyRaw.status === 'fulfilled' ? (historyRaw.value || []) : [];
    const speed = speedRaw.status === 'fulfilled' ? (speedRaw.value || {}) : {};

    return {
      context: { site_scope: CTX.getScope(), viewer_name: null },
      dashboard: {
        session: page.session || {},
        totals: page.totals || {},
        event_types: page.event_types || [],
        verify_queue: verifyQueue,
        my_pending_events: myPending,
        verified_recent: history,
        all_pending_verifications: verifyQueue
      },
      speed: {
        speed_types: mergeSpeedTypes(page.event_types || [], speed.speed_types || [], speed.top_attempts || [], speed.my_attempts || [], speed.verify_queue || []),
        top_attempts: speed.top_attempts || [],
        my_attempts: speed.my_attempts || [],
        verify_queue: speed.verify_queue || []
      }
    };
  }

  async function readDashboard({ viewerLat = null, viewerLng = null, historyLimit = 40 } = {}) {
    const payload = {
      session_token: CTX.getPlayerSessionToken(),
      viewer_lat: viewerLat,
      viewer_lng: viewerLng,
      site_scope_input: CTX.getScope(),
      history_limit: historyLimit
    };
    const data = await RPC.callContract('contract_drinks_read_v1', payload, () => legacyRead(payload));
    data.context = data.context || { site_scope: CTX.getScope(), viewer_name: null };
    data.dashboard = data.dashboard || {};
    data.speed = data.speed || {};
    data.dashboard.verify_queue = Array.isArray(data.dashboard.verify_queue) ? data.dashboard.verify_queue : [];
    data.dashboard.my_pending_events = Array.isArray(data.dashboard.my_pending_events) ? data.dashboard.my_pending_events : [];
    data.dashboard.verified_recent = Array.isArray(data.dashboard.verified_recent) ? data.dashboard.verified_recent : [];
    data.dashboard.all_pending_verifications = Array.isArray(data.dashboard.all_pending_verifications)
      ? data.dashboard.all_pending_verifications : data.dashboard.verify_queue;
    data.speed.speed_types = mergeSpeedTypes(
      data.dashboard?.event_types || [],
      data.speed?.speed_types || [],
      data.speed?.top_attempts || [],
      data.speed?.my_attempts || [],
      data.speed?.verify_queue || []
    );
    return data;
  }

  async function legacyWrite(action, payload) {
    switch (action) {
      case 'create_event':
        return RPC.callRpc('create_drink_event', payload);
      case 'cancel_event':
        return RPC.callRpc('cancel_my_pending_drink_event', payload);
      case 'verify_event':
        return RPC.callRpc('verify_drink_event_public', payload).catch(() => RPC.callRpc('verify_drink_event', payload));
      case 'create_speed_attempt':
        return RPC.callRpc('create_combined_drink_speed_attempt', payload);
      case 'cancel_speed_attempt':
        return RPC.callRpc('cancel_my_speed_attempt', payload);
      case 'verify_speed_attempt':
        return RPC.callRpc('verify_drink_speed_attempt', payload);
      default:
        throw new Error('Onbekende drinks-actie.');
    }
  }

  async function write(action, payload = {}) {
    const body = {
      session_token: CTX.getPlayerSessionToken(),
      action,
      payload,
      site_scope_input: CTX.getScope()
    };
    return RPC.callContractWriter('contract_drinks_write_v1', body, () => legacyWrite(action, Object.assign({ session_token: CTX.getPlayerSessionToken() }, payload)));
  }

  async function load(opts = {}) {
    const data = await readDashboard({ viewerLat: opts.viewer_lat ?? opts.viewerLat ?? null, viewerLng: opts.viewer_lng ?? opts.viewerLng ?? null, historyLimit: opts.history_limit ?? opts.historyLimit ?? 40 });
    return {
      page: {
        session: data.dashboard?.session || {},
        totals: data.dashboard?.totals || {},
        event_types: data.dashboard?.event_types || [],
        verify_queue: data.dashboard?.verify_queue || [],
        my_pending_events: data.dashboard?.my_pending_events || [],
        recent_verified: data.dashboard?.verified_recent || [],
        all_pending_verifications: data.dashboard?.all_pending_verifications || data.dashboard?.verify_queue || []
      },
      verify_queue: data.dashboard?.verify_queue || [],
      my_pending_events: data.dashboard?.my_pending_events || [],
      verified_history: data.dashboard?.verified_recent || [],
      recent_verified: data.dashboard?.verified_recent || [],
      recent_rejected: data.dashboard?.recent_rejected || [],
      event_types: data.dashboard?.event_types || [],
      speed_page: {
        top_attempts: data.speed?.top_attempts || [],
        my_attempts: data.speed?.my_attempts || [],
        verify_queue: data.speed?.verify_queue || [],
        speed_types: data.speed?.speed_types || []
      },
      speed_leaderboards: canonicalSpeedSets(data.speed?.speed_types || []),
      context: data.context || {}
    };
  }

  async function fallback(opts = {}) {
    return load(opts);
  }
  async function forPending(opts = {}) { return load(opts); }
  async function forAdd(opts = {}) { return load(opts); }
  async function forSpeed(opts = {}) { return load(opts); }

  global.GEJAST_DRINKS_WORKFLOW = { CANONICAL_SPEED_TYPES, canonicalSpeedSets, mergeSpeedTypes, load, fallback, token, headers, forPending, forAdd, forSpeed, readDashboard, write };
})(window);
