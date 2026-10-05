/**
 * The address book the case studies share: its schemas, as mbse-schemas' tutorial builds them, and a store of them.
 *
 * `book()` makes a store of the schemas; `listed(store, ...contacts)` lists contacts in the store's directory, which
 * makes them, and what they reach, the store's data.
 */

import { Proxies, Schemas } from "@mbse/schemas/Framework";

const text = (name: string) => (p: any) => p.name(name).of((t: any) => t.as_native(String));

export const Listed = new Schemas.OfRelation.Builder().name("Listed").links("directory", "contact").create();
export const Phones = new Schemas.OfRelation.Builder().name("Phones").links("owner", "phone")
  .properties(text("label")).unique("owner", "label").create(); // a phone has one owner, under one label
export const Directory = new Schemas.OfObject.Builder().name("Directory").ref().singleton("book.Directory")
  .relations((r: any) => r.name("contacts").of(Listed).me("directory")).create();
export const Contact = new Schemas.OfObject.Builder().name("Contact").ref()
  .properties(text("name"), (p: any) => p.name("age").of((t: any) => t.as_native(BigInt)))
  .relations((r: any) => r.name("directories").of(Listed).me("contact"), (r: any) => r.name("phones").of(Phones).me("owner"))
  .create();
export const Phone = new Schemas.OfObject.Builder().name("Phone").ref().properties(text("number"))
  .relations((r: any) => r.name("owners").of(Phones).me("phone")).create();

/** A store of the address book's schemas. */
export function book(): any {
  const store = new Proxies.OfStore();
  for (const schema of [Directory, Contact, Phone, Listed, Phones]) store.register(schema);
  return store;
}

/** Lists `contacts` in the store's directory: its data is what its singleton directory reaches. */
export function listed(store: any, ...contacts: unknown[]): void {
  const directory = store.singleton("book.Directory");
  for (const contact of contacts) store.Directory(directory).contacts((e: any) => e.contact(contact)).update();
}
