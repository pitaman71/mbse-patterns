"""Validators: data checked against constraints.

`Validate(store, constraints)(schema, value)` evaluates the constraints of `schema` (by the name `store` registers it
under) on `value`, and `.Reachable(schema, root)` on the root and every object reachable from it, each against the
constraints of its own schema. Each returns problems, labelled as mbse-schemas' `Validators` labels objects (the schema
name and the position in `Reachable.of` order):

- `Contact#0: 'has-phone' does not hold`, when a rule is false;
- `Contact#0: 'has-phone' is unknown`, when it is unknown (a property it reads is absent), which `unknown` decides:
  `'report'` (the default) reports it so, `'ignore'` does not, and `'violation'` reports it as not holding;
- `Contact#0: 'has-phone' raised TypeError: ...`, when evaluating it raises.

Structure is mbse-schemas' `Validators.Validate(store)`'s to check: run both. The constraints are checked statically
(`Constraints.check`) when the validator is made, so that a rule that cannot be right is reported once, not per object.
"""

from __future__ import annotations

from typing import Any

from mbse.Expressions import Evaluators
from mbse.Schemas.Framework import Reachable, Schemas, Stores, Visitors

from . import Constraints

__all__ = ["Validate", "UNKNOWN"]

UNKNOWN = ("report", "ignore", "violation")


class Validate:
    """Validates data against constraints: `Validate(store, constraints, unknown='report')(schema, value)`."""

    def __init__(self, store: Stores.Store, constraints: Constraints.Set, *, unknown: str = "report"):
        if unknown not in UNKNOWN:
            raise ValueError(f"unknown must be 'report', 'ignore' or 'violation', got {unknown!r}")
        self._store, self._constraints, self._unknown = store, Constraints.check(constraints), unknown

    def __call__(self, schema: Schemas.OfObject.Data, value: Visitors.Visitable) -> list[str]:
        """The problems of `value` alone."""
        return self._run(schema, [value])

    def Reachable(self, schema: Schemas.OfObject.Data, root: Visitors.Visitable) -> list[str]:
        """The problems of the root and of every object reachable from it through adjacencies."""
        return self._run(schema, Reachable.of(root))

    def _run(self, schema: Schemas.OfObject.Data, values: list[Visitors.Visitable]) -> list[str]:
        name = self._store.name_of(schema)
        if values[0].schema_name() != name:
            return [f"the value is a {values[0].schema_name()!r}, not an instance of the given schema"]
        problems: list[str] = []
        for i, value in enumerate(values):
            label = f"{value.schema_name()}#{i}"
            for constraint in self._constraints.of(value.schema_name()):
                problem = self._problem(constraint, value)
                if problem is not None:
                    problems.append(f"{label}: {constraint.name!r} {problem}")
        return problems

    def _problem(self, constraint: Constraints.Constraint, value: Any) -> str | None:
        try:
            result = Evaluators.predicate(constraint.rule, value)
        except Exception as error:  # a rule that raises is a problem of the data or the rule, reported in place
            return f"raised {type(error).__name__}: {error}"
        if result is None:
            return None if self._unknown == "ignore" else "is unknown" if self._unknown == "report" else "does not hold"
        return None if result else "does not hold"
