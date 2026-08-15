#!/usr/bin/env node
import fs from 'node:fs';

const path = '.github/workflows/setup-beta-users.yml';
const text = fs.readFileSync(path, 'utf8');
const failures = [];

function requireMatch(re, message) {
  if (!re.test(text)) failures.push(message);
}
function forbidMatch(re, message) {
  if (re.test(text)) failures.push(message);
}

requireMatch(/on:\s*\n\s*workflow_dispatch:/m, 'beta provisioning must remain workflow_dispatch-only');
forbidMatch(/^\s{2}push:/m, 'beta provisioning must not run automatically on push');
requireMatch(/BETA1_PIN:\s*\$\{\{\s*secrets\.BETA1_PIN\s*\}\}/, 'BETA1_PIN must come from a GitHub secret');
requireMatch(/BETA2_PIN:\s*\$\{\{\s*secrets\.BETA2_PIN\s*\}\}/, 'BETA2_PIN must come from a GitHub secret');
requireMatch(/\^\[0-9\]\{4\}\$/, 'beta provisioning must validate four-digit PINs');
requireMatch(/BETA1_PIN"\s*=\s*"\$BETA2_PIN/, 'beta provisioning must reject identical test-account PINs');
requireMatch(/::add-mask::\{hashed\}/, 'generated bcrypt hashes must be masked at runtime');
forbidMatch(/crypt\(['"]1234['"]/, 'known beta PIN must not be embedded in provisioning code');
forbidMatch(/BETA[12]_PIN:\s*['"]?1234['"]?/i, 'known beta PIN must not be assigned in workflow environment');
forbidMatch(/steps\.hashes\.outputs\.BETA[12]_HASH/, 'generated hashes must not be interpolated into workflow command text');

if (failures.length) {
  console.error(`Beta provisioning workflow guard failed for ${failures.length} item(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Beta provisioning workflow guard ok: manual-only, secret PINs, distinct validation, runtime hash masking.');
