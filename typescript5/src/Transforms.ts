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
 * transforms' order, then by their matches (each object by its label), then by their values' order in their domains.
 * A session labels each object when it first sees it, by its schema's name and a number, in the order of the schema's
 * extent then (`Item#0`, `Item#1`), and keeps the label for the session, since a rewrite may reorder an extent; a
 * composite's session shares its parent's labels.
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
 * `session.trace(store)` writes the steps taken as data, a `Transforms.Trace` object in a store that `register`
 * prepared, which JSON and YAML write byte-identically in both implementations.
 */

import { Plain, Schemas } from "@mbse/schemas/Framework";
import { ValueError } from "@mbse/schemas/Framework/Errors";
import type { PlainData, PlainMap } from "@mbse/schemas/Framework/Plain";
import { repr } from "@mbse/schemas/Framework/Repr";
import type { Visitable } from "@mbse/schemas/Framework/Visitors";

import * as Predicates from "./Predicates.js";
import * as Queries from "./Queries.js";

export const TRACE = "Transforms.Trace";

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

/** A step taken: its transform's name, its match by labels, its arguments, who decided it, and a composite's mode and
 * own steps. */
export class Step {
  readonly arguments: readonly [string, unknown][];

  constructor(readonly transform: string, readonly match: readonly [string, string][], args: readonly [string, unknown][],
    readonly by: string, readonly mode: string | null = null, readonly steps: readonly Step[] = []) {
    this.arguments = args;
  }
}

/** Each object's label, given when a session first sees it: its schema's name and a number, in extent order. */
class Labels {
  readonly #labels = new Map<unknown, [string, number]>();
  readonly #counts = new Map<string, number>();

  see(store: any, names: Iterable<string>): void {
    for (const name of names) {
      for (const value of store.extent(name) as Visitable[]) {
        if (this.#labels.has(value.identity())) continue;
        const count = this.#counts.get(name) ?? 0;
        this.#labels.set(value.identity(), [name, count]);
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
  #child: { candidate: Candidate; session: Session; mode: string; by: string; paths: [string, string][] } | null = null;
  #candidates: Candidate[];

  constructor(readonly store: any, transforms: Iterable<Transform>, scope: Match = {}, labels: Labels | null = null) {
    this.transforms = [...transforms];
    const problems = this.transforms.flatMap((transform) => transform.check());
    if (problems.length > 0) throw new ValueError(problems.join("; "));
    this.#scope = { ...scope };
    this.#labels = labels ?? new Labels();
    this.#candidates = this.enabled();
  }

  // --- Matches and candidates ---

  private paths(match: Match): [string, string][] {
    return Object.entries(match).map(([symbol, value]) => {
      const [name, n] = this.#labels.of(value);
      return [symbol, `${name}#${n}`];
    });
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
        const where = this.paths(match).map(([symbol, path]) => `${symbol}=${path}`).join(", ");
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
    const { candidate, session, mode, by, paths } = this.#child;
    if (!session.done) throw new ValueError(`${repr(candidate.transform.name)} is open: take its steps first`);
    this.#child = null;
    this.finish(candidate, paths, by, mode, [...session.steps]);
  }

  private find(candidate: Candidate): Candidate {
    const found = this.#candidates.find((c) => c.same(candidate));
    if (found === undefined) throw new ValueError(`${repr(candidate.transform.name)} is not enabled for that match`);
    return found;
  }

  // --- Steps ---

  /** Checks that the step established its after, records it, and finds the candidates again. */
  private finish(candidate: Candidate, paths: [string, string][], by: string, mode: string | null, steps: Step[]): void {
    if (holds(new Predicates.Evaluator(this.store), candidate.transform.after, candidate.match) !== true) {
      const where = paths.map(([symbol, path]) => `${symbol}=${path}`).join(", ");
      throw new ValueError(`${repr(candidate.transform.name)} did not establish its after at ${where}`);
    }
    const args = [...candidate.transform.parameters.keys()].map((name) => [name, candidate.arguments[name]] as [string, unknown]);
    this.steps.push(new Step(candidate.transform.name, paths, args, by, mode, steps));
    this.#candidates = this.enabled();
  }

  private apply(candidate: Candidate, by: string): void {
    if (candidate.open.length > 0) throw new ValueError(`${repr(candidate.transform.name)} has open parameters ${repr(candidate.open)}`);
    if (candidate.transform.parts.length > 0) throw new TypeError(`${repr(candidate.transform.name)} is composite: step in or over it`);
    this.find(candidate);
    const paths = this.paths(candidate.match);
    (candidate.transform.rewrite as Rewrite)(this.store, { ...candidate.match }, { ...candidate.arguments });
    this.finish(candidate, paths, by, null, []);
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
    const session = new Session(this.store, candidate.transform.parts, { ...this.#scope, ...candidate.match }, this.#labels);
    this.#child = { candidate, session, mode, by, paths: this.paths(candidate.match) };
    return session;
  }

  /** Takes the candidate the policy ranks first, a composite as a whole, and says whether it took a step. Inside a
   * composite the caller stepped into, it steps there. It takes nothing where no clause weighs the first candidate, or
   * the policy cannot answer its open parameters, or a composite's own session stops. */
  step_over(policy: Policy): boolean {
    if (this.#child !== null && !this.#child.session.done) return this.#child.session.step_over(policy);
    const ranked = this.candidates(policy);
    if (ranked.length === 0 || (ranked[0] as Candidate).score <= 0) return false;
    let candidate = ranked[0] as Candidate;
    if (candidate.open.length > 0) candidate = candidate.answer(policy.answers(candidate));
    if (candidate.open.length > 0) return false;
    if (candidate.transform.parts.length === 0) {
      this.apply(candidate, "policy");
      return true;
    }
    const session = this.open(candidate, "over", "policy");
    session.run(policy);
    if (session.done) this.closed();
    return true;
  }

  /** Steps over until the session is done or the policy cannot decide; the number of steps taken. */
  run(policy: Policy): number {
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

  /** The steps taken, as a `Transforms.Trace` object built in `store` (see `register`). */
  trace(store: any): unknown {
    const root = new Map<string, PlainData>([["steps", this.steps.map(plain)]]);
    return Plain.FromPlain(store)(Trace, new Map<string, PlainData>([["root", "s0"], ["objects", new Map([["s0", root]])]]));
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

function plain(step: Step): PlainMap {
  const out = new Map<string, PlainData>([["transform", step.transform],
    ["match", step.match.map(([symbol, path]) => new Map<string, PlainData>([["symbol", symbol], ["element", path]]))]]);
  if (step.arguments.length > 0) {
    out.set("arguments", step.arguments.map(([name, value]) => new Map<string, PlainData>([["name", name], ["value", native(name, value)]])));
  }
  out.set("by", step.by);
  if (step.mode !== null) out.set("mode", step.mode);
  if (step.steps.length > 0) out.set("steps", step.steps.map(plain));
  return out;
}

const text = (name: string) => (p: Schemas.OfProperty.Builder) => p.name(name).of((t) => t.as_native(String));
const list = (name: string, item: Schemas.OfAny.Spec) =>
  (p: Schemas.OfProperty.Builder) => p.name(name).of((t) => t.as_indexed((i) => i.of(item)));

const Binding = new Schemas.OfObject.Builder().properties(text("symbol"), text("element")).create();
const Argument = new Schemas.OfObject.Builder().properties(text("name"), (p) => p.name("value").of(Schemas.Form.Value)).create();
const StepSchema = new Schemas.OfObject.Builder().properties(
  text("transform"), list("match", Binding), list("arguments", Argument), text("by"), text("mode")).create();
new Schemas.OfObject.Builder(StepSchema).properties(list("steps", StepSchema)).update();

/** The schema of a trace: its steps in order, each its transform's name, its match (each symbol and its object, by its
 * label, `Item#0`), its arguments by name, who decided it (`caller` or `policy`), and, for a composite, whether the
 * caller stepped `in` or `over` it and its own steps. */
export const Trace = new Schemas.OfObject.Builder().name(TRACE).ref().properties(list("steps", StepSchema)).create();

/** Registers the trace's schema in `store`, unless it holds it already; returns the store. */
export function register<S extends { names(): Iterable<string>; register(schema: unknown): void }>(store: S): S {
  if (![...store.names()].includes(TRACE)) store.register(Trace);
  return store;
}

