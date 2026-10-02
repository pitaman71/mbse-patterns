/** This implementation's conformance snapshots, as text: `render()` maps each file name to its contents. */

import { JSON as SchemaJSON, YAML } from "@mbse/schemas/Framework";

import { build } from "./Corpus.js";

/** File name -> text for every case, as this implementation writes them. Pass an already built corpus to reuse it. */
export function render(corpus: ReturnType<typeof build> = build()): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, [schema, root, store]] of corpus) {
    files.set(`${name}.json`, SchemaJSON.ToJSON(store).Reachable(schema, root, { indent: 2 }) + "\n");
    files.set(`${name}.yaml`, YAML.ToYAML(store).Reachable(schema, root));
  }
  return files;
}
