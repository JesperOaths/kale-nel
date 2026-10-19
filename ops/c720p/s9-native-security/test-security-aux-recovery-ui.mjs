#!/usr/bin/env node
// Structural + syntax contract for recovery viewer: never inflate originals.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./security-review-v8.html',import.meta.url),'utf8');
const id='s9-aux-recovery-ui';
const start=html.indexOf('<script id="'+id+'">');
assert.ok(start>0,'recovery viewer present');
const js=html.slice(start+('<script id="'+id+'">').length,html.indexOf('</script>',start));
new Function(js);
for(const token of ['id="auxRecovery"','id="auxRecoveryList"','id="auxRecoverySearch"',
  'id="auxRecoveryPrev"','id="auxRecoveryNext"',
  "relay.fetch('/new/api/s9-auxiliary-recovery'",
  "relay.url('/new/saved/recovery/clip/'",
  "data.not_counted_in_archive_or_person_analytics!==true",
  'data.full_frame_decode_verified!==false',
  "panel.addEventListener('toggle'"])assert.ok(html.includes(token),'missing '+token);
const startCore=html.indexOf('<script id="s9v8-review-script">');
const core=html.slice(startCore+'<script id="s9v8-review-script">'.length,html.indexOf('</script>',startCore));
new Function(core);
assert.match(html,/v817 - Made by Bruis/);
assert.match(html,/.evidence-mode #auxRecovery\{display:none\}/);
assert.ok(!js.includes('manual-recording-links'),'Recovery must not make human review decisions');
assert.ok(!js.includes('data.files.concat(state.all)'),'Recoverable companions cannot inflate originals');
console.log('SECURITY_AUX_RECOVERY_VIEWER_SAFE_COMPILE_PASS');
