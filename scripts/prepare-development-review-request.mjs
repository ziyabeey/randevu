import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildIndependentReviewRequest,
  renderIndependentReviewRequest,
} from './development-review-request.mjs';
import { buildRoutineFireBody } from './development-escalation-envelope.mjs';

function readJson(target) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

const dispatcherTarget = process.argv[2];
const evidenceTarget = process.argv[3];
const role = process.argv[4];
const expectedCaseFingerprint = process.argv[5];
const requestOutput = process.argv[6] ?? null;

if (!dispatcherTarget || !evidenceTarget || !role || !expectedCaseFingerprint) {
  throw new Error('Usage: prepare-development-review-request <dispatcher.json> <evidence.json> <r1|r2> <case-fingerprint> [request-output.json]');
}

const request = buildIndependentReviewRequest(
  readJson(dispatcherTarget),
  readJson(evidenceTarget),
  role,
  { expectedCaseFingerprint },
);
if (requestOutput) {
  writeFileSync(path.resolve(process.cwd(), requestOutput), JSON.stringify(request, null, 2));
}
const body = buildRoutineFireBody(renderIndependentReviewRequest(request));

console.log(JSON.stringify(body, null, 2));
