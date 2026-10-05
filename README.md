# mbse-patterns

`mbse-patterns` makes a specification's rules about populations of data executable: which combinations of objects
are valid, which must or mustn't be linked, and what realistic data looks like. One predicate checks implementations'
data, finds it, and generates test data, so the specification is also the test oracle and the fixture, instead of rules
copied into validation code, queries and test fixtures. It is part of the mbse repositories'
[executable specifications](MBSE.md).

Predicates and queries over [mbse-schemas](https://github.com/pitaman71/mbse-schemas) data, written with the rules of
[mbse-expressions](https://github.com/pitaman71/mbse-expressions). A predicate, such as "a contact is an adult" or "a
contact's phone has a number", is a named rule over symbols, each bound to an object of a schema, kept as data beside
the schemas: stored, sent and validated like any other data. Validators check data against predicates; queries find a
store's matches for a predicate, streaming them lazily, planned from the rule's shape.

```python
from mbse.Expressions import Expressions as E
from mbse.Expressions.Dialects.Python import Text
from mbse.Patterns import Predicates, Queries, Validators

IsAnAdult = (
    Predicates.OfPredicate.Builder()
    .name("IsAnAdult")
    .description("18 or older")
    .symbols({"the": Contact})
    .requires(Text.FromFunction(lambda the: the.age >= 18))
    .create()
)
c, p = E.variable("c"), E.variable("p")
HasAPhone = (
    Predicates.OfPredicate.Builder()
    .name("HasAPhone")
    .symbols({"c": Contact})
    .requires(Predicates.Exists(lambda q: q.symbols({"p": Phone}).requires(
        Predicates.Contains(c.phones, lambda e: e.phone == p))))
    .create()
)
Validators.Validate(store, [IsAnAdult, HasAPhone]).Reachable(Contact, ann)  # ["the=Contact#0: 'IsAnAdult' is unknown"], say
Queries.select(store, IsAnAdult)                                             # an iterator over the matches: {"the": ann}, ...
```

```typescript
import { Expressions as E } from "@mbse/expressions";
import { Predicates, Queries, Validators } from "@mbse/patterns";

const IsAnAdult = new Predicates.OfPredicate.Builder()
  .name("IsAnAdult")
  .description("18 or older")
  .symbols({ the: Contact })
  .requires(E.variable("the").age.ge(18n))
  .create();
const [c, p] = [E.variable("c"), E.variable("p")];
const HasAPhone = new Predicates.OfPredicate.Builder()
  .name("HasAPhone")
  .symbols({ c: Contact })
  .requires(Predicates.Exists((q) => q.symbols({ p: Phone }).requires(
    Predicates.Contains(c.phones, (e) => e.phone.eq(p)))))
  .create();
Validators.Validate(store, [IsAnAdult, HasAPhone]).Reachable(Contact, ann);
Queries.select(store, IsAnAdult);
```

A pattern is a predicate whose rule weighs alternatives (`Distributions.Choices`) and draws values from distributions
(uniform, normal, Poisson, geometric, categorical); a sampler draws a store's matches by weight, and a generator builds
new data, redrawing until the predicate holds, byte-identical in both languages from a seed. Characterizers that fit distributions to data are designed
([docs/PATTERNS.md](docs/PATTERNS.md)) for the next release.

Like its siblings, it has two equivalent implementations, in Python (`mbse.Patterns`) and TypeScript
(`@mbse/patterns`), with the same API, the same messages and byte-identical JSON. Python can also read a rule from a
lambda (`Text.FromFunction`), as `Contains` reads its condition; TypeScript writes rules with mbse-expressions'
writers, and calls `Contains`'s condition with a variable.

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

- Tutorials, seven case studies that build from a rule to generated test data: [Python](python3/tutorials/README.md)
  and [TypeScript](typescript5/tutorials/README.md)
- [docs/PATTERNS.md](docs/PATTERNS.md): the design, the planned releases and the open questions
- [skills/mbse-patterns/SKILL.md](skills/mbse-patterns/SKILL.md): a skill for AI agents using the package
- [AGENTS.md](AGENTS.md): for agents changing it; [docs/EQUIVALENCE.md](docs/EQUIVALENCE.md): the two implementations
