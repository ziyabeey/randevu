#!/usr/bin/env node
// Repodaki tüm PR'lardan R0 aday yorumlarını toplar.
// Aday tanımı prepare-development-review-observation.mjs:r0Receipt ile aynıdır:
//   copilot-pull-request-reviewer yazarlı review/yorum, ya da
//   güvenilir yazar (OWNER/MEMBER/COLLABORATOR) + gövdede "R0" + "verdict:".
//
//   NODE_USE_ENV_PROXY=1 node r0/collect.mjs [--owner=ziyabeey --repo=randevu]

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: {
  owner: { type: 'string', default: 'ziyabeey' },
  repo: { type: 'string', default: 'randevu' },
  out: { type: 'string', default: 'r0/candidates.jsonl' },
} });

const api = `https://api.github.com/repos/${args.owner}/${args.repo}`;
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'jev-tr-eval' };

async function all(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${api}${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

const isCandidate = (author, association, body) => /copilot-pull-request-reviewer/i.test(author)
  || (['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association)
    && /(?:^|[^a-z0-9])r0(?:[^a-z0-9]|$)/i.test(body) && /verdict\s*:/i.test(body));

const pulls = await all('/pulls?state=all');
console.error(`${pulls.length} PR`);
const rows = [];
let done = 0;
const queue = [...pulls];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const pr = queue.shift();
    const [reviews, comments] = await Promise.all([
      all(`/pulls/${pr.number}/reviews`),
      all(`/issues/${pr.number}/comments`),
    ]);
    for (const [kind, list] of [['review', reviews], ['comment', comments]]) {
      for (const item of list) {
        const author = item.user?.login ?? '';
        const body = item.body ?? '';
        if (!body.trim() || !isCandidate(author, item.author_association, body)) continue;
        rows.push({ id: `${kind}-${item.id}`, pr: pr.number, kind, author, association: item.author_association, at: item.submitted_at ?? item.created_at, url: item.html_url, body });
      }
    }
    done += 1;
    if (done % 50 === 0) console.error(`${done}/${pulls.length}`);
  }
}));
rows.sort((a, b) => a.pr - b.pr || a.at.localeCompare(b.at));
writeFileSync(args.out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.error(`${rows.length} aday → ${args.out}`);
