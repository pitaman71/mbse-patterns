# mbse-patterns in Python

Install `mbse-patterns`, then import `Constraints`, `Validators` and `Queries` from `mbse.Patterns`, the rules' writers
from `mbse.Expressions` (and `Text.FromFunction` from `mbse.Expressions.Dialects.Python`), and the data's framework from
`mbse.Schemas.Framework`.

## A complete program

An address book whose contacts must be adults and whose phones must have numbers: predicates written, stored, checked
against data, and used as queries.

```python
from mbse.Expressions import Expressions as E
from mbse.Expressions.Dialects.Python import Text
from mbse.Patterns import Constraints, Queries, Validators
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

# Predicates: named rules over symbols, built fluently. A rule may be read from a lambda, or written with writers.
IsAnAdult = (Constraints.OfPredicate.Builder().name("IsAnAdult").description("18 or older")
             .symbols({"the": Contact}).rule(Text.FromFunction(lambda the: the.age >= 18)).create())
c, p, e = E.variable("c"), E.variable("p"), E.variable("e")
owns = E.quantifier("any", "e", E.operation("entries", c, "phones"), e.phone.eq(p))  # p is one of c's phones
OwnedNumbered = (Constraints.OfPredicate.Builder().name("OwnedNumbered").symbols({"c": Contact, "p": Phone})
                 .rule(E.operation("implies", owns, p.has("number"))).create())
rules = Constraints.check([IsAnAdult, OwnedNumbered])

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

# Predicates are data: written by their symbols' schema names, read back through a store that resolves them.
text = JSON.ToJSON(Constraints.Builders).Reachable(Constraints.OfSet.Schema, rules)
copy = JSON.FromJSON(Constraints.OfStore(store)).Reachable(Constraints.OfSet.Schema, text)
assert [p.name for p in copy.predicates] == ["IsAnAdult", "OwnedNumbered"] and copy.predicates[0].symbols["the"] is Contact

# Queries: matches stream lazily, planned from the rule's shape.
query = Queries.Scan(store)
assert [m["the"] for m in query.select(IsAnAdult)] == [ann]
numbered = (Constraints.OfPredicate.Builder().name("Numbered").symbols({"c": Contact, "p": Phone})
            .rule(owns.and_(p.has("number"))).create())
assert query.explain(numbered) == ["c: scan Contact", "p: c.phones to phone, any number, then 2 tests"]
assert [(m["c"].name, m["p"].number) for m in query.select(numbered)] == [("Ann", "555-0100")]
assert list(query.select(IsAnAdult, unknown=True)) == [{"the": ann}, {"the": bob}]
```

## Cheat sheet

```python fragment
Constraints.OfPredicate.Builder().name(n).description(d).symbols({"the": Schema}).rule(spec).create()  # clone(), update()
Constraints.OfSet.Builder().predicates(*specs).create()     # specs: predicates, or callables taking a predicate builder
Constraints.check(predicates)                               # a set, or ValueError with every problem
Constraints.OfStore(store); Constraints.Builders            # read (and write) predicates; Builders resolves no names
Constraints.register(store)                                 # the meta-schemas, and Basic's, in another store
Validators.Validate(store, predicates, unknown="report")(schema, value)   # or .Reachable(schema, root)
Queries.Scan(store).select(predicate, variables=None, unknown=False)       # matches: {symbol: object}
Queries.Scan(store).explain(predicate, variables=None)                     # the plan, one line per symbol
Queries.select(store, predicate, ...)                       # a queryable store's own select, or a scan
```

## Traps

- `Text.FromFunction` reads the lambda's parameters as the rule's names: name them as the symbols.
- With several symbols, a rule without a relation between them matches every combination; say how they are related.
- `Reachable` follows adjacencies both ways: from one contact it reaches its directory, and through it every other
  contact. Validate one object alone with `validate(schema, value)`.
- A query's variables must not be named like its symbols, and an object variable is bound per match (it has no
  literal).
