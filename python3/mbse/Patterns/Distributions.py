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

from mbse.Expressions import Domains as BasicDomains, Expressions as E
from mbse.Expressions.Framework import Terms
from mbse.Schemas.Framework import Schemas, Stores

from . import Predicates, Sampling

__all__ = ["DIALECT", "OfWeights", "OfCase", "OfDraw", "OfUniform", "OfNormal", "OfPoisson", "OfGeometric",
           "OfCategorical", "OfMixture", "Uniform", "Normal", "Poisson", "Geometric", "Categorical", "Mixture", "domain",
           "draw", "weight", "check", "Sample"]


# --- Distributions of values ---


@dataclass(eq=False)
class OfUniform(Terms.Term):
    """Values spread evenly: ints in [low, high] when both are ints, else floats in [low, high)."""

    KIND = "uniform"
    ROLE = Terms.APPLICATION
    SLOTS = ("low", "high")
    low: Any = None
    high: Any = None


@dataclass(eq=False)
class OfNormal(Terms.Term):
    """Floats from the normal distribution of `mean` and `deviation`; ints, rounded half up, when `rounded`."""

    KIND = "normal"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"rounded": bool}
    OPTIONAL = frozenset({"rounded"})
    SLOTS = ("mean", "deviation")
    rounded: bool | None = None
    mean: Any = None
    deviation: Any = None


@dataclass(eq=False)
class OfPoisson(Terms.Term):
    """Ints from the Poisson distribution of `rate`: counts of events that occur at `rate`."""

    KIND = "poisson"
    ROLE = Terms.APPLICATION
    SLOTS = ("rate",)
    rate: Any = None


@dataclass(eq=False)
class OfGeometric(Terms.Term):
    """Ints: the failures before the first success, of trials that each succeed with `probability`."""

    KIND = "geometric"
    ROLE = Terms.APPLICATION
    SLOTS = ("probability",)
    probability: Any = None


@dataclass(eq=False)
class _Weighted(Terms.Term):
    ROLE = Terms.APPLICATION
    VARIADIC = "options"
    options: tuple[Any, ...] = ()

    def check(self) -> list[str]:
        if not all(isinstance(option, Predicates.OfOption) for option in self.options):
            return [f"{Terms._article(self.KIND)}'s arguments are options"]
        return [] if self.options else [f"{Terms._article(self.KIND)} needs an option"]


@dataclass(eq=False)
class OfCategorical(_Weighted):
    """Values, each chosen with probability proportional to its option's weight."""

    KIND = "categorical"


@dataclass(eq=False)
class OfMixture(_Weighted):
    """Values drawn from distributions, each chosen with probability proportional to its option's weight."""

    KIND = "mixture"


@dataclass(eq=False)
class OfDraw(Terms.Term):
    """A symbol's property, `person.age`, and the distribution its value is drawn from; any other expression is a
    constant, its value."""

    KIND = "draw"
    ROLE = Terms.APPLICATION
    SLOTS = ("property", "distribution")
    property: Any = None
    distribution: Any = None

    def target(self) -> tuple[str, str] | None:
        """The symbol and the property it draws, if its property is a symbol's property."""
        node = self.property
        if (isinstance(node, E.OfOperation.Data) and node.name == "get" and len(node.arguments) == 2
                and isinstance(node.arguments[0], E.OfVariable.Data) and isinstance(node.arguments[1], E.OfLiteral.Data)
                and type(node.arguments[1].value) is str):
            return node.arguments[0].name, node.arguments[1].value
        return None

    def check(self) -> list[str]:
        if self.property is not None and self.target() is None:
            return ["a draw's property must be a symbol's property, such as person.age"]
        return []


def _native(value: Any) -> str | None:
    name = type(value).__name__
    return name if Terms.NATIVES.get(name) is type(value) else None


def domain(distribution: Any) -> str | None:
    """The native type a distribution's values have, `int`, `float`, `str` or `bool`, when it can be told without
    drawing: a normal's are floats (ints when rounded), a Poisson's and a geometric's ints, a uniform's ints when both its bounds are int
    literals and floats when either is a float literal, and a categorical's or a mixture's those all its options give;
    a literal's is its own. None when it cannot be told."""
    if isinstance(distribution, OfNormal):
        return "int" if distribution.rounded else "float"
    if isinstance(distribution, (OfPoisson, OfGeometric)):
        return "int"
    if isinstance(distribution, OfUniform):
        bounds = {domain(distribution.low), domain(distribution.high)}
        return "int" if bounds == {"int"} else "float" if "float" in bounds else None
    if isinstance(distribution, (OfCategorical, OfMixture)):
        found = {domain(getattr(option, "body", None)) for option in distribution.options}
        return found.pop() if len(found) == 1 else None
    if isinstance(distribution, E.OfLiteral.Data):
        return _native(distribution.value)
    return None





@dataclass(eq=False)
class OfCase(Terms.Term):
    """A case of a distribution: a predicate, the weight of the matches it holds of, and draws, the distributions of
    the properties it leaves open. It binds its predicate's symbols within its draws."""

    KIND = "case"
    ROLE = Terms.IMPORT
    PROPERTIES = {"weight": float}
    SLOTS = ("predicate",)
    VARIADIC = "draws"
    weight: float | None = None
    predicate: Any = None
    draws: tuple[Any, ...] = ()

    def binds(self) -> tuple[str, ...]:
        return self.predicate.binds() if isinstance(self.predicate, Predicates.OfPredicate) else ()

    def check(self) -> list[str]:
        problems = []
        if type(self.weight) is float and not (self.weight > 0 and math.isfinite(self.weight)):
            problems.append(f"a case's weight must be positive, got {self.weight!r}")
        if self.predicate is not None and not isinstance(self.predicate, Predicates.OfPredicate):
            problems.append("a case's predicate must be a predicate")
        if not all(isinstance(d, OfDraw) for d in self.draws):
            problems.append("a case's arguments after its predicate are draws")
        return problems

    def draw_problems(self) -> list[str]:
        """The problems of its draws, given its predicate: a draw of a property that is not a symbol's, or of a property
        the symbol's schema does not have, or from a distribution whose values are not the property's type."""
        problems = []
        symbols = self.predicate.symbols if isinstance(self.predicate, Predicates.OfPredicate) else {}
        for j, d in enumerate(self.draws):
            target = d.target() if isinstance(d, OfDraw) else None
            if target is None:
                continue
            symbol, name = target
            schema = symbols.get(symbol)
            if not isinstance(schema, Schemas.OfObject.Data):
                problems.append(f"draw {j}: {symbol!r} is not one of the case's symbols")
                continue
            property_schema = schema.properties.get(name)
            if property_schema is None:
                problems.append(f"draw {j}: {schema.name!r} has no property {name!r}")
            elif isinstance(property_schema, Schemas.OfNative.Data):
                wanted, given = property_schema.token.name, domain(d.distribution)
                if given is not None and given != wanted:
                    problems.append(f"draw {j}: {symbol}.{name} is {wanted}, but its distribution gives {given}")
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
            problems += [f"case {i}: {problem}" for problem in case.draw_problems()]
        return problems


class _CaseBuilder(Terms.Builder, Predicates.Declaring):
    """Builds a case. DSL: `.weight(float)`; `.requires(spec)`, a predicate or a callable taking a predicate builder,
    after which the builder gives the predicate's symbols as variables; and `.draw(property, distribution)`, which adds
    a draw: `.draw(wt.person.age, Normal(lambda n: n.mean(40).deviation(12)))`."""

    _data = OfCase

    def _declared(self) -> tuple[str, ...]:
        state = self.__dict__.get("state")
        found = None if state is None else next((e.links.get("argument") for e in state.entries.get("arguments", [])
                                                 if e.properties.get("index") == 0), None)
        return found.binds() if isinstance(found, Predicates.OfPredicate) else ()

    def weight(self, weight: float) -> _CaseBuilder:
        return self.set("weight", float(weight))

    def requires(self, spec: Any) -> _CaseBuilder:
        return self.argument("predicate", Predicates.OfPredicate.resolve(spec))

    def draw(self, property: Any, distribution: Any) -> _CaseBuilder:
        return self.arguments(OfDraw(DIALECT.resolve(property), DIALECT.resolve(distribution)))


class _BoundsBuilder(Terms.Builder):
    """Builds a uniform. DSL: `.low(spec)` and `.high(spec)`."""

    _data = OfUniform

    def low(self, spec: Any) -> Any:
        return self.argument("low", spec)

    def high(self, spec: Any) -> Any:
        return self.argument("high", spec)


class _NormalBuilder(Terms.Builder):
    """Builds a normal. DSL: `.mean(spec)`, `.deviation(spec)`, and `.rounded()`, for ints."""

    _data = OfNormal

    def rounded(self) -> Any:
        return self.set("rounded", True)

    def mean(self, spec: Any) -> Any:
        return self.argument("mean", spec)

    def deviation(self, spec: Any) -> Any:
        return self.argument("deviation", spec)


class _PoissonBuilder(Terms.Builder):
    """Builds a Poisson. DSL: `.rate(spec)`."""

    _data = OfPoisson

    def rate(self, spec: Any) -> Any:
        return self.argument("rate", spec)


class _GeometricBuilder(Terms.Builder):
    """Builds a geometric. DSL: `.probability(spec)`."""

    _data = OfGeometric

    def probability(self, spec: Any) -> Any:
        return self.argument("probability", spec)


class _OptionsBuilder(Terms.Builder):
    """Builds a categorical or a mixture. DSL: `.option(weight, spec)` adds an option: a value, or a distribution."""

    def option(self, weight: float, spec: Any) -> Any:
        return self.arguments(Predicates.OfOption(float(weight), DIALECT.resolve(spec)))


class _CategoricalBuilder(_OptionsBuilder):
    _data = OfCategorical


class _MixtureBuilder(_OptionsBuilder):
    _data = OfMixture


class _DrawBuilder(Terms.Builder):
    _data = OfDraw


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


_KINDS = (OfWeights, OfCase, OfDraw, OfUniform, OfNormal, OfPoisson, OfGeometric, OfCategorical, OfMixture)
_BUILDERS = (_WeightsBuilder, _CaseBuilder, _DrawBuilder, _BoundsBuilder, _NormalBuilder, _PoissonBuilder,
             _GeometricBuilder, _CategoricalBuilder, _MixtureBuilder)

DIALECT = Terms.Declared(
    "Distributions", _KINDS, domain_of=BasicDomains.of, extends=Predicates.DIALECT,
    builders={kind.KIND: builder for kind, builder in zip(_KINDS, _BUILDERS)},
    schema_names={kind.KIND: f"Patterns.Of{kind.KIND.capitalize()}" for kind in _KINDS},
)
"""The distributions: the predicate algebra's kinds, and the kinds above."""

for _kind, _builder in zip(_KINDS, _BUILDERS):
    _kind.Builder = _builder  # type: ignore[attr-defined]


def Uniform(spec: Any) -> OfUniform:
    """Values spread evenly: `Uniform(lambda u: u.low(0).high(10))`."""
    return Terms.resolve(spec, OfUniform, _BoundsBuilder, "a uniform")


def Normal(spec: Any) -> OfNormal:
    """Floats from a normal distribution: `Normal(lambda n: n.mean(40).deviation(12))`."""
    return Terms.resolve(spec, OfNormal, _NormalBuilder, "a normal")


def Poisson(spec: Any) -> OfPoisson:
    """Ints from a Poisson distribution: `Poisson(lambda p: p.rate(1.5))`."""
    return Terms.resolve(spec, OfPoisson, _PoissonBuilder, "a poisson")


def Geometric(spec: Any) -> OfGeometric:
    """Ints from a geometric distribution: `Geometric(lambda g: g.probability(0.3))`."""
    return Terms.resolve(spec, OfGeometric, _GeometricBuilder, "a geometric")


def Categorical(spec: Any) -> OfCategorical:
    """Values chosen by weight: `Categorical(lambda c: c.option(3, "home").option(1, "work"))`."""
    return Terms.resolve(spec, OfCategorical, _CategoricalBuilder, "a categorical")


def Mixture(spec: Any) -> OfMixture:
    """Values from distributions chosen by weight: `Mixture(lambda m: m.option(1, Normal(...)).option(2, ...))`."""
    return Terms.resolve(spec, OfMixture, _MixtureBuilder, "a mixture")


def _number(value: Any, what: str) -> float:
    if type(value) not in (int, float):
        raise TypeError(f"{what} must be a number, got {type(value).__name__}")
    return float(value)


def draw(evaluate: Predicates.Evaluator, distribution: Any, random: Stores.Random, scope: Mapping[str, Any]) -> Any:
    """A value drawn from `distribution` with `random`, its parameters evaluated with `scope` bound: a constant
    expression's value, if it is not a distribution."""
    def value(expression: Any) -> Any:
        return evaluate.interpreter(expression, scope)

    if isinstance(distribution, OfNormal):
        drawn = Sampling.normal(random, _number(value(distribution.mean), "a normal's mean"),
                                _number(value(distribution.deviation), "a normal's deviation"))
        return math.floor(drawn + 0.5) if distribution.rounded else drawn
    if isinstance(distribution, OfUniform):
        low, high = value(distribution.low), value(distribution.high)
        if type(low) is int and type(high) is int:
            if low > high:
                raise ValueError(f"a uniform's low must not exceed its high, got {low!r} and {high!r}")
            return low + Sampling.below(random, high - low + 1)
        return Sampling.between(random, _number(low, "a uniform's low"), _number(high, "a uniform's high"))
    if isinstance(distribution, OfPoisson):
        return Sampling.poisson(random, _number(value(distribution.rate), "a Poisson's rate"))
    if isinstance(distribution, OfGeometric):
        return Sampling.geometric(random, _number(value(distribution.probability), "a geometric's probability"))
    if isinstance(distribution, (OfCategorical, OfMixture)):
        chosen = distribution.options[Sampling.weighted(random, [option.weight for option in distribution.options])]
        return value(chosen.body) if isinstance(distribution, OfCategorical) else draw(evaluate, chosen.body, random, scope)
    return value(distribution)


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
