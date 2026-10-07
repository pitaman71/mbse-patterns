<!-- nav -->
[← TypeScript package](../README.md) · [Home](../../README.md)

# Test plan (TypeScript)

The suites, cases and order are Python's (the [Python test plan](../../python3/tests/TestPlan.md)); this lists
only what differs. The deliberate differences between the implementations are in
[Equivalence](../../docs/EQUIVALENCE.md).

- Each case's code is a block (`{ ... }`), since a notebook runs as one module.
- `run-notebooks.ts` runs the notebooks headless, each in its own process; `--typecheck` type-checks them first.
- CONF-03 compares snapshots as JSON with bigints marked, since `Plain` gives `bigint`s.
- ALG-01 also refuses a `Contains` condition whose one parameter is destructured, which has no name to bind; a Python
  lambda cannot destructure.
- CON-01 checks that a builder gives a name it has not declared as `undefined`, where Python raises `AttributeError`;
  CON-07 applies predicates with `.call(...)`, parameters by name as a last object literal.
- GEN-01 refuses an infinite weight, as Python does, and has no `int` weight to refuse; random words and bounds are
  `bigint`s.
- TRF-08 gives a rerun's earlier steps by position, after the scope and labels.
- TRF-01 gives a transform's options as an object, and TRF-02 to TRF-06 give answers and a clause's arguments as
  records; their integers are `bigint`s.
- DST-03 refuses a function in a distribution's `.requires(...)` before its symbol is set, since TypeScript calls the
  function with the symbol's variable; Python reads the function's parameters instead.

---

<!-- nav -->
[← TypeScript package](../README.md) · [Home](../../README.md)
