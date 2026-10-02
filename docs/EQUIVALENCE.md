# Equivalence

The Python (`mbse.Patterns`) and TypeScript (`@mbse/patterns`) implementations have the same modules, names, error
classes and messages, the same test cases in the same order, and write byte-identical JSON and YAML (the CONF suite).
They follow mbse-schemas' and mbse-expressions' conventions; the differences below are deliberate, each forced by the
language. Any other difference is a bug.

| Concern | Python | TypeScript | Why | Cases |
|---|---|---|---|---|
| A validator's options | `Validate(store, constraints, unknown="ignore")` | `Validate(store, constraints, { unknown: "ignore" })` | no keyword arguments | VAL-03 |
| A validator | a class whose instances are called | a function returning a callable with `Reachable` attached | no callable instances | VAL-01, VAL-02 |
| A query's variables | a mapping | a record (`{ min: 21n }`) | the language's own | QRY-02 |
| A query's results | an iterator (`next(results)`) | an iterable iterator, a generator (`results.next().value`) | the language's own | QRY-01 |
| `unknown` in a query | a positional or keyword argument | positional, after `variables` (`null` for none) | no keyword arguments | QRY-01 |
| A set's constraints | a tuple | a frozen array | read-only sequences | CON-03 |
| Identities | `id(self)` | a string unique to the object (`"constraint 3"`) | mbse-schemas keys identities by `String(identity())` | CON-01, CON-04 |
| Integers | `int` | `bigint` (`18n`); a `number` is a float | as in mbse-schemas | throughout |
| The constraint class `Set` | `Constraints.Set` | `Constraints.Set`, which shadows the global `Set` inside the module | the same name in both | CON-03 |
