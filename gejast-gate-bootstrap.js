(function(global){
  'use strict';
  const cfg = global.GEJAST_CONFIG || {};
  const PUBLIC_PAGES = new Set(['home.html','login.html','request.html','activate.html','invite.html','robots.txt','probe.html']);
  const ADMIN_PREFIX = /^admin/i;
  function pageName(){ try { return (location.pathname || '').split('/').pop() || 'index.html'; } catch (_) { return 'index.html'; } }
  function scope(){ try { return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch (_) { return 'friends'; } }
  function token(){ try { return cfg.getPlayerSessionToken ? cfg.getPlayerSessionToken() : ''; } catch (_) { return ''; } }
  function isPublicPage(name){ const p=String(name||pageName()).toLowerCase(); return PUBLIC_PAGES.has(p) || ADMIN_PREFIX.test(p); }
  function returnTarget(){ try { return cfg.currentReturnTarget ? cfg.currentReturnTarget(pageName()) : pageName(); } catch (_) { return pageName(); } }
  function homeUrl(){ try { return cfg.buildHomeUrl ? cfg.buildHomeUrl(returnTarget(), scope()) : './home.html'; } catch (_) { return './home.html'; } }
  function redirectHome(reason){ try { sessionStorage.setItem('gejast_gate_last_redirect_reason', String(reason || 'missing_session')); } catch (_) {} location.replace(homeUrl()); }
  function localSessionState(){ if (isPublicPage()) return { ok:true, mode:'public_page', page:pageName() }; if (cfg.isPlayerSessionExpired && cfg.isPlayerSessionExpired()) { try { cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); } catch(_){} return { ok:false, reason:'expired', page:pageName() }; } return token() ? { ok:true, mode:'token_present', page:pageName() } : { ok:false, reason:'missing_token', page:pageName() }; }
  function ensure(options){ const opts=Object.assign({redirect:true, allowUnknown:true}, options||{}); const state=localSessionState(); if(!state.ok && opts.redirect) redirectHome(state.reason); try { if(state.ok && cfg.touchPlayerActivity) cfg.touchPlayerActivity({force:!!opts.forceTouch}); } catch(_){} return state; }
  function installAuto(){ const script=document.currentScript; const attr=script && (script.getAttribute('data-gejast-gate-bootstrap') || script.dataset.gejastGateBootstrap); const bodyAttr=document.body && document.body.getAttribute('data-gejast-gate-bootstrap'); if(attr==='auto' || bodyAttr==='auto') ensure({redirect:true, forceTouch:true}); }
  global.GEJAST_GATE_BOOTSTRAP = { pageName, scope, token, isPublicPage, localSessionState, ensure, homeUrl };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', installAuto, {once:true}); else installAuto();
})(window);
