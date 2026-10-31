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

## Invariants when changing code

The conventions every mbse repository shares are stated once in mbse-basis; this file cites them and keeps
only what differs here.

- **Vocabulary**: [VOC-007: property](../mbse-basis/docs/VOCABULARY.md#VOC-007), [VOC-026: schema](../mbse-basis/docs/VOCABULARY.md#VOC-026), [VOC-008: term](../mbse-basis/docs/VOCABULARY.md#VOC-008), [VOC-009: syntax node](../mbse-basis/docs/VOCABULARY.md#VOC-009) and [VOC-002: constraint](../mbse-basis/docs/VOCABULARY.md#VOC-002), each qualified with whose it is where it meets a language's own term ([the vocabulary](../mbse-basis/docs/VOCABULARY.md), its introduction).
- **Documents**: navigation lines, the README opening with why, and what this file holds ([Rules for every document](../mbse-basis/docs/README.md#rules-for-every-document)).
- **Equivalence**: [PRI-028: both implementations change together](../mbse-basis/docs/PRINCIPLES.md#PRI-028), [PRI-037: the same conformance corpora](../mbse-basis/docs/PRINCIPLES.md#PRI-037), [PRI-038: the same cases in both languages](../mbse-basis/docs/PRINCIPLES.md#PRI-038), [PRI-039: 100% coverage of both](../mbse-basis/docs/PRINCIPLES.md#PRI-039) and [PRI-040: deliberate differences listed](../mbse-basis/docs/PRINCIPLES.md#PRI-040), the differences listed in `docs/EQUIVALENCE.md`. Here: regenerate the corpora (Commands) and let CONF-02 compare them; YAML need only read back the same, since mbse-schemas' two YAML writers quote some strings differently.
- **Tests and tutorials**: [PRI-035: tests are notebooks: one suite each, the same case IDs in the same order in both languages](../mbse-basis/docs/PRINCIPLES.md#PRI-035); [PRI-034: tutorials run as tests, committed with their outputs](../mbse-basis/docs/PRINCIPLES.md#PRI-034). `pytest` and `npm run coverage` run `tutorials/` beside `tests/`.
- **The skill**: [PRI-036: every program in a skill is complete and run; fragments are tagged as fragments](../mbse-basis/docs/PRINCIPLES.md#PRI-036), which SKL-02 checks. After editing `skills/mbse-patterns/`, run `skills/sync.sh`; SKL-01 fails until the packaged copies match (the copy [PRI-016: guidance written once](../mbse-basis/docs/PRINCIPLES.md#PRI-016) plans to remove).
- **Work**: [PRI-029: parallel work in polyrepo workspaces](../mbse-basis/docs/PRINCIPLES.md#PRI-029), [PRI-031: the version is the contract](../mbse-basis/docs/PRINCIPLES.md#PRI-031), [PRI-032: a sibling's gap is reported, not worked around](../mbse-basis/docs/PRINCIPLES.md#PRI-032) and [PRI-033: work lands by branch and pull request](../mbse-basis/docs/PRINCIPLES.md#PRI-033).
- **Behavior is decided in mbse-basis items**: the capabilities of [FEA-023: patterns over data](../mbse-basis/docs/features/FEA-023.md), and the transforms' ([CAP-074: transforms applied step by step](../mbse-basis/docs/capabilities/CAP-074.md) to [CAP-083: policies with guards and distributions](../mbse-basis/docs/capabilities/CAP-083.md)), recorded as the basis says ([Detail files](../mbse-basis/docs/README.md#detail-files)).
- **Identities are strings in TypeScript.** mbse-schemas keys objects by `String(identity())`, so a bound class's
  `identity()` must give a string unique to the object, never the object itself.
- Never write to `~/.claude/projects/*/memory/` or any hidden memory: what is worth keeping goes in the repository.

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
```

## Related repositories

- [mbse-schemas](https://github.com/pitaman71/mbse-schemas): the data, its stores and their extents. A sibling
  checkout, `../mbse-schemas`, pinned by version and commit in `siblings.json` (see mbse-basis' `scripts/polyrepo.py`).
- [mbse-expressions](https://github.com/pitaman71/mbse-expressions): the expressions, Basic's evaluator and partial
  evaluator. A sibling checkout, `../mbse-expressions`, pinned in `siblings.json`.
