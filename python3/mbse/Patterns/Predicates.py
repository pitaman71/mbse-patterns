"""Predicates: named constraints over a store's objects, and the predicate algebra they are written in.

A predicate is a named constraint over symbols, each bound to an object of a schema, and parameters, each a value; it
applies to a *match*, a binding of every symbol to an object of its schema. It is built as schemas are, by a fluent
builder finalized by `create()`, `clone()` or `update()`, none of which validates:

    APerson = {"person": Person}
    HasName = (
        Predicates.OfPredicate.Builder()
        .name("HasName")
        .symbols(APerson)
        .parameters(lambda p: p.name("name"))
        .requires(Text.FromFunction(lambda person, name: person.name == name))
        .create()
    )

`.parameters(...)` takes property specs, as an object schema's `.properties(...)` does, each with a name and, optionally,
a type. `.requires(spec)` adds a condition, and `.forbids(spec)` the condition that `spec` does not hold; its `requires`
is their conjunction. A condition is any spec of the algebra: a term, a writer, or what `Python.Text.FromFunction` reads
from a function whose parameters are the symbols and parameters. A builder gives the variables it declares by name, so
`pred.person` is the variable `person` once `pred.symbols(APerson)` declares it. A predicate without symbols is a
statement about the whole store; one without a name is written inline, where it is used.

A predicate is a term of the algebra, `DIALECT`, which extends mbse-expressions' Basic: it binds its symbols and
parameters within `requires` (an import, in mbse-expressions' terms). Applying it, `HasName(pred.person, "alice")`, is a
term too, `OfApply`, which holds the predicate itself, by reference, and arguments for its symbols and then its
parameters, in order: it holds when the predicate's `requires` holds with them bound. A predicate used in several places
is one object, and is written once.

The algebra's other terms, each a data class with a builder, are built as a predicate is, from a spec (data, or a
callable taking the builder):

- `Exists(spec)` and `Forall(spec)`: whether some, or every, binding of the builder's `.symbols({...})` to objects of
  their schemas satisfies its `.requires(...)` and `.forbids(...)` (several symbols are their cross product);
- `Contains(c.phones, lambda e: e.phone == p)`: whether one of `c`'s entries in its adjacency `phones` satisfies the
  condition, read from the function, with its parameter bound to the entry: the targets of the entry's other links, and
  its property values, by name. It is Basic's `any` over `entries(c, 'phones')`;
- `Distributions.Choices` and the distributions of values (`Distributions.Normal`, ...): weighted alternatives, and
  values drawn, which say how matches are distributed (see `Distributions`);
- `OfSet`: predicates, gathered in order.

A quantifier ranges over its schema's extent in the store (its `extent` term: what the store's singletons reach).
`DIALECT` validates the trees that mix the algebra's terms with Basic's; `Evaluator(store)` evaluates them, with the
store giving extents, and Basic's three-valued rules for everything else.

Predicates and sets are mbse-schemas reference objects, as every term is, with meta-schemas `Patterns.Predicate` and
`Patterns.Set`: a symbol's schema is written as a property's type is, by its name or inline, and a term is its
arguments' parent through Basic's relation `Expressions.Arguments`. Reading resolves the symbols' schemas by name, so it
goes through a store that resolves them (`Constraints.OfStore`).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from mbse.Expressions import Domains as BasicDomains, Evaluators as Basic, Expressions as E
from mbse.Expressions.Dialects.Python import Text
from mbse.Expressions.Framework import Evaluators as F, Symbolics, Terms
from mbse.Schemas.Framework import Modules, Schemas, Stores

from . import Distributions

__all__ = ["DIALECT", "OfPredicate", "OfApply", "OfSet", "Exists", "Forall", "Contains", "Evaluator",
           "holds", "OfExtent", "OfForall", "OfExists", "SYMBOLS", "PARAMETERS", "PREDICATE",
           "SET", "resolving", "Declaring"]

PREDICATE, SET = "Patterns.Predicate", "Patterns.Set"


def _schema_name(schema: Any) -> str:
    name = schema if isinstance(schema, str) else getattr(schema, "name", None)
    if not isinstance(name, str):
        raise TypeError(f"expected a named schema or its name, got {schema!r}")
    return name


def _conjunction(conditions: list[Any]) -> Any:
    """The conditions' conjunction, left to right; None if there are none."""
    constraint = None
    for condition in conditions:
        constraint = condition if constraint is None else E.operation("and", constraint, condition).data
    return constraint


def _negation(spec: Any) -> Any:
    return E.operation("not", DIALECT.resolve(spec)).data


# --- Symbols and parameters: value properties, whose schemas are resolved by name while reading ---

_STORES: list[Stores.Store] = [Stores.Catalog()]  # type: ignore[list-item]


@contextmanager
def resolving(store: Stores.Store) -> Iterator[None]:
    """Within it, symbols' and parameters' schemas read from a snapshot are resolved by name in `store`."""
    _STORES.append(store)
    try:
        yield
    finally:
        _STORES.pop()


def _type(entry: Mapping[str, Any]) -> Any:
    return Modules.resolve(_STORES[-1], entry["type"]) if entry.get("type") is not None else None


def _typed(name: str, schema: Any) -> dict[str, Any]:
    return {"name": name} if schema is None else {"name": name, "type": Modules.reference(schema)}


_LIST = Schemas.OfIndexed.Builder().of(Schemas.OfProperty.Schema).create()

SYMBOLS = Terms.ValueProperty(_LIST, lambda symbols: [_typed(n, s) for n, s in symbols.items()] or None,
                              lambda plain: {entry["name"]: _type(entry) for entry in plain})
"""Symbols by name, each with the schema of the objects it binds, written as an object schema's properties are; none
are not written."""

PARAMETERS = SYMBOLS
"""Parameters by name, each with its type, or None for a parameter of any type, written as symbols are."""


VALUES_HELD = ("symbols", "parameters")


class Declaring:
    """A builder that declares variables: `builder.name` gives the variable `name` once it is declared. Its class gives
    the names it declares, by `_declared()`."""

    def __getattr__(self, name: str) -> Any:
        if not name.startswith("_") and name in self._declared():  # type: ignore[attr-defined]
            return E.variable(name)
        raise AttributeError(name)


# --- Terms ---


@dataclass(eq=False)
class OfExtent(Terms.Term):
    """The objects of the schema named `schema` in the store."""

    KIND = "extent"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"schema": str}
    schema: str | None = None


@dataclass(eq=False)
class _Quantified(Terms.Term):
    ROLE = Terms.QUANTIFIER
    PROPERTIES = {"name": str}
    SLOTS = ("collection", "body")
    name: str | None = None
    collection: Any = None  # an extent
    body: Any = None


@dataclass(eq=False)
class OfForall(_Quantified):
    """Whether the body holds for every object of the collection, with `name` bound to it."""

    KIND = "forall"


@dataclass(eq=False)
class OfExists(_Quantified):
    """Whether the body holds for some object of the collection, with `name` bound to it."""

    KIND = "exists"


@dataclass(eq=False)
class OfPredicate(Terms.Term):
    """A constraint over symbols and parameters, which it binds within the constraint it `requires`. Calling it, `predicate(*arguments)`, applies
    it: see `OfApply`."""

    KIND = "predicate"
    ROLE = Terms.IMPORT
    PROPERTIES = {"name": str, "description": str}
    OPTIONAL = frozenset({"name", "description"})
    VALUES = {"symbols": SYMBOLS, "parameters": PARAMETERS}
    SLOTS = ("requires",)
    name: str | None = None
    description: str | None = None
    requires: Any = None
    symbols: dict[str, Any] = field(default_factory=dict)  # symbol -> schema
    parameters: dict[str, Any] = field(default_factory=dict)  # parameter -> type, or None

    def __post_init__(self) -> None:
        self.symbols = {} if self.symbols is None else self.symbols
        self.parameters = {} if self.parameters is None else self.parameters

    def binds(self) -> tuple[str, ...]:
        return (*self.symbols, *self.parameters)

    def check(self) -> list[str]:
        return [f"symbol {symbol!r} needs a named reference object schema" for symbol, schema in self.symbols.items()
                if not (isinstance(schema, Schemas.OfObject.Data) and schema.ref and schema.name is not None)]

    def call(self, *arguments: Any) -> OfApply:
        """The predicate applied to `arguments`, specs for its symbols and then its parameters, in order."""
        return OfApply(self, tuple(DIALECT.resolve(argument) for argument in arguments))

    __call__ = call

    @staticmethod
    def resolve(spec: Any) -> OfPredicate:
        """A predicate, or what a callable taking a predicate builder builds."""
        return Terms.resolve(spec, OfPredicate, _PredicateBuilder, "a predicate")


@dataclass(eq=False)
class OfApply(Terms.Term):
    """A predicate applied to arguments, for its symbols and then its parameters: whether its `requires` holds with them
    bound."""

    KIND = "apply"
    ROLE = Terms.APPLICATION
    SLOTS = ("predicate",)
    VARIADIC = "arguments"
    predicate: Any = None
    arguments: tuple[Any, ...] = ()

    def check(self) -> list[str]:
        if not isinstance(self.predicate, OfPredicate):
            return ["an application's predicate must be a predicate"] if self.predicate is not None else []
        wanted = len(self.predicate.binds())
        if len(self.arguments) != wanted:
            return [f"{self.predicate.name!r} takes {wanted} arguments, got {len(self.arguments)}"]
        return []


@dataclass(eq=False)
class OfSet(Terms.Term):
    """Predicates, in order."""

    KIND = "set"
    ROLE = Terms.APPLICATION
    VARIADIC = "predicates"
    predicates: tuple[Any, ...] = ()

    def check(self) -> list[str]:
        return [] if all(isinstance(p, OfPredicate) for p in self.predicates) else ["a set's arguments are predicates"]


# --- Builders ---


class _QuantifiedBuilder(Terms.Builder, Declaring):
    """Builds a quantifier. DSL: `.symbols({name: schema})`, each schema a named schema or its name, added to those
    already given, and `.requires(spec)` and `.forbids(spec)`, which add conditions to the body. The first symbol is
    this quantifier's; each other is a quantifier of the same kind in the body, within which the conditions hold. As
    a `Visitors.OfObject`, the collection is the `arguments` entry with index 0 and the body the one with index 1."""

    def __init__(self, instance: Any = None):
        super().__init__(instance)
        self._inner: dict[str, str] = {}
        self._conditions: list[Any] = []

    def _declared(self) -> tuple[str, ...]:
        state = self.__dict__.get("state")
        name = None if state is None else state.values.get("name")
        return (*([] if name is None else [name]), *self.__dict__.get("_inner", {}))

    def symbols(self, symbols: Mapping[str, Any]) -> Any:
        for name, schema in symbols.items():
            if "name" in self.state.values or self._inner:
                self._inner[name] = _schema_name(schema)
            else:
                self.set("name", name).argument("collection", OfExtent(_schema_name(schema)))
        return self

    def requires(self, *specs: Any) -> Any:
        self._conditions += [DIALECT.resolve(spec) for spec in specs]
        return self

    def forbids(self, *specs: Any) -> Any:
        self._conditions += [_negation(spec) for spec in specs]
        return self

    def _fold(self) -> None:
        """Writes the pending symbols and conditions into the body."""
        if not (self._inner or self._conditions):
            return
        body = next((entry.links.get("argument") for entry in self.state.entries.get("arguments", [])
                     if entry.properties.get("index") == 1), None)
        body = _conjunction([*([] if body is None else [body]), *self._conditions])
        for name, schema in reversed(self._inner.items()):
            body = self._data(name, OfExtent(schema), body)  # type: ignore[call-arg]
        self._inner, self._conditions = {}, []
        self.argument("body", body)

    def create(self) -> Any:
        self._fold()
        return super().create()

    def clone(self) -> Any:
        self._fold()
        return super().clone()

    def update(self) -> Any:
        self._fold()
        return super().update()


class _ForallBuilder(_QuantifiedBuilder):
    _data = OfForall


class _ExistsBuilder(_QuantifiedBuilder):
    _data = OfExists


class _ExtentBuilder(Terms.Builder):
    """Builds an extent. DSL: `.schema(schema)`, a named schema or its name."""

    _data = OfExtent

    def schema(self, schema: Any) -> _ExtentBuilder:
        return self.set("schema", _schema_name(schema))


class _PredicateBuilder(Terms.Builder, Declaring):
    """Builds a predicate. DSL: `.name(str)`, `.description(str)`, `.symbols({name: schema})` and `.parameters(*specs)`,
    each added to those already given, in order, and `.requires(spec)` and `.forbids(spec)`, which add conditions to
    `requires`. `.symbols(...)` and `.parameters(...)` are written as the builder is finalized."""

    _data = OfPredicate

    def __init__(self, instance: Any = None):
        super().__init__(instance)
        self._symbols: dict[str, Any] = {} if instance is None else dict(instance.symbols)
        self._parameters: dict[str, Any] = {} if instance is None else dict(instance.parameters)
        self._conditions: list[Any] = []
        for name in VALUES_HELD:  # held as data, not in their plain form, which only reading a snapshot resolves
            self.state.values.pop(name, None)

    def _declared(self) -> tuple[str, ...]:
        return (*self.__dict__.get("_symbols", {}), *self.__dict__.get("_parameters", {}))

    def name(self, name: str) -> _PredicateBuilder:
        return self.set("name", name)

    def description(self, text: str) -> _PredicateBuilder:
        return self.set("description", text)

    def symbols(self, symbols: Mapping[str, Any]) -> _PredicateBuilder:
        """Symbols by name, each with the schema of the objects it binds, in order; added to those already given."""
        self._symbols.update(symbols)
        return self

    def parameters(self, *specs: Schemas.OfProperty.Spec) -> _PredicateBuilder:
        """Parameters, each a property spec (`lambda p: p.name("name")`, with `.of(type)` optionally), in order."""
        for spec in specs:
            built = spec(Schemas.OfProperty.Builder()).create()
            self._parameters[built.name] = built.type
        return self

    def requires(self, *specs: Any) -> _PredicateBuilder:
        """Adds conditions: specs of the algebra whose free names are the symbols and parameters."""
        self._conditions += [DIALECT.resolve(spec) for spec in specs]
        return self

    def forbids(self, *specs: Any) -> _PredicateBuilder:
        """Adds the conditions that each of `specs` does not hold."""
        self._conditions += [_negation(spec) for spec in specs]
        return self

    def _fold(self, made: Any) -> Any:
        made.symbols, made.parameters = dict(self._symbols), dict(self._parameters)
        return made

    def _write_requires(self) -> None:
        if self._conditions:
            constraint = next((entry.links.get("argument") for entry in self.state.entries.get("arguments", [])), None)
            self.argument("requires", _conjunction([*([] if constraint is None else [constraint]), *self._conditions]))
            self._conditions = []

    def create(self) -> Any:
        self._write_requires()
        return self._fold(super().create())

    def clone(self) -> Any:
        self._write_requires()
        return self._fold(super().clone())

    def update(self) -> Any:
        self._write_requires()
        return self._fold(super().update())


class _SetBuilder(Terms.Builder):
    """Builds a set. DSL: `.predicates(*specs)`, each a predicate or a callable taking a predicate builder, added in
    order."""

    _data = OfSet

    def predicates(self, *specs: Any) -> _SetBuilder:
        return self.arguments(*map(OfPredicate.resolve, specs))


_KINDS = (OfExtent, OfForall, OfExists, OfPredicate, OfApply, OfSet, *Distributions.KINDS)
_BUILDERS = (_ExtentBuilder, _ForallBuilder, _ExistsBuilder, _PredicateBuilder, Terms.Builder, _SetBuilder,
             *Distributions.BUILDERS)
_NAMES = {"predicate": PREDICATE, "set": SET}

DIALECT = Terms.Declared(
    "Predicates", _KINDS, domain_of=BasicDomains.of, extends=E.DIALECT,
    builders={kind.KIND: type(f"{kind.__name__}Builder", (builder,), {"_data": kind}) if builder is Terms.Builder
              else builder for kind, builder in zip(_KINDS, _BUILDERS)},
    schema_names={kind.KIND: _NAMES.get(kind.KIND, f"Patterns.Of{kind.KIND.capitalize()}") for kind in _KINDS},
)
"""The predicate algebra: Basic's kinds, and the kinds above."""

for _kind in _KINDS:
    _kind.Builder = DIALECT.builders[_kind.KIND]  # type: ignore[attr-defined]


def Exists(spec: Any) -> OfExists:
    """Whether some binding of the symbols satisfies the conditions: `Exists(lambda q: q.symbols({...}).requires(...))`."""
    return Terms.resolve(spec, OfExists, _ExistsBuilder, "an exists")


def Forall(spec: Any) -> OfForall:
    """Whether every binding of the symbols satisfies the conditions: `Forall(lambda q: q.symbols({...}).requires(...))`."""
    return Terms.resolve(spec, OfForall, _ForallBuilder, "a forall")


def Contains(adjacency: Any, condition: Callable[[Any], Any]) -> E.OfQuantifier.Data:
    """Whether one of an object's entries in an adjacency, written `c.phones`, satisfies `condition`, a function of one
    entry read as `Python.Text.FromFunction` reads it: Basic's `any(e in entries(c, 'phones'), ...)`."""
    collection = E.OfAny.resolve(adjacency)
    if not (isinstance(collection, E.OfOperation.Data) and collection.name == "get" and len(collection.arguments) == 2
            and isinstance(collection.arguments[1], E.OfLiteral.Data) and type(collection.arguments[1].value) is str):
        raise TypeError("Contains expects an object's adjacency, such as c.phones")
    code = getattr(condition, "__code__", None)
    if code is None or code.co_argcount != 1:
        raise TypeError("Contains expects a function of one entry")
    entries = E.operation("entries", collection.arguments[0], collection.arguments[1].value)
    return E.quantifier("any", code.co_varnames[0], entries, Text.FromFunction(condition)).data


# --- Evaluation ---


def _in(drawn: Any, value: Any, parameter: Callable[[str], Any]) -> bool:
    """Whether `value` is in a distribution's support, its parameters given by `parameter(name)`."""
    if isinstance(drawn, Distributions.Normal):
        return type(value) is int if drawn.rounded else type(value) in (int, float) and math.isfinite(value)
    if isinstance(drawn, Distributions.Uniform):
        low, high = parameter("low"), parameter("high")
        if type(low) is int and type(high) is int:
            return type(value) is int and low <= value <= high
        return type(value) in (int, float) and low <= value < high
    if isinstance(drawn, (Distributions.Poisson, Distributions.Geometric)):
        return type(value) is int and value >= 0
    return any(type(value) is type(option.value.value) and value == option.value.value for option in drawn.options
               if isinstance(option.value, E.OfLiteral.Data))


class _Interpreter(F.Interpreter):
    """Basic's interpreter, which also evaluates the distributions' binding forms itself."""

    def evaluate(self, expression: Any, scope: Any, active: set[int]) -> Any:
        if not isinstance(expression, Distributions.DRAWN):
            return super().evaluate(expression, scope, active)
        witness = Distributions.witness(expression)
        value = None if witness is None else self.evaluate(witness, scope, active)
        if value is None:
            return None
        if not _in(expression, value, lambda name: self.evaluate(getattr(expression, name), scope, active)):
            return False
        return self.evaluate(expression.body, scope.bind(expression.symbol, value), active)


class Evaluator:
    """Evaluates predicates over `store`: Basic's rules, with extents from the store, applications of predicates,
    choices (whether the number of arms that hold satisfies their count) and distributions (whether the value their
    body equates their symbol with is in their support, and the body holds with it). Extents are read once per
    evaluator, so an evaluator sees the store as it was when first asked."""

    def __init__(self, store: Stores.Store):
        self.store = store
        self._extents: dict[str, tuple[Any, ...]] = {}
        self.observe: dict[int, list[bool | None]] | None = None  # when given, how each choices' arms held, by id
        self.interpreter = _Interpreter(DIALECT, {
            "operation": Basic.OPERATIONS, "quantifier": Basic.QUANTIFIERS,
            "extent": self._extent, "forall": Basic.QUANTIFIERS["all"], "exists": Basic.QUANTIFIERS["any"],
            "apply": self._apply, "choices": self._choices,
        }, typed=BasicDomains.Value)

    def __call__(self, expression: Any, variables: Mapping[str, Any] | None = None) -> Any:
        return self.interpreter(DIALECT.resolve(expression), variables)

    def extent(self, name: str) -> tuple[Any, ...]:
        """The schema's extent, read once."""
        if name not in self._extents:
            self.store.schema(name)  # raises for an unknown name or a relation
            self._extents[name] = tuple(self.store.extent(name))
        return self._extents[name]

    def _extent(self, thunks: Any, node: OfExtent, scope: Any) -> tuple[Any, ...]:
        return self.extent(node.schema)  # type: ignore[arg-type]

    def _apply(self, thunks: Any, node: OfApply, scope: Any) -> Any:
        predicate = node.predicate
        values = [thunk() for thunk in thunks[1:]]
        return self.interpreter(predicate.requires, dict(zip(predicate.binds(), values)))

    def held(self, node: Distributions.Choices, scope: Any) -> list[bool | None]:
        """Whether each of a choices' arms holds, in order."""
        return [_truth(self.interpreter.evaluate(arm.condition, scope, set())) for arm in node.arms]

    def _choices(self, thunks: Any, node: Distributions.Choices, scope: Any) -> bool | None:
        held = self.held(node, scope)
        if self.observe is not None:
            self.observe[id(node)] = held
        count, least = node.count, held.count(True)
        found = {_truth(self.interpreter.evaluate(count.condition, scope.bind(count.name, n), set()))
                 for n in range(least, least + held.count(None) + 1)}  # every count the unknown arms allow
        return found.pop() if len(found) == 1 else None

    def weigh(self, constraint: Any, scope: Mapping[str, Any]) -> float:
        """What a match weighs under a constraint: 0.0 unless the constraint holds; then the product, over the choices on its
        conjuncts, of the weight of the arm the match falls under (the first that holds, with `decreasing`) or the sum
        of those of the arms that hold, each times what the match weighs under the arm's condition."""
        variables = Symbolics.Variables(dict(scope))
        return self._weigh(DIALECT.resolve(constraint), variables) if self.interpreter.evaluate(
            DIALECT.resolve(constraint), variables, set()) is True else 0.0

    def _weigh(self, node: Any, scope: Any) -> float:
        if isinstance(node, E.OfOperation.Data) and node.name == "and" and len(node.arguments) == 2:
            return self._weigh(node.arguments[0], scope) * self._weigh(node.arguments[1], scope)
        if isinstance(node, OfApply):
            values = [self.interpreter.evaluate(argument, scope, set()) for argument in node.arguments]
            return self._weigh(node.predicate.requires, Symbolics.Variables(dict(zip(node.predicate.binds(), values))))
        if isinstance(node, Distributions.Choices):
            weights = [arm.weight * self._weigh(arm.condition, scope)
                       for arm, holds in zip(node.arms, self.held(node, scope)) if holds is True]
            return (weights[0] if weights else 0.0) if node.decreasing else sum(weights)
        return 1.0


def _truth(value: Any) -> bool | None:
    if value is not None and type(value) is not bool:
        raise TypeError(f"a constraint must be a bool, got {type(value).__name__}")
    return value


def holds(evaluate: Evaluator, constraint: Any, scope: Mapping[str, Any]) -> bool | None:
    """The constraint's value with `scope` bound: `True`, `False` or unknown (`None`); a constraint that gives anything else
    raises."""
    result = evaluate.interpreter(constraint, scope)
    if result is not None and type(result) is not bool:
        raise TypeError(f"a constraint must be a bool, got {type(result).__name__}")
    return result
