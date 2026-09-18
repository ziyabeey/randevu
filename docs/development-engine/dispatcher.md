# DEV-DISPATCH-01 — Qwen worker dispatcher v0.1

The dispatcher is a deliberately small execution bridge between a coordinator-authored task packet and Qwen Code. It is not a scheduler, reviewer, source of truth, merge bot, or replacement for the Development Engine.

## Boundary

```text
DANIŞMA / canonical task contract
        |
        v
local JSON packet
        |
        v
scripts/dev-dispatcher.mjs
        |
        +--> exact base + isolated git worktree
        +--> Qwen Code sandbox (implementer only)
        +--> positive file-tool allowlist
        +--> worker/filesystem/Git metadata fences
        +--> isolated coordinator-declared validation
        +--> second + staged + committed-tree scope fences
        +--> dispatcher commit + push
        +--> DRAFT PR
        |
        v
GitHub R0 + existing CI -> risk-based R1/R2 -> DANIŞMA
```

v0.1 intentionally starts from a **local JSON packet**. GitHub issue polling/webhooks and queue claiming are a later adapter. Untrusted issue/PR text must never become executable packet data by itself.

Qwen receives no GitHub token from the dispatcher. It runs only with `auto-edit`, inside the Qwen sandbox, with a positive core-tool allowlist limited to `read_file`, `grep_search`, `glob`, `edit`, and `write_file`. Shell, monitor, web fetch, subagent/task, skill, and tool-search surfaces are explicitly excluded. The dispatcher, not Qwen, owns validation, Git commit/push, and draft-PR delivery. Qwen cannot issue R1/R2 acceptance, mark ready, approve, or merge.

## Packet

Example:

```json
{
  "version": 1,
  "repository": "ziyabeey1-ai/randevu",
  "task_id": "F13-02",
  "base_sha": "0123456789abcdef0123456789abcdef01234567",
  "base_branch": "main",
  "branch": "f13-02-example",
  "writable": ["src/example.mjs", "tests/example/"],
  "forbidden": ["supabase/", ".github/workflows/"],
  "prompt": "Implement only the accepted F13-02 slice.",
  "model": "qwen3.8-flash",
  "approval_mode": "auto-edit",
  "output_mode": "json",
  "budgets": {
    "max_wall_time": "10m",
    "max_tool_calls": 60,
    "max_session_turns": 30
  },
  "validation": [
    ["node", "--check", "src/example.mjs"]
  ]
}
```

A scope entry ending in `/` is an explicit directory prefix. Other writable/forbidden entries are exact file paths. `..`, absolute paths, backslashes, any `.git` path component, NUL/control separators, overlapping writable/forbidden scope, unsafe branch names, leading-dash model identifiers, unknown packet fields, and shell-style validation are rejected. Scope lists and validation argv have explicit count and byte budgets.

`output_mode` is JSON-only in v0.1. `max_wall_time` accepts Qwen duration syntax from 1 second through 2 hours. Local dispatcher validation is deliberately **non-executing**: it accepts zero to twenty `node --check <relative-file>` syntax preflights, each target must be inside the writable scope, and the dispatcher also runs `git diff --check`. It does not run Qwen-authored tests, npm scripts, builds, package managers, or arbitrary Node programs on the dispatcher host. Full typecheck/test/build remains the responsibility of GitHub CI after the draft PR is pushed.

## Dry run

```bash
node scripts/dev-dispatcher.mjs \
  --packet /secure/task.json \
  --repo-root /srv/randevu \
  --dry-run
```

Dry run is write-free and network-free. It validates the packet, verifies the local source repository identity, confirms that the local or cached `base_branch` ref equals the exact base SHA, checks a clean checkout and local task-branch absence, then prints the Qwen execution plan. It does not contact GitHub, execute Qwen or validation, push, or create a PR. The assignment prompt is replaced with `[PROMPT]`, and validation arguments are not published in the receipt.

## Execution

Prerequisites on the dispatcher host:

- Node >= repository engine requirement;
- `git` with authenticated fetch/push access to the repository;
- GitHub CLI `gh` authenticated for draft PR creation;
- Qwen Code CLI `qwen` configured for the selected provider;
- Docker or Podman available for Qwen sandboxing on Linux;
- a clean repository checkout containing the exact base commit.

Run:

```bash
node scripts/dev-dispatcher.mjs --packet /secure/task.json --repo-root /srv/randevu
```

Before work starts, the dispatcher verifies the effective fetch/push identity for `origin`, confirms that both the local/cached base ref and the live remote base branch equal the packet's exact base SHA, and rejects both local and remote reuse of the task branch. Dispatcher-owned Git subprocesses receive a least-privilege environment containing only basic process/locale/temp values plus the configured SSH transport variables; Qwen/Gemini/API and GitHub token variables are not forwarded to Git. Every dispatcher-owned Git command forces `core.hooksPath=/dev/null`. Repository/base/remote-branch state is checked again immediately before delivery.

Qwen is launched headlessly with JSON output, `auto-edit`, `--sandbox`, explicit `--max-wall-time`, `--max-tool-calls`, and `--max-session-turns`. A non-empty `--core-tools` allowlist exposes only the five file/search/edit tools listed above. Non-core discovery and side-effect surfaces are also explicitly excluded. Its HOME/XDG state is a disposable private directory under the dispatch temp area.

Qwen provider credentials are a fixed allowlist of `QWEN_API_KEY` and `DASHSCOPE_API_KEY`. Arbitrary operator aliases cannot be forwarded into the worker environment.

The worktree fence reserves every `.git` path component, including nested metadata, and rejects tracked, ordinary, or dangling symlinks, path escapes, worker-created commits, ignored worker writes, paths outside `writable`, and paths matching `forbidden`. The linked-worktree root `.git` marker is snapshotted and rechecked after Qwen and static preflight.

Static preflight runs with its own disposable HOME/XDG state and never executes generated application/test code. After staging, `git diff --cached --check` inspects newly added files as well as tracked edits. Scope is checked after Qwen, after static preflight, after staging, and again against the actual committed tree. Git hooks are disabled for all dispatcher-owned Git commands and commit signing is disabled for the dispatcher-owned commit. The final commit must be a direct child of the exact task base. Full behavioral/type/build validation occurs in the repository's existing GitHub CI on the exact draft-PR head.

If Qwen reaches its native wall-time budget, the receipt reports a bounded `QWEN_TIMEOUT`; the dispatcher also applies a direct-process timeout as a secondary guard. v0.1 does not claim an OS-level process-group kill guarantee, so the positive Qwen tool allowlist intentionally exposes no shell, subagent, monitor, or web tool that can create worker-authored process trees. If Qwen returns `MORE_CONTEXT | ESCALATE`, the dispatcher stops before validation/delivery even when Qwen exits zero. Failed Qwen or validation output is represented only as bounded status/byte-count metadata in emitted receipts. Raw model/validator stdout, stderr, validation arguments, and packet prompts are not copied into PR bodies or machine-readable receipts.

A successful run creates one dispatcher-owned commit and publishes through one atomic Git push. The push carries an empty-expectation lease for the task ref and an exact-SHA lease for the base ref, while also sending the unchanged base SHA as a no-op base refspec. Delivery therefore fails if the task ref appears or if the live base advances before the push commits. Hooks are disabled for the push. It then opens a **draft** PR. Commit and PR titles are generated deterministically from the validated `task_id`; packet-authored public commit/PR text is intentionally unsupported. Existing GitHub R0 and CI then take over. Readiness, independent R1/R2, merge, and post-main acceptance remain coordinator-controlled.

## Secrets

Do not place credentials in packets, prompts, or validation arguments. The dispatcher does not accept packet-authored commit messages or PR text, omits validation arguments and raw subprocess output from public receipts, and uses isolated worker/static-preflight HOME directories. Qwen receives only the two fixed provider credential names. Git receives neither provider keys nor GitHub tokens. The `gh` subprocess receives only its dedicated GitHub-auth/process/network allowlist, is explicitly pinned to `GH_HOST=github.com`, and never receives Qwen provider keys. Returned PR output is redacted and accepted only when it matches the expected `https://github.com/<owner>/<repo>/pull/<number>` shape. Sensitive environment values, including underscore-style API key names, are redacted when an error message itself contains them.

## Single-worker property

v0.1 uses a host-level lock in the system temp directory. A second dispatcher invocation fails closed with `BUSY`. Queueing, crash leases, retries, cancellation, provider routing, and GitHub event intake are deliberately deferred until this execution kernel is proven on real tasks.

## Validation

The dedicated test suite covers packet/scope/argv bounds, leading-dash option rejection, hard budgets, positive Qwen tool allowlisting, protocol escalation, secret-safe output, nested `.git` rejection, ordinary/dangling symlink rejection, worker-created commit and ignored-file rejection, create-only push argv, static-preflight fencing, and a network-free local/cached-base dry-run.

It also runs a hermetic non-dry-run integration with a fake Qwen executable, local bare Git remote, and fake `gh` transport. That path proves worktree creation, worker edit, validation, dispatcher commit, push, draft-PR invocation, escalation-before-push, and cleanup without contacting GitHub.

```bash
node --check scripts/dev-dispatcher.mjs
node --test tests/dev-dispatcher.test.mjs
git diff --check
```

The repository's existing CI remains authoritative.

## Next adapter

After v0.1 proves the execution kernel, DEV-DISPATCH-02 may translate a coordinator-authored GitHub Issue/Task Manifest into this packet, claim work idempotently, and invoke a selected provider adapter. Qwen and Gemini can then share the same coordinator/scope/evidence contract while keeping provider credentials and execution policy separate. Arbitrary issue text remains untrusted data and is never executed as commands.
