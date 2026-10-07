/**
 * The conformance corpus: the same cases, built statement for statement in every implementation.
 *
 * `build()` returns `{case: [root schema, root, store]}`. Each implementation writes its snapshots to
 * `conformance/<implementation>/<case>.json` and `.yaml`, and checks them against every other implementation's files
 * (see the CONF test suite). Keep this module and `python3/mbse/Patterns/Conformance/Corpus.py` in lockstep: same
 * cases, same values, same order of statements.
 */

import { Expressions as E } from "@mbse/expressions";
import { Proxies, Schemas as S, Stores } from "@mbse/schemas/Framework";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as C from "../Constraints.js";
import * as D from "../Distributions.js";
import * as G from "../Generators.js";
import * as P from "../Predicates.js";
import * as T from "../Transforms.js";

export const CASES = ["predicates", "empty", "algebra", "weights", "generated", "drawn", "traced"];

export function build(): Map<string, readonly [S.OfObject.Data, Visitable, Stores.Store]> {
  const text = (name: string) => (p: any) => p.name(name).of((t: any) => t.as_native(String));
  const Phones = new S.OfRelation.Builder().name("Phones").links("owner", "phone").unique("owner").create(); // a phone has one owner
  const Phone = new S.OfObject.Builder().name("Phone").ref().properties(text("number")).relations(
    (r: any) => r.name("owners").of(Phones).me("phone")).create();
  const Listed = new S.OfRelation.Builder().name("Listed").links("directory", "contact").create();
  const Contact = new S.OfObject.Builder().name("Contact").ref().properties(
    text("name"), (p: any) => p.name("age").of((t: any) => t.as_native(BigInt))).relations(
    (r: any) => r.name("phones").of(Phones).me("owner"), (r: any) => r.name("directories").of(Listed).me("contact")).create();
  const Directory = new S.OfObject.Builder().name("Directory").ref().relations(
    (r: any) => r.name("contacts").of(Listed).me("directory")).create();
  const schemas = new Proxies.OfStore();
  for (const schema of [Contact, Phone, Phones]) schemas.register(schema);
  const store = new C.OfStore(schemas);

  // --- predicates: one and two symbols, a description, a constraint shared by two predicates, a hop through a relation
  // ---
  const [the, c, p] = [E.variable("the"), E.variable("c"), E.variable("p")];
  const adult = the.age.ge(18n).data;
  const hasPhone = E.operation("count", E.operation("entries", the, "phones")).ge(1n).data;
  const predicates = new C.OfSet.Builder().predicates(
    new P.OfPredicate.Builder().name("IsAnAdult").description("18 or older").symbols({ the: Contact }).requires(adult).create(),
    (b) => b.name("AdultsHavePhones").symbols({ the: Contact }).requires(E.operation("implies", adult, hasPhone)),
    (b) => b.name("OwnsNumbered").symbols({ c: Contact, p: Phone }).requires(
      E.quantifier("any", "e", E.operation("entries", c, "phones"), E.variable("e").phone.eq(p))
        .and_(p.has("number"))),
  ).create();

  // --- empty: a set of no predicates ---
  const empty = new C.OfSet.Builder().create();

  // --- algebra: mandatory, forbidden and possible links, and two symbols quantified at once ---
  const owns = P.Exists((q) => q.symbols({ p: Phone }).requires(P.Contains(c.phones, (e) => e.phone.eq(p))));
  const algebra = new C.OfSet.Builder().predicates(
    (b) => b.name("Mandatory").requires(P.Forall((q) => q.symbols({ c: Contact }).requires(owns))),
    (b) => b.name("Forbidden").symbols({ c: Contact }).forbids(owns),
    (b) => b.name("Possible").symbols({ c: Contact }).requires(
      new D.Choices.Builder().arms((a) => a.weight(0.35).requires(owns),
        (a) => a.weight(0.65).requires(E.operation("not", owns))).create()),
    (b) => b.name("Unnumbered").requires(P.Exists((q) => q.symbols({ c: Contact, p: Phone })
      .requires(P.Contains(c.phones, (e) => e.phone.eq(p))).forbids(p.has("number")))),
  ).create();

  // --- weights: a predicate whose choices weigh names, in decreasing precedence, each applying one predicate ---
  const APerson = { person: Contact };
  const person = E.variable("person");
  const HasName = new P.OfPredicate.Builder().name("HasName").symbols(APerson).parameters((x) => x.name("name")).requires(
    person.name.eq(E.variable("name"))).create();
  const weights = new P.OfPredicate.Builder().name("Names").symbols(APerson).requires(new D.Choices.Builder().arms(
    (a) => a.weight(10).requires(HasName.call(person, "alice")),
    (a) => a.weight(5).requires(HasName.call(person, "ben")),
    (a) => a.weight(15).requires(HasName.call(person, "chermon")),
    (a) => a.weight(7).requires(HasName.call(person, "davi")),
  ).decreasing().create()).create();

  // --- generated: twelve contacts generated from the names, from the seed 42, listed in a directory ---
  const book: any = new Proxies.OfStore();
  for (const schema of [Contact, Phone, Phones, Listed, Directory]) book.register(schema);
  const directory = book.Directory().create(); // not a singleton: reading a snapshot back makes another
  const generated = G.Generate(book, weights, new Stores.PCG32(42n));
  for (let i = 0; i < 12; i++) {
    const contact = generated.next().value!["person"];
    book.Directory(directory).contacts((e: any) => e.contact(contact)).update();
  }

  // --- drawn: choices whose arms draw values from every kind of distribution, one nested as a mixture, and twelve
  //     contacts generated from them, from the seed 7 ---
  const aged = (distribution: any) => distribution.symbol("age").requires(person.age.eq(E.variable("age"))).create();
  const drawing = new P.OfPredicate.Builder().name("People").symbols(APerson).requires(new D.Choices.Builder().arms(
    (a) => a.weight(1).requires(
      aged(new D.Normal.Builder().mean(70n).deviation(8n).rounded()), person.age.ge(65n),
      new D.Categorical.Builder().symbol("name").option(3, "ann").option(1, "bo").requires(
        person.name.eq(E.variable("name"))).create()),
    (a) => a.weight(3).requires(HasName.call(person, "cy"), new D.Choices.Builder().arms(
      (m) => m.weight(1).requires(aged(new D.Uniform.Builder().low(18n).high(64n))),
      (m) => m.weight(1).requires(aged(new D.Poisson.Builder().rate(30n))),
      (m) => m.weight(1).requires(aged(new D.Geometric.Builder().probability(0.05)))).create()),
  ).decreasing().create()).create();
  const drawn: any = new Proxies.OfStore();
  for (const schema of [Contact, Phone, Phones, Listed, Directory]) drawn.register(schema);
  const listing = drawn.Directory().create();
  const people = G.Generate(drawn, drawing, new Stores.PCG32(7n));
  for (let i = 0; i < 12; i++) {
    const contact = people.next().value!["person"];
    drawn.Directory(listing).contacts((e: any) => e.contact(contact)).update();
  }

  // --- traced: three items on a shelf, labelled and sized by a composite transform, the first stepped into and decided
  //     by the caller, the others stepped over by a policy ---
  const Held = new S.OfRelation.Builder().name("Held").links("shelf", "item").create();
  const Shelf = new S.OfObject.Builder().name("Shelf").ref().singleton("Shelf").relations(
    (r) => r.name("items").of(Held).me("shelf")).create();
  const Item = new S.OfObject.Builder().name("Item").ref().properties(
    text("name"), text("label"), (p) => p.name("size").of((t) => t.as_native(BigInt))).relations(
    (r) => r.name("shelves").of(Held).me("item")).create();
  const shelf: any = new Proxies.OfStore();
  for (const schema of [Shelf, Item, Held]) shelf.register(schema);
  for (const name of ["bolt", "nut", "washer"]) {
    const item = shelf.Item().name(name).create();
    shelf.Shelf(shelf.singleton("Shelf")).items((e: any) => e.item(item)).update();
  }
  const i = E.variable("i");
  const over = (constraint: unknown) => new P.OfPredicate.Builder().symbols({ i: Item }).requires(constraint).create();
  const Option = new S.OfObject.Builder().create();
  const Case = new S.OfUnion.Builder().branches((b) => b.name("upper").of(Option), (b) => b.name("lower").of(Option)).create();
  const Label = new T.Transform("Label", over(i.has("name")), over(i.has("label")), { parameters: [(p) => p.name("case").of(Case)],
    rewrite: (s, m, a) => s.Item(m["i"]).label(a["case"] === "upper" ? (m["i"] as any).name.toUpperCase() : (m["i"] as any).name).update() });
  const Size = new T.Transform("Size", over(i.has("label")), over(i.has("size")), {
    parameters: [(p) => p.name("size").of((t) => t.as_native(BigInt))], rewrite: (s, m, a) => s.Item(m["i"]).size(a["size"]).update() });
  const Finish = new T.Transform("Finish", over(i.has("name")), over(i.has("label").and_(i.has("size"))), { parts: [Label, Size] });
  const session = new T.Session(shelf, [Finish]);
  const inner = session.step_in(session.candidates()[0] as T.Candidate);
  inner.take(inner.candidates()[1] as T.Candidate);
  inner.take((inner.candidates()[0] as T.Candidate).answer({ size: 7n }));
  session.run(new T.Policy(new T.Clause("Finish"), new T.Clause("Label", { case: "upper" }), new T.Clause("Size", { size: 2n })));
  const traces = T.register(new Proxies.OfStore());
  const trace = session.trace(traces) as Visitable;

  return new Map([
    ["predicates", [C.OfSet.Schema, predicates, store] as const],
    ["empty", [C.OfSet.Schema, empty, store] as const],
    ["algebra", [C.OfSet.Schema, algebra, store] as const],
    ["weights", [P.OfPredicate.Schema, weights, store] as const],
    ["generated", [Directory, directory, book] as const],
    ["drawn", [Directory, listing, drawn] as const],
    ["traced", [T.Trace, trace, traces] as const],
  ]);
}
