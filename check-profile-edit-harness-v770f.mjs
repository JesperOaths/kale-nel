#!/usr/bin/env node
import fs from 'node:fs';

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
const harness = fs.readFileSync('check-beta-live-write-profile.mjs', 'utf8');
const profilePage = fs.readFileSync('my_profile.html', 'utf8');
const failures = [];

const item = checklist.items.find((entry) => entry.id === 'profile_editing');
if (!item) failures.push('profile_editing checklist item missing');
else {
  if (item.command !== 'npm run beta:write:profile') failures.push('profile editing must use only the target-specific profile harness');
  for (const requirement of ['player1', 'live_write_approval']) {
    if (!(item.requires || []).includes(requirement)) failures.push(`profile editing checklist missing ${requirement}`);
  }
  for (const forbidden of ['player2', 'admin_session', 'secondary_target']) {
    if ((item.requires || []).includes(forbidden)) failures.push(`profile editing checklist must not require ${forbidden}`);
  }
}

for (const marker of [
  "const approved = process.env[approvalName] === approvalValue;",
  "if (!approved) missing.push(`${approvalName}=${approvalValue}`);",
  'original = normalizeSettings(await getSettings(sessionToken));',
  'await updateSettings(sessionToken, temporaryName, original.avatar_url);',
  'if (afterChange.avatar_url !== original.avatar_url)',
  '} finally {',
  'await updateSettings(sessionToken, original.display_name, original.avatar_url);',
  'if (restored.display_name !== original.display_name)',
  'if (restored.avatar_url !== original.avatar_url)',
  'State: failed-restoration. Manual profile restoration may be required before any further mutation testing.',
  'Temporary display-name edit was verified and original profile values were restored.',
]) {
  if (!harness.includes(marker)) failures.push(`profile harness missing safety marker: ${marker}`);
}

for (const forbidden of [
  "console.log(playerPin",
  "console.log(sessionToken",
  "console.log(original.avatar_url",
  "console.log(afterChange.avatar_url",
  "avatar_url_input: temporaryName",
]) {
  if (harness.includes(forbidden)) failures.push(`profile harness contains forbidden secret/avatar behavior: ${forbidden}`);
}

if (!profilePage.includes('/rest/v1/rpc/get_my_profile_settings')) failures.push('live profile page no longer uses get_my_profile_settings');
if (!profilePage.includes('/rest/v1/rpc/update_my_profile_settings')) failures.push('live profile page no longer uses update_my_profile_settings');
if (!profilePage.includes('display_name_input:')) failures.push('live profile page profile update contract missing display_name_input');
if (!profilePage.includes('avatar_url_input:currentAvatar')) failures.push('live profile page profile update contract missing avatar_url_input');

if (failures.length) {
  console.error('Reversible profile proof harness v770f failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Reversible profile proof harness v770f PASS: explicit approval, display-name-only mutation, guaranteed restore attempt, and restore verification are present.');
