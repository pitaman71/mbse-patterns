"""mbse-patterns: constraints, queries and patterns over mbse-schemas data.

A predicate is a named constraint over symbols bound to a schema's objects, built fluently and kept as data beside the
schemas (`Predicates`); its constraint is an expression of the predicate algebra, mbse-expressions' Basic with
quantifiers over a store's objects, tests of links and weighted choices. `Validators` checks data against predicates,
and `Queries` finds a store's matches. `Distributions` weigh a population of matches by predicates, `Sample` draws from
a store's data and `Generators` build new data, both from a random source the caller gives (`Sampling`). Characterizers
are planned (see docs/PATTERNS.md at https://github.com/pitaman71/mbse-patterns).

For AI agents: read `skill/SKILL.md` next to this file first. It says when to use this package, the practices that
prevent most mistakes, and which reference to load for a task.
"""

from . import Constraints, Distributions, Generators, Predicates, Queries, Sampling, Validators
from .Constraints import register

__all__ = ["Constraints", "Predicates", "Validators", "Queries", "Distributions", "Generators", "Sampling", "register"]
