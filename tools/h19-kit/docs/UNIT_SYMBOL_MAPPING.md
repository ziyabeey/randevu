# Semantic unit to SCIP symbol mapping

Blast-radius analysis begins with changed semantic units, while SCIP is keyed by symbols. H19 maps the two
without asking an LLM to guess symbol identity.

## Preferred mapping

For each changed semantic unit:

1. look at SCIP definition occurrences in the same path;
2. prefer a definition whose SCIP `enclosing_range` contains the semantic unit;
3. if more than one definition contains the unit, choose the narrowest enclosing range;
4. fall back to a definition occurrence close to the semantic unit's start line;
5. if no deterministic mapping exists, keep the unit unmatched.

SCIP's enclosing range is particularly useful because definition occurrences may point only at the symbol name
while the enclosing range can represent the complete definition AST node.

## Fail-closed behavior

An unmatched semantic unit does not become zero-risk. The mapping result explicitly reports unmatched unit IDs,
so downstream rules may escalate, use file-level evidence or abstain.

## Non-claims

- mapping does not infer dynamic dispatch;
- mapping does not turn references into call edges;
- ambiguous candidates remain visible in the result even when a deterministic primary symbol is selected.
