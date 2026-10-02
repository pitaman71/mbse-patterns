# Conformance corpus

Each implementation builds the same cases (`python3/mbse/Patterns/Conformance/Corpus.py`, and
`typescript5/src/Conformance/Corpus.ts`, statement for statement) and writes their snapshots here, as JSON and YAML,
under its own folder. The CONF suites check that each implementation's files are current, that the JSON is
byte-identical across implementations, and that each reads every other's back.

| Case | What it holds |
|---|---|
| `constraints` | a set of constraints of two schemas: a description, a rule shared by two constraints (written once), comparisons, `implies`, `count` of `entries`, `has`, a string and a bool literal |
| `empty` | a set of no constraints |
