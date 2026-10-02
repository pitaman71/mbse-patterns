---
name: mbse-patterns
description: Write constraints (named rules about a schema's objects, such as "every adult contact has a phone") as data beside mbse-schemas schemas, validate data against them with three-valued results, and query a store's objects by a rule, lazily, in Python or TypeScript. Use when an interface or model has rules its data must satisfy (MBSE/SysML constraints, interface control documents, data-quality rules), when selecting objects of an mbse-schemas store by a condition, or when writing code that imports mbse.Patterns or @mbse/patterns.
---

# mbse-patterns

A constraint is a named rule about the objects of one schema, written in mbse-expressions' Basic dialect with `this`
bound to the object, and kept as data beside the schemas of
[mbse-schemas](https://github.com/pitaman71/mbse-schemas): `Constraint("Contact", "adult", this.age >= 18)`. A `Set` of
constraints is stored, sent and validated like any data. `Validators` checks data against a set; `Queries` selects a
store's objects by a rule, streaming the matches. Python imports `mbse.Patterns`, TypeScript `@mbse/patterns`.

## When to use it

- An interface or model has rules its data must satisfy, and they must be stored, shared or applied identically in
  several programs or languages.
- You need the objects of an mbse-schemas store that satisfy a condition.

For the rules themselves (writing, evaluating, translating expressions), use the
[mbse-expressions skill](https://github.com/pitaman71/mbse-expressions/blob/main/skills/mbse-expressions/SKILL.md);
for the data, the [mbse-schemas skill](https://github.com/pitaman71/mbse-schemas/blob/main/skills/mbse-schemas/SKILL.md).

## Rules that prevent most mistakes

1. **A constraint names its schema by the store's name for it** (`"Contact"`), and its rule is about `this`. Only
   Basic's core vocabulary is allowed; `Constraints.check(...)` and every validator reject anything else up front.
2. **Unknown is not false.** A rule reading an absent property is unknown; a validator reports it as unknown by
   default (`unknown` is `report`, `ignore` or `violation`), and a query leaves it out unless asked.
3. **Queries see the store's data, not everything built.** A store's extent is what its singletons reach: link new
   objects to the store's root (e.g. a singleton directory), or no query will find them.
4. **Results are lazy.** `select` returns an iterator; the rule is checked at once, the objects as you read them.
5. **Structure is mbse-schemas' to check.** Run its `Validators.Validate(store)` too; this package checks rules only.
6. **In TypeScript, integers are `bigint`s** (`18n`), and a validator's options are an object (`{ unknown: "ignore" }`).

## Load the reference for your task

| Task | Read |
|---|---|
| Write Python: a complete program, API cheat sheet, traps | [references/python.md](references/python.md) |
| Write TypeScript: the same program, the differences from Python | [references/typescript.md](references/typescript.md) |

Deeper material is in the repository: `docs/PATTERNS.md` holds the design, the planned patterns, generators and
characterizers, and the open questions. Links use `https://github.com/pitaman71/mbse-patterns/blob/main/<path>`; in a
checkout, `<path>` is relative to the repository root.
