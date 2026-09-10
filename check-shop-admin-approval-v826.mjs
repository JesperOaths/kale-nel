#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('admin_shop_orders.html','utf8');
const fn = fs.readFileSync('supabase/functions/shop-admin-orders-v825/index.ts','utf8');
const migration = fs.readFileSync('supabase/migrations/20260910103800_shop_admin_payment_amount_v826.sql','utf8');

assert.match(html, /GEJAST_PAGE_VERSION='v826'/, 'admin shop orders must be v826');
assert.match(html, /Needs action/, 'admin page must expose needs-action view');
assert.match(html, /Amount actually received/, 'admin page must collect actual received amount');
assert.match(html, /Send to Printify/, 'admin page must expose explicit Printify release');
assert.match(html, /paid_amount_cents/, 'admin page must send paid_amount_cents');
assert.match(fn, /paid_amount_cents/, 'admin function must persist paid amount');
assert.match(fn, /payment_amount_insufficient/, 'admin function must reject insufficient payment');
assert.match(fn, /paidAmount<required/, 'Printify release must gate on sufficient payment');
assert.match(migration, /ADD COLUMN IF NOT EXISTS paid_amount_cents integer/i, 'migration must add paid amount');
assert.doesNotMatch(html, /shopify-checkout|Stripe checkout/i, 'admin approval page must not reintroduce legacy checkout');

console.log('RESULT=V826_SHOP_ADMIN_APPROVAL_PASS');
