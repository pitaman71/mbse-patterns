"""The address book the case studies share: its schemas, as mbse-schemas' tutorial builds them, and a store of them.

`book()` makes a store of the schemas; `listed(store, *contacts)` lists contacts in the store's directory, which makes
them, and what they reach, the store's data.
"""

from mbse.Schemas.Framework import Proxies, Schemas


def _text(name):
    return lambda p: p.name(name).of(lambda t: t.as_native(str))


Listed = Schemas.OfRelation.Builder().name("Listed").links("directory", "contact").create()
Phones = (Schemas.OfRelation.Builder().name("Phones").links("owner", "phone")
          .properties(_text("label")).unique("owner", "label").create())  # a phone has one owner, under one label
Directory = (Schemas.OfObject.Builder().name("Directory").ref().singleton("book.Directory")
             .relations(lambda r: r.name("contacts").of(Listed).me("directory")).create())
Contact = (Schemas.OfObject.Builder().name("Contact").ref()
           .properties(_text("name"), lambda p: p.name("age").of(lambda t: t.as_native(int)))
           .relations(lambda r: r.name("directories").of(Listed).me("contact"),
                      lambda r: r.name("phones").of(Phones).me("owner")).create())
Phone = (Schemas.OfObject.Builder().name("Phone").ref().properties(_text("number"))
         .relations(lambda r: r.name("owners").of(Phones).me("phone")).create())


def book():
    """A store of the address book's schemas."""
    store = Proxies.OfStore()
    for schema in (Directory, Contact, Phone, Listed, Phones):
        store.register(schema)
    return store


def listed(store, *contacts):
    """Lists `contacts` in the store's directory: its data is what its singleton directory reaches."""
    directory = store.singleton("book.Directory")
    for contact in contacts:
        store.Directory(directory).contacts(lambda e, contact=contact: e.contact(contact)).update()
