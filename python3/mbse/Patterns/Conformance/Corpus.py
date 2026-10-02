"""The conformance corpus: the same cases, built statement for statement in every implementation.

`build()` returns `{case: (root schema, root, store)}`. Each implementation writes its snapshots to
`conformance/<implementation>/<case>.json` and `.yaml`, and checks them against every other implementation's files (see
the CONF test suite). Keep this module and `typescript5/src/Conformance/Corpus.ts` in lockstep: same cases, same values,
same order of statements.
"""

from __future__ import annotations

from mbse.Expressions import Expressions as E
from mbse.Patterns import Constraints as C
from mbse.Schemas.Framework import Proxies, Schemas as S

CASES = ["predicates", "empty"]


def build():
    text = lambda name: lambda p: p.name(name).of(lambda t: t.as_native(str))  # noqa: E731
    Phones = S.OfRelation.Builder().name("Phones").links("owner", "phone").unique("owner").create()  # a phone has one owner
    Phone = S.OfObject.Builder().name("Phone").ref().properties(text("number")).relations(
        lambda r: r.name("owners").of(Phones).me("phone")).create()
    Contact = S.OfObject.Builder().name("Contact").ref().properties(
        text("name"), lambda p: p.name("age").of(lambda t: t.as_native(int))).relations(
        lambda r: r.name("phones").of(Phones).me("owner")).create()
    schemas = Proxies.OfStore()
    for schema in (Contact, Phone, Phones):
        schemas.register(schema)
    store = C.OfStore(schemas)

    # --- predicates: one and two symbols, a description, a rule shared by two predicates, a hop through a relation ---
    the, c, p = E.variable("the"), E.variable("c"), E.variable("p")
    adult = the.age.ge(18).data
    has_phone = E.operation("count", E.operation("entries", the, "phones")).ge(1).data
    predicates = C.OfSet.Builder().predicates(
        C.OfPredicate.Builder().name("IsAnAdult").description("18 or older").symbols({"the": Contact}).rule(adult).create(),
        lambda b: b.name("AdultsHavePhones").symbols({"the": Contact}).rule(E.operation("implies", adult, has_phone)),
        lambda b: b.name("OwnsNumbered").symbols({"c": Contact, "p": Phone}).rule(
            E.quantifier("any", "e", E.operation("entries", c, "phones"), E.variable("e").phone.eq(p))
            .and_(p.has("number"))),
    ).create()

    # --- empty: a set of no predicates ---
    empty = C.OfSet.Builder().create()

    return {
        "predicates": (C.OfSet.Schema, predicates, store),
        "empty": (C.OfSet.Schema, empty, store),
    }
