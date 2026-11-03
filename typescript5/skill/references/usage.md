# Using mbse-patterns

Install `@mbse/patterns`, then import `Predicates`, `Constraints`, `Validators`, `Queries`, `Distributions`,
`Generators` and `Transforms` from it, the expressions' writers from `@mbse/expressions`, and the data's framework
(`JSON`, `Proxies`, `Schemas` and `Stores`, whose `PCG32` is the random source) from `@mbse/schemas/Framework`.

## A complete program

An address book whose contacts must be adults and whose phones must have numbers: predicates written, stored, checked
against data, and used as queries.

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

## Cheat sheet

```typescript fragment
new Predicates.OfPredicate.Builder().name(n).symbols({ the: Schema }).parameters((p) => p.name("k")).requires(spec).create()
HasName.call(person, "alice")                               // a predicate applied by reference: its symbols, then parameters
HasName.call(person, { name: "alice" })                     // parameters by name, a last object literal; one given no argument is unknown
new Constraints.OfSet.Builder().predicates(...specs).create()   // specs: predicates, or functions taking a predicate builder
Constraints.check(predicates)                               // a set, or ValueError with every problem
new Constraints.OfStore(store); Constraints.Builders        // read (and write) predicates; Builders resolves no names
Constraints.register(store)                                 // the meta-schemas, and the algebra's, in another store
Validators.Validate(store, predicates, { unknown: "report" })(schema, value)   // or .Reachable(schema, root)
new Queries.Scan(store).select(predicate, variables, unknown)   // a generator of matches: { symbol: object }; null for no variables
new Queries.Scan(store).explain(predicate, variables)       // the plan, one line per symbol
Queries.select(store, predicate, ...)                       // a queryable store's own select, or a scan
Predicates.Exists((q) => q.symbols({ p: Phone }).requires(spec).forbids(spec))   // and Forall: the algebra
Predicates.Contains(c.phones, (e) => e.phone.eq(p))         // Basic's any over entries(c, 'phones'); a hop for the planner
new Predicates.Evaluator(store).run(constraint, variables)  // evaluates the algebra over a store
new Distributions.Choices.Builder().arms((a) => a.weight(3).requires(...specs), ...).count((c) => c.ge(1n)).decreasing().create()
new Distributions.Normal.Builder().symbol("age").mean(70n).deviation(8n).rounded().requires((age) => person.age.eq(age)).create()
new Distributions.Uniform.Builder().symbol(s).low(a).high(b); Poisson...rate(r); Geometric...probability(p)
new Distributions.Categorical.Builder().symbol(s).option(3, "x").option(1, "y")   // mixtures: choices of distributions
new Predicates.Evaluator(store).weigh(constraint, match)    // the weight of the arms a match falls under, or 0
Generators.Sample(store, predicate, new Stores.PCG32(seed)) // the store's matches, drawn by weight
Generators.Generate(store, predicate, new Stores.PCG32(seed))   // new matches: arms by weight, values drawn, equalities set
new Transforms.Transform("Label", before, after, { parameters: [caseSpec], rewrite })   // or { parts: [...] }: a composite
const session = new Transforms.Session(store, [Label, Size])    // enabled: before holds, after not; finite domains expand
session.candidates(policy); session.take(c.answer({ size: 3n }))   // the caller decides, one step at a time; step_in(c) too
session.run(new Transforms.Policy(new Transforms.Clause("Label", { case: "upper" }, 2)))   // or step_over: the policy decides
session.trace(Transforms.register(store))                   // the steps as data, a Transforms.Trace
Transforms.steps(store, trace)                              // read back; step.key === "Label(i=Shelf/items[0])"
// a rewrite may return what it wrote, by role, as a Map: new Map([["box", box]]); step.wrote and step.match are Links
session.wrote(box)                                          // the step that wrote it
new Stores.Combined(session.store, Transforms.records(session))   // steps as objects, linked to their elements, to query
//   (Stores.Combined is mbse-schemas 0.10.0's, which this release pins; mbse-schemas 0.16.0 deprecates it)
const again = new Transforms.Session(store, [Label, Size], {}, null, session.steps)   // reuses decisions by key
again.run(); again.orphans; Transforms.diff(session.steps, again.steps)   // run() alone takes only reused ones
```

## Traps

- Integers are `bigint`s (`18n`, and `BigInt` as an `int` property's native); a `number` is a float. Seeds and random
  words are `bigint`s too (`new Stores.PCG32(42n)`); weights are numbers.
- Constraints are written with writers (`the.age.ge(18n)`, `p.has("number")`, `E.operation("implies", a, b)`); a
  function's source is never read as a constraint. `Contains` and a choices' `count` call their function with a
  variable named after its one parameter, so write its body with writers too: `(e) => e.phone.eq(p)`.
- A distribution's `.requires(...)` calls its function with the variable of the distribution's own symbol,
  `(age) => person.age.eq(age)`; outer names come from the closure. Set `.symbol(...)` first.
- Builders are made with `new`, and a predicate is applied with `.call(...)`: an object is not callable. A builder
  gives a name it has not declared as `undefined`.
- With several symbols, a constraint without a relation between them matches every combination; say how they are
  related.
- `Reachable` follows adjacencies both ways: from one contact it reaches its directory, and through it every other
  contact. Validate one object alone with `validate(schema, value)`.
- A query's variables must not be named like its symbols, and an object variable is bound per match (it has no
  literal). A predicate's parameters are given as a query's variables, or by applying it; a validator refuses it.
  `select` takes `unknown` by position, after `variables` (`null` for none), and returns a generator: `next()` gives
  `{ value, done }`.
- With `.decreasing()`, a match falls under the first arm of a choices that holds, so put the more specific arms first.
  A generator chooses arms by weight, draws values, sets what equalities say (`x.p.eq(v)`, through applied predicates),
  and redraws, up to 100 times, until the predicate holds, its chosen arms hold, and first.
  [CAP-042: data generated from constraints](mbse:mbse-basis/docs/capabilities/CAP-042.md).
- A distribution's value reaches a property only through an equality in its body (`person.age.eq(age)`), and must fit
  the property's schema: a normal gives floats unless `.rounded()`; a uniform gives `bigint`s only when both bounds
  are `bigint`s. Validating data, a distribution holds when the value that equality gives is in its support.
- A transform's options, an answer and a clause's arguments are records:
  `new Transforms.Transform("Label", before, after, { parameters, rewrite })`, `candidate.answer({ size: 3n })`; but
  what a rewrite wrote is returned as a `Map` of roles, and any other return value is no record. A rerun's earlier
  steps come last, by position, after the scope and labels.
- Sampling and generating take a random source you give, not a store's: the same seed gives the same draws.
  [PRI-013: nondeterminism passed in](mbse:mbse-basis/docs/PRINCIPLES.md#PRI-013).
