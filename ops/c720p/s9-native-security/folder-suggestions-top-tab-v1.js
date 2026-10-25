(() => {
  'use strict';
  // Top-level People & faces navigation. Read-only previews and counts;
  // decisions remain routed through the verified authenticated review API.
  const endpoint = '/new/api/folder-suggestions';
  const intent = 'human-folder-suggestions-v1';
  const VECTOR_MODE = 'visual_embedding_cosine_v1';
  const pane = document.getElementById('suggestions');
  const cardsHost = document.getElementById('liveFolderSuggestionCards');
  const badge = document.getElementById('suggestionsTabCount');
  const refreshButton = document.getElementById('refreshSuggestions');
  const renderer = window.FolderSuggestionCards;
  if (!pane || !cardsHost || !badge || !refreshButton || !renderer) return;

  const create = (tag, label) => {
    const element = document.createElement(tag);
    if (label !== undefined) element.textContent = label;
    return element;
  };
  const session = Array.from(crypto.getRandomValues(new Uint8Array(24)),
    n => n.toString(16).padStart(2, '0')).join('');
  function sourceRelay() {
    let current = window;
    for (let i = 0; i < 5; i++) {
      try {
        if (current.C720PSecureRelay?.fetch && current.C720PSecureRelay?.url)
          return current.C720PSecureRelay;
        if (current === current.parent) break;
        current = current.parent;
      } catch (_) { break; }
    }
    throw Error('Open People & faces inside the authenticated Security Hub.');
  }
  const relay = {
    fetch(path, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set('X-S9-Review-Session', session);
      return sourceRelay().fetch(path, {...options, headers});
    },
    url(path) { return sourceRelay().url(path); }
  };
  function setBadge(count) {
    if (count === null) {
      badge.textContent = '—';
      badge.title = 'Verified suggestions temporarily unavailable';
    } else {
      badge.textContent = String(count);
      badge.title = count + ' pending folder ' + (count === 1 ? 'match' : 'matches');
    }
    badge.hidden = false;
  }
  function verifySnapshot(data) {
    if (!data || data.schema !== 'folder_suggestions_v1' ||
        data.status !== 'human_review_only' ||
        data.historic_review_index_verified !== true ||
        data.verified_media_evidence !== true ||
        data.raw_embeddings_exposed !== false ||
        data.automatic_assignments !== 0 || data.probabilities !== false ||
        data.identity_probabilities === true ||
        data.scoring_mode !== VECTOR_MODE ||
        !Array.isArray(data.matches)) throw Error('Unverified suggestion snapshot');
    return data.matches.filter(renderer.safeMatch).length;
  }
  let badgeRequest = null;
  async function refreshCount() {
    // A badge must never turn an unavailable API into a misleading zero.
    if (badgeRequest) return badgeRequest;
    badgeRequest = (async () => {
      try {
        const response = await relay.fetch(endpoint, {cache: 'no-store'});
        if (!response.ok) throw Error('Suggestions unavailable');
        setBadge(verifySnapshot(await response.json()));
      } catch (_) { setBadge(null); }
    })();
    try { await badgeRequest; } finally { badgeRequest = null; }
  }
  async function post(path, body) {
    const response = await relay.fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json',
        'X-S9-Folder-Suggestion-Intent': intent},
      body: JSON.stringify(body)
    });
    const value = await response.json();
    if (!response.ok || value.ok !== true)
      throw Error(value.error || 'Verified original review is unavailable');
    return value;
  }
  const dialog = create('dialog');
  dialog.className = 'dialog';
  dialog.id = 'folderSuggestionOriginal';
  const heading = create('h2', 'Inspect original recording');
  const close = create('button', 'Close'); close.type = 'button';
  const video = create('video');
  video.controls = true; video.playsInline = true; video.preload = 'auto';
  const note = create('p'); note.setAttribute('role', 'status');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    video.pause(); video.removeAttribute('src'); video.load();
  });
  dialog.append(heading, close, video, note);
  document.body.append(dialog);
  let opening = false;
  async function onOpen(row) {
    if (opening) throw Error('Finish opening the current original first');
    opening = true;
    try {
      const prepared = await post(endpoint + '/open', {
        source: row.source, clip_id: row.clip_id,
        media_sha256: row.media_sha256, media_revision: row.media_revision,
        feature_snapshot_revision: row.feature_snapshot_revision
      });
      heading.textContent = 'Inspect original · ' + row.clip_id;
      note.textContent = 'Loading the original recording…';
      if (!dialog.open) dialog.showModal();
      const url = await relay.url(prepared.media_path);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(Error('Original playback timed out')), 45000);
        const ready = () => finish();
        const failed = () => finish(Error('Original recording could not be played'));
        const cancelled = () => finish(Error('Original inspection was cancelled'));
        function finish(error) {
          clearTimeout(timer);
          video.removeEventListener('loadeddata', ready);
          video.removeEventListener('error', failed);
          dialog.removeEventListener('close', cancelled);
          error ? reject(error) : resolve();
        }
        video.addEventListener('loadeddata', ready, {once: true});
        video.addEventListener('error', failed, {once: true});
        dialog.addEventListener('close', cancelled, {once: true});
        video.src = url;
        video.load();
      });
      note.textContent = 'Verifying original media and revision…';
      const verified = await post(endpoint + '/opened', {challenge: prepared.challenge});
      note.textContent = 'Original verified. Review the recording, then confirm or deny in the selected folder.';
      return verified;
    } catch (error) {
      note.textContent = 'Review locked: ' + error.message;
      throw error;
    } finally { opening = false; }
  }
  function onPreview(row) {
    if (!row || typeof row.clip_id !== 'string') return null;
    const image = create('img');
    image.alt = 'Recording preview';
    image.loading = 'lazy';
    image.style.cssText = 'max-width:220px;max-height:150px;object-fit:contain';
    relay.url('/new/saved/snap/' + encodeURIComponent(row.clip_id + '.thumb.jpg'))
      .then(url => { image.src = url; })
      .catch(() => image.remove());
    image.addEventListener('error', () => image.remove(), {once: true});
    return image;
  }
  let loading = null;
  async function load() {
    if (pane.hidden || loading) return loading;
    refreshButton.disabled = true;
    cardsHost.replaceChildren(create('p', 'Loading verified folder suggestions…'));
    loading = (async () => {
      try {
        await renderer.connect(cardsHost, {
          relay, onOpen, onPreview, showProvisional: true,
          requiredMode: VECTOR_MODE,
          onSnapshot: snapshot => { setBadge(verifySnapshot(snapshot)); },
          onSaved: () => { setBadge(null); }
        });
      } catch (error) {
        setBadge(null);
        cardsHost.replaceChildren(create('p', 'Suggestions unavailable: ' + error.message));
      } finally { refreshButton.disabled = false; }
    })();
    try { await loading; } finally { loading = null; }
  }
  // security-people-v320 emits this event only after it activates the new pane.
  window.addEventListener('people-folder-suggestions-open', load);
  refreshButton.addEventListener('click', load);
  // Keep the badge current without refreshing or interrupting active review cards.
  refreshCount();
  setInterval(() => { if (!document.hidden && !loading) refreshCount(); }, 120000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !loading) refreshCount();
  });
})();