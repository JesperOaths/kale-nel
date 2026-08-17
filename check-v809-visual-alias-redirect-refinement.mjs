#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = fs.readFileSync('.github/workflows/full-live-visual-audit-v792.yml', 'utf8');
const refinerPath = path.resolve('scripts/refine-expected-visual-aliases-v809.mjs');
const refiner = fs.readFileSync(refinerPath, 'utf8');

assert.match(workflow, /scripts\/refine-expected-visual-aliases-v809\.mjs/, 'visual workflow must track the expected-alias refiner');
assert.match(workflow, /node --check scripts\/refine-expected-visual-aliases-v809\.mjs/, 'visual workflow must syntax-check the expected-alias refiner');
assert.match(workflow, /- name: Screenshot and inspect every tracked live HTML page\s*\n\s*if:\s*always\(\) && \(steps\.data_plane\.outcome == 'failure' \|\| steps\.provision\.outcome == 'success' \|\| steps\.provision\.outcome == 'failure'\)[\s\S]*?continue-on-error:\s*\$\{\{ steps\.provision\.outcome == 'success' \}\}/, 'authenticated capture must preserve the existing trigger and continue only far enough to run fail-closed alias refinement');
assert.match(workflow, /- name: Refine declared authenticated redirect aliases[\s\S]*?if:\s*always\(\) && steps\.provision\.outcome == 'success'[\s\S]*?node scripts\/refine-expected-visual-aliases-v809\.mjs/, 'alias refinement must run only after authenticated fixture provisioning and even when raw capture reports broken aliases');
assert.match(workflow, /- name: Upload visual audit artifact\s*\n\s*if:\s*always\(\)/, 'artifact upload must remain available after a fail-closed refinement failure');
assert.match(workflow, /- name: Cleanup disposable visual-audit state\s*\n\s*if:\s*always\(\) && \(steps\.provision\.outcome == 'success' \|\| steps\.provision\.outcome == 'failure'\)/, 'fixture cleanup must remain unconditional after attempted authenticated provisioning');

assert.ok(refiner.includes("source.match(/window\\.location\\.replace"), 'refiner must derive redirect intent from the checked-in alias source');
assert.match(refiner, /finalUrl\.href === target\.href/, 'public aliases must match the exact declared redirect destination');
assert.match(refiner, /finalUrl\.hostname === 'admin\.kalenel\.nl'/, 'protected alias refinement must require the live admin hostname');
assert.match(refiner, /samePathAndQuery\(target, finalUrl\)/, 'protected alias refinement must preserve the declared path and query');
assert.match(refiner, /String\(record\?\.title \|\| ''\) === 'Kalenel admin login'/, 'protected aliases must visibly reach the admin login perimeter');
assert.match(refiner, /Admin login vereist/, 'protected aliases must visibly render the admin login requirement');
assert.match(refiner, /reasons\.length === 1/, 'refiner must not erase unrelated broken reasons');
assert.match(refiner, /remaining_broken/, 'remaining genuine broken pages must still fail the workflow');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gejast-v809-'));
try {
  fs.mkdirSync(path.join(tmp, 'visual-audit'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'familie'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'familie/request.html'), `<!doctype html><script>window.location.replace('../request.html?scope=family');</script>`);
  fs.writeFileSync(path.join(tmp, 'familie/vault.html'), `<!doctype html><script>window.location.replace('../vault.html?scope=family');</script>`);

  const baseRecord = {
    kind: 'tracked', judgement: 'broken', reasons: ['auth gate did not settle within 12000ms (last state missing)'],
    body_chars: 200, issue_signals: [], page_errors: [], status: 200, horizontal_overflow_px: 0, stale_loading_count: 0,
    screenshot: 'screenshots/test.jpg', failed_requests: [], console_errors: [], label: 'fixture',
  };
  const report = {
    schema_version: 1, generated_at: '2026-08-18T00:00:00Z', degraded_fixture_mode: false, certification_eligible: true,
    tracked_html_count: 2, contextual_route_count: 0, total_screenshots: 2,
    counts: { broken: 2 },
    records: [
      { ...baseRecord, route: 'familie/request.html', requested_url: 'https://kalenel.nl/familie/request.html', final_url: 'https://kalenel.nl/request.html?scope=family', title: 'Naam claimen', body_preview: 'Naam claimen' },
      { ...baseRecord, route: 'familie/vault.html', requested_url: 'https://kalenel.nl/familie/vault.html', final_url: 'https://admin.kalenel.nl/vault.html?scope=family', title: 'Kalenel admin login', body_preview: 'Admin login vereist Reden: session_required' },
    ],
  };
  fs.writeFileSync(path.join(tmp, 'visual-audit/report.json'), `${JSON.stringify(report)}\n`);
  const ok = spawnSync(process.execPath, [refinerPath], { cwd: tmp, encoding: 'utf8' });
  assert.equal(ok.status, 0, `expected-alias fixture must pass: ${ok.stdout}\n${ok.stderr}`);
  const refined = JSON.parse(fs.readFileSync(path.join(tmp, 'visual-audit/report.json'), 'utf8'));
  assert.equal(refined.counts.broken || 0, 0, 'expected aliases must remove only their false broken classifications');
  assert.equal(refined.counts.pass, 1, 'exact public alias should become pass');
  assert.equal(refined.counts.protected, 1, 'matching admin alias should become protected');
  assert.equal(refined.expected_alias_redirect_count, 2, 'both grounded aliases should be recorded');

  fs.writeFileSync(path.join(tmp, 'other.html'), '<!doctype html><title>Not an alias</title>');
  const failReport = {
    ...report,
    tracked_html_count: 1,
    total_screenshots: 1,
    counts: { broken: 1 },
    records: [{ ...baseRecord, route: 'other.html', requested_url: 'https://kalenel.nl/other.html', final_url: 'https://kalenel.nl/other.html', title: 'Other', body_preview: 'Other page' }],
  };
  fs.writeFileSync(path.join(tmp, 'visual-audit/report.json'), `${JSON.stringify(failReport)}\n`);
  const bad = spawnSync(process.execPath, [refinerPath], { cwd: tmp, encoding: 'utf8' });
  assert.notEqual(bad.status, 0, 'non-alias broken auth-gate result must remain fail-closed');
  const remained = JSON.parse(fs.readFileSync(path.join(tmp, 'visual-audit/report.json'), 'utf8'));
  assert.equal(remained.counts.broken, 1, 'unexpected broken record must not be reclassified');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('RESULT=V809_VISUAL_ALIAS_REDIRECT_REFINEMENT_PASS');
