#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
assert(Number(version.replace(/^v/i,''))>=811,'v811+ required');
const src=fs.readFileSync('site-analytics.js','utf8');
assert(src.includes("Object.prototype.hasOwnProperty.call(normalizedPayload, 'site_scope')"),'analytics sendEvent must normalize site_scope');
assert(src.includes("normalizedPayload.extra = Object.assign({}, normalizedPayload.extra || {}, { site_scope: normalizedPayload.site_scope })"),'site_scope must be preserved inside analytics extra metadata');
assert(src.includes('delete normalizedPayload.site_scope'),'unsupported top-level site_scope RPC argument must be removed');
assert(src.includes('const body = JSON.stringify(normalizedPayload);'),'analytics RPC body must serialize normalized payload');
assert(!src.includes('const body = JSON.stringify(payload);'),'raw payload serialization must not bypass normalization');
console.log('PASS v811 analytics RPC contract');
