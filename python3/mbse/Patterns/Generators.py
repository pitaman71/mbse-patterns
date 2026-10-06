"""Generators: data drawn from a predicate, new or already in a store.

A predicate's constraint says how its matches are distributed, by the terms of `Distributions` in it: weighted
alternatives (`Choices`) and values drawn (`Normal`, ...). `Generate(store, predicate, random)` builds new matches, and
`Sample(store, predicate, random)` draws the store's own, by weight.

**Generating.** Each step draws from its own stream, `random.split(str(step))`, so a step's objects do not depend on how
many were drawn before it, and one seed gives the same data in every implementation. A step walks the constraint,
through conjunctions and applications of predicates (their symbols and parameters bound to their arguments):

- a `Choices` chooses an arm by weight, from the step's stream split by `"choices <n>"`, `n` counting the choices met,
  and the walk goes on into the arm's condition;
- a distribution draws a value, from the attempt's stream split by its symbol, so that adding a distribution does not
  change the others, its parameters evaluated with what is already set or drawn; the walk goes on into its body, with
  the symbol bound to the value;
- an equality `x.p == v` (or `v == x.p`), where `x` is one of the predicate's symbols and `v` a literal or a drawn value,
  sets `x`'s property `p` to `v`, unless it is already set; nothing else sets a property.

It then builds, for each symbol, an object of its schema with the properties set, and checks it: the constraint must
hold of the match, each arm chosen must hold, and, with `decreasing`, be the first of its choices to hold. If it does
not, the step draws its values again, from its stream split by `"attempt 1"`, `"attempt 2"`, ..., keeping the arms
chosen, up to `ATTEMPTS` attempts, and raises `ValueError` if none passes; a constraint that draws nothing builds the
same objects every time, and so has one attempt. `Generate` returns a `Generation`, which counts the steps it has taken
and the attempts it rejected. The objects are transient until linked to the store's data; generated data is ordinary
data, validated, queried and serialized as any other.

**Sampling.** `Sample` draws, with replacement, among the matches of the store's data (the cross product of the
symbols' extents), each with probability proportional to what it weighs (`Predicates.Evaluator.weigh`): nothing unless
the constraint holds; then the product of the weights of the arms it falls under.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Iterator, Mapping
from typing import Any

from mbse.Expressions import Domains as BasicDomains, Expressions as E
from mbse.Schemas.Framework import Stores

from . import Distributions, Predicates, Sampling

__all__ = ["Generate", "Generation", "Sample", "check", "ATTEMPTS"]

ATTEMPTS = 100
"""How many times a step draws its values before it gives up."""


def check(predicate: Predicates.OfPredicate) -> Predicates.OfPredicate:
    """`predicate`, raising `ValueError` if it cannot be drawn from: the problems validation reports, a distribution
    that sets a property of another type, or parameters, which only an application binds."""
    problems = [*Predicates.DIALECT.validate(predicate, core=True), *Distributions.typing(predicate)]
    if predicate.parameters:
        problems.append("a predicate with parameters is drawn from where it is applied")
    if problems:
        raise ValueError(f"the predicate cannot be drawn from: {'; '.join(problems)}")
    return predicate


def _number(value: Any, what: str) -> float:
    if type(value) not in (int, float):
        raise TypeError(f"{what} must be a number, got {type(value).__name__}")
    return float(value)


def _draw(drawn: Any, random: Stores.Random, parameter: Any) -> Any:
    """A value drawn from a distribution; `parameter(name)` gives its parameter `name`, and `parameter(option)` an
    option's value."""
    if isinstance(drawn, Distributions.Normal):
        value = Sampling.normal(random, _number(parameter("mean"), "a normal's mean"),
                                _number(parameter("deviation"), "a normal's deviation"))
        return math.floor(value + 0.5) if drawn.rounded else value
    if isinstance(drawn, Distributions.Uniform):
        low, high = parameter("low"), parameter("high")
        if type(low) is int and type(high) is int:
            if low > high:
                raise ValueError(f"a uniform's low must not exceed its high, got {low!r} and {high!r}")
            return low + Sampling.below(random, high - low + 1)
        return Sampling.between(random, _number(low, "a uniform's low"), _number(high, "a uniform's high"))
    if isinstance(drawn, Distributions.Poisson):
        return Sampling.poisson(random, _number(parameter("rate"), "a Poisson's rate"))
    if isinstance(drawn, Distributions.Geometric):
        return Sampling.geometric(random, _number(parameter("probability"), "a geometric's probability"))
    return parameter(drawn.options[Sampling.weighted(random, [option.weight for option in drawn.options])])


class _Attempt:
    """One attempt of a step: the values it sets, the arms it chooses, and whether it drew anything."""

    def __init__(self, generation: Generation, step: Stores.Random, attempt: Stores.Random):
        self.generation, self.step, self.attempt = generation, step, attempt
        self.values: dict[str, dict[str, Any]] = {symbol: {} for symbol in generation.predicate.symbols}
        self.chosen: dict[int, tuple[Distributions.Choices, int]] = {}
        self.met = 0
        self.drawn = False

    @staticmethod
    def _bound(node: Any, scope: Mapping[str, Any]) -> Any:
        return scope.get(node.name, node) if isinstance(node, E.OfVariable.Data) else node

    def _variables(self, scope: Mapping[str, Any]) -> dict[str, Any]:
        """The values of the names in scope, to evaluate a parameter: a symbol's properties set so far, as a record,
        and a literal's value (a drawn value's, or an argument's)."""
        return {name: BasicDomains.Record(dict(self.values[node.name])) if isinstance(node, E.OfVariable.Data)
                else node.value for name, node in scope.items()}

    def _argument(self, node: Any, scope: Mapping[str, Any]) -> Any:
        """An application's argument, for the walk: a symbol's variable, or a literal of its value."""
        bound = self._bound(node, scope)
        if isinstance(bound, (E.OfVariable.Data, E.OfLiteral.Data)):
            return bound
        return E.literal(self.generation.evaluate(bound, self._variables(scope))).data

    def visit(self, node: Any, scope: Mapping[str, Any]) -> None:
        if isinstance(node, E.OfOperation.Data) and node.name == "and" and len(node.arguments) == 2:
            for argument in node.arguments:
                self.visit(argument, scope)
        elif isinstance(node, Predicates.OfApply) and isinstance(node.predicate, Predicates.OfPredicate):
            arguments = [self._argument(argument, scope) for argument in node.arguments]
            self.visit(node.predicate.requires, dict(zip(node.predicate.binds(), arguments)))
        elif isinstance(node, Distributions.Choices):
            index = Sampling.weighted(self.step.split(f"choices {self.met}"), [arm.weight for arm in node.arms])
            self.met += 1
            self.chosen[id(node)] = (node, index)
            self.visit(node.arms[index].condition, scope)
        elif isinstance(node, Distributions.DRAWN):
            self.drawn = True
            evaluate, variables = self.generation.evaluate, self._variables(scope)

            def parameter(name: Any) -> Any:
                expression = name.value if isinstance(name, Distributions.Option) else getattr(node, name)
                return evaluate(expression, variables)

            value = _draw(node, self.attempt.split(node.symbol), parameter)
            self.visit(node.body, {**scope, node.symbol: E.literal(value).data})
        elif isinstance(node, E.OfOperation.Data) and node.name == "eq" and len(node.arguments) == 2:
            for left, right in (node.arguments, tuple(reversed(node.arguments))):
                value = self._bound(right, scope)
                read = isinstance(left, E.OfOperation.Data) and left.name == "get" and len(left.arguments) == 2
                subject = self._bound(left.arguments[0], scope) if read else None
                if (read and isinstance(value, E.OfLiteral.Data) and isinstance(left.arguments[1], E.OfLiteral.Data)
                        and isinstance(subject, E.OfVariable.Data) and subject.name in self.values):
                    self.values[subject.name].setdefault(left.arguments[1].value, value.value)
                    return


def _built(store: Stores.Store, schema: Any, values: Mapping[str, Any]) -> Any:
    builder = store.builder(schema.name)
    for name, value in values.items():
        builder.property(name, lambda p, value=value: p.value(lambda a: a.as_native(lambda n: n.set(value))))
    return builder.create()


def Generate(store: Stores.Store, predicate: Predicates.OfPredicate, random: Stores.Random) -> Generation:
    """New matches of `predicate`, one per step, drawn with `random`. The predicate is checked when called."""
    return Generation(store, check(predicate), random)


class Generation(Iterator[dict[str, Any]]):
    """The matches a predicate generates, one per step: an iterator, which counts the `steps` it has taken and the
    attempts it `rejected`."""

    def __init__(self, store: Stores.Store, predicate: Predicates.OfPredicate, random: Stores.Random):
        self.store, self.predicate, self.random = store, predicate, random
        self.steps = self.rejected = 0
        self.evaluate = Predicates.Evaluator(store)

    def __iter__(self) -> Generation:
        return self

    def __next__(self) -> dict[str, Any]:
        predicate, step = self.predicate, self.random.split(str(self.steps))
        for count in range(ATTEMPTS):
            attempt = _Attempt(self, step, step.split(f"attempt {count}"))
            attempt.visit(predicate.requires, {symbol: E.variable(symbol).data for symbol in predicate.symbols})
            match = {symbol: _built(self.store, schema, attempt.values[symbol])
                     for symbol, schema in predicate.symbols.items()}
            if self._passes(attempt, match):
                self.steps += 1
                return match
            self.rejected += 1
            if not attempt.drawn:
                raise ValueError("the predicate cannot be generated from its equalities and choices: what they build "
                                 "does not satisfy it")
        raise ValueError(f"the predicate cannot be generated: none of its {ATTEMPTS} attempts satisfies it")

    def _passes(self, attempt: _Attempt, match: Mapping[str, Any]) -> bool:
        """Whether the constraint holds of the match, each arm chosen holds, and, with `decreasing`, first."""
        evaluate = Predicates.Evaluator(self.store)
        evaluate.observe = {}
        if Predicates.holds(evaluate, self.predicate.requires, match) is not True:
            return False
        for key, (node, index) in attempt.chosen.items():
            held = evaluate.observe.get(key, [])
            if index >= len(held) or held[index] is not True or (node.decreasing and True in held[:index]):
                return False
        return True


def Sample(store: Stores.Store, predicate: Predicates.OfPredicate, random: Stores.Random) -> Iterator[dict[str, Any]]:
    """Matches of the store's data drawn with replacement, each with probability proportional to what it weighs, from
    `random`. The predicate is checked when called; the store is read at the first draw."""
    check(predicate)
    return _sample(store, predicate, random)


def _sample(store: Stores.Store, predicate: Predicates.OfPredicate, random: Stores.Random) -> Iterator[dict[str, Any]]:
    evaluate = Predicates.Evaluator(store)
    names = list(predicate.symbols)
    matches = [dict(zip(names, objects)) for objects in itertools.product(
        *(evaluate.extent(schema.name) for schema in predicate.symbols.values()))]
    weighed = [evaluate.weigh(predicate.requires, match) for match in matches]
    if not any(weighed):
        raise ValueError("no match of the store's data has a weight")
    while True:
        yield matches[Sampling.weighted(random, weighed)]
