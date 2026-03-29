(function(){
  const CONFIG = {
    VERSION: 'v169',
    SUPABASE_URL: 'https://uiqntazgnrxwliaidkmy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA',
    MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/h63v9tzv3o1i8hqtx2m5lfugrn5funy6',
    CLAIM_EMAIL_RPC: 'claim_email_jobs_http',
    EMAIL_SUBJECT: 'Activeer je account voor de Kale Nel'
  };

  const label = `${CONFIG.VERSION} · Made by Bruis`;

  function applyVersionLabel(){
    const selectors = [
      '.site-credit-watermark',
      '#versionWatermark',
      '.version-tag',
      '.watermark',
      '[data-version-watermark]'
    ];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        node.textContent = label;
      });
    });
    const re = /v\d+\s*[·.-]?\s*Made by Bruis/i;
    document.querySelectorAll('body *').forEach((node) => {
      if (node.children.length) return;
      const txt = (node.textContent || '').trim();
      if (re.test(txt)) node.textContent = label;
    });
  }

  window.GEJAST_CONFIG = Object.assign({}, window.GEJAST_CONFIG || {}, CONFIG, {
    VERSION_LABEL: 'v169 · Made by Bruis',
    applyVersionLabel
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersionLabel, { once: true });
  } else {
    applyVersionLabel();
  }
})();
