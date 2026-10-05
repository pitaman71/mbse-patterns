# Test plan (TypeScript)

The suites, cases and order are Python's ([python3/tests/TestPlan.md](../../python3/tests/TestPlan.md)); this lists
only what differs. The deliberate differences between the implementations are in
[docs/EQUIVALENCE.md](../../docs/EQUIVALENCE.md).

- Each case's code is a block (`{ ... }`), since a notebook runs as one module.
- `run-notebooks.ts` runs the notebooks headless, each in its own process; `--typecheck` type-checks them first.
- CONF-03 compares snapshots as JSON with bigints marked, since `Plain` gives `bigint`s.
- ALG-01 also refuses a `Contains` condition whose one parameter is destructured, which has no name to bind; a Python
  lambda cannot destructure.
- CON-01 checks that a builder gives a name it has not declared as `undefined`, where Python raises `AttributeError`;
  CON-07 applies predicates with `.call(...)`.
- GEN-01 refuses an infinite weight, as Python does, and has no `int` weight to refuse; random words and bounds are
  `bigint`s.
