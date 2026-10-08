/**
 * Transforms: rewrites applied step by step, one decision per step, every decision recorded.
 *
 * A transform is a rewrite with a precondition and a postcondition, in the shape of MLIR's pattern rewriting (see
 * docs/TRANSFORMS.md): its `before` and `after` are predicates over the same symbols; its `parameters` are
 * mbse-schemas' `OfParameter`s, each typed by its value domain; and its `rewrite(store, match, arguments)` changes the
 * store's data so that `after` holds for the match. A composite transform has `parts`, transforms of its own, instead
 * of a rewrite.
 *
 * A `Session` applies transforms to a store's data. A step is enabled for a match (each symbol bound to an object of
 * its schema, as `Queries.select` finds them) where `before` holds and `after` does not; where either is unknown the
 * match is undecided, and reported in `undecided`. A candidate is an enabled step with values for the parameters whose
 * domain is finite (a `bool`, or a union of options: branches that are value objects with no properties, whose values
 * are the branches' names), one candidate per combination; a parameter of any other domain stays open until answered
 * (`candidate.answer({ name: value })`). Candidates are ordered: those of transforms with parameters first, then by the
 * transforms' order, then by their matches (each object in the order the session first saw it), then by their
 * values' order in their domains. A session names each object by its path when it first sees it (mbse-schemas'
 * `Paths`: `Shelf/items[0]`, or a schema's name), and keeps the name and the order for the session, since a rewrite may
 * reorder an extent; a composite's session shares its parent's.
 *
 * `take(candidate)` takes one, as the caller decides; `step_in(candidate)` opens a composite's own session, scoped to
 * its match (its parts' matches agree with it on the symbols they share), whose steps the caller then takes; the
 * composite's step is recorded once that session is done. `step_over(policy)` takes the candidate the policy ranks
 * first, a composite as a whole, and `run(policy)` steps over until the session is done or the policy cannot decide. A
 * `Policy` only ranks: each of its clauses weighs the candidates of one transform that have the clause's arguments
 * (which also answer open parameters), so its ranking is a recommendation when the caller decides, and the decision
 * when the caller steps over. A candidate no clause weighs is not the policy's to take. Resolution is linear: after each
 * step, the candidates are found again, so taking one disables another that the step's rewrite made done.
 *
 * A step links the elements it matched and those its rewrite wrote, each in a role: a rewrite returns what it wrote, by
 * role, as a `Map` (`new Map([["class", built]])`; a mapping in Python), and any other value it returns is no record.
 * `step.match` and `step.wrote` are `Link`s, each its role, its path and, within the session, the element itself;
 * `session.wrote(element)` is the step that wrote an element. Each step is an object of `Transforms.Step`, whose
 * adjacencies `matched` and `wrote` are entries of the relations `Transforms.Matched` and `Transforms.Wrote`, each
 * linking the step to an element, with its role and path, and `steps`, of `Transforms.Within`, a composite's own steps;
 * `records(session)` is a store whose singleton `Transforms.Records` holds the steps taken, so that predicates query
 * them, combined with the session's store, as any other data.
 *
 * `session.trace(store)` writes the steps taken as data, a `Transforms.Trace` object in a store that `register`
 * prepared, which JSON and YAML write byte-identically in both implementations; `steps(store, trace)` reads them back.
 * A trace names elements by path alone, so that it holds no element itself: what a step matched by its path when the
 * session first saw it, what it wrote by its path when the trace is written, since later steps may move it.
 *
 * A rerun reuses decisions. A step's `key` is its transform and its match's paths (`Label(i=Shelf/items[0])`); a
 * session given `earlier` steps takes, before any policy, each candidate an earlier step with its key decided with the
 * same arguments, recorded as `reused` (a composite's own steps are reused inside it), so `run()` without a policy
 * takes only those. `orphans` are the earlier decisions not taken again whose key no candidate has. `diff(earlier,
 * later)` gives the steps added, removed and changed (the same key, other arguments), a composite's own steps under its
 * key.
 */

import { Bindings, Paths, Plain, Schemas } from "@mbse/schemas/Framework";
import { ValueError } from "@mbse/schemas/Framework/Errors";
import type { PlainData, PlainMap } from "@mbse/schemas/Framework/Plain";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Predicates from "./Predicates.js";
import * as Queries from "./Queries.js";

export const TRACE = "Transforms.Trace";
export const RECORDS = "Transforms.Records";

/** Each symbol's object. */
export type Match = Record<string, Visitable>;

/** A transform's rewrite: changes the store's data so that `after` holds for the match. */
export type Rewrite = (store: any, match: Match, args: Record<string, unknown>) => unknown;

/** The values of a finite domain, in order: a `bool`'s, or the names of a union's options; null for any other. */
function options(domain: unknown): readonly unknown[] | null {
  if (domain instanceof Schemas.OfNative.Data && domain.type === Boolean) return [false, true];
  if (domain instanceof Schemas.OfUnion.Data && domain.branches.length > 0 && domain.branches.every(
    (branch) => branch.type instanceof Schemas.OfObject.Data && branch.type.properties.size === 0)) {
    return domain.branches.map((branch) => branch.name);
  }
  return null;
}

function same(a: unknown, b: unknown): boolean {
  return typeof a === typeof b && a === b;
}

/** Whether the predicate holds for the match: true, false or unknown (null). */
function holds(evaluate: Predicates.Evaluator, predicate: Predicates.OfPredicate, match: Match): boolean | null {
  return Predicates.holds(evaluate, predicate.requires, { ...match });
}

export interface TransformOptions {
  parameters?: Iterable<Schemas.OfParameter.Spec>;
  rewrite?: Rewrite | null;
  parts?: Iterable<Transform>;
}

/** A rewrite: `before` and `after`, predicates over the same symbols; `parameters`, `OfParameter`s or their specs; and
 * either a `rewrite(store, match, arguments)` or `parts`, the transforms of a composite. */
export class Transform {
  readonly before: Predicates.OfPredicate;
  readonly after: Predicates.OfPredicate;
  readonly parameters: Map<string, Schemas.OfParameter.Data>;
  readonly rewrite: Rewrite | null;
  readonly parts: readonly Transform[];

  constructor(readonly name: string, before: unknown, after: unknown, options: TransformOptions = {}) {
    this.before = Predicates.OfPredicate.resolve(before);
    this.after = Predicates.OfPredicate.resolve(after);
    const built = [...(options.parameters ?? [])].map((spec) => spec instanceof Schemas.OfParameter.Data ? spec
      : spec(new Schemas.OfParameter.Builder()).create());
    this.parameters = new Map(built.map((parameter) => [parameter.name, parameter]));
    this.rewrite = options.rewrite ?? null;
    this.parts = [...(options.parts ?? [])];
  }

  /** The transform's problems, and its parts', each labelled by the transform's name. */
  check(): string[] {
    const problems = this.before.symbols.equals(this.after.symbols) ? [] : ["before and after must have the same symbols"];
    if ((this.rewrite === null) === (this.parts.length === 0)) problems.push("a transform has a rewrite or parts, one of them");
    return [...problems.map((problem) => `transform ${repr(this.name)}: ${problem}`), ...this.parts.flatMap((part) => part.check())];
  }
}

/** An enabled step: a transform, a match, values for its parameters, those still `open`, and the `score` a policy gave
 * it (0 without one). */
export class Candidate {
  readonly arguments: Record<string, unknown>;

  constructor(readonly transform: Transform, readonly match: Match, args: Record<string, unknown>,
    readonly open: readonly string[] = [], readonly score = 0, readonly key = "") {
    this.arguments = args;
  }

  /** The candidate with open parameters answered. */
  answer(values: Record<string, unknown>): Candidate {
    for (const name of Object.keys(values)) {
      if (!this.open.includes(name)) throw new TypeError(`${repr(this.transform.name)} has no open parameter ${repr(name)}`);
    }
    return new Candidate(this.transform, this.match, { ...this.arguments, ...values },
      this.open.filter((name) => !(name in values)), this.score, this.key);
  }

  /** Whether `other` is this candidate, its open parameters answered or not. */
  same(other: Candidate): boolean {
    const symbols = Object.keys(this.match);
    return other.transform === this.transform && Object.keys(other.match).length === symbols.length
      && symbols.every((symbol) => other.match[symbol] === this.match[symbol])
      && Object.entries(this.arguments).every(([name, value]) => name in other.arguments && same(other.arguments[name], value));
  }

  withScore(score: number): Candidate {
    return new Candidate(this.transform, this.match, this.arguments, this.open, score, this.key);
  }
}

/** A candidate's place in the canonical order, as text that sorts as it: parameters first, the transform's order, its
 * match's labels, its values' order in their domains, each number of ten digits. */
function key(numbers: readonly number[]): string {
  return numbers.map((n) => String(n).padStart(10, "0")).join(".");
}

/** A policy's clause: it weighs the candidates of the transform named `transform` that have its `arguments`; an
 * argument for an open parameter answers it. */
export class Clause {
  readonly arguments: Record<string, unknown>;

  constructor(readonly transform: string, args: Record<string, unknown> = {}, readonly weight = 1) {
    this.arguments = args;
  }

  applies(candidate: Candidate): boolean {
    return this.transform === candidate.transform.name && Object.entries(this.arguments).every(([name, value]) =>
      candidate.open.includes(name) || (name in candidate.arguments && same(candidate.arguments[name], value)));
  }
}

/** Ranks candidates by its clauses: a candidate's score is the sum of the weights of the clauses that apply to it. */
export class Policy {
  readonly clauses: readonly Clause[];

  constructor(...clauses: Clause[]) {
    this.clauses = clauses;
  }

  score(candidate: Candidate): number {
    return this.clauses.filter((clause) => clause.applies(candidate)).reduce((sum, clause) => sum + clause.weight, 0);
  }

  /** Values for the candidate's open parameters, from the first clause that applies and gives each. */
  answers(candidate: Candidate): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const clause of this.clauses) {
      if (!clause.applies(candidate)) continue;
      for (const [name, value] of Object.entries(clause.arguments)) {
        if (candidate.open.includes(name) && !(name in values)) values[name] = value;
      }
    }
    return values;
  }
}

/** A step's link to an element, in a role: a symbol of its match, or a role its rewrite wrote it in. Within the session,
 * `element` is the element itself; `path` names it (mbse-schemas' `Paths`), as a trace writes it, and is null for what
 * a step wrote until a trace is written. Links compare by role and path. */
export class Link {
  readonly #element: unknown;

  constructor(readonly role: string, readonly path: string | null = null, element: unknown = null) {
    this.#element = element;
  }

  get element(): any {
    return this.#element;
  }
}

let stepCount = 0;

/** A step taken: its transform's name, its match, its arguments, who decided it, a composite's mode and own steps, and
 * what it wrote. An object of `Transforms.Step`; steps compare by what they hold. */
export class Step {
  readonly arguments: readonly [string, unknown][];
  readonly #identity = `step ${++stepCount}`;

  constructor(readonly transform: string, readonly match: readonly Link[], args: readonly [string, unknown][],
    readonly by: string, readonly mode: string | null = null, readonly steps: readonly Step[] = [],
    readonly wrote: readonly Link[] = []) {
    this.arguments = args;
  }

  /** The choice it decided: its transform and its match, `Dataclass(s=Contact)`. */
  get key(): string {
    return `${this.transform}(${this.match.map((link) => `${link.role}=${link.path}`).join(", ")})`;
  }

  identity(): string {
    return this.#identity;
  }

  schema_name(): string {
    return StepObject.name as string;
  }

  owner(): null {
    return null;
  }

  accept(visitor: unknown): void {
    Bindings.accept(STEP, this, visitor as never);
  }
}

/** Each object's path and place, given when a session first sees it: its path in the store (mbse-schemas' `Paths`), and
 * a number in the order of its schema's extent then, which orders matches. */
class Labels {
  readonly #labels = new Map<unknown, [string, number]>();
  readonly #counts = new Map<string, number>();

  see(store: any, names: Iterable<string>): void {
    let paths: Paths.Paths | null = null;
    for (const name of names) {
      for (const value of store.extent(name) as Visitable[]) {
        if (this.#labels.has(value.identity())) continue;
        paths ??= Paths.of(store);
        const count = this.#counts.get(name) ?? 0;
        this.#labels.set(value.identity(), [paths.of(value), count]);
        this.#counts.set(name, count + 1);
      }
    }
  }

  of(value: Visitable): [string, number] {
    return this.#labels.get(value.identity()) as [string, number];
  }
}

/** Applies `transforms` to the data of `store`, one step per decision (see the module's documentation). */
export class Session {
  readonly transforms: readonly Transform[];
  readonly steps: Step[] = [];
  undecided: string[] = [];
  readonly #scope: Match;
  readonly #labels: Labels;
  readonly #earlier: Map<string, Step>;
  #child: { candidate: Candidate; session: Session; mode: string; by: string; links: Link[] } | null = null;
  #candidates: Candidate[];

  constructor(readonly store: any, transforms: Iterable<Transform>, scope: Match = {}, labels: Labels | null = null,
    earlier: Iterable<Step> = []) {
    this.transforms = [...transforms];
    const problems = this.transforms.flatMap((transform) => transform.check());
    if (problems.length > 0) throw new ValueError(problems.join("; "));
    this.#scope = { ...scope };
    this.#labels = labels ?? new Labels();
    this.#earlier = new Map([...earlier].map((step) => [step.key, step]));
    this.#candidates = this.enabled();
  }

  // --- Matches and candidates ---

  private links(match: Match): Link[] {
    return Object.entries(match).map(([symbol, value]) => new Link(symbol, this.#labels.of(value)[0], value));
  }

  private enabled(): Candidate[] {
    const evaluate = new Predicates.Evaluator(this.store);
    const found: Candidate[] = [];
    this.undecided = [];
    this.#labels.see(this.store, this.transforms.flatMap((t) => [...t.before.symbols.values()].map((schema) => schema.name as string)));
    this.transforms.forEach((transform, order) => {
      const domains = new Map([...transform.parameters].map(([name, parameter]) => [name, options(parameter.type)]));
      const finite = [...transform.parameters.keys()].filter((name) => domains.get(name) !== null);
      const open = [...transform.parameters.keys()].filter((name) => domains.get(name) === null);
      for (const match of Queries.select(this.store, transform.before, null, true)) {
        if (Object.entries(this.#scope).some(([symbol, value]) => symbol in match && match[symbol] !== value)) continue;
        const where = this.links(match).map((link) => `${link.role}=${link.path}`).join(", ");
        const [before, after] = [holds(evaluate, transform.before, match), holds(evaluate, transform.after, match)];
        if (before === null || after === null) {
          this.undecided.push(`${repr(transform.name)} at ${where}: its ${before === null ? "before" : "after"} is unknown`);
          continue;
        }
        if (after) continue;
        const at = Object.values(match).map((value) => this.#labels.of(value)[1]);
        for (const values of product(finite.map((name) => domains.get(name) as readonly unknown[]))) {
          const rank = values.map((value, i) => (domains.get(finite[i] as string) as readonly unknown[]).indexOf(value));
          found.push(new Candidate(transform, { ...match }, Object.fromEntries(finite.map((name, i) => [name, values[i]])), open, 0,
            key([transform.parameters.size > 0 ? 0 : 1, order, ...at, ...rank])));
        }
      }
    });
    return found.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /** The enabled candidates, ranked: by the policy's score, highest first, then in order. */
  candidates(policy: Policy | null = null): Candidate[] {
    this.closed();
    const scored = this.#candidates.map((candidate) => (policy === null ? candidate : candidate.withScore(policy.score(candidate))));
    return scored.sort((a, b) => b.score - a.score); // stable: in order among equal scores
  }

  /** Records an open composite whose session is done; refuses to go on while it is not. */
  private closed(): void {
    if (this.#child === null) return;
    const { candidate, session, mode, by, links } = this.#child;
    if (!session.done) throw new ValueError(`${repr(candidate.transform.name)} is open: take its steps first`);
    this.#child = null;
    this.finish(candidate, links, by, mode, [...session.steps]);
  }

  private find(candidate: Candidate): Candidate {
    const found = this.#candidates.find((c) => c.same(candidate));
    if (found === undefined) throw new ValueError(`${repr(candidate.transform.name)} is not enabled for that match`);
    return found;
  }

  // --- Steps ---

  /** Checks that the step established its after, records it, and finds the candidates again. */
  private finish(candidate: Candidate, links: Link[], by: string, mode: string | null, steps: Step[], wrote: unknown = null): void {
    if (holds(new Predicates.Evaluator(this.store), candidate.transform.after, candidate.match) !== true) {
      const where = links.map((link) => `${link.role}=${link.path}`).join(", ");
      throw new ValueError(`${repr(candidate.transform.name)} did not establish its after at ${where}`);
    }
    const args = [...candidate.transform.parameters.keys()].map((name) => [name, candidate.arguments[name]] as [string, unknown]);
    const written = wrote instanceof Map ? [...wrote].map(([role, element]) => new Link(role as string, null, element)) : [];
    const step = new Step(candidate.transform.name, links, args, by, mode, steps, written);
    this.#earlier.delete(step.key); // decided now, whoever decided it
    this.steps.push(step);
    this.#candidates = this.enabled();
  }

  private apply(candidate: Candidate, by: string): void {
    if (candidate.open.length > 0) throw new ValueError(`${repr(candidate.transform.name)} has open parameters ${repr(candidate.open)}`);
    if (candidate.transform.parts.length > 0) throw new TypeError(`${repr(candidate.transform.name)} is composite: step in or over it`);
    this.find(candidate);
    const links = this.links(candidate.match);
    const wrote = (candidate.transform.rewrite as Rewrite)(this.store, { ...candidate.match }, { ...candidate.arguments });
    this.finish(candidate, links, by, null, [], wrote);
  }

  /** Takes a candidate, as the caller decides: applies its rewrite and records the step. */
  take(candidate: Candidate): void {
    this.closed();
    this.apply(candidate, "caller");
  }

  /** Opens a composite's own session, scoped to its match, for the caller to take its steps. */
  step_in(candidate: Candidate): Session {
    return this.open(candidate, "in", "caller");
  }

  private open(candidate: Candidate, mode: string, by: string): Session {
    this.closed();
    if (candidate.transform.parts.length === 0) throw new TypeError(`${repr(candidate.transform.name)} is not composite: take it`);
    if (candidate.open.length > 0) throw new ValueError(`${repr(candidate.transform.name)} has open parameters ${repr(candidate.open)}`);
    this.find(candidate);
    const earlier = this.#earlier.get(this.keyOf(candidate));
    const session = new Session(this.store, candidate.transform.parts, { ...this.#scope, ...candidate.match }, this.#labels,
      earlier !== undefined ? earlier.steps : []);
    this.#child = { candidate, session, mode, by, links: this.links(candidate.match) };
    return session;
  }

  private keyOf(candidate: Candidate): string {
    return new Step(candidate.transform.name, this.links(candidate.match), [], "").key;
  }

  /** The first candidate, in order, that an earlier decision with its key decided, its open parameters answered as
   * then. */
  private reusable(): Candidate | null {
    for (const candidate of this.#candidates) {
      const earlier = this.#earlier.get(this.keyOf(candidate));
      if (earlier === undefined) continue;
      const values = new Map(earlier.arguments);
      if (Object.entries(candidate.arguments).every(([name, value]) => values.has(name) && same(values.get(name), value))
        && candidate.open.every((name) => values.has(name))) {
        return candidate.open.length > 0
          ? candidate.answer(Object.fromEntries(candidate.open.map((name) => [name, values.get(name)]))) : candidate;
      }
    }
    return null;
  }

  /** Takes one step, as decided before or by the policy, and says whether it took one: the first candidate an earlier
   * decision decides (see `earlier`), else the candidate the policy ranks first; a composite as a whole. Inside a
   * composite the caller stepped into, it steps there. It takes nothing where no earlier decision applies and there is
   * no policy, no clause weighs the first candidate, or the policy cannot answer its open parameters, or a composite's
   * own session stops. */
  step_over(policy: Policy | null = null): boolean {
    if (this.#child !== null && !this.#child.session.done) return this.#child.session.step_over(policy);
    this.closed();
    let candidate = this.reusable();
    let by = "reused";
    if (candidate === null) {
      const ranked = policy !== null ? this.candidates(policy) : [];
      if (ranked.length === 0 || (ranked[0] as Candidate).score <= 0) return false;
      [candidate, by] = [ranked[0] as Candidate, "policy"];
      if (candidate.open.length > 0) candidate = candidate.answer((policy as Policy).answers(candidate));
      if (candidate.open.length > 0) return false;
    }
    if (candidate.transform.parts.length === 0) {
      this.apply(candidate, by);
      return true;
    }
    const session = this.open(candidate, "over", by);
    session.run(policy);
    if (session.done) this.closed();
    return true;
  }

  /** The earlier decisions not taken again whose key no candidate has now: what changed made them moot. */
  get orphans(): Step[] {
    const keys = new Set(this.#candidates.map((candidate) => this.keyOf(candidate)));
    return [...this.#earlier].filter(([key]) => !keys.has(key)).map(([, step]) => step);
  }

  /** Steps over until the session is done, or neither an earlier decision nor the policy decides; the number of steps
   * taken. */
  run(policy: Policy | null = null): number {
    let taken = 0;
    while (!this.done && this.step_over(policy)) taken += 1;
    return taken;
  }

  /** Whether no step is left: no composite open, and no candidate. */
  get done(): boolean {
    if (this.#child !== null && this.#child.session.done) this.closed();
    return this.#child === null && this.#candidates.length === 0;
  }

  // --- The trace ---

  /** The step that wrote `element`, a composite's own steps included, or null. */
  wrote(element: unknown): Step | null {
    return all(this.steps).find((step) => step.wrote.some((link) => link.element === element)) ?? null;
  }

  /** The steps taken, as a `Transforms.Trace` object built in `store` (see `register`), what each wrote by its path
   * now. */
  trace(store: any): unknown {
    const paths = Paths.of(this.store);
    const root = new Map<string, PlainData>([["steps", this.steps.map((step) => plain(step, paths))]]);
    return Plain.FromPlain(store)(Trace, new Map<string, PlainData>([["root", "s0"], ["objects", new Map([["s0", root]])]]));
  }
}

function all(steps: readonly Step[]): Step[] {
  return steps.flatMap((step) => [step, ...all(step.steps)]);
}

/** What a step wrote, by its path now; null where the store no longer reaches it. */
function pathOf(paths: Paths.Paths, link: Link): string | null {
  try {
    return paths.of(link.element);
  } catch { // a LookupError, the one error a path's lookup throws
    return null;
  }
}

function* product(domains: readonly (readonly unknown[])[]): Generator<unknown[]> {
  if (domains.length === 0) {
    yield [];
    return;
  }
  for (const value of domains[0] as readonly unknown[]) for (const rest of product(domains.slice(1))) yield [value, ...rest];
}

function native(name: string, value: unknown): PlainMap {
  const host = Schemas.NATIVE_TYPES.find((token) => Schemas.isNativeOf(token, value));
  if (host === undefined) throw new TypeError(`argument ${repr(name)} is not a native value: ${repr(value)}`);
  const schema = new Schemas.OfNative.Data(host);
  return new Map([[(schema.token as Schemas.OfNative.Token).name, schema.to_plain(value)]]);
}

function plain(step: Step, paths: Paths.Paths): PlainMap {
  const out = new Map<string, PlainData>([["transform", step.transform],
    ["match", step.match.map((link) => new Map<string, PlainData>([["symbol", link.role], ["element", link.path as string]]))]]);
  if (step.wrote.length > 0) {
    out.set("wrote", step.wrote.map((link) => {
      const path = pathOf(paths, link);
      return new Map<string, PlainData>([["role", link.role], ...(path === null ? [] : [["element", path] as [string, PlainData]])]);
    }));
  }
  if (step.arguments.length > 0) {
    out.set("arguments", step.arguments.map(([name, value]) => new Map<string, PlainData>([["name", name], ["value", native(name, value)]])));
  }
  out.set("by", step.by);
  if (step.mode !== null) out.set("mode", step.mode);
  if (step.steps.length > 0) out.set("steps", step.steps.map((inner) => plain(inner, paths)));
  return out;
}

const text = (name: string) => (p: Schemas.OfProperty.Builder) => p.name(name).of((t) => t.as_native(String));
const list = (name: string, item: Schemas.OfAny.Spec) =>
  (p: Schemas.OfProperty.Builder) => p.name(name).of((t) => t.as_indexed((i) => i.of(item)));

const Binding = new Schemas.OfObject.Builder().properties(text("symbol"), text("element")).create();
const Written = new Schemas.OfObject.Builder().properties(text("role"), text("element")).create();
const Argument = new Schemas.OfObject.Builder().properties(text("name"), (p) => p.name("value").of(Schemas.Form.Value)).create();
const StepSchema = new Schemas.OfObject.Builder().properties(
  text("transform"), list("match", Binding), list("wrote", Written), list("arguments", Argument), text("by"),
  text("mode")).create();
new Schemas.OfObject.Builder(StepSchema).properties(list("steps", StepSchema)).update();

/** The schema of a trace: its steps in order, each its transform's name, its match (each symbol and its object, by its
 * path, `Shelf/items[0]`), what it wrote (each role and its object's path, where the store still reaches it), its
 * arguments by name, who decided it (`caller`, `policy` or `reused`), and, for a composite, whether the caller stepped
 * `in` or `over` it and its own steps. */
export const Trace = new Schemas.OfObject.Builder().name(TRACE).ref().properties(list("steps", StepSchema)).create();

/** The steps a `Transforms.Trace` object in `store` holds, as a session took them. */
export function steps(store: any, trace: unknown): Step[] {
  const written = Plain.ToPlain(store)(Trace, trace as never) as PlainMap;
  const root = (written.get("objects") as PlainMap).get(written.get("root") as string) as PlainMap;
  return (root.get("steps") as PlainMap[]).map(stepOf); // written even when there are none
}

function stepOf(plain: PlainMap): Step {
  const args = ((plain.get("arguments") as PlainMap[] | undefined) ?? []).map(
    (a) => [a.get("name") as string, valueOf(a.get("value") as PlainMap)] as [string, unknown]);
  return new Step(plain.get("transform") as string, (plain.get("match") as PlainMap[]).map(
    (b) => new Link(b.get("symbol") as string, b.get("element") as string)), args, plain.get("by") as string,
    (plain.get("mode") as string | undefined) ?? null, ((plain.get("steps") as PlainMap[] | undefined) ?? []).map(stepOf),
    ((plain.get("wrote") as PlainMap[] | undefined) ?? []).map(
      (w) => new Link(w.get("role") as string, (w.get("element") as string | undefined) ?? null)));
}

function valueOf(plain: PlainMap): unknown {
  const [[token, value]] = [...plain] as [[string, PlainData]];
  return Schemas.OfNative.resolve((t) => t.token("basic", token)).from_plain(value);
}

/** What two traces decided differently, by key (a composite's own steps under its key, `Finish(i=...)/Label(i=...)`):
 * the steps only the later took, those only the earlier took, and, as pairs, those both took with other arguments. */
export class Diff {
  constructor(readonly added: readonly Step[], readonly removed: readonly Step[], readonly changed: readonly [Step, Step][]) {}
}

function* flat(steps: Iterable<Step>, prefix = ""): Generator<[string, Step]> {
  for (const step of steps) {
    yield [prefix + step.key, step];
    yield* flat(step.steps, `${prefix}${step.key}/`);
  }
}

function sameArguments(a: Step, b: Step): boolean {
  return a.arguments.length === b.arguments.length
    && a.arguments.every(([name, value], i) => name === (b.arguments[i] as [string, unknown])[0] && same(value, (b.arguments[i] as [string, unknown])[1]));
}

/** What `later` decided differently from `earlier`, in each one's order. */
export function diff(earlier: Iterable<Step>, later: Iterable<Step>): Diff {
  const before = new Map(flat(earlier));
  const after = new Map(flat(later));
  return new Diff([...after].filter(([key]) => !before.has(key)).map(([, step]) => step),
    [...before].filter(([key]) => !after.has(key)).map(([, step]) => step),
    [...after].filter(([key, step]) => before.has(key) && !sameArguments(before.get(key) as Step, step))
      .map(([key, step]) => [before.get(key) as Step, step]));
}

/** Registers the trace's schema in `store`, unless it holds it already; returns the store. */
export function register<S extends { names(): Iterable<string>; register(schema: unknown): void }>(store: S): S {
  if (![...store.names()].includes(TRACE)) store.register(Trace);
  return store;
}

// --- Steps as objects ---

function linked(name: string): Schemas.OfRelation.Data {
  return new Schemas.OfRelation.Builder().name(name).links("step", "element").properties(text("role"), text("path")).create();
}

/** A step's link to an element it matched, in the role of a symbol, with the element's path. */
export const Matched = linked("Transforms.Matched");
/** A step's link to an element its rewrite wrote, in the role the rewrite gave it, with its path once written. */
export const Wrote = linked("Transforms.Wrote");
/** A composite step's link to each of its own steps, in order. */
export const Within = new Schemas.OfRelation.Builder().name("Transforms.Within").links("composite", "step").create();
const Taken = new Schemas.OfRelation.Builder().name("Transforms.Taken").links("records", "step").create();
/** A step as an object: its transform's name, its arguments, who decided it and a composite's mode; the elements it
 * matched and wrote, and a composite's own steps. */
export const StepObject = new Schemas.OfObject.Builder().name("Transforms.Step").ref().properties(
  text("transform"), list("arguments", Argument), text("by"), text("mode")).relations(
  (r) => r.name("matched").of(Matched).me("step"), (r) => r.name("wrote").of(Wrote).me("step"),
  (r) => r.name("steps").of(Within).me("composite")).create();
/** The steps a session took, in order: the root of `records(session)`. */
export const Records = new Schemas.OfObject.Builder().name(RECORDS).ref().singleton(RECORDS).relations(
  (r) => r.name("steps").of(Taken).me("records")).create();

function entries(links: readonly Link[]): Bindings.Entry[] {
  return links.map((link) => new Bindings.Entry(new Map([["element", link.element]]),
    new Map<string, unknown>([["role", link.role], ...(link.path === null ? [] : [["path", link.path] as [string, unknown]])])));
}

function linksOf(found: Bindings.Entry[] | undefined): Link[] {
  return (found ?? []).map((e) => new Link(e.properties.get("role") as string, (e.properties.get("path") as string | undefined) ?? null,
    e.links.get("element")));
}

function stepState(step: Step): Bindings.State {
  const values = new Map<string, unknown>([["transform", step.transform], ["by", step.by]]);
  if (step.arguments.length > 0) {
    values.set("arguments", step.arguments.map(([name, value]) => new Map<string, PlainData>([["name", name], ["value", native(name, value)]])));
  }
  if (step.mode !== null) values.set("mode", step.mode);
  return new Bindings.State(values, new Map([["matched", entries(step.match)], ["wrote", entries(step.wrote)],
    ["steps", step.steps.map((inner) => new Bindings.Entry(new Map([["step", inner]])))]]));
}

function stepFrom(state: Bindings.State): Step {
  const args = ((state.values.get("arguments") as PlainMap[] | undefined) ?? []).map(
    (a) => [a.get("name") as string, valueOf(a.get("value") as PlainMap)] as [string, unknown]);
  return new Step((state.values.get("transform") as string | undefined) ?? "", linksOf(state.entries.get("matched")), args,
    (state.values.get("by") as string | undefined) ?? "", (state.values.get("mode") as string | undefined) ?? null,
    (state.entries.get("steps") ?? []).map((e) => e.links.get("step") as Step), linksOf(state.entries.get("wrote")));
}

const STEP = new Bindings.Binding(StepObject, stepState, stepFrom);

let recordsCount = 0;

/** The root of `records(session)`: the steps a session took, in order. */
class RecordsRoot {
  steps: Step[] = [];
  readonly #identity = `records ${++recordsCount}`;

  identity(): string {
    return this.#identity;
  }

  schema_name(): string {
    return RECORDS;
  }

  owner(): null {
    return null;
  }

  accept(visitor: unknown): void {
    Bindings.accept(RECORDS_BINDING, this, visitor as never);
  }
}

function made(state: Bindings.State): RecordsRoot {
  const root = new RecordsRoot();
  root.steps = (state.entries.get("steps") ?? []).map((e) => e.links.get("step") as Step);
  return root;
}

const RECORDS_BINDING = new Bindings.Binding(Records, (root: RecordsRoot) => new Bindings.State(new Map(), new Map([["steps",
  root.steps.map((step) => new Bindings.Entry(new Map([["step", step]])))]])), made);

/** The steps `session` took, as objects of a store whose singleton `Transforms.Records` holds them in order; combined
 * with the session's store (mbse-schemas' `Stores.Combined`), predicates query them and the elements they link. */
export function records(session: Session): Bindings.OfStore {
  const store = new Bindings.OfStore([[StepObject, (instance?: unknown) => new Bindings.Builder(STEP, instance)],
    [Records, (instance?: unknown) => new Bindings.Builder(RECORDS_BINDING, instance)]], [Matched, Wrote, Within, Taken]);
  (store.singleton(RECORDS) as RecordsRoot).steps = [...session.steps];
  return store;
}
