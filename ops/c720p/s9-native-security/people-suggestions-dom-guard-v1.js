(() => {
  'use strict';
  // On the actual People & faces primary navigation, ensure a single Suggestions peer.
  // Capture activation so it works even when the historical v323 nav code is loaded.
  const EVENT = 'people-folder-suggestions-open';
  const paneNames = ['overview','review','people','clothing','automatic','suggestions','folderView'];
  function install() {
    const nav = document.querySelector('nav.tabs[aria-label="People and faces workspace"]');
    if (!nav || !nav.querySelector('button[data-pane="people"]') ||
        !nav.querySelector('button[data-pane="review"]') ||
        !nav.querySelector('button[data-pane="automatic"]')) return;
    let button = nav.querySelector('button[data-pane="suggestions"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.pane = 'suggestions';
      button.setAttribute('aria-selected', 'false');
      button.setAttribute('aria-controls', 'suggestions');
      button.textContent = 'Suggestions ';
      const before = nav.querySelector('button[data-pane="clothing"]');
      if (before) before.before(button); else nav.append(button);
    }
    button.hidden = false;
    button.removeAttribute('style');
    let badge = document.getElementById('suggestionsTabCount');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'suggestionsTabCount';
      badge.className = 'suggestions-tab-badge';
      badge.setAttribute('role','status');
      badge.setAttribute('aria-label','Pending suggestions');
      badge.hidden = true;
      button.append(badge);
    } else if (!button.contains(badge)) {
      button.append(badge);
    }
    let pane = document.getElementById('suggestions');
    if (!pane) {
      pane = document.createElement('section');
      pane.id = 'suggestions';
      pane.hidden = true;
      pane.setAttribute('aria-label', '512-D visual embedding Suggestions');
      const header = document.createElement('div');
      header.className = 'section-head';
      const heading = document.createElement('h2');
      heading.textContent = 'Suggestions';
      const refresh = document.createElement('button');
      refresh.id = 'refreshSuggestions';
      refresh.type = 'button';
      refresh.textContent = '↻ Refresh matches';
      header.append(heading, refresh);
      pane.append(header);
      const automatic = document.getElementById('automatic');
      if (automatic) automatic.after(pane);
      else nav.after(pane);
    }
    if (!document.getElementById('liveFolderSuggestionCards')) {
      const cards = document.createElement('div');
      cards.id = 'liveFolderSuggestionCards';
      cards.setAttribute('aria-live','polite');
      pane.append(cards);
    }
    if (nav.dataset.vectorSuggestionsBound === '1') return;
    nav.dataset.vectorSuggestionsBound = '1';
    nav.addEventListener('click', event => {
      const clicked = event.target.closest?.('button[data-pane="suggestions"]');
      if (!clicked || !nav.contains(clicked)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      for (const name of paneNames) {
        const section = document.getElementById(name);
        if (section) section.hidden = name !== 'suggestions';
      }
      nav.querySelectorAll('button[data-pane]').forEach(item => {
        item.setAttribute('aria-selected', String(item === button));
      });
      if (!window.FolderSuggestionCards?.connect) {
        const cards = document.getElementById('liveFolderSuggestionCards');
        if (cards) cards.textContent = 'The verified 512-D review client is unavailable. Reload People & faces.';
        return;
      }
      // The authenticated folder-suggestions-top-tab controller owns the
      // original-media attestation and calls FolderSuggestionCards.connect with
      // requiredMode='visual_embedding_cosine_v1' before rendering.
      window.dispatchEvent(new Event(EVENT));
    }, true);
    document.documentElement.dataset.vectorSuggestionsNavigation = 'ready';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, {once:true});
  } else install();
})();
