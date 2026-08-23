#!/usr/bin/env node
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/final-certification-live-browser-v792.yml', 'utf8');
const visual = fs.readFileSync('.github/workflows/full-live-visual-audit-v792.yml', 'utf8');

if (!workflow.includes("token1=\"$(openssl rand -hex 24)\"")) throw new Error('final-cert token1 is not production-format 48-hex');
if (!workflow.includes("token2=\"$(openssl rand -hex 24)\"")) throw new Error('final-cert token2 is not production-format 48-hex');
if (/v792-cert-\$\(openssl rand -hex 32\)/.test(workflow)) throw new Error('legacy prefixed certification token format remains');
if (!workflow.includes('^[0-9a-f]{48}$')) throw new Error('final-cert token format assertion missing');
if (!visual.includes("GEJAST_DATA_PLANE_ATTEMPTS: '3'")) throw new Error('visual data-plane retry contract missing');
if (!visual.includes("GEJAST_DATA_PLANE_TIMEOUT_MS: '8000'")) throw new Error('visual data-plane timeout contract missing');

console.log('RESULT=V813_FINAL_CERT_FIXTURE_CONTRACT_PASS');
