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
import { repr, typeName } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Predicates from "./Predicates.js";
import * as Sampling from "./Sampling.js";

type Symbols = Predicates.Symbols;
type Match = Record<string, Visitable>;

// --- Distributions of values ---

/** Values spread evenly: ints in [low, high] when both are ints, else floats in [low, high). */
export class OfUniform extends Terms.Term {
  static override KIND = "uniform";
  static override ROLE = Terms.APPLICATION;
  static override SLOTS = ["low", "high"];
  declare static Builder: typeof BoundsBuilder;
  declare low: any;
  declare high: any;

  constructor(low: unknown = null, high: unknown = null) {
    super(low, high);
  }
}

/** Floats from the normal distribution of `mean` and `deviation`; ints, rounded half up, when `rounded`. */
export class OfNormal extends Terms.Term {
  static override KIND = "normal";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["rounded", Boolean]]);
  static override OPTIONAL = new Set(["rounded"]);
  static override SLOTS = ["mean", "deviation"];
  declare static Builder: typeof NormalBuilder;
  declare rounded: boolean | null;
  declare mean: any;
  declare deviation: any;

  constructor(rounded: unknown = null, mean: unknown = null, deviation: unknown = null) {
    super(rounded, mean, deviation);
  }
}

/** Ints from the Poisson distribution of `rate`: counts of events that occur at `rate`. */
export class OfPoisson extends Terms.Term {
  static override KIND = "poisson";
  static override ROLE = Terms.APPLICATION;
  static override SLOTS = ["rate"];
  declare static Builder: typeof PoissonBuilder;
  declare rate: any;

  constructor(rate: unknown = null) {
    super(rate);
  }
}

/** Ints: the failures before the first success, of trials that each succeed with `probability`. */
export class OfGeometric extends Terms.Term {
  static override KIND = "geometric";
  static override ROLE = Terms.APPLICATION;
  static override SLOTS = ["probability"];
  declare static Builder: typeof GeometricBuilder;
  declare probability: any;

  constructor(probability: unknown = null) {
    super(probability);
  }
}

abstract class Weighted extends Terms.Term {
  static override ROLE = Terms.APPLICATION;
  static override VARIADIC = "options";
  declare options: readonly any[];

  constructor(options: readonly unknown[] = []) {
    super(options);
  }

  override check(): string[] {
    const kind = this.kind().KIND;
    if (!this.options.every((option) => option instanceof Predicates.OfOption)) return [`${Terms.article(kind)}'s arguments are options`];
    return this.options.length > 0 ? [] : [`${Terms.article(kind)} needs an option`];
  }
}

/** Values, each chosen with probability proportional to its option's weight. */
export class OfCategorical extends Weighted {
  static override KIND = "categorical";
  declare static Builder: typeof CategoricalBuilder;
}

/** Values drawn from distributions, each chosen with probability proportional to its option's weight. */
export class OfMixture extends Weighted {
  static override KIND = "mixture";
  declare static Builder: typeof MixtureBuilder;
}

/** A symbol's property, `person.age`, and the distribution its value is drawn from; any other expression is a constant,
 * its value. */
export class OfDraw extends Terms.Term {
  static override KIND = "draw";
  static override ROLE = Terms.APPLICATION;
  static override SLOTS = ["property", "distribution"];
  declare static Builder: typeof DrawBuilder;
  declare property: any;
  declare distribution: any;

  constructor(property: unknown = null, distribution: unknown = null) {
    super(property, distribution);
  }

  /** The symbol and the property it draws, if its property is a symbol's property. */
  target(): [string, string] | null {
    const node = this.property;
    if (node instanceof E.OfOperation.Data && node.name === "get" && node.arguments.length === 2
      && node.arguments[0] instanceof E.OfVariable.Data && node.arguments[1] instanceof E.OfLiteral.Data
      && typeof node.arguments[1].value === "string") {
      return [node.arguments[0].name as string, node.arguments[1].value];
    }
    return null;
  }

  override check(): string[] {
    return this.property !== null && this.target() === null ? ["a draw's property must be a symbol's property, such as person.age"] : [];
  }
}

/** The native type a distribution's values have, `int`, `float`, `str` or `bool`, when it can be told without drawing:
 * a normal's are floats (ints when rounded), a Poisson's and a geometric's ints, a uniform's ints when both its bounds
 * are int literals and floats when either is a float literal, and a categorical's or a mixture's those all its options
 * give; a literal's is its own. Null when it cannot be told. */
export function domain(distribution: unknown): string | null {
  if (distribution instanceof OfNormal) return distribution.rounded ? "int" : "float";
  if (distribution instanceof OfPoisson || distribution instanceof OfGeometric) return "int";
  if (distribution instanceof OfUniform) {
    const bounds = new Set([domain(distribution.low), domain(distribution.high)]);
    return bounds.size === 1 && bounds.has("int") ? "int" : bounds.has("float") ? "float" : null;
  }
  if (distribution instanceof OfCategorical || distribution instanceof OfMixture) {
    const found = new Set(distribution.options.map((option) => domain((option as { body?: unknown }).body)));
    return found.size === 1 ? [...found][0] as string | null : null;
  }
  if (distribution instanceof E.OfLiteral.Data) return Terms.nativeName(distribution.value);
  return null;
}

/** A case of a distribution: a predicate, the weight of the matches it holds of, and draws, the distributions of the
 * properties it leaves open. It binds its predicate's symbols within its draws. */
export class OfCase extends Terms.Term {
  static override KIND = "case";
  static override ROLE = Terms.IMPORT;
  static override PROPERTIES = new Map<string, unknown>([["weight", Number]]);
  static override SLOTS = ["predicate"];
  static override VARIADIC = "draws";
  /** Builds this kind. */
  declare static Builder: typeof CaseBuilder;
  declare weight: unknown;
  declare predicate: any;
  declare draws: readonly any[];

  constructor(weight: unknown = null, predicate: unknown = null, draws: readonly unknown[] = []) {
    super(weight, predicate, draws);
  }

  override binds(): string[] {
    return this.predicate instanceof Predicates.OfPredicate ? this.predicate.binds() : [];
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
    if (!this.draws.every((d) => d instanceof OfDraw)) problems.push("a case's arguments after its predicate are draws");
    return problems;
  }

  /** The problems of its draws, given its predicate: a draw of a property that is not a symbol's, or of a property the
   * symbol's schema does not have, or from a distribution whose values are not the property's type. */
  draw_problems(): string[] {
    const problems: string[] = [];
    const symbols: Symbols = this.predicate instanceof Predicates.OfPredicate ? this.predicate.symbols : new Predicates.Symbols();
    this.draws.forEach((d, j) => {
      const target = d instanceof OfDraw ? d.target() : null;
      if (target === null) return;
      const [symbol, name] = target;
      const schema = symbols.get(symbol);
      if (!(schema instanceof Schemas.OfObject.Data)) {
        problems.push(`draw ${j}: ${repr(symbol)} is not one of the case's symbols`);
        return;
      }
      const property = schema.properties.get(name);
      if (property === undefined) {
        problems.push(`draw ${j}: ${repr(schema.name)} has no property ${repr(name)}`);
      } else if (property instanceof Schemas.OfNative.Data) {
        const [wanted, given] = [(property.token as { name: string }).name, domain(d.distribution)];
        if (given !== null && given !== wanted) problems.push(`draw ${j}: ${symbol}.${name} is ${wanted}, but its distribution gives ${given}`);
      }
    });
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
      problems.push(...c.draw_problems().map((problem) => `case ${i}: ${problem}`));
    });
    return problems;
  }
}

/** Builds a case. DSL: `.weight(number)`; `.requires(spec)`, a predicate or a callable taking a predicate builder,
 * after which the builder gives the predicate's symbols as variables; and `.draw(property, distribution)`, which adds a
 * draw: `.draw(wt.person.age, Normal((n) => n.mean(40n).deviation(12n)))`. */
class CaseBuilder extends Terms.Builder {
  static override DATA = OfCase;
  [variable: string]: any;

  constructor(instance?: OfCase) {
    super(instance);
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === "string" && !(property in target) && target.declared().includes(property)) return E.variable(property);
        return Reflect.get(target, property, receiver);
      },
    });
  }

  declared(): string[] {
    const found = (this.state.entries.get("arguments") ?? []).find((entry) => entry.properties.get("index") === 0n)?.links.get("argument");
    return found instanceof Predicates.OfPredicate ? found.binds() : [];
  }

  weight(weight: number): this {
    return this.set("weight", weight);
  }

  requires(spec: Predicates.OfPredicate.Spec): this {
    return this.argument("predicate", Predicates.OfPredicate.resolve(spec));
  }

  draw(property: unknown, distribution: unknown): this {
    return this.arguments(new OfDraw(DIALECT.resolve(property), DIALECT.resolve(distribution)));
  }
}

/** Builds a uniform. DSL: `.low(spec)` and `.high(spec)`. */
class BoundsBuilder extends Terms.Builder {
  static override DATA = OfUniform;

  low(spec: unknown): this {
    return this.argument("low", spec);
  }

  high(spec: unknown): this {
    return this.argument("high", spec);
  }
}

/** Builds a normal. DSL: `.mean(spec)`, `.deviation(spec)`, and `.rounded()`, for ints. */
class NormalBuilder extends Terms.Builder {
  static override DATA = OfNormal;

  rounded(): this {
    return this.set("rounded", true);
  }

  mean(spec: unknown): this {
    return this.argument("mean", spec);
  }

  deviation(spec: unknown): this {
    return this.argument("deviation", spec);
  }
}

/** Builds a Poisson. DSL: `.rate(spec)`. */
class PoissonBuilder extends Terms.Builder {
  static override DATA = OfPoisson;

  rate(spec: unknown): this {
    return this.argument("rate", spec);
  }
}

/** Builds a geometric. DSL: `.probability(spec)`. */
class GeometricBuilder extends Terms.Builder {
  static override DATA = OfGeometric;

  probability(spec: unknown): this {
    return this.argument("probability", spec);
  }
}

/** Builds a categorical or a mixture. DSL: `.option(weight, spec)` adds an option: a value, or a distribution. */
abstract class OptionsBuilder extends Terms.Builder {
  option(weight: number, spec: unknown): this {
    return this.arguments(new Predicates.OfOption(weight, DIALECT.resolve(spec)));
  }
}

class CategoricalBuilder extends OptionsBuilder {
  static override DATA = OfCategorical;
}

class MixtureBuilder extends OptionsBuilder {
  static override DATA = OfMixture;
}

class DrawBuilder extends Terms.Builder {
  static override DATA = OfDraw;
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

const KINDS = [OfWeights, OfCase, OfDraw, OfUniform, OfNormal, OfPoisson, OfGeometric, OfCategorical, OfMixture];
const BUILDERS = [WeightsBuilder, CaseBuilder, DrawBuilder, BoundsBuilder, NormalBuilder, PoissonBuilder, GeometricBuilder,
  CategoricalBuilder, MixtureBuilder];

/** The distributions: the predicate algebra's kinds, and the kinds above. */
export const DIALECT = new Terms.Declared("Distributions", KINDS as unknown as Terms.TermClass[], {
  domain_of: BasicDomains.of, extends: Predicates.DIALECT,
  builders: new Map(KINDS.map((kind, i) => [kind.KIND, BUILDERS[i] as unknown as typeof Terms.Builder])),
  schemaNames: new Map(KINDS.map((kind) => [kind.KIND, `Patterns.Of${kind.KIND[0]!.toUpperCase()}${kind.KIND.slice(1)}`])),
});

OfWeights.Builder = WeightsBuilder;
OfCase.Builder = CaseBuilder;
OfDraw.Builder = DrawBuilder;
OfUniform.Builder = BoundsBuilder;
OfNormal.Builder = NormalBuilder;
OfPoisson.Builder = PoissonBuilder;
OfGeometric.Builder = GeometricBuilder;
OfCategorical.Builder = CategoricalBuilder;
OfMixture.Builder = MixtureBuilder;

export namespace OfWeights {
  export type Builder = WeightsBuilder;
}
export namespace OfCase {
  export type Builder = CaseBuilder;
}

/** Values spread evenly: `Uniform((u) => u.low(0n).high(10n))`. */
export function Uniform(spec: OfUniform | ((builder: BoundsBuilder) => BoundsBuilder)): OfUniform {
  return Terms.resolve(spec, (v): v is OfUniform => v instanceof OfUniform, () => new BoundsBuilder(), "a uniform");
}

/** Floats from a normal distribution: `Normal((n) => n.mean(40n).deviation(12n))`. */
export function Normal(spec: OfNormal | ((builder: NormalBuilder) => NormalBuilder)): OfNormal {
  return Terms.resolve(spec, (v): v is OfNormal => v instanceof OfNormal, () => new NormalBuilder(), "a normal");
}

/** Ints from a Poisson distribution: `Poisson((p) => p.rate(1.5))`. */
export function Poisson(spec: OfPoisson | ((builder: PoissonBuilder) => PoissonBuilder)): OfPoisson {
  return Terms.resolve(spec, (v): v is OfPoisson => v instanceof OfPoisson, () => new PoissonBuilder(), "a poisson");
}

/** Ints from a geometric distribution: `Geometric((g) => g.probability(0.3))`. */
export function Geometric(spec: OfGeometric | ((builder: GeometricBuilder) => GeometricBuilder)): OfGeometric {
  return Terms.resolve(spec, (v): v is OfGeometric => v instanceof OfGeometric, () => new GeometricBuilder(), "a geometric");
}

/** Values chosen by weight: `Categorical((c) => c.option(3, "home").option(1, "work"))`. */
export function Categorical(spec: OfCategorical | ((builder: CategoricalBuilder) => CategoricalBuilder)): OfCategorical {
  return Terms.resolve(spec, (v): v is OfCategorical => v instanceof OfCategorical, () => new CategoricalBuilder(), "a categorical");
}

/** Values from distributions chosen by weight: `Mixture((m) => m.option(1, Normal(...)).option(2, ...))`. */
export function Mixture(spec: OfMixture | ((builder: MixtureBuilder) => MixtureBuilder)): OfMixture {
  return Terms.resolve(spec, (v): v is OfMixture => v instanceof OfMixture, () => new MixtureBuilder(), "a mixture");
}

function numberOf(value: unknown, what: string): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  throw new TypeError(`${what} must be a number, got ${typeName(value)}`);
}

/** A value drawn from `distribution` with `random`, its parameters evaluated with `scope` bound: a constant
 * expression's value, if it is not a distribution. */
export function draw(evaluate: Predicates.Evaluator, distribution: unknown, random: Stores.Random, scope: Record<string, unknown>): unknown {
  const value = (expression: unknown) => evaluate.interpreter.run(expression, scope);
  if (distribution instanceof OfNormal) {
    const drawn = Sampling.normal(random, numberOf(value(distribution.mean), "a normal's mean"),
      numberOf(value(distribution.deviation), "a normal's deviation"));
    return distribution.rounded ? BigInt(Math.floor(drawn + 0.5)) : drawn;
  }
  if (distribution instanceof OfUniform) {
    const [low, high] = [value(distribution.low), value(distribution.high)];
    if (typeof low === "bigint" && typeof high === "bigint") {
      if (low > high) throw new Errors.ValueError(`a uniform's low must not exceed its high, got ${repr(low)} and ${repr(high)}`);
      return low + Sampling.below(random, high - low + 1n);
    }
    return Sampling.between(random, numberOf(low, "a uniform's low"), numberOf(high, "a uniform's high"));
  }
  if (distribution instanceof OfPoisson) return Sampling.poisson(random, numberOf(value(distribution.rate), "a Poisson's rate"));
  if (distribution instanceof OfGeometric) {
    return Sampling.geometric(random, numberOf(value(distribution.probability), "a geometric's probability"));
  }
  if (distribution instanceof OfCategorical || distribution instanceof OfMixture) {
    const chosen = distribution.options[Sampling.weighted(random, distribution.options.map((option) => option.weight as number))];
    return distribution instanceof OfCategorical ? value(chosen.body) : draw(evaluate, chosen.body, random, scope);
  }
  return value(distribution);
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
