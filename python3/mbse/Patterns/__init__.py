"""mbse-patterns: constraints, queries and patterns over mbse-schemas data.

A predicate is a named rule over symbols bound to a schema's objects, kept as data beside the schemas; its rule is an
expression of the predicate algebra (`Predicates`, mbse-expressions' Basic with quantifiers over a store's objects,
links and weighted choices). `Validators` checks data against predicates, and `Queries` finds a store's matches. Patterns,
generators and characterizers are planned (see docs/PATTERNS.md at https://github.com/pitaman71/mbse-patterns).

For AI agents: read `skill/SKILL.md` next to this file first. It says when to use this package, the rules that prevent
most mistakes, and which reference to load for a task.
"""

from . import Constraints, Predicates, Queries, Validators
from .Constraints import register

__all__ = ["Constraints", "Predicates", "Validators", "Queries", "register"]
