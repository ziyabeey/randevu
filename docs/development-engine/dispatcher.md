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
        +--> Qwen Code (implementer only)
        +--> changed-path scope fence
        +--> coordinator-declared validation argv
        +--> commit + push
        +--> DRAFT PR
        |
        v
GitHub R0 + existing CI -> risk-based R1/R2 -> DANIŞMA
```

v0.1 intentionally starts from a **local JSON packet**. GitHub issue polling/webhooks and queue claiming are a later adapter; untrusted issue/PR text must never become executable packet data by itself.

Qwen receives no GitHub token from the dispatcher. It is instructed not to run shell commands and runs with `auto-edit` or `auto`, never YOLO. The dispatcher, not Qwen, owns Git commit/push/draft-PR delivery. Qwen cannot issue R1/R2 acceptance, mark ready, approve, or merge.

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
  "budgets": {
    "max_wall_time": "10m",
    "max_tool_calls": 60,
    "max_session_turns": 30
  },
  "validation": [
    ["npm", "run", "typecheck"],
    ["node", "--test", "tests/example/example.test.mjs"]
  ],
  "commit_message": "feat: implement F13-02 slice",
  "pr": {
    "title": "F13-02: bounded example",
    "body": "Coordinator-authored task packet."
  }
}
```

A scope entry ending in `/` is an explicit directory prefix. Other writable/forbidden entries are exact file paths. `..`, absolute paths, backslashes, control characters, overlapping writable/forbidden scope, unsafe branch names, unknown packet fields and shell-style validation are rejected.

Validation is argv-based with `shell:false`. By default only `node`, `npm`, `npx`, and `git` are accepted as validation executables. A server operator may extend that allowlist with `DEV_DISPATCH_ALLOWED_EXECUTABLES`; this is an operator configuration, not task authority.

## Dry run

```bash
node scripts/dev-dispatcher.mjs --packet /secure/task.json --dry-run
```

Dry run validates the packet and prints the Qwen execution plan without executing Git, Qwen, validation, push, or PR creation. The actual assignment prompt is replaced with `[PROMPT]` in the receipt.

## Execution

Prerequisites on the dispatcher host:

- Node >= repository engine requirement;
- `git` with authenticated push access to the repository;
- GitHub CLI `gh` authenticated for draft PR creation;
- Qwen Code CLI `qwen` configured for the selected model/provider;
- a clean repository checkout containing the exact base commit.

Run:

```bash
node scripts/dev-dispatcher.mjs --packet /secure/task.json --repo-root /srv/randevu
```

Qwen is launched headlessly with explicit `--max-wall-time`, `--max-tool-calls`, `--max-session-turns`, JSON output and `--exclude-tools agent`. Excluding `agent` prevents subagent inner work from bypassing the top-level tool-call budget. The Qwen child receives only a minimal environment plus explicitly allowlisted provider credentials (`QWEN_API_KEY,DASHSCOPE_API_KEY` by default); GitHub tokens are not forwarded.

After Qwen exits successfully, the dispatcher checks every changed/untracked path before running validation. Any path outside `writable`, any forbidden path, no changes, failed validation, unavailable Qwen, dirty source checkout, base mismatch, existing task branch, or PR creation failure returns a machine-readable `MORE_CONTEXT | ESCALATE` receipt and never marks a PR ready or merges it.

A successful run creates a commit, pushes only the task branch, and opens a **draft** PR. Existing GitHub R0 and CI then take over. Readiness, independent R1/R2, merge, and post-main acceptance remain coordinator-controlled.

## Secrets

Do not place credentials in packets, prompts, PR bodies, or validation arguments. Dispatcher error receipts redact values of sensitive environment variables before emission. Qwen does not receive `GH_TOKEN`/`GITHUB_TOKEN` from this process.

## Single-worker property

v0.1 uses a host-level lock in the system temp directory. A second dispatcher invocation fails closed with `BUSY`. Queueing, crash leases, retries, cancellation and GitHub event intake are deliberately deferred until this execution kernel is proven on real tasks.

## Next adapter

After v0.1 proves the execution kernel, the next layer may translate a coordinator-authored GitHub Issue/Task Manifest into this packet and invoke the dispatcher. That adapter must authenticate coordinator authority and remain idempotent; arbitrary issue text must never be executed as commands.
