"""Queries: a predicate as a query over a store's objects, whose matches stream lazily.

`QueryableStore` is the protocol: an mbse-schemas store (`Stores.Store`) that also answers
`select(predicate, variables=None, unknown=False)`, an iterator over the predicate's matches among the store's data for
which its constraint holds. A match maps each symbol to an object of the symbol's schema, from the schema's extent (what
the store's singletons reach: objects the program built but never linked to the store's data are not found); a predicate
without symbols has one match, empty, when it holds. `variables`
binds the constraint's other names; `unknown` also yields the matches for which the constraint is unknown. The predicate
is checked when `select` is called, which raises for one that cannot be a query; the extents are read only as matches
are asked for.

The matches are the cross product of the symbols' extents, filtered by the constraint; how they are found is the
implementation's to choose from the constraint's shape. `Scan(store)` makes any store queryable, in memory, delegating
every `Stores.Store` method to it, and plans each query:

- The constraint's top-level conjuncts (`and`) are tested as soon as the symbols they read are bound, so a match
  that fails one is never extended; those that read no symbol, only variables, are tested once, first.
- A conjunct `any(e in entries(a, 'adjacency'), e.link == b)`, as `Predicates.Contains(a.adjacency, lambda e: e.link
  == b)` writes it, relates two symbols through a relation: `b`'s candidates are then the targets of `a`'s entries, not `b`'s whole extent. When one of the
  relation's `unique` clauses makes `a`'s end determine the entry, there is at most one, and the hop is taken first.
- A symbol no hop reaches is scanned. Symbols that a hop from another could reach are scanned last, so that the hop is
  taken instead; otherwise symbols are scanned in their declared order.

`Scan.explain(predicate, variables)` describes the plan, one line per symbol. A store that can answer natively (a
database) implements `select` itself. `select(store, ...)` asks a queryable store, and scans any other.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any, Protocol

from mbse.Expressions import Expressions as E
from mbse.Expressions.Framework import Symbolics
from mbse.Schemas.Framework import Schemas, Stores, Validators as SchemaValidators, Visitors

from . import Predicates

__all__ = ["QueryableStore", "Scan", "select"]

Match = dict[str, Visitors.Visitable]


class QueryableStore(Stores.Store, Protocol):
    """A store that answers queries."""

    def select(self, predicate: Any, variables: Mapping[str, Any] | None = None, unknown: bool = False
               ) -> Iterator[Match]:
        """The predicate's matches for which its constraint holds (or is unknown, with `unknown`), as they are read."""
        ...


def _conjuncts(constraint: Any) -> list[Any]:
    """The constraint's top-level conjuncts: the arguments of nested `and`s, or the constraint itself."""
    if isinstance(constraint, E.OfOperation.Data) and constraint.name == "and" and len(constraint.arguments) == 2:
        return [*_conjuncts(constraint.arguments[0]), *_conjuncts(constraint.arguments[1])]
    return [constraint]


def _variable(node: Any, names: Any) -> str | None:
    return node.name if isinstance(node, E.OfVariable.Data) and node.name in names else None


def _text(node: Any) -> str | None:
    return node.value if isinstance(node, E.OfLiteral.Data) and type(node.value) is str else None


class _Hop:
    """`target`'s candidates are the targets, through `link`, of `source`'s entries in `adjacency`."""

    def __init__(self, source: str, adjacency: str, link: str, target: str, functional: bool):
        self.source, self.adjacency, self.link, self.target, self.functional = source, adjacency, link, target, functional


def _functional(schemas: Mapping[str, Schemas.OfObject.Data], source: str, adjacency: str | None, link: str) -> bool | None:
    """Whether a hop from `source` through `adjacency` to its entries' `link` is functional; None if it is not a hop."""
    declared = schemas[source].adjacencies.get(adjacency or "")
    if declared is None or declared.relation is None:
        return None
    relation = declared.relation
    if link == declared.me or link not in relation.links:
        return None
    fields = {*relation.links, *relation.properties}
    return any(fields - unique <= {declared.me} for unique in relation.uniques)


def _hop(conjunct: Any, schemas: Mapping[str, Schemas.OfObject.Data]) -> _Hop | None:
    """The hop a conjunct `any(e in entries(a, 'adjacency'), e.link == b)` makes from `a` to `b`, if it is one."""
    if not (isinstance(conjunct, E.OfQuantifier.Data) and conjunct.quantifier == "any"):
        return None
    collection, body, item = conjunct.collection, conjunct.body, conjunct.name
    if not (isinstance(collection, E.OfOperation.Data) and collection.name == "entries" and len(collection.arguments) == 2
            and isinstance(body, E.OfOperation.Data) and body.name == "eq" and len(body.arguments) == 2):
        return None
    source, adjacency = _variable(collection.arguments[0], schemas), _text(collection.arguments[1])
    for get, other in (body.arguments, reversed(body.arguments)):
        target = _variable(other, schemas)
        if (isinstance(get, E.OfOperation.Data) and get.name == "get" and len(get.arguments) == 2
                and _variable(get.arguments[0], {item}) is not None and source is not None and target is not None
                and target not in (source, item)):
            link = _text(get.arguments[1])
            functional = None if link is None else _functional(schemas, source, adjacency, link)
            return None if functional is None else _Hop(source, adjacency, link, target, functional)  # type: ignore[arg-type]
    return None


class _Plan:
    """How a query finds its matches: an order of the symbols, each scanned or reached by a hop, and the conjuncts
    tested once their symbols are bound."""

    def __init__(self, store: Stores.Store, predicate: Any, variables: Mapping[str, Any]):
        symbols = dict(predicate.symbols)
        for symbol, schema in symbols.items():
            if not (isinstance(schema, Schemas.OfObject.Data) and schema.name is not None):
                raise ValueError(f"symbol {symbol!r} needs a named object schema")
            store.schema(schema.name)  # raises for a schema the store does not hold
        for name in variables:
            if name in symbols:
                raise ValueError(f"{name!r} is a symbol; it is not a variable")
        constraint = Predicates.DIALECT.resolve(predicate.requires)
        problems = Predicates.DIALECT.validate(constraint, bound=(*symbols, *variables), core=True)
        if problems:
            raise ValueError(f"the predicate cannot be a query: {'; '.join(problems)}")
        self.store, self.symbols, self.variables, self.constraint = store, symbols, dict(variables), constraint
        conjuncts = [(c, Symbolics.free(c) & set(symbols)) for c in _conjuncts(self.constraint)]
        hops = [hop for hop in (_hop(c, symbols) for c, _ in conjuncts) if hop is not None]
        self.order: list[tuple[str, _Hop | None]] = []
        bound: set[str] = set()
        while len(bound) < len(symbols):
            reachable = [h for h in hops if h.source in bound and h.target not in bound]
            step = (min(reachable, key=lambda h: (not h.functional, list(symbols).index(h.target))) if reachable
                    else None)
            if step is not None:
                target = step.target
            else:  # scan first what no hop from a symbol still to bind could reach instead
                remaining = [s for s in symbols if s not in bound]
                reached = {h.target for h in hops if h.source in remaining}
                target = next((s for s in remaining if s not in reached), remaining[0])
            self.order.append((target, step))
            bound.add(target)
        self.first = [c for c, free in conjuncts if not free]
        self.tests = [[c for c, free in conjuncts if free and max(self._depth(s) for s in free) == depth]
                      for depth in range(len(self.order))]

    def _depth(self, symbol: str) -> int:
        return [s for s, _ in self.order].index(symbol)

    def explain(self) -> list[str]:
        lines = [f"first {len(self.first)} {'test' if len(self.first) == 1 else 'tests'}"] if self.first else []
        for (symbol, hop), tests in zip(self.order, self.tests):
            how = (f"scan {self.symbols[symbol].name}" if hop is None else
                   f"{hop.source}.{hop.adjacency} to {hop.link}, {'at most one' if hop.functional else 'any number'}")
            then = f", then {len(tests)} {'test' if len(tests) == 1 else 'tests'}" if tests else ""
            lines.append(f"{symbol}: {how}{then}")
        return lines

    def matches(self, unknown: bool) -> Iterator[Match]:
        evaluate = Predicates.Evaluator(self.store)  # reads each extent once, when first asked for
        scope = dict(self.variables)
        if any(Predicates.holds(evaluate, test, scope) is False for test in self.first):
            return
        yield from self._extend(0, scope, evaluate, unknown)

    def _candidates(self, symbol: str, hop: _Hop | None, scope: dict[str, Any], evaluate: Predicates.Evaluator
                    ) -> list[Any]:
        name = self.symbols[symbol].name
        if hop is None:
            return list(evaluate.extent(name))
        found: dict[Any, Any] = {}
        for entry in SchemaValidators.entries_of(scope[hop.source]).get(hop.adjacency, []):
            target = entry.targets.get(hop.link)
            if target is not None and target.schema_name() == name:
                found.setdefault(target.identity(), target)
        return list(found.values())

    def _extend(self, depth: int, scope: dict[str, Any], evaluate: Predicates.Evaluator, unknown: bool
                ) -> Iterator[Match]:
        if depth == len(self.order):
            result = Predicates.holds(evaluate, self.constraint, scope)
            if result or (unknown and result is None):
                yield {symbol: scope[symbol] for symbol in self.symbols}
            return
        symbol, hop = self.order[depth]
        for candidate in self._candidates(symbol, hop, scope, evaluate):
            inner = {**scope, symbol: candidate}
            if all(Predicates.holds(evaluate, test, inner) is not False for test in self.tests[depth]):
                yield from self._extend(depth + 1, inner, evaluate, unknown)


class Scan:
    """A queryable store over any store, answering queries by the plan the predicate's constraint allows."""

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

    def select(self, predicate: Any, variables: Mapping[str, Any] | None = None, unknown: bool = False
               ) -> Iterator[Match]:
        return _Plan(self.store, predicate, variables or {}).matches(unknown)

    def explain(self, predicate: Any, variables: Mapping[str, Any] | None = None) -> list[str]:
        """The plan of a query, one line per symbol: how its candidates are found, and the tests then made."""
        return _Plan(self.store, predicate, variables or {}).explain()


def select(store: Stores.Store, predicate: Any, variables: Mapping[str, Any] | None = None,
           unknown: bool = False) -> Iterator[Match]:
    """`store.select(...)` for a queryable store, and a scan of any other."""
    queryable = store if callable(getattr(store, "select", None)) else Scan(store)
    return queryable.select(predicate, variables, unknown)  # type: ignore[union-attr]
