/**
 * Queries: a rule as a query over a store's objects, whose matches stream lazily.
 *
 * `QueryableStore` is the protocol: an mbse-schemas store (`Stores.Store`) that also answers
 * `select(name, rule, variables = null, unknown = false)`, an iterator over the store's objects of the schema `name`
 * (its extent) for which `rule`, a Basic rule about `this`, holds. `variables` binds the rule's other names; `unknown`
 * also yields the objects for which the rule is unknown. The rule is checked when `select` is called, which throws for
 * one that cannot be right; the extent is read at the first match asked for, and each object only as the iterator
 * reaches it. A store's extents are its data, what its singletons reach (see mbse-schemas' Stores), so a query never
 * sees objects the program built but did not link to that data.
 *
 * `Scan(store)` makes any store queryable, in memory: it is the store, for every `Stores.Store` method, and answers a
 * query by streaming the extent through the rule, after evaluating what `variables` alone determine once
 * (`Partials`). It is the queryable form of `Proxies.OfStore` and `Bindings.OfStore`; a store that can answer natively
 * (a database) implements `select` itself. `select(store, ...)` asks a queryable store, and scans any other.
 */

import { Evaluators, Expressions, Partials } from "@mbse/expressions";
import { Errors, Schemas, Stores } from "@mbse/schemas/Framework";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

/** Values for a rule's names other than `this`. */
export type Variables = Record<string, unknown>;

/** A store that answers queries. */
export interface QueryableStore extends Stores.Store {
  /** The objects of the schema `name` for which `rule` holds (or is unknown, with `unknown`), as they are read. */
  select(name: string, rule: unknown, variables?: Variables | null, unknown?: boolean): IterableIterator<Visitable>;
}

function checked(store: Stores.Store, name: string, rule: unknown, variables: Variables): unknown {
  store.schema(name); // throws for an unknown name or a relation
  if ("this" in variables) throw new Errors.ValueError("'this' is bound to each object; it is not a variable");
  const resolved = Expressions.OfAny.resolve(rule);
  const problems = resolved.validate({ bound: ["this", ...Object.keys(variables)], core: true });
  if (problems.length > 0) throw new Errors.ValueError(`the rule cannot be a query: ${problems.join("; ")}`);
  return Partials.OfAny(resolved, variables);
}

function* matches(objects: () => Iterable<Visitable>, rule: unknown, variables: Variables, unknown: boolean): Generator<Visitable> {
  for (const value of objects()) { // the extent is read at the first match asked for, not when the query is made
    const result = Evaluators.OfAny(rule as Expressions.OfAny.Spec, { ...variables, this: value });
    if (result !== null && typeof result !== "boolean") throw new TypeError("a query's rule must give a bool");
    if (result === true || (unknown && result === null)) yield value;
  }
}

/** A queryable store over any store, answering queries by scanning its extents. */
export class Scan implements QueryableStore {
  constructor(readonly store: Stores.Store) {}

  schema(name: string): Schemas.OfObject.Data {
    return this.store.schema(name);
  }

  registered(name: string): Schemas.OfObject.Data | Schemas.OfRelation.Data {
    return this.store.registered(name);
  }

  name_of(schema: unknown): string {
    return this.store.name_of(schema);
  }

  names(): readonly string[] {
    return this.store.names();
  }

  builder(name: string, instance?: unknown): any {
    return this.store.builder(name, instance);
  }

  member(instance: unknown, name: string): unknown {
    return this.store.member(instance, name);
  }

  singleton(name: string): Visitable {
    return this.store.singleton(name);
  }

  extent(name: string): readonly Visitable[] {
    return this.store.extent(name);
  }

  select(name: string, rule: unknown, variables: Variables | null = null, unknown = false): Generator<Visitable> {
    const bound = { ...(variables ?? {}) };
    const residual = checked(this.store, name, rule, bound);
    return matches(() => this.store.extent(name), residual, bound, unknown);
  }
}

/** `store.select(...)` for a queryable store, and a scan of any other. */
export function select(store: Stores.Store, name: string, rule: unknown, variables: Variables | null = null,
  unknown = false): IterableIterator<Visitable> {
  const queryable = "select" in store && typeof (store as Partial<QueryableStore>).select === "function"
    ? store as QueryableStore : new Scan(store);
  return queryable.select(name, rule, variables, unknown);
}
