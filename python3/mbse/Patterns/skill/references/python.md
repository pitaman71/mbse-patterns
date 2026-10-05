# mbse-patterns in Python

Install `mbse-patterns`, then import `Predicates`, `Constraints`, `Validators` and `Queries` from `mbse.Patterns`, the rules' writers
from `mbse.Expressions` (and `Text.FromFunction` from `mbse.Expressions.Dialects.Python`), and the data's framework from
`mbse.Schemas.Framework`.

## A complete program

An address book whose contacts must be adults and whose phones must have numbers: predicates written, stored, checked
against data, and used as queries.

```python
from mbse.Expressions import Expressions as E
from mbse.Expressions.Dialects.Python import Text
from mbse.Patterns import Constraints, Predicates, Queries, Validators
from mbse.Schemas.Framework import JSON, Proxies, Schemas as S


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
IsAnAdult = (Predicates.Builder().name("IsAnAdult").description("18 or older")
             .symbols({"the": Contact}).requires(Text.FromFunction(lambda the: the.age >= 18)).create())
c, p = E.variable("c"), E.variable("p")
owns = Predicates.Contains(c.phones, lambda e: e.phone == p)  # p is one of c's phones
OwnedNumbered = (Predicates.Builder().name("OwnedNumbered").symbols({"c": Contact, "p": Phone})
                 .requires(E.operation("implies", owns, p.has("number"))).create())
rules = Constraints.check([IsAnAdult, OwnedNumbered])

# The algebra: quantifiers over a schema's objects, built as predicates are. Mandatory, forbidden and possible links.
HasAPhone = Predicates.Exists(lambda q: q.symbols({"p": Phone}).requires(owns))
EveryoneHasAPhone = (Predicates.Builder().name("EveryoneHasAPhone")  # no symbols: a statement about the whole store
                     .requires(Predicates.Forall(lambda q: q.symbols({"c": Contact}).requires(HasAPhone))).create())
Phoneless = Predicates.Builder().name("Phoneless").symbols({"c": Contact}).forbids(HasAPhone).create()
Sometimes = (Predicates.Builder().name("Sometimes").symbols({"c": Contact}).requires(Predicates.Choice(
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
numbered = (Predicates.Builder().name("Numbered").symbols({"c": Contact, "p": Phone})
            .requires(owns).requires(p.has("number")).create())
assert query.explain(numbered) == ["c: scan Contact", "p: c.phones to phone, any number, then 2 tests"]
assert [(m["c"].name, m["p"].number) for m in query.select(numbered)] == [("Ann", "555-0100")]
assert list(query.select(IsAnAdult, unknown=True)) == [{"the": ann}, {"the": bob}]
```

## Cheat sheet

```python fragment
Predicates.Builder().name(n).description(d).symbols({"the": Schema}).requires(spec).forbids(spec).create()  # clone(), update()
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
```

## Traps

- `Text.FromFunction` reads the lambda's parameters as the rule's names: name them as the symbols. `Contains` reads its
  condition the same way, with other names (`p`) from the closure, as writers: no calls inside it.
- With several symbols, a rule without a relation between them matches every combination; say how they are related.
- `Reachable` follows adjacencies both ways: from one contact it reaches its directory, and through it every other
  contact. Validate one object alone with `validate(schema, value)`.
- A query's variables must not be named like its symbols, and an object variable is bound per match (it has no
  literal).
