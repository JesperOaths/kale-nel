#!/usr/bin/env node
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/final-certification-live-browser-v792.yml', 'utf8');
if (!workflow.includes("token1=\"$(openssl rand -hex 24)\"")) throw new Error('final certification token1 is not 48 hex chars');
if (!workflow.includes("token2=\"$(openssl rand -hex 24)\"")) throw new Error('final certification token2 is not 48 hex chars');
if (!workflow.includes("[[ \"$token1\" =~ ^[0-9a-f]{48}$ ]]")) throw new Error('final certification token1 format assertion missing');
if (!workflow.includes("[[ \"$token2\" =~ ^[0-9a-f]{48}$ ]]")) throw new Error('final certification token2 format assertion missing');
console.log('RESULT=V813_CERT_SESSION_TOKEN_CONTRACT_PASS');
