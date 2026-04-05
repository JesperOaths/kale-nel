
const SUPABASE_URL = "https://uiqntazgnrxwliaidkmy.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
    const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;
    const MAKE_WEBHOOK_URL = (window.GEJAST_CONFIG && window.GEJAST_CONFIG.MAKE_WEBHOOK_URL) || "";
    const ADMIN_SESSION_KEY = "jas_admin_session_v8";
    let lastRequests = [];
    let lastHistory = [];
    let historyFilter = "all";
    let currentAdminView = "pending";

    function rpcHeaders() { return { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", Accept: "application/json" }; }
    async function parseResponse(res) { const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || `HTTP ${res.status}`); } if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`); return data; }
    function getAdminSessionToken() { return sessionStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(ADMIN_SESSION_KEY); }
    function setAdminSessionToken(token, persist = false) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, token);
      if (persist) localStorage.setItem(ADMIN_SESSION_KEY, token); else localStorage.removeItem(ADMIN_SESSION_KEY);
    }
    function clearAdminSessionToken() { sessionStorage.removeItem(ADMIN_SESSION_KEY); localStorage.removeItem(ADMIN_SESSION_KEY); }
    function setStatus(text) { document.getElementById("status").textContent = text || ""; }
    function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
    function showLoggedOut() { document.getElementById("loginView").classList.remove("hidden"); document.getElementById("adminView").classList.add("hidden"); document.getElementById("workspace").classList.add("hidden"); document.getElementById("adminTabsCard").classList.add("hidden"); document.getElementById("adminToolbar").classList.add("hidden"); document.getElementById("statsGrid").classList.add("hidden"); document.getElementById("requestsCard").classList.add("hidden"); document.getElementById("historyCard").classList.add("hidden"); document.getElementById("approvedUsersCard").classList.add("hidden"); document.getElementById("requestsList").innerHTML = ""; document.getElementById("historyList").innerHTML = ""; document.getElementById("approvedUsersList").innerHTML = ""; document.getElementById("adminTabs").innerHTML = ""; }
    function showLoggedIn(username) { document.getElementById("loginView").classList.add("hidden"); document.getElementById("adminView").classList.remove("hidden"); document.getElementById("workspace").classList.remove("hidden"); document.getElementById("adminTabsCard").classList.remove("hidden"); document.getElementById("adminToolbar").classList.remove("hidden"); document.getElementById("statsGrid").classList.remove("hidden"); document.getElementById("requestsCard").classList.remove("hidden"); document.getElementById("historyCard").classList.remove("hidden"); document.getElementById("approvedUsersCard").classList.remove("hidden"); document.getElementById("welcomeText").textContent = `Ingelogd als ${username}`; }

    function formatDateTime(value) { return value ? new Date(value).toLocaleString('nl-NL') : 'Onbekend'; }
    function getActivationBaseUrl() { const url = new URL('./activate.html', window.location.href); if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) url.protocol = 'https:'; return url.toString(); }
    function activationPanelHtml(req) {
      return `
        <div class="activation-tools hidden" id="activation-tools-${req.id}">
          <div><strong>Activatielink klaarzetten</strong></div>
          <div class="muted" style="margin-top:4px;">Genereer, kopieer of queue de activatielink.</div>
          <div class="activation-meta">
            ${metaBox('E-mail', req.requester_email || 'Onbekend')}
            <div class="data-box"><span class="label">Activatie verloopt</span><span id="activation-expires-${req.id}">Nog niet gegenereerd</span></div>
          </div>
          <div class="activation-link-box" id="activation-url-${req.id}">Nog geen activatielink gegenereerd.</div>
          <div class="action-row">
            <button class="copy-btn" type="button" data-copy-activation data-id="${req.id}">Kopieer activatielink</button>
            <button class="mail-btn" type="button" data-mail-activation data-id="${req.id}">Mailconcept</button>
          </div>
        </div>
      `;
    }

    function metaBox(label, value) {
      return `<div class="data-box"><span class="label">${escapeHtml(label)}</span>${escapeHtml(value || 'Onbekend')}</div>`;
    }

    function extractMeta(meta) {
      const m = meta && typeof meta === 'object' ? meta : {};
      return {
        language: m.language || (Array.isArray(m.languages) ? m.languages.join(', ') : ''),
        timezone: m.timezone || '',
        platform: m.platform || '',
        user_agent: m.user_agent || '',
        screen: m.screen || '',
        viewport: m.viewport || '',
        referrer: m.referrer || '',
        page_url: m.page_url || '',
        color_scheme: m.color_scheme || '',
        max_touch_points: m.max_touch_points ?? ''
      };
    }


    function hasPin(req) {
      return Boolean(req.has_pin ?? req.pin_is_set ?? req.player_has_pin ?? req.pin_set ?? req.activated ?? false);
    }
    function statusMeta(req, includeDecision = false) {
      const decision = String(req.decision || '').toLowerCase();
      if (hasPin(req)) return { cls: 'state-activated', label: 'Activated' };
      if (decision === 'rejected' || req.approved === false) return { cls: 'state-rejected', label: 'Afgewezen' };
      if (decision === 'approved' || req.approved === true || req.active === true) return { cls: includeDecision ? 'state-awaiting' : 'state-approved', label: includeDecision ? 'Awaiting activation' : 'Approved' };
      return { cls: 'state-pending', label: 'Openstaand' };
    }

    function isApprovedLike(req) {
      const decision = String(req.decision || '').toLowerCase();
      return decision === 'approved' || req.approved === true || req.active === true || hasPin(req);
    }

    function renderStats(requests, history) {
      const pending = (requests || []).length;
      const approved = (history || []).filter((item) => isApprovedLike(item) && !hasPin(item)).length;
      const activated = (history || []).filter((item) => hasPin(item)).length;
      const rejected = (history || []).filter((item) => String(item.decision || '').toLowerCase() === 'rejected' || item.approved === false).length;
      document.getElementById('statPending').textContent = String(pending);
      document.getElementById('statApproved').textContent = String(approved);
      document.getElementById('statActivated').textContent = String(activated);
      document.getElementById('statRejected').textContent = String(rejected);
    }

    function approvedUserCardHtml(item) {
      const activationState = hasPin(item) ? 'Actief' : 'Wacht op activatie';
      const decided = item.decided_at ? new Date(item.decided_at).toLocaleString('nl-NL') : 'Onbekend';
      return `${requestHtml(item, true)}
        <div class="request-grid" style="margin-top:12px;">
          ${metaBox('Status gebruiker', activationState)}
          ${metaBox('Beslist op', decided)}
        </div>
        <div class="compact-actions">
          <button class="link-btn" type="button" data-generate-activation data-id="${item.id}">Regenerate-link</button>
          <button class="reject-btn danger-btn" type="button" data-revoke-access data-id="${item.id}">Goedkeuring intrekken</button>
        </div>
        <div class="inline-msg" id="approved-msg-${item.id}">Gebruiker actief in admin-overzicht.</div>
        ${activationPanelHtml(item)}`;
    }

    function requestHtml(req, includeDecision = false) {
      const noteHtml = req.requester_note ? escapeHtml(req.requester_note).replace(/\n/g, "<br>") : "<span class='muted'>Geen toelichting</span>";
      const reasonHtml = req.decision_reason ? escapeHtml(req.decision_reason).replace(/\n/g, "<br>") : "<span class='muted'>Geen reden opgegeven</span>";
      const meta = extractMeta(req.requester_meta);
      const status = statusMeta(req, includeDecision);
      return `
        <div class="request-head">
          <div>
            <div class="state-badge ${status.cls}">${status.label}</div>
            <strong>${escapeHtml(req.display_name)}</strong><br>
            <span class="muted">Aangevraagd op:</span> ${req.created_at ? new Date(req.created_at).toLocaleString('nl-NL') : 'Onbekend'}<br>
            ${includeDecision ? `<span class="muted">Beslissing:</span> ${escapeHtml(req.decision || '')}<br>` : ''}
          </div>
        </div>
        <div style="margin-top:10px;">${noteHtml}</div>
        <div class="request-grid">
          ${metaBox('E-mail', req.requester_email || 'Onbekend')}
          ${metaBox('Taal', meta.language || 'Onbekend')}
          ${metaBox('Tijdzone', meta.timezone || 'Onbekend')}
          ${metaBox('Platform', meta.platform || 'Onbekend')}
          ${metaBox('Touch punten', String(meta.max_touch_points || 0))}
          ${metaBox('Scherm', meta.screen || 'Onbekend')}
          ${metaBox('Viewport', meta.viewport || 'Onbekend')}
          ${metaBox('Referrer', meta.referrer || 'Direct / onbekend')}
        </div>
        <details>
          <summary>Browser- en verzoekdetails</summary>
          <pre>${escapeHtml(JSON.stringify(req.requester_meta || {}, null, 2))}</pre>
        </details>
        ${includeDecision ? `<div style="margin-top:12px;"><span class="label">Reden besluit</span><div>${reasonHtml}</div></div>` : ''}
      `;
    }

    function renderRequests(requests) {
      const root = document.getElementById("requestsList");
      root.innerHTML = "";
      if (!requests || requests.length === 0) { root.innerHTML = `<p class="muted">Geen openstaande aanvragen.</p>`; return; }
      const q = (document.getElementById('requestSearch')?.value || '').trim().toLowerCase();
      (requests || []).filter((req) => {
        if (!q) return true;
        return [req.display_name, req.requester_email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      }).forEach((req) => {
        const div = document.createElement('div');
        div.className = 'request';
        div.innerHTML = `${requestHtml(req)}<div style="margin-top:12px;"><textarea class="decision-reason" data-id="${req.id}" placeholder="Reden (optioneel)"></textarea><div class="action-row"><button class="approve-btn" type="button" data-id="${req.id}" data-decision="approved">Goedkeuren</button><button class="reject-btn" type="button" data-id="${req.id}" data-decision="rejected">Afwijzen</button><button class="link-btn" type="button" data-generate-activation data-id="${req.id}">Maak activatielink</button></div><div class="inline-msg" id="request-msg-${req.id}">Klaar om te beoordelen.</div>${activationPanelHtml(req)}</div>`;
        root.appendChild(div);
      });
      document.querySelectorAll('[data-decision]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const requestId = Number(btn.dataset.id);
          const decision = btn.dataset.decision;
          const reasonEl = document.querySelector(`.decision-reason[data-id="${requestId}"]`);
          const decisionReason = reasonEl ? reasonEl.value.trim() : '';
          const msg = document.getElementById(`request-msg-${requestId}`);
          try {
            if (msg) { msg.textContent = 'Besluit opslaan...'; msg.className = 'inline-msg'; }
            await decideRequest(requestId, decision, decisionReason || null);
            if (decision === 'approved') {
              let mailMessage = ' Aanvraag is goedgekeurd en activatielink staat klaar.';
              const linkData = await createActivationLink(requestId);
              showActivationPanel(requestId, linkData);
              try {
                const queued = await sendActivationEmail(requestId);
                mailMessage = ` Aanvraag is goedgekeurd, activatielink is gemaakt, mailjob #${queued?.job_id ?? queued?.id ?? '?'} is gequeued en Make is gepingd.`;
              } catch (mailErr) {
                mailMessage = ` Aanvraag is goedgekeurd en activatielink is gemaakt, maar queue/webhook mislukte: ${mailErr instanceof Error ? mailErr.message : mailErr}`;
              }
              if (msg) { msg.textContent = 'Wacht op activatie.' + mailMessage; msg.className = 'inline-msg ok'; }
            } else if (msg) {
              msg.textContent = 'Afwijzing opgeslagen.'; msg.className = 'inline-msg ok';
            }
            await refreshAdminLists();
            setStatus(decision === 'approved' ? 'Aanvraag goedgekeurd.' : 'Aanvraag afgewezen.');
          } catch (err) {
            const rawMessage = err instanceof Error ? err.message : 'Er ging iets mis';
            if (msg) { msg.textContent = rawMessage === 'Failed to fetch' ? 'Netwerk/CORS-fout bij contact met Supabase.' : rawMessage; msg.className = 'inline-msg error'; }
            setStatus(rawMessage === 'Failed to fetch' ? 'Netwerk/CORS-fout bij contact met Supabase.' : rawMessage);
          }
        });
      });
       document.querySelectorAll('[data-generate-activation]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const requestId = Number(btn.dataset.id);
          const msg = document.getElementById(`request-msg-${requestId}`) || document.getElementById(`activation-msg-${requestId}`);
          try {
            if (msg) { msg.textContent = 'Activatielink maken...'; msg.className = 'inline-msg'; }
            const linkData = await createActivationLink(requestId);
            showActivationPanel(requestId, linkData);
            if (msg) { msg.textContent = 'Activatielink gemaakt.'; msg.className = 'inline-msg ok'; }
            setStatus('Activatielink gemaakt.');
          } catch (err) {
            const rawMessage = err instanceof Error ? err.message : 'Er ging iets mis';
            if (msg) { msg.textContent = rawMessage === 'Failed to fetch' ? 'Netwerk/CORS-fout bij contact met Supabase.' : rawMessage; msg.className = 'inline-msg error'; }
            setStatus(rawMessage === 'Failed to fetch' ? 'Netwerk/CORS-fout bij contact met Supabase.' : rawMessage);
          }
        });
      });
      document.querySelectorAll('[data-copy-activation]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const requestId = Number(btn.dataset.id);
          const urlEl = document.getElementById(`activation-url-${requestId}`);
          const url = urlEl?.dataset.url;
          if (!url) { setStatus('Maak eerst een activatielink.'); return; }
          try {
            await navigator.clipboard.writeText(url);
            const msg = document.getElementById(`activation-msg-${requestId}`); if (msg) { msg.textContent = 'Gekopieerd.'; msg.className = 'inline-msg ok'; } setStatus('Activatielink gekopieerd.');
          } catch {
            setStatus('Kopiëren lukte niet automatisch. Selecteer de link handmatig.');
          }
        });
      });
      document.querySelectorAll('[data-mail-activation]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const requestId = Number(btn.dataset.id);
          const panel = document.getElementById(`activation-tools-${requestId}`);
          const email = panel?.dataset.email || '';
          const displayName = panel?.dataset.displayName || '';
          const expiresAt = panel?.dataset.expiresAt || '';
          const url = panel?.dataset.url || '';
          if (!email || !url) { setStatus('Maak eerst een activatielink.'); return; }
          const subject = 'Activeer je account voor Wordt er gejast';
          const body = [
            `Hoi ${displayName || 'daar'},`,
            '',
            'Je account is goedgekeurd.',
            'Gebruik deze activatielink om je 4-cijferige pincode in te stellen:',
            '',
            url,
            '',
            expiresAt ? `Deze link verloopt op ${formatDateTime(expiresAt)}.` : '',
            '',
            'Groet,',
            'Wordt er gejast'
          ].filter(Boolean).join('\n');
          const msg = document.getElementById(`activation-msg-${requestId}`); if (msg) { msg.textContent = 'E-mailconcept geopend.'; msg.className = 'inline-msg ok'; } window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        });
      });
      document.querySelectorAll('[data-send-activation]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const requestId = Number(btn.dataset.id);
          const msg = document.getElementById(`activation-msg-${requestId}`);
          try {
            if (msg) { msg.textContent = 'Mailjob in wachtrij zetten...'; msg.className = 'inline-msg'; }
            await sendActivationEmail(requestId);
            if (msg) { msg.textContent = 'Mailjob in wachtrij gezet. Make/Resend neemt het over.'; msg.className = 'inline-msg ok'; }
          } catch (err) {
            if (msg) { msg.textContent = err instanceof Error ? err.message : 'Mailjob kon niet in de wachtrij worden gezet'; msg.className = 'inline-msg error'; }
          }
        });
      });
    }

    function renderHistory(items) {
      const root = document.getElementById('historyList');
      root.innerHTML = '';
      const q = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
      const filtered = (items || []).filter((item) => {
        const state = statusMeta(item, true).label.toLowerCase();
        const stateKey = statusMeta(item, true).cls.replace('state-','');
        const matchFilter = historyFilter === 'all' || stateKey === historyFilter;
        const matchQuery = !q || [item.display_name, item.requester_email, item.decision].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
        return matchFilter && matchQuery;
      });
      if (filtered.length === 0) { root.innerHTML = `<p class="muted">Geen resultaten.</p>`; return; }
      filtered.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'request';
        const canLink = String(item.decision || '').toLowerCase() === 'approved' || item.approved === true || item.active === true || hasPin(item);
        div.innerHTML = `${requestHtml(item, true)}<div class="muted" style="margin-top:10px;">${item.decided_at ? new Date(item.decided_at).toLocaleString('nl-NL') : ''}</div>${canLink ? `<div class="compact-actions"><button class="link-btn" type="button" data-generate-activation data-id="${item.id}">Regenerate-link</button><button class="reject-btn danger-btn" type="button" data-revoke-access data-id="${item.id}">Toegang intrekken</button></div>${activationPanelHtml(item)}` : ''}<div class="inline-msg" id="history-msg-${item.id}">Geschiedenisitem.</div>`;
        root.appendChild(div);
      });
      const historyPills = document.querySelectorAll('[data-history-filter]'); if (historyPills.length) historyPills.forEach((btn)=>{ btn.classList.toggle('active', btn.dataset.historyFilter===historyFilter); });
      document.querySelectorAll('[data-revoke-access]').forEach((btn)=> {
        btn.addEventListener('click', async ()=> {
          const requestId = Number(btn.dataset.id);
          const msg = document.getElementById(`history-msg-${requestId}`);
          try {
            if (msg) { msg.textContent = 'Toegang intrekken...'; msg.className = 'inline-msg'; }
            await revokePlayerAccess(requestId, null);
            await refreshAdminLists();
            if (msg) { msg.textContent = 'Toegang ingetrokken.'; msg.className = 'inline-msg ok'; }
          } catch (err) {
            if (msg) { msg.textContent = err instanceof Error ? err.message : 'Intrekken mislukt'; msg.className = 'inline-msg error'; }
          }
        });
      });
      document.querySelectorAll('[data-generate-activation]').forEach((btn) => {
        if (btn.dataset.bound) return; btn.dataset.bound='1';
        btn.addEventListener('click', async () => {
          const requestId = Number(btn.dataset.id);
          const msg = document.getElementById(`history-msg-${requestId}`) || document.getElementById(`activation-msg-${requestId}`);
          try {
            if (msg) { msg.textContent = 'Activatielink maken...'; msg.className = 'inline-msg'; }
            const linkData = await createActivationLink(requestId);
            showActivationPanel(requestId, linkData);
            if (msg) { msg.textContent = 'Activatielink gemaakt.'; msg.className = 'inline-msg ok'; }
          } catch (err) {
            if (msg) { msg.textContent = err instanceof Error ? err.message : 'Activatielink maken mislukt'; msg.className = 'inline-msg error'; }
          }
        });
      });
      document.querySelectorAll('[data-copy-activation], [data-mail-activation], [data-send-activation]').forEach((el)=>{});
    }

    function renderApprovedUsers(items) {
      const root = document.getElementById('approvedUsersList');
      root.innerHTML = '';
      const q = (document.getElementById('approvedSearch')?.value || '').trim().toLowerCase();
      const approvedItems = (items || []).filter((item) => currentAdminView === 'active' ? hasPin(item) : isApprovedLike(item)).filter((item) => {
        if (!q) return true;
        return [item.display_name, item.requester_email, item.decision].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      });
      if (approvedItems.length === 0) { root.innerHTML = `<div class="empty-state">Geen goedgekeurde gebruikers gevonden.</div>`; return; }
      approvedItems.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'request';
        div.innerHTML = approvedUserCardHtml(item);
        root.appendChild(div);
      });
      document.querySelectorAll('#approvedUsersList [data-revoke-access]').forEach((btn)=> {
        btn.addEventListener('click', async ()=> {
          const requestId = Number(btn.dataset.id);
          const msg = document.getElementById(`approved-msg-${requestId}`);
          try {
            if (msg) { msg.textContent = 'Goedkeuring intrekken...'; msg.className = 'inline-msg'; }
            await revokePlayerAccess(requestId, 'Admin revoke vanuit goedgekeurde gebruikerslijst');
            await refreshAdminLists();
            setStatus('Goedkeuring ingetrokken. De gebruiker hoort nu geen toegang meer te hebben.');
          } catch (err) {
            if (msg) { msg.textContent = err instanceof Error ? err.message : 'Intrekken mislukt'; msg.className = 'inline-msg error'; }
          }
        });
      });
      document.querySelectorAll('#approvedUsersList [data-generate-activation]').forEach((btn)=> {
        btn.addEventListener('click', async ()=> {
          const requestId = Number(btn.dataset.id);
          const msg = document.getElementById(`approved-msg-${requestId}`);
          try {
            if (msg) { msg.textContent = 'Activatielink maken...'; msg.className = 'inline-msg'; }
            const linkData = await createActivationLink(requestId);
            showActivationPanel(requestId, linkData);
            if (msg) { msg.textContent = 'Nieuwe activatielink klaar.'; msg.className = 'inline-msg ok'; }
          } catch (err) {
            if (msg) { msg.textContent = err instanceof Error ? err.message : 'Link maken mislukt'; msg.className = 'inline-msg error'; }
          }
        });
      });
      document.querySelectorAll('#approvedUsersList [data-copy-activation]').forEach((btn)=> {
        btn.addEventListener('click', async ()=> {
          const requestId = Number(btn.dataset.id);
          const urlEl = document.getElementById(`activation-url-${requestId}`);
          const url = urlEl?.dataset.url;
          if (!url) { setStatus('Maak eerst een activatielink.'); return; }
          await navigator.clipboard.writeText(url);
          const msg = document.getElementById(`approved-msg-${requestId}`);
          if (msg) { msg.textContent = 'Link gekopieerd.'; msg.className = 'inline-msg ok'; }
        });
      });
      document.querySelectorAll('#approvedUsersList [data-mail-activation]').forEach((btn)=> {
        btn.addEventListener('click', () => {
          const requestId = Number(btn.dataset.id);
          const panel = document.getElementById(`activation-tools-${requestId}`);
          const email = panel?.dataset.email || '';
          const displayName = panel?.dataset.displayName || '';
          const expiresAt = panel?.dataset.expiresAt || '';
          const url = panel?.dataset.url || '';
          if (!email || !url) { setStatus('Maak eerst een activatielink.'); return; }
          const subject = 'Activeer je account voor Wordt er gejast';
          const body = ['Hoi ' + (displayName || 'daar') + ',', '', 'Je account is klaar voor gebruik.', 'Gebruik deze activatielink:', '', url, '', expiresAt ? `Deze link verloopt op ${formatDateTime(expiresAt)}.` : '', '', 'Groet,', 'Wordt er gejast'].filter(Boolean).join('\n');
          window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        });
      });
    }

    function getAdminViewConfig() {
      return {
        pending: { title: 'To be approved', subtitle: 'Nieuwe aanvragen die nog een besluit nodig hebben.', card: 'requestsCard' },
        awaiting: { title: 'Pending activation', subtitle: 'Goedgekeurd, maar nog niet geactiveerd.', card: 'historyCard' },
        active: { title: 'Active', subtitle: 'Actieve gebruikers met snelle revoke-knoppen.', card: 'approvedUsersCard' },
        rejected: { title: 'Afgewezen', subtitle: 'Afgewezen of ingetrokken aanvragen.', card: 'historyCard' }
      };
    }

    function renderAdminTabs() {
      const config = getAdminViewConfig();
      const tabs = [
        { key: 'pending', label: 'To be approved', count: (lastRequests || []).length },
        { key: 'awaiting', label: 'Pending activation', count: (lastHistory || []).filter((item) => isApprovedLike(item) && !hasPin(item)).length },
        { key: 'active', label: 'Active', count: (lastHistory || []).filter((item) => hasPin(item)).length },
        { key: 'rejected', label: 'Afgewezen', count: (lastHistory || []).filter((item) => String(item.decision || '').toLowerCase() === 'rejected' || item.approved === false).length }
      ];
      const root = document.getElementById('adminTabs');
      root.innerHTML = tabs.map((tab) => `<button type="button" class="tab-btn ${tab.key === currentAdminView ? 'active' : ''}" data-admin-view="${tab.key}"><span>${tab.label}</span><span class="tab-count">${tab.count}</span></button>`).join('');
      root.querySelectorAll('[data-admin-view]').forEach((btn) => btn.addEventListener('click', () => switchAdminView(btn.dataset.adminView)));
    }

    function applySharedSearchToVisibleCard() {
      const sharedValue = (document.getElementById('adminSearchGlobal')?.value || '').trim();
      const requestSearch = document.getElementById('requestSearch');
      const historySearch = document.getElementById('historySearch');
      const approvedSearch = document.getElementById('approvedSearch');
      if (requestSearch) requestSearch.value = currentAdminView === 'pending' ? sharedValue : '';
      if (historySearch) historySearch.value = (currentAdminView === 'awaiting' || currentAdminView === 'rejected') ? sharedValue : '';
      if (approvedSearch) approvedSearch.value = currentAdminView === 'active' ? sharedValue : '';
    }

    function switchAdminView(view) {
      currentAdminView = view;
      const cfg = getAdminViewConfig()[view] || getAdminViewConfig().pending;
      document.getElementById('currentListTitle').textContent = cfg.title;
      document.getElementById('currentListSubtitle').textContent = cfg.subtitle;
      document.getElementById('requestsCard').classList.remove('hidden','current-view');
      document.getElementById('historyCard').classList.remove('hidden','current-view');
      document.getElementById('approvedUsersCard').classList.remove('hidden','current-view');
      document.getElementById(cfg.card).classList.add('current-view');
      applySharedSearchToVisibleCard();
      if (view === 'pending') {
        renderRequests(lastRequests);
      } else if (view === 'awaiting') {
        historyFilter = 'awaiting';
        document.getElementById('historyTitle').textContent = 'Pending activation';
        document.getElementById('historyNote').textContent = 'Goedgekeurd, maar nog niet geactiveerd.';
        renderHistory(lastHistory);
      } else if (view === 'rejected') {
        historyFilter = 'rejected';
        document.getElementById('historyTitle').textContent = 'Afgewezen';
        document.getElementById('historyNote').textContent = 'Afgewezen of later weer ingetrokken.';
        renderHistory(lastHistory);
      } else if (view === 'active') {
        renderApprovedUsers(lastHistory);
      }
      renderAdminTabs();
    }

    async function adminDevLogin() {
      const username = document.getElementById('usernameInput').value.trim();
      const password = document.getElementById('passwordInput').value;
      if (!username) throw new Error('Vul een gebruikersnaam in');
      if (!password) throw new Error('Vul een wachtwoord in');
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_dev_login`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({ input_username: username, input_password: password, input_dev_key: document.getElementById('devKeyInput').value.trim() })
      });
      const data = await parseResponse(res);
      const token = data.admin_session_token || data.token;
      if (!token) throw new Error('Dev-login gaf geen admin-sessie terug');
      setAdminSessionToken(token);
      document.getElementById('passwordInput').value = '';
      return await checkSession();
    }

    async function adminLogin() {
      const username = document.getElementById('usernameInput').value.trim();
      const password = document.getElementById('passwordInput').value;
      const totp = document.getElementById('totpInput').value.trim();
      if (!username) throw new Error('Vul een gebruikersnaam in');
      if (!password) throw new Error('Vul een wachtwoord in');
      if (!/^\d{6}$/.test(totp)) throw new Error('Vul je 6-cijferige Google Authenticator-code in');
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_login`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({ input_username: username, input_password: password, input_totp_code: totp }) });
      const data = await parseResponse(res);
      const token = data.admin_session_token || data.token;
      if (!token) throw new Error('Login gaf geen admin-sessie terug');
      setAdminSessionToken(token);
      document.getElementById('passwordInput').value = '';
      document.getElementById('totpInput').value = '';
      return await checkSession();
    }
    async function checkSession() {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_check_session`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({ admin_session_token: getAdminSessionToken() }) });
      const data = await parseResponse(res);
      if (data.admin_session_token) setAdminSessionToken(data.admin_session_token);
      return data;
    }
    async function getRequests() { const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_get_claim_requests`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({ admin_session_token: getAdminSessionToken() }) }); return await parseResponse(res); }
    async function getHistory() { const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_get_claim_history`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({ admin_session_token: getAdminSessionToken() }) }); return await parseResponse(res); }
    async function decideRequest(requestId, decision, decisionReason) { const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_decide_claim_request`, { method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(), body: JSON.stringify({ admin_session_token: getAdminSessionToken(), request_id_input: requestId, decision, decision_reason_input: decisionReason }) }); return await parseResponse(res); }

    async function createActivationLink(requestId) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_player_activation_link`, {
        method:'POST',
        mode:'cors',
        cache:'no-store',
        headers: rpcHeaders(),
        body: JSON.stringify({
          admin_session_token: getAdminSessionToken(),
          request_id_input: requestId,
          base_url: getActivationBaseUrl()
        })
      });
      return await parseResponse(res);
    }


function isValidEmail(value){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim()); }
function isLikelyHttpUrl(value){ return /^https?:\/\//i.test(String(value||'').trim()); }
function hasUsefulMailContent(value){ return String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().length >= 3; }
function normalizeMakeWebhookPayload(payload = {}, fallback = {}) {
  const raw = (payload && typeof payload === 'object') ? payload : {};
  const nested = (raw.mail_job && typeof raw.mail_job === 'object') ? raw.mail_job : {};
  const payloadData = (raw.payload && typeof raw.payload === 'object') ? raw.payload : {};
  const fallbackData = (fallback && typeof fallback === 'object') ? fallback : {};
  const email = String(raw.to || raw.email || raw.recipient_email || nested.to || nested.email || nested.recipient_email || payloadData.to || payloadData.email || payloadData.recipient_email || payloadData.requester_email || fallbackData.to || fallbackData.email || fallbackData.recipient_email || '').trim().toLowerCase();
  const subject = String(raw.subject || raw.email_subject || nested.subject || nested.email_subject || payloadData.subject || payloadData.email_subject || fallbackData.subject || fallbackData.email_subject || (window.GEJAST_CONFIG && window.GEJAST_CONFIG.EMAIL_SUBJECT) || 'Activeer je account voor de Kale Nel').trim();
  const activationUrl = String(raw.activation_url || raw.reset_url || raw.url || nested.activation_url || nested.reset_url || nested.url || payloadData.activation_url || payloadData.reset_url || payloadData.url || fallbackData.activation_url || fallbackData.reset_url || fallbackData.url || '').trim();
  const trigger = String(raw.trigger || nested.trigger || fallbackData.trigger || 'activation_email_queued').trim();
  const html = raw.html || nested.html || payloadData.html || fallbackData.html || null;
  const text = raw.text || nested.text || payloadData.text || fallbackData.text || null;
  const body = raw.body || nested.body || payloadData.body || fallbackData.body || null;
  const template = raw.template || nested.template || payloadData.template || fallbackData.template || null;
  const merged = {
    trigger,
    source: raw.source || fallbackData.source || location.pathname.split('/').pop() || 'site',
    ts: raw.ts || fallbackData.ts || new Date().toISOString(),
    job_id: raw.job_id ?? nested.job_id ?? fallbackData.job_id ?? null,
    request_id: raw.request_id ?? nested.request_id ?? payloadData.request_id ?? fallbackData.request_id ?? null,
    player_id: raw.player_id ?? nested.player_id ?? payloadData.player_id ?? fallbackData.player_id ?? null,
    display_name: raw.display_name || nested.display_name || payloadData.display_name || fallbackData.display_name || null,
    to: email || null,
    email: email || null,
    recipient_email: email || null,
    recipient_name: raw.recipient_name || nested.recipient_name || payloadData.recipient_name || fallbackData.recipient_name || null,
    subject,
    email_subject: subject,
    activation_url: activationUrl || null,
    reset_url: activationUrl || null,
    url: activationUrl || null,
    html,
    text,
    body,
    template,
    expires_at: raw.expires_at || nested.expires_at || payloadData.expires_at || fallbackData.expires_at || null,
    created_at: raw.created_at || nested.created_at || payloadData.created_at || fallbackData.created_at || null,
    payload: Object.keys(payloadData).length ? payloadData : undefined,
    mail_job: Object.keys(nested).length ? nested : undefined
  };
  if (merged.ts && !merged.ts_local && typeof formatDateTime === 'function') merged.ts_local = formatDateTime(merged.ts);
  if (merged.expires_at && !merged.expires_at_local && typeof formatDateTime === 'function') merged.expires_at_local = formatDateTime(merged.expires_at);
  if (merged.created_at && !merged.created_at_local && typeof formatDateTime === 'function') merged.created_at_local = formatDateTime(merged.created_at);
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}
function validateMakePayloadLocally(meta = {}) {
  const payload = normalizeMakeWebhookPayload(meta);
  const reasons = [];
  const email = String(payload.to || payload.email || payload.recipient_email || '').trim();
  const subject = String(payload.email_subject || payload.subject || '').trim();
  const activationUrl = String(payload.activation_url || payload.reset_url || payload.url || '').trim();
  const trigger = String(payload.trigger || 'activation_email_queued').trim();
  const hasContent = !!(payload.template || hasUsefulMailContent(payload.html) || hasUsefulMailContent(payload.text) || hasUsefulMailContent(payload.body));
  if (!email) reasons.push('missing_email');
  else if (!isValidEmail(email)) reasons.push('invalid_email');
  if (!subject) reasons.push('missing_subject');
  else if (!hasUsefulMailContent(subject)) reasons.push('blank_subject');
  if (!hasContent) reasons.push('missing_template_or_body');
  if (/activation|reset|reactivat/i.test(trigger) || activationUrl) {
    if (!activationUrl) reasons.push('missing_activation_url');
    else if (!isLikelyHttpUrl(activationUrl)) reasons.push('invalid_activation_url');
  }
  return { ok: reasons.length === 0, reasons, payload, message: reasons.length ? `Mailjob niet naar Make gestuurd: ${reasons.join(', ')}` : 'ok' };
}

    function buildMakeWebhookMeta(source, meta = {}) { return normalizeMakeWebhookPayload({ source, ...meta }, { source }); }
    async function fetchOutboundEmailWebhookPayload(jobId, fallbackMeta = {}) {
      if (!jobId) return normalizeMakeWebhookPayload(fallbackMeta, fallbackMeta);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_get_outbound_email_job_webhook_payload`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({ admin_session_token: getAdminSessionToken(), job_id_input: Number(jobId) })
      });
      const data = await parseResponse(res);
      return normalizeMakeWebhookPayload(data?.payload || data?.make_payload || data || {}, fallbackMeta);
    }
    async function fetchLatestQueuedWebhookPayload() {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_get_latest_valid_outbound_email_job_webhook_payload`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({ admin_session_token: getAdminSessionToken() })
      });
      const data = await parseResponse(res);
      return normalizeMakeWebhookPayload(data?.payload || data?.make_payload || data || {});
    }

    async function validateOutboundEmailJob(jobId, options = {}) {
      if (!jobId) return { ok:false, reasons:['missing_job_id'], message:'Mailjob-id ontbreekt.' };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_validate_outbound_email_job`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({ admin_session_token: getAdminSessionToken(), job_id_input: Number(jobId), mark_failed_input: options.markFailed !== false })
      });
      return await parseResponse(res);
    }
    function formatMailPreflight(validation) {
      const reasons = Array.isArray(validation?.reasons) ? validation.reasons.filter(Boolean) : [];
      return `Mailjob niet naar Make gestuurd: ${reasons.length ? reasons.join(', ') : (validation?.message || 'onvolledige mailpayload')}`;
    }

    async function triggerMakeScenario(meta = {}) {
      if (!MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL ontbreekt in admin.js');
      const payload = buildMakeWebhookMeta('admin.js', meta);
      const localValidation = validateMakePayloadLocally(payload);
      if (!localValidation.ok) throw new Error(localValidation.message);
      const res = await fetch(MAKE_WEBHOOK_URL, {
        method:'POST', mode:'cors', cache:'no-store', keepalive:true,
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify(localValidation.payload)
      });
      if (!res.ok) throw new Error(`Make webhook pingen mislukt (HTTP ${res.status})`);
      return { ok:true, via:'fetch-json', payload: localValidation.payload, status: res.status };
    }

    async function revokePlayerAccess(requestId, reason) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_revoke_player_access`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({ admin_session_token: getAdminSessionToken(), request_id_input: requestId, decision_reason_input: reason || null })
      });
      return await parseResponse(res);
    }
    async function queueActivationEmail(requestId) {
      const panel = document.getElementById(`activation-tools-${requestId}`);
      const recipientEmail = panel?.dataset.email || '';
      const recipientName = panel?.dataset.displayName || '';
      const activationLink = panel?.dataset.url || '';
      if (!recipientEmail || !activationLink) throw new Error('Maak eerst een activatielink.');
      const req = (lastRequests || []).find((item) => Number(item.id) === Number(requestId)) || (lastHistory || []).find((item) => Number(item.id) === Number(requestId));
      const playerId = req?.player_id ?? null;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_queue_activation_email`, {
        method:'POST', mode:'cors', cache:'no-store', headers: rpcHeaders(),
        body: JSON.stringify({
          admin_session_token: getAdminSessionToken(),
          request_id_input: requestId,
          base_url: getActivationBaseUrl(),
          recipient_email_input: recipientEmail,
          recipient_name_input: recipientName || null,
          activation_link_input: activationLink,
          player_id_input: playerId
        })
      });
      return await parseResponse(res);
    }
    async function sendActivationEmail(requestId) {
      const queued = await queueActivationEmail(requestId);
      const jobId = queued?.job_id ?? queued?.id ?? null;
      const validation = await validateOutboundEmailJob(jobId, { markFailed:true });
      if (!validation?.ok) throw new Error(formatMailPreflight(validation));
      const makePayload = await fetchOutboundEmailWebhookPayload(jobId, {
        reason: 'activation_email_queued',
        request_id: requestId,
        job_id: jobId,
        email: queued?.requester_email ?? queued?.recipient_email ?? null,
        activation_url: queued?.activation_url ?? null,
        subject: queued?.subject ?? ((window.GEJAST_CONFIG && window.GEJAST_CONFIG.EMAIL_SUBJECT) || 'Activeer je account voor de Kale Nel'),
        email_subject: queued?.email_subject ?? queued?.subject ?? ((window.GEJAST_CONFIG && window.GEJAST_CONFIG.EMAIL_SUBJECT) || 'Activeer je account voor de Kale Nel')
      });
      await triggerMakeScenario(makePayload);
      return queued;
    }
    async function refreshAdminLists() {
      const [requests, history] = await Promise.all([getRequests(), getHistory()]);
      lastRequests = requests.requests || [];
      lastHistory = history.history || [];
      renderStats(lastRequests, lastHistory);
      switchAdminView(currentAdminView);
    }
    function showActivationPanel(requestId, linkData) {
      const panel = document.getElementById(`activation-tools-${requestId}`);
      const urlEl = document.getElementById(`activation-url-${requestId}`);
      const expiresEl = document.getElementById(`activation-expires-${requestId}`);
      if (!panel || !urlEl || !expiresEl) return;
      panel.classList.remove('hidden');
      panel.dataset.url = linkData.activation_url || '';
      panel.dataset.email = linkData.requester_email || '';
      panel.dataset.displayName = linkData.display_name || '';
      panel.dataset.expiresAt = linkData.expires_at || '';
      urlEl.dataset.url = linkData.activation_url || '';
      urlEl.textContent = linkData.activation_url || 'Geen link ontvangen van de server.';
      expiresEl.textContent = formatDateTime(linkData.expires_at);
    }

    async function loadAdmin() {
      try {
        setStatus('');
        const token = getAdminSessionToken();
        if (!token) { showLoggedOut(); return; }
        const session = await checkSession();
        if (!session.ok) { clearAdminSessionToken(); showLoggedOut(); return; }
        showLoggedIn(session.username);
        await refreshAdminLists();
      } catch (err) {
        clearAdminSessionToken(); showLoggedOut();
        const rawMessage = err instanceof Error ? err.message : 'Er ging iets mis';
        setStatus(rawMessage === 'Failed to fetch' ? 'Netwerk/CORS-fout bij contact met Supabase.' : rawMessage);
      }
    }

    document.getElementById('loginBtn').addEventListener('click', async () => {
      try {
        setStatus('Inloggen...');
        const session = await adminLogin();
        showLoggedIn(session.username || session.admin_username || document.getElementById('usernameInput').value.trim());
        await refreshAdminLists();
        setStatus('Inloggen gelukt. Sessieserver bevestigde de admin-sessie.');
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'Er ging iets mis';
        setStatus(rawMessage === 'Failed to fetch' ? 'Netwerk/CORS-fout bij contact met Supabase.' : rawMessage);
      }
    });
    document.getElementById('logoutBtn').addEventListener('click', () => { clearAdminSessionToken(); showLoggedOut(); setStatus('Uitgelogd.'); });
    document.getElementById('totpInput').placeholder = 'Google Authenticator-code (of gebruik de test-login hieronder)';
    if (!document.getElementById('usernameInput').value) document.getElementById('usernameInput').value = '1';
    if (!document.getElementById('passwordInput').value) document.getElementById('passwordInput').value = '1';
    if (!document.getElementById('devKeyInput').value) document.getElementById('devKeyInput').value = '1';
    document.getElementById('devKeyInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); document.getElementById('devLoginBtn').click(); } });
    document.getElementById('devLoginBtn').addEventListener('click', async () => {
      try {
        setStatus('Dev-login...');
        const session = await adminDevLogin();
        showLoggedIn(session.username || session.admin_username || document.getElementById('usernameInput').value.trim());
        await refreshAdminLists();
        setStatus('Dev-login gelukt en sessie gevalideerd. Alleen nuttig voor debug/test.');
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'Er ging iets mis';
        setStatus(rawMessage === 'Failed to fetch' ? 'Netwerk/CORS-fout bij contact met Supabase.' : rawMessage);
      }
    });

    function initParallax() {
      const root = document.documentElement;
      let mx = 0, my = 0, tx = 0, ty = 0, raf = null;
      function step() {
        tx += (mx - tx) * 0.1;
        ty += (my - ty) * 0.1;
        root.style.setProperty('--mouse-x', `${tx.toFixed(2)}px`);
        root.style.setProperty('--mouse-y', `${ty.toFixed(2)}px`);
        if (Math.abs(tx - mx) > 0.2 || Math.abs(ty - my) > 0.2) {
          raf = requestAnimationFrame(step);
        } else {
          raf = null;
        }
      }
      window.addEventListener('mousemove', (event) => {
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        mx = x * 30;
        my = y * 24;
        if (!raf) raf = requestAnimationFrame(step);
      }, { passive: true });
    }


document.getElementById('usernameInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); document.getElementById('loginBtn').click(); }
});
document.getElementById('passwordInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); document.getElementById('loginBtn').click(); }
});
document.getElementById('totpInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); document.getElementById('loginBtn').click(); }
});
    document.getElementById('adminSearchGlobal').addEventListener('input', ()=> switchAdminView(currentAdminView));
    document.getElementById('requestSearch').addEventListener('input', ()=> { if (currentAdminView === 'pending') renderRequests(lastRequests); });
    document.getElementById('historySearch').addEventListener('input', ()=> { if (currentAdminView === 'awaiting' || currentAdminView === 'rejected') renderHistory(lastHistory); });
    document.getElementById('approvedSearch').addEventListener('input', ()=> { if (currentAdminView === 'active') renderApprovedUsers(lastHistory); });
    document.getElementById('refreshBtn').addEventListener('click', async ()=> { setStatus('Verversen...'); await refreshAdminLists(); setStatus('Admin-overzicht ververst.'); });
    document.getElementById('kickMakeBtn').addEventListener('click', async ()=> {
      try {
        setStatus('Make handmatig pingen...');
        const makePayload = await fetchLatestQueuedWebhookPayload();
        const localValidation = validateMakePayloadLocally(makePayload);
        if (!localValidation.ok) throw new Error('Geen geldige queued mailjob gevonden om Make veilig te wekken.');
        await triggerMakeScenario(makePayload);
        setStatus('Make veilig gepingd met de nieuwste geldige queued mailjob.');
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Make webhook pingen mislukt');
      }
    });
    document.querySelectorAll('[data-history-filter]').forEach((btn)=> btn.addEventListener('click', ()=> { historyFilter = btn.dataset.historyFilter; renderHistory(lastHistory); }));
    loadAdmin();
  