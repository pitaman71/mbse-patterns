/**
 * Predicates: named constraints over a store's objects, and the predicate algebra they are written in.
 *
 * A predicate is a named constraint over symbols, each bound to an object of a schema, and parameters, each a value; it
 * applies to a *match*, a binding of every symbol to an object of its schema. It is built as schemas are, by a fluent
 * builder finalized by `create()`, `clone()` or `update()`, none of which validates:
 *
 *     const APerson = { person: Person };
 *     const HasName = new Predicates.OfPredicate.Builder()
 *       .name("HasName")
 *       .symbols(APerson)
 *       .parameters((p) => p.name("name"))
 *       .requires(E.variable("person").name.eq(E.variable("name")))
 *       .create();
 *
 * `.parameters(...)` takes parameter specs, as a schema's `.parameters(...)` does (mbse-schemas' `OfParameter`), each
 * with a name and, optionally, a type and a description. `.requires(spec)` adds a condition, and `.forbids(spec)` the condition that `spec` does not hold;
 * its `requires` is their conjunction. A condition is any spec of the algebra: a term, or a writer. Its free names are
 * the symbols and parameters. A builder gives the variables it declares by name, so `pred.person` is the variable
 * `person` once `pred.symbols(APerson)` declares it. A predicate without symbols is a statement about the whole store;
 * one without a name is written inline, where it is used.
 *
 * A predicate is a term of the algebra, `DIALECT`, which extends mbse-expressions' Basic: it binds its symbols and
 * parameters within `requires` (an import, in mbse-expressions' terms). Applying it, `HasName.call(pred.person,
 * "alice")` or `HasName.call(pred.person, { name: "alice" })`, is a term too, `OfApply`, which holds the predicate
 * itself, by reference, arguments for its symbols, in order, and arguments for its parameters, in order or by name,
 * some or all: it holds when the predicate's `requires` holds with them bound, a parameter given no argument unknown.
 * A predicate used in several places is one object, and is written once.
 *
 * The algebra's other terms, each a data class with a builder, are built as a predicate is, from a spec (data, or a
 * callable taking the builder):
 *
 * - `Exists(spec)` and `Forall(spec)`: whether some, or every, binding of the builder's `.symbols({...})` to objects of
 *   their schemas satisfies its `.requires(...)` and `.forbids(...)` (several symbols are their cross product);
 * - `Contains(c.phones, (e) => e.phone.eq(p))`: whether one of `c`'s entries in its adjacency `phones` satisfies the
 *   condition, which the function writes, given its parameter as a variable bound to the entry: the targets of the
 *   entry's other links, and its property values, by name. It is Basic's `any` over `entries(c, 'phones')`;
 * - `Distributions.Choices` and the distributions of values (`Distributions.Normal`, ...): weighted alternatives, and
 *   values drawn, which say how matches are distributed (see `Distributions`);
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
import { Evaluators as F, Symbolics, Terms } from "@mbse/expressions/Framework";
import { Modules, Schemas, Stores } from "@mbse/schemas/Framework";
import type { PlainMap } from "@mbse/schemas/Framework/Plain";
import { repr, typeName } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Distributions from "./Distributions.js";

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

/** Parameter names, in order, compared by value, as Python's tuples are. */
export class Names extends Array<string> {
  equals(other: unknown): boolean {
    return other instanceof Names && other.length === this.length && this.every((name, i) => name === other[i]);
  }
}

function schemaName(schema: unknown): string {
  const name = typeof schema === "string" ? schema : (schema as { name?: unknown } | null)?.name;
  if (typeof name !== "string") throw new TypeError(`expected a named schema or its name, got ${repr(schema)}`);
  return name;
}

/** The conditions' conjunction, left to right; null if there are none. */
function count(n: number, noun: string): string {
  return n === 1 ? `${n} ${noun}` : `${n} ${noun}s`;
}

/** Whether `value` is an object literal: named arguments, which no spec of the algebra is. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function conjunction(conditions: unknown[]): Terms.Term | null {
  let constraint: Terms.Term | null = null;
  for (const condition of conditions) {
    constraint = constraint === null ? condition as Terms.Term : E.operation("and", constraint as E.OfAny.Spec, condition as E.OfAny.Spec).data;
  }
  return constraint;
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

/** The schema an entry's `type` names, resolved in the innermost store being read with; null where it has none. */
function typeOf(entry: PlainMap): unknown {
  return entry.has("type") ? Modules.resolve(STORES[STORES.length - 1] as Stores.Store, entry.get("type") as PlainMap) : null;
}

function typed(name: string, schema: unknown): PlainMap {
  return new Map<string, unknown>(schema === null ? [["name", name]] : [["name", name], ["type", Modules.reference(schema as never)]]) as PlainMap;
}

const LIST = new Schemas.OfIndexed.Builder().of(Schemas.OfProperty.Schema).create();

/** Symbols by name, each with the schema of the objects it binds, written as an object schema's properties are; none
 * are not written. */
export const SYMBOLS = new Terms.ValueProperty(LIST,
  (symbols) => (symbols as Symbols).size === 0 ? null : [...(symbols as Symbols)].map(([name, schema]) => typed(name, schema)),
  (plain) => new Symbols((plain as PlainMap[]).map((entry) => [entry.get("name") as string, typeOf(entry)])));

function parameter(declared: Schemas.OfParameter.Data): PlainMap {
  const plain = typed(declared.name, declared.type);
  if (declared.description !== null) plain.set("description", declared.description);
  return plain;
}

/** Parameters by name, each an `OfParameter` (its type null for a parameter of any type), written as a schema's
 * parameters are; none are not written. */
export const PARAMETERS = new Terms.ValueProperty(LIST,
  (parameters) => (parameters as Symbols).size === 0 ? null : [...(parameters as Symbols).values()].map(parameter),
  (plain) => new Symbols((plain as PlainMap[]).map((entry) => [entry.get("name") as string, new Schemas.OfParameter.Data({
    name: entry.get("name") as string, type: typeOf(entry) as Schemas.OfAny.Data | null,
    description: (entry.get("description") as string | undefined) ?? null })])));

/** The names of the parameters an application gives arguments for, in the predicate's order; none are not written. */
export const GIVEN = new Terms.ValueProperty(new Schemas.OfIndexed.Builder().of((t) => t.as_native(String)).create(),
  (names) => (names as readonly string[]).length === 0 ? null : [...(names as readonly string[])],
  (plain) => Names.from(plain as string[]));

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

/** A constraint over symbols and parameters, which it binds within the constraint it `requires`.
 * `predicate.call(...arguments)` applies it: see `OfApply`. */
export class OfPredicate extends Terms.Term {
  static override KIND = "predicate";
  static override ROLE = Terms.IMPORT;
  static override PROPERTIES = new Map<string, unknown>([["name", String], ["description", String]]);
  static override OPTIONAL = new Set(["name", "description"]);
  static override VALUES = new Map([["symbols", SYMBOLS], ["parameters", PARAMETERS]]);
  static override SLOTS = ["requires"];
  /** Builds this kind. */
  declare static Builder: typeof PredicateBuilder;
  declare name: string | null;
  declare description: string | null;
  declare requires: any;
  declare symbols: Symbols; // symbol -> schema
  declare parameters: Symbols; // parameter -> OfParameter

  constructor(name: unknown = null, description: unknown = null, requires: unknown = null, symbols: unknown = null,
    parameters: unknown = null) {
    super(name, description, requires, symbols ?? new Symbols(), parameters ?? new Symbols());
  }

  override binds(): string[] {
    return [...this.symbols.keys(), ...this.parameters.keys()];
  }

  override check(): string[] {
    return [...this.symbols].filter(([, schema]) => !(schema instanceof Schemas.OfObject.Data && schema.name !== null))
      .map(([symbol]) => `symbol ${repr(symbol)} needs a named object schema`);
  }

  /** The predicate applied: `args` are specs for its symbols, in order, and then for its parameters, in order; a last
   * object literal gives specs for its parameters by name. A parameter given no argument is unbound. */
  call(...args: unknown[]): OfApply {
    const named = args.length > 0 && isRecord(args[args.length - 1]) ? args.pop() as Record<string, unknown> : {};
    const names = [...this.parameters.keys()];
    const symbols = args.slice(0, this.symbols.size);
    const rest = args.slice(this.symbols.size);
    if (rest.length > names.length) {
      throw new TypeError(`${repr(this.name)} takes ${count(this.symbols.size, "symbol")} and ${count(names.length, "parameter")}, `
        + `got ${count(args.length, "argument")}`);
    }
    const given = new Map(rest.map((argument, i) => [names[i] as string, argument]));
    for (const [name, argument] of Object.entries(named)) {
      if (!this.parameters.has(name)) throw new TypeError(`${repr(this.name)} has no parameter ${repr(name)}`);
      if (given.has(name)) throw new TypeError(`parameter ${repr(name)} is given twice`);
      given.set(name, argument);
    }
    const ordered = names.filter((name) => given.has(name));
    return new OfApply(this, [...symbols, ...ordered.map((name) => given.get(name))].map((argument) => DIALECT.resolve(argument)),
      ordered);
  }

  /** A predicate, or what a callable taking a predicate builder builds. */
  static resolve(spec: unknown): OfPredicate {
    return Terms.resolve(spec, (v): v is OfPredicate => v instanceof OfPredicate, () => new PredicateBuilder(), "a predicate");
  }
}

/** A predicate applied to arguments: one for each symbol, in order, then one for each parameter named in
 * `parameters`. It holds when the predicate's `requires` holds with them bound, a parameter given none unknown. */
export class OfApply extends Terms.Term {
  static override KIND = "apply";
  static override ROLE = Terms.APPLICATION;
  static override SLOTS = ["predicate"];
  static override REFERS = new Set(["predicate"]);
  static override VARIADIC = "arguments";
  static override VALUES = new Map([["parameters", GIVEN]]);
  declare static Builder: typeof Terms.Builder;
  declare predicate: any;
  declare arguments: readonly any[];
  declare parameters: Names;

  constructor(predicate: unknown = null, args: readonly unknown[] = [], parameters: readonly string[] | null = null) {
    super(predicate, args, Names.from(parameters ?? []));
  }

  /** The predicate's symbols and parameters bound to the values of the arguments, in order; a parameter given no
   * argument is bound to null, unknown. */
  bindings(values: readonly unknown[]): Map<string, unknown> {
    const predicate = this.predicate as OfPredicate;
    const symbols = this.arguments.length - this.parameters.length;
    const bound = new Map<string, unknown>([...predicate.parameters.keys()].map((name) => [name, null]));
    [...predicate.symbols.keys()].slice(0, symbols).forEach((name, i) => bound.set(name, values[i]));
    this.parameters.forEach((name, i) => bound.set(name, values[symbols + i]));
    return bound;
  }

  override check(): string[] {
    if (!(this.predicate instanceof OfPredicate)) {
      return this.predicate !== null ? ["an application's predicate must be a predicate"] : [];
    }
    const predicate = this.predicate;
    const problems: string[] = [];
    const symbols = this.arguments.length - this.parameters.length;
    if (symbols !== predicate.symbols.size) problems.push(`${repr(predicate.name)} takes ${count(predicate.symbols.size, "symbol")}, got ${symbols}`);
    problems.push(...this.parameters.filter((name) => !predicate.parameters.has(name))
      .map((name) => `${repr(predicate.name)} has no parameter ${repr(name)}`));
    if (new Set(this.parameters).size !== this.parameters.length) problems.push("a parameter is given more than one argument");
    return problems;
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

  requires(...specs: unknown[]): this {
    this.conditions.push(...specs.map((spec) => DIALECT.resolve(spec)));
    return this;
  }

  forbids(...specs: unknown[]): this {
    this.conditions.push(...specs.map((spec) => negation(spec)));
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

/** Builds an extent. DSL: `.schema(schema)`, a named schema or its name. */
class ExtentBuilder extends Terms.Builder {
  static override DATA = OfExtent;

  schema(schema: unknown): this {
    return this.set("schema", schemaName(schema));
  }
}

/** Builds a predicate. DSL: `.name(str)`, `.description(str)`, `.symbols({name: schema})` and `.parameters(...specs)`,
 * each added to those already given, in order, and `.requires(spec)` and `.forbids(spec)`, which add conditions to
 * `requires`. The builder gives its symbols and parameters as variables. */
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

  /** Parameters, in order, each an `OfParameter` or a spec (`(p) => p.name("name")`, with `.of(type)` and
   * `.description(text)` optionally). */
  parameters(...specs: Schemas.OfParameter.Spec[]): this {
    for (const spec of specs) {
      const built = spec instanceof Schemas.OfParameter.Data ? spec : spec(new Schemas.OfParameter.Builder()).create();
      this.heldParameters.set(built.name, built);
    }
    return this;
  }

  /** Adds conditions: specs of the algebra whose free names are the symbols and parameters. */
  requires(...specs: unknown[]): this {
    this.conditions.push(...specs.map((spec) => DIALECT.resolve(spec)));
    return this;
  }

  /** Adds the conditions that each of `specs` does not hold. */
  forbids(...specs: unknown[]): this {
    this.conditions.push(...specs.map((spec) => negation(spec)));
    return this;
  }

  private fold(made: OfPredicate): OfPredicate {
    made.symbols = new Symbols(this.heldSymbols);
    made.parameters = new Symbols(this.heldParameters);
    return made;
  }

  private writeRequires(): void {
    if (this.conditions.length === 0) return;
    const existing = (this.state.entries.get("arguments") ?? [])[0]?.links.get("argument");
    this.argument("requires", conjunction([...(existing === undefined ? [] : [existing]), ...this.conditions]));
    this.conditions = [];
  }

  override create(): OfPredicate {
    this.writeRequires();
    return this.fold(super.create());
  }

  override clone(): OfPredicate {
    this.writeRequires();
    return this.fold(super.clone());
  }

  override update(): OfPredicate {
    this.writeRequires();
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

const KINDS = [OfExtent, OfForall, OfExists, OfPredicate, OfApply, OfSet, ...Distributions.KINDS];
const BUILDERS = [ExtentBuilder, ForallBuilder, ExistsBuilder, PredicateBuilder, ApplyBuilder, SetBuilder, ...Distributions.BUILDERS];
const NAMES = new Map([["predicate", PREDICATE], ["set", SET]]);

/** The predicate algebra: Basic's kinds, and the kinds above. */
export const DIALECT = new Terms.Declared("Predicates", KINDS as unknown as Terms.TermClass[], {
  domain_of: BasicDomains.of, extends: E.DIALECT,
  builders: new Map(KINDS.map((kind, i) => [kind.KIND, BUILDERS[i] as unknown as typeof Terms.Builder])),
  schemaNames: new Map((KINDS as unknown as { KIND: string }[]).map((kind) => [kind.KIND,
    NAMES.get(kind.KIND) ?? `Patterns.Of${kind.KIND[0]!.toUpperCase()}${kind.KIND.slice(1)}`])),
});

OfExtent.Builder = ExtentBuilder;
OfForall.Builder = ForallBuilder;
OfExists.Builder = ExistsBuilder;
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

/** Whether one of an object's entries in an adjacency, written `c.phones`, satisfies `condition`, a function of one
 * entry given its parameter as a variable: Basic's `any(e in entries(c, 'phones'), ...)`. */
export function Contains(adjacency: unknown, condition: (entry: E.Writer) => unknown): E.OfQuantifier.Data {
  const collection = E.OfAny.resolve(adjacency) as any;
  if (!(collection instanceof E.OfOperation.Data && collection.name === "get" && collection.arguments.length === 2
    && collection.arguments[1] instanceof E.OfLiteral.Data && typeof collection.arguments[1].value === "string")) {
    throw new TypeError("Contains expects an object's adjacency, such as c.phones");
  }
  const name = Distributions.parameter(condition);
  if (name === null) throw new TypeError("Contains expects a function of one entry");
  const collected = E.operation("entries", collection.arguments[0] as E.OfAny.Spec, collection.arguments[1].value as string);
  return E.quantifier("any", name, collected, DIALECT.resolve(condition(E.variable(name))) as E.OfAny.Spec).data as E.OfQuantifier.Data;
}

// --- Evaluation ---

type Thunk = () => unknown;

/** Whether `value` is in a distribution's support, its parameters given by `parameter(name)`. */
function inSupport(drawn: Distributions.Drawn, value: unknown, parameter: (name: string) => unknown): boolean {
  if (drawn instanceof Distributions.Normal) {
    return drawn.rounded ? typeof value === "bigint" : typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));
  }
  if (drawn instanceof Distributions.Uniform) {
    const [low, high] = [parameter("low"), parameter("high")] as [any, any];
    if (typeof low === "bigint" && typeof high === "bigint") return typeof value === "bigint" && low <= value && value <= high;
    return (typeof value === "bigint" || typeof value === "number") && low <= value && value < high;
  }
  if (drawn instanceof Distributions.Poisson || drawn instanceof Distributions.Geometric) {
    return typeof value === "bigint" && value >= 0n;
  }
  return (drawn as Distributions.Categorical).options.some((option) => option.value instanceof E.OfLiteral.Data
    && typeof value === typeof option.value.value && value === option.value.value);
}

function truth(value: unknown): boolean | null {
  if (value !== null && typeof value !== "boolean") throw new TypeError(`a constraint must be a bool, got ${typeName(value)}`);
  return value as boolean | null;
}

/** Basic's interpreter, which also evaluates the distributions' binding forms itself. */
class Interpreter extends F.Interpreter {
  override evaluate(expression: unknown, scope: any, active: Set<unknown>): any {
    if (!Distributions.DRAWN.some((kind) => expression instanceof kind)) return super.evaluate(expression, scope, active);
    const drawn = expression as Distributions.Drawn;
    const found = Distributions.witness(drawn);
    const value = found === null ? null : this.evaluate(found, scope, active);
    if (value === null) return null;
    if (!inSupport(drawn, value, (name) => this.evaluate((drawn as any)[name], scope, active))) return false;
    return this.evaluate(drawn.body, scope.bind(drawn.symbol as string, value), active);
  }
}

/** Evaluates predicates over `store`: Basic's rules, with extents from the store, applications of predicates, choices
 * (whether the number of arms that hold satisfies their count) and distributions (whether the value their body equates
 * their symbol with is in their support, and the body holds with it). Extents are read once per evaluator, so an
 * evaluator sees the store as it was when first asked. A predicate may apply itself (recursion): an application made
 * again, with the same values, while it is being evaluated is unknown, since nothing decides it. */
export class Evaluator {
  readonly interpreter: F.Interpreter;
  readonly #extents = new Map<string, readonly Visitable[]>();
  /** The applications being evaluated, and their values. */
  readonly #applying: [unknown, unknown[]][] = [];
  /** When given, how each choices' arms held, by node. */
  observe: Map<unknown, (boolean | null)[]> | null = null;

  constructor(readonly store: Stores.Store) {
    const quantifiers = Basic.QUANTIFIERS;
    this.interpreter = new Interpreter(DIALECT, new Map<string, unknown>([
      ["operation", Basic.OPERATIONS], ["quantifier", quantifiers],
      ["extent", (_: Thunk[], node: OfExtent) => this.extent(node.schema as string)],
      ["forall", quantifiers.get("all")], ["exists", quantifiers.get("any")],
      ["apply", (thunks: Thunk[], node: OfApply) => this.apply(thunks, node)],
      ["choices", (_: Thunk[], node: Distributions.Choices, scope: any) => this.choices(node, scope)],
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
    const values = thunks.slice(1).map((thunk) => thunk());
    if (this.#applying.some(([predicate, given]) => predicate === node.predicate && given.length === values.length
      && given.every((value, i) => value === values[i]))) {
      return null; // applied again, with the same values, within itself: nothing decides it
    }
    this.#applying.push([node.predicate, values]);
    try {
      return this.interpreter.run((node.predicate as OfPredicate).requires, Object.fromEntries(node.bindings(values)));
    } finally {
      this.#applying.pop();
    }
  }

  /** Whether each of a choices' arms holds, in order. */
  held(node: Distributions.Choices, scope: any): (boolean | null)[] {
    return node.arms.map((arm) => truth(this.interpreter.evaluate(arm.condition, scope, new Set())));
  }

  private choices(node: Distributions.Choices, scope: any): boolean | null {
    const held = this.held(node, scope);
    this.observe?.set(node, held);
    const count = node.count as Distributions.Count;
    const least = held.filter((h) => h === true).length;
    const found = new Set<boolean | null>();
    for (let n = least; n <= least + held.filter((h) => h === null).length; n++) { // every count the unknown arms allow
      found.add(truth(this.interpreter.evaluate(count.condition, scope.bind(count.name as string, BigInt(n)), new Set())));
    }
    return found.size === 1 ? [...found][0] as boolean | null : null;
  }

  /** What a match weighs under a constraint: 0 unless the constraint holds; then the product, over the choices on its
   * conjuncts, of the weight of the arm the match falls under (the first that holds, with `decreasing`) or the sum of
   * those of the arms that hold, each times what the match weighs under the arm's condition. */
  weigh(constraint: unknown, scope: Record<string, unknown>): number {
    const variables = new Symbolics.Variables(scope);
    const resolved = DIALECT.resolve(constraint);
    return this.interpreter.evaluate(resolved, variables, new Set()) === true ? this.weighed(resolved, variables) : 0;
  }

  private weighed(node: unknown, scope: any): number {
    if (node instanceof E.OfOperation.Data && node.name === "and" && node.arguments.length === 2) {
      return this.weighed(node.arguments[0], scope) * this.weighed(node.arguments[1], scope);
    }
    if (node instanceof OfApply) {
      const values = node.arguments.map((argument) => this.interpreter.evaluate(argument, scope, new Set()));
      return this.weighed((node.predicate as OfPredicate).requires, new Symbolics.Variables(Object.fromEntries(node.bindings(values))));
    }
    if (node instanceof Distributions.Choices) {
      const held = this.held(node, scope);
      const weights = node.arms.filter((_, i) => held[i] === true)
        .map((arm: Distributions.Arm) => (arm.weight as number) * this.weighed(arm.condition, scope));
      return node.decreasing ? weights[0] ?? 0 : weights.reduce((a, b) => a + b, 0);
    }
    return 1;
  }
}

/** The constraint's value with `scope` bound: `true`, `false` or unknown (`null`); a constraint that gives anything
 * else throws. */
export function holds(evaluate: Evaluator, constraint: unknown, scope: Record<string, unknown>): boolean | null {
  const result = evaluate.interpreter.run(constraint, scope);
  if (result !== null && typeof result !== "boolean") throw new TypeError(`a constraint must be a bool, got ${typeName(result)}`);
  return result as boolean | null;
}
