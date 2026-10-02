---
name: mbse-patterns
description: Write predicates (named rules over symbols bound to mbse-schemas objects, such as "every adult contact has a phone" or "a contact's phone has a number") as data beside the schemas, validate data against them with three-valued results, and query a store for their matches, lazily and planned from the rule's shape, in Python or TypeScript. Use when an interface or model has rules its data must satisfy (MBSE/SysML constraints, interface control documents, data-quality rules), when selecting objects of an mbse-schemas store by a condition, possibly relating several objects, or when writing code that imports mbse.Patterns or @mbse/patterns.
---

# mbse-patterns

A predicate is a named rule over *symbols*, each bound to an object of an
[mbse-schemas](https://github.com/pitaman71/mbse-schemas) schema; it applies to a *match*, which binds every symbol.
It is built fluently, as schemas are, with mbse-expressions' Basic rules:

```python fragment
IsAnAdult = (
    Constraints.OfPredicate.Builder()
    .name("IsAnAdult")
    .description("18 or older")
    .symbols({"the": Contact})
    .rule(Python.Text.FromFunction(lambda the: the.age >= 18))
    .create()
)
```

`Validators` checks data against predicates; `Queries` finds a store's matches for a predicate. Python imports
`mbse.Patterns`, TypeScript `@mbse/patterns`.

## When to use it

- An interface or model has rules its data must satisfy, and they must be stored, shared or applied identically in
  several programs or languages.
- You need the objects of an mbse-schemas store, or combinations of them, that satisfy a condition.

For the rules themselves (writing, evaluating, translating expressions), use the
[mbse-expressions skill](https://github.com/pitaman71/mbse-expressions/blob/main/skills/mbse-expressions/SKILL.md);
for the data, the [mbse-schemas skill](https://github.com/pitaman71/mbse-schemas/blob/main/skills/mbse-schemas/SKILL.md).

## Rules that prevent most mistakes

1. **A symbol's schema is a named reference object schema**, as a store registers it. The rule's free names are the
   symbols (and, in a query, its variables); only Basic's core vocabulary is allowed. `Constraints.check(...)` and every
   validator and query reject anything else up front.
2. **A predicate applies to every match.** With several symbols, the matches are the cross product of their objects;
   the rule says which combinations matter (e.g. that a phone is one of a contact's).
3. **Unknown is not false.** A rule reading an absent property is unknown; a validator reports it as unknown by
   default (`unknown` is `report`, `ignore` or `violation`), and a query leaves it out unless asked.
4. **Queries see the store's data, not everything built.** A schema's extent is what the store's singletons reach.
5. **Shape the rule for the planner.** Top-level `and`s are tested as early as their symbols allow, and
   `any(e in entries(a, 'phones'), e.phone == b)` takes `b` from `a`'s entries instead of scanning; `explain` shows the
   plan. Relations' `unique` clauses tell it when such a hop gives at most one object.
6. **Reading predicates resolves their schemas by name**: read through `Constraints.OfStore(store)`, with the store that
   registers them. Writing needs no store.
7. **In TypeScript, integers are `bigint`s** (`18n`), rules are written with writers (there is no `FromFunction`), and
   a validator's options are an object (`{ unknown: "ignore" }`).

## Load the reference for your task

| Task | Read |
|---|---|
| Write Python: a complete program, API cheat sheet, traps | [references/python.md](references/python.md) |
| Write TypeScript: the same program, the differences from Python | [references/typescript.md](references/typescript.md) |

Deeper material is in the repository: `docs/PATTERNS.md` holds the design, the planned patterns, generators and
characterizers, and the open questions. Links use `https://github.com/pitaman71/mbse-patterns/blob/main/<path>`; in a
checkout, `<path>` is relative to the repository root.
