(function(){
  async function gate(){
    try {
      if (window.GEJAST_ADMIN_SESSION && typeof window.GEJAST_ADMIN_SESSION.requirePage === 'function') {
        await window.GEJAST_ADMIN_SESSION.requirePage(window.location.pathname.split('/').pop());
        return true;
      }
    } catch (_) {}
    window.location.href = './admin.html?reason=session_invalid';
    return false;
  }
  window.GEJAST_ADMIN_GATE = { gate };
  window.requireAdminGate = gate;
})();
