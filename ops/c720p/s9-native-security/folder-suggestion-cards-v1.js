(function (root) {
  'use strict';
  /* Optional renderer for the existing authenticated People/Folder UI.
   * Does not fetch raw embeddings or persist decisions itself. The host MUST
   * use its own signed media-open/attestor and authoritative review API.
   */
  const SCHEMA = 'folder_suggestions_v1';
  function element(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }
  function number(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  function formatScore(value) {
    const n = number(value);
    return n === null ? 'Unavailable' : n.toFixed(3);
  }
  function statusLine(row) {
    return 'Upper crop: ' + formatScore(row.upper_crop_score) +
      ' · Visual: ' + formatScore(row.visual_score) +
      ' · Color: ' + formatScore(row.color_score);
  }
  function safeMatch(row) {
    return row && row.state === 'pending_review' &&
      row.human_review_required === true &&
      row.verified_same_person === false &&
      row.automatically_assigned === false &&
      row.confidence_is_identity_probability === false &&
      typeof row.folder_id === 'string' &&
      typeof row.source === 'string' && typeof row.clip_id === 'string' &&
      row.source_qualified_clip_id === row.source + ':' + row.clip_id &&
      /^[a-f0-9]{64}$/.test(String(row.media_sha256)) &&
      typeof row.media_revision === 'string' && !!row.media_revision &&
      number(row.suggestion_confidence) !== null &&
      row.suggestion_confidence >= 0 && row.suggestion_confidence <= 100 &&
      number(row.score) !== null && number(row.centroid_score) !== null &&
      number(row.exemplar_score) !== null;
  }
  function invoke(host, text, callback, row) {
    const button = element('button', text);
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try { await callback(row); }
      catch (error) {
        const note = host.querySelector('[data-review-status]');
        if (note) note.textContent = error && error.message ?
          error.message : 'Review action failed. No decision recorded.';
      }
      finally { button.disabled = false; }
    });
    return button;
  }
  function render(host, snapshot, hooks) {
    if (!host || typeof host.replaceChildren !== 'function' ||
        !hooks || typeof hooks.onOpen !== 'function' ||
        typeof hooks.onApprove !== 'function' ||
        typeof hooks.onReject !== 'function') {
      throw new Error('Authenticated review handlers are required');
    }
    host.replaceChildren();
    if (!snapshot || snapshot.schema !== SCHEMA ||
        snapshot.status !== 'human_review_only' ||
        snapshot.automatic_assignments !== 0 ||
        snapshot.identity_probabilities !== false ||
        !Array.isArray(snapshot.matches) || !Array.isArray(snapshot.provisional_clusters)) {
      host.append(element('p', 'Verified provisional suggestions unavailable.'));
      return {visible: 0};
    }
    const matches = snapshot.matches.filter(safeMatch).slice(0, 300);
    const heading = element('h3', 'Pending appearance suggestions');
    host.append(heading, element('p',
      'Scores are provisional resemblance indicators, never identity probabilities. ' +
      'Approve or Reject only after inspecting the original clip.'));
    for (const row of matches) {
      const card = element('article', undefined, 'folder-suggestion-card');
      const label = element('h4', row.folder_id + ' · ' + row.source_qualified_clip_id);
      const detail = element('p', 'Suggestion confidence index: ' +
        row.suggestion_confidence.toFixed(1) + '% · pending review');
      const subs = element('p', statusLine(row));
      const breakdown = element('p', 'Centroid (40%): ' +
        formatScore(row.centroid_score) + ' · closest approved example (60%): ' +
        formatScore(row.exemplar_score) + ' · negative penalty: ' +
        formatScore(row.negative_penalty));
      const actions = element('div', undefined, 'actions');
      const message = element('p', 'Inspect this original recording to enable review.');
      message.setAttribute('data-review-status', '');
      const approve = invoke(card, 'Approve in folder', async () => {
        const result = await hooks.onApprove(row);
        if (!result || result.persisted !== true || result.media_verified !== true ||
            result.status !== 'approved') {
          throw Error('Approval not verified as saved. Refresh before retrying.');
        }
        message.textContent = 'Approved and persisted; refresh ranked suggestions.';
        approve.disabled = true;
        reject.disabled = true;
        if (typeof hooks.onSaved === 'function') hooks.onSaved(result);
      }, row);
      const reject = invoke(card, 'Reject for this folder', async () => {
        const result = await hooks.onReject(row);
        if (!result || result.persisted !== true || result.media_verified !== true ||
            result.status !== 'rejected') {
          throw Error('Folder-specific exclusion not verified as saved.');
        }
        message.textContent = 'Rejected for this folder; original retained.';
        approve.disabled = true;
        reject.disabled = true;
        if (typeof hooks.onSaved === 'function') hooks.onSaved(result);
      }, row);
      approve.disabled = true;
      reject.disabled = true;
      const open = invoke(card, 'Inspect original', async () => {
        const evidence = await hooks.onOpen(row);
        const sameMedia = evidence && evidence.verified === true &&
          evidence.media_sha256 === row.media_sha256 &&
          evidence.media_revision === row.media_revision;
        if (!sameMedia) {
          message.textContent = 'Original review could not be attested. Approval remains locked.';
          return;
        }
        message.textContent = 'Original media attested for this review. Make a human decision.';
        approve.disabled = false;
        reject.disabled = false;
      }, row);
      actions.append(open, approve, reject);
      card.append(label, detail, subs, breakdown, actions, message);
      host.append(card);
    }
    if (!matches.length) host.append(element('p', 'No eligible named-folder matches.'));
    const waiting = snapshot.provisional_clusters.filter(c =>
      c && c.state === 'pending_review' && c.human_review_required === true &&
      c.automatically_assigned === false && Array.isArray(c.source_qualified_clips));
    if (waiting.length) {
      host.append(element('h3', 'Awaiting Review · provisional groups'));
      for (const group of waiting.slice(0, 200)) {
        const section = element('section', undefined, 'folder-provisional-group');
        section.append(element('h4', 'Awaiting Review · ' + group.member_count +
          ' clip' + (group.member_count === 1 ? '' : 's')),
          element('p', group.source_qualified_clips.join(' · ')));
        if (typeof hooks.onClusterOpen === 'function')
          section.append(invoke(section, 'Inspect provisional group', hooks.onClusterOpen, group));
        if (typeof hooks.onClusterName === 'function')
          section.append(invoke(section, 'Name after review', hooks.onClusterName, group));
        host.append(section);
      }
    }
    return {visible: matches.length, provisional_groups: waiting.length};
  }
  root.FolderSuggestionCards = Object.freeze({render, safeMatch});
})(typeof window !== 'undefined' ? window : globalThis);
