(function (global) {
  'use strict';
  if (global.GEJAST_PIKKEN_LADDER) return;

  function qs(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }
  function firstValue(row, keys) {
    for (const key of keys) {
      const value = row && row[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return '';
  }
  function rowParts(row) {
    if (row == null) return { label: '', value: '', sub: '' };
    if (typeof row !== 'object') return { label: String(row), value: '', sub: '' };
    return {
      label: firstValue(row, ['label', 'player_name', 'display_name', 'name', 'title', 'metric']),
      value: firstValue(row, ['value', 'rating', 'score', 'wins', 'count', 'total']),
      sub: firstValue(row, ['sub', 'subtitle', 'description', 'meta', 'detail'])
    };
  }
  function empty(message) {
    return `<div class="empty-state">${esc(message)}</div>`;
  }
  function cardHtml(card) {
    const { label, value, sub } = rowParts(card);
    return `<article class="market-card"><div class="eyebrow">${esc(label || 'Pikken')}</div><div class="balance" style="font-size:1.75rem">${esc(value)}</div>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</article>`;
  }
  function listRowHtml(row, index) {
    const { label, value, sub } = rowParts(row);
    return `<div class="ledger-row split"><div><b>${esc(label || `#${index + 1}`)}</b>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</div>${value !== '' ? `<b>${esc(value)}</b>` : ''}</div>`;
  }
  function renderCards(id, rows, emptyText) {
    const el = qs(id);
    if (!el) return;
    const list = Array.isArray(rows) ? rows : [];
    el.innerHTML = list.length ? list.map(cardHtml).join('') : empty(emptyText);
  }
  function renderList(id, rows, emptyText) {
    const el = qs(id);
    if (!el) return;
    const list = Array.isArray(rows) ? rows : [];
    el.innerHTML = list.length ? list.map(listRowHtml).join('') : empty(emptyText);
  }
  function renderLeaderboardSections(sections) {
    const list = Array.isArray(sections) ? sections : [];
    const primary = list[0] || {};
    if (qs('ladderTitle') && primary.title) qs('ladderTitle').textContent = primary.title;
    if (qs('ladderIntro') && primary.subtitle) qs('ladderIntro').textContent = primary.subtitle;
    renderList('ladderRows', primary.rows, 'Nog geen spelers in deze Pikken-ladder.');

    const wrap = qs('ladderSectionsWrap');
    if (!wrap) return;
    const secondary = list.slice(1);
    wrap.innerHTML = secondary.length ? secondary.map((section) => `
      <section class="panel">
        <div class="panel-head"><div><h3>${esc(section?.title || 'Subranglijst')}</h3>${section?.subtitle ? `<p>${esc(section.subtitle)}</p>` : ''}</div></div>
        <div class="list">${Array.isArray(section?.rows) && section.rows.length ? section.rows.map(listRowHtml).join('') : empty('Nog geen resultaten.')}</div>
      </section>`).join('') : empty('Nog geen subranglijsten beschikbaar.');
  }
  function tableRowHtml(row, columns, index) {
    if (Array.isArray(row)) {
      return `<div class="ledger-row"><b>#${index + 1}</b><div class="meta">${row.map((value, i) => `${esc(columns[i] || `Veld ${i + 1}`)}: ${esc(value)}`).join(' · ')}</div></div>`;
    }
    if (!row || typeof row !== 'object') return listRowHtml(row, index);
    const parts = columns.map((column) => {
      const direct = row[column];
      const underscored = row[String(column).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')];
      const value = direct !== undefined ? direct : underscored;
      return value === undefined ? '' : `${esc(column)}: ${esc(value)}`;
    }).filter(Boolean);
    if (!parts.length) return listRowHtml(row, index);
    return `<div class="ledger-row"><b>#${index + 1}</b><div class="meta">${parts.join(' · ')}</div></div>`;
  }
  function renderTableSections(sections) {
    const wrap = qs('ladderTablesWrap');
    if (!wrap) return;
    const list = Array.isArray(sections) ? sections : [];
    wrap.innerHTML = list.length ? list.map((section) => {
      const rows = Array.isArray(section?.rows) ? section.rows : [];
      const columns = Array.isArray(section?.columns) ? section.columns : [];
      return `<section class="panel"><div class="panel-head"><div><h3>${esc(section?.title || 'Recente Pikken-data')}</h3>${section?.subtitle ? `<p>${esc(section.subtitle)}</p>` : ''}</div></div><div class="list">${rows.length ? rows.map((row, index) => tableRowHtml(row, columns, index)).join('') : empty('Nog geen recente regels.')}</div></section>`;
    }).join('') : empty('Nog geen recente Pikken-data.');
  }
  function render(data) {
    const payload = data && typeof data === 'object' ? data : {};
    renderCards('ladderOverviewGrid', payload.overview_cards, 'Nog geen Pikken-overzicht beschikbaar.');
    renderCards('ladderStoryGrid', payload.story_cards, 'Nog geen bragging cards beschikbaar.');
    renderLeaderboardSections(payload.leaderboard_sections);
    renderList('ladderHistory', payload.recent_rows, 'Nog geen recente ladderhistorie.');
    renderTableSections(payload.table_sections);

    const summary = payload.summary || {};
    const note = qs('ladderFormulaNote');
    if (note) {
      const matches = Number(summary.matches_played || 0);
      const players = Number(summary.unique_players || 0);
      note.textContent = `Deze pagina gebruikt rechtstreeks de gescopeerde Pikken-statistiekbron. De backend levert de ranglijsten en bragging boards; de browser verzint geen eigen rating. Huidige bron: ${matches} gespeelde wedstrijd${matches === 1 ? '' : 'en'} en ${players} unieke speler${players === 1 ? '' : 's'}.`;
    }
    const status = qs('ladderStatus');
    if (status) status.textContent = 'Pikken-ladder geladen.';
  }
  async function load() {
    const status = qs('ladderStatus');
    if (status) status.textContent = 'Pikken-ladder laden…';
    try {
      const rpc = global.GEJAST_SCOPED_RPC;
      if (!rpc || typeof rpc.callRpc !== 'function') throw new Error('Pikken stats-runtime ontbreekt.');
      const data = await rpc.callRpc('get_pikken_stats_scoped', {});
      render(data);
      return data;
    } catch (error) {
      if (status) status.textContent = error?.message || String(error);
      renderCards('ladderOverviewGrid', [], 'Pikken-overzicht kon niet worden geladen.');
      renderCards('ladderStoryGrid', [], 'Bragging cards konden niet worden geladen.');
      renderList('ladderRows', [], 'Pikken-ladder kon niet worden geladen.');
      renderList('ladderHistory', [], 'Historie kon niet worden geladen.');
      if (qs('ladderSectionsWrap')) qs('ladderSectionsWrap').innerHTML = empty('Subranglijsten konden niet worden geladen.');
      if (qs('ladderTablesWrap')) qs('ladderTablesWrap').innerHTML = empty('Recente Pikken-data kon niet worden geladen.');
      throw error;
    }
  }

  global.GEJAST_PIKKEN_LADDER = { load, render };
})(window);
