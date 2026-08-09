#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function read(file){ return fs.readFileSync(file,'utf8'); }
function write(file,text){ fs.writeFileSync(file,text,'utf8'); }
function replaceOnce(file, from, to, label){
  const before=read(file);
  const count=before.split(from).length-1;
  if(count!==1) throw new Error(`${label}: expected exactly one match in ${file}, found ${count}`);
  write(file,before.replace(from,to));
  console.log(`patched ${file}: ${label}`);
}

// 1) Beerpong: Supabase RPC returns a thenable query builder; assimilate it into a real Promise before catch().
replaceOnce(
  'beerpong.html',
  "sb.rpc('get_beerpong_pussycup_ranking_public').catch(()=>({ data:null, error:null }))",
  "Promise.resolve(sb.rpc('get_beerpong_pussycup_ranking_public')).catch(()=>({ data:null, error:null }))",
  'optional Pussycup RPC promise handling'
);

// 2) Analytics: sendBeacon is credentialed cross-origin and is rejected by Supabase wildcard CORS.
const oldAnalytics=`  function sendEvent(payload){\r\n    const body = JSON.stringify(payload);\r\n    if (navigator.sendBeacon) {\r\n      try {\r\n        const blob = new Blob([body], { type: 'application/json' });\r\n        const ok = navigator.sendBeacon(\`${'${SUPABASE_URL}'}/rest/v1/rpc/track_site_event\`, blob);\r\n        if (ok) return Promise.resolve();\r\n      } catch (_) {}\r\n    }\r\n    return fetch(\`${'${SUPABASE_URL}'}/rest/v1/rpc/track_site_event\`, {\r\n      method: 'POST', mode: 'cors', keepalive: true,\r\n      headers: rpcHeaders(), body\r\n    }).catch(() => {});\r\n  }`;
const newAnalytics=`  function sendEvent(payload){\r\n    const endpoint = \`${'${SUPABASE_URL}'}/rest/v1/rpc/track_site_event\`;\r\n    const body = JSON.stringify(payload);\r\n    let sameOrigin = false;\r\n    try { sameOrigin = new URL(endpoint, location.href).origin === location.origin; } catch (_) {}\r\n    if (sameOrigin && navigator.sendBeacon) {\r\n      try {\r\n        const blob = new Blob([body], { type: 'application/json' });\r\n        const ok = navigator.sendBeacon(endpoint, blob);\r\n        if (ok) return Promise.resolve();\r\n      } catch (_) {}\r\n    }\r\n    return fetch(endpoint, {\r\n      method: 'POST', mode: 'cors', keepalive: true,\r\n      headers: rpcHeaders(), body\r\n    }).catch(() => {});\r\n  }`;
replaceOnce('site-analytics.js', oldAnalytics, newAnalytics, 'cross-origin analytics transport');

// 3) Login: remove implementation/version rollout language from the user-facing surface.
replaceOnce(
  'login.html',
  '<p>Kies je naam en voer je 4-cijferige pincode in. De dropdown gebruikt de snelle v689 actieve-login bron met selector-fallback, zodat bestaande actieve spelers zichtbaar blijven als een nieuwere RPC nog niet is uitgerold.</p>',
  '<p>Kies je naam en voer je 4-cijferige pincode in.</p>',
  'finished-product login copy'
);

// Permanent regression for these production-acceptance findings.
write('check-production-acceptance-v774.mjs', `#!/usr/bin/env node\nimport fs from 'node:fs';\n\nconst failures=[];\nconst version=fs.readFileSync('VERSION','utf8').trim();\nconst n=Number((version.match(/v(\\d+)/i)||[])[1]||0);\nif(n<774) failures.push('production-acceptance v774 guard requires VERSION >= v774, got '+version);\nconst beer=fs.readFileSync('beerpong.html','utf8');\nif(beer.includes("sb.rpc('get_beerpong_pussycup_ranking_public').catch(")) failures.push('Beerpong still calls .catch directly on the Supabase RPC builder');\nif(!beer.includes("Promise.resolve(sb.rpc('get_beerpong_pussycup_ranking_public')).catch(")) failures.push('Beerpong optional Pussycup RPC must be assimilated through Promise.resolve');\nconst analytics=fs.readFileSync('site-analytics.js','utf8');\nif(!analytics.includes('const endpoint = \\`\\${SUPABASE_URL}/rest/v1/rpc/track_site_event\\`;')) failures.push('analytics must define the track_site_event endpoint once');\nif(!analytics.includes('sameOrigin && navigator.sendBeacon')) failures.push('analytics sendBeacon must be restricted to same-origin endpoints');\nif(!analytics.includes("return fetch(endpoint, {")) failures.push('analytics must retain keepalive fetch for cross-origin Supabase delivery');\nconst login=fs.readFileSync('login.html','utf8');\nfor(const marker of ['v689 actieve-login bron','selector-fallback','nieuwere RPC nog niet is uitgerold']) if(login.includes(marker)) failures.push('login still exposes implementation copy: '+marker);\nif(!login.includes('<p>Kies je naam en voer je 4-cijferige pincode in.</p>')) failures.push('login must retain concise user-facing instruction');\nfor(const temp of ['scripts/audit-live-browser-v774.mjs','scripts/audit-live-browser-v774-focus.mjs','.github/workflows/v774-production-browser-audit.yml','scripts/apply-v774-production-acceptance.mjs','.github/workflows/v774-apply-production-acceptance.yml']) if(fs.existsSync(temp)) failures.push('temporary v774 audit/builder residue remains: '+temp);\nif(failures.length){ console.error('Production acceptance v774 FAILED'); failures.forEach(f=>console.error('- '+f)); process.exit(1); }\nconsole.log('Production acceptance v774 PASS: Beerpong runtime, analytics transport, and login copy are production-clean.');\n`);

// Wire the guard into an existing permanent aggregate without adding a browser dependency.
replaceOnce(
  'check-homepage-root-fixes.mjs',
  "import './check-diagnostic-self-consistency-v773.mjs';\nimport './check-finalization-residue-v772.mjs';",
  "import './check-production-acceptance-v774.mjs';\nimport './check-diagnostic-self-consistency-v773.mjs';\nimport './check-finalization-residue-v772.mjs';",
  'production acceptance regression import'
);

// Record release-candidate state without claiming deployment before post-merge proof.
const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v774 / live v773';
readiness.last_updated='2026-08-09';
readiness.deployment_identity.release_candidate_version='v774';
readiness.deployment_identity.note='v774 release candidate: production browser acceptance fixes for Beerpong optional RPC promise handling, cross-origin analytics delivery, and finished-product login copy. Live remains v773 until post-merge public-edge proof.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v774';
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

// Frontend change => v774 release and mechanical cache/watermark alignment.
write('VERSION','v774\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0) process.exit(drift.status||1);

// Remove all temporary investigative/build machinery before the generated commit.
for(const temp of [
  'scripts/audit-live-browser-v774.mjs',
  'scripts/audit-live-browser-v774-focus.mjs',
  '.github/workflows/v774-production-browser-audit.yml',
  'scripts/apply-v774-production-acceptance.mjs',
  '.github/workflows/v774-apply-production-acceptance.yml'
]) {
  if(fs.existsSync(temp)){ fs.rmSync(temp); console.log(`removed ${temp}`); }
}

console.log('v774 production acceptance release candidate generated.');
