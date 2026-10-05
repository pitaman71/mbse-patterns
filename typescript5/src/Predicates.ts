/**
 * Predicates: named rules over a store's objects, and the predicate algebra they are written in.
 *
 * A predicate is a named rule over symbols, each bound to an object of a schema; it applies to a *match*, a binding of
 * every symbol to an object of its schema. It is built as schemas are, by a fluent builder finalized by `create()`,
 * `clone()` or `update()`, none of which validates:
 *
 *     const [c, p] = [E.variable("c"), E.variable("p")];
 *     const HasAPhone = new Predicates.Builder()
 *       .name("HasAPhone")
 *       .symbols({ c: Contact })
 *       .requires(Predicates.Exists((q) => q.symbols({ p: Phone }).requires(
 *         Predicates.Contains(c.phones, (e) => e.phone.eq(p)))))
 *       .create();
 *
 * `.requires(spec)` adds a condition, and `.forbids(spec)` the condition that `spec` does not hold; a predicate's rule
 * is their conjunction. A condition is any spec of the algebra: a term below, or a writer. Its free names are the
 * symbols, written as Basic variables (`E.variable("c")`) of the same names. A predicate without symbols is a statement
 * about the whole store.
 *
 * The algebra, `DIALECT`, extends mbse-expressions' Basic with terms about a store's data, each a data class with a
 * builder, so a term is built as a predicate is, by a spec (data, or a callable taking the builder):
 *
 * - `Exists(spec)` and `Forall(spec)`: whether some, or every, binding of the builder's `.symbols({...})` to objects of
 *   their schemas satisfies its `.requires(...)` and `.forbids(...)` (several symbols are their cross product);
 * - `Contains(c.phones, (e) => e.phone.eq(p))`: whether one of `c`'s entries in its adjacency `phones` satisfies the
 *   condition, which the function writes, given its parameter as a variable bound to the entry: the targets of the
 *   entry's other links, and its property values, by name. It is Basic's `any` over `entries(c, 'phones')`;
 * - `Choice((ch) => ch.option(0.35, spec).option(0.65, spec))`: a weighted disjunction, which holds when any of its
 *   options holds; the weights, positive and summing to 1, are how often a generator chooses each option, and what a
 *   characterizer estimates.
 *
 * A quantifier ranges over its schema's extent in the store (its `extent` term: what the store's singletons reach).
 * `DIALECT` validates the trees that mix the algebra's terms with Basic's; `new Evaluator(store).run(...)` evaluates
 * them, with the store giving extents, and Basic's three-valued rules for everything else.
 *
 * Predicates are mbse-schemas reference objects with a meta-schema, `Patterns.Predicate`: a symbol's schema is written
 * as a property's type is, by its name or inline, and a predicate is its rule's parent through Basic's relation
 * `Expressions.Arguments`. `Constraints` gathers predicates in sets, and reads and writes them.
 */

import { Domains as BasicDomains, Evaluators as Basic, Expressions as E } from "@mbse/expressions";
import { Evaluators as F, Terms } from "@mbse/expressions/Framework";
import { Bindings, Errors, Modules, Schemas, Stores } from "@mbse/schemas/Framework";
import type { PlainMap } from "@mbse/schemas/Framework/Plain";
import { repr, typeName } from "@mbse/schemas/Framework/Repr";
import type { OfObject, Visitable } from "@mbse/schemas/Framework/Visitors";

export const PREDICATE = "Patterns.Predicate";
export const MEMBERS = "Patterns.Members";

function schemaName(schema: unknown): string {
  const name = typeof schema === "string" ? schema : (schema as { name?: unknown } | null)?.name;
  if (typeof name !== "string") throw new TypeError(`expected a named schema or its name, got ${repr(schema)}`);
  return name;
}

/** The conditions' conjunction, left to right; null if there are none. */
function conjunction(conditions: unknown[]): Terms.Term | null {
  let rule: Terms.Term | null = null;
  for (const condition of conditions) rule = rule === null ? condition as Terms.Term : E.operation("and", rule as E.OfAny.Spec, condition as E.OfAny.Spec).data;
  return rule;
}

function negation(spec: unknown): Terms.Term {
  return E.operation("not", DIALECT.resolve(spec)).data;
}

function entries(symbols: Record<string, unknown> | ReadonlyMap<string, unknown>): [string, unknown][] {
  return symbols instanceof Map ? [...symbols] : Object.entries(symbols);
}

// --- Terms ---

/** The objects of the schema named `schema` in the store. */
export class OfExtent extends Terms.Term {
  /** Builds this kind. */
  declare static Builder: typeof ExtentBuilder;
  static override KIND = "extent";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["schema", String]]);
  declare schema: unknown;

  constructor(schema: unknown = null) {
    super(schema);
  }
}

abstract class Quantified extends Terms.Term {
  static override ROLE = Terms.QUANTIFIER;
  static override PROPERTIES = new Map<string, unknown>([["name", String]]);
  static override SLOTS = ["collection", "body"];
  declare name: unknown;
  declare collection: any; // an extent
  declare body: any;

  constructor(name: unknown = null, collection: unknown = null, body: unknown = null) {
    super(name, collection, body);
  }
}

/** Whether the body holds for every object of the collection, with `name` bound to it. */
export class OfForall extends Quantified {
  /** Builds this kind. */
  declare static Builder: typeof ForallBuilder;
  static override KIND = "forall";
}

/** Whether the body holds for some object of the collection, with `name` bound to it. */
export class OfExists extends Quantified {
  /** Builds this kind. */
  declare static Builder: typeof ExistsBuilder;
  static override KIND = "exists";
}

/** An option of a choice: its predicate, and its weight. */
export class OfOption extends Terms.Term {
  /** Builds this kind. */
  declare static Builder: typeof OptionBuilder;
  static override KIND = "option";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["weight", Number]]);
  static override SLOTS = ["body"];
  declare weight: unknown;
  declare body: any;

  constructor(weight: unknown = null, body: unknown = null) {
    super(weight, body);
  }

  override check(): string[] {
    const weight = this.weight;
    if (typeof weight === "number" && !(weight > 0 && Number.isFinite(weight))) {
      return [`an option's weight must be positive, got ${repr(weight)}`];
    }
    return [];
  }
}

/** A weighted disjunction of options: it holds when any of them holds. */
export class OfChoice extends Terms.Term {
  /** Builds this kind. */
  declare static Builder: typeof ChoiceBuilder;
  static override KIND = "choice";
  static override ROLE = Terms.APPLICATION;
  static override VARIADIC = "options";
  declare options: readonly any[];

  constructor(options: readonly unknown[] = []) {
    super(options);
  }

  override check(): string[] {
    if (!this.options.every((option) => option instanceof OfOption)) return ["a choice's arguments are options"];
    if (this.options.length === 0) return ["a choice needs an option"];
    const weights = this.options.map((option) => (option as OfOption).weight);
    if (weights.every((w) => typeof w === "number")) {
      const sum = (weights as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-9) return [`a choice's weights must sum to 1, got ${repr(sum)}`];
    }
    return [];
  }
}

// --- Builders ---

/** Builds a quantifier. DSL: `.symbols({name: schema})`, each schema a named schema or its name, added to those
 * already given, and `.requires(spec)` and `.forbids(spec)`, which add conditions to the body. The first symbol is
 * this quantifier's; each other is a quantifier of the same kind in the body, within which the conditions hold. As a
 * `Visitors.OfObject`, the collection is the `arguments` entry with index 0 and the body the one with index 1. */
abstract class QuantifiedBuilder extends Terms.Builder {
  #inner = new Map<string, string>();
  #conditions: unknown[] = [];

  symbols(symbols: Record<string, unknown> | ReadonlyMap<string, unknown>): this {
    for (const [name, schema] of entries(symbols)) {
      if (this.state.values.has("name") || this.#inner.size > 0) this.#inner.set(name, schemaName(schema));
      else this.set("name", name).argument("collection", new OfExtent(schemaName(schema)));
    }
    return this;
  }

  requires(spec: unknown): this {
    this.#conditions.push(DIALECT.resolve(spec));
    return this;
  }

  forbids(spec: unknown): this {
    this.#conditions.push(negation(spec));
    return this;
  }

  /** Writes the pending symbols and conditions into the body. */
  #fold(): void {
    if (this.#inner.size === 0 && this.#conditions.length === 0) return;
    const existing = (this.state.entries.get("arguments") ?? []).find((entry) => entry.properties.get("index") === 1n)
      ?.links.get("argument");
    let body = conjunction([...(existing === undefined ? [] : [existing]), ...this.#conditions]);
    const kind = this.data as unknown as new (name: unknown, collection: unknown, body: unknown) => Quantified;
    for (const [name, schema] of [...this.#inner].reverse()) body = new kind(name, new OfExtent(schema), body);
    this.#inner = new Map();
    this.#conditions = [];
    this.argument("body", body);
  }

  override create(): any {
    this.#fold();
    return super.create();
  }

  override clone(): any {
    this.#fold();
    return super.clone();
  }

  override update(): any {
    this.#fold();
    return super.update();
  }
}

class ForallBuilder extends QuantifiedBuilder {
  static override DATA = OfForall;
}

class ExistsBuilder extends QuantifiedBuilder {
  static override DATA = OfExists;
}

/** Builds a choice. DSL: `.option(weight, spec)` adds an option. */
class ChoiceBuilder extends Terms.Builder {
  static override DATA = OfChoice;

  option(weight: number, spec: unknown): this {
    return this.arguments(new OfOption(weight, DIALECT.resolve(spec)));
  }
}

/** Builds an option. DSL: `.weight(number)` and `.body(spec)`. */
class OptionBuilder extends Terms.Builder {
  static override DATA = OfOption;

  weight(weight: number): this {
    return this.set("weight", weight);
  }

  body(spec: unknown): this {
    return this.argument("body", spec);
  }
}

/** Builds an extent. DSL: `.schema(schema)`, a named schema or its name. */
class ExtentBuilder extends Terms.Builder {
  static override DATA = OfExtent;

  schema(schema: unknown): this {
    return this.set("schema", schemaName(schema));
  }
}

const KINDS = [OfExtent, OfForall, OfExists, OfChoice, OfOption];
const BUILDERS = [ExtentBuilder, ForallBuilder, ExistsBuilder, ChoiceBuilder, OptionBuilder];

/** The predicate algebra: Basic's kinds, and the kinds above. */
export const DIALECT = new Terms.Declared("Predicates", KINDS as unknown as Terms.TermClass[], {
  domain_of: BasicDomains.of, extends: E.DIALECT,
  builders: new Map(KINDS.map((kind, i) => [kind.KIND, BUILDERS[i] as unknown as typeof Terms.Builder])),
  schemaNames: new Map(KINDS.map((kind) => [kind.KIND, `Patterns.Of${kind.KIND[0]!.toUpperCase()}${kind.KIND.slice(1)}`])),
});

OfExtent.Builder = ExtentBuilder;
OfForall.Builder = ForallBuilder;
OfExists.Builder = ExistsBuilder;
OfChoice.Builder = ChoiceBuilder;
OfOption.Builder = OptionBuilder;

/** Whether some binding of the symbols satisfies the conditions: `Exists((q) => q.symbols({...}).requires(...))`. */
export function Exists(spec: OfExists | ((builder: ExistsBuilder) => ExistsBuilder)): OfExists {
  return Terms.resolve(spec, (v): v is OfExists => v instanceof OfExists, () => new ExistsBuilder(), "an exists");
}

/** Whether every binding of the symbols satisfies the conditions: `Forall((q) => q.symbols({...}).requires(...))`. */
export function Forall(spec: OfForall | ((builder: ForallBuilder) => ForallBuilder)): OfForall {
  return Terms.resolve(spec, (v): v is OfForall => v instanceof OfForall, () => new ForallBuilder(), "a forall");
}

/** A weighted disjunction: `Choice((ch) => ch.option(0.35, p).option(0.65, q))` holds when `p` or `q` does. */
export function Choice(spec: OfChoice | ((builder: ChoiceBuilder) => ChoiceBuilder)): OfChoice {
  return Terms.resolve(spec, (v): v is OfChoice => v instanceof OfChoice, () => new ChoiceBuilder(), "a choice");
}

/** The name of a function's one parameter, from its source. */
function parameter(condition: unknown): string | null {
  if (typeof condition !== "function" || condition.length !== 1) return null;
  const found = /^\s*(?:async\s*)?(?:function\b[^(]*)?\(?\s*([A-Za-z_$][\w$]*)/.exec(String(condition));
  return found === null ? null : found[1] as string;
}

/** Whether one of an object's entries in an adjacency, written `c.phones`, satisfies `condition`, a function of one
 * entry given its parameter as a variable: Basic's `any(e in entries(c, 'phones'), ...)`. */
export function Contains(adjacency: unknown, condition: (entry: E.Writer) => unknown): E.OfQuantifier.Data {
  const collection = E.OfAny.resolve(adjacency) as any;
  if (!(collection instanceof E.OfOperation.Data && collection.name === "get" && collection.arguments.length === 2
    && collection.arguments[1] instanceof E.OfLiteral.Data && typeof collection.arguments[1].value === "string")) {
    throw new TypeError("Contains expects an object's adjacency, such as c.phones");
  }
  const name = parameter(condition);
  if (name === null) throw new TypeError("Contains expects a function of one entry");
  const collected = E.operation("entries", collection.arguments[0] as E.OfAny.Spec, collection.arguments[1].value as string);
  return E.quantifier("any", name, collected, DIALECT.resolve(condition(E.variable(name))) as E.OfAny.Spec).data as E.OfQuantifier.Data;
}

// --- Predicates ---

/** Identities are strings, unique per object, as mbse-schemas keys them. */
let made = 0;

type Symbols = Map<string, Schemas.OfAny.Data>;

/** A named rule over symbols, each bound to an object of its schema in a match. */
class PredicateData {
  readonly #identity = `predicate ${++made}`;
  name: string | null;
  description: string | null;
  symbols: Symbols;
  rule: Terms.Term | null;

  constructor(fields: { name?: string | null; description?: string | null; symbols?: Symbols; rule?: Terms.Term | null } = {}) {
    this.name = fields.name ?? null;
    this.description = fields.description ?? null;
    this.symbols = fields.symbols ?? new Map();
    this.rule = fields.rule ?? null;
  }

  validate(): string[] {
    const label = `predicate ${repr(this.name)}`;
    const problems = ([["name", this.name], ["rule", this.rule]] as const).filter(([, value]) => value === null)
      .map(([what]) => `${label}: a predicate needs a ${what}`);
    for (const [symbol, schema] of this.symbols) {
      if (!(schema instanceof Schemas.OfObject.Data && schema.ref && schema.name !== null)) {
        problems.push(`${label}: symbol ${repr(symbol)} needs a named reference object schema`);
      }
    }
    const rule = this.rule === null ? [] : DIALECT.validate(this.rule, { bound: [...this.symbols.keys()], core: true });
    return [...problems, ...rule.map((problem) => `${label}: ${problem}`)];
  }

  identity(): unknown {
    return this.#identity;
  }

  schema_name(): string {
    return PREDICATE;
  }

  owner(): null {
    return null;
  }

  accept(visitor: OfObject): void {
    Bindings.accept(BINDING, this, visitor);
  }
}

/** Builds a predicate, as mbse-schemas' builders build. DSL: `.name(str)`, `.description(str)`,
 * `.symbols({name: schema})`, added to those already given, in order, and `.requires(spec)` and `.forbids(spec)`,
 * which add conditions to the rule. */
class PredicateBuilder {
  protected readonly fields: Record<string, unknown> = {};

  constructor(private readonly source?: PredicateData) {
    if (source !== undefined) Object.assign(this.fields, source, { symbols: new Map(source.symbols) });
  }

  name(name: string): this {
    this.fields["name"] = name;
    return this;
  }

  description(text: string): this {
    this.fields["description"] = text;
    return this;
  }

  /** Symbols by name, each with the schema of the objects it binds, in order; added to those already given. */
  symbols(symbols: Record<string, Schemas.OfAny.Data> | ReadonlyMap<string, Schemas.OfAny.Data>): this {
    this.fields["symbols"] = new Map([...((this.fields["symbols"] as Symbols | undefined) ?? []), ...entries(symbols)]);
    return this;
  }

  /** Adds a condition: a spec of the algebra whose free names are the symbols. */
  requires(spec: unknown): this {
    const rule = this.fields["rule"];
    this.fields["rule"] = conjunction([...(rule === undefined || rule === null ? [] : [rule]), DIALECT.resolve(spec)]);
    return this;
  }

  /** Adds the condition that `spec` does not hold. */
  forbids(spec: unknown): this {
    return this.requires(negation(spec));
  }

  /** A new predicate. Only valid without a source instance. */
  create(): PredicateData {
    if (this.source !== undefined) {
      throw new Errors.ValueError("create() is only valid without a source instance; use clone() or update()");
    }
    return new PredicateData(this.fields);
  }

  /** A new predicate, leaving the source instance untouched. Only valid with a source instance. */
  clone(): PredicateData {
    if (this.source === undefined) throw new Errors.ValueError("clone() is only valid with a source instance");
    return new PredicateData(this.fields);
  }

  /** Writes the builder's state into the source instance and returns it. Only valid with a source instance. */
  update(): PredicateData {
    if (this.source === undefined) throw new Errors.ValueError("update() is only valid with a source instance");
    return Object.assign(this.source, this.fields);
  }
}

const text = (name: string) => (p: any) => p.name(name).of((t: any) => t.as_native(String));

/** The relation of a set to its predicates, each at its `index` in the set. */
export const Members = new Schemas.OfRelation.Builder().name(MEMBERS).links("set", "predicate").properties(
  (p: any) => p.name("index").of((t: any) => t.as_native(BigInt))).create();

export namespace OfPredicate {
  /** A predicate. */
  export const Data = PredicateData;
  export type Data = PredicateData;
  export const Builder = PredicateBuilder;
  export type Builder = PredicateBuilder;
  export type Spec = PredicateData | ((builder: PredicateBuilder) => PredicateBuilder);
  /** The meta-schema of a predicate. */
  export const Schema = new Schemas.OfObject.Builder().name(PREDICATE).ref().properties(
    text("name"), text("description"),
    (p: any) => p.name("symbols").of((t: any) => t.as_indexed((i: any) => i.of(Schemas.OfProperty.Schema)))).relations(
    (r: any) => r.name("rule").of(Terms.Arguments).me("parent"),
    (r: any) => r.name("sets").of(Members).me("predicate")).create();

  export function resolve(spec: unknown): PredicateData {
    if (spec instanceof PredicateData) return spec;
    if (typeof spec !== "function") throw new TypeError(`expected a predicate or a callable taking its builder, got ${repr(spec)}`);
    return (spec as (builder: PredicateBuilder) => PredicateBuilder)(new PredicateBuilder()).create();
  }
}

/** `new Predicates.Builder()` builds a predicate: `OfPredicate.Builder`. */
export const Builder = PredicateBuilder;
export type Builder = PredicateBuilder;

/** The target of an entry's link, which must be of a kind. */
export function target(entry: Bindings.Entry, link: string, isKind: (value: unknown) => boolean, what: string): any {
  const found = entry.links.get(link);
  if (found === null || found === undefined) throw new Errors.ValueError(`link ${repr(link)} is not set`);
  if (!isKind(found)) throw new TypeError(`${what} must be ${what === "a rule" ? "an expression" : "a predicate"}`);
  return found;
}

function read(predicate: PredicateData): Bindings.State {
  const values = new Map<string, unknown>();
  for (const name of ["name", "description"] as const) if (predicate[name] !== null) values.set(name, predicate[name]);
  if (predicate.symbols.size > 0) {
    values.set("symbols", [...predicate.symbols].map(([symbol, schema]) =>
      new Map<string, unknown>([["name", symbol], ["type", Modules.reference(schema)]])));
  }
  const rule = predicate.rule === null ? [] : [new Bindings.Entry(new Map([["argument", predicate.rule]]), new Map([["index", 0n]]))];
  return new Bindings.State(values, new Map([["rule", rule]]));
}

function make(store: Stores.Store, state: Bindings.State): PredicateData {
  const rules = state.entries.get("rule") ?? []; // none yet while a snapshot is read: its entries come after its objects
  if (rules.length > 1) throw new Errors.ValueError(`a predicate has one rule, got ${rules.length}`);
  const rule = rules.length > 0 ? target(rules[0] as Bindings.Entry, "argument", (v) => DIALECT.accepts(v), "a rule") : null;
  const symbols: Symbols = new Map(((state.values.get("symbols") as PlainMap[] | undefined) ?? []).map((symbol) =>
    [symbol.get("name") as string, Modules.resolve(store, symbol.get("type") as PlainMap)]));
  return new PredicateData({ name: (state.values.get("name") as string | undefined) ?? null,
    description: (state.values.get("description") as string | undefined) ?? null, symbols, rule });
}

/** The binding of predicates to their meta-schema, reading symbols' schemas by name in `store`. */
export function binding(store: Stores.Store): Bindings.Binding {
  const built = (state: Bindings.State) => make(store, state);
  return new Bindings.Binding(OfPredicate.Schema, read, built,
    (instance: PredicateData, state: Bindings.State) => Object.assign(instance, built(state)), { implied: ["sets"] });
}

const BINDING = binding(new Stores.Catalog() as unknown as Stores.Store); // it only looks names up

// --- Evaluation ---

type Thunk = () => unknown;

/** Kleene's disjunction of the options. */
function choiceOf(thunks: Thunk[]): boolean | null {
  let unknown = false;
  for (const thunk of thunks) {
    const value = thunk();
    if (value === true) return true;
    if (value === null) unknown = true;
    else if (value !== false) throw new TypeError(`a choice's options must be bools, got ${typeName(value)}`);
  }
  return unknown ? null : false;
}

/** Evaluates predicates over `store`: Basic's rules, with extents from the store. Extents are read once per evaluator,
 * so an evaluator sees the store as it was when first asked. */
export class Evaluator {
  readonly interpreter: F.Interpreter;
  readonly #extents = new Map<string, readonly Visitable[]>();

  constructor(readonly store: Stores.Store) {
    const quantifiers = Basic.QUANTIFIERS;
    this.interpreter = new F.Interpreter(DIALECT, new Map<string, unknown>([
      ["operation", Basic.OPERATIONS], ["quantifier", quantifiers],
      ["extent", (_: Thunk[], node: OfExtent) => this.extent(node.schema as string)],
      ["forall", quantifiers.get("all")], ["exists", quantifiers.get("any")],
      ["choice", (thunks: Thunk[]) => choiceOf(thunks)], ["option", (thunks: Thunk[]) => (thunks[0] as Thunk)()],
    ]) as never, { typed: (domain, value) => new BasicDomains.Value(domain, value) });
  }

  /** The value of `expression` with `variables` bound. */
  run(expression: unknown, variables: Record<string, unknown> = {}): unknown {
    return this.interpreter.run(DIALECT.resolve(expression), variables);
  }

  /** The schema's extent, read once. */
  extent(name: string): readonly Visitable[] {
    if (!this.#extents.has(name)) {
      this.store.schema(name); // throws for an unknown name or a relation
      this.#extents.set(name, [...this.store.extent(name)]);
    }
    return this.#extents.get(name) as readonly Visitable[];
  }
}

/** The rule's value with `scope` bound: `true`, `false` or unknown (`null`); a rule that gives anything else throws. */
export function holds(evaluate: Evaluator, rule: unknown, scope: Record<string, unknown>): boolean | null {
  const result = evaluate.interpreter.run(rule, scope);
  if (result !== null && typeof result !== "boolean") throw new TypeError(`a predicate must be a bool, got ${typeName(result)}`);
  return result as boolean | null;
}
