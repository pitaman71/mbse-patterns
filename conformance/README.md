<!-- nav -->
[← Equivalence](../docs/EQUIVALENCE.md) · [Home](../README.md) · [Python package →](../python3/README.md)

# Conformance corpus

Each implementation builds the same cases (`python3/mbse/Patterns/Conformance/Corpus.py`, and
`typescript5/src/Conformance/Corpus.ts`, statement for statement) and writes their snapshots here, as JSON and YAML,
under its own folder. The CONF suites check that each implementation's files are current, that the JSON is
byte-identical across implementations, and that each reads every other's back.

| Case | What it holds |
|---|---|
| `predicates` | a set of predicates of one and two symbols: a description, a rule shared by two predicates (written once), symbols written by their schemas' names, comparisons, `implies`, `count` of `entries`, a quantifier relating two symbols, `has` |
| `empty` | a set of no predicates |
| `algebra` | predicates of the algebra, built by their builders: mandatory, forbidden and possible links (`forall` and `exists` over an `extent`, `Contains` as Basic's `any` over `entries`, `forbids` as `not`, `choices` of weighted arms), and two symbols quantified at once (nested `exists`) |
| `weights` | a predicate whose choices weigh four names, in decreasing precedence, each arm applying one predicate with a parameter, which is written once |
| `generated` | twelve contacts generated from the `weights` predicate from the seed 42, listed in a directory: the same names, in the same order, in every implementation |
| `drawn` | a predicate whose choices' arms draw values from every kind of distribution (a rounded normal, a categorical, and a nested choices of an int uniform, a Poisson and a geometric), and twelve contacts generated from it from the seed 7, redrawn until it holds |

---

<!-- nav -->
[← Equivalence](../docs/EQUIVALENCE.md) · [Home](../README.md) · [Python package →](../python3/README.md)
