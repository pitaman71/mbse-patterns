# mbse-patterns in Python

Install `mbse-patterns`, then import `Constraints`, `Validators` and `Queries` from `mbse.Patterns`, the rules'
writers from `mbse.Expressions`, and the data's framework from `mbse.Schemas.Framework`.

## A complete program

An address book whose contacts must be adults with a phone: constraints written, stored, checked against data, and used
as queries.

```python
from mbse.Expressions import Expressions as E
from mbse.Patterns import Constraints, Queries, Validators
from mbse.Schemas.Framework import JSON, Proxies, Schemas as S


def native(name, kind):
    return lambda p: p.name(name).of(lambda t: t.as_native(kind))


Listed = S.OfRelation.Builder().links("directory", "contact").create()
Phones = S.OfRelation.Builder().links("owner", "phone").create()
Directory = S.OfObject.Builder().ref().singleton("book.Directory").relations(
    lambda r: r.name("contacts").of(Listed).me("directory")).create()
Contact = S.OfObject.Builder().ref().properties(native("name", str), native("age", int)).relations(
    lambda r: r.name("directories").of(Listed).me("contact"), lambda r: r.name("phones").of(Phones).me("owner")).create()
Phone = S.OfObject.Builder().ref().properties(native("number", str)).relations(
    lambda r: r.name("owners").of(Phones).me("phone")).create()
store = Proxies.OfStore()
for name, schema in {"Directory": Directory, "Contact": Contact, "Phone": Phone, "Listed": Listed, "Phones": Phones}.items():
    store.register(name, schema)

# Constraints: named Basic rules about `this`, by the store's names for the schemas.
this = E.variable("this")
rules = Constraints.check([
    Constraints.Constraint("Contact", "adult", this.age.ge(18), "18 or older"),
    Constraints.Constraint("Contact", "phoned", E.operation("count", E.operation("entries", this, "phones")).ge(1)),
    Constraints.Constraint("Phone", "numbered", this.has("number")),
])

# The store's data is what its singleton directory reaches.
ann = store.Contact().name("Ann").age(30).phones(lambda e: e.phone(lambda p: p.number("555-0100"))).create()
bob = store.Contact().name("Bob").phones(lambda e: e.phone(lambda p: p)).create()  # no age; a phone with no number
kid = store.Contact().name("Kid").age(9).create()
store.Directory(store.singleton("book.Directory")).contacts(lambda e: e.contact(ann)).contacts(
    lambda e: e.contact(bob)).contacts(lambda e: e.contact(kid)).update()

# Validation: each object against its own schema's constraints. Unknown is reported apart from false. Reachable from
# the directory is the whole book (#1 is Ann, #2 Bob, #3 Kid, in Reachable.of order); one object alone is just itself.
validate = Validators.Validate(store, rules)
assert validate.Reachable(Directory, store.singleton("book.Directory")) == [
    "Contact#2: 'adult' is unknown", "Contact#3: 'adult' does not hold", "Contact#3: 'phoned' does not hold",
    "Phone#5: 'numbered' does not hold"]
assert validate(Contact, ann) == [] and validate(Contact, bob) == ["Contact#0: 'adult' is unknown"]
assert Validators.Validate(store, rules, unknown="ignore")(Contact, bob) == []

# Constraints are data: store them, read them back with their rules.
text = JSON.ToJSON(Constraints.Builders).Reachable(Constraints.Set.Schema, rules)
copy = JSON.FromJSON(Constraints.Builders).Reachable(Constraints.Set.Schema, text)
assert [c.name for c in copy.of("Contact")] == ["adult", "phoned"]

# Queries: a rule selects the store's objects, lazily; variables are bound once.
adults = Queries.select(store, "Contact", this.age.ge(E.variable("min")), {"min": 18})
assert next(adults) is ann and list(adults) == []
assert list(Queries.select(store, "Contact", this.age.ge(18), unknown=True)) == [ann, bob]
loose = store.Contact().name("Loose").age(40).create()  # never listed: transient, no query finds it
assert loose not in list(Queries.select(store, "Contact", this.has("name")))
```

## Cheat sheet

```python fragment
Constraints.Constraint(schema, name, rule, description=None)  # rule: a Basic Spec about `this`
Constraints.Set(constraints); s.of("Contact"); s.validate()   # a set; one schema's; static problems
Constraints.check(constraints)                                 # a set, or ValueError with every problem
Constraints.Builders; Constraints.Set.Schema                   # read and write sets (JSON, YAML, Plain)
Constraints.register(store)                                    # the meta-schemas, and Basic's, in another store
Validators.Validate(store, rules, unknown="report")(schema, value)   # or .Reachable(schema, root)
Queries.select(store, name, rule, variables=None, unknown=False)    # an iterator; Queries.Scan(store) is queryable
```

## Traps

- A rule with an operation outside Basic's core, or a free name other than `this` (and a query's variables), is
  refused before anything is evaluated.
- `select` checks the schema name and the rule at once, but reads the extent only when the first match is asked for:
  objects listed in between are found.
- A query binds an object variable per object (an object has no literal), so `this.ne(E.variable("boss"))` works.
- A validator's labels count objects in `Reachable.of` order: `Phone#5` is the sixth object reached.
- `Reachable` follows adjacencies both ways: from one contact it reaches its directory, and through it every other
  contact. Validate one object alone with `validate(schema, value)`.
