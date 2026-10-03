# Test plan

One suite per notebook, with the same case IDs, in the same order, in both implementations; each case is a markdown
cell `## ID · title` followed by one code cell. `support.py` holds the shared helpers and the address book the suites
use: a singleton directory lists contacts, and contacts own phones, each phone with one entry. TypeScript's plan lists
only its differences.

| Notebook | Suite | Covers |
|---|---|---|
| `01_Predicates.ipynb` | CON | A predicate built fluently (name, description, symbols added in order, a rule from a lambda or a writer; clone, update, resolve, and the builder's refusals); static problems (no name, rule or symbols, a symbol's schema not a named reference object schema, non-core operations, unbound names, a name defined twice) and `check`; a set's order and builder; predicates as data (symbols written by schema name with any store, a shared rule written once, read back through `OfStore(store)` to the store's schemas, refused through `Builders` for named schemas, an inline schema round trip, mbse-schemas' validation, `update` through the store); decoding refused (two rules, a rule that is not an expression, a member that is not a predicate, an unset link), entries without an index, a blank predicate; `register` in a proxy store |
| `02_Validators.ipynb` | VAL | Each match checked (holds, does not hold, unknown); a value of another schema; `Reachable` over the cross product of two symbols' objects, labelled by match; `unknown` as report, ignore or violation, and a bad mode refused; a rule that raises or gives a non-bool, reported in place; predicates that cannot be right refused when the validator is made |
| `03_Queries.ipynb` | QRY | Matches stream lazily over the extents (what the singleton reaches, not transient objects); `unknown`; variables bound once, objects as variables, conjuncts of variables alone tested first; the extents read at the first match; queries refused when made (a symbol's schema not a named reference object schema or not in the store, a variable named like a symbol, unbound names, non-core operations) and a non-bool rule, when read; several symbols: the cross product, hops through relations (any number, at most one by `unique`, both ways, a target of another schema filtered out), conjuncts tested early, and `explain`; every shape that is not a hop; `Scan` delegates every store method, `random` included; `select` asks a queryable store and scans others, a store of bound classes included |
| `04_Conformance.ipynb` | CONF | Committed snapshots current; the same cases and byte-identical JSON in every implementation; every implementation's JSON and YAML read back to the same sets |
| `05_Skill.ipynb` | SKL | The packaged skill current; its complete programs run; every link in the agent guides resolves |
| `06_Algebra.ipynb` | ALG | The algebra's terms written (a schema or its name) and checked (mixed with Basic's, which Basic alone refuses; unbound ends, weights summing to 1, positive weights, empty choices, non-options, unnamed schemas); evaluation over the store (mandatory, forbidden and possible links, `count`, extents read once per evaluator, Kleene's `choice`, unknown ends, objects expected, unknown adjacencies and schemas, a relation of three links naming its link); predicates of the algebra (without symbols: validated and queried once; `linked` as a hop, at most one by `unique`, named links, and what is not a hop) and their round trip as data |

## Not testable yet

Patterns, distributions, the pseudorandom generator, generators and characterizers (designed in `docs/PATTERNS.md`,
not built); standing and asynchronous queries; native queries of a database store.
