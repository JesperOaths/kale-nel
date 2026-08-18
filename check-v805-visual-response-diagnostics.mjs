#!/usr/bin/env node
import fs from 'node:fs';
const s=fs.readFileSync('scripts/full-live-visual-audit-v792.mjs','utf8');
const required=[
  "const httpErrors = [];",
  "page.on('response', (res) =>",
  "httpErrors.push(`${request.method()} ${res.url()} :: HTTP ${status}`)",
  "const seriousHttpErrors = httpErrors.filter",
  "http_errors: seriousHttpErrors.slice(0, 20)",
  "HTTP error response(s)"
];
for(const needle of required){if(!s.includes(needle)){console.error(`Missing visual HTTP diagnostic contract: ${needle}`);process.exit(1);}}
console.log('PASS exact visual HTTP response diagnostics');
