#!/usr/bin/env node
import fs from 'node:fs';

const source = fs.readFileSync('check-live-data-plane.mjs', 'utf8');
if (!source.includes('attempts > 3')) throw new Error('data-plane probe must allow the workflow-configured third attempt');
if (!source.includes('attempts < 1')) throw new Error('data-plane probe lost lower bound validation');
if (!source.includes('timeoutMs > 15000')) throw new Error('data-plane probe lost bounded timeout validation');
if (!source.includes('retryDelayMs > 2000')) throw new Error('data-plane probe lost bounded retry delay validation');
console.log('RESULT=V813_DATA_PLANE_PROBE_CONTRACT_PASS');
