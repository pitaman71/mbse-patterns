# mbse-patterns in TypeScript

Install `@mbse/patterns`, then import `Predicates`, `Constraints`, `Validators`, `Queries`, `Distributions` and
`Generators` from it, the expressions' writers from
`@mbse/expressions`, and the data's framework from `@mbse/schemas/Framework`. Everything matches Python, with the
differences below.

## A complete program

The same address book as in Python.

```typescript
import { Expressions as E } from "@mbse/expressions";
import { Constraints, Distributions, Generators, Predicates, Queries, Validators } from "@mbse/patterns";
import { JSON as SchemaJSON, Proxies, Schemas as S, Stores } from "@mbse/schemas/Framework";

const native = (name: string, kind: unknown) => (p: any) => p.name(name).of((t: any) => t.as_native(kind));

const Listed = new S.OfRelation.Builder().name("Listed").links("directory", "contact").create();
const Phones = new S.OfRelation.Builder().name("Phones").links("owner", "phone").unique("owner").create(); // a phone, one owner
const Directory = new S.OfObject.Builder().name("Directory").ref().singleton("book.Directory").relations(
  (r: any) => r.name("contacts").of(Listed).me("directory")).create();
const Contact = new S.OfObject.Builder().name("Contact").ref().properties(native("name", String), native("age", BigInt)).relations(
  (r: any) => r.name("directories").of(Listed).me("contact"), (r: any) => r.name("phones").of(Phones).me("owner")).create();
const Phone = new S.OfObject.Builder().name("Phone").ref().properties(native("number", String)).relations(
  (r: any) => r.name("owners").of(Phones).me("phone")).create();
const store: any = new Proxies.OfStore();
for (const schema of [Directory, Contact, Phone, Listed, Phones]) store.register(schema);

const check = (condition: boolean, what: string) => {
  if (!condition) throw new Error(what);
};
const same = (a: Iterable<unknown>, b: unknown[]) => JSON.stringify([...a]) === JSON.stringify(b);

// Predicates: named constraints over symbols, built fluently, with conditions written with writers; the symbols are written
// as variables of the same names.
const [the, c, p] = [E.variable("the"), E.variable("c"), E.variable("p")];
const IsAnAdult = new Predicates.OfPredicate.Builder().name("IsAnAdult").description("18 or older")
  .symbols({ the: Contact }).requires(the.age.ge(18n)).create();
const owns = Predicates.Contains(c.phones, (e) => e.phone.eq(p)); // p is one of c's phones
const OwnedNumbered = new Predicates.OfPredicate.Builder().name("OwnedNumbered").symbols({ c: Contact, p: Phone })
  .requires(E.operation("implies", owns, p.has("number"))).create();
const constraints = Constraints.check([IsAnAdult, OwnedNumbered]);

// The algebra: quantifiers over a schema's objects, built as predicates are. Mandatory, forbidden and possible links.
const HasAPhone = Predicates.Exists((q) => q.symbols({ p: Phone }).requires(owns));
const EveryoneHasAPhone = new Predicates.OfPredicate.Builder().name("EveryoneHasAPhone") // no symbols: a statement about the store
  .requires(Predicates.Forall((q) => q.symbols({ c: Contact }).requires(HasAPhone))).create();
const Phoneless = new Predicates.OfPredicate.Builder().name("Phoneless").symbols({ c: Contact }).forbids(HasAPhone).create();
const Sometimes = new Predicates.OfPredicate.Builder().name("Sometimes").symbols({ c: Contact }).requires(
  new Distributions.Choices.Builder().arms((a) => a.weight(0.35).requires(HasAPhone),
    (a) => a.weight(0.65).requires(E.operation("not", HasAPhone))).create()).create();

// The store's data is what its singleton directory reaches.
const ann = store.Contact().name("Ann").age(30n).phones((x: any) => x.phone((q: any) => q.number("555-0100"))).create();
const bob = store.Contact().name("Bob").phones((x: any) => x.phone((q: any) => q)).create();
const kid = store.Contact().name("Kid").age(9n).create();
store.Directory(store.singleton("book.Directory")).contacts((x: any) => x.contact(ann)).contacts(
  (x: any) => x.contact(bob)).contacts((x: any) => x.contact(kid)).update();

// Validation: every match among what the root reaches. Unknown is reported apart from false.
const validate = Validators.Validate(store, constraints);
check(same(validate.Reachable(Directory, store.singleton("book.Directory")), [
  "the=Contact#2: 'IsAnAdult' is unknown", "the=Contact#3: 'IsAnAdult' does not hold",
  "c=Contact#2, p=Phone#5: 'OwnedNumbered' does not hold"]), "book");
check(validate(Contact, ann).length === 0 && Validators.Validate(store, constraints, { unknown: "ignore" })(Contact, bob).length === 0, "one");
const links = Validators.Validate(store, [EveryoneHasAPhone, Phoneless, Sometimes]);
check(same(links(Contact, ann), ["the store: 'EveryoneHasAPhone' does not hold", "c=Contact#0: 'Phoneless' does not hold"]), "links");
check(same(links(Contact, kid), ["the store: 'EveryoneHasAPhone' does not hold"]), "phoneless"); // the kid is phoneless, as allowed

// Predicates are data: written by their symbols' schema names, read back through a store that resolves them.
const text = SchemaJSON.ToJSON(Constraints.Builders).Reachable(Constraints.OfSet.Schema, constraints);
const copy = SchemaJSON.FromJSON(new Constraints.OfStore(store)).Reachable(Constraints.OfSet.Schema, text) as Constraints.OfSet;
check(same(copy.predicates.map((x: Predicates.OfPredicate) => x.name), ["IsAnAdult", "OwnedNumbered"]) && copy.predicates[0]!.symbols.get("the") === Contact, "copy");

// Queries: matches stream lazily, planned from the constraint's shape.
const query = new Queries.Scan(store);
check([...query.select(IsAnAdult)].map((m) => m["the"]).every((x) => x === ann), "adults");
const numbered = new Predicates.OfPredicate.Builder().name("Numbered").symbols({ c: Contact, p: Phone })
  .requires(owns).requires(p.has("number")).create();
check(same(query.explain(numbered), ["c: scan Contact", "p: c.phones to phone, any number, then 2 tests"]), "plan");
check(same([...query.select(numbered)].map((m: any) => [m.c.name, m.p.number]), [["Ann", "555-0100"]]), "numbered");
check([...query.select(IsAnAdult, null, true)].length === 2, "with unknown");

// Parameters: a predicate applied by reference, to a symbol and a value. A pattern is a predicate: choices weigh its
// alternatives, and distributions bind values its equalities set; a generator builds new data from it, from a seed,
// redrawing until it holds.
const HasName = new Predicates.OfPredicate.Builder().name("HasName").symbols({ person: Contact })
  .parameters((x) => x.name("name")).requires(E.variable("person").name.eq(E.variable("name"))).create();
const [APerson, person] = [{ person: Contact }, E.variable("person")];
const Names = new Predicates.OfPredicate.Builder().name("Names").symbols(APerson).requires(new Distributions.Choices.Builder().arms(
  (a) => a.weight(3).requires(HasName.call(person, "Cy"), new Distributions.Uniform.Builder().symbol("age").low(18n).high(64n)
    .requires((age) => person.age.eq(age)).create()), // ints, 18 to 64
  (a) => a.weight(1).requires(HasName.call(person, "Di"), new Distributions.Normal.Builder().symbol("age").mean(70n).deviation(8n)
    .rounded().requires((age) => person.age.eq(age)).create(), person.age.ge(65n)), // drawn again until 65 or over
).decreasing().create()).create();
const generated = Generators.Generate(store, Names, new Stores.PCG32(42n)); // new contacts, as the arms say
const people = Array.from({ length: 400 }, () => (generated.next().value as any).person);
const cy = people.filter((x) => x.name === "Cy").length;
check(new Set(people.map((x) => x.name)).size === 2 && cy > 250 && cy < 350, "generated"); // about 3 to 1
check(people.every((x) => x.name === "Cy" ? x.age >= 18n && x.age <= 64n : x.age >= 65n) && generated.rejected > 0, "drawn");
```

## Differences from Python

- Integers are `bigint`s (`18n`, and `BigInt` as an `int` property's native); a `number` is a float.
- Constraints are written with writers: TypeScript has no `FromFunction`, since a JavaScript function has no Python
  source. `Contains` calls its condition with a variable named after its one parameter, read from the function's source,
  so the condition is written with writers too: `(e) => e.phone.eq(p)`.
- `.symbols(...)` takes a record or a `Map`, and a predicate's `symbols` is a `Map`; a match is a record.
- A validator's options are an object: `Validate(store, constraints, { unknown: "ignore" })`.
- Builders are made with `new`: `new Predicates.OfPredicate.Builder()`; the algebra's evaluator is
  `new Predicates.Evaluator(store).run(constraint, variables)`.
- A predicate is applied with `HasName.call(person, "alice")`, since an object is not callable; Python also calls it
  directly, `HasName(person, "alice")`. A builder gives a name it has not declared as `undefined`, where Python raises
  `AttributeError`.
- Seeds and random words are `bigint`s (`new Stores.PCG32(42n)`), and weights are numbers: there is no `int` weight
  to refuse.
- A distribution's `.requires(...)` calls a function with the variable of its own symbol, `(age) => person.age.eq(age)`,
  outer names coming from the closure, where Python reads `lambda person, age: person.age == age`; a bundler may
  rename a parameter that shadows an outer name, so TypeScript does not read the names.
- `select(predicate, variables, unknown)` takes `unknown` by position (`null` for no variables), and returns a
  generator: `next()` gives `{ value, done }`.
