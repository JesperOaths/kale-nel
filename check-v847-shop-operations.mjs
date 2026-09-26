#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const migration=read('supabase/migrations/20260920173000_shop_operations_hardening_v847.sql');
const schedulerMigration=read('supabase/migrations/20260920180500_shop_ops_one_time_scheduler_tokens_v847b.sql');
const resilienceMigration=read('supabase/migrations/20260926033000_shop_ops_v858_resilience.sql');
const ops=read('supabase/functions/shop-ops-v847/index.ts');
const core=read('supabase/functions/_shared/shop-ops-core-v847.mjs');
const checks=read('supabase/functions/_shared/shop-ops-checks-v847.mjs');
const analytics=read('supabase/functions/shop-admin-analytics-v843/index.ts');
const catalog=read('supabase/functions/shop-catalog-v828/index.ts');
const orders=read('supabase/functions/shop-admin-orders-v825/index.ts');
const exportFn=read('supabase/functions/shop-admin-export-v847/index.ts');
const page=read('admin_shop_operations.html');
const orderPage=read('admin_shop_orders.html');
const nav=read('admin-topnav.js');
const scheduler=read('.github/workflows/shop-operations-v847.yml');
const schedulerRunner=read('scripts/run-shop-ops-v847.mjs');
const marginDiagnosticSelfTest=read('scripts/verify-shop-margin-diagnostic-v847.mjs');
const deploy=read('.github/workflows/deploy-shop-fixes-v829.yml');
const adminDeploy=read('.github/workflows/deploy-admin-worker.yml');

for(const marker of ['shop_ops_settings_v847','shop_ops_state_v847','shop_alerts_v847','shop_catalog_drift_v847','shop_backup_snapshots_v847','shop_owner_briefs_v847','shop_payment_fee_rules_v847','shop_tax_invoice_settings_v847','shop_invoices_v847','shop_apply_payment_fee_v847','shop_issue_invoice_v847','admin_list_security_v847','admin_revoke_trusted_device_v847','admin_revoke_session_v847','admin_revoke_other_sessions_v847']) assert.ok(migration.includes(marker), 'migration missing '+marker);
assert.match(migration,/tax_calculation_enabled boolean not null default false/);
assert.match(migration,/\('bunq_me',false,0,0/);
assert.match(migration,/\('tikkie',false,0,0/);
assert.match(migration,/alter table public\.shop_alerts_v847 enable row level security/);
assert.match(migration,/revoke all on table public\.shop_alerts_v847 from public, anon, authenticated/);
assert.match(schedulerMigration,/shop_ops_scheduler_tokens_v847/);
assert.match(schedulerMigration,/shop_ops_mint_scheduler_token_v847/);
assert.match(schedulerMigration,/revoke all on function public\.shop_ops_mint_scheduler_token_v847\(\) from public, anon, authenticated/);
assert.match(schedulerMigration,/grant execute on function public\.shop_ops_mint_scheduler_token_v847\(\) to service_role/);

assert.match(analytics,/service_role_action_not_allowed/);
assert.ok(analytics.includes('["refresh_costs","refresh_costs_only"]'));
assert.match(ops,/mode:"shop-ops-v847"/);
assert.match(ops,/consumeSchedulerToken/);
assert.match(ops,/x-shop-ops-token/);
assert.match(ops,/shop_ops_scheduler_tokens_v847/);
assert.match(ops,/localHour/);
assert.match(ops,/hour>=7/);
assert.match(ops,/restore_missing_orders/);
assert.match(ops,/RESTORE_MISSING_ORDERS/);
assert.match(ops,/security_revoke_device/);
assert.match(ops,/security_revoke_session/);
assert.match(ops,/security_revoke_others/);

for(const marker of ['createBackup','generateBrief','notifyNewAlerts']) assert.ok(core.includes(marker));
for(const marker of ['pending_stale','paid_not_submitted','production_stuck','shipped_no_tracking','telemetry_stale','catalogDiff','cost_change','low_margin','shop_issue_invoice_v847','shop_apply_payment_fee_v847']) assert.ok(checks.includes(marker),'checks missing '+marker);

for(const marker of ['whole_euro_threshold_price_cents','threshold_gap_cents','diagnostic_basis','pricing_action:"none"']) assert.ok(checks.includes(marker),'low-margin diagnostic missing '+marker);
assert.match(page,/function marginDetails\(x\)/);
assert.match(page,/diagnostic only; no price is changed automatically/i);
assert.match(page,/whole-euro shop price/i);
assert.doesNotMatch(checks,/action\s*[:=]\s*["'](?:set|update|change)[_-]?price["']/i,'low-margin monitoring must not mutate prices');
assert.doesNotMatch(page,/data-(?:set|update|change)-price/i,'operations page must not expose automatic repricing controls');

assert.match(catalog,/const priced = available;/);
assert.match(catalog,/variants: available/);
assert.doesNotMatch(catalog,/available\.length \? available : variants/);
assert.match(orders,/shop_apply_payment_fee_v847/);
assert.match(orders,/shop_issue_invoice_v847/);
assert.match(orders,/payment_fee_cents/);
assert.match(orders,/invoice_number/);

assert.match(exportFn,/shop-admin-export-v847/);
assert.match(exportFn,/XLSX\.utils\.book_append_sheet/);
assert.match(exportFn,/bruis-bookkeeping-/);
for(const marker of ['Shop operations','Alerts','Automation settings','Monthly bookkeeping export','Payment-fee rules','Invoice & VAT settings','Backups & restore','Admin sessions & trusted computers']) assert.ok(page.includes(marker),'page missing '+marker);
assert.match(nav,/admin_shop_operations\.html/);
assert.match(scheduler,/cron: '37 \* \* \* \*'/);
assert.match(scheduler,/SUPABASE_SERVICE_ROLE_KEY/);
assert.match(scheduler,/shop-ops-v847/);
assert.match(scheduler,/scripts\/run-shop-ops-v847\.mjs plan/);
assert.match(scheduler,/scripts\/run-shop-ops-v847\.mjs run_costs/);
assert.match(scheduler,/scripts\/run-shop-ops-v847\.mjs run_catalog/);
assert.match(scheduler,/scripts\/run-shop-ops-v847\.mjs run_orders/);
assert.match(scheduler,/scripts\/run-shop-ops-v847\.mjs run_backup/);
assert.match(scheduler,/scripts\/verify-shop-margin-diagnostic-v847\.mjs/);
assert.match(marginDiagnosticSelfTest,/pricing_action!=='none'/);
assert.match(marginDiagnosticSelfTest,/whole_euro_threshold_price_cents/);
assert.match(marginDiagnosticSelfTest,/margin-diagnostic-self-test/);
assert.match(schedulerRunner,/shop_ops_mint_scheduler_token_v858/);
assert.match(schedulerRunner,/source_input:'github_actions'/);
assert.match(resilienceMigration,/shop_ops_mint_scheduler_token_v858/);
assert.match(resilienceMigration,/shop_ops_scheduler_health_v858/);
assert.match(resilienceMigration,/database_cron/);
assert.match(ops,/shop_ops_scheduler_health_v858/);
assert.match(ops,/admin_c720p_health_v858/);
assert.match(schedulerRunner,/function mintOnce\(\)/);
assert.match(schedulerRunner,/attempt<=3/);
assert.match(schedulerRunner,/Transient scheduler-token mint failure; retrying/);
assert.ok(schedulerRunner.includes('curl failed \\(28\\)'), 'scheduler retry must recognize curl timeout exit 28');
assert.match(schedulerRunner,/x-shop-ops-token/);
assert.match(schedulerRunner,/170000/);
assert.match(deploy,/deploy_function shop-ops-v847/);
assert.match(deploy,/deploy_function shop-admin-export-v847/);
assert.match(deploy,/deploy_function shop-admin-orders-v825/);
assert.ok(adminDeploy.includes("['admin_shop_operations.html', 'v858']"));
assert.match(page,/Review order/);
assert.match(page,/admin_shop_orders\.html\?filter=stale&order=/);
assert.match(orderPage,/data-filter="stale">Stale unpaid/);
assert.match(orderPage,/function stalePending\(o\)/);
assert.match(orderPage,/unpaid \$\{Math\.floor\(pendingAgeDays\(o\)\)\}d/);
assert.match(orderPage,/const focusOrderId=String\(query\.get\('order'\)/);
assert.match(orders,/production_notified_at/);
assert.match(orders,/is now in production/);
assert.match(orders,/notifyProduction/);

for(const [name,source] of [['ops',ops],['checks',checks],['operations page',page],['order admin',orders]]){
  assert.doesNotMatch(source,/action\s*===\s*["'](?:refund|chargeback)["']/i,name+' must not add refund/chargeback actions');
  assert.doesNotMatch(source,/data-action=["'](?:refund|chargeback)["']/i,name+' must not expose refund/chargeback controls');
}

console.log('v847 shop operations hardening checks passed');
