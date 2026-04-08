(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_ADMIN_SOURCE = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const RPC = root.GEJAST_ADMIN_RPC;
  const BUCKETS = root.GEJAST_ADMIN_BUCKETS;

  function activationBaseUrl() {
    const url = new URL('./activate.html', root.location.href);
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
    return RPC.secureWrite('claims', 'decide', {
      request_id_input: String(requestId),
      decision,
      decision_reason_input: reason || null
    });
  }

  async function approveAndSendActivation(requestId, reason) {
    return RPC.secureWrite('claims', 'approve_and_send_activation', {
      request_id_input: String(requestId),
      decision_reason_input: reason || null,
      base_url: activationBaseUrl()
    });
  }

  async function requeueExpiredActivation(requestId) {
    return RPC.secureWrite('claims', 'requeue_expired_activation', {
      request_id_input: String(requestId),
      base_url: activationBaseUrl()
    });
  }

  async function resendPendingActivation(requestId) {
    return RPC.secureWrite('claims', 'resend_pending_activation', {
      request_id_input: String(requestId),
      base_url: activationBaseUrl()
    });
  }

  async function returnNameToClaimable(requestId, reason) {
    return RPC.secureWrite('claims', 'return_name_to_claimable', {
      request_id_input: String(requestId),
      decision_reason_input: reason || null
    });
  }

  async function createActivationLink(requestId) {
    return RPC.secureWrite('claims', 'create_activation_link', {
      request_id_input: String(requestId),
      base_url: activationBaseUrl()
    });
  }

  async function validateOutboundEmailJob(jobId, markFailed) {
    return RPC.secureWrite('claims', 'validate_outbound_email_job', {
      job_id_input: Number(jobId),
      mark_failed_input: markFailed !== false
    });
  }

  async function revokePlayerAccess(requestId, reason) {
    return RPC.secureWrite('claims', 'revoke_player_access', {
      request_id_input: String(requestId),
      decision_reason_input: reason || null
    });
  }

  async function removePlayer(requestId, reason) {
    return RPC.secureWrite('claims', 'remove_player', {
      request_id_input: String(requestId),
      decision_reason_input: reason || null
    });
  }

  async function queueActivationEmail(requestId, recipientEmail, recipientName, activationLink, playerId) {
    return RPC.secureWrite('claims', 'queue_activation_email', {
      request_id_input: String(requestId),
      base_url: activationBaseUrl(),
      recipient_email_input: recipientEmail,
      recipient_name_input: recipientName || null,
      activation_link_input: activationLink,
      player_id_input: playerId == null ? null : Number(playerId)
    });
  }

  async function updateActivationEmailSubject(requestId, desiredSubject) {
    return RPC.secureWrite('claims', 'set_activation_email_subject', {
      request_id_input: String(requestId),
      desired_subject: desiredSubject
    });
  }

  async function reserveAllowedUsername(displayName, email, note) {
    return RPC.secureWrite('reserved_names', 'reserve', {
      display_name_input: displayName,
      reserved_for_email_input: email || null,
      reserved_for_person_note_input: note || null
    });
  }

  async function removeAllowedUsername(id) {
    return RPC.secureWrite('reserved_names', 'remove', {
      allowed_username_id_input: Number(id)
    });
  }

  async function setPlayerGhostStatus(playerId, ghosted, reason) {
    return RPC.secureWrite('reserved_names', 'set_ghost', {
      target_player_id: Number(playerId),
      ghosted: Boolean(ghosted),
      reason_input: reason || null
    });
  }

  async function loadReservedNames(options) {
    const out = await RPC.secureRead('reserved_names', {
      include_archive: options?.includeArchive !== false,
      site_scope_input: options?.scope || RPC.getScope()
    });
    return Array.isArray(out?.items) ? out.items : [];
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
    return RPC.secureRead('mail', {});
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
