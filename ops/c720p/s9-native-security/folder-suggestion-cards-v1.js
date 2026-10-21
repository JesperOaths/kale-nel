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
      finally { if (!button.__persistentlyDisabled) button.disabled = false; }
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
        approve.__persistentlyDisabled = true;
        reject.__persistentlyDisabled = true;
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
        approve.__persistentlyDisabled = true;
        reject.__persistentlyDisabled = true;
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
          evidence.media_revision === row.media_revision &&
          typeof evidence.opened_ticket === 'string' &&
          evidence.opened_ticket.length >= 10 &&
          evidence.opened_ticket.length <= 8192;
        if (!sameMedia) {
          message.textContent = 'Original review could not be attested. Approval remains locked.';
          return;
        }
        if (approve.__persistentlyDisabled || reject.__persistentlyDisabled) {
          message.textContent = 'Decision already saved. Refresh suggestions to continue.';
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
    const choices = Array.isArray(snapshot.folder_options) ?
      snapshot.folder_options.filter(f =>
        f && typeof f.id === 'string' &&
        /^[A-Za-z0-9_-]{1,100}$/.test(f.id)).slice(0, 250) : [];
    if (waiting.length) {
      host.append(element('h3', 'Awaiting Review · provisional groups'));
      for (const group of waiting.slice(0, 200)) {
        const section = element('section', undefined, 'folder-provisional-group');
        section.append(element('h4', 'Awaiting Review · ' + group.member_count +
          ' clip' + (group.member_count === 1 ? '' : 's')),
          element('p', 'No existing person folder passed the match threshold. ' +
            'Only an explicit human decision after original playback may seed a folder.'));
        if (Array.isArray(group.members)) {
          for (const member of group.members.slice(0, 24)) {
            if (!member || member.state !== 'pending_review' ||
                member.human_review_required !== true ||
                member.source_qualified_clip_id !== member.source + ':' + member.clip_id ||
                !/^[a-f0-9]{64}$/.test(String(member.media_sha256)) ||
                typeof member.media_revision !== 'string' || !member.media_revision)
              continue;
            const card = element('article', undefined, 'folder-suggestion-card');
            card.append(element('strong', member.source_qualified_clip_id),
              element('p', 'Provisional group member · no verified folder confidence yet'));
            const rowChoices = element('select');
            rowChoices.setAttribute('aria-label', 'Choose an existing person folder');
            for (const f of choices) {
              const option = element('option', f.label || f.id);
              option.value = f.id;
              rowChoices.append(option);
            }
            rowChoices.value = choices.find(f => f.id === hooks.preferredFolder)?.id ||
              choices[0]?.id || '';
            const stateNote = element('p',
              'Inspect the original first, then choose Approve or Reject.');
            stateNote.setAttribute('data-review-status', '');
            let attestedRow = null;
            let approve = null, reject = null;
            const invalidate = () => {
              attestedRow = null;
              if (approve) approve.disabled = true;
              if (reject) reject.disabled = true;
            };
            rowChoices.addEventListener('change', invalidate);
            if (choices.length) {
              approve = invoke(card, 'Approve selected provisional clip', async () => {
                if (!attestedRow) throw Error('Original review proof is missing.');
                const result = await hooks.onApprove(attestedRow);
                if (!result || result.persisted !== true ||
                    result.media_verified !== true || result.status !== 'approved')
                  throw Error('First-folder approval not verified as persisted.');
                stateNote.textContent = 'Verified folder seed approved; refresh suggestions.';
                approve.__persistentlyDisabled = true;
                reject.__persistentlyDisabled = true;
                approve.disabled = true;
                reject.disabled = true;
                if (typeof hooks.onSaved === 'function') hooks.onSaved(result);
              }, member);
              reject = invoke(card, 'Reject for selected folder', async () => {
                if (!attestedRow) throw Error('Original review proof is missing.');
                const result = await hooks.onReject(attestedRow);
                if (!result || result.persisted !== true ||
                    result.media_verified !== true || result.status !== 'rejected')
                  throw Error('Folder exclusion not verified as persisted.');
                stateNote.textContent = 'Excluded from this folder; original retained.';
                approve.__persistentlyDisabled = true;
                reject.__persistentlyDisabled = true;
                approve.disabled = true;
                reject.disabled = true;
                if (typeof hooks.onSaved === 'function') hooks.onSaved(result);
              }, member);
              approve.disabled = true;
              reject.disabled = true;
            }
            const inspect = invoke(card, 'Inspect original', async () => {
              if (!rowChoices.value) {
                stateNote.textContent = 'Create a named person folder first.';
                return;
              }
              const row = {...member, folder_id: rowChoices.value};
              const proof = await hooks.onOpen(row);
              if (!proof || proof.verified !== true ||
                  proof.media_sha256 !== member.media_sha256 ||
                  proof.media_revision !== member.media_revision ||
                  typeof proof.opened_ticket !== 'string' ||
                  proof.opened_ticket.length < 10) {
                invalidate();
                stateNote.textContent = 'Opened original not attested; approval locked.';
                return;
              }
              attestedRow = row;
              stateNote.textContent = 'Original opened and attested · select a human review decision.';
              if (approve && !approve.__persistentlyDisabled) approve.disabled = false;
              if (reject && !reject.__persistentlyDisabled) reject.disabled = false;
            }, member);
            card.append(rowChoices, inspect);
            if (approve && reject) card.append(approve, reject);
            card.append(stateNote);
            section.append(card);
          }
        } else if (typeof hooks.onClusterOpen === 'function') {
          for (const key of group.source_qualified_clips.slice(0, 24)) {
            if (typeof key === 'string' && key.length <= 240)
              section.append(invoke(section, 'Inspect ' + key,
                () => hooks.onClusterOpen(group, key), group));
          }
        }
        if (typeof hooks.onClusterName === 'function')
          section.append(invoke(section, 'Name after review', hooks.onClusterName, group));
        host.append(section);
      }
    }
    return {visible: matches.length, provisional_groups: waiting.length};
  }
  async function connect(host, options) {
    /* Secure bridge into the existing People review shell:
     * - relay is the already-authenticated C720PSecureRelay
     * - onOpen must OPEN the original and obtain a session-bound attestation
     * - the backend independently verifies the opaque opened_ticket
     */
    if (!options || !options.relay || typeof options.relay.fetch !== 'function' ||
        typeof options.onOpen !== 'function')
      throw Error('Authenticated relay and original-media reviewer required');
    const relay = options.relay;
    const opened = new Map();
    const key = row => row.folder_id + '/' + row.source_qualified_clip_id +
      '/' + row.media_revision + '/' + row.media_sha256;
    const saved = options.onSaved;
    let current = null;
    async function send(action, row) {
      const ticket = opened.get(key(row));
      if (!ticket) throw Error('Inspect and attest this original before reviewing.');
      if (!current || !Number.isSafeInteger(current.journal_revision) ||
          typeof current.feature_snapshot_revision !== 'string' ||
          !current.feature_snapshot_revision)
        throw Error('Review revision unavailable');
      const request = {
        action, source: row.source, clip_id: row.clip_id,
        folder_id: row.folder_id, media_sha256: row.media_sha256,
        media_revision: row.media_revision,
        journal_revision: current.journal_revision,
        feature_snapshot_revision: current.feature_snapshot_revision,
        opened_ticket: ticket, human_confirmed: true
      };
      const response = await relay.fetch('/new/api/folder-suggestions/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-S9-Folder-Suggestion-Intent': 'human-folder-suggestions-v1'
        },
        body: JSON.stringify(request)
      });
      const outcome = await response.json();
      if (!response.ok || outcome.ok !== true || outcome.persisted !== true ||
          outcome.media_verified !== true ||
          outcome.status !== (action === 'approve' ? 'approved' : 'rejected'))
        throw Error(outcome.error || 'Human review was not committed.');
      opened.delete(key(row));
      return outcome;
    }
    async function refresh() {
      const response = await relay.fetch('/new/api/folder-suggestions', {cache:'no-store'});
      const snapshot = await response.json();
      if (!response.ok) {
        host.replaceChildren(element('p',
          'Verified folder rankings unavailable. Existing manual review is unaffected.'));
        return {visible: 0};
      }
      current = snapshot;
      const narrowed = Object.assign({}, snapshot, {
        matches: (snapshot.matches || []).filter(row =>
          !options.folderId || row.folder_id === options.folderId),
        provisional_clusters: options.showProvisional === false ? [] :
          snapshot.provisional_clusters
      });
      return render(host, narrowed, {
        onOpen: async row => {
          const proof = await options.onOpen(row);
          if (proof && proof.verified === true &&
              proof.media_sha256 === row.media_sha256 &&
              proof.media_revision === row.media_revision &&
              typeof proof.opened_ticket === 'string' &&
              proof.opened_ticket.length >= 10) {
            opened.set(key(row), proof.opened_ticket);
          }
          return proof;
        },
        onApprove: row => send('approve', row),
        onReject: row => send('reject', row),
        preferredFolder: options.folderId,
        onClusterOpen: options.onClusterOpen,
        onClusterName: options.onClusterName,
        onSaved: result => {
          if (typeof saved === 'function') saved(result);
          Promise.resolve().then(refresh).catch(() => {
            host.replaceChildren(element('p',
              'Decision saved; refresh the review queue before continuing.'));
          });
        }
      });
    }
    return refresh();
  }
  root.FolderSuggestionCards = Object.freeze({render, safeMatch, connect});
})(typeof window !== 'undefined' ? window : globalThis);
