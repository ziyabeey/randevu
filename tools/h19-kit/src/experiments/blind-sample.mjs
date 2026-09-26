import { createHash } from 'node:crypto';

function rank(seed, value) {
  return createHash('sha256').update(`${seed}\0${value}`).digest('hex');
}

export function blindSample(cases, {
  seed,
  count,
  strata = null,
  excludeIds = [],
} = {}) {
  if (!seed) throw new TypeError('seed is required');
  const excluded = new Set(excludeIds);
  const eligible = cases.filter((c) => !excluded.has(c.case_id ?? c.id));

  if (!strata) {
    return [...eligible]
      .sort((a, b) => rank(seed, a.case_id ?? a.id).localeCompare(rank(seed, b.case_id ?? b.id)))
      .slice(0, count);
  }

  const selected = [];
  for (const spec of strata) {
    const rows = eligible
      .filter((c) => spec.match(c))
      .sort((a, b) => rank(`${seed}:${spec.id}`, a.case_id ?? a.id)
        .localeCompare(rank(`${seed}:${spec.id}`, b.case_id ?? b.id)));
    if (rows.length < spec.count) throw new Error(`stratum ${spec.id} has only ${rows.length} cases`);
    selected.push(...rows.slice(0, spec.count));
  }

  if (new Set(selected.map((c) => c.case_id ?? c.id)).size !== selected.length) {
    throw new Error('blind strata overlap produced duplicate cases');
  }

  return selected.sort((a, b) => rank(`${seed}:final`, a.case_id ?? a.id)
    .localeCompare(rank(`${seed}:final`, b.case_id ?? b.id)));
}
