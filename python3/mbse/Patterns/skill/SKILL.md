---
name: mbse-patterns
description: Write predicates (named constraints over symbols bound to mbse-schemas objects, such as "every adult contact has a phone" or "a contact's phone has a number") as data beside the schemas, validate data against them with three-valued results, and query a store for their matches, lazily and planned from the constraint's shape, in Python. Use when an interface or model has constraints its data must satisfy (MBSE/SysML constraints, interface control documents, data-quality constraints, what others call business rules), when selecting objects of an mbse-schemas store by a condition, possibly relating several objects, when weighting a population by predicates and drawing samples or generating reproducible pseudorandom test data from it, when applying rewrites to a store's data step by step with every decision recorded (transforms, the basis of code generation with people and agents in the loop), or when writing code that imports mbse.Patterns.
---

# mbse-patterns

A predicate is a named constraint over *symbols*, each bound to an object of an
[mbse-schemas](https://github.com/pitaman71/mbse-schemas) schema; it applies to a *match*, which binds every symbol.
It is built fluently, as schemas are, from conditions written with mbse-expressions' Basic expressions and the terms of
the predicate algebra, each built fluently too:

```python fragment
IsAnAdult = (
    Predicates.OfPredicate.Builder()
    .name("IsAnAdult")
    .description("18 or older")
    .symbols({"the": Contact})
    .requires(Text.FromFunction(lambda the: the.age >= 18))
    .create()
)
c, p = E.variable("c"), E.variable("p")
HasAPhone = (
    Predicates.OfPredicate.Builder()
    .name("HasAPhone")
    .symbols({"c": Contact})
    .requires(Predicates.Exists(lambda q: q.symbols({"p": Phone}).requires(
        Predicates.Contains(c.phones, lambda e: e.phone == p))))
    .create()
)
```

`Validators` checks data against predicates; `Queries` finds a store's matches for a predicate. A pattern is a
predicate whose constraint weighs alternatives (`Distributions.Choices`) and draws values (`Distributions.Normal`, ...);
`Generators.Sample` draws from a store's data and `Generators.Generate` builds new data, both from a random source you
give. `Transforms` rewrites a store's data step by step. Import them from `mbse.Patterns`.

## When to use it

- An interface or model has constraints its data must satisfy, and they must be stored, shared or applied identically in
  several programs or languages.
- You need the objects of an mbse-schemas store, or combinations of them, that satisfy a condition.

For the constraints themselves (writing, evaluating, translating expressions), use the
[mbse-expressions skill](mbse:mbse-expressions/skills/mbse-expressions/SKILL.md);
for the data, the [mbse-schemas skill](mbse:mbse-schemas/skills/mbse-schemas/SKILL.md).

## Practices that prevent most mistakes

1. **A symbol's schema is a named object schema**, as a store registers it. The constraint's free names are the symbols
   and parameters, written as Basic variables of the same names (`c = E.variable("c")`, or `pred.c` from the builder
   that declares `c`), and, in a query, its variables; use only Basic's core vocabulary. `Constraints.check(...)` and
   every validator and query reject anything else up front.
   [CAP-150: predicates as data](mbse:mbse-basis/docs/capabilities/CAP-150.md).
2. **A predicate applies to every match.** With several symbols, the matches are every combination of their objects;
   say in the constraint which combinations matter (e.g. that a phone is one of a contact's).
3. **Unknown is not false.** A constraint reading an absent property is unknown. Choose what that means: a validator's
   `unknown` is `"report"` (the default), `"ignore"` or `"violation"`, and a query gives unknown matches only with
   `unknown=True`. [CAP-029: three-valued constraint checking](mbse:mbse-basis/docs/capabilities/CAP-029.md).
4. **List what you build.** Queries, quantifiers and `Reachable` see what the store's singletons reach; an object
   built but never linked to them is not found.
5. **Write links with the algebra.** `Predicates.Exists` and `Forall` are built with `.symbols(...)`, `.requires(...)`
   and `.forbids(...)`; `Contains(c.phones, lambda e: e.phone == p)` tests an adjacency's entries. A mandatory link is
   `.requires(Exists(...))`, a forbidden one `.forbids(Exists(...))`, a possible one a `Choices`; a predicate without
   symbols is a statement about the whole store.
   [CAP-152: relation constraint terms as mandatory, possible, or forbidden entry patterns](mbse:mbse-basis/docs/capabilities/CAP-152.md).
6. **Shape the constraint for the planner.** Write each condition as its own `.requires(...)`, and relate two symbols
   with `Contains(c.phones, lambda e: e.phone == p)`, so the query takes `p` from `c`'s entries instead of scanning;
   declare relations' `unique` clauses; check the plan with `explain`.
   [CAP-151: constraint evaluation within query interpretation](mbse:mbse-basis/docs/capabilities/CAP-151.md).
7. **Read predicates through the store that registers their schemas**: `Constraints.OfStore(store)`. Writing needs no
   store.
8. **Apply a predicate; don't copy it.** One with parameters (`.parameters(lambda p: p.name("name"))`) is applied:
   `HasName(pred.person, "alice")` binds its symbols, in order, then its parameters, in order or by name
   (`name="alice"`), some or all; one given no argument is unknown. Give a query its parameters as variables; a
   validator refuses a predicate with parameters.
9. **A pattern is a predicate.** `Distributions.Choices` weighs its arms (`a.weight(3).requires(...)`), holding when the
   number of arms that hold satisfies its count; `.decreasing()` makes a match fall under the first arm that holds. A
   distribution of values (`Distributions.Normal.Builder().symbol("age")...requires(lambda person, age: person.age ==
   age)`) binds a symbol to a drawn value that its body's equalities set. `Generators.Generate` and `Generators.Sample`
   draw with a random source you give (`Stores.PCG32(seed)`).
   [CAP-072: distributions in predicates](mbse:mbse-basis/docs/capabilities/CAP-072.md),
   [CAP-042: data generated from constraints](mbse:mbse-basis/docs/capabilities/CAP-042.md).
10. **A transform rewrites where its before holds and its after does not.** `Transforms.Session(store, transforms)`
   offers the enabled candidates; take each step yourself (`take`, `step_in`) or let a policy (`step_over`, `run`).
   A rewrite must establish its after. Give a rerun the earlier steps (`earlier=`) to reuse their decisions; compare
   two runs with `Transforms.diff`.
   [CAP-074: transforms applied step by step](mbse:mbse-basis/docs/capabilities/CAP-074.md),
   [CAP-076: reruns reuse decisions](mbse:mbse-basis/docs/capabilities/CAP-076.md).

## Load the reference for your task

| Task | Read |
|---|---|
| Write Python: a complete program, API cheat sheet, traps | [references/usage.md](references/usage.md) |

The [Python tutorial](../../../tutorials/README.md) teaches it in seven case studies, with outputs, and mbse-basis
[FEA-023: patterns over data](mbse:mbse-basis/docs/features/FEA-023.md) holds the design: its capabilities,
as built and as designed, and the open questions.
