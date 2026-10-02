/**
 * The conformance corpus: the same cases, built statement for statement in every implementation.
 *
 * `build()` returns `{case: [root schema, root, store]}`. Each implementation writes its snapshots to
 * `conformance/<implementation>/<case>.json` and `.yaml`, and checks them against every other implementation's files
 * (see the CONF test suite). Keep this module and `python3/mbse/Patterns/Conformance/Corpus.py` in lockstep: same
 * cases, same values, same order of statements.
 */

import { Expressions as E } from "@mbse/expressions";
import type { Schemas, Stores } from "@mbse/schemas/Framework";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as C from "../Constraints.js";

export const CASES = ["constraints", "empty"];

export function build(): Map<string, readonly [Schemas.OfObject.Data, Visitable, Stores.Store]> {
  // --- constraints: two schemas, a description, a rule shared by two constraints, every literal kind Basic rules use ---
  const self = E.variable("this");
  const adult = self.age.ge(18n).data;
  const hasPhone = E.operation("count", E.operation("entries", self, "phones")).ge(1n).data;
  const constraints = new C.Set([
    new C.Constraint("Contact", "adult", adult, "of age: 18 or older"),
    new C.Constraint("Contact", "adults-have-phones", E.operation("implies", adult, hasPhone)),
    new C.Constraint("Contact", "named", self.has("name").and_(self.name.ne(""))),
    new C.Constraint("Phone", "numbered", self.has("number").or_(E.literal(false))),
  ]);

  // --- empty: a set of no constraints ---
  const empty = new C.Set([]);

  return new Map([
    ["constraints", [C.Set.Schema, constraints, C.Builders] as const],
    ["empty", [C.Set.Schema, empty, C.Builders] as const],
  ]);
}
