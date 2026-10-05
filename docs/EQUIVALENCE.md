<!-- nav -->
[← Patterns design](PATTERNS.md) · [Home](../README.md) · [Conformance corpus →](../conformance/README.md)

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
| A predicate's symbols and parameters | `.symbols({...})` takes a mapping; `symbols` and `parameters` are dicts | `.symbols(...)` takes a record or a `Map`; `symbols` and `parameters` are `Predicates.Symbols`, a `Map` with `equals`, so that `Terms.same` compares them as Python compares dicts | the language's own, in order | CON-01, DST-05 |
| Applying a predicate | `HasName(person, "alice")`, or `HasName.call(...)` | `HasName.call(person, "alice")` | an object is not callable in JavaScript | CON-07 |
| A name a builder has not declared | `pred.nope` raises `AttributeError` | `pred.nope` is `undefined` | a proxy's missing property | CON-01 |
| A rule read from a function | `Python.Text.FromFunction(lambda the: ...)` | none: rules are written with writers | a JavaScript function has no Python source | CON-01 |
| `Contains`'s condition | read from the function's source, as `FromFunction` reads it: `lambda e: e.phone == p` | called with a variable named after its one parameter, read from the function's source: `(e) => e.phone.eq(p)` | no operator overloading, and no Python source; both give the same expression, and refuse a function of other than one parameter | ALG-01 |
| A term's arguments (a set's predicates, a distribution's cases) | a tuple | an array | as mbse-expressions' terms | CON-03, DST-01 |
| Identities | `id(self)` | a string unique to the term (`"expression 3"`), as mbse-expressions' | mbse-schemas keys identities by `String(identity())` | CON-01, CON-04 |
| Integers | `int` | `bigint` (`18n`); a `number` is a float | as in mbse-schemas | throughout |
| YAML | `description: 18 or older` | `description: '18 or older'` | mbse-schemas' YAML writers quote differently; both read back the same, and JSON is byte-identical | CONF-02, CONF-03 |
| The predicate algebra's evaluator | `Predicates.Evaluator(store)(rule, variables)`, a callable | `new Predicates.Evaluator(store).run(rule, variables)` | no callable instances | ALG-02 |
| Weights | floats; an `int` weight is refused by `Sampling.weighted` | numbers, all floats | TypeScript has one number type | GEN-01 |
| Random words and bounds | `int`s | `bigint`s (`next_u32()`, `below(random, 6n)`, `PCG32(42n)`) | as mbse-schemas' `Stores.Random` | GEN-01 |
| What a generator sets | `settings(predicate)` is `{symbol: {property: value}}`, dicts | `Map`s of `Map`s | the language's own mappings | GEN-02 |
| Samples and generated matches | an iterator of dicts; `Generate` gives a `Generation`, an iterator with `steps` and `rejected` | a generator of records; `Generate` gives a `Generation`, an `IterableIterator` with `steps` and `rejected` | the language's own streams | DST-04, GEN-02, GEN-06 |
| Parameters of distributions of values | ints and floats | `bigint`s and numbers (`.mean(70n).deviation(8n)`); ints drawn (a rounded normal, a Poisson, a geometric, an int uniform) are `bigint`s | integers are `bigint`s | DST-03, GEN-05, GEN-06 |
| A distribution's conditions written by a function | `.requires(lambda person, age: person.age == age)`, read as `FromFunction` reads it: its parameters are the names, outer and bound | `.requires((age) => person.age.eq(age))`, called with the variable of the distribution's symbol; outer names come from the closure | a JavaScript function has no Python source, and a bundler renames a parameter that shadows an outer name | DST-03, GEN-06 |
| A choices' count written by a function | `.count(lambda c: c >= 1)`, read as `FromFunction` reads it | `.count((c) => c.ge(1n))`, called with a variable named after its parameter, read from its source | as above | DST-01 |
| A distribution's symbol before `.symbol(...)` | `n.age` raises `AttributeError` | `n.age` is `undefined`; a function in `.requires` raises `TypeError` | a proxy's missing property | DST-03 |

---

<!-- nav -->
[← Patterns design](PATTERNS.md) · [Home](../README.md) · [Conformance corpus →](../conformance/README.md)
