# Guide for AI agents

mbse-patterns works over the data of [mbse-schemas](https://github.com/pitaman71/mbse-schemas) with the rules of
[mbse-expressions](https://github.com/pitaman71/mbse-expressions): predicates (named rules over symbols bound to a
schema's objects and parameters, kept as data beside the schemas and used by reference), validators that check data
against them, queries that find a store's matches for a predicate, lazily, planned from the rule's shape, patterns
(predicates whose rules weigh alternatives and draw values from distributions), and samplers and generators that draw
from them, byte-identically from a seed. Characterizers are planned. Two equivalent implementations exist: `python3/`
and `typescript5/`.

## Start here

| You want to | Read |
|---|---|
| Know why the mbse repositories exist, and this one's part in them | [MBSE.md](MBSE.md) |
| Use the library: write predicates, validate data, query a store | [skills/mbse-patterns/SKILL.md](skills/mbse-patterns/SKILL.md), a skill. It loads its references only as needed |
| Learn it by example, from a rule to generated test data | [python3/tutorials/README.md](python3/tutorials/README.md), seven case studies; the same in [typescript5/tutorials/](typescript5/tutorials/README.md) |
| Understand a design rule, a planned release or an open question | [docs/PATTERNS.md](docs/PATTERNS.md), by section |
| Change the package | this file, then [docs/EQUIVALENCE.md](docs/EQUIVALENCE.md) |
| Find or add a test case | [python3/tests/TestPlan.md](python3/tests/TestPlan.md) (TypeScript's plan lists only its differences) |
| Write the rules themselves | [mbse-expressions' AGENTS.md](https://github.com/pitaman71/mbse-expressions/blob/main/AGENTS.md), in the sibling checkout |
| Model the data | [mbse-schemas' AGENTS.md](https://github.com/pitaman71/mbse-schemas/blob/main/AGENTS.md), in the sibling checkout |

## Invariants when changing code

- **One vocabulary across the mbse repositories.** A kind's or schema's named members are *properties*, never
  "fields" (a field is only the host language's class member that holds one). An element of an expression tree is
  a *term* (mbse-expressions), and of a program tree a *syntax node* (mbse-programs); never a bare "node" in code,
  docs or messages.
- **The README opens with why.** Its first sentence or paragraph says, TL;DR style, why this repository exists, in
  the terms of `MBSE.md`; what it is comes after. Keep that opening true as the repository changes.
- **Every human-facing document has navigation.** A `{previous, home, next}` line heads and ends each document in
  reading order (README, MBSE.md, tutorials, design, conformance, packages and test plans); after adding, renaming or
  retitling one, run `python3 ../mbse-schemas/scripts/nav.py .`. Link text is human-readable, never a path.
- **Parallel work happens in workspaces.** Agents working at the same time each get a workspace from
  `python3 scripts/siblings.py workspace <dir> --branch <name>` (with `--edit <sibling>` for a change that spans
  repositories), install there, and `land` it when done. A worktree of this repository alone, such as an agent's
  built-in worktree isolation, breaks the relative paths to the siblings.
- **The two implementations are equivalent.** Change both in the same commit, with the same names, the same error
  classes and byte-identical messages. JSON output must be byte-identical: regenerate the corpora and let CONF-02
  compare them (YAML need only read back the same; mbse-schemas' two YAML writers quote some strings differently). A difference not listed in `docs/EQUIVALENCE.md` is a bug.
- **Tutorials are tested too.** `pytest` and `npm run coverage` run `tutorials/` beside `tests/`; the two languages
  tell the same case studies with the same outputs. Re-execute a tutorial after a change that alters its output, and
  commit it with its outputs.
- **Tests are Jupyter notebooks**, one suite per notebook, with the same case IDs in the same order in both
  languages. Each case is a markdown cell `## ID · title` followed by one code cell. Notebooks are JSON written with
  `indent=1`, `sort_keys=True` and `ensure_ascii=False`.
- **Coverage is 100%** in both languages (statements and branches; in TypeScript also functions and lines). Close a gap
  with an assertion in the shared case, in both suites.
- **Identities are strings in TypeScript.** mbse-schemas keys objects by `String(identity())`, so a bound class's
  `identity()` must give a string unique to the object, never the object itself.
- **The skill is packaged with each implementation.** After editing `skills/mbse-patterns/`, run `skills/sync.sh`;
  SKL-01 fails until the copies match. Every fenced block tagged `python` or `typescript` in the skill is a complete
  program that SKL-02 runs; tag fragments `python fragment` or `typescript fragment`.
- **Behavior is decided in `docs/PATTERNS.md`.** Record new decisions under Resolved, and put what stays undecided
  under Open questions.

## Commands

```sh
python3 scripts/siblings.py clone            # mbse-schemas and mbse-expressions, beside this repository, pinned
python3 scripts/siblings.py check            # the siblings are present and compatible with siblings.json
cd python3 && uv sync --all-extras           # Python: use uv, never pip
uv run coverage run -m pytest && uv run coverage combine && uv run coverage report
uv run python -m mbse.Patterns.Conformance.write

cd typescript5 && nvm use && npm install     # TypeScript: Node 22 or later
npm run coverage                             # type-checks, runs every notebook, gates at 100%
npm run conformance
```

## Related repositories

- [mbse-schemas](https://github.com/pitaman71/mbse-schemas): the data, its stores and their extents. A sibling
  checkout, `../mbse-schemas`, pinned by version and commit in `siblings.json` (see `scripts/siblings.py`).
- [mbse-expressions](https://github.com/pitaman71/mbse-expressions): the rules, Basic's evaluator and partial
  evaluator. A sibling checkout, `../mbse-expressions`, pinned in `siblings.json`.
