#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(versionNumber<806) throw new Error(`Expected v806+, got ${version}`);
const home=fs.readFileSync('gejast-home-gate.js','utf8');
const cfg=fs.readFileSync('gejast-config.js','utf8');
for(const needle of ["hasAttribute('data-gejast-auth-state')","delegated: 'gejast-auth-gate'","rpc('account_public_state_v687'",'session_token_input: token','site_scope_input: currentScope()']) if(!home.includes(needle)) throw new Error(`Home gate missing: ${needle}`);
if(/get_public_state/.test(home)) throw new Error('Legacy home gate reintroduced invalid get_public_state session probes');
const snapshot=cfg.slice(cfg.indexOf('async function fetchPlayerSessionSnapshot(token){'),cfg.indexOf('function inferRuntimeScope()',cfg.indexOf('async function fetchPlayerSessionSnapshot(token){')));
if(!snapshot.includes('/rest/v1/rpc/account_public_state_v687')) throw new Error('Session snapshot is not canonical account_public_state_v687');
for(const stale of ['get_public_state','get_gejast_homepage_state','get_jas_app_state']) if(snapshot.includes(stale)) throw new Error(`Session snapshot contains stale probe ${stale}`);
const touch=cfg.slice(cfg.indexOf('async function touchPlayerSessionServer(force){'),cfg.indexOf('function touchPlayerActivity(options)',cfg.indexOf('async function touchPlayerSessionServer(force){')));
for(const needle of ['session_token: token','session_token_input: token','page_input:','site_scope_input: inferRuntimeScope()']) if(!touch.includes(needle)) throw new Error(`Touch payload missing ${needle}`);
for(const stale of ['input_token:', '{ token }','const payloads = [']) if(touch.includes(stale)) throw new Error(`Touch path contains stale fallback ${stale}`);
for(const needle of ["fetch('/VERSION?ts=' + Date.now()",'script.src = `/gejast-site-announcements.js?${effectiveVersion}`;','script.src = `/gejast-scope-hardening.js?${effectiveVersion}`;','script.src = `/gejast-v725-repair.js?${effectiveVersion}`;']) if(!cfg.includes(needle)) throw new Error(`Root runtime path missing ${needle}`);
for(const stale of ['./gejast-site-announcements.js','./gejast-scope-hardening.js','./gejast-v725-repair.js',"fetch('./VERSION?ts='"]) if(cfg.includes(stale)) throw new Error(`Nested runtime path remains ${stale}`);
console.log('PASS v806 canonical session runtime and root asset contract');
