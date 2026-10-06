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

    # --- predicates: one and two symbols, a description, a constraint shared by two predicates, a hop through a
    # relation ---
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
            D.Choices.Builder().arms(lambda a: a.weight(0.35).requires(owns),
                                     lambda a: a.weight(0.65).requires(E.operation("not", owns))).create()),
        lambda b: b.name("Unnumbered").requires(P.Exists(lambda q: q.symbols({"c": Contact, "p": Phone})
                                                         .requires(P.Contains(c.phones, lambda e: e.phone == p))
                                                         .forbids(p.has("number")))),
    ).create()

    # --- weights: a predicate whose choices weigh names, in decreasing precedence, each applying one predicate ---
    APerson = {"person": Contact}
    person = E.variable("person")
    HasName = P.OfPredicate.Builder().name("HasName").symbols(APerson).parameters(lambda p: p.name("name")).requires(
        person.name.eq(E.variable("name"))).create()
    weights = P.OfPredicate.Builder().name("Names").symbols(APerson).requires(D.Choices.Builder().arms(
        lambda a: a.weight(10).requires(HasName(person, "alice")),
        lambda a: a.weight(5).requires(HasName(person, "ben")),
        lambda a: a.weight(15).requires(HasName(person, "chermon")),
        lambda a: a.weight(7).requires(HasName(person, "davi")),
    ).decreasing().create()).create()

    # --- generated: twelve contacts generated from the names, from the seed 42, listed in a directory ---
    book = Proxies.OfStore()
    for schema in (Contact, Phone, Phones, Listed, Directory):
        book.register(schema)
    directory = book.Directory().create()  # not a singleton: reading a snapshot back makes another
    generated = G.Generate(book, weights, Stores.PCG32(42))
    for _ in range(12):
        contact = next(generated)["person"]
        book.Directory(directory).contacts(lambda e, contact=contact: e.contact(contact)).update()

    # --- drawn: choices whose arms draw values from every kind of distribution, one nested as a mixture, and twelve
    #     contacts generated from them, from the seed 7 ---
    def aged(distribution):
        return distribution.symbol("age").requires(person.age.eq(E.variable("age"))).create()

    drawing = P.OfPredicate.Builder().name("People").symbols(APerson).requires(D.Choices.Builder().arms(
        lambda a: a.weight(1).requires(
            aged(D.Normal.Builder().mean(70).deviation(8).rounded()), person.age.ge(65),
            D.Categorical.Builder().symbol("name").option(3, "ann").option(1, "bo").requires(
                person.name.eq(E.variable("name"))).create()),
        lambda a: a.weight(3).requires(HasName(person, "cy"), D.Choices.Builder().arms(
            lambda m: m.weight(1).requires(aged(D.Uniform.Builder().low(18).high(64))),
            lambda m: m.weight(1).requires(aged(D.Poisson.Builder().rate(30))),
            lambda m: m.weight(1).requires(aged(D.Geometric.Builder().probability(0.05)))).create()),
    ).decreasing().create()).create()
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
        "weights": (P.OfPredicate.Schema, weights, store),
        "generated": (Directory, directory, book),
        "drawn": (Directory, listing, drawn),
    }
