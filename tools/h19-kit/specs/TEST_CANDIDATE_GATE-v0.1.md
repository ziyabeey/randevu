# Executable Test Candidate Gate v0.1

**Status:** frozen before implementation
**Parent:** Bundle M6 — Minimal Test Specification
**Purpose:** convert a complete M6 specification into a deterministic, content-addressed test source candidate.

This gate does not write repository files and does not execute the candidate.

## 1. Eligible input

The M6 specification MUST:
- pass the M6 runtime validator;
- have a valid specSha256;
- have readyForExecution=true.

Partial specifications are ineligible.

## 2. Renderer contract

Source generation is framework-specific. The generic core MUST NOT guess a framework.

A renderer is selected explicitly and carries:
- renderer ID;
- renderer version;
- framework;
- language;
- renderer artifact SHA-256.

The artifact hash identifies the exact renderer implementation/package resolved by the loader.
Changing renderer identity changes candidate identity.

The renderer receives an immutable copy of the M6 specification plus an optional bound base-file snapshot.
No LLM/model call is part of v0.1.

## 3. Candidate artifact

The candidate contains:
- M6 specSha256;
- renderer identity;
- target path;
- operation: create or replace;
- optional base-file SHA-256;
- generated source content;
- generated content SHA-256;
- candidateSha256.

The candidate hash is:
~~~text
candidateSha256 = sha256(stableJson(candidate without candidateSha256) + "\n")
~~~

## 4. Path safety

Target path MUST be repository-relative.
Reject absolute paths, empty paths, .. traversal segments, NUL bytes, and paths escaping the repository root after normalization.
The core does not infer a path if the renderer does not provide one.

## 5. Create vs replace

### create
- base-file snapshot MUST be absent;
- baseFileSha256=null.

### replace
A frozen base-file snapshot is required:
~~~json
{
  "path": "tests/example.test.ts",
  "content": "...",
  "sha256": "<sha256>"
}
~~~

The core MUST recompute and verify the base-file hash before rendering.
Renderer output path MUST equal the bound base-file path for replace.
This gate does not support unbound in-place modification.

## 6. Output content

Renderer output content MUST be a non-empty string.
The core computes contentSha256; the renderer cannot supply or override it.
Generated content is an unvalidated candidate. It is not evidence that the hypothesis is correct.

## 7. Determinism

Identical M6 specification, renderer identity/artifact, base-file snapshot and gate version MUST produce byte-identical candidate content and the same candidateSha256.
No timestamp participates in identity.

## 8. Input immutability

The renderer never receives authoritative mutable input objects.
The core protects the original M6 specification, base-file snapshot and renderer descriptor.
Candidate generation must not mutate any of them.

## 9. No side effects

v0.1 MUST NOT write/create/replace files in the repository, run a test command, run mutation testing, install packages, invoke Jev/LLMs, or change H19s.
It returns data only.

## 10. Acceptance gates

### TC1 — spec integrity
Invalid hash or readyForExecution=false is rejected.

### TC2 — renderer integrity
Missing renderer identity/version/artifact SHA or unsupported renderer result is rejected.

### TC3 — filesystem safety
Unsafe path, invalid create/replace semantics or base-file hash mismatch is rejected.

### TC4 — deterministic replay
Same frozen inputs produce the same content and candidate hash.

### TC5 — content identity
Changing generated content changes contentSha256 and candidateSha256.

### TC6 — binding identity
Changing spec, renderer artifact/version, target path, operation or base snapshot changes candidate identity.

### TC7 — input immutability
Generation does not mutate source inputs.

### TC8 — no execution/write
The gate produces a candidate object only.

## 11. Non-goals

This gate does not apply a patch, select a testing framework, validate whether generated code compiles, validate whether the test passes, validate whether the test kills the mutant, or promote the test into the permanent suite.

## 12. Promotion rule

Only after this contract is committed and exact-head CI-green may the implementation milestone receive its Bundle number.
