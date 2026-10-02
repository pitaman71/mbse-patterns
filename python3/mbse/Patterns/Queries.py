"""Queries: a rule as a query over a store's objects, whose matches stream lazily.

`QueryableStore` is the protocol: an mbse-schemas store (`Stores.Store`) that also answers
`select(name, rule, variables=None, unknown=False)`, an iterator over the store's objects of the schema `name` (its
extent) for which `rule`, a Basic rule about `this`, holds. `variables` binds the rule's other names; `unknown` also
yields the objects for which the rule is unknown. The rule is checked when `select` is called, which raises for one
that cannot be right; the extent is read at the first match asked for, and each object only as the iterator reaches it.
A store's extents are its data, what its singletons reach (see mbse-schemas' Stores), so a query never sees objects
the program built but did not link to that data.

`Scan(store)` makes any store queryable, in memory: it is the store, for every `Stores.Store` method, and answers a
query by streaming the extent through the rule, after evaluating what `variables` alone determine once (`Partials`). It
is the queryable form of `Proxies.OfStore` and `Bindings.OfStore`; a store that can answer natively (a database)
implements `select` itself. `select(store, ...)` asks a queryable store, and scans any other.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any, Protocol

from mbse.Expressions import Evaluators, Expressions, Partials
from mbse.Schemas.Framework import Schemas, Stores, Visitors

__all__ = ["QueryableStore", "Scan", "select"]


class QueryableStore(Stores.Store, Protocol):
    """A store that answers queries."""

    def select(self, name: str, rule: Any, variables: Mapping[str, Any] | None = None, unknown: bool = False
               ) -> Iterator[Visitors.Visitable]:
        """The objects of the schema `name` for which `rule` holds (or is unknown, with `unknown`), as they are read."""
        ...


def _checked(store: Stores.Store, name: str, rule: Any, variables: Mapping[str, Any]) -> Any:
    store.schema(name)  # raises for an unknown name or a relation
    if "this" in variables:
        raise ValueError("'this' is bound to each object; it is not a variable")
    rule = Expressions.OfAny.resolve(rule)
    problems = rule.validate(bound=("this", *variables), core=True)
    if problems:
        raise ValueError(f"the rule cannot be a query: {'; '.join(problems)}")
    return Partials.OfAny(rule, variables)


def _matches(objects: Callable[[], Iterable[Visitors.Visitable]], rule: Any, variables: Mapping[str, Any],
             unknown: bool) -> Iterator[Visitors.Visitable]:
    for value in objects():  # the extent is read at the first match asked for, not when the query is made
        result = Evaluators.OfAny(rule, {**variables, "this": value})
        if result is not None and type(result) is not bool:
            raise TypeError("a query's rule must give a bool")
        if result or (unknown and result is None):
            yield value


class Scan:
    """A queryable store over any store, answering queries by scanning its extents."""

    def __init__(self, store: Stores.Store):
        self.store = store

    def schema(self, name: str) -> Schemas.OfObject.Data:
        return self.store.schema(name)

    def registered(self, name: str) -> Schemas.OfObject.Data | Schemas.OfRelation.Data:
        return self.store.registered(name)

    def name_of(self, schema: Any) -> str:
        return self.store.name_of(schema)

    def names(self) -> Any:
        return self.store.names()

    def builder(self, name: str, instance: Any = None) -> Any:
        return self.store.builder(name, instance)

    def member(self, instance: Any, name: str) -> Any:
        return self.store.member(instance, name)

    def singleton(self, name: str) -> Visitors.Visitable:
        return self.store.singleton(name)

    def extent(self, name: str) -> Any:
        return self.store.extent(name)

    def select(self, name: str, rule: Any, variables: Mapping[str, Any] | None = None, unknown: bool = False
               ) -> Iterator[Visitors.Visitable]:
        variables = dict(variables or {})
        residual = _checked(self.store, name, rule, variables)
        return _matches(lambda: self.store.extent(name), residual, variables, unknown)


def select(store: Stores.Store, name: str, rule: Any, variables: Mapping[str, Any] | None = None,
           unknown: bool = False) -> Iterator[Visitors.Visitable]:
    """`store.select(...)` for a queryable store, and a scan of any other."""
    queryable = store if callable(getattr(store, "select", None)) else Scan(store)
    return queryable.select(name, rule, variables, unknown)  # type: ignore[union-attr]
