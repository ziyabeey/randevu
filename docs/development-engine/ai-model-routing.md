# AI model routing

The repository uses distinct AI roles so the same task is not redundantly solved by multiple paid agents.

## Default route

1. **Gemini Scout** — optional read-only analysis before implementation.
   - Trigger: `@gemini-cli /scout <request>`
   - Default model: `gemini-3.8-flash`
   - Read-only repository tools only.
   - Produces a compact implementation packet.
   - Does not edit, commit, open a PR, review, approve, or merge.

2. **Qwen Implementer** — code-writing worker.
   - Trigger: `@qwencoder /implement <request>`
   - Runs only when implementation is actually needed.
   - Creates a task branch and PR.
   - Does not merge, approve, mark ready, or change repository settings.

3. **Copilot R0** — advisory pull-request review.
   - Runs on the delivered PR/final candidate.
   - It is not an implementer and is not merge authority.

4. **Repository CI** — authoritative automated validation.
   - CI evidence, not an AI claim, establishes whether required checks passed.

## Cost-control rules

- Do not run Gemini and Qwen on the same task in parallel by default.
- Do not ask Gemini to implement work that Qwen is already implementing.
- Do not invoke Qwen for explanation-only, discovery-only, or file-location tasks when Gemini Scout can answer them.
- Prefer one scoped Qwen implementation run that produces one coherent PR.
- Batch follow-up findings before another implementation run instead of reacting to every advisory comment individually.
- Do not request redundant AI reviews on intermediate heads. Review the candidate that is intended to move forward.
- Human/coordinator authority remains responsible for task assignment, scope changes, readiness, and merge.

## Practical routing

Use Gemini Scout first when the task has unclear scope, a large repository search surface, uncertain dependencies, or needs a cheap preflight.

Skip Gemini and call Qwen directly when the task contract already names the exact scope and acceptance criteria.

Use Copilot only as the downstream advisory review layer after implementation.
