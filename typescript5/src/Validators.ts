/**
 * Validators: data checked against constraints.
 *
 * `Validate(store, constraints)(schema, value)` evaluates the constraints of `schema` (by the name `store` registers it
 * under) on `value`, and `.Reachable(schema, root)` on the root and every object reachable from it, each against the
 * constraints of its own schema. Each returns problems, labelled as mbse-schemas' `Validators` labels objects (the
 * schema name and the position in `Reachable.of` order):
 *
 * - `Contact#0: 'has-phone' does not hold`, when a rule is false;
 * - `Contact#0: 'has-phone' is unknown`, when it is unknown (a property it reads is absent), which `unknown` decides:
 *   `'report'` (the default) reports it so, `'ignore'` does not, and `'violation'` reports it as not holding;
 * - `Contact#0: 'has-phone' raised TypeError: ...`, when evaluating it raises.
 *
 * Structure is mbse-schemas' `Validators.Validate(store)`'s to check: run both. The constraints are checked statically
 * (`Constraints.check`) when the validator is made, so that a rule that cannot be right is reported once, not per
 * object.
 */

import { Evaluators } from "@mbse/expressions";
import { Errors, Reachable, Schemas, Stores } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Constraints from "./Constraints.js";

export const UNKNOWN = ["report", "ignore", "violation"] as const;

/** Validates data against constraints: `Validate(store, constraints, { unknown: "report" })(schema, value)`. */
export interface Validator {
  (schema: Schemas.OfObject.Data, value: Visitable): string[];
  /** The problems of the root and of every object reachable from it through adjacencies. */
  Reachable(schema: Schemas.OfObject.Data, root: Visitable): string[];
}

export function Validate(store: Stores.Store, constraints: Iterable<Constraints.Constraint> | Constraints.Set,
  options: { unknown?: string } = {}): Validator {
  const unknown = options.unknown ?? "report";
  if (!(UNKNOWN as readonly string[]).includes(unknown)) {
    throw new Errors.ValueError(`unknown must be 'report', 'ignore' or 'violation', got ${repr(unknown)}`);
  }
  const checked = Constraints.check(constraints);

  const problem = (constraint: Constraints.Constraint, value: Visitable): string | null => {
    let result: boolean | null;
    try {
      result = Evaluators.predicate(constraint.rule, value);
    } catch (error) { // a rule that raises is a problem of the data or the rule, reported in place
      return `raised ${(error as Error).name}: ${(error as Error).message}`;
    }
    if (result === null) return unknown === "ignore" ? null : unknown === "report" ? "is unknown" : "does not hold";
    return result ? null : "does not hold";
  };

  const run = (schema: Schemas.OfObject.Data, values: readonly Visitable[]): string[] => {
    const name = store.name_of(schema);
    const root = values[0] as Visitable;
    if (root.schema_name() !== name) return [`the value is a ${repr(root.schema_name())}, not an instance of the given schema`];
    const problems: string[] = [];
    values.forEach((value, i) => {
      const label = `${value.schema_name()}#${i}`;
      for (const constraint of checked.of(value.schema_name())) {
        const found = problem(constraint, value);
        if (found !== null) problems.push(`${label}: ${repr(constraint.name)} ${found}`);
      }
    });
    return problems;
  };

  return Object.assign((schema: Schemas.OfObject.Data, value: Visitable) => run(schema, [value]), {
    Reachable: (schema: Schemas.OfObject.Data, root: Visitable) => run(schema, Reachable.of(root)),
  });
}
