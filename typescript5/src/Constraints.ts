/**
 * Constraints: predicates over a schema's objects, kept as data beside the schemas.
 *
 * A predicate is a named Basic rule over symbols, each bound to an object of a schema; it applies to a *match*, a
 * binding of every symbol to an object of its schema. It is built as schemas are, by a fluent builder finalized by
 * `create()`, `clone()` or `update()`:
 *
 *     const IsAnAdult = new Constraints.OfPredicate.Builder()
 *       .name("IsAnAdult")
 *       .description("18 or older")
 *       .symbols({ the: Contact })
 *       .rule(E.variable("the").age.ge(18n))
 *       .create();
 *
 * `.rule(spec)` takes any Basic `Spec`: data or a writer. A set, `OfSet`, gathers predicates in order:
 * `new OfSet.Builder().predicates(IsAnAdult, (p) => p.name(...)...)`. Nothing validates until asked: `validate()`
 * reports a missing name or rule, no symbols, a symbol whose schema is not a named reference object schema, the rule's
 * problems as a core Basic rule whose free names are the symbols, and, in a set, two predicates with one name.
 *
 * Predicates and sets are mbse-schemas reference objects with meta-schemas (`Patterns.Predicate`, `Patterns.Set`), so
 * a set is stored and sent like any data. A symbol's schema is written as a property's type is: by its name, or
 * inline; a predicate is its rule's parent through Basic's relation `Expressions.Arguments`, and a set holds its
 * predicates through `Patterns.Members`, by index. Writing needs no store; reading resolves the symbols' schemas by
 * name, so it goes through `OfStore(store)`, a store of the predicates' bound classes and Basic's that resolves names
 * in `store`; `Builders` is one that resolves none, which writes any predicate and reads those whose symbols' schemas
 * are inline. `register(store)` registers the meta-schemas, and Basic's, in another store.
 */

import { Expressions } from "@mbse/expressions";
import { Terms } from "@mbse/expressions/Framework";
import { Bindings, Errors, Modules, Schemas, Stores } from "@mbse/schemas/Framework";
import type { PlainMap } from "@mbse/schemas/Framework/Plain";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { OfObject } from "@mbse/schemas/Framework/Visitors";

export const PREDICATE = "Patterns.Predicate";
export const SET = "Patterns.Set";
export const MEMBERS = "Patterns.Members";

const text = (name: string) => (p: any) => p.name(name).of((t: any) => t.as_native(String));

/** The relation of a set to its predicates, each at its `index` in the set. */
export const Members = new Schemas.OfRelation.Builder().name(MEMBERS).links("set", "predicate").properties(
  (p: any) => p.name("index").of((t: any) => t.as_native(BigInt))).create();

/** Identities are strings, unique per object, as mbse-schemas keys them. */
let made = 0;

type Rule = Expressions.OfAny.Data;
type Symbols = Map<string, Schemas.OfAny.Data>;

/** Shared builder mechanics, as mbse-schemas' builders have them. */
abstract class Builder<D extends object> {
  protected readonly fields: Record<string, unknown>;

  constructor(private readonly source?: D) {
    this.fields = {};
    if (source !== undefined) {
      for (const [name, value] of Object.entries(source)) this.fields[name] = value instanceof Map ? new Map(value) : value;
    }
  }

  protected abstract make(fields: Record<string, unknown>): D;

  /** A new instance. Only valid without a source instance. */
  create(): D {
    if (this.source !== undefined) {
      throw new Errors.ValueError("create() is only valid without a source instance; use clone() or update()");
    }
    return this.make(this.fields);
  }

  /** A new instance, leaving the source instance untouched. Only valid with a source instance. */
  clone(): D {
    if (this.source === undefined) throw new Errors.ValueError("clone() is only valid with a source instance");
    return this.make(this.fields);
  }

  /** Writes the builder's state into the source instance and returns it. Only valid with a source instance. */
  update(): D {
    if (this.source === undefined) throw new Errors.ValueError("update() is only valid with a source instance");
    return Object.assign(this.source, this.fields);
  }
}

// --- Predicates ---

/** A named rule over symbols, each bound to an object of its schema in a match. */
class PredicateData {
  readonly #identity = `predicate ${++made}`;
  name: string | null;
  description: string | null;
  symbols: Symbols;
  rule: Rule | null;

  constructor(fields: { name?: string | null; description?: string | null; symbols?: Symbols; rule?: Rule | null } = {}) {
    this.name = fields.name ?? null;
    this.description = fields.description ?? null;
    this.symbols = fields.symbols ?? new Map();
    this.rule = fields.rule ?? null;
  }

  validate(): string[] {
    const label = `predicate ${repr(this.name)}`;
    const problems = ([["name", this.name], ["rule", this.rule]] as const).filter(([, value]) => value === null)
      .map(([what]) => `${label}: a predicate needs a ${what}`);
    if (this.symbols.size === 0) problems.push(`${label}: a predicate needs at least one symbol`);
    for (const [symbol, schema] of this.symbols) {
      if (!(schema instanceof Schemas.OfObject.Data && schema.ref && schema.name !== null)) {
        problems.push(`${label}: symbol ${repr(symbol)} needs a named reference object schema`);
      }
    }
    const rule = this.rule === null ? [] : this.rule.validate({ bound: [...this.symbols.keys()], core: true });
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
    Bindings.accept(Builders.predicate, this, visitor);
  }
}

class PredicateBuilder extends Builder<PredicateData> {
  protected make(fields: Record<string, unknown>): PredicateData {
    return new PredicateData(fields as ConstructorParameters<typeof PredicateData>[0]);
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
    const added = symbols instanceof Map ? [...symbols] : Object.entries(symbols);
    this.fields["symbols"] = new Map([...((this.fields["symbols"] as Symbols | undefined) ?? []), ...added]);
    return this;
  }

  /** The rule, a Basic `Spec` whose free names are the symbols. */
  rule(spec: unknown): this {
    this.fields["rule"] = Expressions.OfAny.resolve(spec);
    return this;
  }
}

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

// --- Sets ---

/** Predicates, in order. */
class SetData {
  readonly #identity = `set ${++made}`;
  predicates: readonly PredicateData[];

  constructor(fields: { predicates?: readonly PredicateData[] } = {}) {
    this.predicates = Object.freeze([...(fields.predicates ?? [])]);
  }

  /** Every predicate's problems, and each name two predicates share. */
  validate(): string[] {
    const problems: string[] = [];
    const seen = new Set<string | null>();
    for (const predicate of this.predicates) {
      problems.push(...predicate.validate());
      if (seen.has(predicate.name)) problems.push(`predicate ${repr(predicate.name)}: defined twice`);
      seen.add(predicate.name);
    }
    return problems;
  }

  identity(): unknown {
    return this.#identity;
  }

  schema_name(): string {
    return SET;
  }

  owner(): null {
    return null;
  }

  accept(visitor: OfObject): void {
    Bindings.accept(SET_BINDING, this, visitor);
  }
}

class SetBuilder extends Builder<SetData> {
  protected make(fields: Record<string, unknown>): SetData {
    return new SetData(fields as ConstructorParameters<typeof SetData>[0]);
  }

  /** Predicates, each a `Data` or a callable taking a predicate builder, added in order. */
  predicates(...specs: OfPredicate.Spec[]): this {
    this.fields["predicates"] = [...((this.fields["predicates"] as PredicateData[] | undefined) ?? []), ...specs.map(OfPredicate.resolve)];
    return this;
  }
}

export namespace OfSet {
  /** A set of predicates. */
  export const Data = SetData;
  export type Data = SetData;
  export const Builder = SetBuilder;
  export type Builder = SetBuilder;
  /** The meta-schema of a set. */
  export const Schema = new Schemas.OfObject.Builder().name(SET).ref()
    .relations((r: any) => r.name("predicates").of(Members).me("set")).create();
}

// --- Reading and writing ---

function linked(entry: Bindings.Entry, link: string, isKind: (value: unknown) => boolean, what: string): any {
  const target = entry.links.get(link);
  if (target === null || target === undefined) throw new Errors.ValueError(`link ${repr(link)} is not set`);
  if (!isKind(target)) throw new TypeError(`${what} must be ${what === "a rule" ? "a Basic expression" : "a predicate"}`);
  return target;
}

const isRule = (value: unknown) => Expressions.DIALECT.classes.some((kind) => value instanceof kind);

function readPredicate(predicate: PredicateData): Bindings.State {
  const values = new Map<string, unknown>();
  for (const name of ["name", "description"] as const) if (predicate[name] !== null) values.set(name, predicate[name]);
  if (predicate.symbols.size > 0) {
    values.set("symbols", [...predicate.symbols].map(([symbol, schema]) =>
      new Map<string, unknown>([["name", symbol], ["type", Modules.reference(schema)]])));
  }
  const rule = predicate.rule === null ? [] : [new Bindings.Entry(new Map([["argument", predicate.rule]]), new Map([["index", 0n]]))];
  return new Bindings.State(values, new Map([["rule", rule]]));
}

function readSet(predicates: SetData): Bindings.State {
  return new Bindings.State(new Map(), new Map([["predicates", predicates.predicates.map((p, i) =>
    new Bindings.Entry(new Map([["predicate", p]]), new Map([["index", BigInt(i)]])))]]));
}

function makePredicate(store: Stores.Store, state: Bindings.State): PredicateData {
  const rules = state.entries.get("rule") ?? []; // none yet while a snapshot is read: its entries come after its objects
  if (rules.length > 1) throw new Errors.ValueError(`a predicate has one rule, got ${rules.length}`);
  const rule = rules.length > 0 ? linked(rules[0] as Bindings.Entry, "argument", isRule, "a rule") : null;
  const symbols: Symbols = new Map(((state.values.get("symbols") as PlainMap[] | undefined) ?? []).map((symbol) =>
    [symbol.get("name") as string, Modules.resolve(store, symbol.get("type") as PlainMap)]));
  return new PredicateData({ name: (state.values.get("name") as string | undefined) ?? null,
    description: (state.values.get("description") as string | undefined) ?? null, symbols, rule });
}

function makeSet(state: Bindings.State): SetData {
  const entries = state.entries.get("predicates") ?? [];
  const last = BigInt(entries.length);
  const index = (entry: Bindings.Entry) => (entry.properties.get("index") as bigint | undefined) ?? last;
  const ordered = [...entries].sort((a, b) => (index(a) < index(b) ? -1 : index(a) > index(b) ? 1 : 0));
  return new SetData({ predicates: ordered.map((entry) => linked(entry, "predicate", (value) => value instanceof PredicateData, "a member")) });
}

function assign<T extends object>(make: (state: Bindings.State) => T): (instance: T, state: Bindings.State) => T {
  return (instance, state) => Object.assign(instance, make(state));
}

const SET_BINDING = new Bindings.Binding(OfSet.Schema, readSet, makeSet, assign(makeSet));

/** Basic's kinds, as `Bindings.OfStore` takes them. */
function basic(): (readonly [Schemas.OfObject.Data, (instance?: any) => unknown])[] {
  const dialect = Expressions.DIALECT;
  return dialect.classes.map((kind) => {
    const builder = dialect.builders.get(kind.KIND) as new (instance?: unknown) => unknown;
    return [kind.Schema, (instance?: unknown) => new builder(instance)] as const;
  });
}

/** A store of predicates, sets and Basic's expressions as their bound classes, reading the symbols' schemas by name in
 * `store`: what snapshots of predicates are read into, and written from. */
export class OfStore extends Bindings.OfStore {
  declare readonly predicate: Bindings.Binding;

  constructor(store: Stores.Store) {
    const make = (state: Bindings.State) => makePredicate(store, state);
    const predicate = new Bindings.Binding(OfPredicate.Schema, readPredicate, make, assign(make), { implied: ["sets"] });
    super([[OfSet.Schema, (instance?: SetData) => new Bindings.Builder(SET_BINDING, instance)],
      [OfPredicate.Schema, (instance?: PredicateData) => new Bindings.Builder(predicate, instance)], ...basic()],
    [Terms.Arguments, Members]);
    (this as { predicate: Bindings.Binding }).predicate = predicate;
  }
}

/** A store of the predicates' bound classes that resolves no names: it writes any predicate, and reads those whose
 * symbols' schemas are inline. */
export const Builders = new OfStore(new Stores.Catalog() as unknown as Stores.Store); // it only looks names up

/** Registers the meta-schemas of predicates and sets, and Basic's, in `store` (e.g. a `Proxies.OfStore`), skipping
 * those it already holds. Returns the store. */
export function register<S extends Stores.Store & { register(schema: never): void }>(store: S): S {
  Expressions.DIALECT.register(store);
  for (const schema of [OfPredicate.Schema, OfSet.Schema, Members]) {
    if (!store.names().includes(schema.name as string)) store.register(schema as never);
  }
  return store;
}

/** A set of `predicates`, throwing `ValueError` with every problem `validate()` reports. */
export function check(predicates: Iterable<OfPredicate.Spec> | SetData): SetData {
  const result = predicates instanceof SetData ? predicates : new SetBuilder().predicates(...predicates).create();
  const problems = result.validate();
  if (problems.length > 0) throw new Errors.ValueError(problems.join("; "));
  return result;
}
