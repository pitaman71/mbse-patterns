# Guide for AI agents

mbse-patterns works over the data of [mbse-schemas](https://github.com/pitaman71/mbse-schemas) with the expressions of
[mbse-expressions](https://github.com/pitaman71/mbse-expressions): predicates (named constraints over symbols bound to a
schema's objects and parameters, kept as data beside the schemas and used by reference), validators that check data
against them, queries that find a store's matches for a predicate, lazily, planned from the constraint's shape, patterns
(predicates whose constraints weigh alternatives and draw values from distributions), and samplers and generators that
draw from them, byte-identically from a seed. Characterizers are planned. Two equivalent implementations exist:
`python3/` and `typescript5/`.

## Start here

| You want to | Read |
|---|---|
| Know why the mbse repositories exist, and this one's part in them | [Why the mbse repositories exist](MBSE.md) |
| Use the library: write predicates, validate data, query a store, generate data, apply transforms | The skill, written once: [its source](skills/mbse-patterns/SKILL.md), packaged in each language as [the Python copy](python3/mbse/Patterns/skill/SKILL.md) and [the TypeScript copy](typescript5/skill/SKILL.md). Each practice links its case in each language's tutorials or tests |
| Learn it by example, from a constraint to generated test data | [Tutorial: constraints, queries and patterns in eight case studies](python3/tutorials/README.md), eight case studies; the same in [typescript5/tutorials/](typescript5/tutorials/README.md) |
| Understand a design decision, a capability not yet built or an open question | mbse-basis [FEA-023: patterns over data](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-023.md) and its capabilities' detail files, and [CAP-074: transforms applied step by step](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-074.md) to [CAP-083: policies with guards and distributions](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/CAP-083.md) for transforms |
| Change the package | this file, then [Equivalence](docs/EQUIVALENCE.md) |
| Find or add a test case | [Test plan](python3/tests/TestPlan.md) (TypeScript's plan lists only its differences) |
| Write the constraints themselves | [mbse-expressions' AGENTS.md](https://github.com/pitaman71/mbse-expressions/blob/main/AGENTS.md), in the sibling checkout |
| Model the data | [mbse-schemas' AGENTS.md](https://github.com/pitaman71/mbse-schemas/blob/main/AGENTS.md), in the sibling checkout |

## Read before any work

Agents must read these mbse-basis documents before doing any work:

- [The mbse basis](https://github.com/pitaman71/mbse-basis/blob/main/docs/README.md)
- [Principles](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md)
- [Features](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/README.md)
- [Capabilities](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md)

These may be read selectively, on demand: [Vocabulary](https://github.com/pitaman71/mbse-basis/blob/main/docs/VOCABULARY.md) and
[Qualities](https://github.com/pitaman71/mbse-basis/blob/main/docs/QUALITIES.md).

Never write to `~/.claude/projects/*/memory/` or any hidden memory: what is worth keeping goes in the repository.

Resolve a link written `mbse:<repo>/<path>`, as skills and source comments write a link into another mbse
repository, to the first of these that exists: in a polyrepo checkout, `<repo root>/../<repo>/<path>`, where `<repo
root>` is this repository's root; for a link into the installed package's own repository, `<path>` without its
language directory (`python3/` or `typescript5/`), under the installed package's root (Python: the `site-packages`
directory that holds `mbse/`; npm: the package's directory), where the package ships that file; otherwise
`https://github.com/pitaman71/<repo>/blob/main/<path>`.

## Commands

```sh
python3 ../mbse-basis/scripts/polyrepo.py clone # mbse-schemas and mbse-expressions, beside this repository, pinned
python3 ../mbse-basis/scripts/polyrepo.py check # the siblings are present and compatible with siblings.json
cd python3 && uv sync --all-extras              # Python: use uv, never pip
uv run coverage run -m pytest && uv run coverage combine && uv run coverage report
uv run python -m mbse.Patterns.Conformance.write

cd typescript5 && nvm use && npm install        # TypeScript: Node 22 or later
npm run coverage                                # type-checks, runs every notebook, gates at 100%
npm run conformance

sh skills/sync.sh                               # after changing the skill: copies it into both packages
```

The skill is written once, in `skills/mbse-patterns/`, mostly language-independent (mbse-basis
[PRI-016: guidance written once](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-016)): each practice says why, when and how, links the items for what, and links each how
to its case in both languages, as `mbse:` links with a `#Tnn.k` anchor (a tutorial step) or a test's case ID. It holds
no programs. `skills/sync.sh` copies it byte for byte into `python3/mbse/Patterns/skill/` and `typescript5/skill/`;
SKL-01 checks the copies in both suites, and SKL-03 that every case it links has its `<a id>` in both languages. Each
tutorial step's markdown cell starts with `<a id="Tnn.k"></a>`, and each test case's with `<a id="ID"></a>`, the same
in both languages. A how the skill teaches with no case is a bug, since it is untested
([the basis](https://github.com/pitaman71/mbse-basis/blob/main/docs/README.md#the-doc-spec)): write the case, in both languages, before linking it.

## Related repositories

- [mbse-schemas](https://github.com/pitaman71/mbse-schemas): the data, its stores and their extents. A sibling
  checkout, `../mbse-schemas`, pinned by version and commit in `siblings.json` (see mbse-basis' `scripts/polyrepo.py`).
- [mbse-expressions](https://github.com/pitaman71/mbse-expressions): the expressions, Basic's evaluator and partial
  evaluator. A sibling checkout, `../mbse-expressions`, pinned in `siblings.json`.
