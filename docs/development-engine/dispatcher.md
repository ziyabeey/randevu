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
  "writable": ["src/example.ts", "tests/example/"],
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
    ["npm", "run", "typecheck"],
    ["node", "--test", "tests/example/example.test.mjs"]
  ]
}
```

A scope entry ending in `/` is an explicit directory prefix. Other writable/forbidden entries are exact file paths. `..`, absolute paths, backslashes, any `.git` path component, NUL/control separators, overlapping writable/forbidden scope, unsafe branch names, leading-dash model identifiers, unknown packet fields, and shell-style validation are rejected. Scope lists and validation argv have explicit count and byte budgets.

`output_mode` is JSON-only in v0.1. `max_wall_time` accepts Qwen duration syntax from 1 second through 2 hours. Validation is argv-based with `shell:false`, has a hard 20-minute total deadline across all commands, and accepts only `node` and `npm`. This executable allowlist is not operator-extensible.

## Dry run

```bash
node scripts/dev-dispatcher.mjs \
  --packet /secure/task.json \
  --repo-root /srv/randevu \
  --dry-run
```

Dry run is write-free and network-free. It validates the packet, verifies the local source repository identity, exact base commit, clean checkout, and local task-branch absence, then prints the Qwen execution plan. It does not contact GitHub, execute Qwen or validation, push, or create a PR. The assignment prompt is replaced with `[PROMPT]`, and validation arguments are not published in the receipt.

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

Before work starts, the dispatcher verifies the effective fetch/push identity for `origin`, confirms that the live remote base branch still equals the packet's exact base SHA, and rejects both local and remote reuse of the task branch. Dispatcher-owned Git commands run with inherited `GIT_*` overrides stripped. Repository/base/remote-branch state is checked again immediately before push.

Qwen is launched headlessly with JSON output, `auto-edit`, `--sandbox`, explicit `--max-wall-time`, `--max-tool-calls`, and `--max-session-turns`. A non-empty `--core-tools` allowlist exposes only the five file/search/edit tools listed above. Non-core discovery and side-effect surfaces are also explicitly excluded. Its HOME/XDG state is a disposable private directory under the dispatch temp area.

Qwen provider credentials are a fixed allowlist of `QWEN_API_KEY` and `DASHSCOPE_API_KEY`. Arbitrary operator aliases cannot be forwarded into the worker environment.

The worktree fence reserves `.git` metadata and rejects tracked or changed symlinks, path escapes, worker-created commits, ignored worker writes, paths outside `writable`, and paths matching `forbidden`. The linked-worktree `.git` marker is snapshotted and rechecked after Qwen and validation.

Validation runs with its own disposable HOME/XDG state. Scope is checked after Qwen, after validation, after staging, and again against the actual committed tree. Git hooks and commit signing are disabled for the dispatcher-owned commit. The final commit must be a direct child of the exact task base.

If Qwen reaches the wall-time budget, the receipt reports a bounded `QWEN_TIMEOUT`. If Qwen returns `MORE_CONTEXT | ESCALATE`, the dispatcher stops before validation/delivery even when Qwen exits zero. Failed Qwen or validation output is represented only as bounded status/byte-count metadata in emitted receipts. Raw model/validator stdout, stderr, validation arguments, and packet prompts are not copied into PR bodies or machine-readable receipts.

A successful run creates one dispatcher-owned commit, pushes only the task branch, and opens a **draft** PR. Commit and PR titles are generated deterministically from the validated `task_id`; packet-authored public commit/PR text is intentionally unsupported. Existing GitHub R0 and CI then take over. Readiness, independent R1/R2, merge, and post-main acceptance remain coordinator-controlled.

## Secrets

Do not place credentials in packets, prompts, or validation arguments. The dispatcher does not accept packet-authored commit messages or PR text, omits validation arguments and raw subprocess output from public receipts, uses isolated worker/validation HOME directories, and forwards only the two fixed Qwen provider credential names. Sensitive environment values, including underscore-style API key names, are redacted when an error message itself contains them.

## Single-worker property

v0.1 uses a host-level lock in the system temp directory. A second dispatcher invocation fails closed with `BUSY`. Queueing, crash leases, retries, cancellation, provider routing, and GitHub event intake are deliberately deferred until this execution kernel is proven on real tasks.

## Validation

The dedicated test suite covers packet/scope/argv bounds, hard budgets, positive Qwen tool allowlisting, protocol escalation, secret-safe output, authorized edits, worker-created commit rejection, symlink/ignored-file rejection, and a network-free dry-run.

It also runs a hermetic non-dry-run integration with a fake Qwen executable, local bare Git remote, and fake `gh` transport. That path proves worktree creation, worker edit, validation, dispatcher commit, push, draft-PR invocation, escalation-before-push, and cleanup without contacting GitHub.

```bash
node --check scripts/dev-dispatcher.mjs
node --test tests/dev-dispatcher.test.mjs
git diff --check
```

The repository's existing CI remains authoritative.

## Next adapter

After v0.1 proves the execution kernel, DEV-DISPATCH-02 may translate a coordinator-authored GitHub Issue/Task Manifest into this packet, claim work idempotently, and invoke a selected provider adapter. Qwen and Gemini can then share the same coordinator/scope/evidence contract while keeping provider credentials and execution policy separate. Arbitrary issue text remains untrusted data and is never executed as commands.
