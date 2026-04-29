(function (global) {
  function cfg() {
    return global.GEJAST_CONFIG || {};
  }

  function getScope(siteScope) {
    if (siteScope) return siteScope;
    if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') {
      return global.GEJAST_SCOPE_UTILS.getScope();
    }
    return 'friends';
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

  async function parseResponse(res) {
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

  async function rpc(name, payload) {
    const c = cfg();
    const res = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: rpcHeaders(),
      body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }

  function enrichBadgeRow(row) {
    const registry = global.GEJAST_BADGE_REGISTRY || global.GEJAST_BADGES_CANONICAL || global.GEJAST_BADGES;
    const badge = registry && registry.getBadgeByKey ? registry.getBadgeByKey(row?.key || row?.badge_key || row?.title) : null;
    return Object.assign({}, badge || {}, row || {}, {
      key: row?.key || row?.badge_key || badge?.key || null,
      title: row?.title || badge?.title || null,
      nickname: row?.nickname || badge?.nickname || '',
      imageFull: row?.image_full || row?.imageFull || badge?.imageFull || null,
      imageMini48: row?.image_mini_48 || row?.imageMini48 || badge?.imageMini48 || null,
      imageMini64: row?.image_mini_64 || row?.imageMini64 || badge?.imageMini64 || null,
      rarityRank: Number(row?.rarity_rank || row?.rarityRank || badge?.rarityRank || 0),
      rarityLabel: row?.rarity_label || row?.rarityLabel || badge?.rarityLabel || ''
    });
  }

  function normalizeBundle(raw) {
    const data = raw?.data || raw || {};
    const attained = Array.isArray(data.attained_badges) ? data.attained_badges.map(enrichBadgeRow) : [];
    const all = Array.isArray(data.all_badges) ? data.all_badges.map(enrichBadgeRow) : [];
    const primary = data.primary_badge ? enrichBadgeRow(data.primary_badge) : null;
    return Object.assign({}, data, {
      attained_badges: attained,
      all_badges: all,
      primary_badge: primary,
      primary_nickname: data.primary_nickname || primary?.nickname || '',
      badge_count: Number(data.badge_count || attained.length || 0),
      mini_badges_48: Array.isArray(data.mini_badges_48) ? data.mini_badges_48.map(enrichBadgeRow) : attained.slice(0, 8),
      mini_badges_64: Array.isArray(data.mini_badges_64) ? data.mini_badges_64.map(enrichBadgeRow) : attained.slice(0, 8)
    });
  }

  async function loadPlayerBadgeBundle(options) {
    const opts = Object.assign({ playerName: '', siteScope: null }, options || {});
    if (!String(opts.playerName || '').trim()) throw new Error('playerName ontbreekt.');
    const raw = await rpc('get_player_badge_bundle_scoped', {
      player_name: String(opts.playerName || '').trim(),
      site_scope_input: getScope(opts.siteScope)
    });
    return normalizeBundle(raw);
  }

  async function loadSiteBadgeCards(options) {
    const opts = Object.assign({ siteScope: null }, options || {});
    const raw = await rpc('get_site_player_badge_cards_scoped', {
      site_scope_input: getScope(opts.siteScope)
    });
    const cards = Array.isArray(raw?.cards) ? raw.cards : (Array.isArray(raw) ? raw : []);
    return cards.map((card) => {
      const miniBadges = Array.isArray(card.mini_badges) ? card.mini_badges.map(enrichBadgeRow) : [];
      return Object.assign({}, card, {
        primary_badge: card.primary_badge ? enrichBadgeRow(card.primary_badge) : null,
        mini_badges: miniBadges,
        mini_badges_48: miniBadges,
        primary_nickname: card.primary_nickname || '',
        badge_count: Number(card.badge_count || miniBadges.length || 0)
      });
    });
  }

  function renderMiniBadgeRow(badges, size) {
    const pixelSize = String(size || '64') === '48' ? 48 : 64;
    return (Array.isArray(badges) ? badges : [])
      .map((badge) => enrichBadgeRow(badge))
      .filter((badge) => badge && (badge.imageMini48 || badge.imageMini64))
      .map((badge) => {
        const src = pixelSize === 48 ? badge.imageMini48 : badge.imageMini64;
        return `<img class="badge-mini badge-mini-${pixelSize}" src="${src}" alt="${badge.title || 'Badge'}" title="${badge.title || 'Badge'}" loading="lazy">`;
      })
      .join('');
  }

  global.GEJAST_BADGE_SOURCE = {
    enrichBadgeRow,
    normalizeBundle,
    loadPlayerBadgeBundle,
    loadSiteBadgeCards,
    renderMiniBadgeRow
  };
})(typeof window !== 'undefined' ? window : globalThis);
