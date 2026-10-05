# Equivalence

The Python (`mbse.Patterns`) and TypeScript (`@mbse/patterns`) implementations have the same modules, names, error
classes and messages, the same test cases in the same order, and write byte-identical JSON and YAML (the CONF suite).
They follow mbse-schemas' and mbse-expressions' conventions; the differences below are deliberate, each forced by the
language. Any other difference is a bug.

| Concern | Python | TypeScript | Why | Cases |
|---|---|---|---|---|
| A validator's options | `Validate(store, predicates, unknown="ignore")` | `Validate(store, predicates, { unknown: "ignore" })` | no keyword arguments | VAL-03 |
| A validator | a class whose instances are called | a function returning a callable with `Reachable` attached | no callable instances | VAL-01, VAL-02 |
| A query's variables | a mapping | a record (`{ min: 21n }`) | the language's own | QRY-02 |
| A query's results | an iterator of dicts (`next(results)`) | a generator of records (`results.next().value`) | the language's own | QRY-01 |
| `unknown` in a query | a positional or keyword argument | positional, after `variables` (`null` for none) | no keyword arguments | QRY-01 |
| A predicate's symbols | `.symbols({...})` takes a mapping; `symbols` is a dict | `.symbols(...)` takes a record or a `Map`; `symbols` is a `Map` | the language's own, in order | CON-01 |
| A rule read from a function | `Python.Text.FromFunction(lambda the: ...)` | none: rules are written with writers | a JavaScript function has no Python source | CON-01 |
| `Contains`'s condition | read from the function's source, as `FromFunction` reads it: `lambda e: e.phone == p` | called with a variable named after its one parameter, read from the function's source: `(e) => e.phone.eq(p)` | no operator overloading, and no Python source; both give the same expression, and refuse a function of other than one parameter | ALG-01 |
| A set's predicates | a tuple | a frozen array | read-only sequences | CON-03 |
| Identities | `id(self)` | a string unique to the object (`"predicate 3"`) | mbse-schemas keys identities by `String(identity())` | CON-01, CON-04 |
| Integers | `int` | `bigint` (`18n`); a `number` is a float | as in mbse-schemas | throughout |
| YAML | `description: 18 or older` | `description: '18 or older'` | mbse-schemas' YAML writers quote differently; both read back the same, and JSON is byte-identical | CONF-02, CONF-03 |
| The predicate algebra's evaluator | `Predicates.Evaluator(store)(rule, variables)`, a callable | `new Predicates.Evaluator(store).run(rule, variables)` | no callable instances | ALG-02 |
