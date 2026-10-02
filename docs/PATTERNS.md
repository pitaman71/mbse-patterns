# Patterns

Constraints, queries and patterns over [mbse-schemas](https://github.com/pitaman71/mbse-schemas) data, built on the
rules of [mbse-expressions](https://github.com/pitaman71/mbse-expressions). This package depends on both (sibling
checkouts, pinned in `siblings.json`). Their design documents,
[`FRAMEWORK.md`](https://github.com/pitaman71/mbse-schemas/blob/main/docs/FRAMEWORK.md) and
[`EXPRESSIONS.md`](https://github.com/pitaman71/mbse-expressions/blob/main/docs/EXPRESSIONS.md), describe the schemas
and the rules; this document covers what is built from them.

It is planned in three releases, each landed and reviewed before the next:

| Release | Contents | Status |
|---|---|---|
| 0.1 | [Predicates](#predicates), [validators](#validators), [queries](#queries) and the queryable in-memory store | built |
| 0.2 | [Distributions](#distributions), [patterns](#patterns-1), a specified [pseudorandom generator](#pseudorandom-numbers) and [generators](#generators) | designed |
| 0.3 | [Characterizers](#characterizers), which fit patterns from streams of data | designed |

```
python3/mbse/Patterns/, typescript5/src/
  Constraints    predicates and sets of them, as data
  Validators     data checked against predicates
  Queries        a rule as a query; the queryable store protocol; Scan, the in-memory implementation
  Conformance/   the corpus both implementations write byte-identically
```

## Predicates

- **A predicate is a named rule over symbols.** Each symbol is bound to an object of a schema, a named reference
  object schema as a store registers it; the predicate applies to a *match*, a binding of every symbol to an object of
  its schema. The rule is a Basic expression (mbse-expressions) whose free names are the symbols: "a contact is an
  adult" has one symbol, `the`, and the rule `the.age >= 18`; "a contact's phone has a number" has two, `c` and `p`,
  and the rule `any(e in entries(c, 'phones'), e.phone == p) implies has(p, 'number')`.
- **Predicates are built as schemas are.** `OfPredicate.Builder()` is fluent: `.name(...)`, `.description(...)`,
  `.symbols({"the": Contact})` (added in order) and `.rule(spec)`, finalized by `create()`, `clone()` or `update()`,
  none of which validates. A rule spec is any Basic `Spec`: data, a writer, or, in Python, what
  `Python.Text.FromFunction(lambda the: the.age >= 18)` reads from a function whose parameters are the symbols.
  `OfSet.Builder().predicates(*specs)` gathers predicates in order, each a predicate or a callable taking a predicate
  builder.
- **Predicates live beside the schemas.** A schema does not hold its predicates, and mbse-schemas does not depend on
  mbse-expressions; several sets may constrain one schema, and a program chooses which apply.
- **Predicates are data.** `OfPredicate.Data` and `OfSet.Data` are mbse-schemas reference objects with meta-schemas
  (`Patterns.Predicate`, `Patterns.Set`). A symbol is written as a property's type is (`Schemas.OfProperty.Schema`): its
  schema by name when it has one, which every symbol's has, else inline. A predicate is its rule's parent through Basic's
  own relation `Expressions.Arguments` (index 0), as an operation is its arguments'; a rule may be shared by several
  predicates and is written once. A set holds its predicates through `Patterns.Members`, by `index`; an entry without
  one comes after those with one.
- **Writing needs no store; reading resolves names.** Schemas carry their names (mbse-schemas 0.3), so a predicate
  writes its symbols' schemas by name through any store. Reading one back resolves those names, so it goes through
  `OfStore(store)`, a store of the predicates' bound classes and Basic's that resolves names in `store`, the user's
  store of schemas. `Builders` is one that resolves none: it writes any predicate, and reads those whose schemas are
  inline. `register(store)` registers the meta-schemas, and Basic's, in another store (a `Proxies.OfStore` then holds
  predicates as proxies).
- **Predicates are checked when asked.** `validate()` reports a missing name or rule, no symbols, a symbol whose schema
  is not a named reference object schema, and the rule's problems as a core Basic rule over the symbols
  ("predicate 'Bad': argument 1: variable 'n' is not bound"); a set's, also two predicates with one name ("defined
  twice"). `check(predicates)` gives a set and raises `ValueError` with every problem.

## Validators

- **`Validate(store, predicates)(schema, value)`** checks each predicate on its matches among `value` alone, and
  `.Reachable(schema, root)` on its matches among the root and every object reachable from it: every combination of
  those objects whose schemas fit its symbols. The predicates are checked statically when the validator is made, so a
  rule that cannot be right is reported once.
- **Problems are labelled by match**, each object as mbse-schemas labels it, by schema name and position in
  `Reachable.of` order: `c=Contact#2, p=Phone#5: 'OwnedNumbered' does not hold`. A value of another schema than the
  one given is reported as mbse-schemas does.
- **Unknown is not false.** A rule is unknown when a property it reads is absent; `unknown` decides: `report` (the
  default) gives `the=Contact#2: 'IsAnAdult' is unknown`, `ignore` gives nothing, and `violation` reports it as not
  holding.
- **A rule that raises is reported in place**, with the class and message of what it raised, and the other predicates
  and matches are still checked; a rule that gives a value other than a bool raises `TypeError`, reported so.
- **Structure is mbse-schemas' to check.** `Validators.Validate(store)` checks values against schemas; this checks them
  against predicates. Run both.

## Queries

- **A predicate is a query.** `select(predicate, variables, unknown)` gives the predicate's matches among the store's
  data for which its rule holds, each a mapping from symbol to object; `variables` binds the rule's other names, and
  `unknown` also gives the matches for which it is unknown.
- **Results stream lazily.** `select` returns an iterator. The predicate is checked when `select` is called, which
  raises for no symbols, a symbol's schema that is not a named reference object schema or that the store does not
  hold, a variable named like a symbol, or a rule that is not a core Basic rule over the symbols and the variables; the
  extents are read only as matches are asked for. A rule that does not give a bool raises as it is evaluated.
- **A query sees the store's data.** Its candidates come from the symbols' extents, which in mbse-schemas are what the
  store's singletons reach: objects built with the store's builders but never linked to its data are transient, and no
  query finds them.
- **The matches are the cross product, and the rule's shape says what is practical.** The meaning of a query is the
  cross product of its symbols' extents, filtered by the rule; how the matches are found is the implementation's to
  choose, judiciously, from the rule's shape. `Scan(store)`, the in-memory implementation for any store, plans each
  query:
  - What the variables alone determine is evaluated once, first (`Partials`); a rule they decide false yields
    nothing. An object has no literal, so a variable bound to one stays a variable, bound for each match.
  - The rule's top-level conjuncts (`and`) are tested as soon as the symbols they read are bound, so a partial match
    that fails one is never extended.
  - A conjunct `any(e in entries(a, 'adjacency'), e.link == b)`, a hop, relates two symbols through a relation: `b`'s
    candidates are then the targets of `a`'s entries through `link`, those of `b`'s schema, not `b`'s whole extent.
  - The relation's `unique` clauses say how far a hop fans out: when one makes `a`'s end the key of the relation's
    entries (`unique(S)` with every field outside `S` being `a`'s link), `a` has at most one entry, and such hops are
    taken before the others.
  - A symbol no hop reaches is scanned. Symbols that a hop from another could reach are scanned last, so that the hop
    is taken instead; otherwise symbols are scanned in their declared order.
- **`Scan.explain(predicate, variables)`** describes the plan, one line per symbol (`p: c.phones to phone, any number,
  then 2 tests`), so that the plan is tested, and explained to whoever writes the rule.
- **`QueryableStore` is the protocol**: `Stores.Store` with `select`. A store that answers queries natively (a database,
  a cache slice) implements `select` itself, translating the rule into its own query language where it can, and
  `select(store, ...)` asks a queryable store and scans any other.

## Distributions

Planned for 0.2. A pattern needs to say how values are distributed, as data that both implementations sample
identically.

- **Distributions are a dialect.** `Distributions` is an mbse-expressions dialect, declared with `Terms.Declared` and
  bound to its meta-schemas like Basic, so distributions are stored, validated and compared as expressions are. Its
  kinds: `Constant(value)`, `Uniform(low, high)` (ints and floats), `Normal(mean, deviation)`, `Categorical(weights)`
  over values or over predicates, `Poisson(rate)` and `Geometric(p)` (for counts), and `Mixture(weights, parts)`.
  Parameters are Basic expressions, so one distribution may depend on another's sample (`Normal(this.age * 2, 1)`).
- **A distribution has a domain**, inferred like a Basic expression's: `Normal` gives a float, `Poisson` an int, a
  `Categorical` its values' domain. A sample outside a property's schema (a float for an `int` property) is refused
  when the pattern is checked, not when it is sampled.

## Patterns

Planned for 0.2. A pattern is a population of one schema's objects, layered:

- **Weights over predicates.** A pattern divides a schema's population by predicates: 30% satisfy `senior`, 70% do
  not. The weights are a `Categorical` over predicates of a `Set`; nested categoricals give conditional proportions
  (of seniors, 90% have an email).
- **Distributions within each part.** Within a part, each property has a distribution (`age ~ Normal(72, 5)` among
  seniors) and each adjacency a distribution of its number of entries (`phones ~ Poisson(1.5)`) and of their targets
  (a pattern of the target schema, or a choice among existing objects of the store).
- **A pattern is consistent with its predicates.** A part's distributions must give objects that satisfy the part's
  predicates; where they may not, the generator rejects and redraws, up to a bound, and reports the rejection rate.
  Checking consistency statically, by a solver, is an open question.
- **Patterns are data**, bound to their meta-schemas like predicates, and refer to the sets and predicates they
  weigh.

## Pseudorandom numbers

Planned for 0.2. Generated data is byte-identical in Python and TypeScript from the same seed, as all output of the
two implementations is.

- **The generator is specified, not borrowed.** Neither Python's `random` nor JavaScript's `Math.random` is used. One
  published generator (PCG32, or xoshiro256\*\*, chosen in 0.2) is implemented in both, on integers (Python `int`,
  TypeScript `bigint`), with streams split deterministically per object and property, so that adding a property to a
  pattern does not change the values drawn for the others.
- **Sampling algorithms are specified too**: the bounded integer method, the float from 53 bits, the normal transform
  (Box–Muller, not a ziggurat, so that it is exact to specify), Poisson by inversion. A conformance corpus of generated
  data checks that both implementations produce the same bytes.

## Generators

Planned for 0.2. `Generate(store, pattern, seed)` builds objects in a store, as the store's builders build any object,
so generated data is ordinary data: validated, queried, serialized. A generator is a stream: it builds one object per
step, with its value objects and the entries the pattern gives it, and links what it builds to the store's data as the
pattern says (e.g. listed in a singleton directory), or leaves it transient.

## Characterizers

Planned for 0.3. A characterizer reads a stream of objects of one schema and fits a pattern to them: the proportion
satisfying each predicate of a set, and, per part, each property's distribution and each adjacency's number of
entries, from a family the caller chooses (or the best of several by a criterion, such as the log-likelihood).

- **One pass, bounded memory.** Estimators are online: counts and proportions, Welford's mean and variance, quantile
  sketches, reservoir samples for categoricals with too many values. A characterizer can read a store's extent, a
  query's matches, or any stream of objects.
- **Generators and characterizers round-trip.** Generating from a pattern and characterizing the result gives the
  pattern back within sampling error; this is how both are tested, with seeds fixed and tolerances stated.

## Open questions

- Native queries: how a database store translates a Basic rule into its query language, and what it does with a rule
  it cannot translate (scan, or refuse).
- Standing queries, emitting objects as they enter or leave the matching set while the store changes, need mbse-schemas
  to notify changes, which waits on its mutations and transactions.
- Asynchronous queries (`AsyncIterator`) for stores whose reads are asynchronous, in TypeScript especially.
- Predicates over value objects: a match binds reference objects, from extents; a rule about a value object is
  written today as a rule about its owner.
- Checking statically that a pattern's distributions satisfy its predicates (a solver), rather than by rejection.
- More shapes for the planner: hops in the other direction (from `b` to `a` through `b`'s own adjacency), equality on
  keys, and ordering scans by extent size.
- Which pseudorandom generator, and how streams are split.

## Resolved

- Predicates live beside the schemas, in this package, not inside mbse-schemas' schemas: mbse-schemas cannot depend
  on mbse-expressions, and several sets may apply to one schema.
- A predicate names its symbols and their schemas (`.symbols({"the": Contact})`) and applies to matches; there is no
  implicit `this`. A predicate is built as schemas are, by a fluent builder.
- The matches of several symbols are the cross product of their extents; a rule's shape communicates what is practical,
  and the implementation optimizes from it, relations' `unique` clauses included.
- Symbols are written by their schemas' names, which schemas carry (mbse-schemas 0.3), so writing a predicate needs no
  store; reading resolves the names in one.
- Queries are this package's, not an extension in mbse-expressions; mbse-expressions keeps the rules.
- A query streams lazily over the store's data first; standing queries come later.
- A pattern is layered: weights over predicates, and distributions within each part.
- Generated data is byte-identical across implementations from a seed.
- A predicate links its rule through `Expressions.Arguments`, whose argument end Basic's kinds already declare
  (`used_by`), so mbse-schemas' validation accepts the link; a relation of this package's would need Basic's kinds to
  declare it.
