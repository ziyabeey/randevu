import { evidence } from '../core/contracts.mjs';

export function semgrepEvidence({
  results = [],
  checks = [],
  source = 'semgrep-cli',
} = {}) {
  const byCheck = new Map();
  for (const result of results) {
    const id = result.checkId ?? result.check_id;
    if (!byCheck.has(id)) byCheck.set(id, []);
    byCheck.get(id).push(result);
  }

  return checks.map((check) => {
    const matches = byCheck.get(check.checkId) ?? [];
    return evidence(
      check.evidenceId,
      matches.length ? 'present' : 'absent',
      {
        source,
        checkId: check.checkId,
        matchCount: matches.length,
        matches: matches.map((m) => ({
          path: m.path ?? null,
          start: m.start ?? null,
          end: m.end ?? null,
          message: m.message ?? m.extra?.message ?? '',
        })),
      },
    );
  });
}
