import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const manage = await read('src/ManageFeedback.tsx');
const managePage = await read('src/ManageAppointmentPage.tsx');
const reviews = await read('src/PublicReviews.tsx');
const salon = await read('src/PublicSalonPage.tsx');
const page = await read('src/FeedbackPage.tsx');
const shell = await read('src/WorkspaceShell.tsx');
const route = await read('src/workspace-route.ts');
const worker = await read('worker/f16-feedback-http.ts');
const app = await read('worker/app.ts');

test('F16-04 customers review only through their management capability', () => {
  assert.match(managePage, /<ManageFeedback token=\{token\} \/>/);
  assert.match(manage, /'\/api\/manage\/feedback\/view'/);
  assert.match(manage, /method: 'POST', csrf: 'skip'/);
  assert.match(manage, /disabled=\{busy \|\| rating < 1\}/);
  assert.match(manage, /adımın baş harfiyle/);
  assert.match(app, /path === '\/api\/manage\/feedback\/view'/);
  assert.match(app, /path === '\/api\/manage\/feedback'/);
  assert.doesNotMatch(worker, /feedback\/:token|\?token=/);
});

test('F16-04 public reviews are masked published rows with a real empty state', () => {
  assert.match(salon, /<PublicReviews slug=\{slug\} \/>/);
  assert.match(salon, /href="#salon-yorumlar">\{t\('Yorumlar'\)\}</);
  assert.match(reviews, /Henüz yayınlanmış yorum yok\./);
  assert.match(reviews, /review\.displayName/);
  assert.doesNotMatch(reviews, /customerName|phone|email/i);
  assert.match(worker, /reviews: rows\.map\(\(row\) => \(\{ displayName: row\.display_name, rating: row\.rating, comment: row\.comment, publishedAt: row\.published_at \}\)\)/);
});

test('F16-04 business moderation is a real workspace page with consent-bound publish', () => {
  assert.match(route, /'\/app\/feedback': 'feedback'/);
  assert.match(shell, /\{ page: 'feedback', label: 'Yorumlar' \}/);
  assert.match(shell, /if \(page === 'feedback'\) return <FeedbackPage \/>/);
  assert.match(page, /item\.status !== 'published' && item\.publishConsent && <button/);
  assert.match(page, /expectedStatus: item\.status/);
  assert.match(worker, /canManage\(access\.membership\)/);
});
