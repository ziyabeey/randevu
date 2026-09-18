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
        +--> base-to-final + filesystem scope fences
        +--> coordinator-declared validation argv
        +--> second scope fence
        +--> dispatcher commit + push
        +--> DRAFT PR
        |
        v
GitHub R0 + existing CI -> risk-based R1/R2 -> DANIŞMA
```

v0.1 intentionally starts from a **local JSON packet**. GitHub issue polling/webhooks and queue claiming are a later adapter. Untrusted issue/PR text must never become executable packet data by itself.

Qwen receives no GitHub token from the dispatcher. It runs only with `auto-edit`, inside the Qwen sandbox, with `shell` and `agent` excluded. The dispatcher, not Qwen, owns validation, Git commit/push, and draft-PR delivery. Qwen cannot issue R1/R2 acceptance, mark ready, approve, or merge.

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

A scope entry ending in `/` is an explicit directory prefix. Other writable/forbidden entries are exact file paths. `..`, absolute paths, backslashes, NUL/control separators where argv requires a single line, overlapping writable/forbidden scope, unsafe branch names, unknown packet fields and shell-style validation are rejected.

`output_mode` is intentionally JSON-only in v0.1. `max_wall_time` accepts Qwen duration syntax from 1 second through 2 hours. Validation is argv-based with `shell:false` and has a separate hard 20-minute total deadline across all validation commands. By default only `node`, `npm`, `npx`, and `git` are accepted as validation executables. A server operator may extend that executable allowlist with `DEV_DISPATCH_ALLOWED_EXECUTABLES`; this is operator configuration, not task authority.

## Dry run

```bash
node scripts/dev-dispatcher.mjs \
  --packet /secure/task.json \
  --repo-root /srv/randevu \
  --dry-run
```

Dry run is write-free. It validates the packet, verifies the source repository identity, exact base commit, clean checkout, and local task-branch absence, then prints the Qwen execution plan. It does not execute Qwen, validation, push, or PR creation. The assignment prompt is replaced with `[PROMPT]`, and validation arguments are not published in the receipt.

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

Before work starts, the dispatcher verifies both effective fetch and push URLs for `origin`, verifies that the exact base commit exists, and rejects both local and remote reuse of the task branch.

Qwen is launched headlessly with JSON output, `auto-edit`, `--sandbox`, explicit `--max-wall-time`, `--max-tool-calls`, `--max-session-turns`, and `--exclude-tools agent,shell`. Its HOME/XDG state is a disposable private directory under the dispatch temp area. Only explicitly allowlisted provider credentials are forwarded. Operator configuration cannot re-add `GH_TOKEN`, `GITHUB_TOKEN`, or equivalent GitHub-token names.

The worktree fence rejects tracked or changed symlinks, path escapes, worker-created commits, ignored worker writes, paths outside `writable`, and paths matching `forbidden`. Scope is checked once after Qwen and again after coordinator-declared validation. The second check prevents validators from smuggling additional stageable paths into `git add --all`. The final dispatcher commit must be a direct child of the exact task base.

If Qwen returns `MORE_CONTEXT | ESCALATE`, the dispatcher stops before validation/delivery even when Qwen exits zero. Failed Qwen or validation output is captured only as bounded status/byte-count metadata in emitted receipts. Raw model/validator stdout, stderr, validation arguments, and packet prompts are not copied into PR bodies or machine-readable receipts.

A successful run creates one dispatcher-owned commit, pushes only the task branch, and opens a **draft** PR. Commit and PR titles are generated deterministically from the validated `task_id`; packet-authored public commit/PR text is intentionally unsupported. Existing GitHub R0 and CI then take over. Readiness, independent R1/R2, merge, and post-main acceptance remain coordinator-controlled.

## Secrets

Do not place credentials in packets, prompts, or validation arguments. The dispatcher does not accept packet-authored commit messages or PR text, omits validation arguments and raw subprocess output from public receipts, uses an isolated Qwen HOME, and hard-denies any provider allowlist variable whose name contains `GITHUB` or begins with `GH_`. Sensitive environment values, including underscore-style API key names, are redacted when an error message itself contains them.

## Single-worker property

v0.1 uses a host-level lock in the system temp directory. A second dispatcher invocation fails closed with `BUSY`. Queueing, crash leases, retries, cancellation and GitHub event intake are deliberately deferred until this execution kernel is proven on real tasks.

## Validation

The dedicated test suite covers packet rejection, hard budgets, command construction, secret-safe dry-run output, real temporary-repository exact-base fencing, authorized edits, worker-created commit rejection, symlink rejection, ignored-file rejection, and repository-identity mismatch.

```bash
node --check scripts/dev-dispatcher.mjs
node --test tests/dev-dispatcher.test.mjs
git diff --check
```

The repository's existing CI remains authoritative.

## Next adapter

After v0.1 proves the execution kernel, the next layer may translate a coordinator-authored GitHub Issue/Task Manifest into this packet and invoke the dispatcher. That adapter must authenticate coordinator authority, claim work idempotently, and keep arbitrary issue text as untrusted data rather than executable commands.
