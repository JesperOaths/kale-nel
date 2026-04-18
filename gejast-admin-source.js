(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_ADMIN_SOURCE = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const RPC = root.GEJAST_ADMIN_RPC;
  const REQUEUE_OVERRIDE_KEY = 'gejast_recent_requeues_v1';
  const REQUEUE_OVERRIDE_TTL_MS = 15 * 60 * 1000;
  const CLAIMS_CACHE_KEY = 'gejast_admin_claims_bundle_v4';
  const FORCED_MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/lruedi9n1e22eleu363kyk9ou46vezqy';
  try {
    root.GEJAST_CONFIG = Object.assign({}, root.GEJAST_CONFIG || {}, {
      MAKE_WEBHOOK_URL: FORCED_MAKE_WEBHOOK_URL
    });
  } catch (_) {}
  const BUCKETS = root.GEJAST_ADMIN_BUCKETS || {
    normalizeRows(rows) { return Array.isArray(rows) ? rows : []; },
    mergeHistoryWithExpired(history, expired) { return [...(Array.isArray(history) ? history : []), ...(Array.isArray(expired) ? expired : [])]; },
    countBuckets(requests, history, expired) {
      const rows = [...(Array.isArray(requests) ? requests : []), ...(Array.isArray(history) ? history : []), ...(Array.isArray(expired) ? expired : [])];
      const counts = { pending: 0, awaiting: 0, expired: 0, active: 0, rejected: 0 };
      rows.forEach((row) => {
        const state = String(row?.bucket || row?.status_bucket || row?.state_bucket || row?.state || row?.request_state || row?.status || '').toLowerCase();
        const key = state === 'approved_pending_activation' || state === 'pending_activation' ? 'awaiting' : state;
        if (counts[key] !== undefined) counts[key] += 1;
      });
      return counts;
    }
  };

  function directRpc(name, payload) {
    if (!RPC || typeof RPC.rpc !== 'function') throw new Error('GEJAST_ADMIN_RPC ontbreekt.');
    return RPC.rpc(name, payload || {});
  }

  function directPayload(payload) {
    return {
      admin_session_token: RPC.getSessionToken(),
      ...(payload || {}),
      site_scope_input: payload?.site_scope_input || RPC.getScope()
    };
  }

  function storage() {
    try { return root.sessionStorage || null; } catch (_) { return null; }
  }

  function readRequeueOverrides() {
    try {
      const store = storage();
      if (!store) return {};
      const raw = store.getItem(REQUEUE_OVERRIDE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const next = {};
      Object.entries(parsed || {}).forEach(([key, value]) => {
        const until = Number(value || 0);
        if (until > now) next[String(key)] = until;
      });
      if (JSON.stringify(parsed || {}) !== JSON.stringify(next)) {
        if (Object.keys(next).length) store.setItem(REQUEUE_OVERRIDE_KEY, JSON.stringify(next));
        else store.removeItem(REQUEUE_OVERRIDE_KEY);
      }
      return next;
    } catch (_) {
      return {};
    }
  }

  function writeRequeueOverrides(map) {
    try {
      const store = storage();
      if (!store) return;
      const next = map && typeof map === 'object' ? map : {};
      if (Object.keys(next).length) store.setItem(REQUEUE_OVERRIDE_KEY, JSON.stringify(next));
      else store.removeItem(REQUEUE_OVERRIDE_KEY);
    } catch (_) {}
  }

  function markRequestAwaitingAfterRequeue(requestId, ttlMs = REQUEUE_OVERRIDE_TTL_MS) {
    const id = String(requestId || '').trim();
    if (!id) return;
    const overrides = readRequeueOverrides();
    overrides[id] = Date.now() + Number(ttlMs || REQUEUE_OVERRIDE_TTL_MS);
    writeRequeueOverrides(overrides);
    try {
      const store = storage();
      if (store) store.removeItem(CLAIMS_CACHE_KEY);
    } catch (_) {}
  }

  function clearRequestAwaitingOverride(requestId) {
    const id = String(requestId || '').trim();
    if (!id) return;
    const overrides = readRequeueOverrides();
    if (!(id in overrides)) return;
    delete overrides[id];
    writeRequeueOverrides(overrides);
  }

  function isRequestAwaitingOverrideActive(requestId) {
    const id = String(requestId || '').trim();
    if (!id) return false;
    const overrides = readRequeueOverrides();
    return Number(overrides[id] || 0) > Date.now();
  }

  async function firstOf(attempts) {
    let lastError = null;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Geen bruikbare admin-RPC beschikbaar.');
  }

  function normalizePlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function normalizeMailResult(result, fallback = {}) {
    const raw = normalizePlainObject(result);
    const nested = normalizePlainObject(raw.mail_job || raw.job || raw.result || raw.data || raw.payload);
    const payload = normalizePlainObject(raw.payload || nested.payload);
    const fallbackData = normalizePlainObject(fallback);
    const activationUrl = String(
      raw.activation_url || raw.reset_url || raw.url || raw.activation_link || raw.link ||
      nested.activation_url || nested.reset_url || nested.url || nested.activation_link || nested.link ||
      payload.activation_url || payload.reset_url || payload.url || payload.activation_link || payload.link ||
      fallbackData.activation_url || fallbackData.reset_url || fallbackData.url || fallbackData.activation_link || fallbackData.link || ''
    ).trim();
    const recipientEmail = String(
      raw.requester_email || raw.recipient_email || raw.email ||
      nested.requester_email || nested.recipient_email || nested.email ||
      payload.requester_email || payload.recipient_email || payload.email ||
      fallbackData.requester_email || fallbackData.recipient_email || fallbackData.email || ''
    ).trim().toLowerCase();
    const displayName = String(
      raw.display_name || raw.recipient_name || raw.requested_name || raw.name ||
      nested.display_name || nested.recipient_name || nested.requested_name || nested.name ||
      payload.display_name || payload.recipient_name || payload.requested_name || payload.name ||
      fallbackData.display_name || fallbackData.recipient_name || fallbackData.requested_name || fallbackData.name || ''
    ).trim();
    const expiresAt = raw.expires_at || raw.activation_expires_at || raw.expires_on ||
      nested.expires_at || nested.activation_expires_at || nested.expires_on ||
      payload.expires_at || payload.activation_expires_at || payload.expires_on ||
      fallbackData.expires_at || fallbackData.activation_expires_at || fallbackData.expires_on || null;
    const merged = {
      ...fallbackData,
      ...raw,
      ...(Object.keys(nested).length ? nested : {}),
      activation_url: activationUrl || null,
      requester_email: recipientEmail || null,
      recipient_email: recipientEmail || null,
      email: recipientEmail || null,
      display_name: displayName || null,
      recipient_name: displayName || null,
      expires_at: expiresAt || null
    };
    const jobId = merged.job_id ?? merged.queue_job_id ?? merged.email_job_id ?? merged.outbound_email_job_id ?? merged.mail_job_id ?? merged.id ?? nested.job_id ?? nested.id ?? payload.job_id ?? payload.id ?? fallbackData.job_id ?? null;
    if (jobId != null && jobId !== '') merged.job_id = Number(jobId);
    return merged;
  }

  function extractMailJobId(result) {
    const merged = normalizeMailResult(result);
    return merged?.job_id ?? merged?.queue_job_id ?? merged?.email_job_id ?? merged?.outbound_email_job_id ?? merged?.mail_job_id ?? merged?.id ?? null;
  }

  async function findRecentActivationMailJob(requestId, recipientEmail) {
    let diagnostics = null;
    try {
      diagnostics = await loadMailDiagnostics();
    } catch (_) {
      diagnostics = null;
    }
    const rows = Array.isArray(diagnostics?.jobs) ? diagnostics.jobs : [];
    const wantedRequestId = requestId == null || requestId === '' ? null : Number(requestId);
    const wantedEmail = String(recipientEmail || '').trim().toLowerCase();
    const wantedStatuses = new Set(['queued', 'pending', 'processing']);
    const scored = rows.map((row) => {
      const payload = normalizePlainObject(row?.payload);
      const rowRequestId = Number(row?.related_claim_request_id ?? row?.request_id ?? payload?.request_id ?? NaN);
      const rowEmail = String(row?.recipient_email ?? row?.requester_email ?? payload?.requester_email ?? '').trim().toLowerCase();
      const status = String(row?.job_status ?? row?.status ?? '').trim().toLowerCase();
      const requestMatch = wantedRequestId != null && Number.isFinite(rowRequestId) && rowRequestId === wantedRequestId;
      const emailMatch = Boolean(wantedEmail && rowEmail && rowEmail === wantedEmail);
      if (!requestMatch && !emailMatch) return null;
      let score = 0;
      if (wantedStatuses.has(status)) score += 8;
      if (requestMatch) score += 10;
      if (emailMatch) score += 6;
      if (row?.id != null) score += Math.min(Number(row.id) / 1000000, 1);
      return { row, score, status };
    }).filter(Boolean).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.row?.id || 0) - Number(a.row?.id || 0);
    });
    const found = scored[0]?.row;
    return found ? normalizeMailResult(found, { request_id: requestId, requester_email: recipientEmail }) : null;
  }

  async function withRecoveredMailJob(result, context = {}) {
    const merged = normalizeMailResult(result, context);
    if (extractMailJobId(merged)) return merged;
    const recovered = await findRecentActivationMailJob(context.request_id ?? merged.request_id ?? null, context.requester_email || merged.requester_email || merged.recipient_email || '');
    return recovered ? normalizeMailResult({ ...merged, ...recovered }, context) : merged;
  }

  function activationBaseUrl() {
    if (root.GEJAST_ACCOUNT_LINKS && typeof root.GEJAST_ACCOUNT_LINKS.activationBaseUrl === 'function') {
      return root.GEJAST_ACCOUNT_LINKS.activationBaseUrl();
    }
    const url = new URL('./activate.html', root.location.href);
    const scope = RPC && typeof RPC.getScope === 'function' ? String(RPC.getScope() || '').toLowerCase() : 'friends';
    if (scope === 'family') url.searchParams.set('scope', 'family');
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) url.protocol = 'https:';
    return url.toString();
  }

  async function loadClaimsBundle(options) {
    const out = await RPC.secureRead('claims', {
      include_expired: options?.includeExpired !== false,
      site_scope_input: options?.scope || RPC.getScope()
    });
    const requests = BUCKETS.normalizeRows(out?.requests || []);
    const history = BUCKETS.normalizeRows(out?.history || []);
    const expired = BUCKETS.normalizeRows(out?.expired_queue || []);
    return {
      requests,
      history,
      expired_queue: expired,
      merged_history: BUCKETS.mergeHistoryWithExpired(history, expired),
      counts: out?.counts || BUCKETS.countBuckets(requests, history, expired)
    };
  }

  async function decideClaim(requestId, decision, reason) {
    return firstOf([
      () => RPC.secureWrite('claims', 'decide', {
        request_id_input: String(requestId),
        decision,
        decision_reason_input: reason || null
      }),
      () => directRpc('admin_claim_request_decide', directPayload({
        request_id_input: String(requestId),
        decision,
        decision_reason_input: reason || null
      }))
    ]);
  }

  async function approveAndSendActivation(requestId, reason) {
    const result = await firstOf([
      () => RPC.secureWrite('claims', 'approve_and_send_activation', {
        request_id_input: String(requestId),
        decision_reason_input: reason || null,
        base_url: activationBaseUrl()
      }),
      () => directRpc('admin_approve_and_send_activation_action', directPayload({
        request_id_input: String(requestId),
        decision_reason_input: reason || null,
        base_url: activationBaseUrl()
      }))
    ]);
    clearRequestAwaitingOverride(requestId);
    return withRecoveredMailJob(result, { request_id: String(requestId) });
  }

  async function requeueExpiredActivation(requestId) {
    const primary = await firstOf([
      () => RPC.secureWrite('claims', 'requeue_expired_activation', {
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }),
      () => directRpc('admin_requeue_expired_activation_action', directPayload({
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }))
    ]);
    markRequestAwaitingAfterRequeue(requestId);
    if (extractMailJobId(primary)) return primary;
    const resend = await resendPendingActivation(requestId);
    return Object.assign({}, primary || {}, resend || {}, {
      requeued_without_job: true,
      requeue_message: primary?.message || null
    });
  }

  async function resendPendingActivation(requestId) {
    const result = await firstOf([
      () => RPC.secureWrite('claims', 'resend_pending_activation', {
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }),
      () => directRpc('admin_resend_pending_activation_action', directPayload({
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      })),
      () => directRpc('admin_resend_expired_activation_action', directPayload({
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }))
    ]);
    return withRecoveredMailJob(result, { request_id: String(requestId) });
  }

  async function returnNameToClaimable(requestId, reason) {
    clearRequestAwaitingOverride(requestId);
    return firstOf([
      () => RPC.secureWrite('claims', 'return_name_to_claimable', {
        request_id_input: String(requestId),
        decision_reason_input: reason || null
      }),
      () => directRpc('admin_return_name_to_claimable_action', directPayload({
        request_id_input: String(requestId),
        decision_reason_input: reason || null
      }))
    ]);
  }

  async function createActivationLink(requestId) {
    const result = await firstOf([
      () => RPC.secureWrite('claims', 'create_activation_link', {
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }),
      () => directRpc('create_player_activation_link_action', directPayload({
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }))
    ]);
    return normalizeMailResult(result, { request_id: String(requestId) });
  }

  async function validateOutboundEmailJob(jobId, markFailed) {
    return firstOf([
      () => RPC.secureWrite('claims', 'validate_outbound_email_job', {
        job_id_input: Number(jobId),
        mark_failed_input: markFailed !== false
      }),
      () => directRpc('admin_validate_outbound_email_job', directPayload({
        job_id_input: Number(jobId),
        mark_failed_input: markFailed !== false
      }))
    ]);
  }

  async function revokePlayerAccess(requestId, reason) {
    clearRequestAwaitingOverride(requestId);
    return firstOf([
      () => RPC.secureWrite('claims', 'revoke_player_access', {
        request_id_input: String(requestId),
        decision_reason_input: reason || null
      }),
      () => directRpc('admin_revoke_player_access_action', directPayload({
        request_id_input: String(requestId),
        decision_reason_input: reason || null
      }))
    ]);
  }

  async function removePlayer(requestId, reason) {
    clearRequestAwaitingOverride(requestId);
    return firstOf([
      () => RPC.secureWrite('claims', 'remove_player', {
        request_id_input: String(requestId),
        decision_reason_input: reason || null
      }),
      () => directRpc('admin_remove_player_action', directPayload({
        request_id_input: String(requestId),
        decision_reason_input: reason || null
      }))
    ]);
  }

  async function queueActivationEmail(requestId, recipientEmail, recipientName, activationLink, playerId) {
    const result = await firstOf([
      () => RPC.secureWrite('claims', 'queue_activation_email', {
        request_id_input: String(requestId),
        base_url: activationBaseUrl(),
        recipient_email_input: recipientEmail,
        recipient_name_input: recipientName || null,
        activation_link_input: activationLink,
        player_id_input: playerId == null ? null : Number(playerId)
      }),
      () => directRpc('admin_queue_activation_email', directPayload({
        request_id_input: String(requestId),
        base_url: activationBaseUrl(),
        recipient_email_input: recipientEmail,
        recipient_name_input: recipientName || null,
        activation_link_input: activationLink,
        player_id_input: playerId == null ? null : Number(playerId)
      }))
    ]);
    return withRecoveredMailJob(result, { request_id: String(requestId), requester_email: recipientEmail, activation_url: activationLink, player_id: playerId == null ? null : Number(playerId) });
  }

  async function updateActivationEmailSubject(requestId, desiredSubject) {
    return firstOf([
      () => RPC.secureWrite('claims', 'set_activation_email_subject', {
        request_id_input: String(requestId),
        desired_subject: desiredSubject
      }),
      () => directRpc('admin_set_activation_email_subject_action', directPayload({
        request_id_input: String(requestId),
        desired_subject: desiredSubject
      }))
    ]);
  }

  async function reserveAllowedUsername(displayName, email, note) {
    return firstOf([
      () => RPC.secureWrite('reserved_names', 'reserve', {
        display_name_input: displayName,
        reserved_for_email_input: email || null,
        reserved_for_person_note_input: note || null
      }),
      () => directRpc('admin_reserve_allowed_username', directPayload({
        display_name_input: displayName,
        reserved_for_email_input: email || null,
        reserved_for_person_note_input: note || null
      }))
    ]);
  }

  async function removeAllowedUsername(id) {
    return firstOf([
      () => RPC.secureWrite('reserved_names', 'remove', {
        allowed_username_id_input: Number(id)
      }),
      () => directRpc('admin_remove_allowed_username', directPayload({
        allowed_username_id_input: Number(id)
      })),
      () => directRpc('admin_remove_allowed_username', directPayload({
        allowed_username_id: Number(id)
      })),
      () => directRpc('admin_remove_allowed_username', directPayload({
        id_input: Number(id)
      }))
    ]);
  }

  async function setPlayerGhostStatus(playerId, ghosted, reason) {
    return firstOf([
      () => RPC.secureWrite('reserved_names', 'set_ghost', {
        target_player_id: Number(playerId),
        ghosted: Boolean(ghosted),
        reason_input: reason || null
      }),
      () => directRpc('admin_set_player_ghost_status', directPayload({
        target_player_id: Number(playerId),
        ghosted: Boolean(ghosted),
        reason_input: reason || null
      }))
    ]);
  }

  async function loadReservedNames(options) {
    const out = await firstOf([
      () => RPC.secureRead('reserved_names', {
        include_archive: options?.includeArchive !== false,
        site_scope_input: options?.scope || RPC.getScope()
      }),
      () => directRpc('admin_get_allowed_usernames', directPayload({
        include_archive: options?.includeArchive !== false,
        site_scope_input: options?.scope || RPC.getScope()
      }))
    ]);
    return Array.isArray(out?.items) ? out.items : (Array.isArray(out) ? out : []);
  }

  async function loadPushDiagnostics(options) {
    return RPC.secureRead('push', {
      active_minutes: options?.activeMinutes || 5,
      site_scope_input: options?.scope || RPC.getScope()
    });
  }

  async function queueActivePush(title, body, targetUrl, activeMinutes, scope) {
    return RPC.secureWrite('push', 'queue', {
      title_input: title,
      body_input: body,
      target_url_input: targetUrl || null,
      active_minutes: Number(activeMinutes || 5),
      site_scope_input: scope || RPC.getScope()
    });
  }

  async function loadMailDiagnostics() {
    return firstOf([
      () => RPC.secureRead('mail', {}),
      () => directRpc('admin_get_mail_diagnostics', directPayload({}))
    ]);
  }

  async function loadAnalytics(rangeDays, recentLimit) {
    return RPC.secureRead('analytics', {
      range_days: Number(rangeDays || 7),
      recent_limit: Number(recentLimit || 80)
    });
  }

  async function loadMatchEditState(scope) {
    return RPC.secureRead('matches', {
      site_scope_input: scope || RPC.getScope()
    });
  }

  async function updateMatchPayload(gameType, clientMatchId, replacementPayload) {
    return RPC.secureWrite('matches', 'update_payload', {
      game_type_input: gameType,
      client_match_id_input: clientMatchId,
      replacement_payload: replacementPayload
    });
  }

  async function replaceMatchPlayerEverywhere(gameType, clientMatchId, oldName, newName, oldId, newId, scope) {
    return RPC.secureWrite('matches', 'replace_player', {
      game_type_input: gameType,
      client_match_id_input: clientMatchId,
      old_player_name_input: oldName,
      new_player_name_input: newName,
      old_player_id_input: oldId == null ? null : Number(oldId),
      new_player_id_input: newId == null ? null : Number(newId),
      site_scope_input: scope || RPC.getScope()
    });
  }

  async function deleteMatch(gameType, clientMatchId) {
    return RPC.secureWrite('matches', 'delete_match', {
      game_type_input: gameType,
      client_match_id_input: clientMatchId
    });
  }

  async function loadDrinksConsole() {
    return RPC.secureRead('drinks', {});
  }

  async function updateDrinkEventEntry(drinkEventId, nextStatus) {
    return RPC.secureWrite('drinks', 'update_event', {
      drink_event_id: Number(drinkEventId),
      next_status: nextStatus
    });
  }

  async function deleteDrinkEventEntry(drinkEventId) {
    return RPC.secureWrite('drinks', 'delete_event', {
      drink_event_id: Number(drinkEventId)
    });
  }

  async function updateDrinkSpeedAttemptEntry(attemptId, nextStatus) {
    return RPC.secureWrite('drinks', 'update_speed', {
      attempt_id: Number(attemptId),
      next_status: nextStatus
    });
  }

  async function deleteDrinkSpeedAttemptEntry(attemptId) {
    return RPC.secureWrite('drinks', 'delete_speed', {
      attempt_id: Number(attemptId)
    });
  }

  async function batchUpdateDrinkEventEntries(ids, nextStatus) {
    return RPC.secureWrite('drinks', 'batch_update_events', {
      ids,
      next_status: nextStatus
    });
  }

  async function batchUpdateDrinkSpeedAttemptEntries(ids, nextStatus) {
    return RPC.secureWrite('drinks', 'batch_update_speed', {
      ids,
      next_status: nextStatus
    });
  }

  async function fetchOutboundEmailJobWebhookPayload(jobId) {
    if (!jobId) return null;
    try {
      return await directRpc('admin_get_outbound_email_job_webhook_payload', directPayload({
        job_id_input: Number(jobId)
      }));
    } catch (_) {
      return null;
    }
  }

  async function fetchLatestValidOutboundEmailJobWebhookPayload(requestId, recipientEmail) {
    try {
      return await directRpc('admin_get_latest_valid_outbound_email_job_webhook_payload', directPayload({
        request_id_input: requestId == null || requestId === '' ? null : Number(requestId),
        recipient_email_input: recipientEmail || null
      }));
    } catch (_) {
      return null;
    }
  }

  return {
    loadClaimsBundle,
    decideClaim,
    approveAndSendActivation,
    requeueExpiredActivation,
    resendPendingActivation,
    returnNameToClaimable,
    createActivationLink,
    validateOutboundEmailJob,
    revokePlayerAccess,
    removePlayer,
    queueActivationEmail,
    updateActivationEmailSubject,
    normalizeMailResult,
    extractMailJobId,
    findRecentActivationMailJob,
    withRecoveredMailJob,
    fetchOutboundEmailJobWebhookPayload,
    fetchLatestValidOutboundEmailJobWebhookPayload,
    markRequestAwaitingAfterRequeue,
    clearRequestAwaitingOverride,
    isRequestAwaitingOverrideActive,
    reserveAllowedUsername,
    removeAllowedUsername,
    setPlayerGhostStatus,
    loadReservedNames,
    loadPushDiagnostics,
    queueActivePush,
    loadMailDiagnostics,
    loadAnalytics,
    loadMatchEditState,
    updateMatchPayload,
    replaceMatchPlayerEverywhere,
    deleteMatch,
    loadDrinksConsole,
    updateDrinkEventEntry,
    deleteDrinkEventEntry,
    updateDrinkSpeedAttemptEntry,
    deleteDrinkSpeedAttemptEntry,
    batchUpdateDrinkEventEntries,
    batchUpdateDrinkSpeedAttemptEntries
  };
});
