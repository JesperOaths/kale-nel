#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflowDir = '.github/workflows';
const approvedExact = new Map([
  ['actions/checkout', 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09'],
  ['actions/setup-node', 'a0853c24544627f65ddf259abe73b1d18a591444'],
]);

const workflowFiles = fs.readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();

assert.ok(workflowFiles.length > 0, 'expected tracked GitHub Actions workflows');

const failures = [];
const actions = [];
for (const name of workflowFiles) {
  const file = path.posix.join(workflowDir, name);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const spec = match[1];
    if (spec.startsWith('./')) continue;
    if (spec.startsWith('docker://')) {
      failures.push(`${file}: Docker action references require a separate digest policy: ${spec}`);
      continue;
    }
    const at = spec.lastIndexOf('@');
    if (at <= 0) {
      failures.push(`${file}: external action is missing an immutable ref: ${spec}`);
      continue;
    }
    const action = spec.slice(0, at);
    const ref = spec.slice(at + 1);
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      failures.push(`${file}: ${action} must use a 40-character commit SHA, found ${ref}`);
      continue;
    }
    if (approvedExact.has(action) && approvedExact.get(action) !== ref) {
      failures.push(`${file}: ${action} must use reviewed SHA ${approvedExact.get(action)}, found ${ref}`);
      continue;
    }
    actions.push({ file, action, ref });
  }
}

if (failures.length) {
  console.error('Repository-wide GitHub Actions provenance policy failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

assert.ok(actions.length > 0, 'expected at least one external GitHub Action invocation');
console.log(`Repository-wide GitHub Actions provenance PASS: ${actions.length} external action invocations across ${workflowFiles.length} workflows use immutable commit SHAs.`);
console.log('RESULT=ALL_ACTIONS_SHA_PINNING_V792_PASS');
