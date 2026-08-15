#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const repoGuard = "github.repository == 'JesperOaths/kale-nel'";
const mainGuard = "github.ref == 'refs/heads/main'";
const checkoutV5 = 'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09';

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

console.log('Privileged manual workflow guard PASS.');
console.log('RESULT=PRIVILEGED_MANUAL_WORKFLOWS_V792_PASS');
