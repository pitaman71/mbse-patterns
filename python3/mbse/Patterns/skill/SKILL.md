---
name: mbse-patterns
description: Write predicates (named rules over symbols bound to mbse-schemas objects, such as "every adult contact has a phone" or "a contact's phone has a number") as data beside the schemas, validate data against them with three-valued results, and query a store for their matches, lazily and planned from the rule's shape, in Python or TypeScript. Use when an interface or model has rules its data must satisfy (MBSE/SysML constraints, interface control documents, data-quality rules), when selecting objects of an mbse-schemas store by a condition, possibly relating several objects, when weighting a population by predicates and drawing samples or generating reproducible pseudorandom test data from it, or when writing code that imports mbse.Patterns or @mbse/patterns.
---

# mbse-patterns

A predicate is a named rule over *symbols*, each bound to an object of an
[mbse-schemas](https://github.com/pitaman71/mbse-schemas) schema; it applies to a *match*, which binds every symbol.
It is built fluently, as schemas are, from conditions written with mbse-expressions' Basic rules and the terms of the
predicate algebra, each built fluently too:

```python fragment
IsAnAdult = (
    Predicates.OfPredicate.Builder()
    .name("IsAnAdult")
    .description("18 or older")
    .symbols({"the": Contact})
    .requires(Python.Text.FromFunction(lambda the: the.age >= 18))
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
predicate whose rule weighs alternatives (`Distributions.Choices`) and draws values (`Distributions.Normal`, ...);
`Generators.Sample` draws from a store's data and `Generators.Generate` builds new data, both from a random source the
caller gives, byte-identically in both languages from a seed. Python imports `mbse.Patterns`, TypeScript
`@mbse/patterns`.

## When to use it

- An interface or model has rules its data must satisfy, and they must be stored, shared or applied identically in
  several programs or languages.
- You need the objects of an mbse-schemas store, or combinations of them, that satisfy a condition.

For the rules themselves (writing, evaluating, translating expressions), use the
[mbse-expressions skill](https://github.com/pitaman71/mbse-expressions/blob/main/skills/mbse-expressions/SKILL.md);
for the data, the [mbse-schemas skill](https://github.com/pitaman71/mbse-schemas/blob/main/skills/mbse-schemas/SKILL.md).

## Rules that prevent most mistakes

1. **A symbol's schema is a named reference object schema**, as a store registers it. The rule's free names are the
   symbols and parameters, written as Basic variables of the same names (`c = E.variable("c")`, or `pred.c` from the
   builder that declares `c`), and, in a query, its variables; only Basic's core vocabulary is allowed. `Constraints.check(...)` and every validator and query reject anything else up
   front.
2. **A predicate applies to every match.** With several symbols, the matches are the cross product of their objects;
   the rule says which combinations matter (e.g. that a phone is one of a contact's).
3. **Unknown is not false.** A rule reading an absent property is unknown; a validator reports it as unknown by
   default (`unknown` is `report`, `ignore` or `violation`), and a query leaves it out unless asked.
4. **Queries see the store's data, not everything built.** A schema's extent is what the store's singletons reach.
5. **Links are predicates.** `Predicates.Exists` and `Forall` quantify over a schema's objects, built by a builder with
   `.symbols(...)`, `.requires(...)` and `.forbids(...)`; `Contains(c.phones, lambda e: e.phone == p)` tests an
   adjacency's entries. Mandatory, forbidden and possible links are predicates, and a predicate without symbols is a
   statement about the whole store.
6. **Shape the rule for the planner.** Each `.requires(...)` is a conjunct, tested as early as its symbols allow, and
   `Contains(c.phones, lambda e: e.phone == p)` between two symbols takes `p` from `c`'s entries instead of scanning;
   `explain` shows the plan. Relations' `unique` clauses tell it when such a hop gives at most one object.
7. **Reading predicates resolves their schemas by name**: read through `Constraints.OfStore(store)`, with the store that
   registers them. Writing needs no store.
8. **A predicate is used by reference.** One with parameters (`.parameters(lambda p: p.name("name"))`) is applied:
   `HasName(pred.person, "alice")` holds the predicate itself and binds its symbols, then its parameters, in order.
   Shared predicates are written once. A validator refuses a predicate with parameters; a query takes them as
   variables.
9. **A pattern is a predicate.** `Distributions.Choices` weighs alternatives, its arms (`a.weight(3).requires(...)`),
   holding when the number of arms that hold satisfies its count; `.decreasing()` makes a match fall under the first
   arm that holds. A distribution of values (`Distributions.Normal.Builder().symbol("age")...requires(lambda person,
   age: person.age == age)`) binds a symbol to a drawn value that its body's equalities set. `Generators.Generate` and
   `Generators.Sample` draw from such a predicate with a random source (`Stores.PCG32(seed)`).
10. **In TypeScript, integers are `bigint`s** (`18n`), rules are written with writers (there is no `FromFunction`, and
   `Contains` calls its condition with a variable: `(e) => e.phone.eq(p)`), a predicate is applied with
   `.call(...)`, and a validator's options are an object (`{ unknown: "ignore" }`).

## Load the reference for your task

| Task | Read |
|---|---|
| Write Python: a complete program, API cheat sheet, traps | [references/python.md](references/python.md) |
| Write TypeScript: the same program, the differences from Python | [references/typescript.md](references/typescript.md) |

Deeper material is in the repository: `python3/tutorials/` and `typescript5/tutorials/` teach it in seven case
studies, with outputs, and `docs/PATTERNS.md` holds the design, the planned patterns, generators and
characterizers, and the open questions. Links use `https://github.com/pitaman71/mbse-patterns/blob/main/<path>`; in a
checkout, `<path>` is relative to the repository root.
