#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function read(file){return fs.readFileSync(file,'utf8');}
function write(file,text){fs.writeFileSync(file,text,'utf8');}
function replaceExact(file,from,to,count,label){const before=read(file);const found=before.split(from).length-1;if(found!==count)throw new Error(`${label}: expected ${count} matches in ${file}, found ${found}`);write(file,before.split(from).join(to));console.log(`patched ${file}: ${label}`);}

// Public test/diagnostic residue: both are unnecessary production surfaces.
for(const file of ['geo_diagnostics.html','push_beta_test.html']){
  if(!fs.existsSync(file)) throw new Error(`Expected public residue file missing before cleanup: ${file}`);
  fs.rmSync(file);
  console.log(`removed ${file}`);
}

// The protected targeted-push admin tool should link test notifications to the real verification UI, not to a public test console.
replaceExact(
  'admin_push_targeted_test.html',
  './push_beta_test.html?push_test=targeted',
  './drinks_pending.html?push_test=targeted',
  2,
  'targeted push click destination'
);

// Keep the existing queue-proof regression truthful about the safe production destination.
replaceExact(
  'check-admin-push-targeted-test-page.mjs',
  "includes(\"const TARGET_URL = './push_beta_test.html?push_test=targeted';\", 'targeted page must hard-code requested target URL');",
  "includes(\"const TARGET_URL = './drinks_pending.html?push_test=targeted';\", 'targeted page must hard-code the normal Drinks verification target URL');\nnotIncludes('push_beta_test.html', 'targeted page must not link notifications to the removed public beta-test console');",
  1,
  'targeted push regression destination'
);

// Permanent current-tree security/public-surface regression. History scan remains audit evidence; current-tree exposure belongs in normal CI.
write('check-public-surface-security-v775.mjs', `#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const failures=[];
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number((version.match(/v(\\d+)/i)||[])[1]||0);
if(n<775) failures.push('public-surface security v775 guard requires VERSION >= v775, got '+version);
for(const removed of ['geo_diagnostics.html','push_beta_test.html']) if(fs.existsSync(removed)) failures.push('removed public operational residue returned: '+removed);
const targeted=fs.readFileSync('admin_push_targeted_test.html','utf8');
if(targeted.includes('push_beta_test.html')) failures.push('admin targeted push tool still references removed public beta-test console');
if(!targeted.includes("const TARGET_URL = './drinks_pending.html?push_test=targeted';")) failures.push('admin targeted push tool must use normal Drinks verification destination');
const targetedCheck=fs.readFileSync('check-admin-push-targeted-test-page.mjs','utf8');
if(!targetedCheck.includes("notIncludes('push_beta_test.html'")) failures.push('targeted push regression must forbid removed beta-test console');
const redirect=fs.readFileSync('despimarkt_force.html','utf8');
if(!redirect.includes("target.searchParams.set('focus', 'nomination')")) failures.push('Despimarkt compatibility redirect must remain a non-mutating nomination redirect');

const listed=spawnSync('git',['ls-files','-z'],{encoding:'utf8'});
if(listed.status!==0) failures.push('git ls-files failed during current secret exposure scan');
else {
  const files=listed.stdout.split('\\0').filter(Boolean).filter((file)=>file!=='check-public-surface-security-v775.mjs' && /\\.(?:html|js|mjs|json|yml|yaml|toml|txt|md|sql|ps1|sh)$/i.test(file));
  const patterns=[
    ['private_key_block',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['github_pat',/\\bgithub_pat_[A-Za-z0-9_]{20,}\\b/],
    ['github_classic_pat',/\\bghp_[A-Za-z0-9]{30,}\\b/],
    ['aws_access_key',/\\bAKIA[0-9A-Z]{16}\\b/],
    ['literal_service_role',/(?:SUPABASE_SERVICE_ROLE_KEY|service_role_key)\\s*[:=]\\s*['\"][^'\"\\s]{20,}['\"]/i],
    ['literal_private_secret',/(?:GITHUB_CLIENT_SECRET|COOKIE_SECRET|VAPID_PRIVATE_KEY|PRIVATE_KEY)\\s*[:=]\\s*['\"][^'\"\\s]{16,}['\"]/i]
  ];
  function serviceRoleJwt(text){for(const token of String(text).match(/eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/g)||[]){try{const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));if(String(payload?.role||'').toLowerCase()==='service_role')return true;}catch(_){}}return false;}
  for(const file of files){let text='';try{text=fs.readFileSync(file,'utf8');}catch(_){continue;}for(const [kind,re] of patterns)if(re.test(text))failures.push('high-confidence current-tree secret finding: '+kind+' in '+file);if(serviceRoleJwt(text))failures.push('high-confidence current-tree service-role JWT in '+file);}
}
if(failures.length){console.error('Public-surface security v775 FAILED');failures.forEach(f=>console.error('- '+f));process.exit(1);}
console.log('Public-surface security v775 PASS: public diagnostic/test consoles removed, targeted push uses normal verification UI, compatibility redirect preserved, and current tree has no high-confidence private secrets.');
`);

replaceExact(
  'check-homepage-root-fixes.mjs',
  "import './check-production-acceptance-v774.mjs';\nimport './check-diagnostic-self-consistency-v773.mjs';",
  "import './check-public-surface-security-v775.mjs';\nimport './check-production-acceptance-v774.mjs';\nimport './check-diagnostic-self-consistency-v773.mjs';",
  1,
  'public surface security regression import'
);

const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version='release candidate v775 / live v774';
readiness.last_updated='2026-08-09';
readiness.deployment_identity.release_candidate_version='v775';
readiness.deployment_identity.note='v775 release candidate: remove unreferenced public geolocation diagnostics and redundant public push-beta console; keep targeted push operations behind the existing admin perimeter and point test notifications to the normal Drinks verification UI. Current tree and full Git history audits found zero high-confidence private-secret exposures. Live remains v774 until post-merge edge proof.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const checklist=JSON.parse(read('beta-live-write-checklist.json'));
checklist.site_version='v775';
write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

write('VERSION','v775\n');
const drift=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(drift.status!==0)process.exit(drift.status||1);

for(const temp of [
  'scripts/audit-public-surface-security-v775.mjs',
  'scripts/audit-git-history-secrets-v775.mjs',
  '.github/workflows/v775-public-surface-security-audit.yml',
  'scripts/apply-v775-public-surface-security.mjs',
  '.github/workflows/v775-apply-public-surface-security.yml'
]) if(fs.existsSync(temp)){fs.rmSync(temp);console.log(`removed ${temp}`);}

console.log('v775 public-surface security release candidate generated.');
