/**
 * Generators: new data drawn from a distribution.
 *
 * `Generate(store, weights, random)` streams matches of new objects, built with the store's builders. Each step draws
 * from its own stream, `random.split(String(step))`, so a step's objects do not depend on how many were drawn before
 * it, and one seed gives the same data in every implementation. A step chooses a case of the distribution with
 * probability proportional to its weight, from the step's stream split by `"case"`, and builds, for each symbol, an
 * object of its schema:
 *
 * - the properties the case's predicate requires by equality are set first: a conjunct `x.p == v` (or `v == x.p`),
 *   where `x` is a symbol and `v` a literal, sets `x`'s property `p` to `v`, following conjunctions and applications of
 *   predicates, whose symbols and parameters are bound to their arguments (`settings(predicate)` gives them);
 * - then the case's draws, in order, draw the properties left open, each from its own stream, split from the attempt's
 *   by `"symbol.property"`, so that adding a draw does not change the others; a draw's parameters may read what is
 *   already set or drawn (`Normal((n) => n.mean(person.age.mul(2n)).deviation(1n))`).
 *
 * The objects built must weigh what the case says: the case must be the first whose predicate holds of them. If it is
 * not, the step draws again, from its stream split by `"attempt 1"`, `"attempt 2"`, ..., up to `ATTEMPTS` attempts in
 * all, and throws `ValueError`, naming the case, if none satisfies it; a case without draws builds the same objects
 * every time, and so has one attempt. `Generate` returns a `Generation`, which counts the steps it has taken and the
 * attempts it rejected. The objects are transient until linked to the store's data; generated data is ordinary data,
 * validated, queried and serialized as any other.
 */

import { Domains as BasicDomains, Expressions as E } from "@mbse/expressions";
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

/** How many times a step draws a case's properties before it gives up. */
export const ATTEMPTS = 100;

/** Matches of new objects, one per step, drawn from `weights` with `random`. The distribution is checked when called. */
export function Generate(store: Stores.Store, weights: Distributions.OfWeights, random: Stores.Random): Generation {
  return new Generation(store, Distributions.check(weights), random);
}

/** The matches a distribution generates, one per step: an iterator, which counts the `steps` it has taken and the
 * attempts it `rejected`, those whose objects the chosen case did not hold of first. */
export class Generation implements IterableIterator<Match> {
  steps = 0;
  rejected = 0;

  constructor(readonly store: Stores.Store, readonly weights: Distributions.OfWeights, readonly random: Stores.Random) {}

  [Symbol.iterator](): Generation {
    return this;
  }

  next(): IteratorResult<Match> {
    const weights = this.weights;
    const stream = this.random.split(String(this.steps));
    const cases = weights.cases as Distributions.OfCase[];
    const chosen = Sampling.weighted(stream.split("case"), cases.map((c) => c.weight as number));
    const c = cases[chosen] as Distributions.OfCase;
    const fixed = settings(c.predicate);
    const attempts = c.draws.length > 0 ? ATTEMPTS : 1;
    let first = -1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const drawing = stream.split(`attempt ${attempt}`);
      let evaluate = new Predicates.Evaluator(this.store);
      const values = new Map([...weights.symbols.keys()].map((symbol) => [symbol, new Map(fixed.get(symbol) ?? [])]));
      for (const d of c.draws as Distributions.OfDraw[]) {
        const [symbol, name] = d.target() as [string, string];
        const own = values.get(symbol) as Map<string, unknown>;
        if (!own.has(name)) {
          const scope = Object.fromEntries([...values].map(([s, v]) => [s, new BasicDomains.Record(new Map(v))]));
          own.set(name, Distributions.draw(evaluate, d.distribution, drawing.split(`${symbol}.${name}`), scope));
        }
      }
      const match: Match = Object.fromEntries([...weights.symbols].map(([symbol, schema]) =>
        [symbol, built(this.store, schema, values.get(symbol) as Map<string, unknown>)]));
      evaluate = new Predicates.Evaluator(this.store);
      first = cases.findIndex((other) => Predicates.holds(evaluate, other.predicate.rule, match) === true);
      if (first === chosen) {
        this.steps += 1;
        return { value: match, done: false };
      }
      this.rejected += 1;
    }
    if (attempts > 1) throw new Errors.ValueError(`case ${chosen} cannot be generated: none of its ${attempts} attempts satisfies it`);
    throw new Errors.ValueError(`case ${chosen} cannot be generated from its equalities: what they build `
      + (first === -1 || first > chosen ? "does not satisfy it" : `satisfies case ${first}`));
  }
}
