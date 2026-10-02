/** Shared helpers for the test notebooks. Each notebook runs in its own process and makes its own stores. */

import { Proxies, Schemas as S } from "@mbse/schemas/Framework";

/** Python's `assert`. */
export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(`AssertionError: ${message}`);
}

/** Asserts that `block` throws one of `errors`, optionally with `match` in the message. */
export function raises(errors: Function | Function[], block: () => unknown, match?: string): void {
  const expected = Array.isArray(errors) ? errors : [errors];
  try {
    block();
  } catch (error) {
    if (!expected.some((e) => error instanceof (e as new () => unknown))) throw error;
    if (match !== undefined && !String((error as Error).message).includes(match)) {
      throw new Error(`AssertionError: expected ${JSON.stringify(match)} in ${JSON.stringify((error as Error).message)}`);
    }
    return;
  }
  throw new Error(`AssertionError: expected one of ${expected.map((e) => e.name).join(", ")}`);
}

/** Whether two sequences hold the same items, in order. */
export function same(a: Iterable<unknown>, b: Iterable<unknown>): boolean {
  const [x, y] = [[...a], [...b]];
  return x.length === y.length && x.every((item, i) => item === y[i]);
}

/** Whether two plain values are equal, as Python's `==` compares them: records, arrays and natives. */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const [x, y] = [Object.entries(a), Object.entries(b)];
    return x.length === y.length && x.every(([k, v]) => k in b && equal(v, (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** Property Spec for a native-typed property. */
export function native(name: string, kind: unknown = String) {
  return (p: any) => p.name(name).of((t: any) => t.as_native(kind));
}

// An address book: a directory (the store's root) lists contacts, and contacts own phones, each phone one owner.
export const Listed = new S.OfRelation.Builder().name("Listed").links("directory", "contact").create();
export const Phones = new S.OfRelation.Builder().name("Phones").links("owner", "phone").properties(native("label")).unique(
  "owner", "label").create(); // the phone determines its one entry: its owner and label
export const Directory = new S.OfObject.Builder().name("Directory").ref().singleton("book.Directory").relations(
  (r: any) => r.name("contacts").of(Listed).me("directory")).create();
export const Contact = new S.OfObject.Builder().name("Contact").ref().properties(native("name"), native("age", BigInt)).relations(
  (r: any) => r.name("directories").of(Listed).me("contact"),
  (r: any) => r.name("phones").of(Phones).me("owner")).create();
export const Phone = new S.OfObject.Builder().name("Phone").ref().properties(native("number")).relations(
  (r: any) => r.name("owners").of(Phones).me("phone")).create();
export const BOOK = [Directory, Contact, Phone, Listed, Phones];

/** A store of the address book's schemas, whose data is what its directory lists. */
export function book(): any {
  const store = new Proxies.OfStore();
  for (const schema of BOOK) store.register(schema);
  return store;
}

/** Lists `contacts` in the store's directory, which makes them, and what they reach, the store's data. */
export function listed(store: any, ...contacts: unknown[]): void {
  const directory = store.singleton("book.Directory");
  for (const contact of contacts) store.Directory(directory).contacts((e: any) => e.contact(contact)).update();
}

const STORE = ["builder", "extent", "member", "name_of", "names", "registered", "schema", "singleton"];

/** The methods of a queryable store that `instance` lacks. */
export function protocol_problems(instance: object): string[] {
  return [...STORE, "select"].filter((name) => !(name in instance && typeof (instance as any)[name] === "function"));
}
