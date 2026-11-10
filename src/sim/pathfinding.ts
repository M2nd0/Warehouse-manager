import { NEIGHBOURS } from './nav';
import type { NavGrid } from './nav';
import type { Cell } from './types';

/**
 * A* on the 1 m grid, 4-connected, unit step cost.
 *
 * Finds a shortest path from `from` to the nearest of `goals`. Returns the
 * cells to walk through, excluding `from` and including the goal reached
 * (empty if `from` already is a goal), or null if no goal can be reached.
 *
 * Fully deterministic: ties are broken by distance to goal, then cell index.
 */
export function findPath(nav: NavGrid, from: Cell, goals: readonly Cell[]): Cell[] | null {
  const { width, depth, blocked, cost, parent, seen, closed, goal } = nav;
  const size = width * depth;
  if (goals.length === 0) return null;
  if (from.x < 0 || from.y < 0 || from.x >= width || from.y >= depth) return null;

  const gen = ++nav.generation;
  let anyGoal = false;
  for (const g of goals) {
    if (g.x < 0 || g.y < 0 || g.x >= width || g.y >= depth) continue;
    const gi = g.y * width + g.x;
    if (blocked[gi] === 1) continue;
    goal[gi] = gen;
    anyGoal = true;
  }
  if (!anyGoal) return null;

  const start = from.y * width + from.x;
  if (goal[start] === gen) return [];

  const heuristic = (x: number, y: number): number => {
    let best = Infinity;
    for (const g of goals) {
      const d = Math.abs(g.x - x) + Math.abs(g.y - y);
      if (d < best) best = d;
    }
    return best;
  };

  // Binary min-heap of packed keys: (f * radix + h) * size + cell, which orders
  // by f, then h, then cell index. Exact in a double for any hall up to
  // roughly 300 × 300 m.
  const radix = size + width + depth + 1;
  const heap: number[] = [];
  const push = (cell: number, g: number, h: number): void => {
    const key = ((g + h) * radix + h) * size + cell;
    let i = heap.length;
    heap.push(key);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up] <= key) break;
      heap[i] = heap[up];
      i = up;
    }
    heap[i] = key;
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    const n = heap.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && heap[child + 1] < heap[child]) child++;
        if (heap[child] >= last) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return top % size;
  };

  cost[start] = 0;
  seen[start] = gen;
  parent[start] = -1;
  push(start, 0, heuristic(from.x, from.y));

  while (heap.length > 0) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;

    if (goal[cur] === gen) {
      const path: Cell[] = [];
      for (let c = cur; c !== start; c = parent[c]) {
        const x = c % width;
        path.push({ x, y: (c - x) / width });
      }
      return path.reverse();
    }

    const cx = cur % width;
    const cy = (cur - cx) / width;
    const next = cost[cur] + 1;
    for (const n of NEIGHBOURS) {
      const nx = cx + n.x;
      const ny = cy + n.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;
      const ni = ny * width + nx;
      if (blocked[ni] === 1 || closed[ni] === gen) continue;
      if (seen[ni] === gen && cost[ni] <= next) continue;
      seen[ni] = gen;
      cost[ni] = next;
      parent[ni] = cur;
      push(ni, next, heuristic(nx, ny));
    }
  }
  return null;
}
