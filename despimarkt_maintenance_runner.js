#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  const { data, error } = await supabase.rpc('despimarkt_run_background_maintenance', { site_scope_input: null });
  if (error) throw error;
  console.log('despimarkt-maintenance-complete', JSON.stringify(data || {}, null, 2));
}

run().catch((err) => {
  console.error('despimarkt-maintenance-failed', err && (err.message || err));
  process.exit(1);
});
