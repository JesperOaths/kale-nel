(function (global) {
  function live() {
    return global.GEJAST_LIVE_SUMMARY || {};
  }

  function currentScope() {
    try {
      if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') {
        return global.GEJAST_SCOPE_UTILS.getScope();
      }
    } catch (_) {}
    try {
      return (live().currentScope && live().currentScope()) || 'friends';
    } catch (_) {
      return 'friends';
    }
  }

  function defaultHomeHref() {
    try {
      if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.defaultHome === 'function') {
        return global.GEJAST_SCOPE_UTILS.defaultHome(currentScope());
      }
    } catch (_) {}
    return currentScope() === 'family' ? './familie/index.html' : './index.html';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function text(value, fallback = '--') {
    const v = String(value ?? '').trim();
    return v || fallback;
  }

  function formatDateTime(value) {
    if (!value) return '--';
    try {
      return new Date(value).toLocaleString('nl-NL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return String(value);
    }
  }

  function parseIdentityFromHref(href) {
    try {
      const url = new URL(href, global.location.href);
      return {
        clientMatchId: url.searchParams.get('client_match_id') || '',
        matchRef: url.searchParams.get('match_ref') || ''
      };
    } catch (_) {
      return { clientMatchId: '', matchRef: '' };
    }
  }

  function homepageEntry(entries, gameType) {
    if (!entries) return null;
    if (entries[gameType]) return entries[gameType];
    if (entries.by_game && entries.by_game[gameType]) return entries.by_game[gameType];
    if (Array.isArray(entries)) {
      return entries.find((row) => String(row?.game_type || row?.gameKey || row?.key || '').trim().toLowerCase() === gameType) || null;
    }
    return null;
  }

  async function resolveIdentity(gameType) {
    const fromUrl = live().matchIdentityFromUrl ? live().matchIdentityFromUrl() : { clientMatchId: '', matchRef: '' };
    if (fromUrl.clientMatchId || fromUrl.matchRef) return { ...fromUrl, source: 'url' };
    try {
      const entries = await (live().loadHomepageState ? live().loadHomepageState('', currentScope()) : Promise.resolve({}));
      const entry = homepageEntry(entries, gameType);
      if (!entry) return { clientMatchId: '', matchRef: '', source: 'none' };
      const direct = {
        clientMatchId: entry.client_match_id || entry.clientMatchId || entry.match_ref || entry.matchRef || '',
        matchRef: entry.match_ref || entry.matchRef || ''
      };
      if (direct.clientMatchId || direct.matchRef) return { ...direct, source: 'homepage' };
      if (entry.href) return { ...parseIdentityFromHref(entry.href), source: 'homepage_href' };
    } catch (_) {}
    return { clientMatchId: '', matchRef: '', source: 'none' };
  }

  function metaFromItem(item) {
    const summary = live().summaryFromItem ? live().summaryFromItem(item) : (item?.summary || item?.summary_payload || {});
    const participants = Array.isArray(summary?.participants)
      ? summary.participants
      : (Array.isArray(summary?.players) ? summary.players : (live().participants ? live().participants(item) : []));
    const host = live().hostName ? live().hostName(item) : (summary?.submitter_meta?.submitted_by_name || item?.submitter_name || '');
    const rounds = Array.isArray(summary?.rounds) ? summary.rounds : [];
    const liveState = summary?.live_state || {};
    const winnerNames = Array.isArray(summary?.winner_names) ? summary.winner_names : [];
    return {
      item,
      summary,
      participants,
      host: String(host || '').trim(),
      rounds,
      roundsPlayed: num(liveState?.rounds_played, rounds.length),
      currentRound: num(liveState?.current_round, rounds.length),
      updatedAt: item?.updated_at || liveState?.updated_at || summary?.finished_at || summary?.created_at || null,
      finished: !!(live().isFinished ? live().isFinished(item) : (item?.finished_at || summary?.finished_at)),
      winnerLabel: text(summary?.winner_names_label || winnerNames.join(' - '), 'Nog geen winnaar'),
      winnerNames
    };
  }

  function setText(id, value) {
    const node = global.document.getElementById(id);
    if (node) node.textContent = value;
  }

  function setHtml(id, value) {
    const node = global.document.getElementById(id);
    if (node) node.innerHTML = value;
  }

  function setLinks(gameType) {
    const homeHref = defaultHomeHref();
    const homeNode = global.document.getElementById('homeLink');
    if (homeNode) homeNode.href = homeHref;
    const backNode = global.document.getElementById('backLink');
    if (backNode && !backNode.dataset.bound) {
      backNode.dataset.bound = '1';
      backNode.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (global.history.length > 1) global.history.back();
        else global.location.href = homeHref;
      });
    }
    const homeLogo = global.document.getElementById('brandHomeLink');
    if (homeLogo) homeLogo.href = homeHref;
    const scopeNode = global.document.getElementById('scopeChip');
    if (scopeNode) scopeNode.textContent = currentScope() === 'family' ? 'Family' : 'Vrienden';
    const pageNode = global.document.getElementById('spectatorPageChip');
    if (pageNode) pageNode.textContent = gameType === 'boerenbridge' ? 'Boerenbridge spectator' : 'Klaverjas spectator';
  }

  function renderStandardMeta(meta) {
    setText('metaText', live().metaText ? live().metaText(meta.item) : 'Live scoreblad');
    setText('statusChip', meta.finished ? 'Afgerond' : 'Live');
    setText('hostValue', text(meta.host, 'Onbekend'));
    setText('playersValue', meta.participants.length ? meta.participants.join(' - ') : 'Nog geen spelers');
    setText('roundsValue', `${meta.roundsPlayed}`);
    setText('winnerValue', meta.finished ? meta.winnerLabel : (meta.winnerNames.length ? meta.winnerLabel : 'Nog bezig'));
    setText('updatedValue', formatDateTime(meta.updatedAt));
    setText('refValue', text(meta.item?.client_match_id || meta.item?.match_ref || meta.summary?.match_ref, '--'));
  }

  async function mount(config) {
    const settings = Object.assign({
      gameType: 'klaverjas',
      emptyMessage: 'Geen actieve wedstrijd gevonden.',
      render() {}
    }, config || {});
    setLinks(settings.gameType);
    let pollId = null;

    async function load() {
      try {
        const identity = await resolveIdentity(settings.gameType);
        if (!identity.clientMatchId && !identity.matchRef) {
          setText('statusChip', 'Geen live potje');
          setText('metaText', settings.emptyMessage);
          if (typeof settings.renderEmpty === 'function') settings.renderEmpty();
          return;
        }
        const item = await live().loadPublicSummary(settings.gameType, identity);
        const meta = metaFromItem(item);
        renderStandardMeta(meta);
        settings.render(meta, {
          esc,
          num,
          text,
          formatDateTime,
          defaultHomeHref,
          identity
        });
        if (meta.finished && pollId) {
          global.clearInterval(pollId);
          pollId = null;
        }
      } catch (error) {
        setText('statusChip', 'Fout');
        setText('metaText', error?.message || 'Laden mislukt.');
        if (typeof settings.renderError === 'function') settings.renderError(error);
      }
    }

    load();
    pollId = global.setInterval(load, 5000);
  }

  global.GEJAST_SPECTATOR_PAGES = {
    esc,
    num,
    text,
    formatDateTime,
    resolveIdentity,
    metaFromItem,
    defaultHomeHref,
    mount
  };
})(window);
