import { describe, expect, it } from 'vitest';
import { chance, poisson, random, randomInt, seedRng, weightedIndex } from '../src/sim/rng';

const host = (seed: number) => ({ rng: seedRng(seed) });

describe('seeded RNG', () => {
  it('gives the same sequence for the same seed', () => {
    const a = host(42);
    const b = host(42);
    const first = Array.from({ length: 50 }, () => random(a));
    const second = Array.from({ length: 50 }, () => random(b));
    expect(first).toEqual(second);
  });

  it('gives different sequences for different seeds', () => {
    const a = host(1);
    const b = host(2);
    expect(Array.from({ length: 5 }, () => random(a))).not.toEqual(Array.from({ length: 5 }, () => random(b)));
  });

  it('continues from the stored state (save / load)', () => {
    const a = host(7);
    for (let i = 0; i < 10; i++) random(a);
    const resumed = { rng: a.rng };
    expect(random(resumed)).toBe(random(a));
  });

  it('stays within [0, 1) and is roughly uniform', () => {
    const h = host(3);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const r = random(h);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      sum += r;
    }
    expect(sum / 20_000).toBeCloseTo(0.5, 1);
  });

  it('randomInt covers exactly 0…n-1', () => {
    const h = host(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) seen.add(randomInt(h, 6));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('chance respects the probability', () => {
    const h = host(11);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (chance(h, 0.25)) hits++;
    expect(hits / 20_000).toBeCloseTo(0.25, 1);
    expect(chance(h, 0)).toBe(false);
    expect(chance(h, 1)).toBe(true);
  });

  it('weightedIndex follows the weights and never picks a zero weight', () => {
    const h = host(13);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[weightedIndex(h, [1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(counts[2] / counts[0]).toBeCloseTo(3, 0);
  });

  it('poisson has the requested mean', () => {
    const h = host(17);
    for (const lambda of [0.02, 0.7, 4]) {
      let total = 0;
      const n = 40_000;
      for (let i = 0; i < n; i++) total += poisson(h, lambda);
      expect(total / n).toBeCloseTo(lambda, lambda < 1 ? 2 : 1);
    }
    expect(poisson(h, 0)).toBe(0);
  });
});
