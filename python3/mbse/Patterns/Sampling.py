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
  total`, summing the weights from the first, and the first index whose running sum exceeds `u`.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from mbse.Schemas.Framework import Stores

__all__ = ["uniform", "below", "weighted"]


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
