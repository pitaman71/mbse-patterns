"""Constraints: sets of predicates, kept as data beside the schemas.

A set, `OfSet`, gathers predicates (see `Predicates`) in order, and is built as they are, by a fluent builder:
`OfSet.Builder().predicates(HasAPhone, lambda p: p.name(...)...)`. Nothing validates until asked: `validate()` reports
each predicate's problems (a missing name or rule, a symbol whose schema is not a named reference object schema, the
rule's problems as a rule of the algebra whose free names are the symbols) and two predicates with one name; `check`
raises with them.

Sets are mbse-schemas reference objects with a meta-schema (`Patterns.Set`), so a set is stored and sent like any data:
it holds its predicates through `Patterns.Members`, by index. Writing needs no store; reading resolves the symbols'
schemas by name, so it goes through `OfStore(store)`, a store of the predicates' bound classes and the algebra's that
resolves names in `store`; `Builders` is one that resolves none, which writes any predicate and reads those whose
symbols' schemas are inline. `register(store)` registers the meta-schemas, and the algebra's, in another store.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from mbse.Expressions.Framework import Terms
from mbse.Schemas.Framework import Bindings, Schemas, Stores, Visitors

from . import Predicates

__all__ = ["OfSet", "OfStore", "Builders", "register", "check", "SET"]

SET = "Patterns.Set"


class _Builder:
    """Shared builder mechanics, as mbse-schemas' builders have them."""

    _data: type

    def __init__(self, instance: Any = None):
        self._source = instance
        self._fields: dict[str, Any] = {} if instance is None else dict(vars(instance))

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


# --- Sets ---


@dataclass(eq=False)
class _SetData:
    """Predicates, in order."""

    predicates: tuple[Predicates.OfPredicate.Data, ...] = ()

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

    def predicates(self, *specs: Predicates.OfPredicate.Spec) -> _SetBuilder:
        """Predicates, each a `Data` or a callable taking a predicate builder, added in order."""
        self._fields["predicates"] = (*self._fields.get("predicates", ()), *map(Predicates.OfPredicate.resolve, specs))
        return self


class OfSet:
    """A set of predicates: `Data`, its `Builder` and its meta-schema `Schema`."""

    Data = _SetData
    Builder = _SetBuilder
    Schema = Schemas.OfObject.Builder().name(SET).ref().relations(
        lambda r: r.name("predicates").of(Predicates.Members).me("set")).create()


# --- Reading and writing ---


def _read_set(predicates: _SetData) -> Bindings.State:
    return Bindings.State({}, {"predicates": [Bindings.Entry({"predicate": p}, {"index": i})
                                              for i, p in enumerate(predicates.predicates)]})


def _make_set(state: Bindings.State) -> _SetData:
    entries = state.entries.get("predicates", [])
    last = len(entries)
    ordered = sorted(entries, key=lambda e: last if e.properties.get("index") is None else e.properties["index"])
    return _SetData(tuple(Predicates.target(e, "predicate", Predicates.OfPredicate.Data, "a member") for e in ordered))


def _assign(make: Callable[[Bindings.State], Any]) -> Callable[[Any, Bindings.State], Any]:
    def assign(instance: Any, state: Bindings.State) -> Any:
        vars(instance).update(vars(make(state)))
        return instance
    return assign


_SET = Bindings.Binding(OfSet.Schema, _read_set, _make_set, _assign(_make_set))


def _basic() -> list[tuple[Schemas.OfObject.Data, Any]]:
    """The predicate algebra's kinds, Basic's included, as `Bindings.OfStore` takes them."""
    dialect = Predicates.DIALECT
    return [(kind.Schema, dialect.builders[kind.KIND]) for kind in dialect.classes]  # type: ignore[attr-defined]


class OfStore(Bindings.OfStore):
    """A store of predicates, sets and the algebra's expressions as their bound classes, reading the symbols' schemas by name
    in `store`: what snapshots of predicates are read into, and written from."""

    def __init__(self, store: Stores.Store):
        self.predicate = Predicates.binding(store)
        super().__init__(
            [(OfSet.Schema, lambda instance=None: Bindings.Builder(_SET, instance)),
             (Predicates.OfPredicate.Schema, lambda instance=None: Bindings.Builder(self.predicate, instance)), *_basic()],
            [Terms.Arguments, Predicates.Members])


Builders = OfStore(Stores.Catalog())
"""A store of the predicates' bound classes that resolves no names: it writes any predicate, and reads those whose
symbols' schemas are inline."""


def register(store: Any) -> Any:
    """Registers the meta-schemas of predicates and sets, and the algebra's (Basic's included), in `store` (e.g. a
    `Proxies.OfStore`), skipping those it already holds. Returns the store."""
    Predicates.DIALECT.register(store)
    for schema in (Predicates.OfPredicate.Schema, OfSet.Schema, Predicates.Members):
        if schema.name not in store.names():
            store.register(schema)
    return store


def check(predicates: Iterable[Predicates.OfPredicate.Spec] | _SetData) -> _SetData:
    """A set of `predicates`, raising `ValueError` with every problem `validate()` reports."""
    result = predicates if isinstance(predicates, _SetData) else _SetBuilder().predicates(*predicates).create()
    problems = result.validate()
    if problems:
        raise ValueError("; ".join(problems))
    return result
