# Patterns

Constraints, queries and patterns over [mbse-schemas](https://github.com/pitaman71/mbse-schemas) data, built on the
rules of [mbse-expressions](https://github.com/pitaman71/mbse-expressions). This package depends on both (sibling
checkouts, pinned in `siblings.json`). Their design documents,
[`FRAMEWORK.md`](https://github.com/pitaman71/mbse-schemas/blob/main/docs/FRAMEWORK.md) and
[`EXPRESSIONS.md`](https://github.com/pitaman71/mbse-expressions/blob/main/docs/EXPRESSIONS.md), describe the schemas
and the rules; this document covers what is built from them.

It is planned in releases, each landed and reviewed before the next:

| Release | Contents | Status |
|---|---|---|
| 0.1 | [Predicates](#predicates), [validators](#validators), [queries](#queries) and the queryable in-memory store | built |
| 0.2 | [The predicate algebra](#the-predicate-algebra) and [pseudorandom numbers](#pseudorandom-numbers) | built |
| 0.3 | [Parameters and application](#parameters-and-application), [distributions](#distributions), [sampling](#pseudorandom-numbers) and [generators](#generators) | built |
| 0.4 | [Distributions](#distributions) as terms of a predicate: `Choices` and distributions of values | built |
| 0.5 | [Characterizers](#characterizers), which fit distributions from streams of data | designed |

```
python3/mbse/Patterns/, typescript5/src/
  Predicates     predicates, their application, sets, and the algebra they are written in; its evaluator
  Constraints    reading and writing predicates and distributions as data; check
  Validators     data checked against predicates
  Queries        a rule as a query; the queryable store protocol; Scan, the in-memory implementation
  Distributions  terms of the algebra that weigh alternatives (Choices) and draw values (Normal, ...)
  Sampling       values drawn from a random source, specified exactly on its words
  Generators     data drawn from a predicate: Generate (new) and Sample (the store's)
  Conformance/   the corpus both implementations write byte-identically
```

## Predicates

- **A predicate is a rule over symbols and parameters.** Each symbol is bound to an object of a schema, a named
  reference object schema as a store registers it; the predicate applies to a *match*, a binding of every symbol to an
  object of its schema. Each parameter is a value, given where the predicate is applied. The rule is an expression of
  the predicate algebra (Basic's, mbse-expressions', and the terms below) whose free names are the symbols and
  parameters: "a contact is an adult" has one symbol, `the`, and the rule `the.age >= 18`; "a person has a name" has a
  symbol, `person`, a parameter, `name`, and the rule `person.name == name`.
- **Predicates are built as schemas are.** `OfPredicate.Builder()` is fluent: `.name(...)`, `.description(...)`,
  `.symbols({"the": Contact})` and `.parameters(lambda p: p.name("name"))` (property specs, as an object schema's
  properties are, each with an optional type), added in order, and `.requires(spec)` and `.forbids(spec)`, which add
  conditions (the rule is their conjunction, and `forbids` adds the negation), finalized by `create()`, `clone()` or
  `update()`, none of which validates. A condition is any spec of the algebra: data, a writer, a term built by its
  builder, or, in Python, what `Python.Text.FromFunction(lambda person, name: person.name == name)` reads from a
  function whose parameters are the symbols and parameters. Elsewhere they are written as Basic variables of the same
  names (`c = E.variable("c")`), which the builder gives once it declares them (`pred.person`). A predicate without a
  name is written inline, where it is used; one without symbols is a statement about the whole store.
- **Predicates live beside the schemas.** A schema does not hold its predicates, and mbse-schemas does not depend on
  mbse-expressions; several sets may constrain one schema, and a program chooses which apply.
- **Predicates are terms.** `OfPredicate` is a kind of the algebra that binds its symbols and parameters within its
  rule (mbse-expressions' import role), so a predicate is checked, written and read as any expression is, and may be an
  argument of another term: that is how it is used by reference ([below](#parameters-and-application)). `OfSet`, a set
  of predicates in order, is a term too, its predicates its arguments.
- **Predicates are data.** Every term is an mbse-schemas reference object with a meta-schema (`Patterns.Predicate`,
  `Patterns.Set`, ...). Symbols and parameters are value properties, written as an object schema's properties are
  (`Schemas.OfProperty.Schema`): a symbol's schema by name when it has one, which every symbol's has, else inline;
  none are not written. A term is its arguments' parent through Basic's own relation `Expressions.Arguments`, by
  index, so a rule, or a predicate, shared by several terms is written once.
- **Writing needs no store; reading resolves names.** Schemas carry their names (mbse-schemas 0.3), so a predicate
  writes its symbols' schemas by name through any store. Reading one back resolves those names, so it goes through
  `Constraints.OfStore(store)`, a store of the terms' bound classes that resolves names in `store`, the user's store of
  schemas. `Builders` is one that resolves none: it writes any term, and reads those whose schemas are inline.
  `register(store)` registers the meta-schemas in another store (a `Proxies.OfStore` then holds predicates as
  proxies). A builder holds the symbols it is given as data; only reading a snapshot resolves names.
- **Predicates are checked when asked**, as terms are (`DIALECT.validate`, or `predicate.validate()`): a symbol whose
  schema is not a named reference object schema, a missing rule, and the rule's problems as a core rule over the
  symbols and parameters ("rule: argument 1: variable 'n' is not bound"). `Constraints.check(predicates)` gives a set,
  and raises `ValueError` with every predicate's problems, labelled by its name, a predicate without a name, and a name
  two predicates share ("defined twice").

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
  - The rule's top-level conjuncts (`and`) are tested as soon as the symbols they read are bound, so a partial match
    that fails one is never extended; those that read only variables are tested once, first, and a rule they decide
    false yields nothing.
  - A conjunct `any(e in entries(a, 'adjacency'), e.link == b)`, as `Contains(a.adjacency, lambda e: e.link == b)`
    writes it, a hop, relates two symbols through a relation: `b`'s candidates are then the targets of `a`'s entries through `link`, those of `b`'s schema, not `b`'s whole extent.
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

## The predicate algebra

Built in 0.2. Basic's quantifiers (`all`, `any`, `count`) range over collections, such as an object's `entries`;
nothing ranges over a schema's objects in a store, and links are reached only through `entries`. Mandatory, possible
and forbidden links are statements about the store, so they need both.

- **`Predicates` is a dialect extending Basic**, declared with `Terms.Declared(..., extends=Basic)` (mbse-expressions
  0.2.3), so its trees may mix Basic's kinds and its own, and Basic's writers hold its terms. Every Basic expression is
  a condition as before. Each of its kinds is a data class with a builder, as schemas and predicates are, and
  `Exists(spec)` and `Forall(spec)` resolve a spec (data, or a callable taking the builder); there are no writer
  functions of their own:
  - `Exists(lambda q: q.symbols({"p": Phone}).requires(...).forbids(...))` and `Forall(...)`, quantifiers whose
    collection is an `extent`, a schema's objects in the store, and which bind each symbol to each of its objects.
    Their builders take symbols and conditions as a predicate's does; with several symbols, the first is the
    quantifier's and each other a quantifier of the same kind in its body, so that the conditions hold within them all
    (the cross product);
  - `Contains(c.phones, lambda e: e.phone == p)`, whether one of `c`'s entries in an adjacency satisfies a condition
    on the entry. It is Basic's `any(e in entries(c, 'phones'), e.phone == p)`, not a term of its own: Python reads the
    condition as `FromFunction` reads a function, and TypeScript calls it with a variable named after its parameter
    (`(e) => e.phone.eq(p)`). A relation of more than two links needs nothing more: the condition names the link;
  - the terms of `Distributions`, [below](#distributions): weighted alternatives (`Choices`), which replaced 0.2's
    `Choice`, and distributions of values.
  - Their meta-schemas are `Patterns.OfExtent`, `Patterns.OfForall`, `Patterns.OfExists`, `Patterns.Predicate`,
    `Patterns.OfApply`, `Patterns.Set`, and `Patterns.OfChoices`, `Patterns.OfNormal`, ... for `Distributions`'.
- **Links are mandatory, possible or forbidden by these terms**, with `owns = Exists(lambda q: q.symbols({"p":
  Phone}).requires(Contains(c.phones, lambda e: e.phone == p)))`:
  - mandatory: `Builder().symbols({"c": Contact}).requires(owns)`;
  - forbidden: `Builder().symbols({"c": Contact}).forbids(owns)`;
  - possible, 35% of the time: `Builder().symbols({"c": Contact}).requires(Choices.Builder().arms(lambda a:
    a.weight(0.35).requires(owns), lambda a: a.weight(0.65).requires(not(owns))).create())`.
- **A predicate's symbols stay implicitly universal**; a predicate without symbols is a statement about the whole
  store, checked once (`Builder().requires(Forall(lambda q: q.symbols({"c": Contact}).requires(owns)))`).
- **Evaluating these terms needs the store**, which Basic's evaluator never has: `Evaluator(store)` is Basic's
  interpreter with extents from the store, reading each extent once.
- **The planner reads the conditions directly**: a top-level `Contains` between two symbols is a hop; `Exists` and
  `Forall` stop at the first witness or counterexample. Planning inside quantifiers (a hop within an `Exists`) is an
  open question.

## Parameters and application

Built in 0.3. A predicate is used by reference: its uses hold the predicate itself, so that one predicate, defined once,
is applied in several places and written once.

- **`HasName(pred.person, "alice")` applies a predicate** (`HasName.call(...)` in TypeScript, where an object is not
  callable): an `OfApply` term (`Patterns.OfApply`) whose first argument is the predicate itself and whose others are
  specs for its symbols and then its parameters, in order. It holds when the predicate's rule holds with them bound;
  `Evaluator(store)` evaluates it so. Its problems are a wrong number of arguments ("'HasName' takes 2 arguments, got
  1") and a first argument that is not a predicate; a predicate that applies itself is a cycle.
- **A predicate with parameters is checked where it is applied**: a validator refuses one, since its rule holds only
  for values of its parameters; a query takes them as variables (`select(HasName, {"name": "alice"})`).

## Distributions

Built in 0.3 and 0.4. A pattern is a predicate: the terms of `Distributions`, in its rule, say how its matches are
distributed, so that one predicate is validated, queried, sampled from and generated from alike. They are kinds of the
algebra (`Predicates.DIALECT`), each built by a builder:

```python fragment
person = E.variable("person")
People = Predicates.OfPredicate.Builder().name("People").symbols({"person": Person}).requires(
    Distributions.Choices.Builder().arms(
        lambda a: a.weight(3).requires(
            HasName(person, "senior"), person.age.ge(65),
            Distributions.Normal.Builder().symbol("age").mean(70).deviation(8).rounded()
            .requires(lambda person, age: person.age == age).create()),
        lambda a: a.weight(7).requires(
            HasName(person, "adult"),
            Distributions.Uniform.Builder().symbol("age").low(18).high(64)
            .requires(lambda person, age: person.age == age).create()),
    ).count(lambda c: c >= 1).decreasing().create()).create()
```

- **`Choices` weighs alternatives**, its arms (`Patterns.OfChoices`, `Patterns.OfArm`), each a positive weight and
  conditions, conjoined (`a.weight(3).requires(*specs)`). It holds when the number of its arms that hold satisfies its
  count (`Patterns.OfCount`), a condition read from a function whose parameter is bound to the number, at least one by
  default; when some arm is unknown, it holds if the count does whatever they turn out to be, and is unknown if that
  depends on them. With `.decreasing()`, its arms are in decreasing precedence: a match falls under the first arm that
  holds. A mixture is a choices whose arms hold distributions.
- **A distribution of values binds a symbol** within its body to a value drawn from it (an import, in mbse-expressions'
  terms; the symbol is bound within its parameters too): `Normal` (floats, or ints rounded half up with `.rounded()`),
  `Uniform` (ints in [low, high] when both bounds are ints, else floats in [low, high)), `Poisson` and `Geometric` (ints,
  for counts) and `Categorical` (values by weight, `.option(3, "ann")`, `Patterns.OfOption`). Its parameters are
  expressions, so one may read what is already drawn. Its value reaches a property only through an equality in its
  body, `person.age == age`. In Python, `.requires(...)` reads a function as `FromFunction` does, whose parameters are
  the names, outer and bound; in TypeScript it calls the function with the symbol's variable, `(age) =>
  person.age.eq(age)`, since a bundler may rename parameters.
- **Validating data, a distribution holds when its witness is in its support**: the value its body equates the symbol
  with (`person.age`, here) must be in the distribution's support (an int for a rounded normal, a number for a normal,
  [low, high] or [low, high) for a uniform, an int from 0 for a Poisson or a geometric, one of a categorical's literal
  values), and the body must hold with the symbol bound to it. It is unknown when its body has no witness.
- **A match weighs what its arms say** (`Evaluator.weigh(rule, match)`): nothing unless the rule holds; then the
  product, over the choices on its conjuncts (through applications), of the weight of the arm the match falls under
  (with `decreasing`) or the sum of the weights of the arms that hold, each times what the match weighs under the
  arm's condition.
- **Types are checked statically**: `domain(distribution)` tells the native type a distribution gives (`int`, `float`,
  `str`, `bool`, or none when it cannot be told), and `typing(predicate)` reports a distribution that sets a symbol's
  property of another type ("person.age is int, but its distribution gives float"). `Constraints.check` and the
  generators report it.
- **Sampling stays exact**: normals by Marsaglia's polar method and Poissons by inversion need `log` and `exp`, which
  are ported after fdlibm's algorithms to both languages with only IEEE 754's exact or correctly rounded operations,
  since each language's own may differ in the last place (V8's `Math.log` differs from the port once in about a
  hundred values); Box–Muller's `cos` is avoided. A Poisson's rate over 500 is drawn as a sum of Poissons of 500, so
  that `exp(-rate)` stays normal. The `drawn` case of the conformance corpus generates from every kind of
  distribution, byte-identically in both languages.

## Pseudorandom numbers

`Stores.Random` and `Stores.PCG32` are mbse-schemas'; sampling is mbse-patterns' (0.3). Generated data is byte-identical in Python and TypeScript
from the same seed, as all output of the two implementations is, and the caller chooses the source.

- **A random source is given to whatever draws from it**: `Sample(store, weights, Stores.PCG32(42))`,
  `Generate(store, weights, Stores.PCG32(42))`. A store holds none: it is data access alone, and a caller chooses a seed
  per draw (mbse-schemas 0.5; in 0.4, a store was equipped with one when made).
- **The protocol is small**: `next_u32()`, the next 32 random bits as an int, and `split(key)`, an independent stream
  determined by the source's seed and `key` alone, not by what was drawn before, so that each step of a generator draws
  from its own stream.
- **`Stores.PCG32(seed, sequence)` is the reference source**, specified exactly (PCG-XSH-RR, 64-bit state, 32-bit
  output) and implemented in both languages; `split(key)` seeds a new PCG32 from FNV-1a 64 of the key's UTF-8 bytes,
  starting from the offset basis XOR the seed, with the same sequence. Any other source meets the protocol, at the cost
  of byte-identity.
- **Sampling is specified on top of the protocol** (`Sampling`), so any source gives the same samples from the same
  words: `uniform(random)`, a float from 53 bits, `(a >> 5) * 2**26 + (b >> 6)` over `2**53`; `below(random, n)`, an
  int in [0, n) by rejection over as many words as `n - 1` needs bits; and `weighted(random, weights)`, an index whose
  running sum of weights, from the first, first exceeds `uniform(random) * total`. The `generated` case of the
  conformance corpus checks that both implementations produce the same bytes.

## Generators

Built in 0.3 and 0.4. `Generators.Generate(store, predicate, random)` streams new matches of a predicate, built with the
store's builders: a `Generation`, an iterator that counts the `steps` it has taken and the attempts it `rejected`.
`Generators.Sample(store, predicate, random)` draws the store's own matches, with replacement, by what they weigh.
Generated data is ordinary data: transient until linked to the store's data, then validated, queried and serialized
as any other.

- **Each step draws from its own stream**, `random.split(str(step))`, so a step's objects do not depend on how many
  were drawn before it, and one seed gives the same data in both languages.
- **A step walks the rule**, through conjunctions and applications of predicates (an argument neither a symbol nor a
  literal is evaluated for the walk): a `Choices` chooses an arm by weight, from the step's stream split by `"choices
  <n>"`; a distribution draws a value, from the attempt's stream split by its symbol, so that adding a distribution
  does not change the others, and the walk goes on into its body with the symbol bound to the value; an equality
  `x.p == v` (`v` a literal or a drawn value, `x` a symbol) sets `x`'s property `p`, unless an earlier one has.
- **What it builds must pass**: the rule must hold of the match, each arm chosen must hold, and with `decreasing` be
  the first of its choices to hold. If not, the step draws its values again, from its stream split by `"attempt 1"`,
  ..., keeping its arms, up to `ATTEMPTS` (100), and raises `ValueError` ("the predicate cannot be generated: none of
  its 100 attempts satisfies it"); a rule that draws nothing has one attempt ("the predicate cannot be generated from
  its equalities and choices: what they build does not satisfy it"). Rejection makes the draws conditioned on the
  rule: seniors' ages are a normal restricted to 65 and over.
- **A predicate is checked first** (`check`): its problems, its distributions' types, and parameters, which only an
  application binds.

## Characterizers

Planned for 0.5. A characterizer reads a stream of objects of one schema and fits a distribution to them: the proportion
satisfying each predicate of a set, and, per part, each property's distribution and each adjacency's number of
entries, from a family the caller chooses (or the best of several by a criterion, such as the log-likelihood).

- **One pass, bounded memory.** Estimators are online: counts and proportions, Welford's mean and variance, quantile
  sketches, reservoir samples for categoricals with too many values. A characterizer can read a store's extent, a
  query's matches, or any stream of objects.
- **Generators and characterizers round-trip.** Generating from a distribution and characterizing the result gives the
  distribution back within sampling error; this is how both are tested, with seeds fixed and tolerances stated.

## Open questions

- Native queries: how a database store translates a Basic rule into its query language, and what it does with a rule
  it cannot translate (scan, or refuse).
- Standing queries, emitting objects as they enter or leave the matching set while the store changes, need mbse-schemas
  to notify changes, which waits on its mutations and transactions.
- Asynchronous queries (`AsyncIterator`) for stores whose reads are asynchronous, in TypeScript especially.
- Predicates over value objects: a match binds reference objects, from extents; a rule about a value object is
  written today as a rule about its owner.
- Checking statically that what a generator draws satisfies the predicate (a solver), rather than by rejection, and
  drawing from a distribution truncated to its body directly.
- Generating related objects: a rule that requires links (`Exists`, `Contains`) between its symbols, or to objects the
  store already holds, and distributions of an adjacency's number of entries.
- A distribution's density in `weigh`, so that sampling and characterizing weigh values, not only arms.
- Planning inside quantifiers, and partial evaluation of rules over the algebra (Basic's reducer does not take its
  terms).
- More shapes for the planner: hops in the other direction (from `b` to `a` through `b`'s own adjacency), equality on
  keys, and ordering scans by extent size.

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
- A pattern is a predicate: weighted alternatives (`Choices`) and distributions of values are terms of its rule, as
  any condition is; a distribution binds a symbol, and its body's equalities set properties; an unreleased draft's
  separate distributions of cases and draws were dropped for it, and `Choices` replaced 0.3's `Choice`.
- Generated data is byte-identical across implementations from a seed.
- A random source is given to whatever draws from it (`Stores.Random`, in mbse-schemas), not held by a store, which
  is data access alone; PCG32 is the reference source, and streams split by key from the seed, not from what was
  drawn.
- Mandatory, possible and forbidden links are predicates: quantifiers over extents (`Exists`, `Forall`) are terms of a
  `Predicates` dialect extending Basic, links are tested by `Contains` (Basic's `any` over `entries`), and "possible"
  is weighted alternatives (`Choices`), which validation reads by their count and generators by their weights.
- The algebra follows the builder precedent of mbse-schemas: each term is a data class with a builder, built from a
  spec (data, or a callable taking the builder), and a predicate's conditions are added by `.requires(...)` and
  `.forbids(...)`; there are no writer functions of the package's own.
- Predicates are used by reference or inline, never by name.
- A predicate is used by reference: it is a term of the algebra, and applying it (`HasName(person, "alice")`) is a term
  that holds the predicate itself as its first argument, so a predicate used in several places is one object, written
  once. Predicates take parameters, as property specs, bound by applying them.
- A builder gives the variables it declares by name (`pred.person`), as the user's example writes them.
- Sampling is specified on the random source's words alone, with integer arithmetic and correctly rounded IEEE 754
  operations, so that both languages draw the same values; transcendental functions are ported rather than taken
  from each language's library.
- A predicate links its rule through `Expressions.Arguments`, whose argument end Basic's kinds already declare
  (`used_by`), so mbse-schemas' validation accepts the link; a relation of this package's would need Basic's kinds to
  declare it.
