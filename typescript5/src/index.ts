/** mbse-patterns: constraints, queries and patterns over mbse-schemas data.
 *
 * A predicate is a named rule over symbols bound to a schema's objects, kept as data beside the schemas; its rule is an
 * expression of the predicate algebra (`Predicates`, mbse-expressions' Basic with quantifiers over a store's objects,
 * links and weighted choices). `Validators` checks data against predicates, and `Queries` finds a store's matches. Patterns,
 * generators and characterizers are planned (see docs/PATTERNS.md at https://github.com/pitaman71/mbse-patterns).
 *
 * For AI agents: read `skill/SKILL.md` at the root of this package first. It says when to use this package, the rules
 * that prevent most mistakes, and which reference to load for a task. */

export * as Constraints from "./Constraints.js";
export * as Predicates from "./Predicates.js";
export * as Queries from "./Queries.js";
export * as Validators from "./Validators.js";
export { register } from "./Constraints.js";
