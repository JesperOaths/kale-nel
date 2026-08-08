import fs from 'node:fs';

const sqlPath = 'GEJAST_v755q_klaverjas_write_boundary_guard.sql';
const sql = fs.readFileSync(sqlPath, 'utf8').toLowerCase();

const mustContain = [
  'superseded / do not apply standalone',
  'never validates or',
  'raise exception',
  'use the reviewed combined v765 klaverjas repair'
];

for (const needle of mustContain) {
  if (!sql.includes(needle)) throw new Error(`v755q superseded guard missing: ${needle}`);
}

const forbidden = [
  'revoke insert, update, delete on table',
  'grant execute on function',
  'create or replace function',
  'drop function',
  'alter table',
  'insert into public.',
  'update public.',
  'delete from public.'
];

for (const needle of forbidden) {
  if (sql.includes(needle)) throw new Error(`superseded v755q must not perform repair behavior: ${needle}`);
}

console.log('Klaverjas v755q superseded safety-stop regression: PASS');
