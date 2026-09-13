import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function gateResult({ mode, scope, docsComplete, code, complete }) {
  if (scope !== 'success' || docsComplete !== 'true') return false;
  if (mode === 'docs') return code === 'skipped' && !complete;
  if (mode === 'code') return code === 'success' && complete === 'true';
  return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const passed = gateResult({ mode: process.env.CI_MODE, scope: process.env.CI_SCOPE_RESULT,
    docsComplete: process.env.CI_DOCS_COMPLETE,
    code: process.env.CI_CODE_RESULT, complete: process.env.CI_CODE_COMPLETE });
  console.log(passed ? 'CI gate passed.' : 'CI gate failed: a required result is missing, skipped or unsuccessful.');
  if (!passed) process.exitCode = 1;
}
