/**
 * Distributions: how a population of matches is weighted, as weighted predicates.
 *
 * A distribution of weights, `OfWeights`, is over the matches of its symbols, as a predicate's are: its cases, each a
 * weight and a predicate over the same symbols, given by reference or inline, say how much each match weighs. Cases are
 * listed in decreasing precedence: a match weighs what the first case whose predicate holds of it says, and nothing if
 * none does.
 *
 *     const APerson = { person: Person };
 *     const Names = new Distributions.OfWeights.Builder().name("Names").symbols(APerson).decreasing(
 *       (wt) => wt.weight(10).requires((pred) => pred.symbols(APerson).requires(HasName.call(pred.person, "alice"))),
 *       (wt) => wt.weight(5).requires((pred) => pred.symbols(APerson).requires(HasName.call(pred.person, "ben"))),
 *     ).create();
 *
 * `.requires(spec)` takes a predicate, or a callable taking a predicate builder, which builds one in place. A
 * distribution is drawn from two ways: `Sample(store, weights)` draws the store's existing matches, each with
 * probability proportional to its weight, and `Generators.Generate(store, weights)` builds new objects, choosing each
 * case with probability proportional to its weight. Both draw from a random source the caller gives, `new
 * Stores.PCG32(42n)` say.
 *
 * Distributions are terms of `DIALECT`, which extends the predicate algebra (`Predicates.DIALECT`), with meta-schemas
 * `Patterns.OfWeights` and `Patterns.OfCase`: data, written and read as predicates are (`Constraints.OfStore`).
 */

import { Domains as BasicDomains, Expressions as E } from "@mbse/expressions";
import { Terms } from "@mbse/expressions/Framework";
import { Errors, Schemas, Stores } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Predicates from "./Predicates.js";
import * as Sampling from "./Sampling.js";

type Symbols = Predicates.Symbols;
type Match = Record<string, Visitable>;

/** A case of a distribution: a predicate, and the weight of the matches it holds of. */
export class OfCase extends Terms.Term {
  static override KIND = "case";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["weight", Number]]);
  static override SLOTS = ["predicate"];
  /** Builds this kind. */
  declare static Builder: typeof CaseBuilder;
  declare weight: unknown;
  declare predicate: any;

  constructor(weight: unknown = null, predicate: unknown = null) {
    super(weight, predicate);
  }

  override check(): string[] {
    const problems: string[] = [];
    const weight = this.weight;
    if (typeof weight === "number" && !(weight > 0 && Number.isFinite(weight))) {
      problems.push(`a case's weight must be positive, got ${repr(weight)}`);
    }
    if (this.predicate !== null && !(this.predicate instanceof Predicates.OfPredicate)) {
      problems.push("a case's predicate must be a predicate");
    }
    return problems;
  }

  /** A case, or what a callable taking a case builder builds. */
  static resolve(spec: unknown): OfCase {
    return Terms.resolve(spec, (v): v is OfCase => v instanceof OfCase, () => new CaseBuilder(), "a case");
  }
}

function signature(symbols: Symbols): string {
  return JSON.stringify([...symbols].map(([name, schema]) => [name, schema instanceof Schemas.OfObject.Data ? schema.name : null]));
}

/** The weights of the matches of its symbols: its cases', in decreasing precedence. */
export class OfWeights extends Terms.Term {
  static override KIND = "weights";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["name", String]]);
  static override OPTIONAL = new Set(["name"]);
  static override VALUES = new Map([["symbols", Predicates.SYMBOLS]]);
  static override VARIADIC = "cases";
  /** Builds this kind. */
  declare static Builder: typeof WeightsBuilder;
  declare name: string | null;
  declare cases: readonly any[];
  declare symbols: Symbols;

  constructor(name: unknown = null, cases: readonly unknown[] = [], symbols: unknown = null) {
    super(name, cases, symbols ?? new Predicates.Symbols());
  }

  override check(): string[] {
    const problems = [...this.symbols].filter(([, schema]) => !(schema instanceof Schemas.OfObject.Data && schema.ref && schema.name !== null))
      .map(([symbol]) => `symbol ${repr(symbol)} needs a named reference object schema`);
    if (!this.cases.every((c) => c instanceof OfCase)) return [...problems, "a distribution's arguments are cases"];
    if (this.cases.length === 0) problems.push("a distribution needs a case");
    this.cases.forEach((c: OfCase, i) => {
      const predicate = c.predicate;
      if (predicate instanceof Predicates.OfPredicate) {
        if (signature(predicate.symbols) !== signature(this.symbols)) problems.push(`case ${i}: its predicate's symbols must be the distribution's`);
        if (predicate.parameters.size > 0) problems.push(`case ${i}: its predicate has parameters; apply it instead`);
      }
    });
    return problems;
  }
}

/** Builds a case. DSL: `.weight(number)`, and `.requires(spec)`, a predicate or a callable taking a predicate builder. */
class CaseBuilder extends Terms.Builder {
  static override DATA = OfCase;

  weight(weight: number): this {
    return this.set("weight", weight);
  }

  requires(spec: Predicates.OfPredicate.Spec): this {
    return this.argument("predicate", Predicates.OfPredicate.resolve(spec));
  }
}

/** Builds a distribution of weights. DSL: `.name(str)`, `.symbols({name: schema})`, added to those already given, and
 * `.decreasing(...specs)`, its cases in decreasing precedence, each a case or a callable taking a case builder, added
 * after those already given. The builder gives its symbols as variables. */
class WeightsBuilder extends Terms.Builder {
  static override DATA = OfWeights;
  [variable: string]: any;
  private readonly held: Symbols;

  constructor(instance?: OfWeights) {
    super(instance);
    this.held = new Predicates.Symbols(instance?.symbols ?? []);
    this.state.values.delete("symbols"); // held as data: see Predicates
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === "string" && !(property in target) && target.held.has(property)) return E.variable(property);
        return Reflect.get(target, property, receiver);
      },
    });
  }

  name(name: string): this {
    return this.set("name", name);
  }

  symbols(symbols: Record<string, unknown> | ReadonlyMap<string, unknown>): this {
    for (const [name, schema] of symbols instanceof Map ? [...symbols] : Object.entries(symbols)) this.held.set(name, schema);
    return this;
  }

  decreasing(...specs: (OfCase | ((builder: CaseBuilder) => CaseBuilder))[]): this {
    return this.arguments(...specs.map((spec) => OfCase.resolve(spec)));
  }

  override create(): OfWeights {
    const made = super.create() as OfWeights;
    made.symbols = new Predicates.Symbols(this.held);
    return made;
  }

  override clone(): OfWeights {
    const made = super.clone() as OfWeights;
    made.symbols = new Predicates.Symbols(this.held);
    return made;
  }

  override update(): OfWeights {
    const made = super.update() as OfWeights;
    made.symbols = new Predicates.Symbols(this.held);
    return made;
  }
}

/** The distributions: the predicate algebra's kinds, and the kinds above. */
export const DIALECT = new Terms.Declared("Distributions", [OfWeights, OfCase] as unknown as Terms.TermClass[], {
  domain_of: BasicDomains.of, extends: Predicates.DIALECT,
  builders: new Map([["weights", WeightsBuilder as unknown as typeof Terms.Builder], ["case", CaseBuilder]]),
  schemaNames: new Map([["weights", "Patterns.OfWeights"], ["case", "Patterns.OfCase"]]),
});

OfWeights.Builder = WeightsBuilder;
OfCase.Builder = CaseBuilder;

export namespace OfWeights {
  export type Builder = WeightsBuilder;
}
export namespace OfCase {
  export type Builder = CaseBuilder;
}

/** What `match` weighs: the weight of the first case whose predicate holds of it, or 0. */
export function weight(evaluate: Predicates.Evaluator, weights: OfWeights, match: Record<string, unknown>): number {
  for (const c of weights.cases as OfCase[]) {
    if (Predicates.holds(evaluate, c.predicate.rule, match) === true) return c.weight as number;
  }
  return 0;
}

/** `weights`, throwing `ValueError` with every problem validation reports. */
export function check(weights: OfWeights): OfWeights {
  const problems = DIALECT.validate(weights, { core: true });
  if (problems.length > 0) throw new Errors.ValueError(`the distribution cannot be drawn from: ${problems.join("; ")}`);
  return weights;
}

/** Matches of the store's data drawn with replacement, each with probability proportional to its weight, from
 * `random`. The distribution is checked when called; the store is read at the first draw. */
export function Sample(store: Stores.Store, weights: OfWeights, random: Stores.Random): Generator<Match> {
  check(weights);
  return sample(store, weights, random);
}

function* product(pools: readonly (readonly Visitable[])[]): Generator<Visitable[]> {
  if (pools.length === 0) {
    yield [];
    return;
  }
  for (const head of pools[0] as readonly Visitable[]) for (const rest of product(pools.slice(1))) yield [head, ...rest];
}

function* sample(store: Stores.Store, weights: OfWeights, random: Stores.Random): Generator<Match> {
  const evaluate = new Predicates.Evaluator(store);
  const names = [...weights.symbols.keys()];
  const matches = [...product([...weights.symbols.values()].map((schema) => evaluate.extent(schema.name as string)))]
    .map((objects) => Object.fromEntries(names.map((name, i) => [name, objects[i] as Visitable])));
  const weighed = matches.map((match) => weight(evaluate, weights, match));
  if (!weighed.some((w) => w > 0)) throw new Errors.ValueError("no match of the store's data has a weight");
  for (;;) yield matches[Sampling.weighted(random, weighed)] as Match;
}
