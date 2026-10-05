/**
 * Predicates: named rules over a store's objects, and the predicate algebra they are written in.
 *
 * A predicate is a rule over symbols, each bound to an object of a schema, and parameters, each a value; it applies to
 * a *match*, a binding of every symbol to an object of its schema. It is built as schemas are, by a fluent builder
 * finalized by `create()`, `clone()` or `update()`, none of which validates:
 *
 *     const APerson = { person: Person };
 *     const HasName = new Predicates.OfPredicate.Builder()
 *       .name("HasName")
 *       .symbols(APerson)
 *       .parameters((p) => p.name("name"))
 *       .requires(E.variable("person").name.eq(E.variable("name")))
 *       .create();
 *
 * `.parameters(...)` takes property specs, as an object schema's `.properties(...)` does, each with a name and,
 * optionally, a type. `.requires(spec)` adds a condition, and `.forbids(spec)` the condition that `spec` does not hold;
 * the rule is their conjunction. A condition is any spec of the algebra: a term, or a writer. Its free names are the
 * symbols and parameters. A builder gives the variables it declares by name, so `pred.person` is the variable `person`
 * once `pred.symbols(APerson)` declares it. A predicate without symbols is a statement about the whole store; one
 * without a name is written inline, where it is used.
 *
 * A predicate is a term of the algebra, `DIALECT`, which extends mbse-expressions' Basic: it binds its symbols and
 * parameters within its rule (an import, in mbse-expressions' terms). Applying it, `HasName.call(pred.person, "alice")`,
 * is a term too, `OfApply`, which holds the predicate itself, by reference, and arguments for its symbols and then its
 * parameters, in order: it holds when the predicate's rule holds with them bound. A predicate used in several places is
 * one object, and is written once.
 *
 * The algebra's other terms, each a data class with a builder, are built as a predicate is, from a spec (data, or a
 * callable taking the builder):
 *
 * - `Exists(spec)` and `Forall(spec)`: whether some, or every, binding of the builder's `.symbols({...})` to objects of
 *   their schemas satisfies its `.requires(...)` and `.forbids(...)` (several symbols are their cross product);
 * - `Contains(c.phones, (e) => e.phone.eq(p))`: whether one of `c`'s entries in its adjacency `phones` satisfies the
 *   condition, which the function writes, given its parameter as a variable bound to the entry: the targets of the
 *   entry's other links, and its property values, by name. It is Basic's `any` over `entries(c, 'phones')`;
 * - `Choice((ch) => ch.option(0.35, spec).option(0.65, spec))`: a weighted disjunction, which holds when any of its
 *   options holds; the weights, positive and summing to 1, are how often a generator chooses each option, and what a
 *   characterizer estimates;
 * - `OfSet`: predicates, gathered in order.
 *
 * A quantifier ranges over its schema's extent in the store (its `extent` term: what the store's singletons reach).
 * `DIALECT` validates the trees that mix the algebra's terms with Basic's; `new Evaluator(store).run(...)` evaluates
 * them, with the store giving extents, and Basic's three-valued rules for everything else.
 *
 * Predicates and sets are mbse-schemas reference objects, as every term is, with meta-schemas `Patterns.Predicate` and
 * `Patterns.Set`: a symbol's schema is written as a property's type is, by its name or inline, and a term is its
 * arguments' parent through Basic's relation `Expressions.Arguments`. Reading resolves the symbols' schemas by name, so
 * it goes through a store that resolves them (`Constraints.OfStore`).
 */

import { Domains as BasicDomains, Evaluators as Basic, Expressions as E } from "@mbse/expressions";
import { Evaluators as F, Terms } from "@mbse/expressions/Framework";
import { Modules, Schemas, Stores } from "@mbse/schemas/Framework";
import type { PlainMap } from "@mbse/schemas/Framework/Plain";
import { repr, typeName } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

export const PREDICATE = "Patterns.Predicate";
export const SET = "Patterns.Set";

type SymbolsSpec = Record<string, unknown> | ReadonlyMap<string, unknown>;

/** Symbols or parameters by name, each with its schema (or null), in order: a `Map` that is equal to another with the
 * same names, in the same order, and equal schemas, as Python's dicts are, so that `Terms.same` compares them. */
export class Symbols extends Map<string, any> {
  equals(other: unknown): boolean {
    if (!(other instanceof Symbols) || other.size !== this.size) return false;
    const theirs = [...other];
    return [...this].every(([name, schema], i) => {
      const [otherName, otherSchema] = theirs[i] as [string, any];
      return name === otherName && (schema === otherSchema || (schema !== null && typeof schema.equals === "function" && schema.equals(otherSchema)));
    });
  }
}

function schemaName(schema: unknown): string {
  const name = typeof schema === "string" ? schema : (schema as { name?: unknown } | null)?.name;
  if (typeof name !== "string") throw new TypeError(`expected a named schema or its name, got ${repr(schema)}`);
  return name;
}

/** The conditions' conjunction, left to right; null if there are none. */
function conjunction(conditions: unknown[]): Terms.Term | null {
  let rule: Terms.Term | null = null;
  for (const condition of conditions) {
    rule = rule === null ? condition as Terms.Term : E.operation("and", rule as E.OfAny.Spec, condition as E.OfAny.Spec).data;
  }
  return rule;
}

function negation(spec: unknown): Terms.Term {
  return E.operation("not", DIALECT.resolve(spec) as E.OfAny.Spec).data;
}

function entries(symbols: SymbolsSpec): [string, unknown][] {
  return symbols instanceof Map ? [...symbols] : Object.entries(symbols);
}

// --- Symbols and parameters: value properties, whose schemas are resolved by name while reading ---

const STORES: Stores.Store[] = [new Stores.Catalog() as unknown as Stores.Store];

/** `read()`, with symbols' and parameters' schemas read from a snapshot resolved by name in `store`. */
export function resolving<T>(store: Stores.Store, read: () => T): T {
  STORES.push(store);
  try {
    return read();
  } finally {
    STORES.pop();
  }
}

function typed(name: string, schema: unknown): PlainMap {
  return new Map<string, unknown>(schema === null ? [["name", name]] : [["name", name], ["type", Modules.reference(schema as never)]]) as PlainMap;
}

const LIST = new Schemas.OfIndexed.Builder().of(Schemas.OfProperty.Schema).create();

/** Symbols by name, each with the schema of the objects it binds, written as an object schema's properties are; none
 * are not written. */
export const SYMBOLS = new Terms.ValueProperty(LIST,
  (symbols) => (symbols as Symbols).size === 0 ? null : [...(symbols as Symbols)].map(([name, schema]) => typed(name, schema)),
  (plain) => new Symbols((plain as PlainMap[]).map((entry) => [entry.get("name") as string,
    entry.get("type") === undefined || entry.get("type") === null ? null
      : Modules.resolve(STORES[STORES.length - 1] as Stores.Store, entry.get("type") as PlainMap)])));

/** Parameters by name, each with its type, or null for a parameter of any type, written as symbols are. */
export const PARAMETERS = SYMBOLS;

/** The names a builder declares, which it gives as variables: `builder.name`. */
interface Declaring {
  declared(): readonly string[];
}

/** `builder`, giving the variables it declares by name. */
function declaring<B extends Declaring>(builder: B): B {
  return new Proxy(builder, {
    get(target, property, receiver) {
      if (typeof property === "string" && !(property in target) && target.declared().includes(property)) {
        return E.variable(property);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

// --- Terms ---

/** The objects of the schema named `schema` in the store. */
export class OfExtent extends Terms.Term {
  static override KIND = "extent";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["schema", String]]);
  /** Builds this kind. */
  declare static Builder: typeof ExtentBuilder;
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
  static override KIND = "forall";
  /** Builds this kind. */
  declare static Builder: typeof ForallBuilder;
}

/** Whether the body holds for some object of the collection, with `name` bound to it. */
export class OfExists extends Quantified {
  static override KIND = "exists";
  /** Builds this kind. */
  declare static Builder: typeof ExistsBuilder;
}

/** An option of a choice: its predicate, and its weight. */
export class OfOption extends Terms.Term {
  static override KIND = "option";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["weight", Number]]);
  static override SLOTS = ["body"];
  /** Builds this kind. */
  declare static Builder: typeof OptionBuilder;
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
  static override KIND = "choice";
  static override ROLE = Terms.APPLICATION;
  static override VARIADIC = "options";
  /** Builds this kind. */
  declare static Builder: typeof ChoiceBuilder;
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

/** A rule over symbols and parameters, which it binds within the rule. `predicate.call(...arguments)` applies it: see
 * `OfApply`. */
export class OfPredicate extends Terms.Term {
  static override KIND = "predicate";
  static override ROLE = Terms.IMPORT;
  static override PROPERTIES = new Map<string, unknown>([["name", String], ["description", String]]);
  static override OPTIONAL = new Set(["name", "description"]);
  static override VALUES = new Map([["symbols", SYMBOLS], ["parameters", PARAMETERS]]);
  static override SLOTS = ["rule"];
  /** Builds this kind. */
  declare static Builder: typeof PredicateBuilder;
  declare name: string | null;
  declare description: string | null;
  declare rule: any;
  declare symbols: Symbols; // symbol -> schema
  declare parameters: Symbols; // parameter -> type, or null

  constructor(name: unknown = null, description: unknown = null, rule: unknown = null, symbols: unknown = null,
    parameters: unknown = null) {
    super(name, description, rule, symbols ?? new Symbols(), parameters ?? new Symbols());
  }

  override binds(): string[] {
    return [...this.symbols.keys(), ...this.parameters.keys()];
  }

  override check(): string[] {
    return [...this.symbols].filter(([, schema]) => !(schema instanceof Schemas.OfObject.Data && schema.ref && schema.name !== null))
      .map(([symbol]) => `symbol ${repr(symbol)} needs a named reference object schema`);
  }

  /** The predicate applied to `args`, specs for its symbols and then its parameters, in order. */
  call(...args: unknown[]): OfApply {
    return new OfApply(this, args.map((argument) => DIALECT.resolve(argument)));
  }

  /** A predicate, or what a callable taking a predicate builder builds. */
  static resolve(spec: unknown): OfPredicate {
    return Terms.resolve(spec, (v): v is OfPredicate => v instanceof OfPredicate, () => new PredicateBuilder(), "a predicate");
  }
}

/** A predicate applied to arguments, for its symbols and then its parameters: whether its rule holds with them bound. */
export class OfApply extends Terms.Term {
  static override KIND = "apply";
  static override ROLE = Terms.APPLICATION;
  static override SLOTS = ["predicate"];
  static override VARIADIC = "arguments";
  declare static Builder: typeof Terms.Builder;
  declare predicate: any;
  declare arguments: readonly any[];

  constructor(predicate: unknown = null, args: readonly unknown[] = []) {
    super(predicate, args);
  }

  override check(): string[] {
    if (!(this.predicate instanceof OfPredicate)) {
      return this.predicate !== null ? ["an application's predicate must be a predicate"] : [];
    }
    const wanted = this.predicate.binds().length;
    if (this.arguments.length !== wanted) return [`${repr(this.predicate.name)} takes ${wanted} arguments, got ${this.arguments.length}`];
    return [];
  }
}

/** Predicates, in order. */
export class OfSet extends Terms.Term {
  static override KIND = "set";
  static override ROLE = Terms.APPLICATION;
  static override VARIADIC = "predicates";
  /** Builds this kind. */
  declare static Builder: typeof SetBuilder;
  declare predicates: readonly any[];

  constructor(predicates: readonly unknown[] = []) {
    super(predicates);
  }

  override check(): string[] {
    return this.predicates.every((p) => p instanceof OfPredicate) ? [] : ["a set's arguments are predicates"];
  }
}

// --- Builders ---

/** Builds a quantifier. DSL: `.symbols({name: schema})`, each schema a named schema or its name, added to those
 * already given, and `.requires(spec)` and `.forbids(spec)`, which add conditions to the body. The first symbol is
 * this quantifier's; each other is a quantifier of the same kind in the body, within which the conditions hold. As a
 * `Visitors.OfObject`, the collection is the `arguments` entry with index 0 and the body the one with index 1. The
 * builder gives its symbols as variables. */
abstract class QuantifiedBuilder extends Terms.Builder implements Declaring {
  [variable: string]: any;
  private inner = new Map<string, string>();
  private conditions: unknown[] = [];

  constructor(instance?: Terms.Term) {
    super(instance);
    return declaring(this);
  }

  declared(): string[] {
    const name = this.state.values.get("name") as string | undefined;
    return [...(name === undefined ? [] : [name]), ...this.inner.keys()];
  }

  symbols(symbols: SymbolsSpec): this {
    for (const [name, schema] of entries(symbols)) {
      if (this.state.values.has("name") || this.inner.size > 0) this.inner.set(name, schemaName(schema));
      else this.set("name", name).argument("collection", new OfExtent(schemaName(schema)));
    }
    return this;
  }

  requires(spec: unknown): this {
    this.conditions.push(DIALECT.resolve(spec));
    return this;
  }

  forbids(spec: unknown): this {
    this.conditions.push(negation(spec));
    return this;
  }

  /** Writes the pending symbols and conditions into the body. */
  private fold(): void {
    if (this.inner.size === 0 && this.conditions.length === 0) return;
    const existing = (this.state.entries.get("arguments") ?? []).find((entry) => entry.properties.get("index") === 1n)
      ?.links.get("argument");
    let body = conjunction([...(existing === undefined ? [] : [existing]), ...this.conditions]);
    const kind = this.data as unknown as new (name: unknown, collection: unknown, body: unknown) => Quantified;
    for (const [name, schema] of [...this.inner].reverse()) body = new kind(name, new OfExtent(schema), body);
    this.inner = new Map();
    this.conditions = [];
    this.argument("body", body);
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

/** Builds a predicate. DSL: `.name(str)`, `.description(str)`, `.symbols({name: schema})` and `.parameters(...specs)`,
 * each added to those already given, in order, and `.requires(spec)` and `.forbids(spec)`, which add conditions to the
 * rule. The builder gives its symbols and parameters as variables. */
class PredicateBuilder extends Terms.Builder implements Declaring {
  static override DATA = OfPredicate;
  [variable: string]: any;
  private readonly heldSymbols: Symbols;
  private readonly heldParameters: Symbols;
  private conditions: unknown[] = [];

  constructor(instance?: OfPredicate) {
    super(instance);
    this.heldSymbols = new Symbols(instance?.symbols ?? []);
    this.heldParameters = new Symbols(instance?.parameters ?? []);
    for (const name of ["symbols", "parameters"]) this.state.values.delete(name); // held as data, not in their plain form
    return declaring(this);
  }

  declared(): string[] {
    return [...this.heldSymbols.keys(), ...this.heldParameters.keys()];
  }

  name(name: string): this {
    return this.set("name", name);
  }

  description(text: string): this {
    return this.set("description", text);
  }

  /** Symbols by name, each with the schema of the objects it binds, in order; added to those already given. */
  symbols(symbols: SymbolsSpec): this {
    for (const [name, schema] of entries(symbols)) this.heldSymbols.set(name, schema);
    return this;
  }

  /** Parameters, each a property spec (`(p) => p.name("name")`, with `.of(type)` optionally), in order. */
  parameters(...specs: Schemas.OfProperty.Spec[]): this {
    for (const spec of specs) {
      const built = spec(new Schemas.OfProperty.Builder()).create();
      this.heldParameters.set(built.name, built.type);
    }
    return this;
  }

  /** Adds a condition: a spec of the algebra whose free names are the symbols and parameters. */
  requires(spec: unknown): this {
    this.conditions.push(DIALECT.resolve(spec));
    return this;
  }

  /** Adds the condition that `spec` does not hold. */
  forbids(spec: unknown): this {
    this.conditions.push(negation(spec));
    return this;
  }

  private fold(made: OfPredicate): OfPredicate {
    made.symbols = new Symbols(this.heldSymbols);
    made.parameters = new Symbols(this.heldParameters);
    return made;
  }

  private rule(): void {
    if (this.conditions.length === 0) return;
    const existing = (this.state.entries.get("arguments") ?? [])[0]?.links.get("argument");
    this.argument("rule", conjunction([...(existing === undefined ? [] : [existing]), ...this.conditions]));
    this.conditions = [];
  }

  override create(): OfPredicate {
    this.rule();
    return this.fold(super.create());
  }

  override clone(): OfPredicate {
    this.rule();
    return this.fold(super.clone());
  }

  override update(): OfPredicate {
    this.rule();
    return this.fold(super.update());
  }
}

/** Builds a set. DSL: `.predicates(...specs)`, each a predicate or a callable taking a predicate builder, added in
 * order. */
class SetBuilder extends Terms.Builder {
  static override DATA = OfSet;

  predicates(...specs: (OfPredicate | ((builder: PredicateBuilder) => PredicateBuilder))[]): this {
    return this.arguments(...specs.map((spec) => OfPredicate.resolve(spec)));
  }

  override create(): OfSet {
    return super.create();
  }

  override clone(): OfSet {
    return super.clone();
  }

  override update(): OfSet {
    return super.update();
  }
}

class ApplyBuilder extends Terms.Builder {
  static override DATA = OfApply;
}

const KINDS = [OfExtent, OfForall, OfExists, OfChoice, OfOption, OfPredicate, OfApply, OfSet];
const BUILDERS = [ExtentBuilder, ForallBuilder, ExistsBuilder, ChoiceBuilder, OptionBuilder, PredicateBuilder, ApplyBuilder, SetBuilder];
const NAMES = new Map([["predicate", PREDICATE], ["set", SET]]);

/** The predicate algebra: Basic's kinds, and the kinds above. */
export const DIALECT = new Terms.Declared("Predicates", KINDS as unknown as Terms.TermClass[], {
  domain_of: BasicDomains.of, extends: E.DIALECT,
  builders: new Map(KINDS.map((kind, i) => [kind.KIND, BUILDERS[i] as unknown as typeof Terms.Builder])),
  schemaNames: new Map(KINDS.map((kind) => [kind.KIND,
    NAMES.get(kind.KIND) ?? `Patterns.Of${kind.KIND[0]!.toUpperCase()}${kind.KIND.slice(1)}`])),
});

OfExtent.Builder = ExtentBuilder;
OfForall.Builder = ForallBuilder;
OfExists.Builder = ExistsBuilder;
OfChoice.Builder = ChoiceBuilder;
OfOption.Builder = OptionBuilder;
OfPredicate.Builder = PredicateBuilder;
OfApply.Builder = ApplyBuilder;
OfSet.Builder = SetBuilder;

export namespace OfPredicate {
  export type Spec = OfPredicate | ((builder: PredicateBuilder) => PredicateBuilder);
  export type Builder = PredicateBuilder;
}
export namespace OfExists {
  export type Builder = ExistsBuilder;
}
export namespace OfForall {
  export type Builder = ForallBuilder;
}
export namespace OfChoice {
  export type Builder = ChoiceBuilder;
}
export namespace OfSet {
  export type Builder = SetBuilder;
}

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

/** Evaluates predicates over `store`: Basic's rules, with extents from the store and applications of predicates.
 * Extents are read once per evaluator, so an evaluator sees the store as it was when first asked. */
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
      ["apply", (thunks: Thunk[], node: OfApply) => this.apply(thunks, node)],
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

  private apply(thunks: Thunk[], node: OfApply): unknown {
    const predicate = node.predicate as OfPredicate;
    const values = thunks.slice(1).map((thunk) => thunk());
    return this.interpreter.run(predicate.rule, Object.fromEntries(predicate.binds().map((name, i) => [name, values[i]])));
  }
}

/** The rule's value with `scope` bound: `true`, `false` or unknown (`null`); a rule that gives anything else throws. */
export function holds(evaluate: Evaluator, rule: unknown, scope: Record<string, unknown>): boolean | null {
  const result = evaluate.interpreter.run(rule, scope);
  if (result !== null && typeof result !== "boolean") throw new TypeError(`a predicate must be a bool, got ${typeName(result)}`);
  return result as boolean | null;
}
