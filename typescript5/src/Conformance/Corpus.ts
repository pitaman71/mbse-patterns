/**
 * The conformance corpus: the same cases, built statement for statement in every implementation.
 *
 * `build()` returns `{case: [root schema, root, store]}`. Each implementation writes its snapshots to
 * `conformance/<implementation>/<case>.json` and `.yaml`, and checks them against every other implementation's files
 * (see the CONF test suite). Keep this module and `python3/mbse/Patterns/Conformance/Corpus.py` in lockstep: same
 * cases, same values, same order of statements.
 */

import { Expressions as E } from "@mbse/expressions";
import { Proxies, Schemas as S, type Stores } from "@mbse/schemas/Framework";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as C from "../Constraints.js";
import * as P from "../Predicates.js";

export const CASES = ["predicates", "empty", "algebra"];

export function build(): Map<string, readonly [S.OfObject.Data, Visitable, Stores.Store]> {
  const text = (name: string) => (p: any) => p.name(name).of((t: any) => t.as_native(String));
  const Phones = new S.OfRelation.Builder().name("Phones").links("owner", "phone").unique("owner").create(); // a phone has one owner
  const Phone = new S.OfObject.Builder().name("Phone").ref().properties(text("number")).relations(
    (r: any) => r.name("owners").of(Phones).me("phone")).create();
  const Contact = new S.OfObject.Builder().name("Contact").ref().properties(
    text("name"), (p: any) => p.name("age").of((t: any) => t.as_native(BigInt))).relations(
    (r: any) => r.name("phones").of(Phones).me("owner")).create();
  const schemas = new Proxies.OfStore();
  for (const schema of [Contact, Phone, Phones]) schemas.register(schema);
  const store = new C.OfStore(schemas);

  // --- predicates: one and two symbols, a description, a rule shared by two predicates, a hop through a relation ---
  const [the, c, p] = [E.variable("the"), E.variable("c"), E.variable("p")];
  const adult = the.age.ge(18n).data;
  const hasPhone = E.operation("count", E.operation("entries", the, "phones")).ge(1n).data;
  const predicates = new C.OfSet.Builder().predicates(
    new P.Builder().name("IsAnAdult").description("18 or older").symbols({ the: Contact }).requires(adult).create(),
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
      P.Choice((ch) => ch.option(0.35, owns).option(0.65, E.operation("not", owns)))),
    (b) => b.name("Unnumbered").requires(P.Exists((q) => q.symbols({ c: Contact, p: Phone })
      .requires(P.Contains(c.phones, (e) => e.phone.eq(p))).forbids(p.has("number")))),
  ).create();

  return new Map([
    ["predicates", [C.OfSet.Schema, predicates, store] as const],
    ["empty", [C.OfSet.Schema, empty, store] as const],
    ["algebra", [C.OfSet.Schema, algebra, store] as const],
  ]);
}
