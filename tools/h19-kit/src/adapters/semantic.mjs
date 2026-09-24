import { evidence } from '../core/contracts.mjs';

export function semanticEvidence({
  axis,
  score,
  threshold = 0.64,
  source = 'external-semantic-probe',
} = {}) {
  if (!axis) throw new TypeError('axis is required');
  if (!Number.isFinite(score)) return evidence(`semantic.${axis}.high`, 'unknown', { source });
  return evidence(
    `semantic.${axis}.high`,
    score >= threshold ? 'present' : 'absent',
    { source, score, threshold },
  );
}
