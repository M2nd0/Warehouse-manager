import { describe, expect, it } from 'vitest';
import { createSim } from '../src/sim';
import { buildNav } from '../src/sim/nav';
import type { NavGrid } from '../src/sim/nav';
import { findPath } from '../src/sim/pathfinding';
import { random, seedRng } from '../src/sim/rng';
import type { Cell } from '../src/sim/types';
import { starterSim } from './helpers';

/** Reference: plain breadth-first search distance to the nearest goal. */
function bfsDistance(nav: NavGrid, from: Cell, goals: Cell[]): number | null {
  const key = (c: Cell) => c.y * nav.width + c.x;
  const targets = new Set(goals.filter((g) => nav.blocked[key(g)] === 0).map(key));
  const dist = new Map<number, number>([[key(from), 0]]);
  const queue: Cell[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as Cell;
    const d = dist.get(key(cur)) as number;
    if (targets.has(key(cur))) return d;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: cur.x + dx, y: cur.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= nav.width || next.y >= nav.depth) continue;
      if (nav.blocked[key(next)] === 1 || dist.has(key(next))) continue;
      dist.set(key(next), d + 1);
      queue.push(next);
    }
  }
  return null;
}

function expectValidPath(nav: NavGrid, from: Cell, path: Cell[]): void {
  let prev = from;
  for (const cell of path) {
    expect(Math.abs(cell.x - prev.x) + Math.abs(cell.y - prev.y)).toBe(1);
    expect(nav.blocked[cell.y * nav.width + cell.x]).toBe(0);
    prev = cell;
  }
}

describe('A* pathfinding', () => {
  it('walks a straight line in an empty hall', () => {
    const nav = buildNav(createSim().state);
    const path = findPath(nav, { x: 10, y: 5 }, [{ x: 14, y: 5 }]);
    expect(path).toEqual([{ x: 11, y: 5 }, { x: 12, y: 5 }, { x: 13, y: 5 }, { x: 14, y: 5 }]);
  });

  it('returns an empty path when already at the goal', () => {
    const nav = buildNav(createSim().state);
    expect(findPath(nav, { x: 3, y: 3 }, [{ x: 3, y: 3 }])).toEqual([]);
  });

  it('goes around racks and never through them', () => {
    const nav = buildNav(starterSim().state);
    // From north of the island to south of it: the island (x 12–17, y 4–5) is in the way.
    const from = { x: 14, y: 3 };
    const path = findPath(nav, from, [{ x: 14, y: 6 }]);
    expect(path).not.toBeNull();
    expectValidPath(nav, from, path as Cell[]);
    expect(path).toHaveLength(9); // 3 to the island's end, 3 down, 3 back
  });

  it('heads for the nearest of several goals', () => {
    const nav = buildNav(createSim().state);
    const path = findPath(nav, { x: 10, y: 5 }, [{ x: 25, y: 5 }, { x: 8, y: 5 }, { x: 10, y: 9 }]);
    expect(path).toEqual([{ x: 9, y: 5 }, { x: 8, y: 5 }]);
  });

  it('returns null when the goal is walled in or blocked', () => {
    const sim = createSim();
    // Box in the pocket (20–22, 5) with racks on all four sides.
    for (const rack of [
      { x: 20, y: 4, orientation: 'h' },
      { x: 20, y: 6, orientation: 'h' },
      { x: 19, y: 4, orientation: 'v' },
      { x: 23, y: 4, orientation: 'v' },
    ] as const) {
      expect(sim.dispatch({ type: 'build-rack', ...rack })).toMatchObject({ ok: true });
    }
    const nav = buildNav(sim.state);
    expect(findPath(nav, { x: 2, y: 5 }, [{ x: 21, y: 5 }])).toBeNull();
    expect(findPath(nav, { x: 21, y: 5 }, [{ x: 22, y: 5 }])).toEqual([{ x: 22, y: 5 }]);
    expect(findPath(nav, { x: 2, y: 5 }, [{ x: 20, y: 4 }])).toBeNull(); // a rack cell
    expect(findPath(nav, { x: 2, y: 5 }, [])).toBeNull();
    expect(findPath(nav, { x: 2, y: 5 }, [{ x: 99, y: 5 }])).toBeNull();
  });

  it('always finds a shortest path (checked against BFS on the starter layout)', () => {
    const nav = buildNav(starterSim().state);
    const rng = { rng: seedRng(99) };
    const cell = (): Cell => ({
      x: Math.floor(random(rng) * nav.width),
      y: Math.floor(random(rng) * nav.depth),
    });
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const from = cell();
      if (nav.blocked[from.y * nav.width + from.x] === 1) continue;
      const goals = [cell(), cell()];
      const path = findPath(nav, from, goals);
      const expected = bfsDistance(nav, from, goals);
      if (expected === null) {
        expect(path).toBeNull();
      } else {
        expect(path).not.toBeNull();
        expect((path as Cell[]).length).toBe(expected);
        expectValidPath(nav, from, path as Cell[]);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('is deterministic', () => {
    const nav = buildNav(starterSim().state);
    const a = findPath(nav, { x: 1, y: 5 }, [{ x: 28, y: 2 }]);
    const b = findPath(nav, { x: 1, y: 5 }, [{ x: 28, y: 2 }]);
    expect(a).toEqual(b);
  });
});
