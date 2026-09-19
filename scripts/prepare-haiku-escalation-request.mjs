import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildRoutineFireBody,
  renderHaikuCompressionRequest,
} from './development-escalation-envelope.mjs';

function readJson(target) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

const routeTarget = process.argv[2];
const attestationTarget = process.argv[3];
if (!routeTarget || !attestationTarget) {
  throw new Error('Usage: prepare-haiku-escalation-request <route.json> <attestation.jwt>');
}

const route = readJson(routeTarget);
const attestation = readFileSync(path.resolve(process.cwd(), attestationTarget), 'utf8').trim();
if (route?.envelope?.disposition !== 'REASONING_REQUIRED') {
  throw new Error('Haiku request preparation requires REASONING_REQUIRED.');
}

const envelope = {
  ...route.envelope,
  trust: { githubOidcAttestation: attestation },
};
const body = buildRoutineFireBody(renderHaikuCompressionRequest(envelope));
console.log(JSON.stringify(body, null, 2));
