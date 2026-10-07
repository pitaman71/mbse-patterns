/**
 * Distributions: terms of the predicate algebra that weigh alternatives and draw values.
 *
 * A pattern is a predicate: its constraint says what holds of a match, and these terms, in its constraint, say how
 * matches are distributed, so that one predicate is validated, queried, sampled from and generated from alike.
 *
 *     const APerson = { person: Person };
 *     const People = new Predicates.OfPredicate.Builder().name("People").symbols(APerson).requires(
 *       new Distributions.Choices.Builder().arms(
 *         (a) => a.weight(3).requires(
 *           HasName.call(person, "senior"),
 *           new Distributions.Normal.Builder().symbol("age").mean(70n).deviation(8n).rounded()
 *             .requires((age) => person.age.eq(age)).create()),
 *         (a) => a.weight(7).requires(HasName.call(person, "adult")),
 *       ).count((c) => c.ge(1n)).decreasing().create())
 *       .create();
 *
 * - **`Choices`** weighs alternatives, its arms, each a weight and conditions (`a.weight(3).requires(...specs)`, their
 *   conjunction). It holds when the number of arms that hold satisfies its count, a condition a function writes, given
 *   its parameter as a variable bound to the number (`.count((c) => c.ge(1n))`, the default). A generator chooses an
 *   arm by weight and makes it hold. With `.decreasing()`, its arms are in decreasing precedence: a match falls under
 *   the first arm that holds, and a generated match must fall under the arm chosen for it; without, every arm that
 *   holds counts.
 * - **A distribution binds a symbol** within its body, `.requires(...)`, to a value drawn from it: `Normal` (floats, or
 *   ints rounded half up with `.rounded()`), `Uniform` (ints in [low, high] when both bounds are ints, else floats in
 *   [low, high)), `Poisson` and `Geometric` (ints, for counts) and `Categorical` (values by weight, `.option(3,
 *   "ann")`). A generator draws the value and makes the body hold: an equality `person.age == age` sets the property. A
 *   validator takes the value from such an equality, its witness: the term holds when the witness is in the
 *   distribution's support and the body holds with the symbol bound to it, and is unknown when the body has no
 *   witness. Its parameters are expressions, evaluated where it is; the symbol is bound within them too, so name it
 *   apart from the names they read. `.requires(...)` calls a function with the variable of the symbol (`(age) =>
 *   person.age.eq(age)`), its closure giving the outer names; any other spec is an expression of the algebra. (Python
 *   reads the function's parameters as the names, outer and bound, which a JavaScript bundler may rename.)
 *
 * `domain(distribution)` gives the native type a distribution's values have, and `typing(predicate)` the problems of a
 * predicate whose distributions set a property of another type ("person.age is int, but its distribution gives
 * float"). The terms are kinds of `Predicates.DIALECT`, with meta-schemas `Patterns.OfChoices`, `Patterns.OfNormal`,
 * ...: data, written and read as predicates are.
 */

import { Expressions as E } from "@mbse/expressions";
import { Terms } from "@mbse/expressions/Framework";
import { Schemas } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";

function positive(kind: string, weight: unknown): string[] {
  return typeof weight === "number" && !(weight > 0 && Number.isFinite(weight))
    ? [`${Terms.article(kind)}'s weight must be positive, got ${repr(weight)}`] : [];
}

function conjunction(conditions: unknown[]): unknown {
  let constraint: unknown = null;
  for (const condition of conditions) {
    constraint = constraint === null ? condition : E.operation("and", constraint as E.OfAny.Spec, condition as E.OfAny.Spec).data;
  }
  return constraint;
}

/** The argument a builder holds at `index`, if any. */
function existing(builder: Terms.Builder, index: bigint): unknown {
  return (builder.state.entries.get("arguments") ?? []).find((entry) => entry.properties.get("index") === index)
    ?.links.get("argument");
}

/** A distribution's condition: a function of its symbol's variable, or a spec of the algebra. */
export type Condition = ((value: E.Writer) => unknown) | Terms.Term | E.Writer | string | number | bigint | boolean;

/** The name of a function's one parameter, from its source; null for a function of another number of parameters, or
 * of one that has no name (destructured). */
export function parameter(fn: unknown): string | null {
  if (typeof fn !== "function" || fn.length !== 1) return null;
  const found = /^\s*(?:async\s*)?(?:function\b[^(]*)?\(?\s*([A-Za-z_$][\w$]*)/.exec(String(fn));
  return found === null ? null : found[1] as string;
}

// --- Choices ---

/** A condition on a number, bound to `name` within it: how many of a choice's arms may hold. */
export class Count extends Terms.Term {
  static override KIND = "count";
  static override ROLE = Terms.IMPORT;
  static override PROPERTIES = new Map<string, unknown>([["name", String]]);
  static override SLOTS = ["condition"];
  declare static Builder: typeof CountBuilder;
  declare name: string | null;
  declare condition: any;

  constructor(name: unknown = null, condition: unknown = null) {
    super(name, condition);
  }

  override binds(): string[] {
    return this.name === null ? [] : [this.name];
  }
}

/** An arm of a choice: its condition, and its weight. */
export class Arm extends Terms.Term {
  static override KIND = "arm";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["weight", Number]]);
  static override SLOTS = ["condition"];
  declare static Builder: typeof ArmBuilder;
  declare weight: unknown;
  declare condition: any;

  constructor(weight: unknown = null, condition: unknown = null) {
    super(weight, condition);
  }

  override check(): string[] {
    return positive(Arm.KIND, this.weight);
  }

  /** An arm, or what a callable taking an arm builder builds. */
  static resolve(spec: unknown): Arm {
    return Terms.resolve(spec, (v): v is Arm => v instanceof Arm, () => new ArmBuilder(), "an arm");
  }
}

/** Weighted alternatives: it holds when the number of its arms that hold satisfies its count; with `decreasing`, its
 * arms are in decreasing precedence. */
export class Choices extends Terms.Term {
  static override KIND = "choices";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["decreasing", Boolean]]);
  static override OPTIONAL = new Set(["decreasing"]);
  static override SLOTS = ["count"];
  static override VARIADIC = "arms";
  declare static Builder: typeof ChoicesBuilder;
  declare decreasing: boolean | null;
  declare count: any;
  declare arms: readonly any[];

  constructor(decreasing: unknown = null, count: unknown = null, arms: readonly unknown[] = []) {
    super(decreasing, count, arms);
  }

  override check(): string[] {
    const problems = this.count === null || this.count instanceof Count ? [] : ["a choices' count must be a count"];
    if (!this.arms.every((arm) => arm instanceof Arm)) return [...problems, "a choices' arguments after its count are arms"];
    return this.arms.length > 0 ? problems : [...problems, "a choices needs an arm"];
  }
}

// --- Distributions of values ---

/** A distribution, binding `symbol` within its body (and its parameters) to a value drawn from it. */
export abstract class Drawn extends Terms.Term {
  static override ROLE = Terms.IMPORT;
  static override PROPERTIES = new Map<string, unknown>([["symbol", String]]);
  declare symbol: string | null;
  declare body: any;

  override binds(): string[] {
    return this.symbol === null ? [] : [this.symbol];
  }
}

/** Values spread evenly: ints in [low, high] when both are ints, else floats in [low, high). */
export class Uniform extends Drawn {
  static override KIND = "uniform";
  static override SLOTS = ["body", "low", "high"];
  declare static Builder: typeof UniformBuilder;
  declare low: any;
  declare high: any;

  constructor(symbol: unknown = null, body: unknown = null, low: unknown = null, high: unknown = null) {
    super(symbol, body, low, high);
  }
}

/** Floats from the normal distribution of `mean` and `deviation`; ints, rounded half up, when `rounded`. */
export class Normal extends Drawn {
  static override KIND = "normal";
  static override PROPERTIES = new Map<string, unknown>([["symbol", String], ["rounded", Boolean]]);
  static override OPTIONAL = new Set(["rounded"]);
  static override SLOTS = ["body", "mean", "deviation"];
  declare static Builder: typeof NormalBuilder;
  declare rounded: boolean | null;
  declare mean: any;
  declare deviation: any;

  constructor(symbol: unknown = null, rounded: unknown = null, body: unknown = null, mean: unknown = null,
    deviation: unknown = null) {
    super(symbol, rounded, body, mean, deviation);
  }
}

/** Ints from the Poisson distribution of `rate`: counts of events that occur at `rate`. */
export class Poisson extends Drawn {
  static override KIND = "poisson";
  static override SLOTS = ["body", "rate"];
  declare static Builder: typeof PoissonBuilder;
  declare rate: any;

  constructor(symbol: unknown = null, body: unknown = null, rate: unknown = null) {
    super(symbol, body, rate);
  }
}

/** Ints: the failures before the first success, of trials that each succeed with `probability`. */
export class Geometric extends Drawn {
  static override KIND = "geometric";
  static override SLOTS = ["body", "probability"];
  declare static Builder: typeof GeometricBuilder;
  declare probability: any;

  constructor(symbol: unknown = null, body: unknown = null, probability: unknown = null) {
    super(symbol, body, probability);
  }
}

/** An option of a categorical: its value, and its weight. */
export class Option extends Terms.Term {
  static override KIND = "option";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["weight", Number]]);
  static override SLOTS = ["value"];
  declare static Builder: typeof OptionBuilder;
  declare weight: unknown;
  declare value: any;

  constructor(weight: unknown = null, value: unknown = null) {
    super(weight, value);
  }

  override check(): string[] {
    return positive(Option.KIND, this.weight);
  }
}

/** Values, each chosen with probability proportional to its option's weight. */
export class Categorical extends Drawn {
  static override KIND = "categorical";
  static override SLOTS = ["body"];
  static override VARIADIC = "options";
  declare static Builder: typeof CategoricalBuilder;
  declare options: readonly any[];

  constructor(symbol: unknown = null, body: unknown = null, options: readonly unknown[] = []) {
    super(symbol, body, options);
  }

  override check(): string[] {
    if (!this.options.every((option) => option instanceof Option)) return ["a categorical's arguments after its body are options"];
    return this.options.length > 0 ? [] : ["a categorical needs an option"];
  }
}

/** The distributions of values: the kinds that bind a symbol to a value drawn from them. */
export const DRAWN = [Uniform, Normal, Poisson, Geometric, Categorical];

// --- Builders ---

class CountBuilder extends Terms.Builder {
  static override DATA = Count;
}

/** Builds an arm. DSL: `.weight(number)`, and `.requires(...specs)`, conditions added to its own, which it conjoins. */
class ArmBuilder extends Terms.Builder {
  static override DATA = Arm;
  private conditions: unknown[] = [];

  weight(weight: number): this {
    return this.set("weight", weight);
  }

  requires(...specs: unknown[]): this {
    this.conditions.push(...specs.map((spec) => this.data.DIALECT.resolve(spec)));
    return this;
  }

  private fold(): void {
    if (this.conditions.length === 0) return;
    const held = existing(this, 0n);
    this.argument("condition", conjunction([...(held === undefined ? [] : [held]), ...this.conditions]));
    this.conditions = [];
  }

  override create(): Arm {
    this.fold();
    return super.create();
  }

  override clone(): Arm {
    this.fold();
    return super.clone();
  }

  override update(): Arm {
    this.fold();
    return super.update();
  }
}

/** Builds a choices. DSL: `.arms(...specs)`, each an arm or a callable taking an arm builder, added in order;
 * `.count(function)`, the condition on how many arms hold, which a function of one parameter writes, given a variable
 * for the number (`(c) => c.ge(1n)`, the default); and `.decreasing()`. */
class ChoicesBuilder extends Terms.Builder {
  static override DATA = Choices;

  arms(...specs: (Arm | ((builder: ArmBuilder) => ArmBuilder))[]): this {
    return this.arguments(...specs.map((spec) => Arm.resolve(spec)));
  }

  count(condition: (count: E.Writer) => unknown): this {
    const name = parameter(condition);
    if (name === null) throw new TypeError("a choices' count is a function of one number");
    return this.argument("count", new Count(name, this.data.DIALECT.resolve(condition(E.variable(name)))));
  }

  decreasing(): this {
    return this.set("decreasing", true);
  }

  private fold(): void {
    if (existing(this, 0n) === undefined) this.argument("count", new Count("c", E.variable("c").ge(1n).data));
  }

  override create(): Choices {
    this.fold();
    return super.create();
  }

  override clone(): Choices {
    this.fold();
    return super.clone();
  }

  override update(): Choices {
    this.fold();
    return super.update();
  }
}

/** Builds a distribution. DSL: `.symbol(str)`, the name it binds, which the builder then gives as a variable, and
 * `.requires(...specs)`, conditions added to its body, which it conjoins: a function is called with the variable of the
 * symbol (`(age) => person.age.eq(age)`), the outer names its closure's, and any other spec is an expression of the
 * algebra. */
abstract class DrawnBuilder extends Terms.Builder {
  [variable: string]: any;
  private conditions: unknown[] = [];

  constructor(instance?: Drawn) {
    super(instance);
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === "string" && !(property in target) && target.state.values.get("symbol") === property) {
          return E.variable(property);
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  symbol(name: string): this {
    return this.set("symbol", name);
  }

  requires(...specs: Condition[]): this {
    for (const spec of specs) {
      if (typeof spec === "function") {
        const symbol = this.state.values.get("symbol") as string | undefined;
        if (symbol === undefined) throw new TypeError("a distribution's symbol is set before a function writes its conditions");
        this.conditions.push(this.data.DIALECT.resolve((spec as (value: E.Writer) => unknown)(E.variable(symbol))));
      } else {
        this.conditions.push(this.data.DIALECT.resolve(spec));
      }
    }
    return this;
  }

  private fold(): void {
    if (this.conditions.length === 0) return;
    const held = existing(this, 0n);
    this.argument("body", conjunction([...(held === undefined ? [] : [held]), ...this.conditions]));
    this.conditions = [];
  }

  override create(): any {
    this.fold();
    return super.create();
  }

  override clone(): any {
    this.fold();
    return super.clone();
  }

  override update(): any {
    this.fold();
    return super.update();
  }
}

/** Builds a uniform. DSL: `.low(spec)` and `.high(spec)`, with the distribution's. */
class UniformBuilder extends DrawnBuilder {
  static override DATA = Uniform;

  low(spec: unknown): this {
    return this.argument("low", spec);
  }

  high(spec: unknown): this {
    return this.argument("high", spec);
  }
}

/** Builds a normal. DSL: `.mean(spec)`, `.deviation(spec)` and `.rounded()`, for ints, with the distribution's. */
class NormalBuilder extends DrawnBuilder {
  static override DATA = Normal;

  mean(spec: unknown): this {
    return this.argument("mean", spec);
  }

  deviation(spec: unknown): this {
    return this.argument("deviation", spec);
  }

  rounded(): this {
    return this.set("rounded", true);
  }
}

/** Builds a Poisson. DSL: `.rate(spec)`, with the distribution's. */
class PoissonBuilder extends DrawnBuilder {
  static override DATA = Poisson;

  rate(spec: unknown): this {
    return this.argument("rate", spec);
  }
}

/** Builds a geometric. DSL: `.probability(spec)`, with the distribution's. */
class GeometricBuilder extends DrawnBuilder {
  static override DATA = Geometric;

  probability(spec: unknown): this {
    return this.argument("probability", spec);
  }
}

/** Builds a categorical. DSL: `.option(weight, value)` adds an option, with the distribution's. */
class CategoricalBuilder extends DrawnBuilder {
  static override DATA = Categorical;

  option(weight: number, value: unknown): this {
    return this.arguments(new Option(weight, this.data.DIALECT.resolve(value)));
  }
}

class OptionBuilder extends Terms.Builder {
  static override DATA = Option;
}

/** The kinds this module adds to the predicate algebra. */
export const KINDS = [Choices, Arm, Count, Uniform, Normal, Poisson, Geometric, Categorical, Option];

/** Their builders, in the same order. */
export const BUILDERS = [ChoicesBuilder, ArmBuilder, CountBuilder, UniformBuilder, NormalBuilder, PoissonBuilder,
  GeometricBuilder, CategoricalBuilder, OptionBuilder];

Choices.Builder = ChoicesBuilder;
Arm.Builder = ArmBuilder;
Count.Builder = CountBuilder;
Uniform.Builder = UniformBuilder;
Normal.Builder = NormalBuilder;
Poisson.Builder = PoissonBuilder;
Geometric.Builder = GeometricBuilder;
Categorical.Builder = CategoricalBuilder;
Option.Builder = OptionBuilder;

export namespace Choices {
  export type Builder = ChoicesBuilder;
}
export namespace Arm {
  export type Builder = ArmBuilder;
}
export namespace Uniform {
  export type Builder = UniformBuilder;
}
export namespace Normal {
  export type Builder = NormalBuilder;
}

// --- Checks ---

/** The native type a distribution's values have, `int`, `float`, `str` or `bool`, when it can be told without
 * drawing: a normal's are floats (ints when rounded), a Poisson's and a geometric's ints, a uniform's ints when both its
 * bounds are int literals and floats when either is a float literal, and a categorical's that of all its options'
 * literal values; a literal's is its own. Null when it cannot be told. */
export function domain(distribution: unknown): string | null {
  if (distribution instanceof Normal) return distribution.rounded ? "int" : "float";
  if (distribution instanceof Poisson || distribution instanceof Geometric) return "int";
  if (distribution instanceof Uniform) {
    const bounds = new Set([domain(distribution.low), domain(distribution.high)]);
    return bounds.size === 1 && bounds.has("int") ? "int" : bounds.has("float") ? "float" : null;
  }
  if (distribution instanceof Categorical) {
    const found = new Set(distribution.options.map((option) => domain((option as { value?: unknown }).value)));
    return found.size === 1 ? [...found][0] as string | null : null;
  }
  if (distribution instanceof E.OfLiteral.Data) return Terms.nativeName(distribution.value);
  return null;
}

/** The equalities among a condition's conjuncts, each both ways: `[a, b]` and `[b, a]` for `a == b`. */
function equalities(node: unknown): [unknown, unknown][] {
  if (node instanceof E.OfOperation.Data && node.name === "and" && node.arguments.length === 2) {
    return [...equalities(node.arguments[0]), ...equalities(node.arguments[1])];
  }
  if (node instanceof E.OfOperation.Data && node.name === "eq" && node.arguments.length === 2) {
    const [a, b] = node.arguments as [unknown, unknown];
    return [[a, b], [b, a]];
  }
  return [];
}

/** Whether `node` reads the variable `name`. */
function reads(node: unknown, name: string): boolean {
  if (node instanceof E.OfVariable.Data) return node.name === name;
  return node instanceof Terms.Term && node.argumentsOf().some((argument) => reads(argument, name));
}

/** The expression a distribution's body equates its symbol with, not reading the symbol itself: its value, for a
 * validator; null if there is none. */
export function witness(drawn: Drawn): unknown {
  const found = equalities(drawn.body).find(([side, other]) =>
    side instanceof E.OfVariable.Data && side.name === drawn.symbol && !reads(other, drawn.symbol as string));
  return found === undefined ? null : found[1];
}

/** The problems of a predicate's distributions that set a property of its symbols (`person.age == age`, in the
 * distribution's body) to values of another type than the property's, as far as their domains tell. */
export function typing(predicate: { symbols: ReadonlyMap<string, unknown>; requires: unknown }): string[] {
  const problems: string[] = [];
  const visit = (node: unknown): void => {
    if (node instanceof Terms.Term && node.kind().KIND === "predicate") return; // an applied predicate's are its own
    if (DRAWN.some((kind) => node instanceof kind)) {
      const drawn = node as Drawn;
      const given = domain(drawn);
      for (const [side, other] of equalities(drawn.body)) {
        if (!(other instanceof E.OfVariable.Data && other.name === drawn.symbol)) continue;
        if (!(side instanceof E.OfOperation.Data && side.name === "get" && side.arguments.length === 2
          && side.arguments[0] instanceof E.OfVariable.Data && side.arguments[1] instanceof E.OfLiteral.Data)) continue;
        const [symbol, name] = [side.arguments[0].name as string, side.arguments[1].value as string];
        const schema = predicate.symbols.get(symbol);
        const property = schema instanceof Schemas.OfObject.Data ? schema.properties.get(name)?.type : undefined;
        if (property instanceof Schemas.OfNative.Data && given !== null) {
          const wanted = (property.token as { name: string }).name;
          if (wanted !== given) problems.push(`${symbol}.${name} is ${wanted}, but its distribution gives ${given}`);
        }
      }
    }
    for (const argument of node instanceof Terms.Term ? node.argumentsOf() : []) visit(argument);
  };
  visit(predicate.requires);
  return problems;
}
