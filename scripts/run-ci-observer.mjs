import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { observeCi } from './ci-observer.mjs';
const dir = process.argv[2];
const read = (name) => JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8'));
const result = observeCi({ repository: process.env.REPOSITORY, pr: read('pr'), run: read('run'),
  jobs: read('jobs'), mainSha: read('main').commit.sha,
  finalPr: read('final-pr'), finalMainSha: read('final-main').commit.sha });
writeFileSync(`${dir}/observation.json`, JSON.stringify(result, null, 2));
const lines = ['## CI observation · canonical Dispatcher', '',
  `- PR: #${result.observation.candidate.prNumber}`,
  `- Observed source SHA: ${result.observation.ci.exactHeadSha}`,
  `- Current PR SHA: ${result.observation.observation.liveHeadSha}`,
  `- CI result: ${result.observation.ci.status}`,
  `- Dispatcher: ${result.dispatcher.recommendation.suggestedAction}`,
  `- Disposition: ${result.disposition.disposition}`, '', ...result.limits.map((line) => `- ${line}`), ''];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
