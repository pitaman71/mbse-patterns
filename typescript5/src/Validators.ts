/**
 * Validators: data checked against predicates.
 *
 * A predicate applies to matches, each binding every symbol to an object of the symbol's schema. `Validate(store,
 * predicates)(schema, value)` checks the matches among `value` alone, and `.Reachable(schema, root)` the matches among
 * the root and every object reachable from it: every combination of those objects whose schemas fit the symbols. Each
 * returns problems, the match labelled as mbse-schemas' `Validators` labels objects (the schema name and the position
 * in `Reachable.of` order):
 *
 * - `the=Contact#0: 'IsAnAdult' does not hold`, when a rule is false;
 * - `the=Contact#0: 'IsAnAdult' is unknown`, when it is unknown (a property it reads is absent), which `unknown`
 *   decides: `'report'` (the default) reports it so, `'ignore'` does not, and `'violation'` reports it as not holding;
 * - `the=Contact#0: 'IsAnAdult' raised TypeError: ...`, when evaluating it raises.
 *
 * Structure is mbse-schemas' `Validators.Validate(store)`'s to check: run both. The predicates are checked statically
 * (`Constraints.check`) when the validator is made, so that a rule that cannot be right is reported once, not per
 * match.
 */

import { Evaluators } from "@mbse/expressions";
import { Errors, Reachable, Schemas, Stores } from "@mbse/schemas/Framework";
import { repr, typeName } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Constraints from "./Constraints.js";

export const UNKNOWN = ["report", "ignore", "violation"] as const;

/** The rule's value with `scope` bound: `true`, `false` or unknown (`null`); a rule that gives anything else throws. */
export function holds(rule: unknown, scope: Record<string, unknown>): boolean | null {
  const result = Evaluators.OfAny(rule as never, scope);
  if (result !== null && typeof result !== "boolean") throw new TypeError(`a predicate must be a bool, got ${typeName(result)}`);
  return result as boolean | null;
}

/** Validates data against predicates: `Validate(store, predicates, { unknown: "report" })(schema, value)`. */
export interface Validator {
  (schema: Schemas.OfObject.Data, value: Visitable): string[];
  /** The problems of the matches among the root and every object reachable from it through adjacencies. */
  Reachable(schema: Schemas.OfObject.Data, root: Visitable): string[];
}

/** Every combination of one item from each pool, in order. */
function product<T>(pools: readonly (readonly T[])[]): T[][] {
  return pools.reduce<T[][]>((combinations, pool) => combinations.flatMap((c) => pool.map((item) => [...c, item])), [[]]);
}

export function Validate(store: Stores.Store, predicates: Iterable<Constraints.OfPredicate.Spec> | Constraints.OfSet.Data,
  options: { unknown?: string } = {}): Validator {
  const unknown = options.unknown ?? "report";
  if (!(UNKNOWN as readonly string[]).includes(unknown)) {
    throw new Errors.ValueError(`unknown must be 'report', 'ignore' or 'violation', got ${repr(unknown)}`);
  }
  const checked = Constraints.check(predicates);

  const problem = (rule: unknown, scope: Record<string, unknown>): string | null => {
    let result: boolean | null;
    try {
      result = holds(rule, scope);
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
    const pools = new Map<string, [string, Visitable][]>();
    values.forEach((value, i) => {
      const pool = pools.get(value.schema_name()) ?? [];
      pool.push([`${value.schema_name()}#${i}`, value]);
      pools.set(value.schema_name(), pool);
    });
    const problems: string[] = [];
    for (const predicate of checked.predicates) {
      const symbols = [...predicate.symbols.keys()];
      for (const match of product([...predicate.symbols.values()].map((s) => pools.get(s.name as string) ?? []))) {
        const found = problem(predicate.rule, Object.fromEntries(symbols.map((symbol, i) => [symbol, (match[i] as [string, Visitable])[1]])));
        if (found !== null) {
          const label = symbols.map((symbol, i) => `${symbol}=${(match[i] as [string, Visitable])[0]}`).join(", ");
          problems.push(`${label}: ${repr(predicate.name)} ${found}`);
        }
      }
    }
    return problems;
  };

  return Object.assign((schema: Schemas.OfObject.Data, value: Visitable) => run(schema, [value]), {
    Reachable: (schema: Schemas.OfObject.Data, root: Visitable) => run(schema, Reachable.of(root)),
  });
}
