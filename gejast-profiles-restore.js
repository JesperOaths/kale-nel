(function(){
  function normalizeProfileImageUrl(value){const raw=String(value||'').trim();if(!raw)return'';if(/^(https?:|data:|blob:)/i.test(raw)||raw.startsWith('/'))return raw;const base=(window.GEJAST_CONFIG&&window.GEJAST_CONFIG.SUPABASE_URL)||'';if(!base)return raw;if(/^storage\/v1\/object\/public\//i.test(raw))return base+'/'+raw.replace(/^\/+/, '');if(/^(public\/)?avatars?\//i.test(raw))return base+'/storage/v1/object/public/'+raw.replace(/^(public\/)?/,'').replace(/^\/+/, '');return raw;}
  function badgeSummary(profile){const p=profile||{};const badges=Array.isArray(p.badges)?p.badges:[];return{count:badges.length,badges};}
  window.GEJAST_PROFILES_RESTORE={normalizeProfileImageUrl,badgeSummary};
})();
