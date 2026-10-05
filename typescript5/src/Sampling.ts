/**
 * Sampling: values drawn from a random source, specified exactly on top of mbse-schemas' `Stores.Random` protocol.
 *
 * Every sample is computed from the source's 32-bit words with integer arithmetic and IEEE 754 double arithmetic that is
 * exact or correctly rounded, so any implementation gives the same samples from the same words, and generated data is
 * byte-identical across languages from one seed:
 *
 * - `uniform(random)`: a float in [0, 1), from 53 bits: the high 27 bits of one word and the high 26 of the next,
 *   `(a * 2**26 + b) / 2**53`;
 * - `below(random, n)`: an int in [0, n), by rejection: as many words as `n - 1` needs bits, read as one big-endian
 *   integer `x` of `32 * words` bits, are drawn until `x` is below the greatest multiple of `n` that fits, and then
 *   `x % n`;
 * - `weighted(random, weights)`: an index, chosen with probability proportional to its weight: `u = uniform(random) *
 *   total`, summing the weights from the first, and the first index whose running sum exceeds `u`.
 */

import { Errors, Stores } from "@mbse/schemas/Framework";
import { repr } from "@mbse/schemas/Framework/Repr";

/** A float in [0, 1), from 53 random bits. */
export function uniform(random: Stores.Random): number {
  const a = Number(random.next_u32() >> 5n);
  const b = Number(random.next_u32() >> 6n);
  return (a * 67108864 + b) / 9007199254740992;
}

/** An int in [0, n), each equally likely. */
export function below(random: Stores.Random, n: bigint): bigint {
  if (typeof n !== "bigint" || n < 1n) throw new Errors.ValueError(`below needs a positive int, got ${repr(n)}`);
  const words = Math.max(1, Math.ceil((n - 1n).toString(2).replace(/^0$/, "").length / 32));
  const limit = (1n << BigInt(32 * words)) / n * n;
  for (;;) {
    let x = 0n;
    for (let i = 0; i < words; i++) x = (x << 32n) | random.next_u32();
    if (x < limit) return x % n;
  }
}

/** An index of `weights`, chosen with probability proportional to its weight; the weights are finite and not negative,
 * and some is positive. */
export function weighted(random: Stores.Random, weights: readonly number[]): number {
  let total = 0;
  for (const weight of weights) {
    if (!(typeof weight === "number" && Number.isFinite(weight) && weight >= 0)) {
      throw new Errors.ValueError(`a weight must be a finite float, not negative, got ${repr(weight)}`);
    }
    total += weight;
  }
  if (total <= 0) throw new Errors.ValueError("no weight is positive");
  const u = uniform(random) * total;
  let index = 0;
  let running = weights[0] as number;
  while (!(u < running || running === total)) { // the total ends it, should u round up to it
    index += 1;
    running += weights[index] as number;
  }
  return index;
}
