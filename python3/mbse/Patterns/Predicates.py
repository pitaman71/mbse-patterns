"""Predicates: named rules over a store's objects, and the predicate algebra they are written in.

A predicate is a named rule over symbols, each bound to an object of a schema; it applies to a *match*, a binding of
every symbol to an object of its schema. It is built as schemas are, by a fluent builder finalized by `create()`,
`clone()` or `update()`, none of which validates:

    c, p = E.variable("c"), E.variable("p")
    HasAPhone = (
        Predicates.Builder()
        .name("HasAPhone")
        .symbols({"c": Contact})
        .requires(Predicates.Exists(lambda q: q.symbols({"p": Phone}).requires(
            Predicates.Contains(c.phones, lambda e: e.phone == p))))
        .create()
    )

`.requires(spec)` adds a condition, and `.forbids(spec)` the condition that `spec` does not hold; a predicate's rule is
their conjunction. A condition is any spec of the algebra: a term below, a writer, or what `Python.Text.FromFunction`
reads from a function, such as `FromFunction(lambda c: c.age >= 18)`. Its free names are the symbols, written as Basic
variables (`E.variable("c")`) of the same names. A predicate without symbols is a statement about the whole store.

The algebra, `DIALECT`, extends mbse-expressions' Basic with terms about a store's data, each a data class with a
builder, so a term is built as a predicate is, by a spec (data, or a callable taking the builder):

- `Exists(spec)` and `Forall(spec)`: whether some, or every, binding of the builder's `.symbols({...})` to objects of
  their schemas satisfies its `.requires(...)` and `.forbids(...)` (several symbols are their cross product);
- `Contains(c.phones, lambda e: e.phone == p)`: whether one of `c`'s entries in its adjacency `phones` satisfies the
  condition, read from the function, with its parameter bound to the entry: the targets of the entry's other links, and
  its property values, by name. It is Basic's `any` over `entries(c, 'phones')`;
- `Choice(lambda ch: ch.option(0.35, spec).option(0.65, spec))`: a weighted disjunction, which holds when any of its
  options holds; the weights, positive and summing to 1, are how often a generator chooses each option, and what a
  characterizer estimates.

So mandatory, possible and forbidden links are predicates:

    owns = Predicates.Exists(lambda q: q.symbols({"p": Phone}).requires(
        Predicates.Contains(c.phones, lambda e: e.phone == p)))
    mandatory = Predicates.Builder().name("Mandatory").symbols({"c": Contact}).requires(owns).create()
    forbidden = Predicates.Builder().name("Forbidden").symbols({"c": Contact}).forbids(owns).create()
    possible = Predicates.Builder().name("Possible").symbols({"c": Contact}).requires(
        Predicates.Choice(lambda ch: ch.option(0.35, owns).option(0.65, E.operation("not", owns)))).create()

A quantifier ranges over its schema's extent in the store (its `extent` term: what the store's singletons reach).
`DIALECT` validates the trees that mix the algebra's terms with Basic's; `Evaluator(store)` evaluates them, with the store
giving extents, and Basic's three-valued rules for everything else.

Predicates are mbse-schemas reference objects with a meta-schema, `Patterns.Predicate`: a symbol's schema is written as
a property's type is, by its name or inline, and a predicate is its rule's parent through Basic's relation
`Expressions.Arguments`. `Constraints` gathers predicates in sets, and reads and writes them.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from mbse.Expressions import Domains as BasicDomains, Evaluators as Basic, Expressions as E
from mbse.Expressions.Dialects.Python import Text
from mbse.Expressions.Framework import Evaluators as F, Terms
from mbse.Schemas.Framework import Bindings, Modules, Schemas, Stores, Visitors

__all__ = ["DIALECT", "Builder", "OfPredicate", "Exists", "Forall", "Contains", "Choice", "Members", "Evaluator",
           "holds", "OfExtent", "OfForall", "OfExists", "OfChoice", "OfOption", "PREDICATE", "MEMBERS"]

PREDICATE, MEMBERS = "Patterns.Predicate", "Patterns.Members"


def _schema_name(schema: Any) -> str:
    name = schema if isinstance(schema, str) else getattr(schema, "name", None)
    if not isinstance(name, str):
        raise TypeError(f"expected a named schema or its name, got {schema!r}")
    return name


def _conjunction(conditions: list[Any]) -> Any:
    """The conditions' conjunction, left to right; None if there are none."""
    rule = None
    for condition in conditions:
        rule = condition if rule is None else E.operation("and", rule, condition).data
    return rule


def _negation(spec: Any) -> Any:
    return E.operation("not", DIALECT.resolve(spec)).data


# --- Terms ---


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
    collection: Any = None  # an extent
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


# --- Builders ---


class _QuantifiedBuilder(Terms.Builder):
    """Builds a quantifier. DSL: `.symbols({name: schema})`, each schema a named schema or its name, added to those
    already given, and `.requires(spec)` and `.forbids(spec)`, which add conditions to the body. The first symbol is
    this quantifier's; each other is a quantifier of the same kind in the body, within which the conditions hold. As
    a `Visitors.OfObject`, the collection is the `arguments` entry with index 0 and the body the one with index 1."""

    def __init__(self, instance: Any = None):
        super().__init__(instance)
        self._inner: dict[str, str] = {}
        self._conditions: list[Any] = []

    def symbols(self, symbols: Mapping[str, Any]) -> Any:
        for name, schema in symbols.items():
            if "name" in self.state.values or self._inner:
                self._inner[name] = _schema_name(schema)
            else:
                self.set("name", name).argument("collection", OfExtent(_schema_name(schema)))
        return self

    def requires(self, spec: Any) -> Any:
        self._conditions.append(DIALECT.resolve(spec))
        return self

    def forbids(self, spec: Any) -> Any:
        self._conditions.append(_negation(spec))
        return self

    def _fold(self) -> None:
        """Writes the pending symbols and conditions into the body."""
        if not (self._inner or self._conditions):
            return
        body = next((entry.links.get("argument") for entry in self.state.entries.get("arguments", [])
                     if entry.properties.get("index") == 1), None)
        body = _conjunction([*([] if body is None else [body]), *self._conditions])
        for name, schema in reversed(self._inner.items()):
            body = self._data(name, OfExtent(schema), body)  # type: ignore[call-arg]
        self._inner, self._conditions = {}, []
        self.argument("body", body)

    def create(self) -> Any:
        self._fold()
        return super().create()

    def clone(self) -> Any:
        self._fold()
        return super().clone()

    def update(self) -> Any:
        self._fold()
        return super().update()


class _ForallBuilder(_QuantifiedBuilder):
    _data = OfForall


class _ExistsBuilder(_QuantifiedBuilder):
    _data = OfExists


class _ChoiceBuilder(Terms.Builder):
    """Builds a choice. DSL: `.option(weight, spec)` adds an option."""

    _data = OfChoice

    def option(self, weight: float, spec: Any) -> _ChoiceBuilder:
        return self.arguments(OfOption(float(weight), DIALECT.resolve(spec)))


class _OptionBuilder(Terms.Builder):
    """Builds an option. DSL: `.weight(float)` and `.body(spec)`."""

    _data = OfOption

    def weight(self, weight: float) -> _OptionBuilder:
        return self.set("weight", float(weight))

    def body(self, spec: Any) -> _OptionBuilder:
        return self.argument("body", spec)


class _ExtentBuilder(Terms.Builder):
    """Builds an extent. DSL: `.schema(schema)`, a named schema or its name."""

    _data = OfExtent

    def schema(self, schema: Any) -> _ExtentBuilder:
        return self.set("schema", _schema_name(schema))


_KINDS = (OfExtent, OfForall, OfExists, OfChoice, OfOption)
_BUILDERS = (_ExtentBuilder, _ForallBuilder, _ExistsBuilder, _ChoiceBuilder, _OptionBuilder)

DIALECT = Terms.Declared(
    "Predicates", _KINDS, domain_of=BasicDomains.of, extends=E.DIALECT,
    builders={kind.KIND: builder for kind, builder in zip(_KINDS, _BUILDERS)},
    schema_names={kind.KIND: f"Patterns.Of{kind.KIND.capitalize()}" for kind in _KINDS},
)
"""The predicate algebra: Basic's kinds, and the kinds above."""

for _kind, _builder in zip(_KINDS, _BUILDERS):
    _kind.Builder = _builder  # type: ignore[attr-defined]


def Exists(spec: Any) -> OfExists:
    """Whether some binding of the symbols satisfies the conditions: `Exists(lambda q: q.symbols({...}).requires(...))`."""
    return Terms.resolve(spec, OfExists, _ExistsBuilder, "an exists")


def Forall(spec: Any) -> OfForall:
    """Whether every binding of the symbols satisfies the conditions: `Forall(lambda q: q.symbols({...}).requires(...))`."""
    return Terms.resolve(spec, OfForall, _ForallBuilder, "a forall")


def Choice(spec: Any) -> OfChoice:
    """A weighted disjunction: `Choice(lambda ch: ch.option(0.35, p).option(0.65, q))` holds when `p` or `q` does."""
    return Terms.resolve(spec, OfChoice, _ChoiceBuilder, "a choice")


def Contains(adjacency: Any, condition: Callable[[Any], Any]) -> E.OfQuantifier.Data:
    """Whether one of an object's entries in an adjacency, written `c.phones`, satisfies `condition`, a function of one
    entry read as `Python.Text.FromFunction` reads it: Basic's `any(e in entries(c, 'phones'), ...)`."""
    collection = E.OfAny.resolve(adjacency)
    if not (isinstance(collection, E.OfOperation.Data) and collection.name == "get" and len(collection.arguments) == 2
            and isinstance(collection.arguments[1], E.OfLiteral.Data) and type(collection.arguments[1].value) is str):
        raise TypeError("Contains expects an object's adjacency, such as c.phones")
    code = getattr(condition, "__code__", None)
    if code is None or code.co_argcount != 1:
        raise TypeError("Contains expects a function of one entry")
    entries = E.operation("entries", collection.arguments[0], collection.arguments[1].value)
    return E.quantifier("any", code.co_varnames[0], entries, Text.FromFunction(condition)).data


# --- Predicates ---


@dataclass(eq=False)
class _PredicateData:
    """A named rule over symbols, each bound to an object of its schema in a match."""

    name: str | None = None
    description: str | None = None
    symbols: dict[str, Any] = field(default_factory=dict)  # symbol -> schema
    rule: Any = None  # an expression of the predicate algebra

    def validate(self) -> list[str]:
        label = f"predicate {self.name!r}"
        problems = [f"{label}: a predicate needs a {what}" for what, value in (("name", self.name), ("rule", self.rule))
                    if value is None]
        for symbol, schema in self.symbols.items():
            if not (isinstance(schema, Schemas.OfObject.Data) and schema.ref and schema.name is not None):
                problems.append(f"{label}: symbol {symbol!r} needs a named reference object schema")
        rule = [] if self.rule is None else DIALECT.validate(self.rule, bound=tuple(self.symbols), core=True)
        return problems + [f"{label}: {problem}" for problem in rule]

    def identity(self) -> Any:
        return id(self)

    def schema_name(self) -> str:
        return PREDICATE

    def owner(self) -> None:
        return None

    def accept(self, visitor: Visitors.OfObject) -> None:
        Bindings.accept(_BINDING, self, visitor)


class _PredicateBuilder:
    """Builds a predicate, as mbse-schemas' builders build. DSL: `.name(str)`, `.description(str)`,
    `.symbols({name: schema})`, added to those already given, in order, and `.requires(spec)` and `.forbids(spec)`,
    which add conditions to the rule."""

    def __init__(self, instance: _PredicateData | None = None):
        self._source = instance
        self._fields: dict[str, Any] = {} if instance is None else {**vars(instance), "symbols": dict(instance.symbols)}

    def name(self, name: str) -> _PredicateBuilder:
        self._fields["name"] = name
        return self

    def description(self, text: str) -> _PredicateBuilder:
        self._fields["description"] = text
        return self

    def symbols(self, symbols: Mapping[str, Any]) -> _PredicateBuilder:
        """Symbols by name, each with the schema of the objects it binds, in order; added to those already given."""
        self._fields["symbols"] = {**self._fields.get("symbols", {}), **symbols}
        return self

    def requires(self, spec: Any) -> _PredicateBuilder:
        """Adds a condition: a spec of the algebra whose free names are the symbols."""
        self._fields["rule"] = _conjunction([*(r for r in [self._fields.get("rule")] if r is not None), DIALECT.resolve(spec)])
        return self

    def forbids(self, spec: Any) -> _PredicateBuilder:
        """Adds the condition that `spec` does not hold."""
        return self.requires(_negation(spec))

    def create(self) -> _PredicateData:
        """A new predicate. Only valid without a source instance."""
        if self._source is not None:
            raise ValueError("create() is only valid without a source instance; use clone() or update()")
        return _PredicateData(**self._fields)

    def clone(self) -> _PredicateData:
        """A new predicate, leaving the source instance untouched. Only valid with a source instance."""
        if self._source is None:
            raise ValueError("clone() is only valid with a source instance")
        return _PredicateData(**self._fields)

    def update(self) -> _PredicateData:
        """Writes the builder's state into the source instance and returns it. Only valid with a source instance."""
        if self._source is None:
            raise ValueError("update() is only valid with a source instance")
        vars(self._source).update(self._fields)
        return self._source


def _text(name: str) -> Any:
    return lambda p: p.name(name).of(lambda t: t.as_native(str))


Members = (
    Schemas.OfRelation.Builder().name(MEMBERS).links("set", "predicate").properties(
        lambda p: p.name("index").of(lambda t: t.as_native(int))).create()
)
"""The relation of a set to its predicates, each at its `index` in the set."""


class OfPredicate:
    """A predicate: `Data`, its `Builder` and its meta-schema `Schema`."""

    Data = _PredicateData
    Builder = _PredicateBuilder
    Spec = _PredicateData | Callable[[_PredicateBuilder], _PredicateBuilder]
    Schema = Schemas.OfObject.Builder().name(PREDICATE).ref().properties(
        _text("name"), _text("description"),
        lambda p: p.name("symbols").of(lambda t: t.as_indexed(lambda i: i.of(Schemas.OfProperty.Schema)))).relations(
        lambda r: r.name("rule").of(Terms.Arguments).me("parent"),
        lambda r: r.name("sets").of(Members).me("predicate")).create()

    @staticmethod
    def resolve(spec: OfPredicate.Spec) -> _PredicateData:
        if isinstance(spec, _PredicateData):
            return spec
        if not callable(spec):
            raise TypeError(f"expected a predicate or a callable taking its builder, got {spec!r}")
        return spec(_PredicateBuilder()).create()


Builder = _PredicateBuilder
"""`Predicates.Builder()` builds a predicate: `OfPredicate.Builder`."""


def target(entry: Bindings.Entry, link: str, kind: Any, what: str) -> Any:
    """The target of an entry's link, which must be a `kind`."""
    found = entry.links.get(link)
    if found is None:
        raise ValueError(f"link {link!r} is not set")
    if not isinstance(found, kind):
        raise TypeError(f"{what} must be {'an expression' if what == 'a rule' else 'a predicate'}")
    return found


def _read(predicate: _PredicateData) -> Bindings.State:
    """A predicate's state, as `Bindings` reads it."""
    values: dict[str, Any] = {name: getattr(predicate, name) for name in ("name", "description")
                              if getattr(predicate, name) is not None}
    if predicate.symbols:
        values["symbols"] = [{"name": symbol, "type": Modules.reference(schema)}
                             for symbol, schema in predicate.symbols.items()]
    rule = [] if predicate.rule is None else [Bindings.Entry({"argument": predicate.rule}, {"index": 0})]
    return Bindings.State(values, {"rule": rule})


def _make(store: Stores.Store, state: Bindings.State) -> _PredicateData:
    """The predicate a state describes, its symbols' schemas resolved by name in `store`."""
    rules = state.entries.get("rule", [])  # none yet while a snapshot is read: its entries come after its objects
    if len(rules) > 1:
        raise ValueError(f"a predicate has one rule, got {len(rules)}")
    rule = target(rules[0], "argument", DIALECT.terms(), "a rule") if rules else None
    symbols = {symbol["name"]: Modules.resolve(store, symbol["type"]) for symbol in state.values.get("symbols", [])}
    return _PredicateData(state.values.get("name"), state.values.get("description"), symbols, rule)


def binding(store: Stores.Store) -> Bindings.Binding:
    """The binding of predicates to their meta-schema, reading symbols' schemas by name in `store`."""
    def assign(instance: Any, state: Bindings.State) -> Any:
        vars(instance).update(vars(_make(store, state)))
        return instance
    return Bindings.Binding(OfPredicate.Schema, _read, lambda state: _make(store, state), assign, implied=["sets"])


_BINDING = binding(Stores.Catalog())


# --- Evaluation ---


class Evaluator:
    """Evaluates predicates over `store`: Basic's rules, with extents from the store. Extents are read once per
    evaluator, so an evaluator sees the store as it was when first asked."""

    def __init__(self, store: Stores.Store):
        self.store = store
        self._extents: dict[str, tuple[Any, ...]] = {}
        self.interpreter = F.Interpreter(DIALECT, {
            "operation": Basic.OPERATIONS, "quantifier": Basic.QUANTIFIERS,
            "extent": self._extent, "forall": Basic.QUANTIFIERS["all"], "exists": Basic.QUANTIFIERS["any"],
            "choice": _choice, "option": lambda thunks, node, scope: thunks[0](),
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
