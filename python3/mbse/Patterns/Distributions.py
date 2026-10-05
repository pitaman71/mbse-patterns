"""Distributions: how a population of matches is weighted, as weighted predicates.

A distribution of weights, `OfWeights`, is over the matches of its symbols, as a predicate's are: its cases, each a
weight and a predicate over the same symbols, given by reference or inline, say how much each match weighs. Cases are
listed in decreasing precedence: a match weighs what the first case whose predicate holds of it says, and nothing if
none does.

    APerson = {"person": Person}
    Names = (
        Distributions.OfWeights.Builder().name("Names").symbols(APerson).decreasing(
            lambda wt: wt.weight(10).requires(
                lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "alice"))),
            lambda wt: wt.weight(5).requires(
                lambda pred: pred.symbols(APerson).requires(HasName(pred.person, "ben"))),
        )
        .create()
    )

`.requires(spec)` takes a predicate, or a callable taking a predicate builder, which builds one in place. A
distribution is drawn from two ways: `Sample(store, weights)` draws the store's existing matches, each with probability
proportional to its weight, and `Generators.Generate(store, weights)` builds new objects, choosing each case with
probability proportional to its weight. Both draw from a random source the caller gives, `Stores.PCG32(42)` say.

Distributions are terms of `DIALECT`, which extends the predicate algebra (`Predicates.DIALECT`), with meta-schemas
`Patterns.OfWeights` and `Patterns.OfCase`: data, written and read as predicates are (`Constraints.OfStore`).
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from mbse.Expressions import Domains as BasicDomains
from mbse.Expressions.Framework import Terms
from mbse.Schemas.Framework import Schemas, Stores

from . import Predicates, Sampling

__all__ = ["DIALECT", "OfWeights", "OfCase", "weight", "check", "Sample"]


@dataclass(eq=False)
class OfCase(Terms.Term):
    """A case of a distribution: a predicate, and the weight of the matches it holds of."""

    KIND = "case"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"weight": float}
    SLOTS = ("predicate",)
    weight: float | None = None
    predicate: Any = None

    def check(self) -> list[str]:
        problems = []
        if type(self.weight) is float and not (self.weight > 0 and math.isfinite(self.weight)):
            problems.append(f"a case's weight must be positive, got {self.weight!r}")
        if self.predicate is not None and not isinstance(self.predicate, Predicates.OfPredicate):
            problems.append("a case's predicate must be a predicate")
        return problems

    @staticmethod
    def resolve(spec: Any) -> OfCase:
        """A case, or what a callable taking a case builder builds."""
        return Terms.resolve(spec, OfCase, _CaseBuilder, "a case")


def _signature(symbols: Mapping[str, Any]) -> list[tuple[str, Any]]:
    return [(name, schema.name if isinstance(schema, Schemas.OfObject.Data) else None) for name, schema in symbols.items()]


@dataclass(eq=False)
class OfWeights(Terms.Term):
    """The weights of the matches of its symbols: its cases', in decreasing precedence."""

    KIND = "weights"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"name": str}
    OPTIONAL = frozenset({"name"})
    VALUES = {"symbols": Predicates.SYMBOLS}
    VARIADIC = "cases"
    name: str | None = None
    cases: tuple[Any, ...] = ()
    symbols: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.symbols = {} if self.symbols is None else self.symbols

    def check(self) -> list[str]:
        problems = [f"symbol {symbol!r} needs a named reference object schema" for symbol, schema in self.symbols.items()
                    if not (isinstance(schema, Schemas.OfObject.Data) and schema.ref and schema.name is not None)]
        if not all(isinstance(case, OfCase) for case in self.cases):
            return [*problems, "a distribution's arguments are cases"]
        if not self.cases:
            problems.append("a distribution needs a case")
        for i, case in enumerate(self.cases):
            predicate = case.predicate
            if isinstance(predicate, Predicates.OfPredicate):
                if _signature(predicate.symbols) != _signature(self.symbols):
                    problems.append(f"case {i}: its predicate's symbols must be the distribution's")
                if predicate.parameters:
                    problems.append(f"case {i}: its predicate has parameters; apply it instead")
        return problems


class _CaseBuilder(Terms.Builder):
    """Builds a case. DSL: `.weight(float)`, and `.requires(spec)`, a predicate or a callable taking a predicate
    builder."""

    _data = OfCase

    def weight(self, weight: float) -> _CaseBuilder:
        return self.set("weight", float(weight))

    def requires(self, spec: Any) -> _CaseBuilder:
        return self.argument("predicate", Predicates.OfPredicate.resolve(spec))


class _WeightsBuilder(Terms.Builder, Predicates.Declaring):
    """Builds a distribution of weights. DSL: `.name(str)`, `.symbols({name: schema})`, added to those already given,
    and `.decreasing(*specs)`, its cases in decreasing precedence, each a case or a callable taking a case builder,
    added after those already given."""

    _data = OfWeights

    def __init__(self, instance: Any = None):
        super().__init__(instance)
        self._symbols: dict[str, Any] = {} if instance is None else dict(instance.symbols)
        self.state.values.pop("symbols", None)  # held as data: see Predicates

    def _declared(self) -> tuple[str, ...]:
        return tuple(self.__dict__.get("_symbols", {}))

    def name(self, name: str) -> _WeightsBuilder:
        return self.set("name", name)

    def symbols(self, symbols: Mapping[str, Any]) -> _WeightsBuilder:
        self._symbols.update(symbols)
        return self

    def decreasing(self, *specs: Any) -> _WeightsBuilder:
        return self.arguments(*map(OfCase.resolve, specs))

    def create(self) -> Any:
        made = super().create()
        made.symbols = dict(self._symbols)
        return made

    def clone(self) -> Any:
        made = super().clone()
        made.symbols = dict(self._symbols)
        return made

    def update(self) -> Any:
        made = super().update()
        made.symbols = dict(self._symbols)
        return made


DIALECT = Terms.Declared(
    "Distributions", [OfWeights, OfCase], domain_of=BasicDomains.of, extends=Predicates.DIALECT,
    builders={"weights": _WeightsBuilder, "case": _CaseBuilder},
    schema_names={"weights": "Patterns.OfWeights", "case": "Patterns.OfCase"},
)
"""The distributions: the predicate algebra's kinds, and the kinds above."""

OfWeights.Builder = _WeightsBuilder  # type: ignore[attr-defined]
OfCase.Builder = _CaseBuilder  # type: ignore[attr-defined]


def weight(evaluate: Predicates.Evaluator, weights: OfWeights, match: Mapping[str, Any]) -> float:
    """What `match` weighs: the weight of the first case whose predicate holds of it, or 0.0."""
    for case in weights.cases:
        if Predicates.holds(evaluate, case.predicate.rule, match) is True:
            return case.weight  # type: ignore[no-any-return]
    return 0.0


def check(weights: OfWeights) -> OfWeights:
    """`weights`, raising `ValueError` with every problem validation reports."""
    problems = DIALECT.validate(weights, core=True)
    if problems:
        raise ValueError(f"the distribution cannot be drawn from: {'; '.join(problems)}")
    return weights


def Sample(store: Stores.Store, weights: OfWeights, random: Stores.Random) -> Iterator[dict[str, Any]]:
    """Matches of the store's data drawn with replacement, each with probability proportional to its weight, from
    `random`. The distribution is checked when called; the store is read at the first draw."""
    check(weights)
    return _sample(store, weights, random)


def _sample(store: Stores.Store, weights: OfWeights, random: Stores.Random) -> Iterator[dict[str, Any]]:
    evaluate = Predicates.Evaluator(store)
    names = list(weights.symbols)
    matches = [dict(zip(names, objects)) for objects in itertools.product(
        *(evaluate.extent(schema.name) for schema in weights.symbols.values()))]
    weighed = [weight(evaluate, weights, match) for match in matches]
    if not any(weighed):
        raise ValueError("no match of the store's data has a weight")
    while True:
        yield matches[Sampling.weighted(random, weighed)]
