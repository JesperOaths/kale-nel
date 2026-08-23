#!/usr/bin/env node
import fs from 'node:fs';

const configText = fs.readFileSync('gejast-config.js', 'utf8');
const supabaseUrl = configText.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1]?.replace(/\/+$/, '');
const publishableKey = configText.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/)?.[1]?.trim();
const timeoutMs = Number(process.env.GEJAST_DATA_PLANE_TIMEOUT_MS || 10000);
const attempts = Number(process.env.GEJAST_DATA_PLANE_ATTEMPTS || 3);
const retryDelayMs = Number(process.env.GEJAST_DATA_PLANE_RETRY_DELAY_MS || 750);
const rpcName = 'account_public_state_v687';
const invalidSession = '000000000000000000000000000000000000000000000000';

if (!supabaseUrl || !publishableKey) throw new Error('DATA_PLANE_FAIL checked-in Supabase public config unavailable');
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000) throw new Error(`DATA_PLANE_FAIL timeout out of bounds: ${timeoutMs}`);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error(`DATA_PLANE_FAIL attempts out of bounds: ${attempts}`);
if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 2000) throw new Error(`DATA_PLANE_FAIL retry delay out of bounds: ${retryDelayMs}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      body: JSON.stringify({
        session_token: invalidSession,
        session_token_input: invalidSession,
        site_scope_input: 'friends',
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new Error(`non_json_response status=${response.status}`); }

    if (!response.ok) {
      const detail = String(data?.message || data?.error || data?.details || data?.hint || '').replace(/\s+/g, ' ').slice(0, 240);
      throw new Error(`http_${response.status}${detail ? ` ${detail}` : ''}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.ok !== 'boolean') {
      throw new Error(`unexpected_contract ok_type=${typeof data?.ok}`);
    }
    if (data.ok === true) throw new Error('invalid_session_authenticated');

    const elapsed = Date.now() - started;
    console.log(`DATA_PLANE_PASS rpc=${rpcName} invalid_session_rejected=true attempt=${attempt} elapsed_ms=${elapsed}`);
    return true;
  } catch (error) {
    const elapsed = Date.now() - started;
    const reason = error?.name === 'AbortError' ? `timeout_${timeoutMs}ms` : String(error?.message || error).replace(/\s+/g, ' ').slice(0, 320);
    console.error(`DATA_PLANE_ATTEMPT_FAIL rpc=${rpcName} attempt=${attempt}/${attempts} elapsed_ms=${elapsed} reason=${reason}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  if (await probe(attempt)) process.exit(0);
  if (attempt < attempts) await sleep(retryDelayMs);
}

console.error(`DATA_PLANE_FAIL rpc=${rpcName} attempts=${attempts} auth_data_plane_unreachable_or_contract_broken=true`);
process.exit(1);
