"""Validators: data checked against predicates.

A predicate applies to matches, each binding every symbol to an object of the symbol's schema. `Validate(store,
predicates)(schema, value)` checks the matches among `value` alone, and `.Reachable(schema, root)` the matches among the
root and every object reachable from it: every combination of those objects whose schemas fit the symbols. Each returns
problems, the match labelled as mbse-schemas' `Validators` labels objects (the schema name and the position in
`Reachable.of` order):

- `the=Contact#0: 'IsAnAdult' does not hold`, when a rule is false;
- `the=Contact#0: 'IsAnAdult' is unknown`, when it is unknown (a property it reads is absent), which `unknown` decides:
  `'report'` (the default) reports it so, `'ignore'` does not, and `'violation'` reports it as not holding;
- `the=Contact#0: 'IsAnAdult' raised TypeError: ...`, when evaluating it raises.

A predicate without symbols is a statement about the whole store, with one match, labelled `the store`. Rules are
evaluated over the store (`Predicates.Evaluator`), whose extents are read once per check.

Structure is mbse-schemas' `Validators.Validate(store)`'s to check: run both. The predicates are checked statically
(`Constraints.check`) when the validator is made, so that a rule that cannot be right is reported once, not per match.
"""

from __future__ import annotations

import itertools
from typing import Any

from mbse.Schemas.Framework import Reachable, Schemas, Stores, Visitors

from . import Constraints, Predicates

__all__ = ["Validate", "UNKNOWN"]

UNKNOWN = ("report", "ignore", "violation")


class Validate:
    """Validates data against predicates: `Validate(store, predicates, unknown='report')(schema, value)`."""

    def __init__(self, store: Stores.Store, predicates: Any, *, unknown: str = "report"):
        if unknown not in UNKNOWN:
            raise ValueError(f"unknown must be 'report', 'ignore' or 'violation', got {unknown!r}")
        self._store, self._predicates, self._unknown = store, Constraints.check(predicates), unknown

    def __call__(self, schema: Schemas.OfObject.Data, value: Visitors.Visitable) -> list[str]:
        """The problems of the matches among `value` alone."""
        return self._run(schema, [value])

    def Reachable(self, schema: Schemas.OfObject.Data, root: Visitors.Visitable) -> list[str]:
        """The problems of the matches among the root and every object reachable from it through adjacencies."""
        return self._run(schema, Reachable.of(root))

    def _run(self, schema: Schemas.OfObject.Data, values: list[Visitors.Visitable]) -> list[str]:
        name = self._store.name_of(schema)
        if values[0].schema_name() != name:
            return [f"the value is a {values[0].schema_name()!r}, not an instance of the given schema"]
        pools: dict[str, list[tuple[str, Any]]] = {}
        for i, value in enumerate(values):
            pools.setdefault(value.schema_name(), []).append((f"{value.schema_name()}#{i}", value))
        problems: list[str] = []
        evaluate = Predicates.Evaluator(self._store)
        for predicate in self._predicates.predicates:
            symbols = list(predicate.symbols)
            for match in itertools.product(*(pools.get(s.name, []) for s in predicate.symbols.values())):
                problem = self._problem(evaluate, predicate.rule, dict(zip(symbols, (value for _, value in match))))
                if problem is not None:
                    label = ", ".join(f"{symbol}={label}" for symbol, (label, _) in zip(symbols, match)) or "the store"
                    problems.append(f"{label}: {predicate.name!r} {problem}")
        return problems

    def _problem(self, evaluate: Predicates.Evaluator, rule: Any, scope: dict[str, Any]) -> str | None:
        try:
            result = Predicates.holds(evaluate, rule, scope)
        except Exception as error:  # a rule that raises is a problem of the data or the rule, reported in place
            return f"raised {type(error).__name__}: {error}"
        if result is None:
            return None if self._unknown == "ignore" else "is unknown" if self._unknown == "report" else "does not hold"
        return None if result else "does not hold"
