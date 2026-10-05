/**
 * Generators: new data drawn from a distribution.
 *
 * `Generate(store, weights, random)` streams matches of new objects, built with the store's builders. Each step draws
 * from its own stream, `random.split(String(step))`, so a step's objects do not depend on how many were drawn before
 * it, and one seed gives the same data in every implementation. It chooses a case of the distribution with probability proportional to its weight, and
 * builds, for each symbol, an object of its schema whose properties are those the case's predicate requires by
 * equality:
 *
 * - a conjunct `x.p == v` (or `v == x.p`), where `x` is a symbol and `v` a literal, sets `x`'s property `p` to `v`;
 * - an application of a predicate, `HasName.call(person, "alice")`, is followed into the predicate's rule, with its
 *   symbols and parameters bound to the arguments, so its equalities set properties as the case's own do;
 * - conjuncts of `and`s are followed too; nothing else sets a property.
 *
 * The objects built must then weigh what the case says: the case must be the first whose predicate holds of them, or
 * the generator throws `ValueError`, naming the case. Drawing the properties a case leaves open from distributions is
 * planned. The objects are transient until linked to the store's data; generated data is ordinary data, validated,
 * queried and serialized as any other.
 */

import { Expressions as E } from "@mbse/expressions";
import { Errors, Stores } from "@mbse/schemas/Framework";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Distributions from "./Distributions.js";
import * as Predicates from "./Predicates.js";
import * as Sampling from "./Sampling.js";

type Match = Record<string, Visitable>;
type Scope = ReadonlyMap<string, unknown>;

const UNSET = Symbol("unset");

function literal(node: unknown): unknown {
  return node instanceof E.OfLiteral.Data ? node.value : UNSET;
}

function operation(node: unknown, name: string, arity: number): node is E.OfOperation.Data {
  return node instanceof E.OfOperation.Data && node.name === name && node.arguments.length === arity;
}

function bound(node: unknown, scope: Scope): unknown {
  return node instanceof E.OfVariable.Data && scope.has(node.name as string) ? scope.get(node.name as string) : node;
}

/** The properties a predicate sets by equality, by symbol: `{symbol: {property: value}}`. */
export function settings(predicate: Predicates.OfPredicate): Map<string, Map<string, unknown>> {
  const found = new Map<string, Map<string, unknown>>();
  const symbols = new Set(predicate.symbols.keys());

  /** The symbol and property `node`, `get(x, 'p')`, reads, if `x` is one of the predicate's symbols. */
  const target = (node: unknown, scope: Scope): [string, string] | null => {
    if (!operation(node, "get", 2)) return null;
    const [subject, name] = [bound(node.arguments[0], scope), node.arguments[1]];
    if (subject instanceof E.OfVariable.Data && symbols.has(subject.name as string) && typeof literal(name) === "string") {
      return [subject.name as string, literal(name) as string];
    }
    return null;
  };

  const visit = (node: unknown, scope: Scope): void => {
    if (operation(node, "and", 2)) {
      for (const argument of node.arguments) visit(argument, scope);
    } else if (node instanceof Predicates.OfApply && node.predicate instanceof Predicates.OfPredicate) {
      const args = node.arguments.map((argument) => bound(argument, scope));
      visit(node.predicate.rule, new Map(node.predicate.binds().map((name, i) => [name, args[i]])));
    } else if (operation(node, "eq", 2)) {
      for (const [left, right] of [node.arguments, [...node.arguments].reverse()] as unknown[][]) {
        const read = target(left, scope);
        const value = literal(bound(right, scope));
        if (read !== null && value !== UNSET) {
          if (!found.has(read[0])) found.set(read[0], new Map());
          (found.get(read[0]) as Map<string, unknown>).set(read[1], value);
          return;
        }
      }
    }
  };

  visit(predicate.rule, new Map());
  return found;
}

function built(store: Stores.Store, schema: { name: string }, values: ReadonlyMap<string, unknown>): Visitable {
  const builder = store.builder(schema.name) as any;
  for (const [name, value] of values) {
    builder.property(name, (p: any) => p.value((a: any) => a.as_native((n: any) => n.set(value))));
  }
  return builder.create();
}

/** Matches of new objects, one per step, drawn from `weights` with `random`. The distribution is checked when called. */
export function Generate(store: Stores.Store, weights: Distributions.OfWeights, random: Stores.Random): Generator<Match> {
  Distributions.check(weights);
  return generate(store, weights, random);
}

function* generate(store: Stores.Store, weights: Distributions.OfWeights, random: Stores.Random): Generator<Match> {
  const cases = weights.cases as Distributions.OfCase[];
  const weighed = cases.map((c) => c.weight as number);
  for (let step = 0; ; step++) {
    const chosen = Sampling.weighted(random.split(String(step)), weighed);
    const values = settings((cases[chosen] as Distributions.OfCase).predicate);
    const match: Match = Object.fromEntries([...weights.symbols].map(([symbol, schema]) =>
      [symbol, built(store, schema, values.get(symbol) ?? new Map())]));
    const evaluate = new Predicates.Evaluator(store);
    const first = cases.findIndex((c) => Predicates.holds(evaluate, c.predicate.rule, match) === true);
    if (first !== chosen) {
      throw new Errors.ValueError(`case ${chosen} cannot be generated from its equalities: what they build `
        + (first === -1 || first > chosen ? "does not satisfy it" : `satisfies case ${first}`));
    }
    yield match;
  }
}
