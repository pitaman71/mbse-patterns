<!-- nav -->
[← FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md) · [Home](../../../README.md)

# Re-scoping mbse-patterns (a proposal, for review)

mbse-patterns no longer imports against its siblings, and half of what it does now belongs to them. mbse-schemas' store
overhaul replaced its predicates with `Schemas.OfPattern`, and its step 5 ports the dependents. For this repository the
user chose a re-scope over a port: "mbse-patterns should be rescoped as recommended" (2026-10-28). What it did with
predicates is mbse-schemas' `OfPattern` now. It takes up what
[FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md) gives it
beside them: generators, characterizers, and patterns as distributions over constraints. This document proposes how to
do that and asks what only the user can decide. No code is written until it is decided.

## Where it stands

**Version and pins.** mbse-patterns 0.9.1 (both languages) pins mbse-schemas 0.10.0 and mbse-expressions 0.5.4
(`siblings.json`; Python's `mbse-schemas>=0.10.0,<0.11`, `mbse-expressions>=0.5.4,<0.6`). The siblings are now
mbse-schemas 0.26.8 and mbse-expressions 0.7.0, whose main also holds the unreleased complete-dialects work (`Patterns`,
formerly Basic, and `Python3`).

**What fails.** Checked in a throwaway venv against the sibling checkouts (mbse-schemas main at 0.26.8, mbse-expressions
main at `4b4ad6d`):

- The package fails at import: `mbse/Patterns/__init__.py` imports every module, and `Constraints` imports
  `mbse.Schemas.Framework.Bindings`, which is gone.
- Imported one at a time, only `Sampling` imports, and it draws as before, since `Stores.Random` and `Stores.PCG32` are
  still mbse-schemas'. Every other module fails:
  - `Predicates`, `Distributions`, and through them `Queries` and `Generators`, on `mbse.Expressions.Dialects.Python.Text`.
    The dialect is now `Python3`, and `FromFunction` was removed in 0.7.0.
  - `Constraints`, `Validators` and `Transforms` on `Bindings`.
- 29 of the 58 distinct sibling names the Python modules use are gone: `Bindings` (all of it), `Modules`,
  `Schemas.Form`, `Schemas.OfNative`, `Schemas.OfIndexed`, `Stores.Store`, `Visitors.Visitable`, `Terms.Declared`,
  `Terms.ValueProperty`, `Terms.Builder`, `E.OfOperation`, `E.OfVariable`, `E.OfQuantifier`, `Text.FromFunction`,
  `Validators.entries_of` and their kin.
- TypeScript imports `Bindings` and `Modules` from `@mbse/schemas/Framework`, which no longer has either. That was
  checked by reading the code, not by type-checking it.
- The underlying problem is design, not names. Its terms are bespoke dataclasses, each a reference object with a
  meta-schema (`Patterns.Predicate`, `Patterns.OfChoices`). The decisions since then make terms values held by an
  expression ([CAP-226: complete expression dialects](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-226.md#decided)),
  and they forbid code written per model ([PRI-018: no model needs code to read or write](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-018)).

**Per module.** Lines of library code, Python / TypeScript, and what each holds:

| Module | Lines | Holds | Capability |
|---|---|---|---|
| `Predicates` | 625 / 746 | `OfPredicate` (symbols, parameters, `requires`, `forbids`), `OfApply` (application by reference, recursion), `OfSet`, the quantifiers `OfExists`, `OfForall` over `OfExtent`, `Contains`, `Evaluator(store)`, `holds`, `DIALECT` extending Basic | [CAP-150](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-150.md), [CAP-152](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-152.md) |
| `Constraints` | 85 / 73 | `OfStore` (`Builders`), `register`, `check` | [CAP-150](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-150.md) |
| `Validators` | 80 / 96 | `Validate(store, predicates)` and `.Reachable`, three-valued (`unknown`: report, ignore, violation) | [CAP-029](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-029.md) |
| `Queries` | 233 / 257 | `select`, `Scan` (the planner: early tests, hops, `unique`), `explain`, `QueryableStore` | [CAP-151](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-151.md) |
| `Distributions` | 507 / 561 | `Choices`, `Arm`, `Count`, `Uniform`, `Normal`, `Poisson`, `Geometric`, `Categorical`, `Option`; `domain`, `witness`, `typing`; `weigh` (in `Predicates.Evaluator`) | [CAP-072](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-072.md) |
| `Sampling` | 182 / 196 | `uniform`, `below`, `weighted`, `between`, `normal`, `poisson`, `geometric`, and `log` and `exp` ported from fdlibm | [CAP-042](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-042.md) |
| `Generators` | 218 / 239 | `Generate` (a `Generation`: `steps`, `rejected`), `Sample`, `check`, `ATTEMPTS` | [CAP-042](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-042.md) |
| `Transforms` | 638 / 698 | `Transform`, `Session`, `Candidate`, `Policy`, `Clause`, `Step`, `Link`, the trace (`Trace`, `steps`, `register`), `Diff`, `diff`, `Matched`, `Wrote`, `records` | [CAP-074](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-074.md) to [CAP-076](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-076.md) |
| Characterizers | none | designed, not built | [CAP-073](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-073.md) |

In total, 2,587 lines of Python and 2,888 of TypeScript, plus the conformance writers (183 and 191).

**Tests, tutorials, corpora and the skill**, the same in both languages:

- **Tests**: 9 suites, 51 cases a language. CON 7, VAL 5, QRY 8, CONF 3, SKL 2, ALG 3, DST 7, GEN 7, TRF 9.
- **Tutorials**: 8, with 36 anchored steps. 1 to 4 cover predicates, queries, links and parameters; 5 to 7 populations,
  values and generating; 8 transforms.
- **Corpus**: 7 cases, each as JSON and YAML in both languages: `predicates`, `empty`, `algebra`, `weights`,
  `generated`, `drawn` and `traced`. The [corpus README](../../../conformance/README.md) does not list `traced`.
- **Skill**: one source, `skills/mbse-patterns/SKILL.md`, with 14 practices. Its 65 links a language reach 53 distinct
  notebook anchors. Practices 1 to 8 teach predicates, validators and queries, 9 to 11 patterns and generators, and 12
  to 14 transforms.

**What the siblings now cover.**

- **mbse-schemas 0.26.8** ([CAP-137: patterns of symbols, variables and specs](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-137.md)
  and [CAP-138: mutation expressions over frame streams](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-138.md)):
  - `Schemas.OfPattern`: symbols bound to reference objects, variables assigned values, `requires` (`Schemas.OfConstraint`)
    and a `spec`, all schema data defined in modules.
  - `Schemas.OfExpression`, `Schemas.OfCollector`, and parameters through `Parametrics`.
  - The mutation terms `OfMap`, `OfReduce`, `OfPartition`, `OfUpdate` and `OfUpsert`, and an in-memory, sequential
    executor that matches and writes by specs.
  - `store.mutation` returns the frames that reached the end of a chain.
  - Validation of data against its schemas: `Validators.Validate`, which evaluates no term
    ([CAP-160: data validated against its schema on request](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-160.md)).
  - The executor refuses every expression: a pattern's `requires` and variables, a collecting reduce, a branch's
    `requires` ([CAP-142: expressions evaluated in queries](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-142.md#blocked),
    Blocked).
  - The evaluator protocol the executor is to be given is not built yet.
  - `contains` is not built yet.
  - Planning from specs and constraints is not met
    ([CAP-146: queries planned from specs and constraints](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-146.md)).
- **mbse-expressions main**:
  - The `Patterns` dialect, formerly Basic, with its `quantifier` over a collection.
  - The decision that a quantifier takes a `Schemas.OfPattern` as its sole argument, which is not built yet.
  - Evaluators, and the writers, which stay until the dependents move off them.
- **What remains mbse-patterns' own**: distributions and weighted alternatives, sampling, generators, characterizers.
  Transforms remain here for now, and their home is question 7.

**Dependents.**

- **mbse-codegen-python** pins mbse-patterns 0.9.1 and old siblings. Its `Types` module is built on `Transforms` (11
  `Transform`s, 10 `Clause`s, 3 `Policy`s, 8 `Session` uses) and on predicates (`Exists` 18, `Contains` 16,
  `OfPredicate` 7). Its TypeScript package declares `@mbse/patterns`.
- **mbse-programs'** [port](https://github.com/pitaman71/mbse-programs/blob/main/docs/proposals/port/README.md) keeps
  mbse-patterns out of scope now. Its decided scope is "not reference front ends or mbse-patterns' transforms". Later
  it expects "transpilers and bridges rebuilt on mbse-patterns' transforms"
  ([CAP-074: transforms applied step by step](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-074.md)).

## Decided, that applies

As the user decided, quoted as written.

- **The re-scope** (mbse-schemas, [Store overhaul](https://github.com/pitaman71/mbse-schemas/blob/main/docs/proposals/store-overhaul/README.md),
  Order of work, step 5). Step 5 says: "As the user decided (2026-10-28), mbse-patterns is re-scoped, not ported as it
  stands ("mbse-patterns should be rescoped as recommended"): what it did with predicates is mbse-schemas' `OfPattern`
  now, so it takes up what FEA-023 gives it beside them (generators, CAP-042; characterizers, CAP-073; patterns as
  distributions over constraints, CAP-072), proposed when it starts." It also sets the order: "mbse-expressions first,
  which the others depend on; then mbse-patterns and mbse-programs; mbse-codegen-python last."
- **`OfPredicate` goes**: "OfPredicate goes away, consider that decided". `OfPattern` replaces it (object identity 67,
  [CAP-137: patterns of symbols, variables and specs](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-137.md#decided)).
- **Basic is renamed Patterns, and a quantifier takes a pattern** (2026-11-02, mbse-expressions'
  [complete dialects](https://github.com/pitaman71/mbse-expressions/blob/main/docs/proposals/dialects/README.md#decided),
  Decided):
  - "former `Expressions.Dialects.Basic` should be renamed `Expressions.Dialects.Patterns`. Any quantiier should take a
    Schemas.OfPattern as its sole argument."
  - The proposed reading, which the user confirmed ("Yes"): the pattern's symbols and variables are what the
    quantifier binds; its `spec` is what it ranges over; its `requires` is what it tests.
- **Containers in patterns**: "Yes, patterns need to be enabled to bind container expressions."
- **`contains` is a visitor method, tentatively** (the same Decided):
  - "yes, in a spec. Maybe 'contains' is a visitor method."
  - Then: "Maybe 'contains' is a method on `Visitors.OfContainer` *and* `Visitors.OfAdjacency`."
  - "in a container, `contains` can only be called with a value or variable of compatible schema / in an adjacency,
    `contains` can only be called with a symbol or builder of compatible schema".
  - This is work for mbse-schemas, and its execution waits on the parked map and reduce.
- **Validation by constraints**: "validation will be by constraints not by schema" (the same Decided, 4). That a
  dialect's expression holds only its own terms is a constraint, not the schema's closure.
- **Evaluation's semantics, open**: mbse-expressions' [port](https://github.com/pitaman71/mbse-expressions/blob/main/docs/proposals/port/README.md#decided),
  question 6, asks what a `requires` that evaluates to unknown does. The user's answer: "semantics of evaluate deserve
  a more in-depth discussion". It is open.
- **Map and reduce, parked**: "After consideration, map and reduce are not where I need them to be, but parking them so
  we can make progress on finishing the current overhaul in the dependent repos is more urgent" (2026-10-29,
  [CAP-142: expressions evaluated in queries](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-142.md#blocked),
  Blocked). A map's variables and a collecting reduce wait on them. A variable over a finite domain is in the plan:
  "(b) is in the plan". Solving for a variable's values "can be deferred".
- **The executor's evaluator is a protocol in mbse-schemas, given to a store once**, "a fine intermediate solution for
  now" (the port's Decided, 5).
- **`FromFunction` is removed**: "Let's just remove that capability entirely". The writers are kept until the
  dependents move off them, then go ("Expressions under P-018": they "should go away"; the port's Decided).
- **What leaves mbse-schemas** (schema extension 5 and 13,
  [FEA-024: expressions as data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-024.md#decided)):
  - `requires` "moves out of mbse-schemas all the way out to `mbse-patterns` using the new extension mechanism".
  - "All object/relation functionality is moving up to mbse-patterns".
  - Both predate `OfPattern`. Its `requires` (`Schemas.OfConstraint`) is now mbse-schemas' own, with its terms from
    mbse-expressions. Question 1 asks the user to confirm that the re-scope supersedes them.
- **Standing rules**:
  - "Never guess the schema" ([PRI-025: never guess the schema](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-025)).
  - "Never use wire format in examples".
  - "Do not invent another DSL by wrapping builder syntax" ([PRI-019: fluent builder syntax](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-019)).
  - "No model should need code to read or write. Ever." ([PRI-018: no model needs code to read or write](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-018)).
  - Concrete references are paths, not string names: "Code expressions that name a reference object use Paths, not
    string lookup" ([PRI-015: concrete references are programmatic](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-015)).
    PRI-015 names `Transform("Label", ...)`, `Clause("Label", ...)`, and `E.variable("c")` beside `pred.c`, here, as
    not yet applied.
  - Nondeterminism is passed in ([PRI-013: nondeterminism passed in](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-013)).
  - "An absence of constraints is interpreted as acceptance of any configuration of the model"
    ([PRI-020: no constraint, any configuration](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-020)).
  - Decisions are recorded completely, quoting the user.

## Questions for the user

1. **What stays, what moves, what goes.** Proposed, module by module:

   | Today | Where it goes | Why |
   |---|---|---|
   | `OfPredicate`: symbols, parameters, `requires`, `forbids` | goes; mbse-schemas' `Schemas.OfPattern` (symbols, variables, `requires`, `spec`) and `Parametrics` | object identity 67; `forbids` is a negated constraint, nothing of its own |
   | `OfApply`, application by reference, recursion | goes; mbse-expressions' bindings (`Parameters.Bind`, `Apply`), when built | schema extension 6: "all bindings will need to move into mbse-expressions" |
   | `OfSet`, `Constraints` (`OfStore`, `register`, `check`) | goes; patterns are schema objects defined in modules, checked by mbse-schemas' validation | object identity 66 |
   | `Exists`, `Forall`, `OfExtent` | goes; a quantifier of the `Patterns` dialect taking a `Schemas.OfPattern` | decided 2026-11-02 |
   | `Contains` | goes; `contains` on `Visitors.OfContainer` and `Visitors.OfAdjacency`, in a spec | tentative, 2026-11-02 |
   | `Evaluator(store)`, `holds` | goes; mbse-expressions' evaluator, given to the store through mbse-schemas' protocol | the port's Decided, 5 |
   | `Queries` (`select`, `Scan`, `explain`, `QueryableStore`) | goes; mbse-schemas' executor (`OfMap.as_symbols` over a pattern). The planner's shapes (early tests, hops, `unique`) are offered as design input to [CAP-146](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-146.md) | `OfPattern` is the query |
   | `Validators` | see below | |
   | `Distributions`, `weigh`, `domain`, `witness`, `typing` | **stays**, rebuilt as schema data (question 3) | 2026-10-28 |
   | `Sampling` | **stays**, as is | it imports and draws today |
   | `Generators` (`Generate`, `Sample`) | **stays**, rebuilt (question 4) | 2026-10-28 |
   | Characterizers | **new here** (question 5) | 2026-10-28 |
   | `Transforms` | question 7 | |

   - **Where `Validators` goes.** Checking data against a pattern's constraints, three-valued and on request
     ([CAP-029: three-valued constraint checking](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-029.md)),
     has three possible homes:
     - (a) mbse-schemas' `Validators`, given the same evaluator protocol the executor takes, so that structure and
       constraints are checked in one place;
     - (b) a thin `Validators` kept here, over the executor's frames, with today's labels and `unknown` policy;
     - (c) mbse-expressions.
   - *Recommended: the table as stated, and (a) for validators.* (a) is the lowest repository that can own validation
     without gaining a dependency ([PRI-011: the lowest repository that can own it](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-011)).
     It changes [CAP-160](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-160.md)'s "takes
     no evaluator", and its unknown waits on question 6.
   - Confirm also that the re-scope supersedes schema extension 5 and 13 ("`requires` ... all the way out to
     `mbse-patterns`"; "All object/relation functionality is moving up to mbse-patterns"). Under the re-scope,
     `requires` stays in mbse-schemas' `OfPattern`.

2. **FEA-023's capabilities, and its proven space in the meantime.** The basis says "A feature's proven space should
   only grow". CAP-150, CAP-151, CAP-152 and CAP-029 are met today only by mbse-patterns 0.9.1 on mbse-schemas 0.10.0.
   Their new homes are blocked or not met: CAP-142 is blocked, CAP-146 is not met, and the quantifier over a pattern
   and `contains` are not built.
   - (a) Supersede those four now with capabilities in mbse-schemas and mbse-expressions, which still implement FEA-023.
     Record that FEA-023's proven space shrinks until they are met.
   - (b) Keep them as they are, citing 0.9.1, until their replacements are met. That leaves this repository's main
     unable to import against its siblings.
   - (c) Port today's predicates to the new siblings first, then remove them. This builds twice, which the port
     declined for mbse-expressions (its question 1).
   - *Recommended: (a).* The proven space already rests on mbse-schemas 0.10.0, sixteen minor releases old. The new
     capabilities' IDs and wording are drafted in stage 1 for review: the quantifier over a pattern, `contains`, and
     constraint-checking validation.

3. **How distributions attach to patterns** ([CAP-072: distributions in predicates](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-072.md)).
   Today a distribution is a term of the constraint that binds a symbol within its body, and `Choices` is a term whose
   arms are conditions.
   - (a) **Terms of a dialect of this repository's**, kept in the constraint as today, added to
     `Expressions.Framework.Term` as a branch. Whether an install outside mbse-expressions may add a dialect is not
     settled. The user's rule for language dialects is that gaps "should be added into `mbse-expressions`".
   - (b) **Operations of the `Patterns` dialect**, defined as data (`Schemas.OfExpression`, named through `Operates`).
     A draw is not a function of its arguments, so evaluating such a term needs a random source the dialect does not
     have.
   - (c) **Schema data beside the pattern.**
     - A distribution of values is a reference object of this repository's schemas, linked to a pattern's variable
       (`Schemas.OfVariable`, "assigned a schema-governed value"). That is what a distribution of values draws.
     - Its parameters are values or expressions over the pattern.
     - Weighted alternatives (`Choices`) relate a pattern to weighted arms, each a pattern or a constraint.
     - Everything is built through mbse-schemas' builders, and the `Patterns` dialect is unchanged, as decided
       ("Patterns (formerly Basic), Matlab, Excel and Latex otherwise unchanged").
     - A drawn value reaches a property through the pattern's spec or `requires`, as any variable does.
   - *Recommended: (c).* It keeps distributions as data with no code of their own (PRI-018, PRI-019). It needs no new
     dialect or random operations. It uses `OfPattern`'s variables for what they declare.
   - **The open point under (c)**: whether an arm's weight is a property of an entry of this repository's own relation
     (allowed) or of an extension's adjacency (not allowed: "an extension's adjacency is to a relation of two links and
     no properties").

4. **How generators produce data from patterns and constraints** ([CAP-042: data generated from constraints](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-042.md)).
   Today `Generate` builds objects with a store's builders and redraws until the predicate holds. Since 0.22, every
   write is in a transaction.
   - (a) **A generator gives a spec per generated match, which the caller writes in a transaction**, as mbse-programs'
     `parse` and `transpile` were decided to ("`parse` and `transpile` each giving a spec that the caller writes in a
     transaction").
     - It draws a frame's variables (question 3) from the seed's streams, split as today.
     - It accepts the frame where the pattern's `requires` holds, evaluated by mbse-expressions' evaluator, and redraws
       otherwise, up to `ATTEMPTS`.
   - (b) **The executor generates**: a map's variables fan out over a distribution's draws, and an upsert writes them.
     This is the parked "spread" case with a random source, and it waits on map and reduce.
   - (c) **Generating by resolving constraints**: "(c) can be deferred".
   - Under every option, unconstrained aspects are left to entropy (PRI-020), and the source is passed in (PRI-013).
   - *Recommended: (a) now; (b) offered when map and reduce are taken up again; (c) later.*

5. **Characterizers** ([CAP-073: distributions fit from data](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-073.md)),
   which fit a pattern's distributions from data in one pass and bounded memory.
   - (a) A fold kept here, over the frames a transaction returns (`store.mutation` returns them).
   - (b) A collecting reduce (`OfReduce` with an `OfCollector`). Online estimators (counts, Welford's mean and
     variance) merge commutatively and associatively, as a collector must declare. This waits on reduce.
   - (c) Both: (a) now, its estimators written so that a collector can hold them later.
   - *Recommended: (c).* Its result is a pattern with distributions (question 3), round-tripping with the generators,
     as CAP-073 has it.

6. **The parked map and reduce, and question 6.** What waits, and what can proceed now:

   | Waits on | What here |
   |---|---|
   | map's variables (the parked "spread") | generating inside a transaction (4b); executing `contains` |
   | reduce (a collecting reduce, parked) | characterizing inside a transaction (5b) |
   | the executor evaluating `requires` ([CAP-142](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-142.md), the evaluator protocol) | `Sample` (drawing a store's matches by weight, where arms hold constraints); validators (1a) |
   | question 6, what an unknown `requires` does | validators' `unknown`; a query's unknown matches; whether an unknown arm weighs; generation's acceptance |

   **Proceeds without them**:
   - `Sampling`, which imports today.
   - Distributions as data: installs, builders, wire, corpora, `domain`, `typing`, and support and witness checks.
   - `Generate` as 4a, if mbse-expressions' evaluator, called directly over a drawn frame, evaluates a pattern's
     `requires`. That is to be checked, and reported under Blocked if not
     ([PRI-032: a sibling's gap is reported, not worked around](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-032)).
   - Characterizing as 5a, over frames the executor matches by spec.

   - *Recommended: proceed with those.* Offer this repository's three-valued practice to question 6's "more in-depth
     discussion" as input, not as a decision:
     - a validator's `unknown` is the caller's choice (report, ignore, violation);
     - a query gives unknown matches only when asked;
     - a generator accepts only what holds;
     - a transform's match is undecided where before or after is unknown.

7. **Transforms' home** ([CAP-074: transforms applied step by step](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-074.md)
   to [CAP-083: policies with guards and distributions](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-083.md)).
   Re-scoped, transforms take little from this repository:
   - their before and after are `OfPattern`s, which are mbse-schemas';
   - their matches are the executor's frames;
   - a rewrite is a transaction;
   - only CAP-083's policies weighed by distributions, not met, would need this repository.

   The 2026-10-28 decision names FEA-023's generators, characterizers and distributions, not transforms
   ([FEA-021](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-021.md)'s).
   - (a) **Stay here**, as CAP-074's "Where it lives" has it, ported in a late stage before mbse-codegen-python, their
     only consumer.
   - (b) **A repository of their own**, mbse-transforms, which CAP-074 foresees "If transforms outgrow this
     repository". It would depend on mbse-schemas and mbse-expressions, and on this repository only for CAP-083.
   - (c) **mbse-expressions**, which PRI-011 suggests, since it has every dependency transforms need. That would let its
     translators use them ("translation across languages belongs to transforms", the user's, in the port). Against it:
     [PRI-017: transforms, models, dialects, schemas](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-017)
     layers transforms above dialects.
   - Under every option, a transform and a clause are referenced by path, not by label (PRI-015). The trace is
     installed schemas.
   - *Recommended: (a) for this port, with (b) when mbse-programs rebuilds its transpilers on them*, which its port puts
     after this.

8. **Names.** Three things are now called patterns:
   - this repository (`mbse.Patterns`, `@mbse/patterns`);
   - mbse-schemas' `Schemas.OfPattern`;
   - mbse-expressions' `Patterns` dialect (`Expressions.Patterns`, formerly Basic).

   This repository's schemas were written under a root module `Patterns` (`Patterns.OfChoices`).
   - (a) Keep the repository and package names, which FEA-023 and the user's "mbse-patterns should be rescoped" use. The
     names of its schemas' modules are proposed in stage 1, distinct from `Expressions.Patterns`.
   - (b) Rename the repository and packages for what they now hold, before the next release. Renaming is cheaper now
     than later; the user names it.
   - *Recommended: (a).*

9. **Staging, and which mbse-expressions.** mbse-expressions' complete-dialects plan places mbse-patterns after its
   0.8.0 (its stage 7). Its main already has `Patterns` and `Python3`.
   - (a) Port against the siblings' main as they stand, pinning mbse-expressions 0.8.0 when it is released.
   - (b) Wait for 0.8.0.
   - And either (i) one stage for everything, or (ii) stages that set aside what waits and restore it one stage at a
     time, as mbse-expressions' stage 2a did and mbse-programs' question 10 recommends.
   - *Recommended: (a) and (ii), the stages below.* Development follows the sibling's checkout as it is
     ([PRI-031: the version is the contract](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-031)).

## Stages (proposed, once decided)

Each stage passes both gates at 100% in both languages, with the corpora regenerated. The tutorials and the skill follow
each change as it lands, every link the skill makes to a notebook case existing in both languages. A stage touching a
sibling is made in a workspace (`polyrepo.py workspace <dir> --edit <sibling>`).

1. **The decisions recorded.** This proposal is decided. In a pull request to mbse-basis:
   - FEA-023 is rewritten to the re-scope.
   - CAP-150, CAP-151, CAP-152 and CAP-029 are handled as question 2 decides, and their replacements drafted.
   - The Designs of CAP-072, CAP-042 and CAP-073 follow questions 3 to 5.
   - CAP-074's "Where it lives" follows question 7.
2. **The base, ported.**
   - Pin mbse-schemas 0.26.8 and mbse-expressions' main.
   - Remove what goes (question 1):
     - `Predicates`, `Constraints` and `Queries`, and `Validators` under 1a;
     - CON, VAL, QRY and ALG, 23 cases a language;
     - tutorials 1 to 4;
     - the corpus cases `predicates`, `empty` and `algebra`;
     - skill practices 1 to 8.
   - Set aside what waits: `Distributions`, `Generators`, `Transforms`, their cases, tutorials 5 to 8, and the corpus
     cases `weights`, `generated`, `drawn` and `traced`.
   - Keep `Sampling`, CONF and SKL. The package's own `install(txn)` holds what its schemas will be.
3. **Distributions as data** (question 3):
   - the kinds installed and built through mbse-schemas' builders;
   - linked to patterns' variables;
   - `domain`, `typing`, support and witness checks;
   - DST restored; tutorial 6; the corpus case `drawn`'s pattern.
4. **Generators** (question 4):
   - `Generate` giving specs;
   - seeds and split streams kept byte-identical;
   - rejection through mbse-expressions' evaluator, or reported Blocked;
   - `Choices` and `weigh`;
   - GEN restored; tutorials 5 and 7; the corpus cases `weights`, `generated` and `drawn`.
   - `Sample` follows once the executor evaluates `requires` (CAP-142).
5. **Characterizers** (question 5, (a)): new cases, round-tripping with stage 4's generators, and a tutorial.
6. **Transforms** (question 7, if kept here):
   - before and after as `OfPattern`s, rewrites as transactions;
   - transforms and clauses referenced by path;
   - the trace installed;
   - TRF restored; tutorial 8; the corpus case `traced`.
   - Then mbse-codegen-python ports, as step 5 orders.
7. **Tutorials, skill, README, `llms.txt`, AGENTS.md and EQUIVALENCE; release 0.10.0**, a breaking change.

## Risks

- **FEA-023 shrinks before it grows**: predicates, queries and validators move to siblings where they are blocked or
  not met (question 2).
- **Blocked on siblings**:
  - evaluation in the executor ([CAP-142](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-142.md));
  - question 6;
  - the parked map and reduce;
  - the quantifier over a pattern and `contains`, decided but not built.

  Each gap is reported, never worked around (PRI-032). Stages 4 and 5 may stop at their Blocked.
- **mbse-expressions 0.8.0 moves underneath**: its main is mid-plan (stages 4 to 7), so stages 2 to 4 may be re-pinned
  more than once.
- **mbse-codegen-python stays stranded until stage 6.** Its 33 uses of `Transforms` and 41 of predicates are rewritten
  in its own port, against stage 6's API.
- **Every example is rewritten**:
  - Python's conditions read by `FromFunction` (removed);
  - the bespoke builders (`OfPredicate.Builder()`, `Distributions.Normal.Builder()`) that PRI-018 and PRI-019 forbid;
  - the writers, which go later.
- **Byte-identity**: the fdlibm ports of `log` and `exp`, PCG32's streams and the corpora must stay identical across
  languages through the new data formats.
- **Cost**: every generated match is written in a transaction, in a store that takes about 23 ms to make (the port's
  Risks). Generation throughput needs care.
- **Extension limits**: an extension's adjacency is to a relation of two links and no properties (question 3's open
  point). Patterns, distributions and data share one store: "MBSE does not currently support cross-store references".
- **Stale text** to correct when its stage lands:
  - the README, `llms.txt`, AGENTS.md and the skill, which describe predicates and queries;
  - the corpus README, which lacks `traced`;
  - mbse-basis' "Current: met (mbse-patterns 0.x)" entries, checked against siblings this repository no longer imports.

---

<!-- nav -->
[← FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md) · [Home](../../../README.md)
