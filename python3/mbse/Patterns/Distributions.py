"""Distributions: terms of the predicate algebra that weigh alternatives and draw values.

A pattern is a predicate: its constraint says what holds of a match, and these terms, in its constraint, say how matches
are distributed, so that one predicate is validated, queried, sampled from and generated from alike.

    APerson = {"person": Person}
    People = (
        Predicates.OfPredicate.Builder().name("People").symbols(APerson).requires(
            Distributions.Choices.Builder().arms(
                lambda a: a.weight(3).requires(
                    HasName(person, "senior"),
                    Distributions.Normal.Builder().symbol("age").mean(70).deviation(8).rounded()
                    .requires(lambda person, age: person.age == age).create()),
                lambda a: a.weight(7).requires(HasName(person, "adult")),
            ).count(lambda c: c >= 1).decreasing().create())
        .create()
    )

- **`Choices`** weighs alternatives, its arms, each a weight and conditions (`a.weight(3).requires(*specs)`, their
  conjunction). It holds when the number of arms that hold satisfies its count, a condition read from a function whose
  parameter is bound to the number (`.count(lambda c: c >= 1)`, the default). A generator chooses an arm by weight and
  makes it hold. With `.decreasing()`, its arms are in decreasing precedence: a match falls under the first arm that
  holds, and a generated match must fall under the arm chosen for it; without, every arm that holds counts.
- **A distribution binds a symbol** within its body, `.requires(...)`, to a value drawn from it: `Normal` (floats, or
  ints rounded half up with `.rounded()`), `Uniform` (ints in [low, high] when both bounds are ints, else floats in
  [low, high)), `Poisson` and `Geometric` (ints, for counts) and `Categorical` (values by weight, `.option(3, "ann")`).
  A generator draws the value and makes the body hold: an equality `person.age == age` sets the property. A validator
  takes the value from such an equality, its witness: the term holds when the witness is in the distribution's support
  and the body holds with the symbol bound to it, and is unknown when the body has no witness. Its parameters are
  expressions, evaluated where it is; the symbol is bound within them too, so name it apart from the names they read.
  `.requires(...)` reads a function as a condition, as `Python.Text.FromFunction` does (`lambda person, age:
  person.age == age`, whose parameters are the names it reads); any other spec is an expression of the algebra.

`domain(distribution)` gives the native type a distribution's values have, and `typing(predicate)` the problems of a
predicate whose distributions set a property of another type ("person.age is int, but its distribution gives
float"). The terms are kinds of `Predicates.DIALECT`, with meta-schemas `Patterns.OfChoices`, `Patterns.OfNormal`, ...:
data, written and read as predicates are.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from mbse.Expressions import Expressions as E
from mbse.Expressions.Dialects.Python import Text
from mbse.Expressions.Framework import Terms
from mbse.Schemas.Framework import Schemas

__all__ = ["Choices", "Arm", "Count", "Option", "Uniform", "Normal", "Poisson", "Geometric", "Categorical", "KINDS",
           "BUILDERS", "DRAWN", "domain", "witness", "typing"]


def _positive(kind: str, weight: Any) -> list[str]:
    if type(weight) is float and not (weight > 0 and math.isfinite(weight)):
        return [f"{Terms._article(kind)}'s weight must be positive, got {weight!r}"]
    return []


def _conjunction(conditions: list[Any]) -> Any:
    constraint = None
    for condition in conditions:
        constraint = condition if constraint is None else E.operation("and", constraint, condition).data
    return constraint


def _existing(builder: Terms.Builder, index: int) -> Any:
    """The argument a builder holds at `index`, if any."""
    return next((entry.links.get("argument") for entry in builder.state.entries.get("arguments", [])
                 if entry.properties.get("index") == index), None)


# --- Choices ---


@dataclass(eq=False)
class Count(Terms.Term):
    """A condition on a number, bound to `name` within it: how many of a choice's arms may hold."""

    KIND = "count"
    ROLE = Terms.IMPORT
    PROPERTIES = {"name": str}
    SLOTS = ("condition",)
    name: str | None = None
    condition: Any = None

    def binds(self) -> tuple[str, ...]:
        return () if self.name is None else (self.name,)


@dataclass(eq=False)
class Arm(Terms.Term):
    """An arm of a choice: its condition, and its weight."""

    KIND = "arm"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"weight": float}
    SLOTS = ("condition",)
    weight: float | None = None
    condition: Any = None

    def check(self) -> list[str]:
        return _positive(self.KIND, self.weight)

    @staticmethod
    def resolve(spec: Any) -> Arm:
        """An arm, or what a callable taking an arm builder builds."""
        return Terms.resolve(spec, Arm, _ArmBuilder, "an arm")


@dataclass(eq=False)
class Choices(Terms.Term):
    """Weighted alternatives: it holds when the number of its arms that hold satisfies its count; with `decreasing`,
    its arms are in decreasing precedence."""

    KIND = "choices"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"decreasing": bool}
    OPTIONAL = frozenset({"decreasing"})
    SLOTS = ("count",)
    VARIADIC = "arms"
    decreasing: bool | None = None
    count: Any = None
    arms: tuple[Any, ...] = ()

    def check(self) -> list[str]:
        problems = [] if self.count is None or isinstance(self.count, Count) else ["a choices' count must be a count"]
        if not all(isinstance(arm, Arm) for arm in self.arms):
            return [*problems, "a choices' arguments after its count are arms"]
        return problems if self.arms else [*problems, "a choices needs an arm"]


# --- Distributions of values ---


@dataclass(eq=False)
class _Drawn(Terms.Term):
    """A distribution, binding `symbol` within its body (and its parameters) to a value drawn from it."""

    ROLE = Terms.IMPORT
    PROPERTIES = {"symbol": str}

    def binds(self) -> tuple[str, ...]:
        symbol = self.symbol  # type: ignore[attr-defined]
        return () if symbol is None else (symbol,)


@dataclass(eq=False)
class Uniform(_Drawn):
    """Values spread evenly: ints in [low, high] when both are ints, else floats in [low, high)."""

    KIND = "uniform"
    SLOTS = ("body", "low", "high")
    symbol: str | None = None
    body: Any = None
    low: Any = None
    high: Any = None


@dataclass(eq=False)
class Normal(_Drawn):
    """Floats from the normal distribution of `mean` and `deviation`; ints, rounded half up, when `rounded`."""

    KIND = "normal"
    PROPERTIES = {"symbol": str, "rounded": bool}
    OPTIONAL = frozenset({"rounded"})
    SLOTS = ("body", "mean", "deviation")
    symbol: str | None = None
    rounded: bool | None = None
    body: Any = None
    mean: Any = None
    deviation: Any = None


@dataclass(eq=False)
class Poisson(_Drawn):
    """Ints from the Poisson distribution of `rate`: counts of events that occur at `rate`."""

    KIND = "poisson"
    SLOTS = ("body", "rate")
    symbol: str | None = None
    body: Any = None
    rate: Any = None


@dataclass(eq=False)
class Geometric(_Drawn):
    """Ints: the failures before the first success, of trials that each succeed with `probability`."""

    KIND = "geometric"
    SLOTS = ("body", "probability")
    symbol: str | None = None
    body: Any = None
    probability: Any = None


@dataclass(eq=False)
class Option(Terms.Term):
    """An option of a categorical: its value, and its weight."""

    KIND = "option"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"weight": float}
    SLOTS = ("value",)
    weight: float | None = None
    value: Any = None

    def check(self) -> list[str]:
        return _positive(self.KIND, self.weight)


@dataclass(eq=False)
class Categorical(_Drawn):
    """Values, each chosen with probability proportional to its option's weight."""

    KIND = "categorical"
    SLOTS = ("body",)
    VARIADIC = "options"
    symbol: str | None = None
    body: Any = None
    options: tuple[Any, ...] = ()

    def check(self) -> list[str]:
        if not all(isinstance(option, Option) for option in self.options):
            return ["a categorical's arguments after its body are options"]
        return [] if self.options else ["a categorical needs an option"]


DRAWN = (Uniform, Normal, Poisson, Geometric, Categorical)
"""The distributions of values: the kinds that bind a symbol to a value drawn from them."""


# --- Builders ---


class _CountBuilder(Terms.Builder):
    _data = Count


class _ArmBuilder(Terms.Builder):
    """Builds an arm. DSL: `.weight(float)`, and `.requires(*specs)`, conditions added to its own, which it conjoins."""

    _data = Arm

    def __init__(self, instance: Any = None):
        super().__init__(instance)
        self._conditions: list[Any] = []

    def weight(self, weight: float) -> _ArmBuilder:
        return self.set("weight", float(weight))

    def requires(self, *specs: Any) -> _ArmBuilder:
        self._conditions += [self._data.DIALECT.resolve(spec) for spec in specs]
        return self

    def _fold(self) -> None:
        if self._conditions:
            existing = _existing(self, 0)
            self.argument("condition", _conjunction([*([] if existing is None else [existing]), *self._conditions]))
            self._conditions = []

    def create(self) -> Any:
        self._fold()
        return super().create()

    def clone(self) -> Any:
        self._fold()
        return super().clone()

    def update(self) -> Any:
        self._fold()
        return super().update()


class _ChoicesBuilder(Terms.Builder):
    """Builds a choices. DSL: `.arms(*specs)`, each an arm or a callable taking an arm builder, added in order;
    `.count(function)`, the condition on how many arms hold, read from a function of one parameter, bound to the
    number (`lambda c: c >= 1`, the default); and `.decreasing()`."""

    _data = Choices

    def arms(self, *specs: Any) -> _ChoicesBuilder:
        return self.arguments(*map(Arm.resolve, specs))

    def count(self, condition: Callable[[Any], Any]) -> _ChoicesBuilder:
        code = getattr(condition, "__code__", None)
        if code is None or code.co_argcount != 1:
            raise TypeError("a choices' count is a function of one number")
        return self.argument("count", Count(code.co_varnames[0], Text.FromFunction(condition).data))

    def decreasing(self) -> _ChoicesBuilder:
        return self.set("decreasing", True)

    def _fold(self) -> None:
        if _existing(self, 0) is None:
            self.argument("count", Count("c", E.variable("c").ge(1).data))

    def create(self) -> Any:
        self._fold()
        return super().create()

    def clone(self) -> Any:
        self._fold()
        return super().clone()

    def update(self) -> Any:
        self._fold()
        return super().update()


class _DrawnBuilder(Terms.Builder):
    """Builds a distribution. DSL: `.symbol(str)`, the name it binds, which the builder then gives as a variable, and
    `.requires(*specs)`, conditions added to its body, which it conjoins: a function is read as
    `Python.Text.FromFunction` reads it, and any other spec is an expression of the algebra."""

    def __init__(self, instance: Any = None):
        super().__init__(instance)
        self._conditions: list[Any] = []

    def __getattr__(self, name: str) -> Any:
        state = self.__dict__.get("state")
        if not name.startswith("_") and state is not None and state.values.get("symbol") == name:
            return E.variable(name)
        raise AttributeError(name)

    def symbol(self, name: str) -> Any:
        return self.set("symbol", name)

    def requires(self, *specs: Any) -> Any:
        for spec in specs:
            code = getattr(spec, "__code__", None)
            self._conditions.append(Text.FromFunction(spec).data if code is not None else self._data.DIALECT.resolve(spec))
        return self

    def _fold(self) -> None:
        if self._conditions:
            existing = _existing(self, 0)
            self.argument("body", _conjunction([*([] if existing is None else [existing]), *self._conditions]))
            self._conditions = []

    def create(self) -> Any:
        self._fold()
        return super().create()

    def clone(self) -> Any:
        self._fold()
        return super().clone()

    def update(self) -> Any:
        self._fold()
        return super().update()


class _UniformBuilder(_DrawnBuilder):
    """Builds a uniform. DSL: `.low(spec)` and `.high(spec)`, with the distribution's."""

    _data = Uniform

    def low(self, spec: Any) -> Any:
        return self.argument("low", spec)

    def high(self, spec: Any) -> Any:
        return self.argument("high", spec)


class _NormalBuilder(_DrawnBuilder):
    """Builds a normal. DSL: `.mean(spec)`, `.deviation(spec)` and `.rounded()`, for ints, with the distribution's."""

    _data = Normal

    def mean(self, spec: Any) -> Any:
        return self.argument("mean", spec)

    def deviation(self, spec: Any) -> Any:
        return self.argument("deviation", spec)

    def rounded(self) -> Any:
        return self.set("rounded", True)


class _PoissonBuilder(_DrawnBuilder):
    """Builds a Poisson. DSL: `.rate(spec)`, with the distribution's."""

    _data = Poisson

    def rate(self, spec: Any) -> Any:
        return self.argument("rate", spec)


class _GeometricBuilder(_DrawnBuilder):
    """Builds a geometric. DSL: `.probability(spec)`, with the distribution's."""

    _data = Geometric

    def probability(self, spec: Any) -> Any:
        return self.argument("probability", spec)


class _CategoricalBuilder(_DrawnBuilder):
    """Builds a categorical. DSL: `.option(weight, value)` adds an option, with the distribution's."""

    _data = Categorical

    def option(self, weight: float, value: Any) -> Any:
        return self.arguments(Option(float(weight), self._data.DIALECT.resolve(value)))


class _OptionBuilder(Terms.Builder):
    _data = Option


KINDS = (Choices, Arm, Count, Uniform, Normal, Poisson, Geometric, Categorical, Option)
"""The kinds this module adds to the predicate algebra."""

BUILDERS = (_ChoicesBuilder, _ArmBuilder, _CountBuilder, _UniformBuilder, _NormalBuilder, _PoissonBuilder,
            _GeometricBuilder, _CategoricalBuilder, _OptionBuilder)
"""Their builders, in the same order."""

for _kind, _builder in zip(KINDS, BUILDERS):
    _kind.Builder = _builder  # type: ignore[attr-defined]


# --- Checks ---


def _native(value: Any) -> str | None:
    name = type(value).__name__
    return name if Terms.NATIVES.get(name) is type(value) else None


def domain(distribution: Any) -> str | None:
    """The native type a distribution's values have, `int`, `float`, `str` or `bool`, when it can be told without
    drawing: a normal's are floats (ints when rounded), a Poisson's and a geometric's ints, a uniform's ints when both
    its bounds are int literals and floats when either is a float literal, and a categorical's that of all its options'
    literal values; a literal's is its own. None when it cannot be told."""
    if isinstance(distribution, Normal):
        return "int" if distribution.rounded else "float"
    if isinstance(distribution, (Poisson, Geometric)):
        return "int"
    if isinstance(distribution, Uniform):
        bounds = {domain(distribution.low), domain(distribution.high)}
        return "int" if bounds == {"int"} else "float" if "float" in bounds else None
    if isinstance(distribution, Categorical):
        found = {domain(getattr(option, "value", None)) for option in distribution.options}
        return found.pop() if len(found) == 1 else None
    if isinstance(distribution, E.OfLiteral.Data):
        return _native(distribution.value)
    return None


def _equalities(node: Any) -> list[tuple[Any, Any]]:
    """The equalities among a condition's conjuncts, each both ways: `(a, b)` and `(b, a)` for `a == b`."""
    if isinstance(node, E.OfOperation.Data) and node.name == "and" and len(node.arguments) == 2:
        return [*_equalities(node.arguments[0]), *_equalities(node.arguments[1])]
    if isinstance(node, E.OfOperation.Data) and node.name == "eq" and len(node.arguments) == 2:
        a, b = node.arguments
        return [(a, b), (b, a)]
    return []


def _reads(node: Any, name: str) -> bool:
    """Whether `node` reads the variable `name`."""
    if isinstance(node, E.OfVariable.Data):
        return node.name == name
    return isinstance(node, Terms.Term) and any(_reads(argument, name) for argument in node._arguments())


def witness(drawn: Any) -> Any:
    """The expression a distribution's body equates its symbol with, not reading the symbol itself: its value, for a
    validator; None if there is none."""
    return next((other for side, other in _equalities(drawn.body)
                 if isinstance(side, E.OfVariable.Data) and side.name == drawn.symbol and not _reads(other, drawn.symbol)),
                None)


def typing(predicate: Any) -> list[str]:
    """The problems of a predicate's distributions that set a property of its symbols (`person.age == age`, in the
    distribution's body) to values of another type than the property's, as far as their domains tell."""
    problems: list[str] = []

    def visit(node: Any) -> None:
        if getattr(node, "KIND", None) == "predicate":
            return  # an applied predicate's are its own
        if isinstance(node, DRAWN):
            given = domain(node)
            for side, other in _equalities(node.body):
                if not (isinstance(other, E.OfVariable.Data) and other.name == node.symbol):
                    continue
                if not (isinstance(side, E.OfOperation.Data) and side.name == "get" and len(side.arguments) == 2
                        and isinstance(side.arguments[0], E.OfVariable.Data)
                        and isinstance(side.arguments[1], E.OfLiteral.Data)):
                    continue
                symbol, name = side.arguments[0].name, side.arguments[1].value
                schema = predicate.symbols.get(symbol)
                declared = schema.properties.get(name) if isinstance(schema, Schemas.OfObject.Data) else None
                property_schema = declared and declared.type
                if isinstance(property_schema, Schemas.OfNative.Data) and given is not None:
                    wanted = property_schema.token.name
                    if wanted != given:
                        problems.append(f"{symbol}.{name} is {wanted}, but its distribution gives {given}")
        for argument in node._arguments() if isinstance(node, Terms.Term) else ():
            visit(argument)

    visit(predicate.requires)
    return problems
