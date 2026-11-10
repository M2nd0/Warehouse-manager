import type { DeepReadonly, Vec2 } from '../sim/types';

/**
 * Pure helpers for animating between simulation ticks (no Three.js here, so
 * they can be unit-tested in Node).
 */

export interface TrailSample {
  x: number;
  y: number;
  /** Unit direction of travel at this point; (0, 0) when standing still. */
  dirX: number;
  dirY: number;
  /** Total length of the trail in cells. */
  length: number;
}

/**
 * Where along its last tick's trail a worker is, `alpha` (0–1) of the way
 * through the tick. The trail runs from where the worker stood when the tick
 * began to where they stand now, through every corner in between.
 */
export function sampleTrail(
  trail: DeepReadonly<Vec2[]>,
  fallback: DeepReadonly<Vec2>,
  alpha: number,
): TrailSample {
  if (trail.length === 0) return { x: fallback.x, y: fallback.y, dirX: 0, dirY: 0, length: 0 };
  let length = 0;
  for (let i = 1; i < trail.length; i++) {
    length += Math.abs(trail[i].x - trail[i - 1].x) + Math.abs(trail[i].y - trail[i - 1].y);
  }
  const last = trail[trail.length - 1];
  if (length === 0) return { x: last.x, y: last.y, dirX: 0, dirY: 0, length: 0 };

  let remaining = Math.min(1, Math.max(0, alpha)) * length;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const segment = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (segment === 0) continue;
    if (remaining <= segment) {
      const f = remaining / segment;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        dirX: (b.x - a.x) / segment,
        dirY: (b.y - a.y) / segment,
        length,
      };
    }
    remaining -= segment;
  }
  return { x: last.x, y: last.y, dirX: 0, dirY: 0, length };
}

/** Turn `from` towards `to` (radians) by at most `maxStep`, the short way round. */
export function turnTowards(from: number, to: number, maxStep: number): number {
  let delta = (to - from) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  if (Math.abs(delta) <= maxStep) return to;
  return from + Math.sign(delta) * maxStep;
}

/**
 * Pallet places on a truck bed, in loading order: two abreast, the first
 * pair at the tail (it comes off first). Returned in the truck's own frame:
 * `across` metres from the centre line, `along` metres from the tail.
 */
export function cargoSlot(index: number): { across: number; along: number } {
  const row = Math.floor(index / 2);
  return { across: index % 2 === 0 ? -0.6 : 0.6, along: 0.65 + row * 1.08 };
}

/** Length of the load bed needed for `pallets` pallets. */
export function bedLength(pallets: number): number {
  const rows = Math.max(2, Math.ceil(pallets / 2));
  return 0.3 + rows * 1.08;
}
