<!-- nav -->
[← Equivalence](EQUIVALENCE.md) · [Home](../README.md) · [Conformance corpus →](../conformance/README.md)

# Transforms

Status: a draft for review; nothing is built. Transforms will be a module of this repository, `Transforms` (see Where
it lives). Decisions it relies on are marked as such; everything else is a proposal, and what is undecided is under
Open questions.

## Why

The mbse repositories promise executable specifications whose every process keeps people and AI agents in the loop
([MBSE.md](../MBSE.md)). Generating code from a model is such a process: mbse-codegen-ccpp, -python, -typescript and
-verilog will render schemas, expressions and patterns as idiomatic source. A generator written as one function makes
every choice silently (how a union becomes a `std::variant` or a tagged struct, whether a parameter becomes a template
argument or a constructor argument), and nobody can see, question or change those choices except by editing the
generator.

A *transform* makes generation a sequence of small, deterministic *steps*, one per decision. Every choice is either
which enabled step to take next or a *parameter* of it, which a person or an agent decides; a *policy* the caller chose
ranks the choices, as a recommendation, or decides them where the caller lets it. The steps taken, their decisions and
what each read and wrote are kept as data, the *trace*. From the trace follow the three
optional capabilities this note also designs: **diff** (what changed between two runs, and why), **incremental
rebuild** (rerun only what a model change affects, keeping every earlier answer that still applies) and
**reversibility** (take steps back, and, for transforms that allow it, carry an edit of the output back to the model).

## The model

This is intentionally the shape of MLIR's pattern rewriting: a transform is a rewrite pattern, anchored on what it
matches, and a session applies enabled patterns from a worklist until none is left; transforms compose as passes into
pipelines.

- **A transform** is a rewrite with a precondition and a postcondition:
  - its **before** and **after** are predicates (`Predicates.OfPredicate`) over the transform's **symbols**, each named
    and of a declared schema. Before says what a match must be ("a value object schema of a module"); after says what
    is true once the transform has been applied to it ("the schema has a C++ `struct` that renders it"), typically
    with `Exists` over the elements the rewrite makes;
  - its **parameters** are `OfParameter`s (mbse-schemas'
    [Parametrics](https://github.com/pitaman71/mbse-schemas/blob/main/docs/FRAMEWORK.md#parametrics)), each typed by a
    schema, its **value domain**: usually a native, but any schema, such as a union of described options (`layout`:
    `struct` or `tagged`), a positional list with an extent, or a value object;
  - its **rewrite** is a deterministic function of a match and its arguments, whose effect is a set of mutations of the
    session's models, after which after holds for the match.
- **A match** binds each of a transform's symbols to an element of the models: a query of before over the session's
  store (`Queries`), so finding matches is what mbse-patterns already does.
- **A step is enabled** for a match where before is true and after is false: the transform applies there and has not
  been applied yet. Where either is unknown (three-valued checks), the match is not enabled but **undecided**, and a
  session reports it rather than guess.
- **A candidate** is an enabled step with arguments: a transform, a match, and a value for each parameter from its
  domain. Where a domain is finite (a union of options, a `bool`, a bounded int) each value is a candidate of its own;
  where it is not (a string, an unbounded int), the candidate has an open parameter that a person, an agent or a
  recommendation gives a value for.
- **The worklist** holds the session's candidates. After every step, the matches the step's writes affect are
  evaluated again: a candidate whose before became false or whose after became true leaves, and new matches join.
  Conflicts are resolved linearly, one step at a time: two candidates that would rewrite the same element are both
  offered, and taking one disables the other. Bounded speculation (taking several alternatives in scoped sub-histories
  and keeping the best by a costing function scoped to them) is a later extension; it needs sub-histories and undo.
- **A step** is one decision: a candidate taken, its transform, its match (by paths, see Diff), its arguments, and where
  each decision came from: the caller, a policy (in step-over), or an earlier run (see Incremental rebuild).
- **A policy** ranks candidates; it never makes one. It is ordered clauses, each a transform, optionally a guard (a
  predicate over the match, by reference) and preferences over arguments, and a weight; a distribution over a
  parameter's domain (`Distributions`: `Categorical` weights for options, `Uniform` or `Normal` for numbers) weighs the
  candidates that differ in that argument, and proposes a value for an open parameter. Ties are broken by a canonical
  order (below), so a ranking is deterministic.
- **A composite transform** is made of transforms, and applying it runs a session of its own over them (rendering a
  union: choose a representation, then render each branch). The caller **steps in**, deciding its inner steps as any
  others, or **steps over**, letting the policy decide them; either way the inner steps are kept nested in the trace,
  so a decision can be read at the level it was made. A pipeline is a composite transform (see Pipelines).
- **A trace** is the steps taken, in order: a reference object of mbse-schemas whose steps are value objects in a list,
  linked by relations to the elements they matched and wrote. Since a trace is data, it is written, read, validated
  and compared as any other, and both implementations write it byte-identically. Which step depended on which (read
  what another wrote) is not part of it: it follows from recorded reads, which only incremental rebuild needs.

Variables of a specification and parameters of a step are distinct (mbse-schemas' Parametrics: a parameter is a variable
whose binder is a schema). A step's parameters are the *transform's* variables; a parametric schema's parameters are the
*model's*, which a transform carries into the target as the target language's own construct (a C++ template
parameter). Documents and messages say "step parameter" or "model parameter" wherever both are near.

### Decisions this relies on

- **No defaults** (mbse-schemas' Parametrics). A question no one answered stays open. A policy is not a default: the
  caller chooses it, and it decides only where the caller steps over; every decision it makes is recorded as its own.
- **One step per decision**, and a caller who steps into or over a composite transform.
- **Linear resolution**: one step at a time, with no sub-histories or undo in the core; speculation comes later.
- **A worklist of enabled steps**: a match where before is true and after is false. Policies only rank enabled
  candidates: a recommendation when the caller decides, the decision when the caller steps over.
- **Parameters are typed by a value domain**, a schema (`OfParameter`'s type), usually but not only a native, so that
  mbse-patterns' distributions can weigh and propose values.
- **Determinism** (the opening of [mbse-schemas'
  design](https://github.com/pitaman71/mbse-schemas/blob/main/docs/FRAMEWORK.md): bindings "can be automatically and
  deterministically generated"). The same models, policies and decisions give the same steps, the same trace and the
  same result, in every implementation.
- **Programs are trees, never text templates** (mbse-programs). A codegen step writes syntax nodes; printing is the
  target language's own, last.

## A session

A session runs a transform over models bound to its symbols. Both implementations offer the same API; in Python:

```python
session = Transforms.Session(transform, {"module": module})  # before is checked for the binding
for candidate in session.candidates(policy):     # the enabled steps, ranked by the policy, then canonically
    candidate.transform, candidate.match, candidate.arguments, candidate.open, candidate.rank
session.take(candidate.answer(name="Point"))     # a step: one decision, from a person or an agent
session.step_over(policy)                        # takes the policy's first candidate; stops where it cannot decide
session.step_in(candidate)                       # a composite's own session, to decide its inner steps
session.trace, session.undecided, session.done   # the record, what is unknown, whether the worklist is empty
```

- **Parameter decisions first**: by default, candidates that decide a parameter's value (those of transforms with
  parameters) rank before all others, since what they decide shapes what follows; a policy may rank otherwise.
- **Canonical order**: then, candidates are ordered by the transforms' declared order, then by their matches, by the
  paths of the elements bound in the symbols' order, then by their arguments in each domain's order. Nothing depends on
  hash order, a clock or memory addresses. A random choice, where a policy wants one, draws from a `Stores.PCG32` seeded
  as the policy says, so it too is part of the run's inputs.
- **`take(candidate)`** refuses a candidate that is not enabled or has an open parameter, applies its rewrite, records
  the step and its decisions, and updates the worklist.
- **`step_over(policy)`** takes the policy's first candidate, again and again, until the worklist is empty or the first
  candidate has an open parameter the policy proposes no value for; then the caller decides. With a policy that decides
  everything, a session is a batch generator; with none, every choice is the caller's.
- **A transform is done** when its worklist is empty, and a session then checks the transform's own after. It is
  **complete** when every element of the bound models that some transform could match has been rewritten, which a
  session reports, so that an element no transform can rewrite is a finding ("nothing rewrites union `Reach`"), never
  silently dropped. Today's transpilers' refusals ("a spread in an object literal is not supported") become exactly
  that.

## Diff (optional)

What is compared is data, so a diff is a comparison of snapshots. Three diffs are useful:

- **Source diff**: what changed in the model. It needs element identities that survive a change, which snapshots'
  symbols do not (they are numbered in first-reference order; see mbse-schemas' design, Open questions, labeling
  objects outside snapshots). A transform names elements by their **path** from one of before's or after's symbols: the
  symbol, then property
  names and list keys within its model (`module.schemas[Contact].properties[home]`), the same in both implementations.
- **Trace diff**: what was decided differently. A step's **key** is its transform and the paths of its match; two
  traces' steps match by key, and a diff lists steps added, removed, and taken with different arguments,
  each with its decisions' origins.
- **Target diff, explained**: what changed in the output, and why. Every target element links to the step that wrote
  it, and that step to the elements it read and to its decisions, so a changed line of generated code is traced to the
  model change or the answer that caused it.

`Session.diff(other)` gives the trace diff and the explained target diff. Diffing stores in general (two snapshots,
mutations as data) is mbse-journals' (planned), which transforms would use rather than duplicate.

## Incremental rebuild (optional)

After the model changes, a session reruns the transform and asks only what is new.

- **Decisions survive.** Every decision is keyed by its step's key: which candidate was taken at a match, and with
  which arguments. A rerun answers a question from
  the earlier run's decision with the same key before it asks, recording the answer as "reused". This is always sound:
  it only replaces asking with an answer someone gave before, for the same choice about the same elements. A decision
  whose key no longer occurs is **orphaned** and reported for review, never silently dropped.
- **Work survives.** A step that reads exactly what it read before, with the same arguments, writes exactly what it
  wrote before (determinism). A session records each step's **reads**: the source elements and properties, and the
  target elements, it read. To record them reliably a step reads through a recording view (the visitor protocols make
  this possible without the step's cooperation), not by declaration. A step's **fingerprint** is a hash of the
  canonical JSON of what it read and its arguments, the same in both implementations since their JSON is byte-identical.
- **Invalidation.** A source diff gives the changed paths; a step that read one is invalid, and so is any step that
  read what an invalid step wrote. A rerun replays the trace in order: a valid step's effect is reused, an invalid one
  is taken again (with its decisions reused where they still apply), and candidates the old trace did not have are
  offered as new. The result is the same as a run from scratch with the same decisions; the test of incremental
  rebuild is exactly that equality.

This is the same idea as incremental build systems and query engines (dependencies recorded by reading, results keyed
by fingerprints); what is particular here is that decisions are inputs and survive by key.

## Reversibility (optional)

Two levels, each a property a transform may have:

- **Undoable.** Every step's effect is recorded as mutations with what they replaced (created, and so deletable;
  updated, from an old value), so `session.undo()` takes back the last step exactly. Undoing to any point and taking
  other candidates explores an alternative; both branches are traces, and so can be diffed. Every transform is undoable
  when its rewrite is expressed as mutations, which the session can require. (Undo is not in the core: resolution is
  linear until speculation needs it.)
- **Invertible.** A transform may declare its **inverse**: a transform whose before is its after and whose after is its
  before, which matches what a step wrote and, with the step's own arguments, writes back what the step read. The
  arguments are exactly the information the forward step decided and the target does not show (lenses call it the
  complement): "this C++ class was rendered from a value object schema, with `layout=struct`". A trace is invertible
  when every step in it is; a session names the steps that are not. Two uses follow:
  - **round trip**: from a target and its trace, the reverse transform gives back the source, and the forward
    transform from that source, with the trace's decisions, gives back the target;
  - **edit propagation**: when someone edits the generated code, the target diff names the steps whose output
    changed; their inverses, with incremental rebuild in reverse, give the changed source, or name the edit that no
    inverse can carry back ("this edit is to a line no step can read back").

  An invertible transform is checked by its tests for the two laws such pairs must keep: taking the step and then its
  inverse gives back what was read, and taking the inverse and then the step gives back what was written. Existing
  candidates for invertible steps: mbse-expressions' translation rules already pair a left and a right pattern in both
  directions (`Rule(left, right, direction='both')`), and mbse-schemas' dataclass adapters are a forward and a
  reverse transform (`ToDataclass`, `FromDataclass`).

## Data

Everything a session keeps is mbse-schemas data, in one store of the session, so that its relations link elements
(stores are isolated, so the source is read into the session's store as a snapshot):

- `Transforms.Step`: a value object, its transform's name, its match (each symbol and the path of its element), its
  arguments (as an application's are written: `{"name", "value"}` or `{"name", "term"}`), where its decision came from
  (`caller`, `policy` with the clause's position, `reused`), and, for a composite transform, whether the caller
  stepped in or over and its inner steps, in a list.
- Relations from a step to elements: `Matched(step, element)` and `Wrote(step, element)`, each with the element's path;
  and, where recorded, `Read(step, element)`, a fingerprint, and the step's effect as mutations.
- `Transforms.Trace`: a reference object holding the steps in order, the transform's name and version, the bindings of
  its symbols, and the policies it ran with.
- `Transforms.Policy`: clauses, each a transform, a guard (a predicate's name and arguments), preferences over
  arguments or a distribution over a parameter's domain, and a weight.

A transform's rewrite is code: like an expression kind (mbse-expressions), a transform is a class with a meta-schema,
registered by name, so a trace written by one implementation is read by the other, and replays there to the same
result.

## Pipelines

Because a transform's shape is its predicates, transforms compose as passes do: a **pipeline** binds one transform's
after-symbols to the next one's before-symbols, by name, where their schemas are the same (or equivalent,
`Schemas.equivalent`). What the first's after requires is known of its output, and the second's before is checked
against that output when the pipeline runs; showing statically that one implies the other is resolving constraints,
which is not built (mbse-expressions). A pipeline is itself a transform, its before the first one's and its after the
last one's, and its trace the traces of its transforms in order, nested as a sub-transform's are. Code generation is
such a pipeline: lower a model to the target language's trees, rewrite them (name mangling, layout), then print. Each
stage's choices are asked, answered and recorded at the stage that makes them.

## Where it lives

In **mbse-patterns**, as the module `Transforms`: a transform's before and after are this repository's predicates,
and so are policies' guards, and checking what a predicate requires needs mbse-schemas and mbse-expressions, on which
this repository already depends. The codegen repositories depend on it (they render patterns too), and so, as they are
rebuilt on it, do mbse-programs' transpilers and bridges. mbse-expressions' translators, which this repository depends
on, cannot use it without a cycle; they would move, or stay single functions. If transforms outgrow this repository,
they can become one of their own, mbse-transforms, depending on this one.

## Plan

1. **Core**: transforms (before, after, parameters, rewrite), matches by query, the worklist of enabled candidates,
   sessions (`take`, `step_over`, `step_in`, composites), policies that rank, and traces as data, in both languages,
   with the determinism test that two runs (and the two implementations) give byte-identical traces and results.
2. **A first transform with both directions**: mbse-schemas' `ToDataclass` and `FromDataclass` as one invertible
   transform (schemas to Python's `ast` and back), which tests undo and inversion on a small, known case.
3. **Diff and reused decisions**: paths, keys, trace diffs, and reruns that reuse decisions and report orphans.
4. **Incremental rebuild**: recorded reads, fingerprints and invalidation, tested against runs from scratch.
5. **mbse-codegen-python**, then the other codegen repositories, each transform with its parameters documented, and
   the existing translators, transpilers and bridges rebuilt as transforms.

## Open questions

- **Inverse predicates.** A transform's inverse swaps before and after. An invertible transform's after must then be
  strong enough to be the inverse's before; should that be checked when a transform declares its inverse?
- **What after refers to.** After is evaluated for the same match as before, so the elements a rewrite makes are
  reached from the matched ones (`Exists` over a relation that links them). Is that always enough, or do transforms
  need symbols that only after binds?
- **Undecided matches.** A match whose before or after is unknown is reported, not enabled. Should a caller be able to
  enable it anyway, as a decision recorded like any other?
- **Speculation.** Bounded speculation with costing functions scoped to a sub-model: how scopes are declared, and how
  a costing function relates to a policy's ranking.
- **Paths that survive renames.** A renamed schema changes every path under it, which orphans its decisions. Should a
  source diff detect renames (same content, new name) and carry decisions over, or should the person confirm?
- **Enumerated domains.** A domain of options is a union of described branches, which needs no new machinery but is
  verbose on the wire (a union value of an empty value object). An enumeration of literals needs constraints on a
  native, which are planned here. Which first?
- **Reading cost.** Recording every read through visitors costs time on large models. Is coarser recording (per
  element, not per property) enough for invalidation in practice?
- **Partial inverses.** A transform whose inverse holds only for some arguments (a lossy rendering) could declare where
  it is invertible, as a constraint over its arguments. Is that worth having, or is "invertible or not" per transform
  enough?

---

<!-- nav -->
[← Equivalence](EQUIVALENCE.md) · [Home](../README.md) · [Conformance corpus →](../conformance/README.md)
