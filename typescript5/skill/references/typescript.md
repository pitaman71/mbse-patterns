# mbse-patterns in TypeScript

Install `@mbse/patterns`, then import `Constraints`, `Validators` and `Queries` from it, the rules' writers from
`@mbse/expressions`, and the data's framework from `@mbse/schemas/Framework`. Everything matches Python, with the
differences below.

## A complete program

The same address book as in Python.

```typescript
import { Expressions as E } from "@mbse/expressions";
import { Constraints, Queries, Validators } from "@mbse/patterns";
import { JSON as SchemaJSON, Proxies, Schemas as S } from "@mbse/schemas/Framework";

const native = (name: string, kind: unknown) => (p: any) => p.name(name).of((t: any) => t.as_native(kind));

const Listed = new S.OfRelation.Builder().links("directory", "contact").create();
const Phones = new S.OfRelation.Builder().links("owner", "phone").create();
const Directory = new S.OfObject.Builder().ref().singleton("book.Directory").relations(
  (r: any) => r.name("contacts").of(Listed).me("directory")).create();
const Contact = new S.OfObject.Builder().ref().properties(native("name", String), native("age", BigInt)).relations(
  (r: any) => r.name("directories").of(Listed).me("contact"), (r: any) => r.name("phones").of(Phones).me("owner")).create();
const Phone = new S.OfObject.Builder().ref().properties(native("number", String)).relations(
  (r: any) => r.name("owners").of(Phones).me("phone")).create();
const store: any = new Proxies.OfStore();
for (const [name, schema] of Object.entries({ Directory, Contact, Phone, Listed, Phones })) store.register(name, schema);

const check = (condition: boolean, what: string) => {
  if (!condition) throw new Error(what);
};
const same = (a: Iterable<unknown>, b: unknown[]) => JSON.stringify([...a]) === JSON.stringify(b);

// Constraints: named Basic rules about `this` (a reserved word in TypeScript, so the writer is `self`).
const self = E.variable("this");
const rules = Constraints.check([
  new Constraints.Constraint("Contact", "adult", self.age.ge(18n), "18 or older"),
  new Constraints.Constraint("Contact", "phoned", E.operation("count", E.operation("entries", self, "phones")).ge(1n)),
  new Constraints.Constraint("Phone", "numbered", self.has("number")),
]);

// The store's data is what its singleton directory reaches.
const ann = store.Contact().name("Ann").age(30n).phones((e: any) => e.phone((p: any) => p.number("555-0100"))).create();
const bob = store.Contact().name("Bob").phones((e: any) => e.phone((p: any) => p)).create();
const kid = store.Contact().name("Kid").age(9n).create();
store.Directory(store.singleton("book.Directory")).contacts((e: any) => e.contact(ann)).contacts(
  (e: any) => e.contact(bob)).contacts((e: any) => e.contact(kid)).update();

// Validation: each object against its own schema's constraints. Unknown is reported apart from false. Reachable from
// the directory is the whole book (#1 is Ann, #2 Bob, #3 Kid, in Reachable.of order); one object alone is just itself.
const validate = Validators.Validate(store, rules);
check(same(validate.Reachable(Directory, store.singleton("book.Directory")), [
  "Contact#2: 'adult' is unknown", "Contact#3: 'adult' does not hold", "Contact#3: 'phoned' does not hold",
  "Phone#5: 'numbered' does not hold"]), "book");
check(validate(Contact, ann).length === 0 && same(validate(Contact, bob), ["Contact#0: 'adult' is unknown"]), "one");
check(Validators.Validate(store, rules, { unknown: "ignore" })(Contact, bob).length === 0, "ignored");

// Constraints are data: store them, read them back with their rules.
const text = SchemaJSON.ToJSON(Constraints.Builders).Reachable(Constraints.Set.Schema, rules);
const copy = SchemaJSON.FromJSON(Constraints.Builders).Reachable(Constraints.Set.Schema, text) as Constraints.Set;
check(same(copy.of("Contact").map((c) => c.name), ["adult", "phoned"]), "copy");

// Queries: a rule selects the store's objects, lazily; variables are bound once.
const adults = Queries.select(store, "Contact", self.age.ge(E.variable("min")), { min: 18n });
check(adults.next().value === ann && [...adults].length === 0, "adults");
check([...Queries.select(store, "Contact", self.age.ge(18n), null, true)].length === 2, "with unknown");
const loose = store.Contact().name("Loose").age(40n).create(); // never listed: transient, no query finds it
check(![...Queries.select(store, "Contact", self.has("name"))].includes(loose), "loose");
```

## Differences from Python

- Integers are `bigint`s (`18n`, and `BigInt` as an `int` property's native); a `number` is a float.
- `this` is reserved, so the writer for the variable `this` is usually named `self`.
- A validator's options are an object: `Validate(store, rules, { unknown: "ignore" })`.
- `select(store, name, rule, variables, unknown)` takes `unknown` by position (`null` for no variables), and returns a
  generator: `next()` gives `{ value, done }`.
- A bound class's `identity()` must return a string unique to the object (see `docs/EQUIVALENCE.md`).
