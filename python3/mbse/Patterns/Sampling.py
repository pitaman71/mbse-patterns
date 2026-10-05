"""Sampling: values drawn from a random source, specified exactly on top of mbse-schemas' `Stores.Random` protocol.

Every sample is computed from the source's 32-bit words with integer arithmetic and IEEE 754 double arithmetic that is
exact or correctly rounded, so any implementation gives the same samples from the same words, and generated data is
byte-identical across languages from one seed:

- `uniform(random)`: a float in [0, 1), from 53 bits: the high 27 bits of one word and the high 26 of the next,
  `(a * 2**26 + b) / 2**53`;
- `below(random, n)`: an int in [0, n), by rejection: as many words as `n - 1` needs bits, read as one big-endian
  integer `x` of `32 * words` bits, are drawn until `x` is below the greatest multiple of `n` that fits, and then
  `x % n`;
- `weighted(random, weights)`: an index, chosen with probability proportional to its weight: `u = uniform(random) *
  total`, summing the weights from the first, and the first index whose running sum exceeds `u`;
- `between(random, low, high)`: a float in [low, high), `low + (high - low) * uniform(random)`;
- `normal(random, mean, deviation)`: by Marsaglia's polar method: `u` and `v` uniform in [-1, 1), `2 * uniform(random)
  - 1` each, drawn until `0 < s = u*u + v*v < 1`, then `mean + deviation * u * sqrt(-2 * log(s) / s)`;
- `poisson(random, rate)`: an int, by inversion: `u = uniform(random)`, and the least `k` whose cumulative probability,
  summed from `exp(-rate)` by `p *= rate / k`, exceeds `u` (or whose term underflows to 0); a rate over 500 is drawn as
  a sum of Poissons of 500 and the rest, in that order;
- `geometric(random, p)`: an int, the failures before the first success, by inversion: `floor(log(1 - uniform(random))
  / log(1 - p))`, and 0 when `p` is 1.

`log` and `exp` are fdlibm's (Sun's freely distributable libm), ported with only IEEE 754 operations that are exact or
correctly rounded, since each language's own may differ from the other's in the last place; `sqrt` is correctly rounded
in both.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from mbse.Schemas.Framework import Stores

__all__ = ["uniform", "below", "weighted", "between", "normal", "poisson", "geometric", "log", "exp"]


def uniform(random: Stores.Random) -> float:
    """A float in [0, 1), from 53 random bits."""
    a, b = random.next_u32() >> 5, random.next_u32() >> 6
    return (a * 67108864 + b) / 9007199254740992


def below(random: Stores.Random, n: int) -> int:
    """An int in [0, n), each equally likely."""
    if type(n) is not int or n < 1:
        raise ValueError(f"below needs a positive int, got {n!r}")
    words = max(1, -(-(n - 1).bit_length() // 32))
    limit = (1 << (32 * words)) // n * n
    while True:
        x = 0
        for _ in range(words):
            x = (x << 32) | random.next_u32()
        if x < limit:
            return x % n


def weighted(random: Stores.Random, weights: Sequence[float]) -> int:
    """An index of `weights`, chosen with probability proportional to its weight; the weights are finite and not
    negative, and some is positive."""
    total = 0.0
    for weight in weights:
        if not (type(weight) is float and math.isfinite(weight) and weight >= 0):
            raise ValueError(f"a weight must be a finite float, not negative, got {weight!r}")
        total += weight
    if total <= 0:
        raise ValueError("no weight is positive")
    u = uniform(random) * total
    index, running = 0, weights[0]
    while not (u < running or running == total):  # the total ends it, should u round up to it
        index += 1
        running += weights[index]
    return index


# --- log and exp: fdlibm's, with IEEE 754 operations only ---

_LN2_HI, _LN2_LO, _INV_LN2 = 6.93147180369123816490e-01, 1.90821492927058770002e-10, 1.44269504088896338700e+00
_LG = (6.666666666666735130e-01, 3.999999999940941908e-01, 2.857142874366239149e-01, 2.222219843214978396e-01,
       1.818357216161805012e-01, 1.531383769920937332e-01, 1.479819860511658591e-01)
_P = (1.66666666666666019037e-01, -2.77777777770155933842e-03, 6.61375632143793436117e-05, -1.65339022054652515390e-06,
      4.13813679705723846039e-08)
_SQRT_HALF = 0.7071067811865476


def log(x: float) -> float:
    """The natural logarithm of `x`, as fdlibm computes it: `x = m * 2**k` with `m` in [sqrt(1/2), sqrt(2)), and a
    polynomial in `s = (m - 1) / (m + 1)`."""
    if math.isnan(x) or x < 0:
        return math.nan
    if x == 0:
        return -math.inf
    if math.isinf(x):
        return x
    m, k = math.frexp(x)
    if m < _SQRT_HALF:
        m, k = m * 2, k - 1
    f = m - 1.0
    s = f / (2.0 + f)
    z = s * s
    w = z * z
    t1 = w * (_LG[1] + w * (_LG[3] + w * _LG[5]))
    t2 = z * (_LG[0] + w * (_LG[2] + w * (_LG[4] + w * _LG[6])))
    hfsq = 0.5 * f * f
    return k * _LN2_HI - ((hfsq - (s * (hfsq + t2 + t1) + k * _LN2_LO)) - f)


def exp(x: float) -> float:
    """`e ** x`, as fdlibm computes it: `x = k * ln 2 + r`, with `|r| <= ln 2 / 2`, and a rational approximation of
    `e ** r`, scaled by `2 ** k`."""
    if math.isnan(x):
        return x
    if x > 709.782712893383973096:
        return math.inf
    if x < -745.13321910194110842:
        return 0.0
    k = int(_INV_LN2 * x + (0.5 if x >= 0 else -0.5)) if abs(x) > 0.5 * 0.6931471805599453 else 0
    hi, lo = x - k * _LN2_HI, k * _LN2_LO
    r = hi - lo
    t = r * r
    c = r - t * (_P[0] + t * (_P[1] + t * (_P[2] + t * (_P[3] + t * _P[4]))))
    if k == 0:
        return 1.0 - ((r * c) / (c - 2.0) - r)
    return math.ldexp(1.0 - ((lo - (r * c) / (2.0 - c)) - hi), k)


# --- Distributions of values ---


def _finite(name: str, value: float) -> float:
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite, got {value!r}")
    return value


def between(random: Stores.Random, low: float, high: float) -> float:
    """A float in [low, high)."""
    if not _finite("a uniform's low", low) <= _finite("a uniform's high", high):
        raise ValueError(f"a uniform's low must not exceed its high, got {low!r} and {high!r}")
    return low + (high - low) * uniform(random)


def normal(random: Stores.Random, mean: float, deviation: float) -> float:
    """A float from the normal distribution of `mean` and `deviation`."""
    if _finite("a normal's deviation", deviation) < 0:
        raise ValueError(f"a normal's deviation must not be negative, got {deviation!r}")
    _finite("a normal's mean", mean)
    while True:
        u, v = 2 * uniform(random) - 1, 2 * uniform(random) - 1
        s = u * u + v * v
        if 0 < s < 1:
            return mean + deviation * u * math.sqrt(-2 * log(s) / s)


def _poisson(random: Stores.Random, rate: float) -> int:
    p = exp(-rate)
    total, k, u = p, 0, uniform(random)
    while u > total and p > 0:
        k += 1
        p *= rate / k
        total += p
    return k


def poisson(random: Stores.Random, rate: float) -> int:
    """An int from the Poisson distribution of `rate`."""
    if _finite("a Poisson's rate", rate) < 0:
        raise ValueError(f"a Poisson's rate must not be negative, got {rate!r}")
    k = 0
    while rate > 500:
        k += _poisson(random, 500.0)
        rate -= 500.0
    return k + _poisson(random, rate)


def geometric(random: Stores.Random, p: float) -> int:
    """An int, the failures before the first success of trials that each succeed with probability `p`."""
    if not 0 < p <= 1:
        raise ValueError(f"a geometric's probability must be in (0, 1], got {p!r}")
    if p == 1:
        return 0
    return math.floor(log(1 - uniform(random)) / log(1 - p))
