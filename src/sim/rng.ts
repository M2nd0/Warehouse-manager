/**
 * Seeded random numbers (mulberry32). The generator state lives in
 * `GameState.rng`, so a save resumes the exact same sequence.
 *
 * Only basic arithmetic is used — no Math.exp/log/pow — because those may
 * differ in the last bit between JS engines, which would break replays.
 */

interface RngHost {
  rng: number;
}

export function seedRng(seed: number): number {
  return seed >>> 0;
}

/** Uniform in [0, 1). */
export function random(host: RngHost): number {
  host.rng = (host.rng + 0x6d2b79f5) >>> 0;
  let t = host.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform integer in [0, n). */
export function randomInt(host: RngHost, n: number): number {
  return Math.floor(random(host) * n);
}

export function chance(host: RngHost, probability: number): boolean {
  return random(host) < probability;
}

/** Index drawn with probability proportional to its weight. */
export function weightedIndex(host: RngHost, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = random(host) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** e^-x for x ≥ 0 from +, × and ÷ only (bit-identical on every engine). */
function expNeg(x: number): number {
  let halvings = 0;
  let r = x;
  while (r > 0.5) {
    r /= 2;
    halvings++;
  }
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 14; i++) {
    term *= -r / i;
    sum += term;
  }
  for (; halvings > 0; halvings--) sum *= sum;
  return sum;
}

/** Poisson-distributed count with mean `lambda` (Knuth; fine for small means). */
export function poisson(host: RngHost, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = expNeg(lambda);
  let k = 0;
  let p = random(host);
  while (p > limit) {
    k++;
    p *= random(host);
  }
  return k;
}
