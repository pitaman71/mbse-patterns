<!-- nav -->
[← Why the mbse repositories exist](../../MBSE.md) · [Home](../../README.md) · [1 · Rules your data must keep →](01_Rules_Your_Data_Must_Keep.ipynb)

# Tutorial: rules, queries and patterns in seven case studies

This tutorial teaches mbse-patterns by solving real problems, one per notebook, each building on the ones before it.
It continues [mbse-schemas' tutorial](https://github.com/pitaman71/mbse-schemas/blob/main/python3/tutorials/README.md),
whose address book it keeps (its case study 2): contacts listed in a directory, each with phones. Rules are written with
mbse-expressions' expressions; you don't need its tutorial first, but it explains them in depth.

It's written for Python programmers who keep rules about their data in more than one place, and who need test data
that looks like production's. A TypeScript port with the same case studies is in
the [TypeScript tutorial](../../typescript5/tutorials/README.md). The [design document](../../docs/PATTERNS.md)
is the reference for everything here.

## Running the notebooks

```sh
cd python3
uv sync --all-extras
uv run --with jupyterlab jupyter lab tutorials/   # or open them in VS Code with the project's .venv as the kernel
```

Each notebook runs top to bottom in a fresh kernel and makes its own store. They're committed with their outputs, so
you can just read them; `uv run pytest tutorials` runs them all as tests. `toolkit.py` holds the address book's schemas,
and `listed(store, ...)`, which lists contacts in the store's directory.

## The case studies

| # | Notebook | The problem | What you learn |
|---|---|---|---|
| 1 | [Rules your data must keep](01_Rules_Your_Data_Must_Keep.ipynb) | The same rules, written three times, drift apart | Predicates, symbols and matches; validating; unknown is not false; rules about two objects; rules as data |
| 2 | [Finding what matches](02_Finding_What_Matches.ipynb) | Selections repeat the rules they select by | Predicates as queries; lazy matches over the store's data; variables; plans, hops and `unique` |
| 3 | [Links as rules](03_Links_As_Rules.ipynb) | Mandatory and forbidden links; rules about the whole book | `Exists`, `Forall` and `Contains`; `.forbids`; statements about the store; the evaluator |
| 4 | [Rules that take arguments](04_Rules_That_Take_Arguments.ipynb) | One rule per value copies its mistakes | Parameters; applying a predicate by reference; written once |
| 5 | [The shape of a population](05_The_Shape_Of_A_Population.ipynb) | A believable mix, which no one record breaks | Patterns as predicates; `Choices`, weights, counts and precedence; `weigh`; sampling a store |
| 6 | [Drawing values](06_Drawing_Values.ipynb) | Ages around 70, never under 65 | Distributions of values; witnesses and supports; type checks; mixtures as choices |
| 7 | [Generating test data](07_Generating_Test_Data.ipynb) | Reproducible data in production's mix | `Generate`; seeds and streams; rejection and its cost; generated data as ordinary data; what a generator can't build |

---

<!-- nav -->
[← Why the mbse repositories exist](../../MBSE.md) · [Home](../../README.md) · [1 · Rules your data must keep →](01_Rules_Your_Data_Must_Keep.ipynb)
