"""mbse-patterns: constraints, queries and patterns over mbse-schemas data.

A constraint is a Basic rule (mbse-expressions) about the instances of one schema, kept as data beside the schemas;
`Validators` checks data against constraints, and `Queries` selects a store's objects by a rule, lazily. Patterns,
generators and characterizers are planned (see docs/PATTERNS.md at https://github.com/pitaman71/mbse-patterns).

For AI agents: read `skill/SKILL.md` next to this file first. It says when to use this package, the rules that prevent
most mistakes, and which reference to load for a task.
"""

from . import Constraints, Queries, Validators
from .Constraints import register

__all__ = ["Constraints", "Validators", "Queries", "register"]
