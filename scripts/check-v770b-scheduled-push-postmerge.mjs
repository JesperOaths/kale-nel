#!/usr/bin/env node
const repo = process.env.GEJAST_GITHUB_REPO || 'JesperOaths/kale-nel';
const workflow = process.env.GEJAST_PUSH_WORKFLOW || 'web-push-dispatcher.yml';
const expectedSha = process.env.GEJAST_EXPECTED_PUSH_HEAD_SHA || '656886435b9c4dfa5c9cb3b5d9b99af112238b16';
const timeoutSeconds = Math.max(30, Number(process.env.GEJAST_PUSH_SCHEDULE_WAIT_SECONDS || 480));
const deadline = Date.now() + timeoutSeconds * 1000;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function readRuns() {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?event=schedule&per_page=20`;
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gejast-v770b-postmerge-proof' } });
  if (!response.ok) throw new Error(`GitHub scheduled workflow runs HTTP ${response.status}`);
  return response.json();
}

for (;;) {
  const data = await readRuns();
  const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
  const run = runs.find((item) => item?.head_sha === expectedSha);
  if (run) {
    console.log(`SCHEDULED_PUSH_RUN id=${run.id} number=${run.run_number} status=${run.status} conclusion=${run.conclusion || 'none'} head=${run.head_sha} created=${run.created_at}`);
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Scheduled Node24 push run completed with ${run.conclusion || 'unknown'}`);
      console.log('v770b scheduled push post-merge proof PASS.');
      process.exit(0);
    }
  } else {
    const latest = runs[0];
    console.log(`Waiting for scheduled push run on ${expectedSha}; latest=${latest?.head_sha || 'none'} #${latest?.run_number || 'none'} ${latest?.status || 'none'}/${latest?.conclusion || 'none'}`);
  }
  if (Date.now() >= deadline) throw new Error(`No successful scheduled push run observed for ${expectedSha} within ${timeoutSeconds}s`);
  await sleep(15000);
}
