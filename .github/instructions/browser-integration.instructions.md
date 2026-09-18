---
applyTo: "src/**/*.ts,src/**/*.tsx,src/**/*.css,tests/**/*.test.mjs,scripts/browser-*.mjs"
---

# Browser, integration and regression evidence

Use the task's accepted UI/route contract and
[R2 review procedure](../skills/r2-browser-integration-review/SKILL.md).
These file-scoped instructions do not assign the reader the R2 role.

- Verify real route/handler integration, not a disconnected component or mock.
  Bind browser evidence to the exact candidate and identify the served build.
- Distinguish loading, empty, error and success. Failed operations must not look
  successful; notification failure must not erase a successful booking result.
- Test stale requests and business/session/filter switches; use AbortController
  where applicable and verify that late responses cannot overwrite newer state.
- Exercise 360/390 px, keyboard/focus, accessible status/errors and fixed controls
  with the on-screen keyboard. Preserve approved information and operation order.
- Keep public/private data and origins separate. Check native group and legacy
  single compatibility, recovery/lost-response and actual user-flow regression.
- Use real browser smoke/integration proof where behavior needs it, with stable
  scenario names. A source-text test or fixture alone is not browser acceptance.

No UI placeholder or ineffective button may be presented as implemented.
Head changes require fresh evidence or an explicit coordinator-authorized delta;
staging is reserved for hosted-only residuals.
