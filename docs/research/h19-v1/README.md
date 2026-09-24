# H19 v1 research record

This directory is the archival source package for:

**H19 v1: A Preregistered Semantic Interaction Method for Prospective Regression-Test Discovery**

Version: **1.0.0**  
Record date: **2026-09-24**  
Creator: **Yusuf Ziya Terzioğlu**  
Evidence snapshot: `3e48d2958607ef20660835cdabd884cc7d3738e2`  
Post-promotion CI: **#2654, attempt 2, SUCCESS**  
Canonical permanent gate at the evidence snapshot: **21/21 PASS**

## Contents

- `METHODS.md` — method definition, protocol, benchmark, limitations, and claims.
- `benchmark-v1.csv` — the eight preregistered benchmark cells and terminal outcomes.
- `evidence-manifest.json` — machine-readable evidence snapshot for the permanent gate and benchmark.
- `h19_geometry.py` — dependency-free reproduction of the frozen 19-row geometry and its raw t-way coverage.
- `ZENODO_DEPOSIT.md` — suggested metadata and the manual Zenodo deposit procedure.
- `zenodo-metadata-draft.json` — copy-friendly metadata draft for the Zenodo form.

## Reproduce the geometry

```bash
python3 docs/research/h19-v1/h19_geometry.py
```

Expected headline output:

```text
rows=19
t1=12/12
t2=57/60
t3=128/160
t4=147/240
single_fanout_avg=5.0
covered_pair_fanout_avg=1.0
support_coverage=18/21
holdouts=D0xD3,D1xD4,D2xD5
```

## Reproduce the executable gate

The production application does not depend on H19. H19 is a test-discovery and regression-evidence layer.

At the recorded source snapshot, the repository's CI invokes exactly one repo-level entry point:

`supabase/tests/h19_integrity_gate.sql`

The gate fails closed if scenario registration, includes, pass records, evidence receipts, origin classification, or declared scenario count drift.

## Evidence policy

A prospective HIT requires the three-arm pattern:

1. semantic variation + unchanged current suite: **PASS**;
2. same variation + frozen prospective probe: **FAIL** at the preregistered invariant;
3. clean code + byte-identical probe: **PASS**.

Infrastructure-only failures are excluded from semantic classification. Experimental variations are never merged. Only the clean-control probe from a completed HIT may become a permanent regression.

## Citation boundary

This record documents a method and one repository case study. It does **not** claim that H19 replaces covering arrays, pairwise testing, or general combinatorial testing. Benchmark v1 is reported exactly as observed, including the fact that the coverage-first baseline found more incremental blind spots in that cohort.
