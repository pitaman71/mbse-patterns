"""Generators: new data drawn from a distribution.

`Generate(store, weights, random)` streams matches of new objects, built with the store's builders. Each step draws
from its own stream, `random.split(str(step))`, so a step's objects do not depend on how many were drawn before it,
and one seed gives the same data in every implementation. It chooses a case of the distribution with probability proportional to its weight, and builds, for
each symbol, an object of its schema whose properties are those the case's predicate requires by equality:

- a conjunct `x.p == v` (or `v == x.p`), where `x` is a symbol and `v` a literal, sets `x`'s property `p` to `v`;
- an application of a predicate, `HasName(person, "alice")`, is followed into the predicate's rule, with its symbols
  and parameters bound to the arguments, so its equalities set properties as the case's own do;
- conjuncts of `and`s are followed too; nothing else sets a property.

The objects built must then weigh what the case says: the case must be the first whose predicate holds of them, or the
generator raises `ValueError`, naming the case. Drawing the properties a case leaves open from distributions is
planned. The objects are transient until linked to the store's data; generated data is ordinary data, validated,
queried and serialized as any other.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from mbse.Expressions import Expressions as E
from mbse.Schemas.Framework import Stores

from . import Distributions, Predicates, Sampling

__all__ = ["Generate", "settings"]

_UNSET = object()


def _literal(node: Any) -> Any:
    return node.value if isinstance(node, E.OfLiteral.Data) else _UNSET


def _operation(node: Any, name: str, arity: int) -> bool:
    return isinstance(node, E.OfOperation.Data) and node.name == name and len(node.arguments) == arity


def settings(predicate: Predicates.OfPredicate) -> dict[str, dict[str, Any]]:
    """The properties a predicate sets by equality, by symbol: `{symbol: {property: value}}`."""
    found: dict[str, dict[str, Any]] = {}
    symbols = set(predicate.symbols)

    def target(node: Any, scope: Mapping[str, Any]) -> tuple[str, str] | None:
        """The symbol and property `node`, `get(x, 'p')`, reads, if `x` is one of the predicate's symbols."""
        if not _operation(node, "get", 2):
            return None
        subject, name = node.arguments
        subject = scope.get(subject.name, subject) if isinstance(subject, E.OfVariable.Data) else subject
        if isinstance(subject, E.OfVariable.Data) and subject.name in symbols and type(_literal(name)) is str:
            return subject.name, name.value
        return None

    def visit(node: Any, scope: Mapping[str, Any]) -> None:
        if _operation(node, "and", 2):
            for argument in node.arguments:
                visit(argument, scope)
        elif isinstance(node, Predicates.OfApply) and isinstance(node.predicate, Predicates.OfPredicate):
            arguments = [scope.get(a.name, a) if isinstance(a, E.OfVariable.Data) else a for a in node.arguments]
            visit(node.predicate.rule, dict(zip(node.predicate.binds(), arguments)))
        elif _operation(node, "eq", 2):
            for left, right in (node.arguments, reversed(node.arguments)):
                read = target(left, scope)
                right = scope.get(right.name, right) if isinstance(right, E.OfVariable.Data) else right
                if read is not None and _literal(right) is not _UNSET:
                    found.setdefault(read[0], {})[read[1]] = right.value
                    return

    visit(predicate.rule, {})
    return found


def _built(store: Stores.Store, schema: Any, values: Mapping[str, Any]) -> Any:
    builder = store.builder(schema.name)
    for name, value in values.items():
        builder.property(name, lambda p, value=value: p.value(lambda a: a.as_native(lambda n: n.set(value))))
    return builder.create()


def Generate(store: Stores.Store, weights: Distributions.OfWeights, random: Stores.Random) -> Iterator[dict[str, Any]]:
    """Matches of new objects, one per step, drawn from `weights` with `random`. The distribution is checked when
    called."""
    Distributions.check(weights)
    return _generate(store, weights, random)


def _generate(store: Stores.Store, weights: Distributions.OfWeights, random: Stores.Random) -> Iterator[dict[str, Any]]:
    cases = [case.weight for case in weights.cases]
    step = 0
    while True:
        chosen = Sampling.weighted(random.split(str(step)), cases)
        values = settings(weights.cases[chosen].predicate)
        match = {symbol: _built(store, schema, values.get(symbol, {})) for symbol, schema in weights.symbols.items()}
        evaluate = Predicates.Evaluator(store)
        first = next((i for i, case in enumerate(weights.cases)
                      if Predicates.holds(evaluate, case.predicate.rule, match) is True), None)
        if first != chosen:
            raise ValueError(f"case {chosen} cannot be generated from its equalities: what they build "
                             + ("does not satisfy it" if first is None or first > chosen else f"satisfies case {first}"))
        yield match
        step += 1
