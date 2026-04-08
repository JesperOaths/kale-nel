(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DRINK_TYPE_NORMALIZATION = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DRINK_TYPE_REGISTRY = Object.freeze({
    bier: { key: 'bier', label: 'Bier', aliases: ['bier', 'biertje', 'beer'] },
    '2bakken': { key: '2bakken', label: '2 Bakken', aliases: ['2bakken', '2 bakken', 'twee bakken'] },
    liter_bier: { key: 'liter_bier', label: 'Liter Bier', aliases: ['liter_bier', 'liter bier', 'literbier', '1 liter bier'] },
    ice: { key: 'ice', label: 'Ice', aliases: ['ice', 'smirnoff ice'] },
    wijnfles: { key: 'wijnfles', label: 'Fles Wijn', aliases: ['wijnfles', 'fles wijn', 'wijn'] },
    shot: { key: 'shot', label: 'Shot', aliases: ['shot', 'shots'] }
  });

  function foldDrinkTypeKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const DRINK_TYPE_ALIAS_MAP = Object.freeze(
    Object.values(DRINK_TYPE_REGISTRY).reduce((map, entry) => {
      entry.aliases.forEach((alias) => {
        map[foldDrinkTypeKey(alias)] = entry.key;
      });
      map[entry.key] = entry.key;
      return map;
    }, {})
  );

  function normalizeDrinkTypeKey(value, options) {
    const opts = Object.assign({ allowShots: true, fallback: 'bier' }, options || {});
    const folded = foldDrinkTypeKey(value);
    const normalized = DRINK_TYPE_ALIAS_MAP[folded] || opts.fallback;
    if (!opts.allowShots && normalized === 'shot') return opts.fallback;
    return normalized;
  }

  function getDrinkTypeLabel(value) {
    const key = normalizeDrinkTypeKey(value, { allowShots: true, fallback: 'bier' });
    return (DRINK_TYPE_REGISTRY[key] && DRINK_TYPE_REGISTRY[key].label) || 'Bier';
  }

  function getVisibleDrinkTypes(options) {
    const opts = Object.assign({ includeShots: false }, options || {});
    return Object.values(DRINK_TYPE_REGISTRY)
      .filter((entry) => opts.includeShots || entry.key !== 'shot')
      .map((entry) => ({ key: entry.key, label: entry.label }));
  }

  return {
    DRINK_TYPE_REGISTRY,
    DRINK_TYPE_ALIAS_MAP,
    foldDrinkTypeKey,
    normalizeDrinkTypeKey,
    getDrinkTypeLabel,
    getVisibleDrinkTypes
  };
});
