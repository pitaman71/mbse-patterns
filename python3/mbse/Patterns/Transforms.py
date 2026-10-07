"""Transforms: rewrites applied step by step, one decision per step, every decision recorded.

A transform is a rewrite with a precondition and a postcondition, in the shape of MLIR's pattern rewriting (see
docs/TRANSFORMS.md): its `before` and `after` are predicates over the same symbols; its `parameters` are mbse-schemas'
`OfParameter`s, each typed by its value domain; and its `rewrite(store, match, arguments)` changes the store's data so
that `after` holds for the match. A composite transform has `parts`, transforms of its own, instead of a rewrite.

A `Session` applies transforms to a store's data. A step is enabled for a match (each symbol bound to an object of its
schema, as `Queries.select` finds them) where `before` holds and `after` does not; where either is unknown the match is
undecided, and reported in `undecided`. A candidate is an enabled step with values for the parameters whose domain is
finite (a `bool`, or a union of options: branches that are value objects with no properties, whose values are the
branches' names), one candidate per combination; a parameter of any other domain stays open until answered
(`candidate.answer(name=value)`). Candidates are ordered: those of transforms with parameters first, then by the
transforms' order, then by their matches (each object in the order the session first saw it), then by their values'
order in their domains. A session names each object by its path when it first sees it (mbse-schemas' `Paths`:
`Shelf/items[0]`, or a schema's name), and keeps the name and the order for the session, since a rewrite may reorder
an extent; a composite's session shares its parent's.

`take(candidate)` takes one, as the caller decides; `step_in(candidate)` opens a composite's own session, scoped to its
match (its parts' matches agree with it on the symbols they share), whose steps the caller then takes; the composite's
step is recorded once that session is done. `step_over(policy)` takes the candidate the policy ranks first, a composite
as a whole, and `run(policy)` steps over until the session is done or the policy cannot decide. A `Policy` only ranks:
each of its clauses weighs the candidates of one transform that have the clause's arguments (which also answer open
parameters), so its ranking is a recommendation when the caller decides, and the decision when the caller steps over.
A candidate no clause weighs is not the policy's to take. Resolution is linear: after each step, the candidates are
found again, so taking one disables another that the step's rewrite made done.

`session.trace(store)` writes the steps taken as data, a `Transforms.Trace` object in a store that `register` prepared,
which JSON and YAML write byte-identically in both implementations; `steps(store, trace)` reads them back.

A rerun reuses decisions. A step's `key` is its transform and its match's paths (`Label(i=Shelf/items[0])`); a session
given `earlier` steps takes, before any policy, each candidate an earlier step with its key decided with the same
arguments, recorded as `reused` (a composite's own steps are reused inside it), so `run()` without a policy takes only
those. `orphans` are the earlier decisions not taken again whose key no candidate has. `diff(earlier, later)` gives the
steps added, removed and changed (the same key, other arguments), a composite's own steps under its key.
"""

from __future__ import annotations

import itertools
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from mbse.Schemas.Framework import Paths, Plain, Schemas, Visitors

from . import Predicates, Queries

__all__ = ["Transform", "Candidate", "Session", "Policy", "Clause", "Step", "Diff", "diff", "steps", "TRACE", "Trace",
           "register"]

TRACE = "Transforms.Trace"

Rewrite = Callable[[Any, dict[str, Visitors.Visitable], dict[str, Any]], Any]


def _options(domain: Any) -> tuple[Any, ...] | None:
    """The values of a finite domain, in order: a `bool`'s, or the names of a union's options; None for any other."""
    if isinstance(domain, Schemas.OfNative.Data) and domain.type is bool:
        return (False, True)
    if isinstance(domain, Schemas.OfUnion.Data) and domain.branches and all(
            isinstance(branch.type, Schemas.OfObject.Data) and not branch.type.properties for branch in domain.branches):
        return tuple(branch.name for branch in domain.branches)
    return None


def _key(numbers: Iterable[int]) -> str:
    """A candidate's place in the canonical order, as text that sorts as it: parameters first, the transform's order,
    its match's labels, its values' order in their domains, each number of ten digits."""
    return ".".join(f"{n:010d}" for n in numbers)


def _same(a: Any, b: Any) -> bool:
    return type(a) is type(b) and a == b


def _holds(evaluate: Predicates.Evaluator, predicate: Predicates.OfPredicate, match: Mapping[str, Any]) -> bool | None:
    """Whether the predicate holds for the match: true, false or unknown (None)."""
    return Predicates.holds(evaluate, predicate.requires, dict(match))


class Transform:
    """A rewrite: `before` and `after`, predicates over the same symbols; `parameters`, `OfParameter`s or their specs; and
    either a `rewrite(store, match, arguments)` or `parts`, the transforms of a composite."""

    def __init__(self, name: str, before: Any, after: Any, parameters: Iterable[Any] = (), rewrite: Rewrite | None = None,
                 parts: Iterable[Transform] = ()):
        self.name = name
        self.before, self.after = Predicates.OfPredicate.resolve(before), Predicates.OfPredicate.resolve(after)
        built = (spec if isinstance(spec, Schemas.OfParameter.Data) else spec(Schemas.OfParameter.Builder()).create()
                 for spec in parameters)
        self.parameters = {parameter.name: parameter for parameter in built}
        self.rewrite, self.parts = rewrite, tuple(parts)

    def check(self) -> list[str]:
        """The transform's problems, and its parts', each labelled by the transform's name."""
        problems = [] if self.before.symbols == self.after.symbols else ["before and after must have the same symbols"]
        if (self.rewrite is None) == (not self.parts):
            problems.append("a transform has a rewrite or parts, one of them")
        problems = [f"transform {self.name!r}: {problem}" for problem in problems]
        return problems + [problem for part in self.parts for problem in part.check()]


@dataclass(frozen=True, eq=False)
class Candidate:
    """An enabled step: a transform, a match, values for its parameters, those still `open`, and the `score` a policy
    gave it (0.0 without one)."""

    transform: Transform
    match: Mapping[str, Visitors.Visitable]
    arguments: Mapping[str, Any]
    open: tuple[str, ...] = ()
    score: float = 0.0
    key: str = field(default="", repr=False)

    def answer(self, **values: Any) -> Candidate:
        """The candidate with open parameters answered."""
        for name in values:
            if name not in self.open:
                raise TypeError(f"{self.transform.name!r} has no open parameter {name!r}")
        return replace(self, arguments={**self.arguments, **values}, open=tuple(n for n in self.open if n not in values))

    def same(self, other: Candidate) -> bool:
        """Whether `other` is this candidate, its open parameters answered or not."""
        return (other.transform is self.transform and other.match.keys() == self.match.keys()
                and all(other.match[s] is self.match[s] for s in self.match)
                and all(name in other.arguments and _same(other.arguments[name], value)
                        for name, value in self.arguments.items()))


@dataclass(frozen=True)
class Clause:
    """A policy's clause: it weighs the candidates of the transform named `transform` that have its `arguments`; an
    argument for an open parameter answers it."""

    transform: str
    arguments: Mapping[str, Any] = field(default_factory=dict)
    weight: float = 1.0

    def applies(self, candidate: Candidate) -> bool:
        return self.transform == candidate.transform.name and all(
            name in candidate.open or (name in candidate.arguments and _same(candidate.arguments[name], value))
            for name, value in self.arguments.items())


class Policy:
    """Ranks candidates by its clauses: a candidate's score is the sum of the weights of the clauses that apply to it."""

    def __init__(self, *clauses: Clause):
        self.clauses = clauses

    def score(self, candidate: Candidate) -> float:
        return sum(clause.weight for clause in self.clauses if clause.applies(candidate))

    def answers(self, candidate: Candidate) -> dict[str, Any]:
        """Values for the candidate's open parameters, from the first clause that applies and gives each."""
        values: dict[str, Any] = {}
        for clause in self.clauses:
            if clause.applies(candidate):
                for name, value in clause.arguments.items():
                    if name in candidate.open:
                        values.setdefault(name, value)
        return values


@dataclass(frozen=True)
class Step:
    """A step taken: its transform's name, its match by paths, its arguments, who decided it, and a composite's mode and
    own steps."""

    transform: str
    match: tuple[tuple[str, str], ...]
    arguments: tuple[tuple[str, Any], ...]
    by: str
    mode: str | None = None
    steps: tuple[Step, ...] = ()

    @property
    def key(self) -> str:
        """The choice it decided: its transform and its match, `Dataclass(s=Contact)`."""
        return f"{self.transform}({', '.join(f'{symbol}={path}' for symbol, path in self.match)})"


class _Labels:
    """Each object's path and place, given when a session first sees it: its path in the store (mbse-schemas' `Paths`),
    and a number in the order of its schema's extent then, which orders matches."""

    def __init__(self) -> None:
        self._labels: dict[Any, tuple[str, int]] = {}
        self._counts: dict[str, int] = {}

    def see(self, store: Any, names: Iterable[str]) -> None:
        paths = None
        for name in names:
            for value in store.extent(name):
                if value.identity() not in self._labels:
                    paths = paths or Paths.of(store)
                    self._labels[value.identity()] = (paths.of(value), self._counts.get(name, 0))
                    self._counts[name] = self._counts.get(name, 0) + 1

    def of(self, value: Visitors.Visitable) -> tuple[str, int]:
        return self._labels[value.identity()]


class Session:
    """Applies `transforms` to the data of `store`, one step per decision (see the module's documentation)."""

    def __init__(self, store: Any, transforms: Iterable[Transform], scope: Mapping[str, Visitors.Visitable] | None = None,
                 labels: _Labels | None = None, earlier: Iterable[Step] = ()):
        self.transforms = tuple(transforms)
        problems = [problem for transform in self.transforms for problem in transform.check()]
        if problems:
            raise ValueError("; ".join(problems))
        self.store, self._scope, self._labels = store, dict(scope or {}), labels or _Labels()
        self._earlier = {step.key: step for step in earlier}
        self.steps: list[Step] = []
        self.undecided: list[str] = []
        self._child: tuple[Candidate, Session, str, str, tuple[tuple[str, str], ...]] | None = None
        self._candidates = self._enabled()

    # --- Matches and candidates ---

    def _paths(self, match: Mapping[str, Visitors.Visitable]) -> tuple[tuple[str, str], ...]:
        return tuple((symbol, self._labels.of(value)[0]) for symbol, value in match.items())

    def _enabled(self) -> list[Candidate]:
        evaluate = Predicates.Evaluator(self.store)
        found: list[Candidate] = []
        self.undecided = []
        self._labels.see(self.store, [schema.name for t in self.transforms for schema in t.before.symbols.values()])
        for order, transform in enumerate(self.transforms):
            domains = {name: _options(parameter.type) for name, parameter in transform.parameters.items()}
            finite = [name for name in transform.parameters if domains[name] is not None]
            open_ = tuple(name for name in transform.parameters if domains[name] is None)
            for match in Queries.select(self.store, transform.before, unknown=True):
                if any(match[symbol] is not value for symbol, value in self._scope.items() if symbol in match):
                    continue
                where = ", ".join(f"{symbol}={path}" for symbol, path in self._paths(match))
                before, after = _holds(evaluate, transform.before, match), _holds(evaluate, transform.after, match)
                if before is None or after is None:
                    which = "before" if before is None else "after"
                    self.undecided.append(f"{transform.name!r} at {where}: its {which} is unknown")
                    continue
                if after:
                    continue
                at = [self._labels.of(value)[1] for value in match.values()]
                for values in itertools.product(*(domains[name] for name in finite)):  # type: ignore[misc]
                    rank = tuple(domains[name].index(value) for name, value in zip(finite, values))  # type: ignore[union-attr]
                    found.append(Candidate(transform, dict(match), dict(zip(finite, values)), open_,
                                           key=_key([0 if transform.parameters else 1, order, *at, *rank])))
        return sorted(found, key=lambda candidate: candidate.key)

    def candidates(self, policy: Policy | None = None) -> list[Candidate]:
        """The enabled candidates, ranked: by the policy's score, highest first, then in order."""
        self._closed()
        scored = [replace(c, score=policy.score(c)) if policy is not None else c for c in self._candidates]
        return sorted(scored, key=lambda candidate: -candidate.score)  # stable: in order among equal scores

    def _closed(self) -> None:
        """Records an open composite whose session is done; refuses to go on while it is not."""
        if self._child is None:
            return
        candidate, child, mode, by, paths = self._child
        if not child.done:
            raise ValueError(f"{candidate.transform.name!r} is open: take its steps first")
        self._child = None
        self._finish(candidate, paths, by, mode, tuple(child.steps))

    def _find(self, candidate: Candidate) -> Candidate:
        found = next((c for c in self._candidates if c.same(candidate)), None)
        if found is None:
            raise ValueError(f"{candidate.transform.name!r} is not enabled for that match")
        return found

    # --- Steps ---

    def _finish(self, candidate: Candidate, paths: tuple[tuple[str, str], ...], by: str, mode: str | None,
                steps: tuple[Step, ...]) -> None:
        """Checks that the step established its after, records it, and finds the candidates again."""
        if _holds(Predicates.Evaluator(self.store), candidate.transform.after, candidate.match) is not True:
            where = ", ".join(f"{symbol}={path}" for symbol, path in paths)
            raise ValueError(f"{candidate.transform.name!r} did not establish its after at {where}")
        arguments = tuple((name, candidate.arguments[name]) for name in candidate.transform.parameters)
        step = Step(candidate.transform.name, paths, arguments, by, mode, steps)
        self._earlier.pop(step.key, None)  # decided now, whoever decided it
        self.steps.append(step)
        self._candidates = self._enabled()

    def _apply(self, candidate: Candidate, by: str) -> None:
        if candidate.open:
            raise ValueError(f"{candidate.transform.name!r} has open parameters {list(candidate.open)}")
        if candidate.transform.parts:
            raise TypeError(f"{candidate.transform.name!r} is composite: step in or over it")
        self._find(candidate)
        paths = self._paths(candidate.match)
        candidate.transform.rewrite(self.store, dict(candidate.match), dict(candidate.arguments))  # type: ignore[misc]
        self._finish(candidate, paths, by, None, ())

    def take(self, candidate: Candidate) -> None:
        """Takes a candidate, as the caller decides: applies its rewrite and records the step."""
        self._closed()
        self._apply(candidate, "caller")

    def step_in(self, candidate: Candidate) -> Session:
        """Opens a composite's own session, scoped to its match, for the caller to take its steps."""
        return self._open(candidate, "in", "caller")

    def _open(self, candidate: Candidate, mode: str, by: str) -> Session:
        self._closed()
        if not candidate.transform.parts:
            raise TypeError(f"{candidate.transform.name!r} is not composite: take it")
        if candidate.open:
            raise ValueError(f"{candidate.transform.name!r} has open parameters {list(candidate.open)}")
        self._find(candidate)
        earlier = self._earlier.get(self._key_of(candidate))
        child = Session(self.store, candidate.transform.parts, {**self._scope, **candidate.match}, self._labels,
                        earlier.steps if earlier is not None else ())
        self._child = (candidate, child, mode, by, self._paths(candidate.match))
        return child

    def _key_of(self, candidate: Candidate) -> str:
        return Step(candidate.transform.name, self._paths(candidate.match), (), "").key

    def _reusable(self) -> Candidate | None:
        """The first candidate, in order, that an earlier decision with its key decided, its open parameters answered as
        then."""
        for candidate in self._candidates:
            earlier = self._earlier.get(self._key_of(candidate))
            if earlier is None:
                continue
            values = dict(earlier.arguments)
            if all(name in values and _same(values[name], value) for name, value in candidate.arguments.items()) and all(
                    name in values for name in candidate.open):
                return candidate.answer(**{name: values[name] for name in candidate.open}) if candidate.open else candidate
        return None

    def step_over(self, policy: Policy | None = None) -> bool:
        """Takes one step, as decided before or by the policy, and says whether it took one: the first candidate an
        earlier decision decides (see `earlier`), else the candidate the policy ranks first; a composite as a whole.
        Inside a composite the caller stepped into, it steps there. It takes nothing where no earlier decision applies
        and there is no policy, no clause weighs the first candidate, or the policy cannot answer its open parameters,
        or a composite's own session stops."""
        if self._child is not None and not self._child[1].done:
            return self._child[1].step_over(policy)
        self._closed()
        candidate, by = self._reusable(), "reused"
        if candidate is None:
            ranked = self.candidates(policy) if policy is not None else []
            if not ranked or ranked[0].score <= 0:
                return False
            candidate, by = ranked[0], "policy"
            candidate = candidate.answer(**policy.answers(candidate)) if candidate.open else candidate  # type: ignore[union-attr]
            if candidate.open:
                return False
        if not candidate.transform.parts:
            self._apply(candidate, by)
            return True
        child = self._open(candidate, "over", by)
        child.run(policy)
        if child.done:
            self._closed()
        return True

    @property
    def orphans(self) -> list[Step]:
        """The earlier decisions not taken again whose key no candidate has now: what changed made them moot."""
        keys = {self._key_of(candidate) for candidate in self._candidates}
        return [step for key, step in self._earlier.items() if key not in keys]

    def run(self, policy: Policy | None = None) -> int:
        """Steps over until the session is done, or neither an earlier decision nor the policy decides; the number of
        steps taken."""
        taken = 0
        while not self.done and self.step_over(policy):
            taken += 1
        return taken

    @property
    def done(self) -> bool:
        """Whether no step is left: no composite open, and no candidate."""
        if self._child is not None and self._child[1].done:
            self._closed()
        return self._child is None and not self._candidates

    # --- The trace ---

    def trace(self, store: Any) -> Any:
        """The steps taken, as a `Transforms.Trace` object built in `store` (see `register`)."""
        return Plain.FromPlain(store)(Trace, {"root": "s0", "objects": {"s0": {"steps": [_plain(s) for s in self.steps]}}})


def _native(name: str, value: Any) -> dict[str, Any]:
    if type(value) not in Schemas.NATIVE_TYPES:
        raise TypeError(f"argument {name!r} is not a native value: {value!r}")
    native = Schemas.OfNative.Data(type(value))
    return {native.token.name: native.to_plain(value)}


def _plain(step: Step) -> dict[str, Any]:
    plain: dict[str, Any] = {"transform": step.transform,
                             "match": [{"symbol": symbol, "element": path} for symbol, path in step.match]}
    if step.arguments:
        plain["arguments"] = [{"name": name, "value": _native(name, value)} for name, value in step.arguments]
    plain["by"] = step.by
    if step.mode is not None:
        plain["mode"] = step.mode
    if step.steps:
        plain["steps"] = [_plain(inner) for inner in step.steps]
    return plain


def _text(name: str) -> Schemas.OfProperty.Spec:
    return lambda p: p.name(name).of(lambda t: t.as_native(str))


def _list(name: str, item: Any) -> Schemas.OfProperty.Spec:
    return lambda p: p.name(name).of(lambda t: t.as_indexed(lambda i: i.of(item)))


_Binding = Schemas.OfObject.Builder().properties(_text("symbol"), _text("element")).create()
_Argument = Schemas.OfObject.Builder().properties(_text("name"), lambda p: p.name("value").of(Schemas.Form.Value)).create()
StepSchema = Schemas.OfObject.Builder().properties(
    _text("transform"), _list("match", _Binding), _list("arguments", _Argument), _text("by"), _text("mode")).create()
Schemas.OfObject.Builder(StepSchema).properties(_list("steps", StepSchema)).update()

Trace = Schemas.OfObject.Builder().name(TRACE).ref().properties(_list("steps", StepSchema)).create()
"""The schema of a trace: its steps in order, each its transform's name, its match (each symbol and its object, by its
path, `Shelf/items[0]`), its arguments by name, who decided it (`caller`, `policy` or `reused`), and, for a composite,
whether the caller stepped `in` or `over` it and its own steps."""


def steps(store: Any, trace: Any) -> list[Step]:
    """The steps a `Transforms.Trace` object in `store` holds, as a session took them."""
    plain = Plain.ToPlain(store)(Trace, trace)
    return [_step(step) for step in plain["objects"][plain["root"]]["steps"]]  # type: ignore[index]  # written even if none


def _step(plain: dict[str, Any]) -> Step:
    arguments = tuple((a["name"], _value(a["value"])) for a in plain.get("arguments", []))
    return Step(plain["transform"], tuple((b["symbol"], b["element"]) for b in plain["match"]), arguments, plain["by"],
                plain.get("mode"), tuple(_step(inner) for inner in plain.get("steps", [])))


def _value(plain: dict[str, Any]) -> Any:
    ((token, value),) = plain.items()
    return Schemas.OfNative.resolve(lambda t: t.token("basic", token)).from_plain(value)


@dataclass(frozen=True)
class Diff:
    """What two traces decided differently, by key (a composite's own steps under its key, `Finish(i=...)/Label(i=...)`):
    the steps only the later took, those only the earlier took, and, as pairs, those both took with other arguments."""

    added: tuple[Step, ...]
    removed: tuple[Step, ...]
    changed: tuple[tuple[Step, Step], ...]


def _flat(steps: Iterable[Step], prefix: str = "") -> Iterable[tuple[str, Step]]:
    for step in steps:
        yield prefix + step.key, step
        yield from _flat(step.steps, f"{prefix}{step.key}/")


def _same_arguments(a: Step, b: Step) -> bool:
    return len(a.arguments) == len(b.arguments) and all(
        x[0] == y[0] and _same(x[1], y[1]) for x, y in zip(a.arguments, b.arguments))


def diff(earlier: Iterable[Step], later: Iterable[Step]) -> Diff:
    """What `later` decided differently from `earlier`, in each one's order."""
    before, after = dict(_flat(earlier)), dict(_flat(later))
    return Diff(tuple(step for key, step in after.items() if key not in before),
                tuple(step for key, step in before.items() if key not in after),
                tuple((before[key], step) for key, step in after.items()
                      if key in before and not _same_arguments(before[key], step)))


def register(store: Any) -> Any:
    """Registers the trace's schema in `store`, unless it holds it already; returns the store."""
    if TRACE not in store.names():
        store.register(Trace)
    return store
