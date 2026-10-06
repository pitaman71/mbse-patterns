<!-- nav -->
[← 7 · Generating test data (Python)](../../python3/tutorials/07_Generating_Test_Data.ipynb) · [Home](../../README.md) · [1 · Constraints your data must keep →](01_Constraints_Your_Data_Must_Keep.ipynb)

# Tutorial: constraints, queries and patterns in seven case studies (TypeScript)

This tutorial teaches mbse-patterns by solving real problems, one per notebook, each building on the ones before it.
It continues [mbse-schemas' tutorial](https://github.com/pitaman71/mbse-schemas/blob/main/typescript5/tutorials/README.md),
whose address book it keeps (its case study 2): contacts listed in a directory, each with phones. Constraints are
written with mbse-expressions' expressions; you don't need its tutorial first, but it explains them in depth.

It's written for TypeScript programmers who keep constraints about their data in more than one place, and who need test
data that looks like production's. It's a port of the [Python tutorial](../../python3/tutorials/README.md), with the
same case studies, the same reasoning and the same outputs: the generated contacts in case study 7 are the Python ones,
seed for seed. The [design document](../../docs/PATTERNS.md) is the reference for everything here.

Where the bindings differ, the code follows TypeScript idioms:

- Constraints are written with mbse-expressions' writers (`the.age.ge(18n)`, `p.has("number")`), not with Python's
  operators.
- A predicate is applied with `.call(...)`: `HasName.call(person, "Ann")`.
- Integers are `bigint`s: `age(34n)`, `.mean(70n)`.
- A distribution's `.requires(fn)` calls `fn` with the variable of the distribution's symbol: `(age) => person.age.eq(age)`.

## Running the notebooks

The notebooks are committed with their outputs, so you can just read them. To run them yourself, use Deno's Jupyter
kernel (Deno reads `../deno.json`, which maps the packages to the sibling checkouts' sources):

```sh
deno jupyter --install        # once: registers the Deno kernel with Jupyter
cd typescript5
npm install
```

Then open the notebooks in VS Code (Jupyter extension) or JupyterLab and pick the **Deno** kernel. Each notebook runs
top to bottom in a fresh kernel and makes its own store. `npm test` also runs every tutorial headless under Node,
alongside the test suites, which keeps them in step with the code.

`toolkit.ts` holds the address book's schemas, `book()`, which makes a store of them, and `listed(store, ...)`, which
lists contacts in the store's directory.

## The case studies

| # | Notebook | The problem | What you learn |
|---|---|---|---|
| 1 | [Constraints your data must keep](01_Constraints_Your_Data_Must_Keep.ipynb) | The same constraints, written three times, drift apart | Predicates, symbols and matches; validating; unknown is not false; constraints about two objects; constraints as data |
| 2 | [Finding what matches](02_Finding_What_Matches.ipynb) | Selections repeat the constraints they select by | Predicates as queries; lazy matches over the store's data; variables; plans, hops and `unique` |
| 3 | [Links as constraints](03_Links_As_Constraints.ipynb) | Mandatory and forbidden links; constraints about the whole book | `Exists`, `Forall` and `Contains`; `.forbids`; statements about the store; the evaluator |
| 4 | [Constraints that take arguments](04_Constraints_That_Take_Arguments.ipynb) | One constraint per value copies its mistakes | Parameters; applying a predicate by reference; written once |
| 5 | [The shape of a population](05_The_Shape_Of_A_Population.ipynb) | A believable mix, which no one record breaks | Patterns as predicates; `Choices`, weights, counts and precedence; `weigh`; sampling a store |
| 6 | [Drawing values](06_Drawing_Values.ipynb) | Ages around 70, never under 65 | Distributions of values; witnesses and supports; type checks; mixtures as choices |
| 7 | [Generating test data](07_Generating_Test_Data.ipynb) | Reproducible data in production's mix | `Generate`; seeds and streams; rejection and its cost; generated data as ordinary data; what a generator can't build |

---

<!-- nav -->
[← 7 · Generating test data (Python)](../../python3/tutorials/07_Generating_Test_Data.ipynb) · [Home](../../README.md) · [1 · Constraints your data must keep →](01_Constraints_Your_Data_Must_Keep.ipynb)
