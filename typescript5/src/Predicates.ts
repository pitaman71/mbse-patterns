/**
 * Predicates: the predicate algebra, a dialect extending mbse-expressions' Basic with terms about a store's data.
 *
 * Basic's quantifiers range over collections; these range over a schema's objects in a store, and say how objects are
 * linked, so that mandatory, possible and forbidden links are predicates:
 *
 * - `extent(Schema)`: the schema's objects in the store (its extent: what the store's singletons reach);
 * - `forall(x, Schema, body)`, `exists(x, Schema, body)` and `count(x, Schema, body)`: quantifiers binding `x` to each
 *   object of `Schema` (their collection is an `extent`), whether the body holds for all, for some, or for how many;
 * - `linked(a, adjacency, b)`: whether one of `a`'s entries in `adjacency` links `b`, through the relation's other link
 *   (`linked(a, adjacency, b, link)` names the link, for a relation of more than two);
 * - `choice([weight, predicate], ...)`: a weighted disjunction of options, which holds when any of them holds; its
 *   weights, positive and summing to 1, are how often a generator chooses each option, and what a characterizer
 *   estimates.
 *
 *     const mandatory = forall("c", Contact, exists("p", Phone, linked(c, "phones", p)));
 *     const possible = forall("c", Contact, choice([0.35, owns], [0.65, owns.not_()]));
 *
 * The writers give Basic writers, so these terms combine with Basic's (`.and_()`, `.not_()`), and every Basic
 * expression is a predicate. `DIALECT` validates the trees that mix them; `new Evaluator(store).run(...)` evaluates
 * them, with the store giving extents and links, and Basic's three-valued rules for everything else.
 */

import { Domains as BasicDomains, Evaluators as Basic, Expressions as E } from "@mbse/expressions";
import { Evaluators as F, Terms } from "@mbse/expressions/Framework";
import { Schemas, Stores, Validators } from "@mbse/schemas/Framework";
import { Errors } from "@mbse/schemas/Framework";
import { repr, typeName } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

/** The objects of the schema named `schema` in the store. */
export class OfExtent extends Terms.Term {
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
  declare collection: any;
  declare body: any;

  constructor(name: unknown = null, collection: unknown = null, body: unknown = null) {
    super(name, collection, body);
  }
}

/** Whether the body holds for every object of the collection, with `name` bound to it. */
export class OfForall extends Quantified {
  static override KIND = "forall";
}

/** Whether the body holds for some object of the collection, with `name` bound to it. */
export class OfExists extends Quantified {
  static override KIND = "exists";
}

/** How many objects of the collection the body holds for, with `name` bound to each. */
export class OfCount extends Quantified {
  static override KIND = "count";
}

/** Whether one of `source`'s entries in `adjacency` links `target`, through `link` or the relation's other link. */
export class OfLinked extends Terms.Term {
  static override KIND = "linked";
  static override ROLE = Terms.APPLICATION;
  static override PROPERTIES = new Map<string, unknown>([["adjacency", String], ["link", String]]);
  static override OPTIONAL = new Set(["link"]);
  static override SLOTS = ["source", "target"];
  declare adjacency: unknown;
  declare link: unknown;
  declare source: any;
  declare target: any;

  constructor(adjacency: unknown = null, link: unknown = null, source: unknown = null, target: unknown = null) {
    super(adjacency, link, source, target);
  }
}

/** An option of a choice: its predicate, and its weight. */
export class OfOption extends Terms.Term {
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

const KINDS = [OfExtent, OfForall, OfExists, OfCount, OfLinked, OfChoice, OfOption];

/** The predicate algebra: Basic's kinds, and the kinds above. */
export const DIALECT = new Terms.Declared("Predicates", KINDS as unknown as Terms.TermClass[], {
  domain_of: BasicDomains.of, extends: E.DIALECT,
  schemaNames: new Map(KINDS.map((kind) => [kind.KIND, `Patterns.Of${kind.KIND[0]!.toUpperCase()}${kind.KIND.slice(1)}`])),
});

// --- Writers ---

function schemaName(schema: unknown): string {
  const name = typeof schema === "string" ? schema : (schema as { name?: unknown } | null)?.name;
  if (typeof name !== "string") throw new TypeError(`expected a named schema or its name, got ${repr(schema)}`);
  return name;
}

/** The objects of `schema` (a named schema, or its name) in the store. */
export function extent(schema: unknown): E.Writer {
  return E.writer(new OfExtent(schemaName(schema)));
}

function quantified(kind: new (name: unknown, collection: unknown, body: unknown) => Quantified, name: string, schema: unknown,
  body: unknown): E.Writer {
  return E.writer(new kind(name, new OfExtent(schemaName(schema)), DIALECT.resolve(body)));
}

/** Whether `body` holds for every object of `schema`, with `name` bound to it. */
export function forall(name: string, schema: unknown, body: unknown): E.Writer {
  return quantified(OfForall, name, schema, body);
}

/** Whether `body` holds for some object of `schema`, with `name` bound to it. */
export function exists(name: string, schema: unknown, body: unknown): E.Writer {
  return quantified(OfExists, name, schema, body);
}

/** How many objects of `schema` `body` holds for, with `name` bound to each. */
export function count(name: string, schema: unknown, body: unknown): E.Writer {
  return quantified(OfCount, name, schema, body);
}

/** Whether one of `source`'s entries in `adjacency` links `target`, through `link` or the relation's other link. */
export function linked(source: unknown, adjacency: string, target: unknown, link: string | null = null): E.Writer {
  return E.writer(new OfLinked(adjacency, link, DIALECT.resolve(source), DIALECT.resolve(target)));
}

/** A weighted disjunction: `choice([0.35, p], [0.65, q])` holds when `p` or `q` does. */
export function choice(...options: (readonly [number, unknown])[]): E.Writer {
  return E.writer(new OfChoice(options.map(([weight, body]) => new OfOption(weight, DIALECT.resolve(body)))));
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

/** Evaluates predicates over `store`: Basic's rules, with extents and links from the store. Extents are read once per
 * evaluator, so an evaluator sees the store as it was when first asked. */
export class Evaluator {
  readonly interpreter: F.Interpreter;
  readonly #extents = new Map<string, readonly Visitable[]>();

  constructor(readonly store: Stores.Store) {
    const quantifiers = Basic.QUANTIFIERS;
    this.interpreter = new F.Interpreter(DIALECT, new Map<string, unknown>([
      ["operation", Basic.OPERATIONS], ["quantifier", quantifiers],
      ["extent", (_: Thunk[], node: OfExtent) => this.extent(node.schema as string)],
      ["forall", quantifiers.get("all")], ["exists", quantifiers.get("any")], ["count", quantifiers.get("count")],
      ["linked", (thunks: Thunk[], node: OfLinked) => this.linked(thunks, node)],
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

  private linked(thunks: Thunk[], node: OfLinked): boolean | null {
    const [source, target] = [(thunks[0] as Thunk)(), (thunks[1] as Thunk)()] as [any, any];
    if (source === null || target === null) return null;
    for (const [value, what] of [[source, "source"], [target, "target"]] as const) {
      if (typeof value?.schema_name !== "function") throw new TypeError(`linked expects an object as its ${what}, got ${typeName(value)}`);
    }
    const declared = this.store.schema(source.schema_name()).adjacencies.get(node.adjacency as string);
    if (declared === undefined) throw new TypeError(`${repr(source.schema_name())} has no adjacency ${repr(node.adjacency)}`);
    const others = (declared.relation as Schemas.OfRelation.Data).links.filter((link) => link !== declared.me);
    if (node.link === null && others.length !== 1) {
      throw new Errors.ValueError(`linked needs a link for ${repr(node.adjacency)}, whose relation has links ${others.map((l) => repr(l)).join(", ")}`);
    }
    const link = (node.link ?? others[0]) as string;
    return (Validators.entries_of(source).get(node.adjacency as string) ?? [])
      .some((entry) => entry.targets.get(link)?.identity() === target.identity());
  }
}

/** The rule's value with `scope` bound: `true`, `false` or unknown (`null`); a rule that gives anything else throws. */
export function holds(evaluate: Evaluator, rule: unknown, scope: Record<string, unknown>): boolean | null {
  const result = evaluate.interpreter.run(rule, scope);
  if (result !== null && typeof result !== "boolean") throw new TypeError(`a predicate must be a bool, got ${typeName(result)}`);
  return result as boolean | null;
}
