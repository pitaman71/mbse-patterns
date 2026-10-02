# Test plan

One suite per notebook, with the same case IDs, in the same order, in both implementations; each case is a markdown
cell `## ID · title` followed by one code cell. `support.py` holds the shared helpers and the address book the suites
query: a singleton directory lists contacts, and contacts have phones. TypeScript's plan lists only its differences.

| Notebook | Suite | Covers |
|---|---|---|
| `01_Constraints.ipynb` | CON | A constraint's parts and rule (writers resolved, data kept); static problems (missing parts, non-core operations, unbound names, a name defined twice) and `check`; a set's order and `of`; a set as data (JSON round trip with its rules, a shared rule written once, mbse-schemas' validation, `update` through `Builders`); decoding refused (two rules, a rule that is not an expression, a member that is not a constraint, an unset link) and entries without an index; `register` in a proxy store |
| `02_Validators.ipynb` | VAL | Each object against its schema's constraints (holds, does not hold, unknown); a value of another schema; `Reachable`; `unknown` as report, ignore or violation, and a bad mode refused; a rule that raises, reported in place; constraints that cannot be right refused when the validator is made |
| `03_Queries.ipynb` | QRY | Matches stream lazily over the extent (what the singleton reaches, not transient objects); `unknown`; variables bound once, objects as variables, a residual decided by the variables; the extent read at the first match; queries refused when made (unknown schema, relation, `this` as a variable, unbound names, non-core operations) and a rule that is not a bool, when read; `Scan` delegates every store method; `select` asks a queryable store and scans others, a store of bound classes included |
| `04_Conformance.ipynb` | CONF | Committed snapshots current; the same cases and byte-identical JSON in every implementation; every implementation's JSON and YAML read back to the same sets |
| `05_Skill.ipynb` | SKL | The packaged skill current; its complete programs run; every link in the agent guides resolves |

## Not testable yet

Patterns, distributions, the pseudorandom generator, generators and characterizers (designed in `docs/PATTERNS.md`,
not built); standing and asynchronous queries; native queries of a database store.
