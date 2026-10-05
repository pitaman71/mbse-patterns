"""Constraints: sets of predicates, and predicates and distributions as data.

A set, `OfSet` (`Predicates.OfSet`), gathers predicates in order, and is built as they are, by a fluent builder:
`OfSet.Builder().predicates(HasAPhone, lambda p: p.name(...)...)`. Nothing validates until asked; `check` raises with
each predicate's problems, labelled by its name, and with a predicate of a set that has no name, or a name two share.

Predicates, sets and distributions are terms, mbse-schemas reference objects with meta-schemas, so they are stored and
sent like any data: a term is its arguments' parent through `Expressions.Arguments`, by index, and a predicate shared
by several terms is written once. Writing needs no store; reading resolves the symbols' schemas by name, so it goes
through `OfStore(store)`, a store of the terms' bound classes that resolves names in `store`; `Builders` is one that
resolves none, which writes any term and reads those whose symbols' schemas are inline. `register(store)` registers the
meta-schemas in another store.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from mbse.Expressions.Framework import Terms
from mbse.Schemas.Framework import Bindings, Stores

from . import Distributions, Predicates

__all__ = ["OfSet", "OfStore", "Builders", "register", "check", "SET"]

SET = Predicates.SET
OfSet = Predicates.OfSet


def _bound(kind: Any, store: Stores.Store) -> Any:
    """The builders of `kind`'s data, reading its symbols' schemas by name in `store`."""
    binding = kind.BINDING

    def make(state: Bindings.State) -> Any:
        with Predicates.resolving(store):
            return binding.make(state)

    def assign(instance: Any, state: Bindings.State) -> Any:
        with Predicates.resolving(store):
            return binding.assign(instance, state)

    resolved = Bindings.Binding(binding.schema, binding.read, make, assign, fixed=binding.fixed,
                                exclusive=set(binding.exclusive.values()), implied=binding.implied)
    return lambda instance=None: Bindings.Builder(resolved, instance)


class OfStore(Bindings.OfStore):
    """A store of predicates, sets, distributions and the algebra's expressions as their bound classes, reading the
    symbols' schemas by name in `store`: what snapshots of them are read into, and written from."""

    def __init__(self, store: Stores.Store):
        super().__init__([(kind.Schema, _bound(kind, store)) for kind in Predicates.DIALECT.classes],
                         [Terms.Arguments])


Builders = OfStore(Stores.Catalog())  # type: ignore[arg-type]
"""A store of the terms' bound classes that resolves no names: it writes any term, and reads those whose symbols'
schemas are inline."""


def register(store: Any) -> Any:
    """Registers the meta-schemas of predicates, sets and distributions, and the algebra's (Basic's included), in
    `store` (e.g. a `Proxies.OfStore`), skipping those it already holds. Returns the store."""
    return Predicates.DIALECT.register(store)


def check(predicates: Iterable[Any] | Predicates.OfSet) -> Predicates.OfSet:
    """A set of `predicates`, each a predicate or a callable taking a predicate builder, raising `ValueError` with every
    problem: each predicate's, labelled by its name, a predicate without a name, and a name two predicates share."""
    result = predicates if isinstance(predicates, OfSet) else OfSet.Builder().predicates(*predicates).create()
    problems = result.check()
    seen: set[Any] = set()
    for predicate in result.predicates if not problems else ():
        label = f"predicate {predicate.name!r}"
        if predicate.name is None:
            problems.append(f"{label}: a predicate of a set needs a name")
        problems += [f"{label}: {problem}" for problem in Predicates.DIALECT.validate(predicate, core=True)]
        problems += [f"{label}: {problem}" for problem in Distributions.typing(predicate)]
        if predicate.name in seen:
            problems.append(f"{label}: defined twice")
        seen.add(predicate.name)
    if problems:
        raise ValueError("; ".join(problems))
    return result
