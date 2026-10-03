/**
 * Queries: a predicate as a query over a store's objects, whose matches stream lazily.
 *
 * `QueryableStore` is the protocol: an mbse-schemas store (`Stores.Store`) that also answers
 * `select(predicate, variables = null, unknown = false)`, an iterator over the predicate's matches among the store's
 * data for which its rule holds. A match maps each symbol to an object of the symbol's schema, from the schema's extent
 * (what the store's singletons reach: objects the program built but never linked to the store's data are not found); a
 * predicate without symbols has one match, empty, when it holds.
 * `variables` binds the rule's other names; `unknown` also yields the matches for which the rule is unknown. The
 * predicate is checked when `select` is called, which throws for one that cannot be a query; the extents are read only
 * as matches are asked for.
 *
 * The matches are the cross product of the symbols' extents, filtered by the rule; how they are found is the
 * implementation's to choose from the rule's shape. `Scan(store)` makes any store queryable, in memory, delegating
 * every `Stores.Store` method to it, and plans each query:
 *
 * - The rule's top-level conjuncts (`and`) are tested as soon as the symbols they read are bound, so a match that fails
 *   one is never extended; those that read no symbol, only variables, are tested once, first.
 * - A conjunct `linked(a, 'adjacency', b)`, or `any(e in entries(a, 'adjacency'), e.link == b)`, relates two symbols
 *   through a relation: `b`'s candidates are then the targets of `a`'s entries, not `b`'s whole extent. When one of the
 *   relation's `unique` clauses makes `a`'s end determine the entry, there is at most one, and the hop is taken first.
 * - A symbol no hop reaches is scanned. Symbols that a hop from another could reach are scanned last, so that the hop
 *   is taken instead; otherwise symbols are scanned in their declared order.
 *
 * `Scan.explain(predicate, variables)` describes the plan, one line per symbol. A store that can answer natively (a
 * database) implements `select` itself. `select(store, ...)` asks a queryable store, and scans any other.
 */

import { Expressions as E } from "@mbse/expressions";
import { Symbolics } from "@mbse/expressions/Framework";
import { Errors, Schemas, Stores, Validators as SchemaValidators } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import type * as Constraints from "./Constraints.js";
import * as Predicates from "./Predicates.js";

/** Values for a rule's names other than the symbols. */
export type Variables = Record<string, unknown>;

/** A match: each symbol's object. */
export type Match = Record<string, Visitable>;

/** A store that answers queries. */
export interface QueryableStore extends Stores.Store {
  /** The predicate's matches for which its rule holds (or is unknown, with `unknown`), as they are read. */
  select(predicate: Constraints.OfPredicate.Data, variables?: Variables | null, unknown?: boolean): IterableIterator<Match>;
}

/** The rule's top-level conjuncts: the arguments of nested `and`s, or the rule itself. */
function conjuncts(rule: unknown): unknown[] {
  if (rule instanceof E.OfOperation.Data && rule.name === "and" && rule.arguments.length === 2) {
    return [...conjuncts(rule.arguments[0]), ...conjuncts(rule.arguments[1])];
  }
  return [rule];
}

function variable(node: unknown, names: { has(name: string): boolean }): string | null {
  return node instanceof E.OfVariable.Data && typeof node.name === "string" && names.has(node.name) ? node.name : null;
}

function textOf(node: unknown): string | null {
  return node instanceof E.OfLiteral.Data && typeof node.value === "string" ? node.value : null;
}

/** `target`'s candidates are the targets, through `link`, of `source`'s entries in `adjacency`. */
interface Hop {
  source: string;
  adjacency: string;
  link: string;
  target: string;
  functional: boolean;
}

/** The link and whether the hop is functional, for a hop from `source` through `adjacency`, if there is one. */
function declaredHop(schemas: ReadonlyMap<string, Schemas.OfObject.Data>, source: string, adjacency: string | null,
  link: string | null): [string, boolean] | null {
  const declared = (schemas.get(source) as Schemas.OfObject.Data).adjacencies.get(adjacency ?? "");
  if (declared === undefined || declared.relation === null) return null;
  const relation = declared.relation;
  const others = relation.links.filter((other) => other !== declared.me);
  const chosen = link ?? (others.length === 1 ? (others[0] as string) : null);
  if (chosen === null || !others.includes(chosen)) return null;
  const fields = [...relation.links, ...relation.properties.keys()];
  return [chosen, relation.uniques.some((unique) => fields.every((field) => unique.has(field) || field === declared.me))];
}

/** The hop a conjunct `linked(a, 'adjacency', b)` or `any(e in entries(a, 'adjacency'), e.link == b)` makes from `a`
 * to `b`, if it is one. */
function hopOf(conjunct: unknown, schemas: ReadonlyMap<string, Schemas.OfObject.Data>): Hop | null {
  if (conjunct instanceof Predicates.OfLinked) {
    const [source, target] = [variable(conjunct.source, schemas), variable(conjunct.target, schemas)];
    const found = source === null || target === null || source === target ? null
      : declaredHop(schemas, source, conjunct.adjacency as string, conjunct.link as string | null);
    return found === null ? null
      : { source: source as string, adjacency: conjunct.adjacency as string, link: found[0], target: target as string, functional: found[1] };
  }
  if (!(conjunct instanceof E.OfQuantifier.Data && conjunct.quantifier === "any")) return null;
  const [collection, body, item] = [conjunct.collection, conjunct.body, conjunct.name as string];
  if (!(collection instanceof E.OfOperation.Data && collection.name === "entries" && collection.arguments.length === 2
    && body instanceof E.OfOperation.Data && body.name === "eq" && body.arguments.length === 2)) return null;
  const [source, adjacency] = [variable(collection.arguments[0], schemas), textOf(collection.arguments[1])];
  for (const [get, other] of [body.arguments, [...body.arguments].reverse()] as unknown[][]) {
    const target = variable(other, schemas);
    if (get instanceof E.OfOperation.Data && get.name === "get" && get.arguments.length === 2
      && variable(get.arguments[0], new Set([item])) !== null && source !== null && target !== null
      && target !== source && target !== item) {
      const link = textOf(get.arguments[1]);
      const found = link === null ? null : declaredHop(schemas, source, adjacency, link);
      return found === null ? null : { source, adjacency: adjacency as string, link: found[0], target, functional: found[1] };
    }
  }
  return null;
}

/** How a query finds its matches: an order of the symbols, each scanned or reached by a hop, and the conjuncts tested
 * once their symbols are bound. */
class Plan {
  readonly rule: unknown;
  readonly symbols: ReadonlyMap<string, Schemas.OfObject.Data>;
  readonly variables: Variables;
  readonly order: [string, Hop | null][] = [];
  readonly first: unknown[];
  readonly tests: unknown[][];

  constructor(readonly store: Stores.Store, predicate: Constraints.OfPredicate.Data, variables: Variables) {
    const symbols = new Map(predicate.symbols) as Map<string, Schemas.OfObject.Data>;
    for (const [symbol, schema] of symbols) {
      if (!(schema instanceof Schemas.OfObject.Data && schema.ref && schema.name !== null)) {
        throw new Errors.ValueError(`symbol ${repr(symbol)} needs a named reference object schema`);
      }
      store.schema(schema.name); // throws for a schema the store does not hold
    }
    for (const name of Object.keys(variables)) {
      if (symbols.has(name)) throw new Errors.ValueError(`${repr(name)} is a symbol; it is not a variable`);
    }
    const rule = Predicates.DIALECT.resolve(predicate.rule);
    const problems = Predicates.DIALECT.validate(rule, { bound: [...symbols.keys(), ...Object.keys(variables)], core: true });
    if (problems.length > 0) throw new Errors.ValueError(`the predicate cannot be a query: ${problems.join("; ")}`);
    this.symbols = symbols;
    this.variables = { ...variables };
    this.rule = rule;
    const parts = conjuncts(this.rule).map((c) => [c, [...Symbolics.free(c)].filter((name) => symbols.has(name))] as const);
    const hops = parts.map(([c]) => hopOf(c, symbols)).filter((hop): hop is Hop => hop !== null);
    const names = [...symbols.keys()];
    const bound = new Set<string>();
    while (bound.size < symbols.size) {
      const reachable = hops.filter((h) => bound.has(h.source) && !bound.has(h.target))
        .sort((a, b) => Number(!a.functional) - Number(!b.functional) || names.indexOf(a.target) - names.indexOf(b.target));
      const step = reachable[0] ?? null;
      let target: string;
      if (step !== null) target = step.target;
      else { // scan first what no hop from a symbol still to bind could reach instead
        const remaining = names.filter((s) => !bound.has(s));
        const reached = new Set(hops.filter((h) => remaining.includes(h.source)).map((h) => h.target));
        target = remaining.find((s) => !reached.has(s)) ?? (remaining[0] as string);
      }
      this.order.push([target, step]);
      bound.add(target);
    }
    const depth = (symbol: string) => this.order.findIndex(([s]) => s === symbol);
    this.first = parts.filter(([, free]) => free.length === 0).map(([c]) => c);
    this.tests = this.order.map((_, d) => parts.filter(([, free]) => free.length > 0 && Math.max(...free.map(depth)) === d).map(([c]) => c));
  }

  explain(): string[] {
    const count = (n: number) => `${n} ${n === 1 ? "test" : "tests"}`;
    const lines = this.first.length > 0 ? [`first ${count(this.first.length)}`] : [];
    this.order.forEach(([symbol, hop], d) => {
      const how = hop === null ? `scan ${(this.symbols.get(symbol) as Schemas.OfObject.Data).name}`
        : `${hop.source}.${hop.adjacency} to ${hop.link}, ${hop.functional ? "at most one" : "any number"}`;
      const tests = this.tests[d] as unknown[];
      lines.push(`${symbol}: ${how}${tests.length > 0 ? `, then ${count(tests.length)}` : ""}`);
    });
    return lines;
  }

  *matches(unknown: boolean): Generator<Match> {
    const evaluate = new Predicates.Evaluator(this.store); // reads each extent once, when first asked for
    const scope: Record<string, unknown> = { ...this.variables };
    if (this.first.some((test) => Predicates.holds(evaluate, test, scope) === false)) return;
    yield* this.extend(0, scope, evaluate, unknown);
  }

  private candidates(symbol: string, hop: Hop | null, scope: Record<string, unknown>, evaluate: Predicates.Evaluator): Visitable[] {
    const name = (this.symbols.get(symbol) as Schemas.OfObject.Data).name as string;
    if (hop === null) return [...evaluate.extent(name)];
    const found = new Map<unknown, Visitable>();
    for (const entry of SchemaValidators.entries_of(scope[hop.source] as Visitable).get(hop.adjacency) ?? []) {
      const target = entry.targets.get(hop.link);
      if (target !== undefined && target.schema_name() === name && !found.has(target.identity())) found.set(target.identity(), target);
    }
    return [...found.values()];
  }

  private *extend(depth: number, scope: Record<string, unknown>, evaluate: Predicates.Evaluator,
    unknown: boolean): Generator<Match> {
    if (depth === this.order.length) {
      const result = Predicates.holds(evaluate, this.rule, scope);
      if (result === true || (unknown && result === null)) {
        yield Object.fromEntries([...this.symbols.keys()].map((symbol) => [symbol, scope[symbol] as Visitable]));
      }
      return;
    }
    const [symbol, hop] = this.order[depth] as [string, Hop | null];
    for (const candidate of this.candidates(symbol, hop, scope, evaluate)) {
      const inner = { ...scope, [symbol]: candidate };
      if ((this.tests[depth] as unknown[]).every((test) => Predicates.holds(evaluate, test, inner) !== false)) {
        yield* this.extend(depth + 1, inner, evaluate, unknown);
      }
    }
  }
}

/** A queryable store over any store, answering queries by the plan the predicate's rule allows. */
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

  random(): Stores.Random {
    return this.store.random();
  }

  select(predicate: Constraints.OfPredicate.Data, variables: Variables | null = null, unknown = false): Generator<Match> {
    return new Plan(this.store, predicate, variables ?? {}).matches(unknown);
  }

  /** The plan of a query, one line per symbol: how its candidates are found, and the tests then made. */
  explain(predicate: Constraints.OfPredicate.Data, variables: Variables | null = null): string[] {
    return new Plan(this.store, predicate, variables ?? {}).explain();
  }
}

/** `store.select(...)` for a queryable store, and a scan of any other. */
export function select(store: Stores.Store, predicate: Constraints.OfPredicate.Data, variables: Variables | null = null,
  unknown = false): IterableIterator<Match> {
  const queryable = "select" in store && typeof (store as Partial<QueryableStore>).select === "function"
    ? store as QueryableStore : new Scan(store);
  return queryable.select(predicate, variables, unknown);
}
