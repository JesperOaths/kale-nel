#!/usr/bin/env node
import fs from 'node:fs';

const cfg = fs.readFileSync('gejast-config.js','utf8');
const url = cfg.match(/SUPABASE_URL\s*[:=]\s*['"]([^'"]+)/)?.[1] || cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
const key = cfg.match(/SUPABASE_PUBLISHABLE_KEY\s*[:=]\s*['"]([^'"]+)/)?.[1] || cfg.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
if (!url || !key) throw new Error('Public Supabase config not found');

function shape(value, depth=0) {
  if (depth > 4) return typeof value;
  if (Array.isArray(value)) {
    const itemShapes = value.slice(0,3).map(v => shape(v, depth+1));
    return { type:'array', count:value.length, item_shapes:itemShapes };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = shape(v, depth+1);
    return out;
  }
  return value === null ? 'null' : typeof value;
}

async function rpc(name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Accept:'application/json' },
    body:JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}: ${text.slice(0,180)}`);
  const data = text ? JSON.parse(text) : null;
  console.log(`${name.toUpperCase()}_SHAPE=${JSON.stringify(shape(data))}`);
}

await rpc('get_pikken_stats_scoped',{site_scope_input:'friends'});
await rpc('pikken_get_deep_stats_scoped',{site_scope_input:'friends',session_token:null});
console.log('PIKKEN_STATS_SHAPE_PROBE=PASS');
