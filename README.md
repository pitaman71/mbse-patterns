# mbse-patterns

Predicates and queries over [mbse-schemas](https://github.com/pitaman71/mbse-schemas) data, written with the rules of
[mbse-expressions](https://github.com/pitaman71/mbse-expressions). A predicate, such as "a contact is an adult" or "a
contact's phone has a number", is a named rule over symbols, each bound to an object of a schema, kept as data beside
the schemas: stored, sent and validated like any other data. Validators check data against predicates; queries find a
store's matches for a predicate, streaming them lazily, planned from the rule's shape.

```python
from mbse.Expressions.Dialects.Python import Text
from mbse.Patterns import Constraints, Queries, Validators

IsAnAdult = (
    Constraints.OfPredicate.Builder()
    .name("IsAnAdult")
    .description("18 or older")
    .symbols({"the": Contact})
    .rule(Text.FromFunction(lambda the: the.age >= 18))
    .create()
)
Validators.Validate(store, [IsAnAdult]).Reachable(Contact, ann)  # ["the=Contact#0: 'IsAnAdult' is unknown"], say
Queries.select(store, IsAnAdult)                                  # an iterator over the matches: {"the": ann}, ...
```

```typescript
import { Expressions as E } from "@mbse/expressions";
import { Constraints, Queries, Validators } from "@mbse/patterns";

const IsAnAdult = new Constraints.OfPredicate.Builder()
  .name("IsAnAdult")
  .description("18 or older")
  .symbols({ the: Contact })
  .rule(E.variable("the").age.ge(18n))
  .create();
Validators.Validate(store, [IsAnAdult]).Reachable(Contact, ann);
Queries.select(store, IsAnAdult);
```

Patterns (populations of objects: weights over predicates, with distributions of properties and relations),
generators of data from patterns, byte-identical in both languages from a seed, and characterizers that fit patterns
to data are designed ([docs/PATTERNS.md](docs/PATTERNS.md)) for the next releases.

Like its siblings, it has two equivalent implementations, in Python (`mbse.Patterns`) and TypeScript
(`@mbse/patterns`), with the same API, the same messages and byte-identical JSON. Python can also read a rule from a
lambda (`Text.FromFunction`); TypeScript writes rules with mbse-expressions' writers.

## Getting started

mbse-patterns depends on mbse-schemas and mbse-expressions, which live beside it as sibling checkouts. Clone this
repository, then the siblings at the commits it pins (`siblings.json`):

```sh
git clone git@github.com:pitaman71/mbse-patterns.git
python3 mbse-patterns/scripts/siblings.py clone   # mbse-schemas and mbse-expressions, beside it, pinned
cd mbse-patterns
```

`scripts/siblings.py` runs the tool kept in mbse-schemas (cloning mbse-schemas first if it is missing); see
`python3 scripts/siblings.py help` for `check`, `pin`, and workspaces for parallel work.

Python (3.11+, managed with [uv](https://docs.astral.sh/uv/)):

```sh
cd python3 && uv sync --all-extras
uv run coverage run -m pytest && uv run coverage combine && uv run coverage report
```

TypeScript (Node 22 or later):

```sh
cd typescript5 && nvm use && npm install
npm run coverage
```

## Documentation

- [docs/PATTERNS.md](docs/PATTERNS.md): the design, the planned releases and the open questions
- [skills/mbse-patterns/SKILL.md](skills/mbse-patterns/SKILL.md): a skill for AI agents using the package
- [AGENTS.md](AGENTS.md): for agents changing it; [docs/EQUIVALENCE.md](docs/EQUIVALENCE.md): the two implementations
