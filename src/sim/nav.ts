import type { Cell, GameState, Id, LocId } from './types';

/**
 * Walkability of the hall floor plus everything derived from it.
 * This is a cache: it is rebuilt from GameState whenever `layoutVersion`
 * changes and is never saved.
 */
export interface NavGrid {
  version: number;
  width: number;
  depth: number;
  /** 1 = cannot be walked on (rack, floor storage slot, station). */
  blocked: Uint8Array;
  /** Connected area a walkable cell belongs to; -1 for blocked cells. */
  region: Int32Array;
  /** Walkable cells from which a storage location can be served. */
  access: Map<LocId, Cell[]>;
  /** Walkable cells next to a station. */
  stationAccess: Map<Id, Cell[]>;
  /** Scratch buffers for pathfinding (see pathfinding.ts). */
  cost: Int32Array;
  parent: Int32Array;
  seen: Int32Array;
  closed: Int32Array;
  goal: Int32Array;
  generation: number;
}

const NEIGHBOURS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export { NEIGHBOURS };

export function inBounds(grid: { width: number; depth: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.depth;
}

export function isWalkable(nav: NavGrid, x: number, y: number): boolean {
  return inBounds(nav, x, y) && nav.blocked[y * nav.width + x] === 0;
}

/** Region of the cell nearest to a (possibly fractional) position; -1 if blocked. */
export function regionAt(nav: NavGrid, pos: Cell): number {
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  return inBounds(nav, x, y) ? nav.region[y * nav.width + x] : -1;
}

/** Can someone standing in `region` get to at least one of these cells? */
export function reachable(nav: NavGrid, region: number, cells: readonly Cell[]): boolean {
  if (region < 0) return false;
  for (const c of cells) {
    if (nav.region[c.y * nav.width + c.x] === region) return true;
  }
  return false;
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function buildNav(state: GameState): NavGrid {
  const { width, depth } = state.hall;
  const size = width * depth;
  const blocked = new Uint8Array(size);

  const rackOrientation = new Map<Id, 'h' | 'v'>();
  for (const rack of state.racks) rackOrientation.set(rack.id, rack.orientation);

  for (const loc of state.locations.values()) blocked[loc.cell.y * width + loc.cell.x] = 1;
  for (const station of state.hall.stations) blocked[station.cell.y * width + station.cell.x] = 1;

  // Flood fill connected walkable areas.
  const region = new Int32Array(size).fill(-1);
  let regions = 0;
  const queue = new Int32Array(size);
  for (let start = 0; start < size; start++) {
    if (blocked[start] === 1 || region[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    region[start] = regions;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % width;
      const cy = (cur - cx) / width;
      for (const n of NEIGHBOURS) {
        const nx = cx + n.x;
        const ny = cy + n.y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;
        const ni = ny * width + nx;
        if (blocked[ni] === 1 || region[ni] !== -1) continue;
        region[ni] = regions;
        queue[tail++] = ni;
      }
    }
    regions++;
  }

  const walkable = (c: Cell): boolean =>
    c.x >= 0 && c.y >= 0 && c.x < width && c.y < depth && blocked[c.y * width + c.x] === 0;
  const around = (c: Cell): Cell[] =>
    NEIGHBOURS.map((n) => ({ x: c.x + n.x, y: c.y + n.y })).filter(walkable);

  const access = new Map<LocId, Cell[]>();
  for (const loc of state.locations.values()) {
    if (loc.kind === 'rack' && loc.rackId !== null) {
      // A rack slot is served from the aisle on either long side of the rack.
      const { x, y } = loc.cell;
      const sides: Cell[] =
        rackOrientation.get(loc.rackId) === 'h'
          ? [{ x, y: y - 1 }, { x, y: y + 1 }]
          : [{ x: x - 1, y }, { x: x + 1, y }];
      access.set(loc.id, sides.filter(walkable));
    } else {
      access.set(loc.id, around(loc.cell));
    }
  }

  const stationAccess = new Map<Id, Cell[]>();
  for (const station of state.hall.stations) stationAccess.set(station.id, around(station.cell));

  return {
    version: state.layoutVersion,
    width,
    depth,
    blocked,
    region,
    access,
    stationAccess,
    cost: new Int32Array(size),
    parent: new Int32Array(size),
    seen: new Int32Array(size),
    closed: new Int32Array(size),
    goal: new Int32Array(size),
    generation: 0,
  };
}
