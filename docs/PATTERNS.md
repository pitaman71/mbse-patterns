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
| 0.1 | [Constraints](#constraints), [validators](#validators), [queries](#queries) and the queryable in-memory store | built |
| 0.2 | [Distributions](#distributions), [patterns](#patterns-1), a specified [pseudorandom generator](#pseudorandom-numbers) and [generators](#generators) | designed |
| 0.3 | [Characterizers](#characterizers), which fit patterns from streams of data | designed |

```
python3/mbse/Patterns/, typescript5/src/
  Constraints    constraints and sets of them, as data
  Validators     data checked against constraints
  Queries        a rule as a query; the queryable store protocol; Scan, the in-memory implementation
  Conformance/   the corpus both implementations write byte-identically
```

## Constraints

- **A constraint is a named Basic rule about one schema's instances.** `Constraint(schema, name, rule, description)`:
  `schema` is the name a store registers the schema under, and `rule` is a Basic expression (or any Basic `Spec`: a
  writer, or data) evaluated with `this` bound to the instance. "A contact has at least one phone" is
  `count(entries(this, 'phones')) >= 1`; Basic's core vocabulary (property access, comparisons, Kleene logic,
  arithmetic, `entries`, `count` and the quantifiers) is what a constraint may use.
- **Constraints live beside the schemas.** A schema does not hold its constraints, and mbse-schemas does not depend on
  mbse-expressions. A `Set` gathers constraints of any schemas, in order; several sets may constrain one schema, and a
  program chooses which apply. `set.of(schema)` gives one schema's constraints.
- **Constraints are data.** `Constraint` and `Set` are mbse-schemas reference objects, bound classes of their
  meta-schemas (`Patterns.Constraint`, `Patterns.Set`), so a set is stored, sent, validated and compared like any
  object. A constraint is its rule's parent through Basic's own relation `Expressions.Arguments` (index 0), as an
  operation is its arguments'; a rule may be shared by several constraints and is written once. A set holds its
  constraints through `Patterns.Members`, by `index`; an entry without one comes after those with one.
  `Constraints.Builders` is a store of these bound classes and Basic's, from which a snapshot of a set reads back with
  its rules, and `register(store)` registers the meta-schemas, and Basic's, in any other store (e.g. a
  `Proxies.OfStore`, which then holds constraints as proxies).
- **Constraints are checked statically.** `validate()` reports a missing schema name, name or rule, the rule's problems
  as a core Basic rule whose only free name is `this` ("constraint 'x' of 'Contact': variable 'n' is not bound"), and,
  in a set, two constraints of one schema with the same name ("defined twice"). `check(constraints)` gives a set and
  raises `ValueError` with every problem.

## Validators

- **`Validate(store, constraints)(schema, value)`** evaluates the constraints of `schema` on `value`, and
  `.Reachable(schema, root)` those of each object reachable from the root, each against its own schema's. The store
  names the schemas, as in mbse-schemas' `Validators`; the constraints are checked statically when the validator is
  made, so a rule that cannot be right is reported once.
- **Problems are labelled as mbse-schemas labels objects**, by schema name and position in `Reachable.of` order:
  `Contact#0: 'adult' does not hold`. A value of another schema than the one given is reported as mbse-schemas does.
- **Unknown is not false.** A rule is unknown when a property it reads is absent; `unknown` decides: `report` (the
  default) gives `Contact#0: 'adult' is unknown`, `ignore` gives nothing, and `violation` reports it as not holding.
- **A rule that raises is reported in place**: `Contact#0: 'mixed' raised TypeError: add expects numbers of one domain,
  got int and float`, and the other constraints and objects are still checked.
- **Structure is mbse-schemas' to check.** `Validators.Validate(store)` checks values against schemas; this checks
  them against constraints. Run both.

## Queries

- **A rule is a query.** `select(name, rule, variables, unknown)` gives the store's objects of the schema `name` for
  which `rule`, a Basic rule about `this`, holds; `variables` binds its other names, and `unknown` also gives the
  objects for which it is unknown.
- **Results stream lazily.** `select` returns an iterator. The rule is checked when `select` is called, which raises
  for an unknown schema, a relation, a variable named `this`, or a rule that is not a core Basic rule over `this` and
  the variables; the extent is read when the first match is asked for, and each object only as the iterator reaches
  it. A rule that does not give a bool raises as it is evaluated.
- **A query sees the store's data.** It reads the schema's extent, which in mbse-schemas is what the store's
  singletons reach: objects built with the store's builders but never linked to its data are transient, and no query
  finds them.
- **`QueryableStore` is the protocol**: `Stores.Store` with `select`. A store that answers queries natively (a database,
  a cache slice) implements `select` itself, translating the rule into its own query language where it can.
- **`Scan(store)` is the in-memory implementation**, for any store: it is the store, delegating every `Stores.Store`
  method, and answers a query by evaluating the rule over the extent. What the variables alone determine is evaluated
  once, first (`Partials`); an object has no literal, so a variable bound to one stays a variable, bound for each
  object. `select(store, ...)` asks a queryable store and scans any other.

## Distributions

Planned for 0.2. A pattern needs to say how values are distributed, as data that both implementations sample
identically.

- **Distributions are a dialect.** `Distributions` is an mbse-expressions dialect, declared with `Terms.Declared` and
  bound to its meta-schemas like Basic, so distributions are stored, validated and compared as expressions are. Its
  kinds: `Constant(value)`, `Uniform(low, high)` (ints and floats), `Normal(mean, deviation)`, `Categorical(weights)`
  over values or over constraints, `Poisson(rate)` and `Geometric(p)` (for counts), and `Mixture(weights, parts)`.
  Parameters are Basic expressions, so one distribution may depend on another's sample (`Normal(this.age * 2, 1)`).
- **A distribution has a domain**, inferred like a Basic expression's: `Normal` gives a float, `Poisson` an int, a
  `Categorical` its values' domain. A sample outside a property's schema (a float for an `int` property) is refused
  when the pattern is checked, not when it is sampled.

## Patterns

Planned for 0.2. A pattern is a population of one schema's objects, layered:

- **Weights over constraints.** A pattern divides a schema's population by constraints: 30% satisfy `senior`, 70% do
  not. The weights are a `Categorical` over constraints of a `Set`; nested categoricals give conditional proportions
  (of seniors, 90% have an email).
- **Distributions within each part.** Within a part, each property has a distribution (`age ~ Normal(72, 5)` among
  seniors) and each adjacency a distribution of its number of entries (`phones ~ Poisson(1.5)`) and of their targets
  (a pattern of the target schema, or a choice among existing objects of the store).
- **A pattern is consistent with its constraints.** A part's distributions must give objects that satisfy the part's
  constraints; where they may not, the generator rejects and redraws, up to a bound, and reports the rejection rate.
  Checking consistency statically, by a solver, is an open question.
- **Patterns are data**, bound to their meta-schemas like constraints, and refer to the sets and constraints they
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
satisfying each constraint of a set, and, per part, each property's distribution and each adjacency's number of
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
- Constraints on value objects: a set names schemas by registered name, and a value object's schema is usually
  unnamed; constraints on value objects are written today as rules about their owner.
- Checking statically that a pattern's distributions satisfy its constraints (a solver), rather than by rejection.
- Which pseudorandom generator, and how streams are split.

## Resolved

- Constraints live beside the schemas, in this package, not inside mbse-schemas' schemas: mbse-schemas cannot depend
  on mbse-expressions, and several sets may apply to one schema.
- Queries are this package's, not an extension in mbse-expressions; mbse-expressions keeps the rules.
- A query streams lazily over the store's data first; standing queries come later.
- A pattern is layered: weights over constraints, and distributions within each part.
- Generated data is byte-identical across implementations from a seed.
- A constraint links its rule through `Expressions.Arguments`, whose argument end Basic's kinds already declare
  (`used_by`), so mbse-schemas' validation accepts the link; a relation of this package's would need Basic's kinds to
  declare it.
