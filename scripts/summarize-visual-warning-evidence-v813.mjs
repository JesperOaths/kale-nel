#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve('visual-audit/report.json');
const jsonOut = path.resolve('visual-audit/warning-summary-v813.json');
const mdOut = path.resolve('visual-audit/warning-summary-v813.md');

if (!fs.existsSync(reportPath)) {
  console.log('VISUAL_WARNING_SUMMARY_UNAVAILABLE report.json missing');
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(report.records) ? report.records : [];
const warnings = rows.filter((row) => String(row.judgement || '').toLowerCase() === 'warn');
const broken = rows.filter((row) => String(row.judgement || '').toLowerCase() === 'broken');

const classCounts = new Map();
const endpointCounts = new Map();
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

function classify(row) {
  const classes = new Set();
  const consoleErrors = Array.isArray(row.console_errors) ? row.console_errors : [];
  const pageErrors = Array.isArray(row.page_errors) ? row.page_errors : [];
  const failedRequests = Array.isArray(row.failed_requests) ? row.failed_requests : [];
  const httpErrors = Array.isArray(row.http_errors) ? row.http_errors : [];
  const reasons = Array.isArray(row.reasons) ? row.reasons : [];

  if (httpErrors.length) classes.add('http_error_response');
  if (failedRequests.some((x) => /net::ERR_ABORTED/i.test(String(x)))) classes.add('aborted_request');
  if (failedRequests.some((x) => !/net::ERR_ABORTED/i.test(String(x)))) classes.add('failed_request_other');
  if (consoleErrors.some((x) => /MIME type .*text\/html.*not executable/i.test(String(x)))) classes.add('script_mime_mismatch');
  if (consoleErrors.some((x) => /Failed to load resource.*status of 4\d\d/i.test(String(x)))) classes.add('console_http_4xx');
  if (consoleErrors.some((x) => /Failed to load resource.*status of 5\d\d/i.test(String(x)))) classes.add('console_http_5xx');
  if (pageErrors.length) classes.add('page_error');
  if (reasons.some((x) => /horizontal overflow/i.test(String(x)))) classes.add('horizontal_overflow');
  if (reasons.some((x) => /loading placeholder/i.test(String(x)))) classes.add('stale_loading');
  if (!classes.size) classes.add('other');

  for (const entry of [...httpErrors, ...failedRequests]) {
    const text = String(entry);
    const match = text.match(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/\S+)/i);
    if (!match) continue;
    try {
      const url = new URL(match[1]);
      bump(endpointCounts, `${url.hostname}${url.pathname}`);
    } catch {}
  }
  return [...classes].sort();
}

const details = [...warnings, ...broken].map((row) => {
  const classes = classify(row);
  for (const key of classes) bump(classCounts, key);
  return {
    judgement: row.judgement,
    route: row.route,
    final_url: row.final_url,
    status: row.status,
    classes,
    reasons: row.reasons || [],
    console_errors: row.console_errors || [],
    page_errors: row.page_errors || [],
    failed_requests: row.failed_requests || [],
    http_errors: row.http_errors || [],
    screenshot: row.screenshot || '',
  };
});

const sortedMap = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const summary = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source_report_generated_at: report.generated_at || null,
  total_records: rows.length,
  warning_count: warnings.length,
  broken_count: broken.length,
  class_counts: Object.fromEntries(sortedMap(classCounts)),
  endpoint_counts: Object.fromEntries(sortedMap(endpointCounts)),
  records: details,
};
fs.writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);

const md = [
  '# Visual warning evidence summary',
  '',
  `Warnings: ${warnings.length}`,
  `Broken: ${broken.length}`,
  '',
  '## Classes',
  '',
  ...(sortedMap(classCounts).length ? sortedMap(classCounts).map(([key, count]) => `- ${key}: ${count}`) : ['- none']),
  '',
  '## Request endpoints',
  '',
  ...(sortedMap(endpointCounts).length ? sortedMap(endpointCounts).map(([key, count]) => `- ${key}: ${count}`) : ['- none']),
  '',
  '## Routes',
  '',
  ...(details.length ? details.map((row) => `- ${String(row.judgement).toUpperCase()} \`${row.route}\` — ${row.classes.join(', ')} — ${(row.reasons || []).join('; ')}`) : ['- none']),
  '',
].join('\n');
fs.writeFileSync(mdOut, md);

console.log(`VISUAL_WARNING_SUMMARY warnings=${warnings.length} broken=${broken.length}`);
for (const [key, count] of sortedMap(classCounts)) console.log(`VISUAL_WARNING_CLASS ${key}=${count}`);
for (const [key, count] of sortedMap(endpointCounts).slice(0, 20)) console.log(`VISUAL_WARNING_ENDPOINT ${key}=${count}`);
console.log('RESULT=VISUAL_WARNING_SUMMARY_PASS');
