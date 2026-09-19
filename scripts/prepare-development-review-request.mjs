import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildIndependentReviewFireBody } from './development-review-request.mjs';

function readJson(target) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

const dispatcherTarget = process.argv[2];
const evidenceTarget = process.argv[3];
const role = process.argv[4];
const expectedCaseFingerprint = process.argv[5];

if (!dispatcherTarget || !evidenceTarget || !role || !expectedCaseFingerprint) {
  throw new Error('Usage: prepare-development-review-request <dispatcher.json> <evidence.json> <r1|r2> <case-fingerprint>');
}

const body = buildIndependentReviewFireBody(
  readJson(dispatcherTarget),
  readJson(evidenceTarget),
  role,
  { expectedCaseFingerprint },
);

console.log(JSON.stringify(body, null, 2));
