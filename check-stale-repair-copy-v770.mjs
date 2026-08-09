#!/usr/bin/env node
import fs from 'node:fs';
const ballroom = fs.readFileSync('ballroom.html','utf8');
const live = fs.readFileSync('gejast-live-summary.js','utf8');
const version = fs.readFileSync('VERSION','utf8').trim();
const fixer = fs.readFileSync('fix-version-drift.mjs','utf8');
const failures = [];
if (version !== 'v770') failures.push('root VERSION is not v770');
if (ballroom.includes('Run eerst de balzaal-repair SQL')) failures.push('Ballroom still exposes repair-SQL instructions');
if (!ballroom.includes('Balzaalactie is tijdelijk niet beschikbaar. Vernieuw de pagina en probeer het opnieuw.')) failures.push('Ballroom generic recovery copy missing');
if (live.includes('v488 compat SQL')) failures.push('Live summary still exposes v488 SQL instructions');
if (!live.includes('Live samenvatting kon niet worden geladen. Vernieuw de pagina en probeer het opnieuw.')) failures.push('Live-summary generic recovery copy missing');
if (!ballroom.includes('get_ballroom_state_safe') || !ballroom.includes('get_ballroom_public_state_safe')) failures.push('Ballroom safe read fallback contract changed');
if (!ballroom.includes('ballroom_claim_king_safe') || !ballroom.includes('ballroom_request_entry_safe')) failures.push('Ballroom safe write contract changed');
if (!live.includes('get_live_match_summary_public_scoped') || !live.includes('get_live_match_summary_public')) failures.push('Live-summary scoped/legacy fallback contract changed');
if (!live.includes('get_homepage_live_state_public_scoped') || !live.includes('get_homepage_live_state_public')) failures.push('Homepage scoped/legacy fallback contract changed');
if (!fixer.includes('preserveStaticV762') || !fixer.includes("digits === '762'")) failures.push('version fixer does not preserve only intentional v762 tokens');
if (failures.length) { failures.forEach((x)=>console.error('- '+x)); process.exit(1); }
console.log('v770 stale repair-copy regression PASS.');
