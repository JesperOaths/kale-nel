#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const score=`<!doctype html><html lang="nl"><head><meta charset="UTF-8"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet,max-image-preview:none"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Klaverjas scorer</title><script>window.GEJAST_PAGE_VERSION='v783';</script><script>(function(){const url=new URL('./klaverjas_scorer_v596_repo_ready.html',location.href);new URLSearchParams(location.search||'').forEach((v,k)=>url.searchParams.set(k,v));location.replace(url.toString());})();</script></head><body><div class="site-credit-watermark" data-version-watermark>v783 · Made by Bruis</div></body></html>\n`;
fs.writeFileSync('score.html',score);

const spectator=`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="robots" content="noindex,nofollow,noarchive,nosnippet,max-image-preview:none"/><title>Pikken spectator</title><script>window.GEJAST_PAGE_VERSION='v783';</script><script>const u=new URL('./pikken_live.html',location.href);const q=new URLSearchParams(location.search);if(q.get('client_match_id'))u.searchParams.set('client_match_id',q.get('client_match_id'));if(q.get('match_ref'))u.searchParams.set('match_ref',q.get('match_ref'));if(q.get('scope')==='family')u.searchParams.set('scope','family');u.searchParams.set('spectator','1');location.replace(u.pathname+u.search+u.hash);</script></head><body><div class="site-credit-watermark" data-version-watermark>v783 · Made by Bruis</div></body></html>\n`;
fs.writeFileSync('pikken_spectator.html',spectator);

fs.writeFileSync('VERSION','v783\n');
execFileSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
checklist.site_version='v783';
if(!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v783 must keep live-write checklist empty');
fs.writeFileSync('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
readiness.site_version='release candidate v783 / live v782';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.release_candidate_version='v783';
readiness.deployment_identity.note='2026-08-10 v783 release candidate: a no-write Chromium runtime-stability audit rendered all 35 authoritative public routes at phone and desktop size (70 combinations). It found zero JavaScript page crashes, zero console-error pages, zero same-origin HTTP 4xx/5xx resources, zero stuck/hidden pages and zero empty pages. The only repeated runtime noise came from score.html and pikken_spectator.html starting gejast-mobile-foundation-v583.js immediately before deliberate location.replace redirects; v783 converts those two aliases to direct redirect-only documents while preserving query/scope forwarding. Production remains live v782 until post-merge v783 proof. The 70/70 naming closure, v779 keyboard baseline, v780 live Chromium/axe proof with zero axe violations, v781 no-write mobile/runtime proof, and v782 no-write responsive proof remain preserved. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security/accessibility regressions through the v783 release candidate. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778; v779 keyboard/focus remains protected; v780 rendered Chromium/axe proof remains preserved with zero axe violations on the nine repaired pages. v781 protects the Drinks stats-queue repair, mobile-sized Drinks/Beerpong targets and the aria-hidden/inert verification-float lifecycle. v782 protects the Drinks bar renderer plus responsive homepage/Klaverjas layout owners and intentional Boerenbridge scrolling. v783 protects direct runtime-light score/Pikken spectator redirect aliases.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='Live production remains v782 until v783 is merged and edge-proven. The v782 post-merge public-edge proof reports hardened 35-route PASS with isolated no-write responsive Chromium coverage. The prior isolated no-write live mobile Chromium proof remains preserved with no Drinks stats-queue ReferenceError, the hidden verification float inert/non-focusable, >=44px Drinks selector and >=24px scoped Beerpong targets. The v783 70-combination runtime audit is pre-merge candidate evidence only.';
if((readiness.beta_gaps||[]).filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12');
if((readiness.beta_gaps||[]).some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('unexpected readiness gap');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!pkg.scripts?.['verify:static']) throw new Error('verify:static missing');
if(!pkg.scripts['verify:static'].includes('check-redirect-alias-runtime-v783.mjs')) pkg.scripts['verify:static'] += ' && node check-redirect-alias-runtime-v783.mjs';
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
console.log('v783 runtime-clean alias release candidate prepared.');
