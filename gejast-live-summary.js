(function(){
  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function headers(){ const c=cfg(); return { apikey:c.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch{ throw new Error(t||`HTTP ${res.status}`); } if(!res.ok) throw new Error(d?.message||d?.error||`HTTP ${res.status}`); return d; }
  function currentScope(){ try{ return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }catch(_){ return 'friends'; } }
  function normalizeName(value){ return String(value||'').trim().toLowerCase(); }
  function currentSessionToken(){ try{ return (window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerSessionToken && window.GEJAST_CONFIG.getPlayerSessionToken()) || ''; }catch(_){ return ''; } }
  function matchIdentityFromUrl(){ const params = new URLSearchParams(location.search); return { clientMatchId: params.get('client_match_id') || '', matchRef: params.get('match_ref') || '' }; }
  function itemFromPayload(data){ return data?.item || data || {}; }
  function summaryFromItem(item){ return item?.summary || item?.summary_payload || {}; }
  function participants(item){ const summary = summaryFromItem(item); const rows = [].concat(Array.isArray(item?.participant_names) ? item.participant_names : []).concat(Array.isArray(summary?.participants) ? summary.participants : []).concat(Array.isArray(summary?.players) ? summary.players : []); return [...new Set(rows.map((v)=>String(v||'').trim()).filter(Boolean))]; }
  function hostName(item){ const summary = summaryFromItem(item); return String(summary?.submitter_meta?.submitted_by_name || summary?.submitter_name || item?.submitter_name || '').trim(); }
  function isFinished(item){ return !!(item?.finished_at || summaryFromItem(item)?.finished_at || summaryFromItem(item)?.live_state?.status === 'finished'); }
  function metaText(item){ if(isFinished(item)){ const when = item.finished_at || summaryFromItem(item)?.finished_at; return when ? `Afgerond op ${new Date(when).toLocaleString('nl-NL')}` : 'Wedstrijd afgerond.'; } const updated = item.updated_at || summaryFromItem(item)?.live_state?.updated_at || Date.now(); return `Live bijgewerkt om ${new Date(updated).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`; }
  function buildScopedHref(base, item, scope){ try { const url = new URL(base, window.location.href); const clientMatchId = item?.client_match_id || item?.match_ref || summaryFromItem(item)?.match_ref || ''; const matchRef = item?.match_ref || summaryFromItem(item)?.match_ref || ''; if (clientMatchId) url.searchParams.set('client_match_id', clientMatchId); if (matchRef) url.searchParams.set('match_ref', matchRef); if ((scope || currentScope()) === 'family') url.searchParams.set('scope', 'family'); return url.pathname.split('/').pop() + url.search; } catch (_) { return base; } }
  async function loadPublicSummary(gameType, opts={}){ const c=cfg(); const scope = opts.siteScope || currentScope(); const clientMatchId = String(opts.clientMatchId || '').trim(); const matchRef = String(opts.matchRef || '').trim(); try { const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_live_match_summary_public_scoped`, { method:'POST', headers:headers(), body: JSON.stringify({ game_type_input: gameType, match_ref_input: matchRef || null, client_match_id_input: clientMatchId || null, site_scope_input: scope }) }).then(parse); return itemFromPayload(raw); } catch(err) { const legacyRef = matchRef || clientMatchId; try { const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_live_match_summary_public`, { method:'POST', headers:headers(), body: JSON.stringify({ game_type_input: gameType, match_ref_input: legacyRef || null, client_match_id_input: clientMatchId || null }) }).then(parse); return itemFromPayload(raw); } catch(inner) { if(/live_match_summaries/i.test(String(inner?.message || inner || ''))){ throw new Error('Live samenvatting is nog niet beschikbaar op deze database.'); } throw inner; } } }

  const PARTICIPANT_KEYS = {
    klaverjas: 'gejast_klaverjas_live_participant_v1',
    boerenbridge: 'gejast_boerenbridge_live_participant_v1'
  };
  function isUuid(value){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||'').trim()); }
  function saveParticipantToken(gameKey, payload){ try{ const key=PARTICIPANT_KEYS[gameKey]; if(!key) return; localStorage.setItem(key, JSON.stringify(Object.assign({ at:Date.now() }, payload || {}))); }catch(_){ } }
  function readParticipantToken(gameKey){ try{ const key=PARTICIPANT_KEYS[gameKey]; if(!key) return null; const raw=localStorage.getItem(key); if(!raw) return null; const parsed=JSON.parse(raw); if(!parsed?.at || (Date.now()-Number(parsed.at)) > 1000*60*60*18) return null; return parsed; }catch(_){ return null; } }
  function maybeRememberParticipationFromUrl(){
    const path = String(location.pathname || '').split('/').pop() || '';
    const params = new URLSearchParams(location.search);
    const clientMatchId = params.get('client_match_id') || params.get('game_id') || '';
    const matchRef = params.get('match_ref') || params.get('match_id') || '';
    if (!(clientMatchId || matchRef)) return;
    if (path === 'scorer.html' || path === 'klaverjas_live.html') saveParticipantToken('klaverjas', { client_match_id: clientMatchId, match_ref: matchRef });
    if (path === 'boerenbridge.html' || path === 'boerenbridge_live.html') saveParticipantToken('boerenbridge', { client_match_id: clientMatchId, match_ref: matchRef });
  }
  function normalizeHomepageEntries(rawEntries, scope){
    const entries = rawEntries && typeof rawEntries === 'object' ? { ...rawEntries } : {};
    const specs = {
      klaverjas: { base:'./klaverjas_live.html', label:'Klaverjas Kijken', copy:'LIVE · open jouw huidige klaverjaspotje.' },
      boerenbridge: { base:'./boerenbridge_live.html', label:'Boerenbridge begluren', copy:'LIVE · open jouw huidige boerenbridgepotje.' }
    };
    Object.keys(specs).forEach((gameKey)=>{
      const spec = specs[gameKey];
      const entry = entries[gameKey] && typeof entries[gameKey] === 'object' ? { ...entries[gameKey] } : {};
      const remembered = readParticipantToken(gameKey) || {};
      const clientMatchId = String(entry.client_match_id || remembered.client_match_id || '').trim();
      const matchRef = String(entry.match_ref || remembered.match_ref || '').trim();
      const hasTarget = !!(clientMatchId || matchRef || entry.href);
      if (!hasTarget) return;
      const url = new URL(spec.base, window.location.href);
      if (clientMatchId) url.searchParams.set('client_match_id', clientMatchId);
      if (matchRef) url.searchParams.set('match_ref', matchRef);
      if ((scope || currentScope()) === 'family') url.searchParams.set('scope', 'family');
      entry.href = `${url.pathname.split('/').pop()}${url.search}`;
      entry.label = spec.label;
      entry.copy = spec.copy;
      entry.live = true;
      entries[gameKey] = entry;
    });
    return entries;
  }
  function decorateHomepageLiveCards(entries){
    const map = {
      klaverjas: { entryId:'homeKlaverjasEntry', labelId:'homeKlaverjasLabel', copyId:'homeKlaverjasCopy' },
      boerenbridge: { entryId:'homeBoerenbridgeEntry', labelId:'homeBoerenbridgeLabel', copyId:'homeBoerenbridgeCopy' }
    };
    Object.keys(map).forEach((gameKey)=>{
      const cfg = map[gameKey]; const entry = document.getElementById(cfg.entryId); const label = document.getElementById(cfg.labelId); const copy = document.getElementById(cfg.copyId); const data = entries && entries[gameKey];
      if (!entry || !label || !copy || !data || !data.href) return;
      entry.classList.add('is-live'); entry.href = data.href; label.textContent = data.label || label.textContent;
      copy.className = 'page-link-copy page-link-live-row';
      copy.innerHTML = `<span class="live-pill live">LIVE</span><span class="page-link-live-hint">${String(data.copy || '').replace(/^LIVE\s*·\s*/i,'')}</span>`;
    });
  }
  async function loadHomepageState(sessionToken='', scope){
    const c = cfg(); const useScope = scope || currentScope(); const token = sessionToken || currentSessionToken(); let raw = {};
    try { raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_homepage_live_state_public_scoped`, { method:'POST', headers:headers(), body: JSON.stringify({ session_token: token || null, site_scope_input: useScope }) }).then(parse); raw = raw?.entries || raw?.by_game || raw || {}; }
    catch (_) { try { raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/get_homepage_live_state_public`, { method:'POST', headers:headers(), body: JSON.stringify({ session_token: token || null }) }).then(parse); raw = raw?.entries || raw?.by_game || raw || {}; } catch (_) { raw = {}; } }
    return normalizeHomepageEntries(raw, useScope);
  }

  maybeRememberParticipationFromUrl();
  document.addEventListener('DOMContentLoaded', ()=>{
    if ((String(location.pathname || '').split('/').pop() || '') !== 'index.html') return;
    loadHomepageState().then((entries)=>decorateHomepageLiveCards(entries)).catch(()=>{});
  });

  window.GEJAST_LIVE_SUMMARY = { currentScope, currentSessionToken, normalizeName, matchIdentityFromUrl, loadPublicSummary, itemFromPayload, summaryFromItem, participants, hostName, isFinished, metaText, buildScopedHref, loadHomepageState, saveParticipantToken, readParticipantToken, normalizeHomepageEntries, decorateHomepageLiveCards };
})();
