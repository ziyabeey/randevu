# H19 Kit batched Python semantic extraction — portability/performance slice

Task: **H19-KIT-PORTABILITY-PY-BATCH**. Owner: Codex + coordinator. Date: 2026-09-26.

## Observed problem

RECAP cold run 001 parsed four Python files successfully but paid a fresh Python
interpreter startup for each file.

Observed wall times were approximately:

- `execution/negative_controls.py`: 1405.8 ms
- `execution/validate_raw_results.py`: 1368.4 ms
- `preflight/contract_check.py`: 1323.4 ms
- `preflight/verify_t1.py`: 1297.9 ms
- total: **5395.5 ms**

This is a measured semantic-extraction overhead, not an end-to-end H19 timing.

## Parent and scope

Parent: PR #621 exact head
`9b21929a1ef694bffba63e3431179572c26aaf72`, CI #3016 SUCCESS.

Branch: `h19-kit-python-batched-units`.

The existing single-file `extractPythonUnits()` API remains unchanged.
A new `extractPythonUnitsBatch()` API sends multiple path/text inputs through
one Python interpreter process.

`repositoryInventory()` now batches all discovered `.py` files through that
API while non-Python extraction retains the existing path.

A syntax/parse failure is retained per file and does not discard valid units from
the rest of the batch.

## Correctness gate

The dedicated smoke requires:

- batch results for valid files to equal single-file extractor results;
- the conservative Module fallback to remain identical;
- one invalid Python file to produce one error without poisoning valid files;
- repeated batch execution to be deterministic;
- repository inventory to adopt the batch path while preserving sorted output.

No latency threshold is part of required CI.

## Paired benchmark

`perf/run-python-unit-batch.mjs` performs:

- one excluded warmup for single and batch paths;
- five paired measured cycles by default;
- alternating single→batch / batch→single order;
- exact output-digest equality in every cycle;
- median and range reporting only.

It records interpreter starts per cycle as N for the single path and 1 for the
batch path.

## Boundaries

This slice does not claim end-to-end speedup, stable p95 latency or general Python
indexer correctness.

It does not change scope/shadow resolution, dynamic dispatch behavior, graph
semantics, project ownership, generated tests, provider calls or M12 authority.

## Next measurement

After exact-head CI, run the paired benchmark on the same four frozen RECAP
Python source blobs used by cold run 001. Report the paired median/range and
output identity separately from the historical 5395.5 ms baseline.
