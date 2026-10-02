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

// Predicates: named rules over symbols, built fluently, with rules written with writers.
const [the, c, p, e] = [E.variable("the"), E.variable("c"), E.variable("p"), E.variable("e")];
const IsAnAdult = new Constraints.OfPredicate.Builder().name("IsAnAdult").description("18 or older")
  .symbols({ the: Contact }).rule(the.age.ge(18n)).create();
const owns = E.quantifier("any", "e", E.operation("entries", c, "phones"), e.phone.eq(p)); // p is one of c's phones
const OwnedNumbered = new Constraints.OfPredicate.Builder().name("OwnedNumbered").symbols({ c: Contact, p: Phone })
  .rule(E.operation("implies", owns, p.has("number"))).create();
const rules = Constraints.check([IsAnAdult, OwnedNumbered]);

// The store's data is what its singleton directory reaches.
const ann = store.Contact().name("Ann").age(30n).phones((x: any) => x.phone((q: any) => q.number("555-0100"))).create();
const bob = store.Contact().name("Bob").phones((x: any) => x.phone((q: any) => q)).create();
const kid = store.Contact().name("Kid").age(9n).create();
store.Directory(store.singleton("book.Directory")).contacts((x: any) => x.contact(ann)).contacts(
  (x: any) => x.contact(bob)).contacts((x: any) => x.contact(kid)).update();

// Validation: every match among what the root reaches. Unknown is reported apart from false.
const validate = Validators.Validate(store, rules);
check(same(validate.Reachable(Directory, store.singleton("book.Directory")), [
  "the=Contact#2: 'IsAnAdult' is unknown", "the=Contact#3: 'IsAnAdult' does not hold",
  "c=Contact#2, p=Phone#5: 'OwnedNumbered' does not hold"]), "book");
check(validate(Contact, ann).length === 0 && Validators.Validate(store, rules, { unknown: "ignore" })(Contact, bob).length === 0, "one");

// Predicates are data: written by their symbols' schema names, read back through a store that resolves them.
const text = SchemaJSON.ToJSON(Constraints.Builders).Reachable(Constraints.OfSet.Schema, rules);
const copy = SchemaJSON.FromJSON(new Constraints.OfStore(store)).Reachable(Constraints.OfSet.Schema, text) as Constraints.OfSet.Data;
check(same(copy.predicates.map((x) => x.name), ["IsAnAdult", "OwnedNumbered"]) && copy.predicates[0]!.symbols.get("the") === Contact, "copy");

// Queries: matches stream lazily, planned from the rule's shape.
const query = new Queries.Scan(store);
check([...query.select(IsAnAdult)].map((m) => m["the"]).every((x) => x === ann), "adults");
const numbered = new Constraints.OfPredicate.Builder().name("Numbered").symbols({ c: Contact, p: Phone })
  .rule(owns.and_(p.has("number"))).create();
check(same(query.explain(numbered), ["c: scan Contact", "p: c.phones to phone, any number, then 2 tests"]), "plan");
check(same([...query.select(numbered)].map((m: any) => [m.c.name, m.p.number]), [["Ann", "555-0100"]]), "numbered");
check([...query.select(IsAnAdult, null, true)].length === 2, "with unknown");
```

## Differences from Python

- Integers are `bigint`s (`18n`, and `BigInt` as an `int` property's native); a `number` is a float.
- Rules are written with writers: TypeScript has no `FromFunction`, since a JavaScript function has no Python source.
- `.symbols(...)` takes a record or a `Map`, and a predicate's `symbols` is a `Map`; a match is a record.
- A validator's options are an object: `Validate(store, rules, { unknown: "ignore" })`.
- `select(predicate, variables, unknown)` takes `unknown` by position (`null` for no variables), and returns a
  generator: `next()` gives `{ value, done }`.
