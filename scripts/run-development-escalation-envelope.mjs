import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildEscalationEnvelope,
  buildRoutineFireBody,
  renderHaikuCompressionRequest,
} from './development-escalation-envelope.mjs';

function readJson(target) {
  if (!target || target === '-') return JSON.parse(readFileSync(0, 'utf8'));
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

const dispatcherTarget = process.argv[2] ?? '-';
const evidenceTarget = process.argv[3] ?? null;
const dispatcherResult = readJson(dispatcherTarget);
const evidence = evidenceTarget ? readJson(evidenceTarget) : {};
const envelope = buildEscalationEnvelope(dispatcherResult, evidence);
const output = { envelope, haikuFireBody: null };

if (envelope.disposition === 'REASONING_REQUIRED') {
  output.haikuFireBody = buildRoutineFireBody(renderHaikuCompressionRequest(envelope));
}

console.log(JSON.stringify(output, null, 2));
