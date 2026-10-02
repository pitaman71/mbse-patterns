# Test plan (TypeScript)

The suites, cases and order are Python's ([python3/tests/TestPlan.md](../../python3/tests/TestPlan.md)); this lists
only what differs. The deliberate differences between the implementations are in
[docs/EQUIVALENCE.md](../../docs/EQUIVALENCE.md).

- Each case's code is a block (`{ ... }`), since a notebook runs as one module.
- `run-notebooks.ts` runs the notebooks headless, each in its own process; `--typecheck` type-checks them first.
- CONF-03 compares snapshots as JSON with bigints marked, since `Plain` gives `bigint`s.
