# mbse-patterns

Constraints and queries over [mbse-schemas](https://github.com/pitaman71/mbse-schemas) data, written with the rules of
[mbse-expressions](https://github.com/pitaman71/mbse-expressions). A constraint, such as "every adult contact has a
phone", is a named rule about one schema's objects, kept as data beside the schemas: stored, sent and validated like any
other data. Validators check data against constraints; queries select a store's objects by a rule, streaming the
matches lazily.

```python
from mbse.Expressions import Expressions as E
from mbse.Patterns import Constraints, Queries, Validators

this = E.variable("this")
rules = Constraints.Set([Constraints.Constraint("Contact", "adult", this.age.ge(18))])
Validators.Validate(store, rules).Reachable(Contact, ann)        # ["Contact#0: 'adult' is unknown"], say
Queries.select(store, "Contact", this.age.ge(E.variable("min")), {"min": 65})   # an iterator over the matches
```

```typescript
import { Expressions as E } from "@mbse/expressions";
import { Constraints, Queries, Validators } from "@mbse/patterns";

const self = E.variable("this");
const rules = new Constraints.Set([new Constraints.Constraint("Contact", "adult", self.age.ge(18n))]);
Validators.Validate(store, rules).Reachable(Contact, ann);
Queries.select(store, "Contact", self.age.ge(E.variable("min")), { min: 65n });
```

Patterns (populations of objects: weights over constraints, with distributions of properties and relations),
generators of data from patterns, byte-identical in both languages from a seed, and characterizers that fit patterns
to data are designed ([docs/PATTERNS.md](docs/PATTERNS.md)) for the next releases.

Like its siblings, it has two equivalent implementations, in Python (`mbse.Patterns`) and TypeScript
(`@mbse/patterns`), with the same API, the same messages and byte-identical JSON.

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
