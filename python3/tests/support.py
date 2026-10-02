"""Shared helpers for the test notebooks. Each notebook runs in its own kernel and makes its own stores."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from mbse.Schemas.Framework import Proxies, Schemas as S


@contextmanager
def raises(*errors: type[BaseException], match: str | None = None) -> Iterator[None]:
    """Asserts that the block raises one of `errors`, optionally with `match` in the message."""
    try:
        yield
    except errors as error:
        if match is not None and match not in str(error):
            raise AssertionError(f"expected {match!r} in {str(error)!r}") from error
        return
    raise AssertionError(f"expected one of {[e.__name__ for e in errors]}")


def native(name: str, kind: type = str) -> Any:
    """Property Spec for a native-typed property."""
    return lambda p: p.name(name).of(lambda t: t.as_native(kind))


# An address book: a directory (the store's root) lists contacts, and contacts own phones, each phone one owner.
Listed = S.OfRelation.Builder().name("Listed").links("directory", "contact").create()
Phones = S.OfRelation.Builder().name("Phones").links("owner", "phone").properties(native("label")).unique(
    "owner", "label").create()  # the phone determines its one entry: its owner and label
Directory = S.OfObject.Builder().name("Directory").ref().singleton("book.Directory").relations(
    lambda r: r.name("contacts").of(Listed).me("directory")).create()
Contact = S.OfObject.Builder().name("Contact").ref().properties(native("name"), native("age", int)).relations(
    lambda r: r.name("directories").of(Listed).me("contact"),
    lambda r: r.name("phones").of(Phones).me("owner")).create()
Phone = S.OfObject.Builder().name("Phone").ref().properties(native("number")).relations(
    lambda r: r.name("owners").of(Phones).me("phone")).create()
BOOK = (Directory, Contact, Phone, Listed, Phones)


def book() -> Proxies.OfStore:
    """A store of the address book's schemas, whose data is what its directory lists."""
    store = Proxies.OfStore()
    for schema in BOOK:
        store.register(schema)
    return store


def listed(store: Any, *contacts: Any) -> None:
    """Lists `contacts` in the store's directory, which makes them, and what they reach, the store's data."""
    directory = store.singleton("book.Directory")
    for contact in contacts:
        store.Directory(directory).contacts(lambda e, c=contact: e.contact(c)).update()


def protocol_problems(instance: Any, protocol: type) -> list[str]:
    """The methods of `protocol` that `instance` lacks."""
    names = [n for n, v in vars(protocol).items() if callable(v) and not n.startswith("_")]
    names += [n for base in protocol.__mro__[1:] if base.__name__ == "Store"
              for n, v in vars(base).items() if callable(v) and not n.startswith("_")]
    return [n for n in sorted(set(names)) if not callable(getattr(instance, n, None))]
