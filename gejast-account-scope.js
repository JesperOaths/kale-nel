(function(global){
const cfg = global.GEJAST_CONFIG || {};
function currentScope(){ try { const qs = new URLSearchParams(global.location.search || ''); if(String(qs.get('scope')||'').toLowerCase()==='family') return 'family'; return String(global.location.pathname||'').includes('/familie/')?'family':'friends'; } catch (_) { return 'friends'; } }
function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type': 'application/json', Accept:'application/json' }; }
async function parseResponse(res){ const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); } if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`); return data; }
function retryable(error){ const msg = String(error?.message || error || ''); return /schema cache|could not find the function|no function matches|unexpected parameter|unknown parameter|does not exist|function public\.|argument|timeout/i.test(msg); }
function scopedVariants(payload, rpcName){
  const base = payload || {};
  const scope = currentScope();
  const name = String(rpcName || '');
  if (/^get_public_state$/i.test(name)) return [{ site_scope_input: scope }];
  if (/^player_touch_session$/i.test(name)) {
    const token = base.session_token || base.session_token_input || base.input_token || base.token || '';
    return [{ session_token:token, session_token_input:token, page_input:base.page_input || `${global.location.pathname||''}${global.location.search||''}`, site_scope_input:scope }];
  }
  if (/^(login_player|get_login_names|request_pin_reset_reactivation_action)$/i.test(name)) return [base];
  return [{ ...base, site_scope_input: base.site_scope_input ?? scope }, { ...base, scope_input: base.scope_input ?? scope }, { ...base, site_scope: base.site_scope ?? scope }, base];
}
async function postRpc(name, payload){ const url = `${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`; const res = await global.fetch(url, { method:'POST', mode:'cors', cache:'no-store', headers: headers(), body: JSON.stringify(payload || {}) }); return parseResponse(res); }
async function callRpcCompat(name, payloadOrPayloads){ const payloads = Array.isArray(payloadOrPayloads) ? payloadOrPayloads : [payloadOrPayloads || {}]; let lastError = null; for (const payload of payloads) { for (const variant of scopedVariants(payload, name)) { try { return await postRpc(name, variant); } catch (error) { lastError = error; if (!retryable(error)) throw error; } } } throw lastError || new Error(`RPC ${name} kon niet worden aangeroepen.`); }
global.GEJAST_ACCOUNT_SCOPE = { currentScope, headers, parseResponse, postRpc, callRpcCompat };
})(window);
