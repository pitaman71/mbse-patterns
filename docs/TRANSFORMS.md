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

A *transform* makes generation a sequence of small, deterministic *steps*. Every choice a step could make is a
*parameter* of the step, which a person or an agent answers, or a *policy* the caller chose up front answers. The steps
taken, their answers and what each read and wrote are kept as data, the *trace*. From the trace follow the three
optional capabilities this note also designs: **diff** (what changed between two runs, and why), **incremental
rebuild** (rerun only what a model change affects, keeping every earlier answer that still applies) and
**reversibility** (take steps back, and, for transforms that allow it, carry an edit of the output back to the model).

## The model

- **A transform** is two predicates, **before** and **after** (`Predicates.OfPredicate`): their symbols are what the
  transform reads (before) and writes (after), each named and of a declared schema, and what each `requires` is the
  transform's precondition and postcondition over them. Schemas into C++ is, in outline,
  `before: {symbols: {module: Schemas.Module.Schema}, requires: every union's branches are objects}` and
  `after: {symbols: {unit: Ccpp's translation unit}}`. This is intentionally an MLIR pass's shape: a pass declares the
  operation it is anchored on, may require more of it, and declares the dialects it produces; passes compose into a
  pipeline when what one produces is what the next is anchored on. A session binds each of before's symbols to a model
  and checks before (each model against its schema, and what before requires) before it offers a step; when the
  transform is done, it checks after over the models it wrote, so a transform's own output is checked against what it
  promises. A check that is unknown (Validators' three-valued checks) is reported, and the caller decides whether to go
  on. A transform also holds its *step types* and the order in which it offers them. Translators (mbse-expressions),
  transpilers and bridges (mbse-programs) and adapters (mbse-schemas) are transforms written as single functions
  today; each becomes a transform of steps (see Plan).
- **A step type** is one kind of move: "a value object schema becomes a C++ `struct`", "a union becomes a
  `std::variant`", "a union becomes a tagged struct". It declares
  - its **roles**: the source elements it reads (`reads`, `covers`) and the target elements it writes (`creates`,
    `updates`), each role a named link;
  - its **parameters**, each an `OfParameter` (mbse-schemas'
    [Parametrics](https://github.com/pitaman71/mbse-schemas/blob/main/docs/FRAMEWORK.md#parametrics)): the choices it
    leaves open, such as a struct's field order or a container's type. A parameter's options are the branches of a union
    type, each described, so that whoever answers can browse them;
  - how it **applies**: a deterministic function of the elements it reads and its arguments, whose effect is a set of
    mutations of the target.
- **A candidate** is a step a transform offers next: a step type with its roles bound to source elements, and its
  parameters, some answered (by a policy, or by an earlier decision) and some open.
- **A choice point** is a set of candidates that exclude each other, such as the two ways to render one union. Choosing
  among step types is a question like a parameter, and is answered the same ways.
- **A step** is a candidate taken: its step type, its arguments (every parameter answered) and its links to the
  elements it read and wrote. Taking it applies its effect to the target.
- **A trace** is the steps taken, in order: a reference object of mbse-schemas whose steps are value objects in a list,
  linked by relations to source and target elements. Since a trace is data, it is written, read, validated and compared
  as any other, and both implementations write it byte-identically.
- **A decision** is an answer and where it came from: the caller, a clause of a policy, or a decision recorded by an
  earlier run and reused (see Incremental rebuild). Every argument of every step has one.
- **A policy** answers questions without asking: an ordered list of clauses, each a step type (or a choice point) and a
  parameter, the value it gives, and optionally a guard, a predicate over the elements the step reads (by
  reference). The first clause that applies answers; none means the question stays open.

Variables of a specification and parameters of a step are distinct (mbse-schemas' Parametrics: a parameter is a variable
whose binder is a schema). A step's parameters are the *transform's* variables; a parametric schema's parameters are the
*model's*, which a transform carries into the target as the target language's own construct (a C++ template
parameter). Documents and messages say "step parameter" or "model parameter" wherever both are near.

### Decisions this relies on

- **No defaults** (mbse-schemas' Parametrics). A question no one answered stays open. A policy is not a default: the
  caller chooses it, it is part of the run's inputs, and every answer it gives is recorded as its own.
- **Determinism** (the opening of [mbse-schemas'
  design](https://github.com/pitaman71/mbse-schemas/blob/main/docs/FRAMEWORK.md): bindings "can be automatically and
  deterministically generated"). The same source, policies and answers give the same steps, the same trace and the same
  target, in every implementation.
- **Programs are trees, never text templates** (mbse-programs). A codegen step writes syntax nodes; printing is the
  target language's own, last.

## A session

A session runs one transform over one source. Both implementations offer the same API; in Python:

```python
session = Transforms.Session(transform, {"module": module}, policies=[house_style])  # before's symbols, checked
while (offered := session.next()):                     # the candidates, in a deterministic order
    candidate = offered[0]
    if candidate.open:                                 # parameters, or a choice, still unanswered
        candidate = candidate.answer(layout="tagged")  # from a person or an agent; browse candidate.options("layout")
    session.take(candidate)
session.run()                                          # takes what policies answer; stops at a question
session.trace, session.after["unit"], session.questions  # the record, after's models (checked), what is open
```

- **`next()`** gives the candidates the transform offers now, in a canonical order: by the source elements they read,
  in the source's own order (a module's declared order, a tree's pre-order), then by the step types' declared order.
  Nothing depends on hash order, a clock or memory addresses. A random choice, where a transform wants one (generated
  test data), draws from a `Stores.PCG32` seeded by an argument, so it too is an answer.
- **`take(candidate)`** refuses a candidate with open questions, applies its effect, records the step and its
  decisions, and moves on.
- **`run()`** takes every candidate the policies answer fully, in order, and stops at the first that needs a person or
  an agent. With a policy that answers everything, a session is a batch generator; with none, every choice is asked.
- **A transform is done** when no candidate is left. It is **complete** when every source element is covered by some
  step (each step type's `covers` role), which a session reports, so that an element no step type can render is a
  finding ("no step covers union `Reach`"), never silently dropped. Today's transpilers' refusals ("a spread in an
  object literal is not supported") become exactly that.
- **Steps compose.** A step type may itself be a sub-transform (rendering a union is choosing a representation, then
  rendering each branch), and its steps are kept nested in the trace, so a person can look at a decision at the level
  it was made.

## Diff (optional)

What is compared is data, so a diff is a comparison of snapshots. Three diffs are useful:

- **Source diff**: what changed in the model. It needs element identities that survive a change, which snapshots'
  symbols do not (they are numbered in first-reference order; see mbse-schemas' design, Open questions, labeling
  objects outside snapshots). A transform names elements by their **path** from one of before's or after's symbols: the
  symbol, then property
  names and list keys within its model (`module.schemas[Contact].properties[home]`), the same in both implementations.
- **Trace diff**: what was decided differently. A step's **key** is its step type and the paths of the elements it
  reads; two traces' steps match by key, and a diff lists steps added, removed, and taken with different arguments,
  each with its decisions' origins.
- **Target diff, explained**: what changed in the output, and why. Every target element links to the step that wrote
  it, and that step to the elements it read and to its decisions, so a changed line of generated code is traced to the
  model change or the answer that caused it.

`Session.diff(other)` gives the trace diff and the explained target diff. Diffing stores in general (two snapshots,
mutations as data) is mbse-journals' (planned), which transforms would use rather than duplicate.

## Incremental rebuild (optional)

After the model changes, a session reruns the transform and asks only what is new.

- **Decisions survive.** Every decision is keyed by its step's key and its parameter. A rerun answers a question from
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

Two levels, each a property a step type may have:

- **Undoable.** Every step's effect is recorded as mutations with what they replaced (created, and so deletable;
  updated, from an old value), so `session.undo()` takes back the last step exactly. Undoing to any point and taking
  other candidates explores an alternative; both branches are traces, and so can be diffed. Every step type is undoable
  when its effect is expressed as mutations, which the session can require.
- **Invertible.** A step type may declare its **inverse**: a step type of the reverse transform, which reads what the
  step wrote and, with the step's own arguments, writes back what the step read. The arguments are exactly the
  information the forward step decided and the target does not show (lenses call it the complement): "this C++ class
  was rendered from a value object schema, with `layout=struct`". A transform is invertible over a trace when every
  step in it is; a session names the steps that are not. Two uses follow:
  - **round trip**: from a target and its trace, the reverse transform gives back the source, and the forward
    transform from that source, with the trace's decisions, gives back the target;
  - **edit propagation**: when someone edits the generated code, the target diff names the steps whose output
    changed; their inverses, with incremental rebuild in reverse, give the changed source, or name the edit that no
    inverse can carry back ("this edit is to a line no step can read back").

  An invertible step type is checked by its tests for the two laws such pairs must keep: taking the step and then its
  inverse gives back what was read, and taking the inverse and then the step gives back what was written. Existing
  candidates for invertible steps: mbse-expressions' translation rules already pair a left and a right pattern in both
  directions (`Rule(left, right, direction='both')`), and mbse-schemas' dataclass adapters are a forward and a
  reverse transform (`ToDataclass`, `FromDataclass`).

## Data

Everything a session keeps is mbse-schemas data, in one store of the session, so that its relations link elements
(stores are isolated, so the source is read into the session's store as a snapshot):

- `Transforms.Step`: a value object, its step type's name, its key, its arguments (as an application's are written:
  `{"name", "value"}` or `{"name", "term"}`), and each argument's decision (`caller`, `policy` with the clause's
  position, `reused`); a step of a sub-transform holds its own steps in a list.
- Relations from a step to elements, one per role: `Reads(step, element)`, `Covers(step, element)`,
  `Creates(step, element)`, `Updates(step, element)`, each with the element's path; and, where recorded,
  `Fingerprint` and the step's effect as mutations.
- `Transforms.Trace`: a reference object holding the steps in order, the transform's name and version, and the
  policies it ran with.
- `Transforms.Policy`: clauses, each a step type, a parameter or a choice point, a value, and a guard (a predicate's
  name and arguments).

A step type is code: like an expression kind (mbse-expressions), it is a class with a meta-schema, registered by name
with its transform, so a trace written by one implementation is read by the other, and replays there to the same
target.

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

1. **Core**: step types, candidates, choice points, sessions, policies and traces as data, in both languages, with the
   determinism test that two runs (and the two implementations) give byte-identical traces and targets.
2. **A first transform with both directions**: mbse-schemas' `ToDataclass` and `FromDataclass` as one invertible
   transform (schemas to Python's `ast` and back), which tests undo and inversion on a small, known case.
3. **Diff and reused decisions**: paths, keys, trace diffs, and reruns that reuse decisions and report orphans.
4. **Incremental rebuild**: recorded reads, fingerprints and invalidation, tested against runs from scratch.
5. **mbse-codegen-python**, then the other codegen repositories, each step type with its parameters documented, and
   the existing translators, transpilers and bridges rebuilt as transforms.

## Open questions

- **Inverse predicates.** A transform's inverse swaps before and after. An invertible transform's after must then be
  strong enough to be the inverse's before; should that be checked when a step type declares its inverse?
- **Step granularity.** One step per source element and decision is inspectable but long; larger steps are short but
  hide choices. A sub-transform keeps both, at the cost of nesting. Where should the default grain be?
- **Conflicts.** Two candidates that write the same target element (two step types both claiming a union) are a
  choice point if they are offered together; if they are offered at different times, the later one must see the
  earlier's effect. Is "the earlier step wins, the later is not offered" enough, or do step types declare conflicts?
- **Total or partial order.** A trace is a total order, for determinism; incremental rebuild and parallel runs want
  the partial order of what read what. The partial order follows from recorded reads; should the trace keep it?
- **Paths that survive renames.** A renamed schema changes every path under it, which orphans its decisions. Should a
  source diff detect renames (same content, new name) and carry decisions over, or should the person confirm?
- **Options as types.** A parameter's options as a union's branches need no new machinery, but a union value of an
  empty value object is verbose on the wire. An enumeration of literals needs constraints on a native, which are
  planned here. Which first?
- **Reading cost.** Recording every read through visitors costs time on large models. Is coarser recording (per
  element, not per property) enough for invalidation in practice?
- **Partial inverses.** A step whose inverse holds only for some arguments (a lossy rendering) could declare where it
  is invertible, as a constraint over its arguments. Is that worth having, or is "invertible or not" per step type
  enough?

---

<!-- nav -->
[← Equivalence](EQUIVALENCE.md) · [Home](../README.md) · [Conformance corpus →](../conformance/README.md)
