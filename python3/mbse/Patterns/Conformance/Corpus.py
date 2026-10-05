"""The conformance corpus: the same cases, built statement for statement in every implementation.

`build()` returns `{case: (root schema, root, store)}`. Each implementation writes its snapshots to
`conformance/<implementation>/<case>.json` and `.yaml`, and checks them against every other implementation's files (see
the CONF test suite). Keep this module and `typescript5/src/Conformance/Corpus.ts` in lockstep: same cases, same values,
same order of statements.
"""

from __future__ import annotations

from mbse.Expressions import Expressions as E
from mbse.Patterns import Constraints as C, Distributions as D, Generators as G, Predicates as P
from mbse.Schemas.Framework import Proxies, Schemas as S, Stores

CASES = ["predicates", "empty", "algebra", "weights", "generated", "drawn"]


def build():
    text = lambda name: lambda p: p.name(name).of(lambda t: t.as_native(str))  # noqa: E731
    Phones = S.OfRelation.Builder().name("Phones").links("owner", "phone").unique("owner").create()  # a phone has one owner
    Phone = S.OfObject.Builder().name("Phone").ref().properties(text("number")).relations(
        lambda r: r.name("owners").of(Phones).me("phone")).create()
    Listed = S.OfRelation.Builder().name("Listed").links("directory", "contact").create()
    Contact = S.OfObject.Builder().name("Contact").ref().properties(
        text("name"), lambda p: p.name("age").of(lambda t: t.as_native(int))).relations(
        lambda r: r.name("phones").of(Phones).me("owner"), lambda r: r.name("directories").of(Listed).me("contact")).create()
    Directory = S.OfObject.Builder().name("Directory").ref().relations(
        lambda r: r.name("contacts").of(Listed).me("directory")).create()
    schemas = Proxies.OfStore()
    for schema in (Contact, Phone, Phones):
        schemas.register(schema)
    store = C.OfStore(schemas)

    # --- predicates: one and two symbols, a description, a rule shared by two predicates, a hop through a relation ---
    the, c, p = E.variable("the"), E.variable("c"), E.variable("p")
    adult = the.age.ge(18).data
    has_phone = E.operation("count", E.operation("entries", the, "phones")).ge(1).data
    predicates = C.OfSet.Builder().predicates(
        P.OfPredicate.Builder().name("IsAnAdult").description("18 or older").symbols({"the": Contact}).requires(adult).create(),
        lambda b: b.name("AdultsHavePhones").symbols({"the": Contact}).requires(E.operation("implies", adult, has_phone)),
        lambda b: b.name("OwnsNumbered").symbols({"c": Contact, "p": Phone}).requires(
            E.quantifier("any", "e", E.operation("entries", c, "phones"), E.variable("e").phone.eq(p))
            .and_(p.has("number"))),
    ).create()

    # --- empty: a set of no predicates ---
    empty = C.OfSet.Builder().create()

    # --- algebra: mandatory, forbidden and possible links, and two symbols quantified at once ---
    owns = P.Exists(lambda q: q.symbols({"p": Phone}).requires(P.Contains(c.phones, lambda e: e.phone == p)))
    algebra = C.OfSet.Builder().predicates(
        lambda b: b.name("Mandatory").requires(P.Forall(lambda q: q.symbols({"c": Contact}).requires(owns))),
        lambda b: b.name("Forbidden").symbols({"c": Contact}).forbids(owns),
        lambda b: b.name("Possible").symbols({"c": Contact}).requires(
            P.Choice(lambda ch: ch.option(0.35, owns).option(0.65, E.operation("not", owns)))),
        lambda b: b.name("Unnumbered").requires(P.Exists(lambda q: q.symbols({"c": Contact, "p": Phone})
                                                         .requires(P.Contains(c.phones, lambda e: e.phone == p))
                                                         .forbids(p.has("number")))),
    ).create()

    # --- weights: weighted cases in decreasing precedence, inline predicates applying one predicate, written once ---
    APerson = {"person": Contact}
    HasName = P.OfPredicate.Builder().name("HasName").symbols(APerson).parameters(lambda p: p.name("name")).requires(
        E.variable("person").name.eq(E.variable("name"))).create()
    weights = D.OfWeights.Builder().name("Names").symbols(APerson).decreasing(
        lambda wt: wt.weight(10).requires(lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "alice"))),
        lambda wt: wt.weight(5).requires(lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "ben"))),
        lambda wt: wt.weight(15).requires(lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "chermon"))),
        lambda wt: wt.weight(7).requires(lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "davi"))),
    ).create()

    # --- generated: twelve contacts generated from the weights, from the seed 42, listed in a directory ---
    book = Proxies.OfStore()
    for schema in (Contact, Phone, Phones, Listed, Directory):
        book.register(schema)
    directory = book.Directory().create()  # not a singleton: reading a snapshot back makes another
    generated = G.Generate(book, weights, Stores.PCG32(42))
    for _ in range(12):
        contact = next(generated)["person"]
        book.Directory(directory).contacts(lambda e, contact=contact: e.contact(contact)).update()

    # --- drawn: cases whose draws fill what their predicates leave open, from every kind of distribution, and twelve
    #     contacts generated from them, from the seed 7 ---
    drawing = D.OfWeights.Builder().name("People").symbols(APerson).decreasing(
        lambda wt: wt.weight(1).requires(lambda pred: pred.symbols(APerson).requires(pred.person.age.ge(65)))
        .draw(wt.person.age, D.Normal(lambda n: n.mean(70).deviation(8).rounded()))
        .draw(wt.person.name, D.Categorical(lambda c: c.option(3, "ann").option(1, "bo"))),
        lambda wt: wt.weight(3).requires(lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "cy")))
        .draw(wt.person.age, D.Mixture(lambda m: m.option(1, D.Uniform(lambda u: u.low(18).high(64)))
                                       .option(1, D.Poisson(lambda p: p.rate(30)))
                                       .option(1, D.Geometric(lambda g: g.probability(0.05))))),
    ).create()
    drawn = Proxies.OfStore()
    for schema in (Contact, Phone, Phones, Listed, Directory):
        drawn.register(schema)
    listing = drawn.Directory().create()
    people = G.Generate(drawn, drawing, Stores.PCG32(7))
    for _ in range(12):
        contact = next(people)["person"]
        drawn.Directory(listing).contacts(lambda e, contact=contact: e.contact(contact)).update()

    return {
        "predicates": (C.OfSet.Schema, predicates, store),
        "empty": (C.OfSet.Schema, empty, store),
        "algebra": (C.OfSet.Schema, algebra, store),
        "weights": (D.OfWeights.Schema, weights, store),
        "generated": (Directory, directory, book),
        "drawn": (Directory, listing, drawn),
    }
