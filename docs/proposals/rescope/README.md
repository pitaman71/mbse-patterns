<!-- nav -->
[← FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md) · [Home](../../../README.md)

# Charter: mbse-patterns afresh (for review)

mbse-patterns is started again from scratch, as the user decided on reading the port proposal this replaces: "The
proposal seems so long relative to the amount of function that I expect will be left in mbse-patterns. I take this as
an indication it might be simpler and safer to start from scratch." Its scope is distributions, sampling, generators
and characterizers; on transforms: "yes transforms goes in its own repo",
[mbse-transforms](https://github.com/pitaman71/mbse-transforms). No code is written until this charter is decided.

## Why it exists

Patterns over data, as models
([FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md)): a pattern
says how its matches are distributed, so that data is generated from it and its distributions are fit from data.

## What it is

- **Distributions**
  ([CAP-072: distributions in predicates](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-072.md)):
  - weighted choices, with constraints on how many arms hold and in what order;
  - drawn values (normal and the like, rounding);
  - each tied to the variables of mbse-schemas' `OfPattern`;
  - stored as schema data, as the user decided for dialects, "Dialects should be models", and for what a domain means,
    "inferred properties are still properties"
    ([mbse-expressions' domains proposal](https://github.com/pitaman71/mbse-expressions/blob/main/docs/proposals/domains/README.md));
    as mbse-patterns' own schemas, not a dialect of mbse-expressions (Decided, 1).
- **Sampling** (part of
  [CAP-042: data generated from constraints](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-042.md)):
  deterministic draws over mbse-schemas' `Stores.Random`, byte-identical across languages. The one module carried
  over, nearly verbatim: it still imports and draws against its siblings.
- **Generators** ([CAP-042](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-042.md)):
  `Generate` and `Sample` over patterns, each step on its own split stream
  ([PRI-013: nondeterminism passed in](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-013)).
  Rejecting a draw whose `requires` does not hold waits on the executor evaluating expressions
  ([CAP-142: expressions evaluated in queries](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-142.md#blocked),
  Blocked), so the first version generates from specs and distributions only.
- **Characterizers**
  ([CAP-073: distributions fit from data](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-073.md)):
  fitting distributions from data. New.

## What it is not

- Predicates, constraints and queries: mbse-schemas' `OfPattern`, specs and executor now.
- Validators: mbse-schemas' validation, once CAP-142 is met
  ([CAP-029: three-valued constraint checking](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-029.md)).
- Transforms: [mbse-transforms](https://github.com/pitaman71/mbse-transforms).

## Siblings and pins

- [mbse-schemas](https://github.com/pitaman71/mbse-schemas), at its current release (0.26.9 when this was written).
- [mbse-expressions](https://github.com/pitaman71/mbse-expressions), 0.8.0 when released; its checkout's main until
  then ([PRI-031: the version is the contract](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-031)).

## Stages

Each stage passes both gates at 100% in both languages, on Node 22, 24 and 26, with its tests, tutorials, corpus cases
and skill practices written for what it adds, the same cases in both languages.

1. **A fresh package skeleton.** The old code is removed: every module, its 9 test suites, 8 tutorials, corpus cases
   and skill practices. None is ported; each later stage writes its own anew. Release 0.9.1 stays tagged, for its
   dependents and as mbse-transforms' precursor.
2. **Sampling**, carried over.
3. **Distributions.**
4. **Generators.**
5. **Characterizers.**
6. **Release.**

## Decided

1. **Distributions as a dialect of mbse-expressions, or mbse-patterns' own schemas?**
   - (a) A distribution dialect in mbse-expressions, its terms in a pattern's `requires`.
   - (b) mbse-patterns' own schemas: reference objects linked to an `OfPattern`'s variables, built through mbse-schemas'
     builders.
   - **Decided: (b)** (the user, 2026-11-05, accepting the recommendation). A draw is not a function of its arguments: evaluating one needs a random source, which
     sampling here holds and mbse-expressions' evaluators do not. Either way it is schema data, as decided.
2. **The version.**
   - (a) 0.10.0, the next minor after 0.9.1.
   - (b) 1.0.0.
   - **Decided: (a)** (the user, 2026-11-05, accepting the recommendation). Below 1.0 a breaking change bumps the minor (PRI-031). 1.0.0 would promise stability that a
     first version, with generation partly blocked, cannot keep.
3. **mbse-codegen-python's 41 uses of predicates** (`Exists`, `Contains`, `OfPredicate`): wait for mbse-patterns, or
   move elsewhere?
   - **Decided: move** (the user, 2026-11-05, accepting the recommendation), in mbse-codegen-python's own port, to mbse-schemas' `OfPattern` and mbse-expressions'
     `Patterns` quantifier. A fresh mbse-patterns holds no predicates, so waiting for it gains nothing. Uses that need a
     `requires` evaluated wait on CAP-142 either way.

## Risks

- **FEA-023's proven space shrinks before it grows.** CAP-029, CAP-042 and CAP-072, and the predicate and query
  capabilities, are recorded as met by mbse-patterns 0.9.1 on mbse-schemas 0.10.0. Stage 1 removes that code, and their
  new homes are blocked or not met. Their Current entries in mbse-basis are corrected in stage 1.
- **Blocked on siblings.** Rejection, and `Sample` where a weight depends on a `requires`, wait on CAP-142. Characterizing inside a transaction would
  wait on the parked collecting reduce. Each gap is reported, never worked around
  ([PRI-032: a sibling's gap is reported, not worked around](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-032)).
- **mbse-expressions 0.8.0 moves underneath.** Its main is mid-plan, so stages may be re-pinned.
- **Byte-identity.** Sampling's ports of `log` and `exp`, PCG32's streams, and the corpora must stay identical across
  languages through the new data.
- **Dependents stay on 0.9.1.** mbse-codegen-python pins it until its own port, where its predicates move (Decided, 3) and mbse-transforms.
- **Names.** "Patterns" now names this repository, mbse-schemas' `OfPattern` and mbse-expressions' `Patterns`
  dialect; this repository's schemas need module names distinct from the dialect's.

## Reference

mbse-basis: [FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md),
[CAP-042: data generated from constraints](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-042.md),
[CAP-072: distributions in predicates](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-072.md),
[CAP-073: distributions fit from data](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-073.md)
and [CAP-029: three-valued constraint checking](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-029.md).

---

<!-- nav -->
[← FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md) · [Home](../../../README.md)
