(function (global) {
  function badgesApi() {
    return global.GEJAST_BADGES || null;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m] || m));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number(fallback || 0);
  }

  function formatNumber(value, digits) {
    const n = toNumber(value, 0);
    const fixed = Number.isInteger(n) && !digits ? String(Math.round(n)) : n.toFixed(digits == null ? 1 : digits);
    return fixed.replace(/\.0+$/, '');
  }

  function normalizeBadge(badge) {
    if (!badge) return null;
    return {
      key: badge.key,
      title: badge.title,
      name: badge.title,
      nickname: badge.nickname || '',
      description: badge.description || '',
      requirementsText: badge.requirementsText || '',
      rarityRank: Number(badge.rarityRank || 0),
      rarity: Number(badge.rarityRank || 0),
      rarityLabel: badge.rarityLabel || '',
      imageFull: badge.imageFull || '',
      image: badge.imageFull || '',
      imageMini48: badge.imageMini48 || '',
      imageMini64: badge.imageMini64 || ''
    };
  }

  function getRegistry() {
    const api = badgesApi();
    const registry = api && Array.isArray(api.BADGE_REGISTRY) ? api.BADGE_REGISTRY : [];
    return registry.map(normalizeBadge).filter(Boolean);
  }

  function sortBadgesDescAlpha(list) {
    return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
      const rarityDiff = Number(b.rarityRank || 0) - Number(a.rarityRank || 0);
      if (rarityDiff) return rarityDiff;
      return String(a.title || '').localeCompare(String(b.title || ''), 'nl');
    });
  }

  function scalarProgress(current, target, label, options) {
    const opts = options || {};
    const nCurrent = Math.max(0, toNumber(current, 0));
    const nTarget = Math.max(1, toNumber(target, 1));
    return {
      ratio: clamp(nCurrent / nTarget, 0, 1),
      summary: `${formatNumber(nCurrent, opts.digits)} / ${formatNumber(nTarget, opts.digits)} ${label}`,
      lines: [`${formatNumber(nCurrent, opts.digits)} / ${formatNumber(nTarget, opts.digits)} ${label}`]
    };
  }

  function thresholdProgressLowerIsBetter(value, targetSeconds, label) {
    const seconds = Math.max(0, toNumber(value, 0));
    const target = Math.max(1, toNumber(targetSeconds, 1));
    return {
      ratio: seconds > 0 ? clamp(target / seconds, 0, 1) : 0,
      summary: seconds > 0 ? `${formatNumber(seconds, 1)}s / <${formatNumber(target, 1)}s ${label}` : `Nog geen tijd voor ${label}`,
      lines: [seconds > 0 ? `Beste tijd: ${formatNumber(seconds, 1)}s` : 'Beste tijd: nog geen record', `Doel: onder ${formatNumber(target, 1)}s ${label}`]
    };
  }

  function choiceProgress(options) {
    const items = (Array.isArray(options) ? options : []).map((entry) => entry || {});
    const best = items.slice().sort((a, b) => Number(b.ratio || 0) - Number(a.ratio || 0))[0] || { ratio: 0, summary: 'Nog geen voortgang', lines: [] };
    return {
      ratio: clamp(Number(best.ratio || 0), 0, 1),
      summary: best.summary || 'Nog geen voortgang',
      lines: items.map((item) => item.summary).filter(Boolean)
    };
  }

  function compositeProgress(items) {
    const rows = (Array.isArray(items) ? items : []).map((item) => item || {});
    const ratios = rows.map((row) => clamp(Number(row.ratio || 0), 0, 1));
    const avg = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 0;
    return {
      ratio: clamp(avg, 0, 1),
      summary: rows.map((row) => row.summary).filter(Boolean).join(' · '),
      lines: rows.map((row) => row.summary).filter(Boolean)
    };
  }

  function snapshotFrom(input) {
    const api = badgesApi();
    return api && typeof api.normalizePlayerSnapshot === 'function' ? api.normalizePlayerSnapshot(input || {}) : (input || {});
  }

  function progressForBadge(snapshotInput, badgeKey) {
    const s = snapshotFrom(snapshotInput);
    switch (badgeKey) {
      case 'starter': return scalarProgress((s.totalMatches || 0), 1, 'wedstrijden');
      case 'groeier': return choiceProgress([
        scalarProgress(s.totalMatches || 0, 5, 'potjes'),
        scalarProgress(s.drinkEvents || 0, 10, 'drankacties')
      ]);
      case 'actief': return choiceProgress([
        scalarProgress(s.totalMatches || 0, 15, 'potjes'),
        scalarProgress(s.drinkEvents || 0, 25, 'drankacties')
      ]);
      case 'gold': return compositeProgress([
        scalarProgress(s.totalMatches || 0, 30, 'potjes'),
        scalarProgress(s.bestWinRate || 0, 55, '% beste winrate')
      ]);
      case 'legend': return compositeProgress([
        scalarProgress(s.totalMatches || 0, 60, 'potjes'),
        scalarProgress(s.bestWinRate || 0, 60, '% beste winrate')
      ]);
      case 'klaverkoning': return scalarProgress(s.klaverjasWins || 0, 20, 'klaverjaszeges');
      case 'bruggenbouwer': return choiceProgress([
        scalarProgress(s.boerenbridgeMatches || 0, 20, 'boerenbridge-potjes'),
        scalarProgress(s.boerenbridgeWins || 0, 10, 'boerenbridgezeges')
      ]);
      case 'snelheidsduivel': return scalarProgress(s.speedCount || 0, 3, 'speedrecords');
      case 'ijskoud': return thresholdProgressLowerIsBetter(s.iceBestSeconds || 0, 25, 'Ice');
      case 'kurkentrekker': return scalarProgress(s.wineEvents || 0, 5, 'wijn-acties');
      case 'verifieermeester': return scalarProgress(s.verificationVotes || 0, 50, 'geaccepteerde verificaties');
      case 'pussycup_prins': return compositeProgress([
        scalarProgress(s.beerpongMatches || 0, 12, 'beerpongpotjes'),
        scalarProgress(s.pussycupPct || 0, 75, '% pussycup')
      ]);
      case 'onbreekbaar': return scalarProgress(s.winStreak || 0, 10, 'winstreeks');
      case 'spinozageest': return compositeProgress([
        scalarProgress(s.totalMatches || 0, 25, 'potjes'),
        scalarProgress(s.drinkEvents || 0, 20, 'drankacties'),
        scalarProgress(s.verificationVotes || 0, 10, 'verificaties'),
        scalarProgress(s.activeGameCount || 0, 2, 'speltypes')
      ]);
      case 'alleskunner': return compositeProgress([
        scalarProgress(s.klaverjasMatches || 0, 10, 'klaverjaspotjes'),
        scalarProgress(s.boerenbridgeMatches || 0, 10, 'boerenbridge-potjes'),
        scalarProgress(s.beerpongMatches || 0, 10, 'beerpongpotjes')
      ]);
      case 'nachtburgemeester': return scalarProgress(s.nightActions || 0, 12, 'nachtacties');
      case 'dorstmachine': return scalarProgress(s.drinkUnits || 0, 40, 'drinkunits', { digits: 1 });
      case 'literlegende': return scalarProgress(s.literSub90Count || 0, 3, 'liter-records < 90s');
      case 'bekerbeul': return scalarProgress(s.beerpongWins || 0, 20, 'beerpongzeges');
      case 'trouwewachter': return scalarProgress(s.verificationVotes || 0, 20, 'verificaties');
      case 'salonleeuw': return choiceProgress([
        scalarProgress(s.ballroomEntries || 0, 10, 'ballroom-entries'),
        scalarProgress(s.ballroomKingCount || 0, 5, 'koningclaims')
      ]);
      case 'ijzerenmaag': return scalarProgress(s.tenUnitNights || 0, 5, 'zware nachten');
      case 'laatsteronde': return scalarProgress(s.afterFourActions || 0, 5, 'acties na 04:00');
      case 'fluwelenvorst': return choiceProgress([
        scalarProgress(s.ballroomKingCount || 0, 10, 'koningclaims'),
        scalarProgress(s.ballroomEntries || 0, 25, 'ballroom-entries')
      ]);
      case 'rozenkoning': return scalarProgress(s.specialWins || 0, 15, 'speciale zeges');
      case 'vuurproef': return compositeProgress([
        scalarProgress(s.activeDayStreak || 0, 7, 'actieve dagen'),
        scalarProgress((s.speedCount || 0) + (s.drinkEvents || 0), 7, 'snelheid/drankacties')
      ]);
      case 'sleuteldrager': return compositeProgress([
        scalarProgress(s.totalMatches || 0, 100, 'potjes'),
        scalarProgress(s.activeSitePartCount || 0, 4, 'site-gebieden')
      ]);
      case 'dobbelofniets': return scalarProgress(s.totalComebackWins || 0, 12, 'comebackzeges');
      case 'kaartopera': return compositeProgress([
        scalarProgress(s.klaverjasWins || 0, 20, 'klaverjaszeges'),
        scalarProgress(s.boerenbridgeWins || 0, 20, 'boerenbridgezeges'),
        scalarProgress(s.liveParticipationsTotal || 0, 5, 'live-deelnames')
      ]);
      case 'avondster': return compositeProgress([
        scalarProgress(s.totalMatches || 0, 50, 'potjes'),
        scalarProgress(s.drinkEvents || 0, 50, 'drankacties'),
        scalarProgress(s.verificationVotes || 0, 25, 'verificaties'),
        scalarProgress(s.speedCount || 0, 2, 'speedrecords'),
        scalarProgress(s.ballroomEntries || 0, 1, 'ballroom-activiteit'),
        scalarProgress(s.liveParticipationsTotal || 0, 1, 'live-activiteit')
      ]);
      default: return { ratio: 0, summary: 'Nog geen voortgang', lines: [] };
    }
  }

  function getBadgeProgressList(snapshotInput) {
    const api = badgesApi();
    const attainedKeys = new Set(api && typeof api.evaluateBadgeKeys === 'function' ? api.evaluateBadgeKeys(snapshotInput || {}) : []);
    return sortBadgesDescAlpha(getRegistry()).map((badge) => {
      const model = progressForBadge(snapshotInput, badge.key);
      const attained = attainedKeys.has(badge.key);
      return Object.assign({}, badge, {
        attained,
        progressRatio: attained ? 1 : clamp(Number(model.ratio || 0), 0, 1),
        progressPct: Math.round((attained ? 1 : clamp(Number(model.ratio || 0), 0, 1)) * 100),
        progressSummary: attained ? 'Behaald' : (model.summary || 'Nog geen voortgang'),
        progressLines: attained ? ['Behaald'] : (Array.isArray(model.lines) ? model.lines.filter(Boolean) : []),
        stateLabel: attained ? 'Behaald' : (Number(model.ratio || 0) > 0 ? 'Onderweg' : 'Nog niet gestart')
      });
    });
  }

  function groupRegistryByRarity() {
    const order = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
    const grouped = new Map();
    getRegistry().forEach((badge) => {
      const key = badge.rarityLabel || 'Overig';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(badge);
    });
    return Array.from(grouped.entries()).map(([label, items]) => ({
      label,
      items: items.slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'nl')),
      sortIndex: order.includes(label) ? order.indexOf(label) : 999,
      maxRarity: Math.max.apply(null, items.map((item) => Number(item.rarityRank || 0)).concat([0]))
    })).sort((a, b) => {
      if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
      return b.maxRarity - a.maxRarity;
    });
  }

  global.GEJAST_BADGE_PROGRESS = {
    esc,
    getRegistry,
    sortBadgesDescAlpha,
    snapshotFrom,
    progressForBadge,
    getBadgeProgressList,
    groupRegistryByRarity
  };
})(typeof window !== 'undefined' ? window : globalThis);
