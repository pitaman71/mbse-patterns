/**
 * Constraints: sets of predicates, and predicates and distributions as data.
 *
 * A set, `OfSet` (`Predicates.OfSet`), gathers predicates in order, and is built as they are, by a fluent builder:
 * `new OfSet.Builder().predicates(HasAPhone, (p) => p.name(...)...)`. Nothing validates until asked; `check` throws
 * with each predicate's problems, labelled by its name, and with a predicate of a set that has no name, or a name two
 * share.
 *
 * Predicates, sets and distributions are terms, mbse-schemas reference objects with meta-schemas, so they are stored and
 * sent like any data: a term is its arguments' parent through `Expressions.Arguments`, by index, and a predicate shared
 * by several terms is written once. Writing needs no store; reading resolves the symbols' schemas by name, so it goes
 * through `OfStore(store)`, a store of the terms' bound classes that resolves names in `store`; `Builders` is one that
 * resolves none, which writes any term and reads those whose symbols' schemas are inline. `register(store)` registers
 * the meta-schemas in another store.
 */

import { Terms } from "@mbse/expressions/Framework";
import { Bindings, Errors, Stores } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";

import * as Distributions from "./Distributions.js";
import * as Predicates from "./Predicates.js";

export const SET = Predicates.SET;
export const OfSet = Predicates.OfSet;
export type OfSet = Predicates.OfSet;

/** The builders of `kind`'s data, reading its symbols' schemas by name in `store`. */
function bound(kind: Terms.TermClass, store: Stores.Store): (instance?: unknown) => unknown {
  const binding = kind.BINDING;
  const groups = new Map([...binding.exclusive.values()].map((group) => [group.join("\u0000"), group]));
  const resolved = new Bindings.Binding(binding.schema, binding.read,
    (state) => Predicates.resolving(store, () => binding.make(state)),
    (instance, state) => Predicates.resolving(store, () => binding.assign(instance, state)),
    { fixed: binding.fixed, exclusive: groups.values(), implied: binding.implied });
  return (instance?: unknown) => new Bindings.Builder(resolved, instance);
}

/** A store of predicates, sets, distributions and the algebra's expressions as their bound classes, reading the
 * symbols' schemas by name in `store`: what snapshots of them are read into, and written from. */
export class OfStore extends Bindings.OfStore {
  constructor(store: Stores.Store) {
    super(Distributions.DIALECT.classes.map((kind) => [kind.Schema, bound(kind, store)] as const), [Terms.Arguments]);
  }
}

/** A store of the terms' bound classes that resolves no names: it writes any term, and reads those whose symbols'
 * schemas are inline. */
export const Builders = new OfStore(new Stores.Catalog() as unknown as Stores.Store); // it only looks names up

/** Registers the meta-schemas of predicates, sets and distributions, and the algebra's (Basic's included), in `store`
 * (e.g. a `Proxies.OfStore`), skipping those it already holds. Returns the store. */
export function register<S extends Stores.Store & { register(schema: never): void }>(store: S): S {
  return Distributions.DIALECT.register(store);
}

/** A set of `predicates`, each a predicate or a callable taking a predicate builder, throwing `ValueError` with every
 * problem: each predicate's, labelled by its name, a predicate without a name, and a name two predicates share. */
export function check(predicates: Iterable<Predicates.OfPredicate.Spec> | Predicates.OfSet): Predicates.OfSet {
  const result = predicates instanceof OfSet ? predicates : new OfSet.Builder().predicates(...predicates).create();
  const problems = result.check();
  const seen = new Set<unknown>();
  for (const predicate of (problems.length === 0 ? result.predicates : []) as Predicates.OfPredicate[]) {
    const label = `predicate ${repr(predicate.name)}`;
    if (predicate.name === null) problems.push(`${label}: a predicate of a set needs a name`);
    problems.push(...Predicates.DIALECT.validate(predicate, { core: true }).map((problem) => `${label}: ${problem}`));
    if (seen.has(predicate.name)) problems.push(`${label}: defined twice`);
    seen.add(predicate.name);
  }
  if (problems.length > 0) throw new Errors.ValueError(problems.join("; "));
  return result;
}
