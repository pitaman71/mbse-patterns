"""Constraints: rules about a schema's objects, kept as data beside the schemas.

A `Constraint` is a named Basic rule about the instances of one schema, evaluated with `this` bound to the instance:
"a contact has at least one phone" is `Constraint("Contact", "has-phone", count(entries(this, 'phones')) >= 1)`. A
`Set` gathers constraints, of any schemas, in order. Schemas stay untouched: several sets may constrain one schema, and
a set names schemas by the names a store registers them under.

Constraints and sets are mbse-schemas reference objects, bound to their meta-schemas (`Constraint.Schema`,
`Set.Schema`), so a set is stored, sent and validated like any data. A constraint is its rule's parent through Basic's
own relation `Expressions.Arguments`, as an operation is its arguments'; a set holds its constraints through
`Patterns.Members`, by index. `Builders` is the store of their bound classes and Basic's, so that
`JSON.FromJSON(Builders).Reachable(Set.Schema, text)` reads a set back with its rules; `register(store)` registers the
meta-schemas, and Basic's, in another store.

`validate()` checks constraints statically: a name and a schema name, and a rule that is a core Basic expression whose
only free name is `this`; and, in a set, no two constraints of one schema with the same name. Evaluating constraints is
`Validators`' work, and selecting objects by a rule is `Queries`'.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from mbse.Expressions import Expressions
from mbse.Expressions.Framework import Terms
from mbse.Schemas.Framework import Bindings, Schemas, Visitors

__all__ = ["Constraint", "Set", "Members", "Builders", "register", "check", "CONSTRAINT", "SET", "MEMBERS"]

CONSTRAINT, SET, MEMBERS = "Patterns.Constraint", "Patterns.Set", "Patterns.Members"


def _text(name: str) -> Any:
    return lambda p: p.name(name).of(lambda t: t.as_native(str))


Members = (
    Schemas.OfRelation.Builder().links("set", "constraint").properties(
        lambda p: p.name("index").of(lambda t: t.as_native(int))).create()
)
"""The relation of a set to its constraints, each at its `index` in the set."""


@dataclass(eq=False)
class Constraint:
    """A named rule about the instances of the schema registered as `schema`, with `this` bound to the instance."""

    schema: str
    name: str
    rule: Any
    description: str | None = None

    Schema = Schemas.OfObject.Builder().ref().properties(_text("schema"), _text("name"), _text("description")).relations(
        lambda r: r.name("rule").of(Terms.Arguments).me("parent"),
        lambda r: r.name("sets").of(Members).me("constraint"),
    ).create()

    def __post_init__(self) -> None:
        self.rule = None if self.rule is None else Expressions.OfAny.resolve(self.rule)

    def validate(self) -> list[str]:
        """Static problems: a missing schema name, name or rule, and the rule's problems as a core Basic rule about
        `this`."""
        label = f"constraint {self.name!r} of {self.schema!r}"
        problems = [f"{label}: a constraint needs a {what}" for what, value in (
            ("schema", self.schema), ("name", self.name), ("rule", self.rule)) if not value]
        rule = [] if self.rule is None else self.rule.validate(bound=("this",), core=True)
        return problems + [f"{label}: {problem}" for problem in rule]

    def identity(self) -> Any:
        return id(self)

    def schema_name(self) -> str:
        return CONSTRAINT

    def owner(self) -> None:
        return None

    def accept(self, visitor: Visitors.OfObject) -> None:
        Bindings.accept(_CONSTRAINT, self, visitor)


@dataclass(eq=False)
class Set:
    """Constraints, of any schemas, in order."""

    constraints: tuple[Constraint, ...] = field(default=())

    Schema = Schemas.OfObject.Builder().ref().relations(
        lambda r: r.name("constraints").of(Members).me("set")).create()

    def __post_init__(self) -> None:
        self.constraints = tuple(self.constraints)

    def of(self, schema: str) -> tuple[Constraint, ...]:
        """The constraints of the schema registered as `schema`, in order."""
        return tuple(c for c in self.constraints if c.schema == schema)

    def validate(self) -> list[str]:
        """Every constraint's problems, and each name a schema's constraints share."""
        problems: list[str] = []
        seen: set[tuple[str, str]] = set()
        for constraint in self.constraints:
            problems += constraint.validate()
            if (constraint.schema, constraint.name) in seen:
                problems.append(f"constraint {constraint.name!r} of {constraint.schema!r}: defined twice")
            seen.add((constraint.schema, constraint.name))
        return problems

    def identity(self) -> Any:
        return id(self)

    def schema_name(self) -> str:
        return SET

    def owner(self) -> None:
        return None

    def accept(self, visitor: Visitors.OfObject) -> None:
        Bindings.accept(_SET, self, visitor)


def _linked(entry: Bindings.Entry, link: str, kind: type | tuple[type, ...], what: str) -> Any:
    target = entry.links.get(link)
    if target is None:
        raise ValueError(f"link {link!r} is not set")
    if not isinstance(target, kind):
        raise TypeError(f"{what} must be {'a Basic expression' if what == 'a rule' else 'a constraint'}")
    return target


def _make_constraint(state: Bindings.State) -> Constraint:
    rules = state.entries.get("rule", [])  # none yet while a snapshot is read: its entries come after its objects
    if len(rules) > 1:
        raise ValueError(f"a constraint has one rule, got {len(rules)}")
    rule = _linked(rules[0], "argument", Expressions.DIALECT.classes, "a rule") if rules else None
    values = state.values
    return Constraint(values.get("schema", ""), values.get("name", ""), rule, values.get("description"))


def _make_set(state: Bindings.State) -> Set:
    entries = state.entries.get("constraints", [])
    last = len(entries)
    ordered = sorted(entries, key=lambda e: last if e.properties.get("index") is None else e.properties["index"])
    return Set(tuple(_linked(e, "constraint", Constraint, "a member") for e in ordered))


def _read_constraint(constraint: Constraint) -> Bindings.State:
    values = {"schema": constraint.schema, "name": constraint.name}
    if constraint.description is not None:
        values["description"] = constraint.description
    rule = [] if constraint.rule is None else [Bindings.Entry({"argument": constraint.rule}, {"index": 0})]
    return Bindings.State(values, {"rule": rule})


def _read_set(constraints: Set) -> Bindings.State:
    return Bindings.State({}, {"constraints": [Bindings.Entry({"constraint": c}, {"index": i})
                                                for i, c in enumerate(constraints.constraints)]})


def _assign(make: Any) -> Any:
    def assign(instance: Any, state: Bindings.State) -> Any:
        made = make(state)
        instance.__dict__.update(made.__dict__)
        return instance
    return assign


_CONSTRAINT = Bindings.Binding(Constraint.Schema, _read_constraint, _make_constraint, _assign(_make_constraint),
                               implied=["sets"])
_SET = Bindings.Binding(Set.Schema, _read_set, _make_set, _assign(_make_set))

_SCHEMAS = {CONSTRAINT: Constraint.Schema, SET: Set.Schema, MEMBERS: Members}


def _basic() -> dict[str, tuple[Schemas.OfObject.Data, Any]]:
    """Basic's kinds, as `Bindings.OfStore` takes them."""
    dialect = Expressions.DIALECT
    return {kind.NAME: (kind.Schema, dialect.builders[kind.KIND]) for kind in dialect.classes}  # type: ignore[attr-defined]


Builders = Bindings.OfStore(
    {SET: (Set.Schema, lambda instance=None: Bindings.Builder(_SET, instance)),
     CONSTRAINT: (Constraint.Schema, lambda instance=None: Bindings.Builder(_CONSTRAINT, instance)), **_basic()},
    {Terms.ARGUMENTS: Terms.Arguments, MEMBERS: Members})
"""A store of constraints, sets and Basic's expressions, as their bound classes: what snapshots of sets are read into."""


def register(store: Any) -> Any:
    """Registers the meta-schemas of constraints and sets, and Basic's, in `store` (e.g. a `Proxies.OfStore`), skipping
    those it already holds. Returns the store."""
    Expressions.DIALECT.register(store)
    for name, schema in _SCHEMAS.items():
        if name not in store.names():
            store.register(name, schema)
    return store


def check(constraints: Iterable[Constraint] | Set) -> Set:
    """A set of `constraints`, raising `ValueError` with every problem `validate()` reports."""
    result = constraints if isinstance(constraints, Set) else Set(tuple(constraints))
    problems = result.validate()
    if problems:
        raise ValueError("; ".join(problems))
    return result
