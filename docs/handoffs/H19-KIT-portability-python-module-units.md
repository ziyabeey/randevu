# H19 Kit Python module fallback units — cross-repository portability slice

Task: **H19-KIT-PORTABILITY-PY-MODULE**. Owner: Codex + coordinator. Date: 2026-09-26.

## Why this slice exists

RECAP cold run 001 exposed a second Python portability blind spot after the
symbol/reference graph gap:

`preflight/verify_t1.py` parsed successfully but emitted **0 semantic units**
because it is predominantly module-level procedural code and the existing Python
extractor emits only `FunctionDef` / `AsyncFunctionDef`.

Cold run 002 closed the function mapping gap completely for the two measured
function-bearing files:

- `execution/negative_controls.py`: 4/4 unmatched → 4/4 matched;
- `preflight/contract_check.py`: 5/5 unmatched → 5/5 matched.

This slice addresses only the remaining module-only procedural-unit blind spot.

## Parent and scope

Parent: PR #620, exact head
`3b1f8ada879f914b5ed4fb656889a37e85a62184`, CI #3010 SUCCESS.

Branch: `h19-kit-python-module-units`.

Changes:

1. Python semantic extraction emits one conservative `<module>` pseudo-unit
   only when the file has no function/async-function units and does contain
   executable top-level statements.
2. Imports, function/class definitions and a leading module docstring do not
   by themselves create a pseudo-unit.
3. Function-bearing files retain their previous unit inventory, even when they
   also contain top-level calls.
4. The existing Python AST graph's module node is reused. The generic
   unit→symbol mapper gains an exact `python-module` mapping mode for that
   pseudo-unit.

No new graph schema or Python-specific M4/M5 rule is introduced.

## Acceptance

The dedicated smoke requires:

- a procedural module to emit exactly one `Module` / `<module>` unit;
- docstring/import-only Python to emit zero units;
- function-bearing Python to preserve the prior function-only inventory;
- the module pseudo-unit to map deterministically to the existing
  `python <module>::<module>` graph node with zero unmatched units.

## Deliberate exclusions

This slice does not add:

- pseudo-units to mixed function-bearing files;
- batched/persistent Python semantic extraction;
- scope/shadow-aware reference resolution;
- dynamic dispatch inference;
- automatic project ownership;
- generated tests, provider calls or M12 authority.

## Next measurement

After exact-head CI, rerun the exact frozen RECAP target:

- target: `ziyabeey1-ai/RECAP-T2-Execution@683f4597241c59576c7bb8f55e652ac6e0367449`;
- file: `preflight/verify_t1.py`;
- previous semantic units: 0.

Report the new unit count, module-symbol mapping result and unmatched count. Do
not claim hosted execution if GitHub Actions again fails before job creation.
