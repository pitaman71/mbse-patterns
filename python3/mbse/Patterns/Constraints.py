"""Constraints: predicates over a schema's objects, kept as data beside the schemas.

A predicate is a named Basic rule over symbols, each bound to an object of a schema; it applies to a *match*, a binding
of every symbol to an object of its schema. It is built as schemas are, by a fluent builder finalized by `create()`,
`clone()` or `update()`:

    IsAnAdult = (
        Constraints.OfPredicate.Builder()
        .name("IsAnAdult")
        .description("18 or older")
        .symbols({"the": Contact})
        .rule(Python.Text.FromFunction(lambda the: the.age >= 18))
        .create()
    )

`.rule(spec)` takes any Basic `Spec`: data, a writer, or what `Python.Text.FromFunction` reads from a function. A set,
`OfSet`, gathers predicates in order: `OfSet.Builder().predicates(IsAnAdult, lambda p: p.name(...)...)`. Nothing
validates until asked: `validate()` reports a missing name or rule, no symbols, a symbol whose schema is not a named
reference object schema, the rule's problems as a core Basic rule whose free names are the symbols, and, in a set, two
predicates with one name.

Predicates and sets are mbse-schemas reference objects with meta-schemas (`Patterns.Predicate`, `Patterns.Set`), so a
set is stored and sent like any data. A symbol's schema is written as a property's type is: by its name, or inline; a
predicate is its rule's parent through Basic's relation `Expressions.Arguments`, and a set holds its predicates through
`Patterns.Members`, by index. Writing needs no store; reading resolves the symbols' schemas by name, so it goes through
`OfStore(store)`, a store of the predicates' bound classes and Basic's that resolves names in `store`; `Builders` is
one that resolves none, which writes any predicate and reads those whose symbols' schemas are inline. `register(store)`
registers the meta-schemas, and Basic's, in another store.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from mbse.Expressions import Expressions
from mbse.Expressions.Framework import Terms
from mbse.Schemas.Framework import Bindings, Modules, Schemas, Stores, Visitors

__all__ = ["OfPredicate", "OfSet", "Members", "OfStore", "Builders", "register", "check", "PREDICATE", "SET", "MEMBERS"]

PREDICATE, SET, MEMBERS = "Patterns.Predicate", "Patterns.Set", "Patterns.Members"


def _text(name: str) -> Any:
    return lambda p: p.name(name).of(lambda t: t.as_native(str))


Members = (
    Schemas.OfRelation.Builder().name(MEMBERS).links("set", "predicate").properties(
        lambda p: p.name("index").of(lambda t: t.as_native(int))).create()
)
"""The relation of a set to its predicates, each at its `index` in the set."""


class _Builder:
    """Shared builder mechanics, as mbse-schemas' builders have them."""

    _data: type

    def __init__(self, instance: Any = None):
        self._source = instance
        self._fields: dict[str, Any] = {} if instance is None else {
            name: copy.copy(value) if isinstance(value, dict) else value for name, value in vars(instance).items()}

    def create(self) -> Any:
        """A new instance. Only valid without a source instance."""
        if self._source is not None:
            raise ValueError("create() is only valid without a source instance; use clone() or update()")
        return self._data(**self._fields)

    def clone(self) -> Any:
        """A new instance, leaving the source instance untouched. Only valid with a source instance."""
        if self._source is None:
            raise ValueError("clone() is only valid with a source instance")
        return self._data(**self._fields)

    def update(self) -> Any:
        """Writes the builder's state into the source instance and returns it. Only valid with a source instance."""
        if self._source is None:
            raise ValueError("update() is only valid with a source instance")
        vars(self._source).update(self._fields)
        return self._source


# --- Predicates ---


@dataclass(eq=False)
class _PredicateData:
    """A named rule over symbols, each bound to an object of its schema in a match."""

    name: str | None = None
    description: str | None = None
    symbols: dict[str, Any] = field(default_factory=dict)  # symbol -> schema
    rule: Any = None  # a Basic expression

    def validate(self) -> list[str]:
        label = f"predicate {self.name!r}"
        problems = [f"{label}: a predicate needs a {what}" for what, value in (("name", self.name), ("rule", self.rule))
                    if value is None]
        if not self.symbols:
            problems.append(f"{label}: a predicate needs at least one symbol")
        for symbol, schema in self.symbols.items():
            if not (isinstance(schema, Schemas.OfObject.Data) and schema.ref and schema.name is not None):
                problems.append(f"{label}: symbol {symbol!r} needs a named reference object schema")
        rule = [] if self.rule is None else self.rule.validate(bound=tuple(self.symbols), core=True)
        return problems + [f"{label}: {problem}" for problem in rule]

    def identity(self) -> Any:
        return id(self)

    def schema_name(self) -> str:
        return PREDICATE

    def owner(self) -> None:
        return None

    def accept(self, visitor: Visitors.OfObject) -> None:
        Bindings.accept(Builders.predicate, self, visitor)


class _PredicateBuilder(_Builder):
    _data = _PredicateData

    def name(self, name: str) -> _PredicateBuilder:
        self._fields["name"] = name
        return self

    def description(self, text: str) -> _PredicateBuilder:
        self._fields["description"] = text
        return self

    def symbols(self, symbols: Mapping[str, Any]) -> _PredicateBuilder:
        """Symbols by name, each with the schema of the objects it binds, in order; added to those already given."""
        self._fields["symbols"] = {**self._fields.get("symbols", {}), **symbols}
        return self

    def rule(self, spec: Any) -> _PredicateBuilder:
        """The rule, a Basic `Spec` whose free names are the symbols."""
        self._fields["rule"] = Expressions.OfAny.resolve(spec)
        return self


class OfPredicate:
    """A predicate: `Data`, its `Builder` and its meta-schema `Schema`."""

    Data = _PredicateData
    Builder = _PredicateBuilder
    Spec = _PredicateData | Callable[[_PredicateBuilder], _PredicateBuilder]
    Schema = Schemas.OfObject.Builder().name(PREDICATE).ref().properties(
        _text("name"), _text("description"),
        lambda p: p.name("symbols").of(lambda t: t.as_indexed(lambda i: i.of(Schemas.OfProperty.Schema)))).relations(
        lambda r: r.name("rule").of(Terms.Arguments).me("parent"),
        lambda r: r.name("sets").of(Members).me("predicate")).create()

    @staticmethod
    def resolve(spec: OfPredicate.Spec) -> _PredicateData:
        if isinstance(spec, _PredicateData):
            return spec
        if not callable(spec):
            raise TypeError(f"expected a predicate or a callable taking its builder, got {spec!r}")
        return spec(_PredicateBuilder()).create()


# --- Sets ---


@dataclass(eq=False)
class _SetData:
    """Predicates, in order."""

    predicates: tuple[_PredicateData, ...] = ()

    def __post_init__(self) -> None:
        self.predicates = tuple(self.predicates)

    def validate(self) -> list[str]:
        """Every predicate's problems, and each name two predicates share."""
        problems: list[str] = []
        seen: set[Any] = set()
        for predicate in self.predicates:
            problems += predicate.validate()
            if predicate.name in seen:
                problems.append(f"predicate {predicate.name!r}: defined twice")
            seen.add(predicate.name)
        return problems

    def identity(self) -> Any:
        return id(self)

    def schema_name(self) -> str:
        return SET

    def owner(self) -> None:
        return None

    def accept(self, visitor: Visitors.OfObject) -> None:
        Bindings.accept(_SET, self, visitor)


class _SetBuilder(_Builder):
    _data = _SetData

    def predicates(self, *specs: OfPredicate.Spec) -> _SetBuilder:
        """Predicates, each a `Data` or a callable taking a predicate builder, added in order."""
        self._fields["predicates"] = (*self._fields.get("predicates", ()), *map(OfPredicate.resolve, specs))
        return self


class OfSet:
    """A set of predicates: `Data`, its `Builder` and its meta-schema `Schema`."""

    Data = _SetData
    Builder = _SetBuilder
    Schema = Schemas.OfObject.Builder().name(SET).ref().relations(
        lambda r: r.name("predicates").of(Members).me("set")).create()


# --- Reading and writing ---


def _linked(entry: Bindings.Entry, link: str, kind: Any, what: str) -> Any:
    target = entry.links.get(link)
    if target is None:
        raise ValueError(f"link {link!r} is not set")
    if not isinstance(target, kind):
        raise TypeError(f"{what} must be {'a Basic expression' if what == 'a rule' else 'a predicate'}")
    return target


def _read_predicate(predicate: _PredicateData) -> Bindings.State:
    values: dict[str, Any] = {name: getattr(predicate, name) for name in ("name", "description")
                              if getattr(predicate, name) is not None}
    if predicate.symbols:
        values["symbols"] = [{"name": symbol, "type": Modules.reference(schema)}
                             for symbol, schema in predicate.symbols.items()]
    rule = [] if predicate.rule is None else [Bindings.Entry({"argument": predicate.rule}, {"index": 0})]
    return Bindings.State(values, {"rule": rule})


def _read_set(predicates: _SetData) -> Bindings.State:
    return Bindings.State({}, {"predicates": [Bindings.Entry({"predicate": p}, {"index": i})
                                              for i, p in enumerate(predicates.predicates)]})


def _make_predicate(store: Stores.Store, state: Bindings.State) -> _PredicateData:
    rules = state.entries.get("rule", [])  # none yet while a snapshot is read: its entries come after its objects
    if len(rules) > 1:
        raise ValueError(f"a predicate has one rule, got {len(rules)}")
    rule = _linked(rules[0], "argument", Expressions.DIALECT.classes, "a rule") if rules else None
    symbols = {symbol["name"]: Modules.resolve(store, symbol["type"]) for symbol in state.values.get("symbols", [])}
    return _PredicateData(state.values.get("name"), state.values.get("description"), symbols, rule)


def _make_set(state: Bindings.State) -> _SetData:
    entries = state.entries.get("predicates", [])
    last = len(entries)
    ordered = sorted(entries, key=lambda e: last if e.properties.get("index") is None else e.properties["index"])
    return _SetData(tuple(_linked(e, "predicate", _PredicateData, "a member") for e in ordered))


def _assign(make: Callable[[Bindings.State], Any]) -> Callable[[Any, Bindings.State], Any]:
    def assign(instance: Any, state: Bindings.State) -> Any:
        vars(instance).update(vars(make(state)))
        return instance
    return assign


_SET = Bindings.Binding(OfSet.Schema, _read_set, _make_set, _assign(_make_set))


def _basic() -> list[tuple[Schemas.OfObject.Data, Any]]:
    """Basic's kinds, as `Bindings.OfStore` takes them."""
    dialect = Expressions.DIALECT
    return [(kind.Schema, dialect.builders[kind.KIND]) for kind in dialect.classes]  # type: ignore[attr-defined]


class OfStore(Bindings.OfStore):
    """A store of predicates, sets and Basic's expressions as their bound classes, reading the symbols' schemas by name
    in `store`: what snapshots of predicates are read into, and written from."""

    def __init__(self, store: Stores.Store):
        make = lambda state: _make_predicate(store, state)  # noqa: E731
        self.predicate = Bindings.Binding(OfPredicate.Schema, _read_predicate, make, _assign(make), implied=["sets"])
        super().__init__(
            [(OfSet.Schema, lambda instance=None: Bindings.Builder(_SET, instance)),
             (OfPredicate.Schema, lambda instance=None: Bindings.Builder(self.predicate, instance)), *_basic()],
            [Terms.Arguments, Members])


Builders = OfStore(Stores.Catalog())
"""A store of the predicates' bound classes that resolves no names: it writes any predicate, and reads those whose
symbols' schemas are inline."""


def register(store: Any) -> Any:
    """Registers the meta-schemas of predicates and sets, and Basic's, in `store` (e.g. a `Proxies.OfStore`), skipping
    those it already holds. Returns the store."""
    Expressions.DIALECT.register(store)
    for schema in (OfPredicate.Schema, OfSet.Schema, Members):
        if schema.name not in store.names():
            store.register(schema)
    return store


def check(predicates: Iterable[OfPredicate.Spec] | _SetData) -> _SetData:
    """A set of `predicates`, raising `ValueError` with every problem `validate()` reports."""
    result = predicates if isinstance(predicates, _SetData) else _SetBuilder().predicates(*predicates).create()
    problems = result.validate()
    if problems:
        raise ValueError("; ".join(problems))
    return result
