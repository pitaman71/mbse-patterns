"""The conformance corpus: the same cases, built statement for statement in every implementation.

`build()` returns `{case: (root schema, root, store)}`. Each implementation writes its snapshots to
`conformance/<implementation>/<case>.json` and `.yaml`, and checks them against every other implementation's files (see
the CONF test suite). Keep this module and `typescript5/src/Conformance/Corpus.ts` in lockstep: same cases, same values,
same order of statements.
"""

from __future__ import annotations

from mbse.Expressions import Expressions as E
from mbse.Patterns import Constraints as C

CASES = ["constraints", "empty"]


def build():
    # --- constraints: two schemas, a description, a rule shared by two constraints, every literal kind Basic rules use ---
    this = E.variable("this")
    adult = this.age.ge(18).data
    has_phone = E.operation("count", E.operation("entries", this, "phones")).ge(1).data
    constraints = C.Set((
        C.Constraint("Contact", "adult", adult, "of age: 18 or older"),
        C.Constraint("Contact", "adults-have-phones", E.operation("implies", adult, has_phone)),
        C.Constraint("Contact", "named", this.has("name").and_(this.name.ne(""))),
        C.Constraint("Phone", "numbered", this.has("number").or_(E.literal(False))),
    ))

    # --- empty: a set of no constraints ---
    empty = C.Set(())

    return {
        "constraints": (C.Set.Schema, constraints, C.Builders),
        "empty": (C.Set.Schema, empty, C.Builders),
    }
