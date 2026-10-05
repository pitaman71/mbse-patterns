/**
 * Constraints: sets of predicates, kept as data beside the schemas.
 *
 * A set, `OfSet`, gathers predicates (see `Predicates`) in order, and is built as they are, by a fluent builder:
 * `new OfSet.Builder().predicates(HasAPhone, (p) => p.name(...)...)`. Nothing validates until asked: `validate()`
 * reports each predicate's problems (a missing name or rule, a symbol whose schema is not a named reference object
 * schema, the rule's problems as a rule of the algebra whose free names are the symbols) and two predicates with one
 * name; `check` throws with them.
 *
 * Sets are mbse-schemas reference objects with a meta-schema (`Patterns.Set`), so a set is stored and sent like any
 * data: it holds its predicates through `Patterns.Members`, by index. Writing needs no store; reading resolves the
 * symbols' schemas by name, so it goes through `OfStore(store)`, a store of the predicates' bound classes and the
 * algebra's that resolves names in `store`; `Builders` is one that resolves none, which writes any predicate and reads
 * those whose symbols' schemas are inline. `register(store)` registers the meta-schemas, and the algebra's, in another
 * store.
 */

import { Terms } from "@mbse/expressions/Framework";
import { Bindings, Errors, Schemas, Stores } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { OfObject } from "@mbse/schemas/Framework/Visitors";

import * as Predicates from "./Predicates.js";

export const SET = "Patterns.Set";
/** Identities are strings, unique per object, as mbse-schemas keys them. */
let made = 0;

/** Shared builder mechanics, as mbse-schemas' builders have them. */
abstract class Builder<D extends object> {
  protected readonly fields: Record<string, unknown>;

  constructor(private readonly source?: D) {
    this.fields = source === undefined ? {} : { ...source };
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

// --- Sets ---

/** Predicates, in order. */
class SetData {
  readonly #identity = `set ${++made}`;
  predicates: readonly Predicates.OfPredicate.Data[];

  constructor(fields: { predicates?: readonly Predicates.OfPredicate.Data[] } = {}) {
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
  predicates(...specs: Predicates.OfPredicate.Spec[]): this {
    this.fields["predicates"] = [...((this.fields["predicates"] as Predicates.OfPredicate.Data[] | undefined) ?? []), ...specs.map(Predicates.OfPredicate.resolve)];
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
    .relations((r: any) => r.name("predicates").of(Predicates.Members).me("set")).create();
}

// --- Reading and writing ---

function readSet(predicates: SetData): Bindings.State {
  return new Bindings.State(new Map(), new Map([["predicates", predicates.predicates.map((p, i) =>
    new Bindings.Entry(new Map([["predicate", p]]), new Map([["index", BigInt(i)]])))]]));
}

function makeSet(state: Bindings.State): SetData {
  const entries = state.entries.get("predicates") ?? [];
  const last = BigInt(entries.length);
  const index = (entry: Bindings.Entry) => (entry.properties.get("index") as bigint | undefined) ?? last;
  const ordered = [...entries].sort((a, b) => (index(a) < index(b) ? -1 : index(a) > index(b) ? 1 : 0));
  return new SetData({ predicates: ordered.map((entry) => Predicates.target(entry, "predicate", (value) => value instanceof Predicates.OfPredicate.Data, "a member")) });
}

function assign<T extends object>(make: (state: Bindings.State) => T): (instance: T, state: Bindings.State) => T {
  return (instance, state) => Object.assign(instance, make(state));
}

const SET_BINDING = new Bindings.Binding(OfSet.Schema, readSet, makeSet, assign(makeSet));

/** The predicate algebra's kinds, Basic's included, as `Bindings.OfStore` takes them. */
function basic(): (readonly [Schemas.OfObject.Data, (instance?: any) => unknown])[] {
  const dialect = Predicates.DIALECT;
  return dialect.classes.map((kind) => {
    const builder = dialect.builders.get(kind.KIND) as new (instance?: unknown) => unknown;
    return [kind.Schema, (instance?: unknown) => new builder(instance)] as const;
  });
}

/** A store of predicates, sets and the algebra's expressions as their bound classes, reading the symbols' schemas by name in
 * `store`: what snapshots of predicates are read into, and written from. */
export class OfStore extends Bindings.OfStore {
  declare readonly predicate: Bindings.Binding;

  constructor(store: Stores.Store) {
    const predicate = Predicates.binding(store);
    super([[OfSet.Schema, (instance?: SetData) => new Bindings.Builder(SET_BINDING, instance)],
      [Predicates.OfPredicate.Schema, (instance?: Predicates.OfPredicate.Data) => new Bindings.Builder(predicate, instance)], ...basic()],
    [Terms.Arguments, Predicates.Members]);
    (this as { predicate: Bindings.Binding }).predicate = predicate;
  }
}

/** A store of the predicates' bound classes that resolves no names: it writes any predicate, and reads those whose
 * symbols' schemas are inline. */
export const Builders = new OfStore(new Stores.Catalog() as unknown as Stores.Store); // it only looks names up

/** Registers the meta-schemas of predicates and sets, and the algebra's (Basic's included), in `store` (e.g. a
 * `Proxies.OfStore`), skipping those it already holds. Returns the store. */
export function register<S extends Stores.Store & { register(schema: never): void }>(store: S): S {
  Predicates.DIALECT.register(store);
  for (const schema of [Predicates.OfPredicate.Schema, OfSet.Schema, Predicates.Members]) {
    if (!store.names().includes(schema.name as string)) store.register(schema as never);
  }
  return store;
}

/** A set of `predicates`, throwing `ValueError` with every problem `validate()` reports. */
export function check(predicates: Iterable<Predicates.OfPredicate.Spec> | SetData): SetData {
  const result = predicates instanceof SetData ? predicates : new SetBuilder().predicates(...predicates).create();
  const problems = result.validate();
  if (problems.length > 0) throw new Errors.ValueError(problems.join("; "));
  return result;
}
