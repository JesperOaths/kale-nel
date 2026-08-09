#!/usr/bin/env node
import fs from 'node:fs';

const path='beta-readiness.json';
const data=JSON.parse(fs.readFileSync(path,'utf8'));
data.site_version='live v771 / current frontend release v771';
data.last_updated='2026-08-09';
if(!data.deployment_identity) throw new Error('deployment_identity missing');
data.deployment_identity.status='verified_complete';
data.deployment_identity.live_version='v771';
data.deployment_identity.frontend_release_merge='98fbeee1e1c3622d48fbd3a1836d332244a3e43b';
data.deployment_identity.repository_head_at_audit='98fbeee1e1c3622d48fbd3a1836d332244a3e43b';
data.deployment_identity.note='2026-08-09 post-merge proof confirmed deployed /VERSION v771, all 35 hardened live routes healthy, truthful Rad Kiezen/gekozen copy deployed, old false persistence copy absent, and push health PASS without a send.';
const live=data.baseline_checks?.find((item)=>item.id==='live_routes');
if(live) live.evidence='2026-08-09 post-merge production proof reports live VERSION v771 and 35/35 critical routes healthy; apex admin redirects to the protected admin host and unauthenticated admin returns 401. Deployed Rad truthful nomination copy is present.';
const secondary=data.beta_gaps?.find((item)=>item.id==='secondary_game_save_flows');
if(secondary) secondary.latest_probe='Existing Klaverjas/Beerpong/Boerenbridge production evidence remains valid. Post-merge v771 proof confirmed active Rad target nomination is explicitly local-only (`Kiezen` / `gekozen`) while self-drink outcomes continue through GEJAST_DRINKS_WORKFLOW.createDrinkEvent.';
fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n','utf8');
console.log('Recorded final live v771 proof in beta-readiness.json.');
