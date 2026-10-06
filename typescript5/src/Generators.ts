/**
 * Generators: data drawn from a predicate, new or already in a store.
 *
 * A predicate's constraint says how its matches are distributed, by the terms of `Distributions` in it: weighted
 * alternatives (`Choices`) and values drawn (`Normal`, ...). `Generate(store, predicate, random)` builds new matches,
 * and `Sample(store, predicate, random)` draws the store's own, by weight.
 *
 * **Generating.** Each step draws from its own stream, `random.split(String(step))`, so a step's objects do not depend
 * on how many were drawn before it, and one seed gives the same data in every implementation. A step walks the
 * constraint, through conjunctions and applications of predicates (their symbols and parameters bound to their
 * arguments):
 *
 * - a `Choices` chooses an arm by weight, from the step's stream split by `"choices <n>"`, `n` counting the choices
 *   met, and the walk goes on into the arm's condition;
 * - a distribution draws a value, from the attempt's stream split by its symbol, so that adding a distribution does not
 *   change the others, its parameters evaluated with what is already set or drawn; the walk goes on into its body, with
 *   the symbol bound to the value;
 * - an equality `x.p == v` (or `v == x.p`), where `x` is one of the predicate's symbols and `v` a literal or a drawn
 *   value, sets `x`'s property `p` to `v`, unless it is already set; nothing else sets a property.
 *
 * It then builds, for each symbol, an object of its schema with the properties set, and checks it: the constraint must
 * hold of the match, each arm chosen must hold, and, with `decreasing`, be the first of its choices to hold. If it does
 * not, the step draws its values again, from its stream split by `"attempt 1"`, `"attempt 2"`, ..., keeping the arms
 * chosen, up to `ATTEMPTS` attempts, and throws `ValueError` if none passes; a constraint that draws nothing builds the
 * same objects every time, and so has one attempt. `Generate` returns a `Generation`, which counts the steps it has
 * taken and the attempts it rejected. The objects are transient until linked to the store's data; generated data is
 * ordinary data, validated, queried and serialized as any other.
 *
 * **Sampling.** `Sample` draws, with replacement, among the matches of the store's data (the cross product of the
 * symbols' extents), each with probability proportional to what it weighs (`Predicates.Evaluator.weigh`): nothing
 * unless the constraint holds; then the product of the weights of the arms it falls under.
 */

import { Domains as BasicDomains, Expressions as E } from "@mbse/expressions";
import { Errors, Stores } from "@mbse/schemas/Framework";
import { repr, typeName } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Distributions from "./Distributions.js";
import * as Predicates from "./Predicates.js";
import * as Sampling from "./Sampling.js";

type Match = Record<string, Visitable>;
type Scope = ReadonlyMap<string, unknown>;

/** How many times a step draws its values before it gives up. */
export const ATTEMPTS = 100;

/** `predicate`, throwing `ValueError` if it cannot be drawn from: the problems validation reports, a distribution that
 * sets a property of another type, or parameters, which only an application binds. */
export function check(predicate: Predicates.OfPredicate): Predicates.OfPredicate {
  const problems = [...Predicates.DIALECT.validate(predicate, { core: true }), ...Distributions.typing(predicate)];
  if (predicate.parameters.size > 0) problems.push("a predicate with parameters is drawn from where it is applied");
  if (problems.length > 0) throw new Errors.ValueError(`the predicate cannot be drawn from: ${problems.join("; ")}`);
  return predicate;
}

function numberOf(value: unknown, what: string): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  throw new TypeError(`${what} must be a number, got ${typeName(value)}`);
}

/** A value drawn from a distribution; `parameter(name)` gives its parameter `name`, and `parameter(option)` an option's
 * value. */
function draw(drawn: Distributions.Drawn, random: Stores.Random, parameter: (name: string | Distributions.Option) => unknown): unknown {
  if (drawn instanceof Distributions.Normal) {
    const value = Sampling.normal(random, numberOf(parameter("mean"), "a normal's mean"),
      numberOf(parameter("deviation"), "a normal's deviation"));
    return drawn.rounded ? BigInt(Math.floor(value + 0.5)) : value;
  }
  if (drawn instanceof Distributions.Uniform) {
    const [low, high] = [parameter("low"), parameter("high")];
    if (typeof low === "bigint" && typeof high === "bigint") {
      if (low > high) throw new Errors.ValueError(`a uniform's low must not exceed its high, got ${repr(low)} and ${repr(high)}`);
      return low + Sampling.below(random, high - low + 1n);
    }
    return Sampling.between(random, numberOf(low, "a uniform's low"), numberOf(high, "a uniform's high"));
  }
  if (drawn instanceof Distributions.Poisson) return Sampling.poisson(random, numberOf(parameter("rate"), "a Poisson's rate"));
  if (drawn instanceof Distributions.Geometric) {
    return Sampling.geometric(random, numberOf(parameter("probability"), "a geometric's probability"));
  }
  const options = (drawn as Distributions.Categorical).options as Distributions.Option[];
  return parameter(options[Sampling.weighted(random, options.map((option) => option.weight as number))] as Distributions.Option);
}

function bound(node: unknown, scope: Scope): unknown {
  return node instanceof E.OfVariable.Data && scope.has(node.name as string) ? scope.get(node.name as string) : node;
}

/** One attempt of a step: the values it sets, the arms it chooses, and whether it drew anything. */
class Attempt {
  readonly values: Map<string, Map<string, unknown>>;
  readonly chosen = new Map<Distributions.Choices, number>();
  met = 0;
  drawn = false;

  constructor(readonly generation: Generation, readonly step: Stores.Random, readonly attempt: Stores.Random) {
    this.values = new Map([...generation.predicate.symbols.keys()].map((symbol) => [symbol, new Map()]));
  }

  /** The values of the names in scope, to evaluate a parameter: a symbol's properties set so far, as a record, and a
   * literal's value (a drawn value's, or an argument's). */
  private variables(scope: Scope): Record<string, unknown> {
    return Object.fromEntries([...scope].map(([name, node]) => [name, node instanceof E.OfVariable.Data
      ? new BasicDomains.Record(new Map(this.values.get(node.name as string))) : (node as E.OfLiteral.Data).value]));
  }

  /** An application's argument, for the walk: a symbol's variable, or a literal of its value. */
  private argument(node: unknown, scope: Scope): unknown {
    const found = bound(node, scope);
    if (found instanceof E.OfVariable.Data || found instanceof E.OfLiteral.Data) return found;
    return E.literal(this.generation.evaluate.run(found, this.variables(scope)) as never).data;
  }

  visit(node: unknown, scope: Scope): void {
    if (node instanceof E.OfOperation.Data && node.name === "and" && node.arguments.length === 2) {
      for (const argument of node.arguments) this.visit(argument, scope);
    } else if (node instanceof Predicates.OfApply && node.predicate instanceof Predicates.OfPredicate) {
      const args = node.arguments.map((argument) => this.argument(argument, scope));
      this.visit(node.predicate.requires, new Map(node.predicate.binds().map((name, i) => [name, args[i]])));
    } else if (node instanceof Distributions.Choices) {
      const index = Sampling.weighted(this.step.split(`choices ${this.met}`), node.arms.map((arm) => arm.weight as number));
      this.met += 1;
      this.chosen.set(node, index);
      this.visit(node.arms[index].condition, scope);
    } else if (Distributions.DRAWN.some((kind) => node instanceof kind)) {
      const drawn = node as Distributions.Drawn;
      this.drawn = true;
      const variables = this.variables(scope);
      const parameter = (name: string | Distributions.Option) =>
        this.generation.evaluate.run(name instanceof Distributions.Option ? name.value : (drawn as any)[name], variables);
      const value = draw(drawn, this.attempt.split(drawn.symbol as string), parameter);
      this.visit(drawn.body, new Map([...scope, [drawn.symbol as string, E.literal(value as never).data]]));
    } else if (node instanceof E.OfOperation.Data && node.name === "eq" && node.arguments.length === 2) {
      for (const [left, right] of [node.arguments, [...node.arguments].reverse()] as unknown[][]) {
        const value = bound(right, scope);
        const read = left instanceof E.OfOperation.Data && left.name === "get" && left.arguments.length === 2;
        const subject = read ? bound((left as E.OfOperation.Data).arguments[0], scope) : null;
        if (read && value instanceof E.OfLiteral.Data && (left as E.OfOperation.Data).arguments[1] instanceof E.OfLiteral.Data
          && subject instanceof E.OfVariable.Data && this.values.has(subject.name as string)) {
          const own = this.values.get(subject.name as string) as Map<string, unknown>;
          const name = ((left as E.OfOperation.Data).arguments[1] as E.OfLiteral.Data).value as string;
          if (!own.has(name)) own.set(name, value.value);
          return;
        }
      }
    }
  }
}

function built(store: Stores.Store, schema: { name: string }, values: ReadonlyMap<string, unknown>): Visitable {
  const builder = store.builder(schema.name) as any;
  for (const [name, value] of values) {
    builder.property(name, (p: any) => p.value((a: any) => a.as_native((n: any) => n.set(value))));
  }
  return builder.create();
}

/** New matches of `predicate`, one per step, drawn with `random`. The predicate is checked when called. */
export function Generate(store: Stores.Store, predicate: Predicates.OfPredicate, random: Stores.Random): Generation {
  return new Generation(store, check(predicate), random);
}

/** The matches a predicate generates, one per step: an iterator, which counts the `steps` it has taken and the
 * attempts it `rejected`. */
export class Generation implements IterableIterator<Match> {
  steps = 0;
  rejected = 0;
  readonly evaluate: Predicates.Evaluator;

  constructor(readonly store: Stores.Store, readonly predicate: Predicates.OfPredicate, readonly random: Stores.Random) {
    this.evaluate = new Predicates.Evaluator(store);
  }

  [Symbol.iterator](): Generation {
    return this;
  }

  next(): IteratorResult<Match> {
    const predicate = this.predicate;
    const step = this.random.split(String(this.steps));
    for (let count = 0; count < ATTEMPTS; count++) {
      const attempt = new Attempt(this, step, step.split(`attempt ${count}`));
      attempt.visit(predicate.requires, new Map([...predicate.symbols.keys()].map((symbol) => [symbol, E.variable(symbol).data])));
      const match: Match = Object.fromEntries([...predicate.symbols].map(([symbol, schema]) =>
        [symbol, built(this.store, schema, attempt.values.get(symbol) as Map<string, unknown>)]));
      if (this.passes(attempt, match)) {
        this.steps += 1;
        return { value: match, done: false };
      }
      this.rejected += 1;
      if (!attempt.drawn) {
        throw new Errors.ValueError("the predicate cannot be generated from its equalities and choices: what they build "
          + "does not satisfy it");
      }
    }
    throw new Errors.ValueError(`the predicate cannot be generated: none of its ${ATTEMPTS} attempts satisfies it`);
  }

  /** Whether the constraint holds of the match, each arm chosen holds, and, with `decreasing`, first. */
  private passes(attempt: Attempt, match: Match): boolean {
    const evaluate = new Predicates.Evaluator(this.store);
    evaluate.observe = new Map();
    if (Predicates.holds(evaluate, this.predicate.requires, match) !== true) return false;
    for (const [node, index] of attempt.chosen) {
      const held = evaluate.observe.get(node) as (boolean | null)[]; // every choices met holds, so was evaluated
      if (held[index] !== true || (node.decreasing && held.slice(0, index).includes(true))) return false;
    }
    return true;
  }
}

/** Matches of the store's data drawn with replacement, each with probability proportional to what it weighs, from
 * `random`. The predicate is checked when called; the store is read at the first draw. */
export function Sample(store: Stores.Store, predicate: Predicates.OfPredicate, random: Stores.Random): Generator<Match> {
  check(predicate);
  return sample(store, predicate, random);
}

function* product(pools: readonly (readonly Visitable[])[]): Generator<Visitable[]> {
  if (pools.length === 0) {
    yield [];
    return;
  }
  for (const head of pools[0] as readonly Visitable[]) for (const rest of product(pools.slice(1))) yield [head, ...rest];
}

function* sample(store: Stores.Store, predicate: Predicates.OfPredicate, random: Stores.Random): Generator<Match> {
  const evaluate = new Predicates.Evaluator(store);
  const names = [...predicate.symbols.keys()];
  const matches = [...product([...predicate.symbols.values()].map((schema) => evaluate.extent(schema.name as string)))]
    .map((objects) => Object.fromEntries(names.map((name, i) => [name, objects[i] as Visitable])));
  const weighed = matches.map((match) => evaluate.weigh(predicate.requires, match));
  if (!weighed.some((w) => w > 0)) throw new Errors.ValueError("no match of the store's data has a weight");
  for (;;) yield matches[Sampling.weighted(random, weighed)] as Match;
}
