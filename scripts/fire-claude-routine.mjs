import { readFileSync } from 'node:fs';
import path from 'node:path';

const BETA_HEADER = 'experimental-cc-routine-2026-04-01';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readBody(target) {
  if (!target || target === '-') return JSON.parse(readFileSync(0, 'utf8'));
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`CLAUDE_ROUTINE_FIRE_BLOCKED: ${label}_MISSING`);
  }
  return value.trim();
}

function validateRoutineUrl(raw) {
  const value = requireString(raw, 'CLAUDE_ROUTINE_URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('CLAUDE_ROUTINE_FIRE_BLOCKED: CLAUDE_ROUTINE_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.anthropic.com') {
    throw new Error('CLAUDE_ROUTINE_FIRE_BLOCKED: CLAUDE_ROUTINE_URL_UNTRUSTED');
  }
  if (!/^\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]+\/fire$/.test(parsed.pathname)) {
    throw new Error('CLAUDE_ROUTINE_FIRE_BLOCKED: CLAUDE_ROUTINE_URL_PATH_INVALID');
  }
  return parsed.toString();
}

async function main() {
  const bodyTarget = argValue('--body') ?? process.argv[2] ?? '-';
  const dryRun = process.argv.includes('--dry-run');
  const body = readBody(bodyTarget);

  if (!body || typeof body.text !== 'string' || !body.text.trim()) {
    throw new Error('CLAUDE_ROUTINE_FIRE_BLOCKED: REQUEST_TEXT_MISSING');
  }

  const configured = Boolean(process.env.CLAUDE_ROUTINE_URL && process.env.CLAUDE_ROUTINE_TOKEN);
  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      configured,
      textBytes: Buffer.byteLength(body.text, 'utf8'),
    }, null, 2));
    return;
  }

  const url = validateRoutineUrl(process.env.CLAUDE_ROUTINE_URL);
  const token = requireString(process.env.CLAUDE_ROUTINE_TOKEN, 'CLAUDE_ROUTINE_TOKEN');

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': BETA_HEADER,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('CLAUDE_ROUTINE_FIRE_BLOCKED: TRANSPORT_UNAVAILABLE');
  }

  const responseText = await response.text();
  if (!response.ok) {
    let reason = `HTTP_${response.status}`;
    try {
      const parsed = JSON.parse(responseText);
      const type = parsed?.error?.type;
      if (typeof type === 'string' && /^[a-z0-9_]+$/i.test(type)) {
        reason = `${reason}_${type.toUpperCase()}`;
      }
    } catch {
      // Never echo response content; it may contain submitted evidence.
    }
    throw new Error(`CLAUDE_ROUTINE_FIRE_BLOCKED: ${reason}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error('CLAUDE_ROUTINE_FIRE_BLOCKED: RESPONSE_NOT_JSON');
  }
  if (parsed?.type !== 'routine_fire'
    || typeof parsed?.claude_code_session_id !== 'string'
    || typeof parsed?.claude_code_session_url !== 'string') {
    throw new Error('CLAUDE_ROUTINE_FIRE_BLOCKED: RESPONSE_SHAPE_INVALID');
  }

  console.log(JSON.stringify({
    status: 'ROUTINE_TRIGGERED',
    httpStatus: response.status,
    claudeCodeSessionId: parsed.claude_code_session_id,
    claudeCodeSessionUrl: parsed.claude_code_session_url,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'CLAUDE_ROUTINE_FIRE_BLOCKED: UNKNOWN';
  console.error(message.startsWith('CLAUDE_ROUTINE_FIRE_BLOCKED:')
    ? message
    : 'CLAUDE_ROUTINE_FIRE_BLOCKED: UNKNOWN');
  process.exit(1);
});
