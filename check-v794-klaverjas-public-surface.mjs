#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

assert.equal(fs.readFileSync('VERSION','utf8').trim(),'v794','v794 public-surface cleanup must carry VERSION v794');

const index=fs.readFileSync('index.html','utf8');
assert(!index.includes('homeKlaverjasLiveEntry'),'homepage must not expose a duplicate Klaverjas live tile');
assert.equal((index.match(/id="homeKlaverjasEntry"/g)||[]).length,1,'homepage must expose exactly one Klaverjas score-form tile');
assert.equal((index.match(/<div class=\"page-link-label\">Klaverjas online<\/div>/g)||[]).length,1,'homepage must expose exactly one Klaverjas online tile');

for (const required of ['score.html','scorer.html','klaverjas_online.html','leaderboard.html']) {
  assert.ok(fs.existsSync(required),`canonical Klaverjas surface missing: ${required}`);
}
for (const obsolete of ['klaverjas/score.html','klaverjas/leaderboard.html','klaverjas/score.js','klaverjas/style.css']) {
  assert.ok(!fs.existsSync(obsolete),`obsolete nested Klaverjas prototype must stay removed: ${obsolete}`);
}

const quick=fs.readFileSync('klaverjas_quick_stats_v596_repo.html','utf8');
assert(quick.includes("sessionStorage.getItem('klaverjas_repo_match_id_v596')"),'quick stats must still accept an existing match context');
assert(quick.includes("new URL('./leaderboard.html',location.href)"),'contextless quick-stats route must hand off to the canonical leaderboard');
assert(quick.includes("if(!q.get('match_id')&&!stored)"),'quick stats must redirect only when no match context exists');

const activeFiles=fs.readdirSync('.',{withFileTypes:true})
  .filter((entry)=>entry.isFile() && /\.(?:html|js|css)$/i.test(entry.name))
  .map((entry)=>entry.name);
for (const file of activeFiles) {
  const body=fs.readFileSync(file,'utf8');
  for (const obsolete of ['klaverjas/score.html','klaverjas/leaderboard.html','klaverjas/score.js','klaverjas/style.css']) {
    assert.ok(!body.includes(obsolete),`${file} must not reference removed prototype ${obsolete}`);
  }
}

console.log('v794 canonical Klaverjas public surface ok.');
