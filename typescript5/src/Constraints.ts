/**
 * Constraints: rules about a schema's objects, kept as data beside the schemas.
 *
 * A `Constraint` is a named Basic rule about the instances of one schema, evaluated with `this` bound to the instance:
 * "a contact has at least one phone" is `new Constraint("Contact", "has-phone", count(entries(this, 'phones')) >= 1)`.
 * A `Set` gathers constraints, of any schemas, in order. Schemas stay untouched: several sets may constrain one schema,
 * and a set names schemas by the names a store registers them under.
 *
 * Constraints and sets are mbse-schemas reference objects, bound to their meta-schemas (`Constraint.Schema`,
 * `Set.Schema`), so a set is stored, sent and validated like any data. A constraint is its rule's parent through
 * Basic's own relation `Expressions.Arguments`, as an operation is its arguments'; a set holds its constraints through
 * `Patterns.Members`, by index. `Builders` is the store of their bound classes and Basic's, so that
 * `JSON.FromJSON(Builders).Reachable(Set.Schema, text)` reads a set back with its rules; `register(store)` registers
 * the meta-schemas, and Basic's, in another store.
 *
 * `validate()` checks constraints statically: a name and a schema name, and a rule that is a core Basic expression
 * whose only free name is `this`; and, in a set, no two constraints of one schema with the same name. Evaluating
 * constraints is `Validators`' work, and selecting objects by a rule is `Queries`'.
 */

import { Expressions } from "@mbse/expressions";
import { Terms } from "@mbse/expressions/Framework";
import { Bindings, Errors, Schemas, Stores } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { OfObject } from "@mbse/schemas/Framework/Visitors";

export const CONSTRAINT = "Patterns.Constraint";
export const SET = "Patterns.Set";
export const MEMBERS = "Patterns.Members";

const text = (name: string) => (p: any) => p.name(name).of((t: any) => t.as_native(String));

/** The relation of a set to its constraints, each at its `index` in the set. */
export const Members = new Schemas.OfRelation.Builder().links("set", "constraint").properties(
  (p: any) => p.name("index").of((t: any) => t.as_native(BigInt))).create();

/** Identities are strings, unique per object, as mbse-schemas keys them. */
let made = 0;

/** A Basic expression, as constraints hold their rules. */
type Rule = Expressions.OfAny.Data;

/** A named rule about the instances of the schema registered as `schema`, with `this` bound to the instance. */
export class Constraint {
  static readonly Schema = new Schemas.OfObject.Builder().ref().properties(text("schema"), text("name"), text("description"))
    .relations((r: any) => r.name("rule").of(Terms.Arguments).me("parent"),
      (r: any) => r.name("sets").of(Members).me("constraint")).create();

  rule: Rule | null;
  readonly #identity = `constraint ${++made}`;

  constructor(public schema: string, public name: string, rule: unknown, public description: string | null = null) {
    this.rule = rule === null || rule === undefined ? null : Expressions.OfAny.resolve(rule);
  }

  /** Static problems: a missing schema name, name or rule, and the rule's problems as a core Basic rule about
   * `this`. */
  validate(): string[] {
    const label = `constraint ${repr(this.name)} of ${repr(this.schema)}`;
    const problems = ([["schema", this.schema], ["name", this.name], ["rule", this.rule]] as const)
      .filter(([, value]) => !value).map(([what]) => `${label}: a constraint needs a ${what}`);
    const rule = this.rule === null ? [] : this.rule.validate({ bound: ["this"], core: true });
    return [...problems, ...rule.map((problem) => `${label}: ${problem}`)];
  }

  identity(): unknown {
    return this.#identity;
  }

  schema_name(): string {
    return CONSTRAINT;
  }

  owner(): null {
    return null;
  }

  accept(visitor: OfObject): void {
    Bindings.accept(CONSTRAINT_BINDING, this, visitor);
  }
}

/** Constraints, of any schemas, in order. */
export class Set {
  static readonly Schema = new Schemas.OfObject.Builder().ref()
    .relations((r: any) => r.name("constraints").of(Members).me("set")).create();

  readonly constraints: readonly Constraint[];
  readonly #identity = `set ${++made}`;

  constructor(constraints: Iterable<Constraint> = []) {
    this.constraints = Object.freeze([...constraints]);
  }

  /** The constraints of the schema registered as `schema`, in order. */
  of(schema: string): readonly Constraint[] {
    return this.constraints.filter((c) => c.schema === schema);
  }

  /** Every constraint's problems, and each name a schema's constraints share. */
  validate(): string[] {
    const problems: string[] = [];
    const seen = new globalThis.Set<string>();
    for (const constraint of this.constraints) {
      problems.push(...constraint.validate());
      const key = JSON.stringify([constraint.schema, constraint.name]);
      if (seen.has(key)) problems.push(`constraint ${repr(constraint.name)} of ${repr(constraint.schema)}: defined twice`);
      seen.add(key);
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

function linked(entry: Bindings.Entry, link: string, isKind: (value: unknown) => boolean, what: string): any {
  const target = entry.links.get(link);
  if (target === null || target === undefined) throw new Errors.ValueError(`link ${repr(link)} is not set`);
  if (!isKind(target)) throw new TypeError(`${what} must be ${what === "a rule" ? "a Basic expression" : "a constraint"}`);
  return target;
}

const isRule = (value: unknown) => Expressions.DIALECT.classes.some((kind) => value instanceof kind);

function makeConstraint(state: Bindings.State): Constraint {
  const rules = state.entries.get("rule") ?? []; // none yet while a snapshot is read: its entries come after its objects
  if (rules.length > 1) throw new Errors.ValueError(`a constraint has one rule, got ${rules.length}`);
  const rule = rules.length > 0 ? linked(rules[0] as Bindings.Entry, "argument", isRule, "a rule") : null;
  const values = state.values;
  return new Constraint((values.get("schema") as string | undefined) ?? "", (values.get("name") as string | undefined) ?? "",
    rule, (values.get("description") as string | undefined) ?? null);
}

function makeSet(state: Bindings.State): Set {
  const entries = state.entries.get("constraints") ?? [];
  const last = BigInt(entries.length);
  const index = (entry: Bindings.Entry) => (entry.properties.get("index") as bigint | undefined) ?? last;
  const ordered = [...entries].sort((a, b) => (index(a) < index(b) ? -1 : index(a) > index(b) ? 1 : 0));
  return new Set(ordered.map((entry) => linked(entry, "constraint", (value) => value instanceof Constraint, "a member")));
}

function readConstraint(constraint: Constraint): Bindings.State {
  const values = new Map<string, unknown>([["schema", constraint.schema], ["name", constraint.name]]);
  if (constraint.description !== null) values.set("description", constraint.description);
  const rule = constraint.rule === null ? [] : [new Bindings.Entry(new Map([["argument", constraint.rule]]), new Map([["index", 0n]]))];
  return new Bindings.State(values, new Map([["rule", rule]]));
}

function readSet(constraints: Set): Bindings.State {
  return new Bindings.State(new Map(), new Map([["constraints", constraints.constraints.map((c, i) =>
    new Bindings.Entry(new Map([["constraint", c]]), new Map([["index", BigInt(i)]])))]]));
}

function assign<T extends object>(make: (state: Bindings.State) => T): (instance: T, state: Bindings.State) => T {
  return (instance, state) => Object.assign(instance, make(state));
}

const CONSTRAINT_BINDING = new Bindings.Binding(Constraint.Schema, readConstraint, makeConstraint, assign(makeConstraint),
  { implied: ["sets"] });
const SET_BINDING = new Bindings.Binding(Set.Schema, readSet, makeSet, assign(makeSet));

const SCHEMAS = new Map<string, Schemas.OfObject.Data | Schemas.OfRelation.Data>([
  [CONSTRAINT, Constraint.Schema], [SET, Set.Schema], [MEMBERS, Members]]);

/** Basic's kinds, as `Bindings.OfStore` takes them. */
function basic(): [string, readonly [Schemas.OfObject.Data, (instance?: any) => unknown]][] {
  const dialect = Expressions.DIALECT;
  return dialect.classes.map((kind) => {
    const builder = dialect.builders.get(kind.KIND) as new (instance?: unknown) => unknown;
    return [kind.NAME, [kind.Schema, (instance?: unknown) => new builder(instance)] as const];
  });
}

/** A store of constraints, sets and Basic's expressions, as their bound classes: what snapshots of sets are read
 * into. */
export const Builders = new Bindings.OfStore(new Map<string, readonly [Schemas.OfObject.Data, (instance?: any) => unknown]>([
  [SET, [Set.Schema, (instance?: Set) => new Bindings.Builder(SET_BINDING, instance)]],
  [CONSTRAINT, [Constraint.Schema, (instance?: Constraint) => new Bindings.Builder(CONSTRAINT_BINDING, instance)]],
  ...basic()]), new Map([[Terms.ARGUMENTS, Terms.Arguments], [MEMBERS, Members]]));

/** Registers the meta-schemas of constraints and sets, and Basic's, in `store` (e.g. a `Proxies.OfStore`), skipping
 * those it already holds. Returns the store. */
export function register<S extends Stores.Store & { register(name: string, schema: unknown): void }>(store: S): S {
  Expressions.DIALECT.register(store);
  for (const [name, schema] of SCHEMAS) {
    if (!store.names().includes(name)) store.register(name, schema);
  }
  return store;
}

/** A set of `constraints`, throwing `ValueError` with every problem `validate()` reports. */
export function check(constraints: Iterable<Constraint> | Set): Set {
  const result = constraints instanceof Set ? constraints : new Set(constraints);
  const problems = result.validate();
  if (problems.length > 0) throw new Errors.ValueError(problems.join("; "));
  return result;
}
