"""Generators: new data drawn from a distribution.

`Generate(store, weights, random)` streams matches of new objects, built with the store's builders. Each step draws
from its own stream, `random.split(str(step))`, so a step's objects do not depend on how many were drawn before it,
and one seed gives the same data in every implementation. A step chooses a case of the distribution with probability
proportional to its weight, from the step's stream split by `"case"`, and builds, for each symbol, an object of its
schema:

- the properties the case's predicate requires by equality are set first: a conjunct `x.p == v` (or `v == x.p`),
  where `x` is a symbol and `v` a literal, sets `x`'s property `p` to `v`, following conjunctions and applications of
  predicates, whose symbols and parameters are bound to their arguments (`settings(predicate)` gives them);
- then the case's draws, in order, draw the properties left open, each from its own stream, split from the attempt's
  by `"symbol.property"`, so that adding a draw does not change the others; a draw's parameters may read what is
  already set or drawn (`Normal(lambda n: n.mean(person.age * 2).deviation(1))`).

The objects built must weigh what the case says: the case must be the first whose predicate holds of them. If it is
not, the step draws again, from its stream split by `"attempt 1"`, `"attempt 2"`, ..., up to `ATTEMPTS` attempts in
all, and raises `ValueError`, naming the case, if none satisfies it; a case without draws builds the same objects
every time, and so has one attempt. `Generate` returns a `Generation`, which counts the steps it has taken and the
attempts it rejected. The objects are transient until linked to the store's data; generated data is ordinary data,
validated, queried and serialized as any other.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from mbse.Expressions import Domains as BasicDomains, Expressions as E
from mbse.Schemas.Framework import Stores

from . import Distributions, Predicates, Sampling

__all__ = ["Generate", "Generation", "settings", "ATTEMPTS"]

ATTEMPTS = 100
"""How many times a step draws a case's properties before it gives up."""

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


def Generate(store: Stores.Store, weights: Distributions.OfWeights, random: Stores.Random) -> Generation:
    """Matches of new objects, one per step, drawn from `weights` with `random`. The distribution is checked when
    called."""
    return Generation(store, Distributions.check(weights), random)


class Generation(Iterator[dict[str, Any]]):
    """The matches a distribution generates, one per step: an iterator, which counts the `steps` it has taken and the
    attempts it `rejected`, those whose objects the chosen case did not hold of first."""

    def __init__(self, store: Stores.Store, weights: Distributions.OfWeights, random: Stores.Random):
        self.store, self.weights, self.random = store, weights, random
        self.steps = self.rejected = 0

    def __iter__(self) -> Generation:
        return self

    def __next__(self) -> dict[str, Any]:
        weights, stream = self.weights, self.random.split(str(self.steps))
        chosen = Sampling.weighted(stream.split("case"), [case.weight for case in weights.cases])
        case = weights.cases[chosen]
        fixed = settings(case.predicate)
        attempts = ATTEMPTS if case.draws else 1
        for attempt in range(attempts):
            drawing = stream.split(f"attempt {attempt}")
            evaluate = Predicates.Evaluator(self.store)
            values = {symbol: dict(fixed.get(symbol, {})) for symbol in weights.symbols}
            for d in case.draws:
                symbol, name = d.target()
                if name not in values[symbol]:
                    scope = {s: BasicDomains.Record(dict(v)) for s, v in values.items()}
                    values[symbol][name] = Distributions.draw(evaluate, d.distribution, drawing.split(f"{symbol}.{name}"),
                                                              scope)
            match = {symbol: _built(self.store, schema, values[symbol]) for symbol, schema in weights.symbols.items()}
            evaluate = Predicates.Evaluator(self.store)
            first = next((i for i, c in enumerate(weights.cases)
                          if Predicates.holds(evaluate, c.predicate.rule, match) is True), None)
            if first == chosen:
                self.steps += 1
                return match
            self.rejected += 1
        if attempts > 1:
            raise ValueError(f"case {chosen} cannot be generated: none of its {attempts} attempts satisfies it")
        raise ValueError(f"case {chosen} cannot be generated from its equalities: what they build "
                         + ("does not satisfy it" if first is None or first > chosen else f"satisfies case {first}"))
