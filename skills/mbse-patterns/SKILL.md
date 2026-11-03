---
name: mbse-patterns
description: Write predicates (named constraints over symbols bound to mbse-schemas objects, such as "every adult contact has a phone" or "a contact's phone has a number") as data beside the schemas, validate data against them with three-valued results, and query a store for their matches, lazily and planned from the constraint's shape, in Python or TypeScript. Use when an interface or model has constraints its data must satisfy (MBSE/SysML constraints, interface control documents, data-quality constraints, what others call business rules), when selecting objects of an mbse-schemas store by a condition, possibly relating several objects, when weighting a population by predicates and drawing samples or generating reproducible pseudorandom test data from it, when applying rewrites to a store's data step by step with every decision recorded (transforms, the basis of code generation with people and agents in the loop), or when writing code that imports mbse.Patterns or @mbse/patterns.
---

# mbse-patterns

A predicate is a named constraint over *symbols*, each bound to an object of an
[mbse-schemas](https://github.com/pitaman71/mbse-schemas) schema; it applies to a *match*, which binds every symbol.
It is built fluently, as schemas are, from conditions written with mbse-expressions' Basic expressions and the terms of
the predicate algebra. `Validators` checks data against predicates; `Queries` finds a store's matches for a predicate. A
pattern is a predicate whose constraint weighs alternatives and draws values; `Generators` samples a store's data and
builds new data from it. `Transforms` rewrites a store's data step by step. What each can do is mbse-basis
[FEA-023: patterns over data](mbse:mbse-basis/docs/features/FEA-023.md) and its capabilities.

This skill says why and when to do each thing, and how in general terms, in the names both implementations share. Each
how links its case in the tutorials or tests of each language, where it runs, with its output: read the one for your
language. Where the languages spell a thing differently, [In each language](#in-each-language) says so.

## When to use it

- An interface or model has constraints its data must satisfy, and they must be stored, shared or applied identically in
  several programs or languages.
- You need the objects of an mbse-schemas store, or combinations of them, that satisfy a condition.
- You need test or sample data in a believable mix, reproducibly from a seed.
- You rewrite a store's data, or its schemas, in steps that decide things, and the decisions must be visible, made by
  the right party, and reused when the rewrite runs again.

For the constraints themselves (writing, evaluating, translating expressions), use the
[mbse-expressions skill](mbse:mbse-expressions/skills/mbse-expressions/SKILL.md);
for the data, the [mbse-schemas skill](mbse:mbse-schemas/skills/mbse-schemas/SKILL.md).

## Practices that prevent most mistakes

1. **Write a constraint once, as a predicate, beside the schemas.** *Why*: a constraint copied into each program and
   language drifts. *When*: whenever data must satisfy a condition that more than one program applies. *How*: build a
   predicate with `Predicates.OfPredicate.Builder()`: a name, an optional description, symbols each bound to a *named
   object schema* as the store registers it, and conditions (`.requires(...)`). The constraint's free names are the
   symbols and parameters, written as Basic variables of the same names, or taken from the builder that declares them;
   use only Basic's core vocabulary. `Constraints.check(...)` and every validator and query refuse anything else up
   front, once, not once per match. [CAP-150: predicates as data](mbse:mbse-basis/docs/capabilities/CAP-150.md).
   - Python: [T01.1: a predicate](mbse:mbse-patterns/python3/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.1) · TypeScript: [T01.1: a predicate](mbse:mbse-patterns/typescript5/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.1)
   - Python: [T01.4: constraints that can't be right are refused up front](mbse:mbse-patterns/python3/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.4) · TypeScript: [T01.4: constraints that can't be right are refused up front](mbse:mbse-patterns/typescript5/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.4)
   - Python: [CON-02: Predicates are checked when asked](mbse:mbse-patterns/python3/tests/01_Predicates.ipynb#CON-02) · TypeScript: [CON-02: Predicates are checked when asked](mbse:mbse-patterns/typescript5/tests/01_Predicates.ipynb#CON-02)
2. **A predicate applies to every match.** *Why*: with several symbols, the matches are every combination of their
   objects, so a constraint that doesn't relate them is checked on pairs that have nothing to do with each other. *When*:
   a predicate has more than one symbol. *How*: say in the constraint which combinations matter, that a phone is one
   of the contact's (`Predicates.Contains` over the contact's adjacency), and let `implies` make the rest hold trivially.
   - Python: [T01.3: a constraint about two objects](mbse:mbse-patterns/python3/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.3) · TypeScript: [T01.3: a constraint about two objects](mbse:mbse-patterns/typescript5/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.3)
   - Python: [VAL-02: Reachable checks every match among what the root reaches: the cross product of the symbols](mbse:mbse-patterns/python3/tests/02_Validators.ipynb#VAL-02) · TypeScript: [VAL-02: Reachable checks every match among what the root reaches: the cross product of the symbols](mbse:mbse-patterns/typescript5/tests/02_Validators.ipynb#VAL-02)
3. **Unknown is not false.** *Why*: a constraint that reads an absent property has no answer, and guessing one fails or
   passes data wrongly. *When*: any property can be absent. *How*: choose what unknown means for each use: a
   validator's `unknown` is `"report"` (the default), `"ignore"` or `"violation"`; a query gives unknown matches only
   when asked. Asking whether a property is present (`has`) is not unknown.
   [CAP-029: three-valued constraint checking](mbse:mbse-basis/docs/capabilities/CAP-029.md).
   - Python: [T01.2: checking data](mbse:mbse-patterns/python3/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.2) · TypeScript: [T01.2: checking data](mbse:mbse-patterns/typescript5/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.2)
   - Python: [T02.1: a predicate's matches](mbse:mbse-patterns/python3/tutorials/02_Finding_What_Matches.ipynb#T02.1) · TypeScript: [T02.1: a predicate's matches](mbse:mbse-patterns/typescript5/tutorials/02_Finding_What_Matches.ipynb#T02.1)
   - Python: [VAL-03: An unknown result is reported, ignored or a violation](mbse:mbse-patterns/python3/tests/02_Validators.ipynb#VAL-03) · TypeScript: [VAL-03: An unknown result is reported, ignored or a violation](mbse:mbse-patterns/typescript5/tests/02_Validators.ipynb#VAL-03)
4. **List what you build.** *Why*: queries, quantifiers and `Reachable` see the store's data, what its singletons
   reach; an object built but never linked to them is not found. And `Reachable` follows adjacencies both ways: from one
   contact it reaches its directory, and through it every other contact. *When*: you build objects, or validate from
   anything but the root. *How*: link what you build into the data before you query it; validate one object alone with
   the validator itself (`validate(schema, value)`), and the whole data with `Reachable(schema, root)`. A query reads
   the extents when its first match is asked for, not when it is made.
   - Python: [T02.1: a predicate's matches](mbse:mbse-patterns/python3/tutorials/02_Finding_What_Matches.ipynb#T02.1) · TypeScript: [T02.1: a predicate's matches](mbse:mbse-patterns/typescript5/tutorials/02_Finding_What_Matches.ipynb#T02.1)
   - Python: [VAL-02: Reachable checks every match among what the root reaches: the cross product of the symbols](mbse:mbse-patterns/python3/tests/02_Validators.ipynb#VAL-02) · TypeScript: [VAL-02: Reachable checks every match among what the root reaches: the cross product of the symbols](mbse:mbse-patterns/typescript5/tests/02_Validators.ipynb#VAL-02)
   - Python: [QRY-03: The extents are read when the first match is asked for](mbse:mbse-patterns/python3/tests/03_Queries.ipynb#QRY-03) · TypeScript: [QRY-03: The extents are read when the first match is asked for](mbse:mbse-patterns/typescript5/tests/03_Queries.ipynb#QRY-03)
5. **Write links with the algebra.** *Why*: a link constraint is about entries of a relation, which neither a property
   test nor a loop states as data. *When*: a constraint says that a link must, may or must not exist, or is about the
   whole store. *How*: `Predicates.Exists` and `Forall` are built as predicates are, with `.symbols(...)`,
   `.requires(...)` and `.forbids(...)`; `Contains` tests an adjacency's entries. A mandatory link is
   `.requires(Exists(...))`, a forbidden one `.forbids(Exists(...))`, a possible one a weighted choice between the link
   and its negation; a predicate without symbols is a statement about the whole store. `Predicates.Evaluator(store)`
   evaluates any term of the algebra.
   [CAP-152: relation constraint terms as mandatory, possible, or forbidden entry patterns](mbse:mbse-basis/docs/capabilities/CAP-152.md).
   - Python: [T03.1: a quantifier](mbse:mbse-patterns/python3/tutorials/03_Links_As_Constraints.ipynb#T03.1) · TypeScript: [T03.1: a quantifier](mbse:mbse-patterns/typescript5/tutorials/03_Links_As_Constraints.ipynb#T03.1)
   - Python: [T03.2: a statement about the whole store](mbse:mbse-patterns/python3/tutorials/03_Links_As_Constraints.ipynb#T03.2) · TypeScript: [T03.2: a statement about the whole store](mbse:mbse-patterns/typescript5/tutorials/03_Links_As_Constraints.ipynb#T03.2)
   - Python: [T03.3: evaluating terms of the algebra](mbse:mbse-patterns/python3/tutorials/03_Links_As_Constraints.ipynb#T03.3) · TypeScript: [T03.3: evaluating terms of the algebra](mbse:mbse-patterns/typescript5/tutorials/03_Links_As_Constraints.ipynb#T03.3)
   - Python: [T05.5: a possible link](mbse:mbse-patterns/python3/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.5) · TypeScript: [T05.5: a possible link](mbse:mbse-patterns/typescript5/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.5)
6. **Shape the constraint for the planner.** *Why*: a query takes its plan from the constraint's shape; a shape it can't
   use scans every combination. *When*: a query relates several symbols, or runs over a large store. *How*: write each
   condition as its own `.requires(...)`, tested as soon as the symbols it reads are bound; relate two symbols with
   `Contains` over an adjacency, so the query takes one from the other's entries (a hop) instead of scanning; declare
   relations' `unique` clauses, which bound a hop to at most one; check the plan with `explain`. Give values the
   predicate doesn't bind as the query's variables, named unlike its symbols; an object variable is bound per match.
   [CAP-151: constraint evaluation within query interpretation](mbse:mbse-basis/docs/capabilities/CAP-151.md).
   - Python: [T02.2: variables](mbse:mbse-patterns/python3/tutorials/02_Finding_What_Matches.ipynb#T02.2) · TypeScript: [T02.2: variables](mbse:mbse-patterns/typescript5/tutorials/02_Finding_What_Matches.ipynb#T02.2)
   - Python: [T02.3: two symbols, and the plan](mbse:mbse-patterns/python3/tutorials/02_Finding_What_Matches.ipynb#T02.3) · TypeScript: [T02.3: two symbols, and the plan](mbse:mbse-patterns/typescript5/tutorials/02_Finding_What_Matches.ipynb#T02.3)
   - Python: [QRY-02: Variables are bound once, and objects too](mbse:mbse-patterns/python3/tests/03_Queries.ipynb#QRY-02) · TypeScript: [QRY-02: Variables are bound once, and objects too](mbse:mbse-patterns/typescript5/tests/03_Queries.ipynb#QRY-02)
   - Python: [QRY-04: A query that cannot be right is refused when it is made](mbse:mbse-patterns/python3/tests/03_Queries.ipynb#QRY-04) · TypeScript: [QRY-04: A query that cannot be right is refused when it is made](mbse:mbse-patterns/typescript5/tests/03_Queries.ipynb#QRY-04)
   - Python: [QRY-05: Several symbols match the cross product, narrowed by hops through relations](mbse:mbse-patterns/python3/tests/03_Queries.ipynb#QRY-05) · TypeScript: [QRY-05: Several symbols match the cross product, narrowed by hops through relations](mbse:mbse-patterns/typescript5/tests/03_Queries.ipynb#QRY-05)
7. **Predicates are data: read them through the store that registers their schemas.** *Why*: a predicate names its
   symbols' schemas, and only a store that has them can resolve the names back into your schemas, not lookalikes.
   *When*: you save, send or load predicates. *How*: gather predicates in a set (`Constraints.check`, or
   `Constraints.OfSet.Builder()`), write it with mbse-schemas' JSON writer (any store, `Constraints.Builders` included),
   read it back with `Constraints.OfStore(store)`. Another store holds predicates as proxies once
   `register(store)` gives it the meta-schemas.
   - Python: [T01.5: constraints are data](mbse:mbse-patterns/python3/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.5) · TypeScript: [T01.5: constraints are data](mbse:mbse-patterns/typescript5/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.5)
   - Python: [CON-04: Predicates are data: written by their symbols' schema names, read back through a store](mbse:mbse-patterns/python3/tests/01_Predicates.ipynb#CON-04) · TypeScript: [CON-04: Predicates are data: written by their symbols' schema names, read back through a store](mbse:mbse-patterns/typescript5/tests/01_Predicates.ipynb#CON-04)
   - Python: [CON-06: Another store holds predicates as proxies](mbse:mbse-patterns/python3/tests/01_Predicates.ipynb#CON-06) · TypeScript: [CON-06: Another store holds predicates as proxies](mbse:mbse-patterns/typescript5/tests/01_Predicates.ipynb#CON-06)
8. **Apply a predicate; don't copy it.** *Why*: a constraint copied once per value copies its mistakes; an application
   holds the predicate itself, so a change reaches every use, and a snapshot writes it once. *When*: constraints differ
   only in a value. *How*: declare parameters (`.parameters(...)`, as a schema's), and apply the predicate where it's
   used, its symbols in order, then its parameters in order or by name, some or all; a parameter given no argument is
   unknown. Give a query a predicate's parameters as variables; a validator refuses a predicate with parameters, which
   holds only where it's applied.
   [PRI-015: concrete references are programmatic](mbse:mbse-basis/docs/PRINCIPLES.md#PRI-015).
   - Python: [T04.1: a parameter](mbse:mbse-patterns/python3/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.1) · TypeScript: [T04.1: a parameter](mbse:mbse-patterns/typescript5/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.1)
   - Python: [T04.2: applying it](mbse:mbse-patterns/python3/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.2) · TypeScript: [T04.2: applying it](mbse:mbse-patterns/typescript5/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.2)
   - Python: [T04.3: written once](mbse:mbse-patterns/python3/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.3) · TypeScript: [T04.3: written once](mbse:mbse-patterns/typescript5/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.3)
   - Python: [CON-07: A predicate is applied by reference, its arguments bound to its symbols and parameters](mbse:mbse-patterns/python3/tests/01_Predicates.ipynb#CON-07) · TypeScript: [CON-07: A predicate is applied by reference, its arguments bound to its symbols and parameters](mbse:mbse-patterns/typescript5/tests/01_Predicates.ipynb#CON-07)
9. **A pattern is a predicate.** *Why*: a believable mix is a property of a population, which no one record breaks; as
   a predicate, the same pattern validates, queries and weighs. *When*: data must come in proportions, or a link is
   possible rather than mandatory. *How*: `Distributions.Choices` holds weighted arms, each with conditions, and holds
   when the number of arms that hold satisfies its count (at least one, by default); weights are relative. With
   `.decreasing()`, a match falls under the first arm that holds, so put the more specific arms first.
   `Evaluator.weigh` gives what a match weighs; `Generators.Sample` draws the store's matches by weight.
   [CAP-072: distributions in predicates](mbse:mbse-basis/docs/capabilities/CAP-072.md).
   - Python: [T05.1: weighted alternatives](mbse:mbse-patterns/python3/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.1) · TypeScript: [T05.1: weighted alternatives](mbse:mbse-patterns/typescript5/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.1)
   - Python: [T05.2: what a match weighs](mbse:mbse-patterns/python3/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.2) · TypeScript: [T05.2: what a match weighs](mbse:mbse-patterns/typescript5/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.2)
   - Python: [T05.3: counts and precedence](mbse:mbse-patterns/python3/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.3) · TypeScript: [T05.3: counts and precedence](mbse:mbse-patterns/typescript5/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.3)
   - Python: [T05.4: sampling the store](mbse:mbse-patterns/python3/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.4) · TypeScript: [T05.4: sampling the store](mbse:mbse-patterns/typescript5/tutorials/05_The_Shape_Of_A_Population.ipynb#T05.4)
10. **A drawn value reaches a property only through an equality.** *Why*: a distribution binds a symbol, not a
   property; its body says where the value goes, and read the other way, gives the witness a validator checks.
   *When*: a pattern draws values (`Normal`, `Uniform`, `Poisson`, `Geometric`, `Categorical`). *How*: give the
   distribution its symbol, then a body equating a property with it (`person.age == age`). The value must fit the
   property's schema, which `Constraints.check` checks before any data is read: a normal gives floats unless
   `.rounded()`; a uniform gives integers only when both bounds are integers. Checking data, a distribution holds when
   its witness is in its support, and is unknown with no witness. A mixture is a choices of distributions.
   - Python: [T06.1: a distribution of values](mbse:mbse-patterns/python3/tutorials/06_Drawing_Values.ipynb#T06.1) · TypeScript: [T06.1: a distribution of values](mbse:mbse-patterns/typescript5/tutorials/06_Drawing_Values.ipynb#T06.1)
   - Python: [T06.2: as a constraint, a distribution checks its support](mbse:mbse-patterns/python3/tutorials/06_Drawing_Values.ipynb#T06.2) · TypeScript: [T06.2: as a constraint, a distribution checks its support](mbse:mbse-patterns/typescript5/tutorials/06_Drawing_Values.ipynb#T06.2)
   - Python: [T06.3: schemas are checked before any data is read](mbse:mbse-patterns/python3/tutorials/06_Drawing_Values.ipynb#T06.3) · TypeScript: [T06.3: schemas are checked before any data is read](mbse:mbse-patterns/typescript5/tutorials/06_Drawing_Values.ipynb#T06.3)
   - Python: [T06.4: choices of distributions](mbse:mbse-patterns/python3/tutorials/06_Drawing_Values.ipynb#T06.4) · TypeScript: [T06.4: choices of distributions](mbse:mbse-patterns/typescript5/tutorials/06_Drawing_Values.ipynb#T06.4)
   - Python: [DST-03: Distributions of values bind a symbol, and are built fluently](mbse:mbse-patterns/python3/tests/07_Distributions.ipynb#DST-03) · TypeScript: [DST-03: Distributions of values bind a symbol, and are built fluently](mbse:mbse-patterns/typescript5/tests/07_Distributions.ipynb#DST-03)
   - Python: [DST-04: A distribution holds of data when its witness is in its support](mbse:mbse-patterns/python3/tests/07_Distributions.ipynb#DST-04) · TypeScript: [DST-04: A distribution holds of data when its witness is in its support](mbse:mbse-patterns/typescript5/tests/07_Distributions.ipynb#DST-04)
11. **Generate from the predicate you check with.** *Why*: generated data then passes your validators by construction,
   and a seed you keep gives the same data, in both languages, today and later. *When*: tests need data in
   production's mix. *How*: `Generators.Generate(store, predicate, source)` chooses arms by weight, draws values, sets
   what equalities say, builds the objects with the store's builders, and redraws, up to 100 times, until the predicate
   holds; `rejected` counts the redraws, the constraint's cost. Give it a random source (`Stores.PCG32(seed)`), never
   the store's: [PRI-013: nondeterminism passed in](mbse:mbse-basis/docs/PRINCIPLES.md#PRI-013). Generated objects are transient until you list them. A
   generator doesn't invent links: a predicate its equalities and choices can't build is refused.
   [CAP-042: data generated from constraints](mbse:mbse-basis/docs/capabilities/CAP-042.md).
   - Python: [T07.1: generating](mbse:mbse-patterns/python3/tutorials/07_Generating_Test_Data.ipynb#T07.1) · TypeScript: [T07.1: generating](mbse:mbse-patterns/typescript5/tutorials/07_Generating_Test_Data.ipynb#T07.1)
   - Python: [T07.2: the same seed, the same data](mbse:mbse-patterns/python3/tutorials/07_Generating_Test_Data.ipynb#T07.2) · TypeScript: [T07.2: the same seed, the same data](mbse:mbse-patterns/typescript5/tutorials/07_Generating_Test_Data.ipynb#T07.2)
   - Python: [T07.3: generated data is ordinary data](mbse:mbse-patterns/python3/tutorials/07_Generating_Test_Data.ipynb#T07.3) · TypeScript: [T07.3: generated data is ordinary data](mbse:mbse-patterns/typescript5/tutorials/07_Generating_Test_Data.ipynb#T07.3)
   - Python: [T07.4: what a generator can't do](mbse:mbse-patterns/python3/tutorials/07_Generating_Test_Data.ipynb#T07.4) · TypeScript: [T07.4: what a generator can't do](mbse:mbse-patterns/typescript5/tutorials/07_Generating_Test_Data.ipynb#T07.4)
   - Python: [GEN-06: Distributions draw what the equalities leave open, redrawn until the predicate holds](mbse:mbse-patterns/python3/tests/08_Generators.ipynb#GEN-06) · TypeScript: [GEN-06: Distributions draw what the equalities leave open, redrawn until the predicate holds](mbse:mbse-patterns/typescript5/tests/08_Generators.ipynb#GEN-06)
12. **A transform rewrites where its before holds and its after doesn't.** *Why*: a rewrite that decides silently
   decides differently next time; one stated as a before and an after is offered only where it's needed, and checked.
   *When*: you rewrite a store's data, or its schemas, and a step leaves something to decide. *How*: a
   `Transforms.Transform` has a name, before and after predicates over the same symbols, parameters for what it decides
   (a finite domain gives one candidate per value; others stay open), and a rewrite or parts. A
   `Transforms.Session(store, transforms)` offers the candidates; take one with `take`, answering its open parameters.
   A rewrite must establish its after, or the step is refused.
   [CAP-074: transforms applied step by step](mbse:mbse-basis/docs/capabilities/CAP-074.md).
   - Python: [T08.1: a transform](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.1) · TypeScript: [T08.1: a transform](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.1)
   - Python: [T08.2: candidates](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.2) · TypeScript: [T08.2: candidates](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.2)
   - Python: [T08.3: taking a step yourself](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.3) · TypeScript: [T08.3: taking a step yourself](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.3)
   - Python: [T08.4: a rewrite must establish its after](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.4) · TypeScript: [T08.4: a rewrite must establish its after](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.4)
   - Python: [TRF-07: Transforms match schemas, each an object of its kind's meta-schema (mbse-schemas' Reflection)](mbse:mbse-patterns/python3/tests/09_Transforms.ipynb#TRF-07) · TypeScript: [TRF-07: Transforms match schemas, each an object of its kind's meta-schema (mbse-schemas' Reflection)](mbse:mbse-patterns/typescript5/tests/09_Transforms.ipynb#TRF-07)
13. **Decide each step, or delegate it to a policy.** *Why*: people and agents in the loop decide what matters and
   delegate the rest, and each step records who decided it. *When*: a session has many candidates, or composite
   transforms. *How*: a `Transforms.Policy` of clauses weighs candidates by transform and arguments, and answers open
   parameters; `candidates(policy)` ranks them, `step_over(policy)` and `run(policy)` take the policy's choices, and a
   candidate no clause weighs is never the policy's to take. Step into a composite (`step_in`) to decide inside it,
   or over it to let the policy.
   - Python: [T08.5: a policy decides](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.5) · TypeScript: [T08.5: a policy decides](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.5)
   - Python: [T08.6: composite transforms, stepped into or over](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.6) · TypeScript: [T08.6: composite transforms, stepped into or over](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.6)
14. **Keep the trace, and rerun with it.** *Why*: a step's key is its transform and its match's paths, so a rerun on
   changed data takes every decision that still applies and reports the rest. *When*: a rewrite runs again, on new or
   changed data. *How*: write the steps as data with `session.trace(Transforms.register(store))`, and read them back with
   `Transforms.steps`; give a rerun the earlier steps, whose decisions it reuses; its `orphans` are the decisions whose
   key no longer occurs, and `Transforms.diff` compares two runs. A rewrite may return what it wrote, by role: each
   step links what it matched and wrote, `session.wrote(x)` finds the step that wrote `x`, and `Transforms.records`
   gives the steps as objects to query with the session's store.
   [CAP-075: steps linked to what they matched and wrote](mbse:mbse-basis/docs/capabilities/CAP-075.md),
   [CAP-076: reruns reuse decisions](mbse:mbse-basis/docs/capabilities/CAP-076.md).
   - Python: [T08.7: the trace is data](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.7) · TypeScript: [T08.7: the trace is data](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.7)
   - Python: [T08.8: a rerun reuses decisions](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.8) · TypeScript: [T08.8: a rerun reuses decisions](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.8)
   - Python: [T08.9: what each step wrote](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.9) · TypeScript: [T08.9: what each step wrote](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.9)

## In each language

The two implementations are equivalent: the same names, results and JSON. Where a language forces a difference
(mbse-patterns' [EQUIVALENCE.md](mbse:mbse-patterns/docs/EQUIVALENCE.md)), each case shows its own:

- **Conditions.** Python reads a condition from a lambda's source (`Text.FromFunction`), its parameters named as the
  symbols, and never calls it; TypeScript writes conditions with mbse-expressions' writers (`the.age.ge(18n)`). Either
  may use the writers, and the function given to `Contains`, a choices' count or a distribution's body is read the
  same way: in TypeScript it is called with a variable named after its one parameter, or, for a distribution, its own
  symbol, so set `.symbol(...)` first.
  - Python: [T01.1: a predicate](mbse:mbse-patterns/python3/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.1) · TypeScript: [T01.1: a predicate](mbse:mbse-patterns/typescript5/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.1)
  - Python: [T06.1: a distribution of values](mbse:mbse-patterns/python3/tutorials/06_Drawing_Values.ipynb#T06.1) · TypeScript: [T06.1: a distribution of values](mbse:mbse-patterns/typescript5/tutorials/06_Drawing_Values.ipynb#T06.1)
- **Applying and building.** Python applies a predicate by calling it, parameters by keyword; TypeScript with
  `.call(...)`, parameters by name in a last object literal, and makes builders with `new`. A builder gives a name it
  hasn't declared as `undefined` in TypeScript, where Python raises `AttributeError`.
  - Python: [T04.2: applying it](mbse:mbse-patterns/python3/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.2) · TypeScript: [T04.2: applying it](mbse:mbse-patterns/typescript5/tutorials/04_Constraints_That_Take_Arguments.ipynb#T04.2)
  - Python: [CON-01: A predicate is built fluently: a name, a description, symbols, parameters and conditions](mbse:mbse-patterns/python3/tests/01_Predicates.ipynb#CON-01) · TypeScript: [CON-01: A predicate is built fluently: a name, a description, symbols, parameters and conditions](mbse:mbse-patterns/typescript5/tests/01_Predicates.ipynb#CON-01)
- **Integers.** TypeScript's integers are `bigint`s (`18n`, seeds `new Stores.PCG32(42n)`), and a `number` is a float;
  weights are numbers. Python's are `int`s.
  - Python: [T06.3: schemas are checked before any data is read](mbse:mbse-patterns/python3/tutorials/06_Drawing_Values.ipynb#T06.3) · TypeScript: [T06.3: schemas are checked before any data is read](mbse:mbse-patterns/typescript5/tutorials/06_Drawing_Values.ipynb#T06.3)
  - Python: [T07.2: the same seed, the same data](mbse:mbse-patterns/python3/tutorials/07_Generating_Test_Data.ipynb#T07.2) · TypeScript: [T07.2: the same seed, the same data](mbse:mbse-patterns/typescript5/tutorials/07_Generating_Test_Data.ipynb#T07.2)
- **Options.** Python takes options by keyword (`unknown="ignore"`, `unknown=True`, `earlier=`); TypeScript takes a
  validator's as a record (`{ unknown: "ignore" }`), a query's `unknown` by position after its variables (`null` for
  none), a session's earlier steps last, after its scope and labels, and returns matches from a generator.
  - Python: [T01.2: checking data](mbse:mbse-patterns/python3/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.2) · TypeScript: [T01.2: checking data](mbse:mbse-patterns/typescript5/tutorials/01_Constraints_Your_Data_Must_Keep.ipynb#T01.2)
  - Python: [T02.1: a predicate's matches](mbse:mbse-patterns/python3/tutorials/02_Finding_What_Matches.ipynb#T02.1) · TypeScript: [T02.1: a predicate's matches](mbse:mbse-patterns/typescript5/tutorials/02_Finding_What_Matches.ipynb#T02.1)
  - Python: [T08.8: a rerun reuses decisions](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.8) · TypeScript: [T08.8: a rerun reuses decisions](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.8)
- **What a rewrite wrote** is returned as a mapping of roles: a `dict` in Python, a `Map` in TypeScript; a
  transform's options, a candidate's answer and a clause's arguments are keyword arguments in Python, records in
  TypeScript.
  - Python: [T08.1: a transform](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.1) · TypeScript: [T08.1: a transform](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.1)
  - Python: [T08.9: what each step wrote](mbse:mbse-patterns/python3/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.9) · TypeScript: [T08.9: what each step wrote](mbse:mbse-patterns/typescript5/tutorials/08_Rewriting_Step_By_Step.ipynb#T08.9)

## Learn it by example

The tutorials teach it in eight case studies, from a constraint your data must keep to rewriting step by step, each a
notebook committed with its outputs and run as a test:
[Python](mbse:mbse-patterns/python3/tutorials/README.md) and
[TypeScript](mbse:mbse-patterns/typescript5/tutorials/README.md). The test plan,
[TestPlan.md](mbse:mbse-patterns/python3/tests/TestPlan.md), lists every case.
