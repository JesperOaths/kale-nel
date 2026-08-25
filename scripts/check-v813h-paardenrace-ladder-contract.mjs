#!/usr/bin/env node
import fs from 'node:fs';

const path='GEJAST_v813h_paardenrace_ladder_scratch_contract.sql';
if(!fs.existsSync(path)) throw new Error(`V813H_PAARDENRACE_LADDER_FAIL missing ${path}`);
const sql=fs.readFileSync(path,'utf8');
const need=(token,label)=>{if(!sql.includes(token)) throw new Error(`V813H_PAARDENRACE_LADDER_FAIL ${label}`);};
const forbid=(regex,label)=>{if(regex.test(sql)) throw new Error(`V813H_PAARDENRACE_LADDER_FAIL ${label}`);};

need('create table if not exists public._scratch_paardenrace_history_work','history scratch relation missing');
for(const table of ['_scratch_paardenrace_ladder_work','_scratch_paardenrace_match_participants','_scratch_paardenrace_history_work']){
  need(`revoke all privileges on table public.${table} from public, anon, authenticated;`,`${table} browser revoke missing`);
  need(`grant all privileges on table public.${table} to service_role;`,`${table} service grant missing`);
}
need("pg_get_function_identity_arguments(p.oid) = 'site_scope_input text, limit_count integer'",'exact function signature guard missing');
need("v_result := jsonb_build_object(",'result must be materialized before scratch cleanup');
need('return v_result;','materialized result return missing');
need("raise exception 'expected pre-return cleanup anchor not found'",'function-drift fail-closed guard missing');
need("raise exception 'expected return tail anchor not found'",'return-tail fail-closed guard missing');
forbid(/grant\s+(?:select|insert|update|delete|all privileges)[^;]*_scratch_paardenrace_[^;]*\b(?:anon|authenticated)\b/i,'browser scratch-table grant widened');

const assignment=sql.indexOf('v_result := jsonb_build_object(');
const cleanup=sql.indexOf('delete from public._scratch_paardenrace_match_participants where run_id = v_run_id;',assignment);
const returned=sql.indexOf('return v_result;',cleanup);
if(!(assignment>=0&&cleanup>assignment&&returned>cleanup)) throw new Error('V813H_PAARDENRACE_LADDER_FAIL result/cleanup/return ordering invalid');

console.log('RESULT=V813H_PAARDENRACE_LADDER_CONTRACT_PASS');
