#!/usr/bin/env node
import fs from 'node:fs';
import './check-diagnostic-self-consistency-v773.mjs';
import './check-finalization-residue-v772.mjs';

const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const liveSummary = fs.readFileSync(new URL('./gejast-live-summary.js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!/Live-ready/i.test(index), 'Active homepage owner must not contain Live-ready fallback text');
assert(/setHomepageLiveState\('standby', 'Stand-by'\)/.test(index), 'Homepage owner must set failed ladder state to Stand-by');
assert(/id="homeToepenEntry"[\s\S]*href="\.\/toepen\.html"/.test(index), 'Homepage markup must include native Toepen entry');
assert(/href="\.\/admin\.html" class="admin-badge"/.test(index), 'Homepage admin badge must point to reachable protected admin login in source markup');
assert(/mode:'seconds'[\s\S]{0,140}key:'\.\/drinks_speed\.html'|key:'\.\/drinks_speed\.html'[\s\S]{0,140}mode:'seconds'/.test(index), 'Speed-ranking card route must be drinks_speed.html in the renderer');
assert(!/livePill\.textContent='Stand-by'/.test(liveSummary), 'Live summary must not rewrite Live-ready as a DOM workaround');
assert(!/createElement\('a'\)[\s\S]{0,500}homeToepenEntry/.test(liveSummary), 'Live summary must not inject Toepen as a DOM workaround');
assert(!/stopImmediatePropagation\(\)/.test(liveSummary), 'Live summary must not capture/intercept speed-card clicks');

console.log('Homepage root-fix regression ok.');
