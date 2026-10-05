# mbse-patterns in Python

Install `mbse-patterns`, then import `Predicates`, `Constraints`, `Validators`, `Queries`, `Distributions` and
`Generators` from `mbse.Patterns`, the rules' writers
from `mbse.Expressions` (and `Text.FromFunction` from `mbse.Expressions.Dialects.Python`), and the data's framework from
`mbse.Schemas.Framework`.

## A complete program

An address book whose contacts must be adults and whose phones must have numbers: predicates written, stored, checked
against data, and used as queries.

```python
from mbse.Expressions import Expressions as E
from mbse.Expressions.Dialects.Python import Text
from mbse.Patterns import Constraints, Distributions, Generators, Predicates, Queries, Validators
from mbse.Schemas.Framework import JSON, Proxies, Schemas as S, Stores


def native(name, kind):
    return lambda p: p.name(name).of(lambda t: t.as_native(kind))


Listed = S.OfRelation.Builder().name("Listed").links("directory", "contact").create()
Phones = S.OfRelation.Builder().name("Phones").links("owner", "phone").unique("owner").create()  # a phone, one owner
Directory = S.OfObject.Builder().name("Directory").ref().singleton("book.Directory").relations(
    lambda r: r.name("contacts").of(Listed).me("directory")).create()
Contact = S.OfObject.Builder().name("Contact").ref().properties(native("name", str), native("age", int)).relations(
    lambda r: r.name("directories").of(Listed).me("contact"), lambda r: r.name("phones").of(Phones).me("owner")).create()
Phone = S.OfObject.Builder().name("Phone").ref().properties(native("number", str)).relations(
    lambda r: r.name("owners").of(Phones).me("phone")).create()
store = Proxies.OfStore()
for schema in (Directory, Contact, Phone, Listed, Phones):
    store.register(schema)

# Predicates: named rules over symbols, built fluently. A condition may be read from a lambda, or written with
# writers; the symbols are written as variables of the same names.
IsAnAdult = (Predicates.OfPredicate.Builder().name("IsAnAdult").description("18 or older")
             .symbols({"the": Contact}).requires(Text.FromFunction(lambda the: the.age >= 18)).create())
c, p = E.variable("c"), E.variable("p")
owns = Predicates.Contains(c.phones, lambda e: e.phone == p)  # p is one of c's phones
OwnedNumbered = (Predicates.OfPredicate.Builder().name("OwnedNumbered").symbols({"c": Contact, "p": Phone})
                 .requires(E.operation("implies", owns, p.has("number"))).create())
rules = Constraints.check([IsAnAdult, OwnedNumbered])

# The algebra: quantifiers over a schema's objects, built as predicates are. Mandatory, forbidden and possible links.
HasAPhone = Predicates.Exists(lambda q: q.symbols({"p": Phone}).requires(owns))
EveryoneHasAPhone = (Predicates.OfPredicate.Builder().name("EveryoneHasAPhone")  # no symbols: a statement about the whole store
                     .requires(Predicates.Forall(lambda q: q.symbols({"c": Contact}).requires(HasAPhone))).create())
Phoneless = Predicates.OfPredicate.Builder().name("Phoneless").symbols({"c": Contact}).forbids(HasAPhone).create()
Sometimes = (Predicates.OfPredicate.Builder().name("Sometimes").symbols({"c": Contact}).requires(Predicates.Choice(
    lambda ch: ch.option(0.35, HasAPhone).option(0.65, E.operation("not", HasAPhone)))).create())

# The store's data is what its singleton directory reaches.
ann = store.Contact().name("Ann").age(30).phones(lambda x: x.phone(lambda q: q.number("555-0100"))).create()
bob = store.Contact().name("Bob").phones(lambda x: x.phone(lambda q: q)).create()  # no age; a phone with no number
kid = store.Contact().name("Kid").age(9).create()
store.Directory(store.singleton("book.Directory")).contacts(lambda x: x.contact(ann)).contacts(
    lambda x: x.contact(bob)).contacts(lambda x: x.contact(kid)).update()

# Validation: every match among what the root reaches. Unknown is reported apart from false.
validate = Validators.Validate(store, rules)
assert validate.Reachable(Directory, store.singleton("book.Directory")) == [
    "the=Contact#2: 'IsAnAdult' is unknown", "the=Contact#3: 'IsAnAdult' does not hold",
    "c=Contact#2, p=Phone#5: 'OwnedNumbered' does not hold"]
assert validate(Contact, ann) == [] and Validators.Validate(store, rules, unknown="ignore")(Contact, bob) == []
links = Validators.Validate(store, [EveryoneHasAPhone, Phoneless, Sometimes])
assert links(Contact, ann) == ["the store: 'EveryoneHasAPhone' does not hold", "c=Contact#0: 'Phoneless' does not hold"]
assert links(Contact, kid) == ["the store: 'EveryoneHasAPhone' does not hold"]  # the kid is phoneless, as allowed

# Predicates are data: written by their symbols' schema names, read back through a store that resolves them.
text = JSON.ToJSON(Constraints.Builders).Reachable(Constraints.OfSet.Schema, rules)
copy = JSON.FromJSON(Constraints.OfStore(store)).Reachable(Constraints.OfSet.Schema, text)
assert [p.name for p in copy.predicates] == ["IsAnAdult", "OwnedNumbered"] and copy.predicates[0].symbols["the"] is Contact

# Queries: matches stream lazily, planned from the rule's shape.
query = Queries.Scan(store)
assert [m["the"] for m in query.select(IsAnAdult)] == [ann]
numbered = (Predicates.OfPredicate.Builder().name("Numbered").symbols({"c": Contact, "p": Phone})
            .requires(owns).requires(p.has("number")).create())
assert query.explain(numbered) == ["c: scan Contact", "p: c.phones to phone, any number, then 2 tests"]
assert [(m["c"].name, m["p"].number) for m in query.select(numbered)] == [("Ann", "555-0100")]
assert list(query.select(IsAnAdult, unknown=True)) == [{"the": ann}, {"the": bob}]

# Parameters: a predicate applied by reference, to a symbol and a value. Distributions weigh cases of predicates, given
# by reference or inline, in decreasing precedence; a generator builds new data from them, from the store's seed.
HasName = (Predicates.OfPredicate.Builder().name("HasName").symbols({"person": Contact})
           .parameters(lambda p: p.name("name"))
           .requires(Text.FromFunction(lambda person, name: person.name == name)).create())
APerson = {"person": Contact}
Names = Distributions.OfWeights.Builder().name("Names").symbols(APerson).decreasing(
    lambda wt: wt.weight(3).requires(lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "Cy"))),
    lambda wt: wt.weight(1).requires(lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "Di")))).create()
generated = Generators.Generate(store, Names, Stores.PCG32(42))  # new contacts, named as the cases say, from a seed
names = [next(generated)["person"].name for _ in range(400)]
assert set(names) == {"Cy", "Di"} and 250 < names.count("Cy") < 350  # about 3 to 1
```

## Cheat sheet

```python fragment
Predicates.OfPredicate.Builder().name(n).symbols({"the": Schema}).parameters(lambda p: p.name("k")).requires(spec).create()
HasName(person, "alice")                                    # a predicate applied by reference: its symbols, then parameters
Constraints.OfSet.Builder().predicates(*specs).create()     # specs: predicates, or callables taking a predicate builder
Constraints.check(predicates)                               # a set, or ValueError with every problem
Constraints.OfStore(store); Constraints.Builders            # read (and write) predicates; Builders resolves no names
Constraints.register(store)                                 # the meta-schemas, and the algebra's, in another store
Validators.Validate(store, predicates, unknown="report")(schema, value)   # or .Reachable(schema, root)
Queries.Scan(store).select(predicate, variables=None, unknown=False)       # matches: {symbol: object}
Queries.Scan(store).explain(predicate, variables=None)                     # the plan, one line per symbol
Queries.select(store, predicate, ...)                       # a queryable store's own select, or a scan
Predicates.Exists(lambda q: q.symbols({"p": Phone}).requires(spec).forbids(spec))   # and Forall: the algebra
Predicates.Contains(c.phones, lambda e: e.phone == p)       # Basic's any over entries(c, 'phones'); a hop for the planner
Predicates.Choice(lambda ch: ch.option(0.35, spec).option(0.65, spec))   # a weighted disjunction
Predicates.Evaluator(store)(rule, variables)                # evaluates the algebra over a store
Distributions.OfWeights.Builder().symbols(S).decreasing(lambda wt: wt.weight(3).requires(spec), ...).create()
Distributions.weight(Predicates.Evaluator(store), weights, match)          # the first holding case's weight, or 0.0
Distributions.Sample(store, weights, Stores.PCG32(seed))    # the store's matches, drawn by weight
Generators.Generate(store, weights, Stores.PCG32(seed))     # new objects: a case by weight, built from its equalities
```

## Traps

- `Text.FromFunction` reads the lambda's parameters as the rule's names: name them as the symbols. `Contains` reads its
  condition the same way, with other names (`p`) from the closure, as writers: no calls inside it.
- With several symbols, a rule without a relation between them matches every combination; say how they are related.
- `Reachable` follows adjacencies both ways: from one contact it reaches its directory, and through it every other
  contact. Validate one object alone with `validate(schema, value)`.
- A query's variables must not be named like its symbols, and an object variable is bound per match (it has no
  literal). A predicate's parameters are given as a query's variables, or by applying it; a validator refuses it.
- A distribution's cases are in decreasing precedence: a match weighs what the first case that holds says, so put the
  more specific cases first. A generator sets only what a case requires by equality (`x.p == v`, through applied
  predicates), and refuses a case that what it builds does not satisfy.
- Sampling and generating take a random source, not a store's: the same seed gives the same draws, in both languages.
