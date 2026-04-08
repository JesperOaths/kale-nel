(function (global) {
  const RPC = global.GEJAST_RPC_CONTRACT;
  const CTX = global.GEJAST_SCOPE_CONTEXT;

  async function syncPresence({ endpoint, p256dh, auth, pagePath, permission, standalone }) {
    const payload = {
      session_token: CTX.getPlayerSessionToken(),
      endpoint_input: endpoint,
      p256dh_input: p256dh,
      auth_input: auth,
      page_path_input: pagePath || CTX.pagePath(),
      permission_input: permission,
      standalone_input: !!standalone,
      site_scope_input: CTX.getScope()
    };

    return RPC.callContractWriter('contract_push_presence_write_v1', payload, () => Promise.all([
      RPC.callRpc('register_web_push_subscription', {
        session_token: payload.session_token,
        endpoint_input: payload.endpoint_input,
        p256dh_input: payload.p256dh_input,
        auth_input: payload.auth_input,
        user_agent_input: navigator.userAgent || '',
        permission_input: payload.permission_input
      }),
      RPC.callRpc('touch_active_web_push_presence', payload)
    ]).then(([registerResult, touchResult]) => ({
      register_result: registerResult,
      touch_result: touchResult,
      page_path: payload.page_path_input,
      site_scope: payload.site_scope_input
    })));
  }

  async function queueSelfTest() {
    return RPC.callRpc((global.GEJAST_CONFIG || {}).WEB_PUSH_TEST_RPC || 'queue_test_web_push', {
      session_token: CTX.getPlayerSessionToken()
    });
  }

  async function adminList({ activeMinutes = 5 }) {
    return RPC.callContract('contract_push_admin_read_v1', {
      admin_session_token: CTX.getAdminSessionToken(),
      active_minutes: activeMinutes,
      site_scope_input: CTX.getScope()
    }, () => RPC.callRpc((global.GEJAST_CONFIG || {}).ADMIN_ACTIVE_PUSH_LIST_RPC || 'admin_get_active_web_push_presence', {
      admin_session_token: CTX.getAdminSessionToken(),
      active_minutes: activeMinutes,
      site_scope_input: CTX.getScope()
    }));
  }

  async function queueAdminPush({ title, body, targetUrl, activeMinutes = 5 }) {
    return RPC.callContractWriter('contract_push_admin_write_v1', {
      admin_session_token: CTX.getAdminSessionToken(),
      title_input: title,
      body_input: body,
      target_url_input: targetUrl,
      active_minutes: activeMinutes,
      site_scope_input: CTX.getScope()
    }, () => RPC.callRpc((global.GEJAST_CONFIG || {}).ADMIN_ACTIVE_PUSH_RPC || 'admin_queue_active_web_push', {
      admin_session_token: CTX.getAdminSessionToken(),
      title_input: title,
      body_input: body,
      target_url_input: targetUrl,
      active_minutes: activeMinutes,
      site_scope_input: CTX.getScope()
    }));
  }

  global.GEJAST_PUSH_CONTRACT = {
    syncPresence,
    queueSelfTest,
    adminList,
    queueAdminPush
  };
})(window);
