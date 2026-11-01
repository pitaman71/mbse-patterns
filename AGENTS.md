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
| Know why the mbse repositories exist, and this one's part in them | [MBSE.md](MBSE.md) |
| Use the library: write predicates, validate data, query a store | [skills/mbse-patterns/SKILL.md](skills/mbse-patterns/SKILL.md), a skill. It loads its references only as needed |
| Learn it by example, from a constraint to generated test data | [python3/tutorials/README.md](python3/tutorials/README.md), seven case studies; the same in [typescript5/tutorials/](typescript5/tutorials/README.md) |
| Understand a design decision, a capability not yet built or an open question | mbse-basis [FEA-023: patterns over data](../mbse-basis/docs/features/FEA-023.md) and its capabilities' detail files, and [CAP-074: transforms applied step by step](../mbse-basis/docs/capabilities/CAP-074.md) to [CAP-083: policies with guards and distributions](../mbse-basis/docs/capabilities/CAP-083.md) for transforms |
| Change the package | this file, then [docs/EQUIVALENCE.md](docs/EQUIVALENCE.md) |
| Find or add a test case | [python3/tests/TestPlan.md](python3/tests/TestPlan.md) (TypeScript's plan lists only its differences) |
| Write the constraints themselves | [mbse-expressions' AGENTS.md](https://github.com/pitaman71/mbse-expressions/blob/main/AGENTS.md), in the sibling checkout |
| Model the data | [mbse-schemas' AGENTS.md](https://github.com/pitaman71/mbse-schemas/blob/main/AGENTS.md), in the sibling checkout |

## Read before any work

Agents must read these mbse-basis documents before doing any work:

- [The mbse basis](../mbse-basis/docs/README.md)
- [Principles](../mbse-basis/docs/PRINCIPLES.md)
- [Features](../mbse-basis/docs/features/README.md)
- [Capabilities](../mbse-basis/docs/capabilities/README.md)

These may be read selectively, on demand: [Vocabulary](../mbse-basis/docs/VOCABULARY.md) and
[Qualities](../mbse-basis/docs/QUALITIES.md).

Never write to `~/.claude/projects/*/memory/` or any hidden memory: what is worth keeping goes in the repository.

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

skills/sync.sh                                  # after editing skills/mbse-patterns/: the packaged copies (SKL-01)
```

## Related repositories

- [mbse-schemas](https://github.com/pitaman71/mbse-schemas): the data, its stores and their extents. A sibling
  checkout, `../mbse-schemas`, pinned by version and commit in `siblings.json` (see mbse-basis' `scripts/polyrepo.py`).
- [mbse-expressions](https://github.com/pitaman71/mbse-expressions): the expressions, Basic's evaluator and partial
  evaluator. A sibling checkout, `../mbse-expressions`, pinned in `siblings.json`.
