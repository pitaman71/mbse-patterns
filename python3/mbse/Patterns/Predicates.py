"""Predicates: the predicate algebra, a dialect extending mbse-expressions' Basic with terms about a store's data.

Basic's quantifiers range over collections; these range over a schema's objects in a store, and say how objects are
linked, so that mandatory, possible and forbidden links are predicates:

- `extent(Schema)`: the schema's objects in the store (its extent: what the store's singletons reach);
- `forall(x, Schema, body)`, `exists(x, Schema, body)` and `count(x, Schema, body)`: quantifiers binding `x` to each
  object of `Schema` (their collection is an `extent`), whether the body holds for all, for some, or for how many;
- `linked(a, adjacency, b)`: whether one of `a`'s entries in `adjacency` links `b`, through the relation's other link
  (`linked(a, adjacency, b, link)` names the link, for a relation of more than two);
- `choice((weight, predicate), ...)`: a weighted disjunction of options, which holds when any of them holds; its
  weights, positive and summing to 1, are how often a generator chooses each option, and what a characterizer
  estimates.

    mandatory = forall("c", Contact, exists("p", Phone, linked(c, "phones", p)))
    forbidden = forall("c", Contact, exists("p", Pager, linked(c, "pagers", p)).not_())
    possible = forall("c", Contact, choice((0.35, exists("p", Pager, linked(c, "pagers", p))),
                                           (0.65, exists("p", Pager, linked(c, "pagers", p)).not_())))

The writers give Basic writers, so these terms combine with Basic's (`.and_()`, `.not_()`), and every Basic
expression is a predicate. `DIALECT` validates the trees that mix them; `Evaluator(store)` evaluates them, with the
store giving extents and links, and Basic's three-valued rules for everything else.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from mbse.Expressions import Domains as BasicDomains, Evaluators as Basic, Expressions as E
from mbse.Expressions.Framework import Evaluators as F, Terms
from mbse.Schemas.Framework import Stores, Validators

__all__ = ["DIALECT", "extent", "forall", "exists", "count", "linked", "choice", "Evaluator", "holds",
           "OfExtent", "OfForall", "OfExists", "OfCount", "OfLinked", "OfChoice", "OfOption"]


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
    collection: Any = None
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
class OfCount(_Quantified):
    """How many objects of the collection the body holds for, with `name` bound to each."""

    KIND = "count"


@dataclass(eq=False)
class OfLinked(Terms.Term):
    """Whether one of `source`'s entries in `adjacency` links `target`, through `link` or the relation's other link."""

    KIND = "linked"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"adjacency": str, "link": str}
    OPTIONAL = frozenset({"link"})
    SLOTS = ("source", "target")
    adjacency: str | None = None
    link: str | None = None
    source: Any = None
    target: Any = None


@dataclass(eq=False)
class OfOption(Terms.Term):
    """An option of a choice: its predicate, and its weight."""

    KIND = "option"
    ROLE = Terms.APPLICATION
    PROPERTIES = {"weight": float}
    SLOTS = ("body",)
    weight: float | None = None
    body: Any = None

    def check(self) -> list[str]:
        if type(self.weight) is float and not (self.weight > 0 and math.isfinite(self.weight)):
            return [f"an option's weight must be positive, got {self.weight!r}"]
        return []


@dataclass(eq=False)
class OfChoice(Terms.Term):
    """A weighted disjunction of options: it holds when any of them holds."""

    KIND = "choice"
    ROLE = Terms.APPLICATION
    VARIADIC = "options"
    options: tuple[Any, ...] = ()

    def check(self) -> list[str]:
        if not all(isinstance(option, OfOption) for option in self.options):
            return ["a choice's arguments are options"]
        if not self.options:
            return ["a choice needs an option"]
        weights = [option.weight for option in self.options]
        if all(type(w) is float for w in weights) and abs(sum(weights) - 1) > 1e-9:
            return [f"a choice's weights must sum to 1, got {sum(weights)!r}"]
        return []


DIALECT = Terms.Declared(
    "Predicates", [OfExtent, OfForall, OfExists, OfCount, OfLinked, OfChoice, OfOption], domain_of=BasicDomains.of,
    extends=E.DIALECT,
    schema_names={kind: f"Patterns.Of{kind.capitalize()}"
                  for kind in ("extent", "forall", "exists", "count", "linked", "choice", "option")},
)
"""The predicate algebra: Basic's kinds, and the kinds above."""


# --- Writers ---


def _schema_name(schema: Any) -> str:
    name = schema if isinstance(schema, str) else getattr(schema, "name", None)
    if not isinstance(name, str):
        raise TypeError(f"expected a named schema or its name, got {schema!r}")
    return name


def extent(schema: Any) -> E.Writer:
    """The objects of `schema` (a named schema, or its name) in the store."""
    return E.Writer(OfExtent(_schema_name(schema)))


def _quantified(kind: type[_Quantified], name: str, schema: Any, body: Any) -> E.Writer:
    return E.Writer(kind(name, OfExtent(_schema_name(schema)), DIALECT.resolve(body)))


def forall(name: str, schema: Any, body: Any) -> E.Writer:
    """Whether `body` holds for every object of `schema`, with `name` bound to it."""
    return _quantified(OfForall, name, schema, body)


def exists(name: str, schema: Any, body: Any) -> E.Writer:
    """Whether `body` holds for some object of `schema`, with `name` bound to it."""
    return _quantified(OfExists, name, schema, body)


def count(name: str, schema: Any, body: Any) -> E.Writer:
    """How many objects of `schema` `body` holds for, with `name` bound to each."""
    return _quantified(OfCount, name, schema, body)


def linked(source: Any, adjacency: str, target: Any, link: str | None = None) -> E.Writer:
    """Whether one of `source`'s entries in `adjacency` links `target`, through `link` or the relation's other link."""
    return E.Writer(OfLinked(adjacency, link, DIALECT.resolve(source), DIALECT.resolve(target)))


def choice(*options: tuple[float, Any]) -> E.Writer:
    """A weighted disjunction: `choice((0.35, p), (0.65, q))` holds when `p` or `q` does."""
    return E.Writer(OfChoice(tuple(OfOption(float(weight), DIALECT.resolve(body)) for weight, body in options)))


# --- Evaluation ---


class Evaluator:
    """Evaluates predicates over `store`: Basic's rules, with extents and links from the store. Extents are read once
    per evaluator, so an evaluator sees the store as it was when first asked."""

    def __init__(self, store: Stores.Store):
        self.store = store
        self._extents: dict[str, tuple[Any, ...]] = {}
        self.interpreter = F.Interpreter(DIALECT, {
            "operation": Basic.OPERATIONS, "quantifier": Basic.QUANTIFIERS,
            "extent": self._extent, "forall": Basic.QUANTIFIERS["all"], "exists": Basic.QUANTIFIERS["any"],
            "count": Basic.QUANTIFIERS["count"], "linked": self._linked, "choice": _choice,
            "option": lambda thunks, node, scope: thunks[0](),
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

    def _linked(self, thunks: Any, node: OfLinked, scope: Any) -> bool | None:
        source, target = thunks[0](), thunks[1]()
        if source is None or target is None:
            return None
        for value, what in ((source, "source"), (target, "target")):
            if not callable(getattr(value, "schema_name", None)):
                raise TypeError(f"linked expects an object as its {what}, got {type(value).__name__}")
        declared = self.store.schema(source.schema_name()).adjacencies.get(node.adjacency)  # type: ignore[arg-type]
        if declared is None:
            raise TypeError(f"{source.schema_name()!r} has no adjacency {node.adjacency!r}")
        others = [link for link in declared.relation.links if link != declared.me]  # type: ignore[union-attr]
        if node.link is None and len(others) != 1:
            raise ValueError(f"linked needs a link for {node.adjacency!r}, whose relation has links "
                             f"{', '.join(map(repr, others))}")
        link = node.link if node.link is not None else others[0]
        return any(entry.targets.get(link) is not None and entry.targets[link].identity() == target.identity()
                   for entry in Validators.entries_of(source).get(node.adjacency, []))  # type: ignore[arg-type]


def _choice(thunks: Any, node: OfChoice, scope: Any) -> bool | None:
    """Kleene's disjunction of the options."""
    unknown = False
    for thunk in thunks:
        value = thunk()
        if value is True:
            return True
        if value is None:
            unknown = True
        elif value is not False:
            raise TypeError(f"a choice's options must be bools, got {type(value).__name__}")
    return None if unknown else False


def holds(evaluate: Evaluator, rule: Any, scope: Mapping[str, Any]) -> bool | None:
    """The rule's value with `scope` bound: `True`, `False` or unknown (`None`); a rule that gives anything else
    raises."""
    result = evaluate.interpreter(rule, scope)
    if result is not None and type(result) is not bool:
        raise TypeError(f"a predicate must be a bool, got {type(result).__name__}")
    return result
