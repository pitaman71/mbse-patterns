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
 *   total`, summing the weights from the first, and the first index whose running sum exceeds `u`;
 * - `between(random, low, high)`: a float in [low, high), `low + (high - low) * uniform(random)`;
 * - `normal(random, mean, deviation)`: by Marsaglia's polar method: `u` and `v` uniform in [-1, 1), `2 * uniform(random)
 *   - 1` each, drawn until `0 < s = u*u + v*v < 1`, then `mean + deviation * u * sqrt(-2 * log(s) / s)`;
 * - `poisson(random, rate)`: an int, by inversion: `u = uniform(random)`, and the least `k` whose cumulative
 *   probability, summed from `exp(-rate)` by `p *= rate / k`, exceeds `u` (or whose term underflows to 0); a rate over
 *   500 is drawn as a sum of Poissons of 500 and the rest, in that order;
 * - `geometric(random, p)`: an int, the failures before the first success, by inversion: `floor(log(1 -
 *   uniform(random)) / log(1 - p))`, and 0 when `p` is 1.
 *
 * `log` and `exp` are fdlibm's (Sun's freely distributable libm), ported with only IEEE 754 operations that are exact or
 * correctly rounded, since each language's own may differ from the other's in the last place; `sqrt` is correctly
 * rounded in both.
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

// --- log and exp: fdlibm's, with IEEE 754 operations only ---

const [LN2_HI, LN2_LO, INV_LN2] = [6.93147180369123816490e-01, 1.90821492927058770002e-10, 1.44269504088896338700e+00];
const LG = [6.666666666666735130e-01, 3.999999999940941908e-01, 2.857142874366239149e-01, 2.222219843214978396e-01,
  1.818357216161805012e-01, 1.531383769920937332e-01, 1.479819860511658591e-01] as const;
const P = [1.66666666666666019037e-01, -2.77777777770155933842e-03, 6.61375632143793436117e-05,
  -1.65339022054652515390e-06, 4.13813679705723846039e-08] as const;
const SQRT_HALF = 0.7071067811865476;

const BITS = new DataView(new ArrayBuffer(8));

/** `2 ** n`, exactly, for an integer `n` from -1022 to 1023. */
function power(n: number): number {
  BITS.setBigUint64(0, BigInt(n + 1023) << 52n);
  return BITS.getFloat64(0);
}

/** `[m, e]` with `x = m * 2 ** e` and `m` in [0.5, 1), as C's `frexp`, for a finite positive `x`. */
function frexp(x: number): [number, number] {
  BITS.setFloat64(0, x);
  const exponent = Number((BITS.getBigUint64(0) >> 52n) & 0x7ffn);
  if (exponent === 0) {
    const [m, e] = frexp(x * power(54)); // a subnormal, scaled exactly into the normal range
    return [m, e - 54];
  }
  BITS.setBigUint64(0, (BITS.getBigUint64(0) & ~(0x7ffn << 52n)) | (1022n << 52n));
  return [BITS.getFloat64(0), exponent - 1022];
}

/** `y * 2 ** k`, rounded once, as C's `ldexp`, for `y` in [0.5, 2) and `k` from -1075 to 1024. */
function ldexp(y: number, k: number): number {
  const half = Math.trunc(k / 2);
  return y * power(half) * power(k - half); // the first product is exact: it stays in the normal range
}

/** The natural logarithm of `x`, as fdlibm computes it: `x = m * 2**k` with `m` in [sqrt(1/2), sqrt(2)), and a
 * polynomial in `s = (m - 1) / (m + 1)`. */
export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let [m, k] = frexp(x);
  if (m < SQRT_HALF) [m, k] = [m * 2, k - 1];
  const f = m - 1.0;
  const s = f / (2.0 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG[1] + w * (LG[3] + w * LG[5]));
  const t2 = z * (LG[0] + w * (LG[2] + w * (LG[4] + w * LG[6])));
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - ((hfsq - (s * (hfsq + t2 + t1) + k * LN2_LO)) - f);
}

/** `e ** x`, as fdlibm computes it: `x = k * ln 2 + r`, with `|r| <= ln 2 / 2`, and a rational approximation of
 * `e ** r`, scaled by `2 ** k`. */
export function exp(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x > 709.782712893383973096) return Infinity;
  if (x < -745.13321910194110842) return 0;
  const k = Math.abs(x) > 0.5 * 0.6931471805599453 ? Math.trunc(INV_LN2 * x + (x >= 0 ? 0.5 : -0.5)) : 0;
  const [hi, lo] = [x - k * LN2_HI, k * LN2_LO];
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P[0] + t * (P[1] + t * (P[2] + t * (P[3] + t * P[4]))));
  if (k === 0) return 1.0 - ((r * c) / (c - 2.0) - r);
  return ldexp(1.0 - ((lo - (r * c) / (2.0 - c)) - hi), k);
}

// --- Distributions of values ---

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Errors.ValueError(`${name} must be finite, got ${repr(value)}`);
  return value;
}

/** A float in [low, high). */
export function between(random: Stores.Random, low: number, high: number): number {
  if (!(finite("a uniform's low", low) <= finite("a uniform's high", high))) {
    throw new Errors.ValueError(`a uniform's low must not exceed its high, got ${repr(low)} and ${repr(high)}`);
  }
  return low + (high - low) * uniform(random);
}

/** A float from the normal distribution of `mean` and `deviation`. */
export function normal(random: Stores.Random, mean: number, deviation: number): number {
  if (finite("a normal's deviation", deviation) < 0) {
    throw new Errors.ValueError(`a normal's deviation must not be negative, got ${repr(deviation)}`);
  }
  finite("a normal's mean", mean);
  for (;;) {
    const [u, v] = [2 * uniform(random) - 1, 2 * uniform(random) - 1];
    const s = u * u + v * v;
    if (0 < s && s < 1) return mean + deviation * u * Math.sqrt(-2 * log(s) / s);
  }
}

function poissonOf(random: Stores.Random, rate: number): number {
  let p = exp(-rate);
  let [total, k] = [p, 0];
  const u = uniform(random);
  while (u > total && p > 0) {
    k += 1;
    p *= rate / k;
    total += p;
  }
  return k;
}

/** An int from the Poisson distribution of `rate`. */
export function poisson(random: Stores.Random, rate: number): bigint {
  if (finite("a Poisson's rate", rate) < 0) throw new Errors.ValueError(`a Poisson's rate must not be negative, got ${repr(rate)}`);
  let k = 0;
  while (rate > 500) {
    k += poissonOf(random, 500.0);
    rate -= 500.0;
  }
  return BigInt(k + poissonOf(random, rate));
}

/** An int, the failures before the first success of trials that each succeed with probability `p`. */
export function geometric(random: Stores.Random, p: number): bigint {
  if (!(0 < p && p <= 1)) throw new Errors.ValueError(`a geometric's probability must be in (0, 1], got ${repr(p)}`);
  if (p === 1) return 0n;
  return BigInt(Math.floor(log(1 - uniform(random)) / log(1 - p)));
}
