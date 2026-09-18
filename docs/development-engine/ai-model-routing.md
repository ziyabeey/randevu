# AI model routing

The repository uses distinct AI roles so adding providers does not multiply review
loops. Models are replaceable; role boundaries and deterministic acceptance stay
stable.

## Authority chain

1. **Coordinator — currently assigned coordinator or human operator**
   - Freezes task scope, writable paths, acceptance contract, validation budget and
     agent routing.
   - Owns scope changes, readiness and merge decisions.
   - Does not create extra review turns merely because another model is available.

2. **Gemini Scout — optional read-only discovery**
   - Trigger: `@gemini-cli /scout <request>`.
   - Default model: `gemini-3.8-flash`.
   - Use only when scope, dependencies or repository location are genuinely unclear.
   - Produces a compact implementation packet.
   - Does not edit, commit, open a PR, review, approve or merge.

3. **Qwen Implementer — configured automated code-writing route**
   - Trigger: `@qwencoder /implement <request>`.
   - Runs only when the coordinator explicitly selects this automation route for
     new implementation and has frozen scope.
   - Creates a new task branch/PR and the smallest coherent patch.
   - The current `@qwencoder /implement` workflow is **new-task delivery only**;
     it is not an in-place existing-PR repair mechanism.
   - Does not merge, approve, mark ready or change repository settings.

4. **Copilot R0 — bounded advisory review**
   - First candidate: **DISCOVERY**. Confirmed blockers receive stable IDs and the
     blocker set is frozen.
   - Repair descendants: **VERIFICATION**. Check frozen blockers and repair-caused
     regressions only.
   - New non-critical observations are deferred instead of expanding current
     acceptance. Only evidence-backed critical safety escape-blockers may reopen it.
   - R0 is not an implementer, R1/R2 substitute or merge authority.

5. **Repository CI / deterministic validators — acceptance evidence**
   - Tests, exact-head CI, protocol/invariant checks and other deterministic
     validators establish PASS/FAIL evidence.
   - AI opinion cannot override a deterministic failing hard invariant.

6. **Risk-based R1/R2 — independent specialist review when required**
   - R1 only for actual DB/auth/access/security/STRICT financial or migration risk.
   - R2 only for actual browser/integration/a11y/user-flow risk.
   - Do not add both unless both risk classes are present.

7. **Cloudflare Workers AI — provider fallback, not another reviewer**
   - Used only on workflow routes that explicitly support Cloudflare fallback when
     the preferred inference provider is unavailable/quota-limited.
   - It inherits the role of the route it replaces. It does not create an extra
     scout, implementation or review turn.

## Routing rules

- **Clear, bounded implementation:** coordinator → selected implementer (Qwen when
  explicitly selected) → exact-head CI → bounded R0 if required → current-branch
  repair for frozen blockers if needed → R0 verification → applicable risk-based
  R1/R2 → coordinator merge → post-main CI. Skip Gemini when scope is already clear.
- **Unclear/high-search task:** Gemini Scout → coordinator freezes contract →
  selected implementer → exact-head CI → bounded R0 → applicable R1/R2 →
  coordinator merge → post-main CI.
- **Explanation/discovery only:** Gemini Scout or coordinator. Do not invoke an
  implementation route.
- **Repair of an existing PR:** the PR's current assigned single writer repairs the
  same branch using the frozen blocker IDs/counterexamples. Do not invoke the
  current `@qwencoder /implement` workflow for in-place repair because it creates
  a new main-based task branch/PR. A future dedicated repair mode must be separately
  implemented and validated before Qwen may own this step.
- **Provider failure:** use the configured provider fallback for the same role.
  Do not turn fallback into an additional opinion.
- **Independent specialist review:** open only the R1/R2 gate justified by the
  validation budget and actual risk.

## Cost and loop controls

- AI count must not increase review count.
- Do not run Gemini and Qwen on the same task in parallel by default.
- Prefer one coherent implementation candidate over many tiny candidate pushes.
- Batch material findings before another implementation run.
- R0 review scope must monotonically narrow after discovery:
  `next_blockers ⊆ frozen_blockers`, except evidence-backed critical safety
  escape-blockers.
- Do not request redundant AI reviews on intermediate heads.
- Do not convert R0 suggestions, nits or newly imagined improvements into current
  acceptance criteria.
- CI, protocol verification and hard invariants remain unchanged by these
  cost-control rules.

## Success condition

Automation is successful when a scoped request becomes the correct branch/PR,
required exact-head deterministic validation passes, bounded R0 and applicable
risk-based R1/R2 obligations are closed, the coordinator merges, and post-main CI
passes without a human manually carrying context between models.
