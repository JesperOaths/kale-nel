#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const repoGuard = "github.repository == 'JesperOaths/kale-nel'";
const mainGuard = "github.ref == 'refs/heads/main'";
const checkoutV5 = 'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09';
const setupNodeV5 = 'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function guard(path, text) {
  assert.match(text, /on:\s*\n\s*workflow_dispatch:/m, `${path} must remain manually dispatched`);
  for (const trigger of ['push', 'pull_request', 'schedule']) {
    assert.doesNotMatch(text, new RegExp(`^\\s{2}${trigger}:`, 'm'), `${path} must not gain automatic ${trigger} execution`);
  }
  assert.ok(text.includes(repoGuard), `${path} must stay bound to the canonical repository`);
  assert.ok(text.includes(mainGuard), `${path} must refuse non-main execution`);
}

const repairPath = '.github/workflows/apply-repair-sql.yml';
const repair = read(repairPath);
guard(repairPath, repair);
assert.match(repair, /SQL_FILE_INPUT:\s*\$\{\{\s*inputs\.sql_file\s*\}\}/, 'repair filename input must enter shell through env');
assert.match(repair, /sql_file="\$SQL_FILE_INPUT"/, 'repair filename validation must consume the env value');
assert.doesNotMatch(repair, /sql_file="\$\{\{\s*inputs\.sql_file\s*\}\}"/, 'repair filename must not be interpolated into shell source');
assert.ok(repair.includes(`uses: ${checkoutV5}`), 'repair checkout must use the approved immutable checkout v5 commit');
assert.match(repair, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/, 'repair checkout must pin the dispatched main SHA');

const gamePath = '.github/workflows/controlled-live-game-flows.yml';
const game = read(gamePath);
guard(gamePath, game);
assert.ok(game.includes(`uses: ${checkoutV5}`), 'controlled game checkout must use the approved immutable checkout v5 commit');
assert.match(game, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/, 'controlled game checkout must pin the dispatched main SHA');

const betaPath = '.github/workflows/setup-beta-users.yml';
const beta = read(betaPath);
guard(betaPath, beta);

const adminDeployPath = '.github/workflows/deploy-admin-worker.yml';
const adminDeploy = read(adminDeployPath);
guard(adminDeployPath, adminDeploy);
assert.ok(adminDeploy.includes(`uses: ${checkoutV5}`), 'admin Worker deploy checkout must use the approved immutable checkout v5 commit');
assert.ok(adminDeploy.includes(`uses: ${setupNodeV5}`), 'admin Worker deploy must use the approved immutable setup-node v5 commit');
assert.match(adminDeploy, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/, 'admin Worker deploy checkout must pin the dispatched main SHA');
assert.match(adminDeploy, /CONFIRMATION_INPUT:\s*\$\{\{\s*inputs\.confirmation\s*\}\}/, 'admin Worker confirmation input must enter shell through env');
assert.match(adminDeploy, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFARE_API_TOKEN_ONE\s*\}\}/, 'admin Worker deploy must source API token from the configured Actions secret');
assert.match(adminDeploy, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/, 'admin Worker deploy must source account ID from Actions secrets');
assert.match(adminDeploy, /npx --yes wrangler@4\.118\.0 deploy --config cloudflare\/workers\/admin-gate\/wrangler\.toml\s*$/m, 'admin Worker deploy must use the pinned known-good Wrangler version');
assert.ok(adminDeploy.includes('admin_shop_orders.html'), 'admin Worker deploy must verify the v826 Shop orders asset before deployment');
assert.ok(adminDeploy.includes("[[ \"$admin_status\" == '401' ]]"), 'admin Worker deploy must verify the Shop orders page remains protected after deployment');
assert.doesNotMatch(adminDeploy, /\bCLOUDFLARE_API_TOKEN\s*=\s*['\"][^$]/, 'Cloudflare API token must never be embedded in workflow source');

console.log('Privileged manual workflow guard PASS.');
console.log('RESULT=PRIVILEGED_MANUAL_WORKFLOWS_V792_PASS');
