(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_ADMIN_SOURCE = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const RPC = root.GEJAST_ADMIN_RPC;
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
    return firstOf([
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
  }

  function extractMailJobId(result) {
    return result?.job_id ?? result?.queue_job_id ?? result?.email_job_id ?? result?.outbound_email_job_id ?? result?.id ?? null;
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
    if (extractMailJobId(primary)) return primary;
    const resend = await resendPendingActivation(requestId);
    return Object.assign({}, primary || {}, resend || {}, {
      requeued_without_job: true,
      requeue_message: primary?.message || null
    });
  }

  async function resendPendingActivation(requestId) {
    return firstOf([
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
  }

  async function returnNameToClaimable(requestId, reason) {
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
    return firstOf([
      () => RPC.secureWrite('claims', 'create_activation_link', {
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }),
      () => directRpc('create_player_activation_link_action', directPayload({
        request_id_input: String(requestId),
        base_url: activationBaseUrl()
      }))
    ]);
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
    return firstOf([
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
