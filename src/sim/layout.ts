import { balance } from '../data/balance';
import { NEIGHBOURS } from './nav';
import type { NavGrid } from './nav';
import type { Cell, GameState, GameView, Id, LocId, Location, Orientation, Rack, Vec2, Zone } from './types';

export interface RackPlacement {
  x: number;
  y: number;
  orientation: Orientation;
}

/**
 * out-of-bounds  – sticks out of the hall
 * occupied       – something already stands there
 * reserved-cell  – in front of a dock door or the staff entrance
 * blocks-access  – would cut off a door, a zone, a station, stock or a person
 * no-access      – no aisle would reach any of its own pallet positions
 */
export type PlacementError = 'out-of-bounds' | 'occupied' | 'reserved-cell' | 'blocks-access' | 'no-access';
export type DemolitionError = 'unknown-rack' | 'rack-in-use';

/** GDD: under 2.7 m red (narrow), under 3.5 m orange (tight). 'none' = no aisle on that side. */
export type AisleRating = 'ok' | 'tight' | 'narrow' | 'none';

export interface AisleInfo {
  /** Free metres between this face of the rack and the next obstacle. */
  width: number;
  rating: AisleRating;
  /** The aisle floor in front of the rack, for drawing. */
  cells: Cell[];
}

/** Everything the building tool shows before a rack is placed. */
export interface RackPreview {
  cells: Cell[];
  error: PlacementError | null;
  /** The aisle on either long side of the rack. */
  aisles: [AisleInfo, AisleInfo];
  /** Pallet positions of the new rack that no aisle would serve. */
  unserved: number;
}

/** Cells covered by a rack: one per pallet position, along its long side. */
export function rackCells(rack: RackPlacement): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < balance.rack.positions; i++) {
    cells.push(rack.orientation === 'h' ? { x: rack.x + i, y: rack.y } : { x: rack.x, y: rack.y + i });
  }
  return cells;
}

/** 0 → A, 25 → Z, 26 → AA … */
function rowLabel(y: number): string {
  let label = '';
  let n = y;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/**
 * Address of a rack slot: `ROW-COLUMN-LEVEL-POSITION`, e.g. `C-06-1-2`.
 * Row and column are the rack's origin cell, so the address tells where the
 * rack stands and stays unique however racks are arranged.
 */
export function rackLocId(rack: RackPlacement, level: number, position: number): LocId {
  return `${rowLabel(rack.y)}-${pad2(rack.x)}-${level}-${position}`;
}

const ZONE_PREFIX: Record<Zone['kind'], string> = { receiving: 'RCV', dispatch: 'DSP' };

/** Address of a floor slot in a zone, e.g. `RCV-A-03`. */
export function floorLocId(kind: Zone['kind'], cell: Cell): LocId {
  return `${ZONE_PREFIX[kind]}-${rowLabel(cell.y)}-${pad2(cell.x)}`;
}

/** Cells that must stay free: in front of dock doors and the staff entrance. */
function isReservedCell(state: GameState, cell: Cell): boolean {
  const same = (c: Cell): boolean => c.x === cell.x && c.y === cell.y;
  return same(state.hall.entrance) || state.hall.docks.some((d) => same(d.cell));
}

function isOccupiedCell(state: GameState, cell: Cell): boolean {
  const same = (c: Cell): boolean => c.x === cell.x && c.y === cell.y;
  if (state.hall.stations.some((s) => same(s.cell))) return true;
  if (state.hall.zones.some((z) => z.cells.some(same))) return true;
  if (state.racks.some((r) => rackCells(r).some(same))) return true;
  // Do not build on top of a parked vehicle or a person.
  const here = (pos: Vec2): boolean => Math.round(pos.x) === cell.x && Math.round(pos.y) === cell.y;
  if (state.vehicles.some((v) => here(v.pos))) return true;
  return state.workers.some((w) => w.status !== 'off' && here(w.pos));
}

/** Does the footprint itself fit? (Says nothing about what it would cut off.) */
function checkFootprint(state: GameState, rack: RackPlacement): PlacementError | null {
  const { width, depth } = state.hall;
  if (!Number.isInteger(rack.x) || !Number.isInteger(rack.y)) return 'out-of-bounds';
  for (const cell of rackCells(rack)) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= depth) return 'out-of-bounds';
    if (isReservedCell(state, cell)) return 'reserved-cell';
    if (isOccupiedCell(state, cell)) return 'occupied';
  }
  return null;
}

function rateAisle(width: number): AisleRating {
  if (width <= 0) return 'none';
  if (width < balance.build.aisleNarrowBelow) return 'narrow';
  if (width < balance.build.aisleTightBelow) return 'tight';
  return 'ok';
}

/**
 * What placing a rack here would mean: whether it is allowed, how wide the
 * aisles on both sides would be, and how many of its positions could be
 * reached (GDD "Stavění": aisle widths and walkable routes shown live).
 */
export function previewRack(state: GameState, nav: NavGrid, rack: RackPlacement): RackPreview {
  const cells = rackCells(rack);
  const none: AisleInfo = { width: 0, rating: 'none', cells: [] };
  const footprint = checkFootprint(state, rack);
  if (footprint) return { cells, error: footprint, aisles: [none, none], unserved: cells.length };

  const { width, depth } = nav;
  const index = (c: Cell): number => c.y * width + c.x;
  const inside = (c: Cell): boolean => c.x >= 0 && c.y >= 0 && c.x < width && c.y < depth;
  const own = new Set(cells.map(index));
  const free = (c: Cell): boolean => inside(c) && nav.blocked[index(c)] === 0 && !own.has(index(c));

  // Aisles: free floor straight out from each long face, as wide as its narrowest point.
  const faces: Cell[] = rack.orientation === 'h' ? [{ x: 0, y: -1 }, { x: 0, y: 1 }] : [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  const aisles = faces.map((face): AisleInfo => {
    let narrowest = Infinity;
    for (const cell of cells) {
      let run = 0;
      while (run < balance.build.aisleMeasureUpTo && free({ x: cell.x + face.x * (run + 1), y: cell.y + face.y * (run + 1) })) {
        run++;
      }
      narrowest = Math.min(narrowest, run);
    }
    const floor: Cell[] = [];
    for (const cell of cells) {
      for (let step = 1; step <= narrowest; step++) floor.push({ x: cell.x + face.x * step, y: cell.y + face.y * step });
    }
    return { width: narrowest, rating: rateAisle(narrowest), cells: floor };
  }) as [AisleInfo, AisleInfo];

  // Where can one still walk to from the staff entrance once the rack stands?
  const reach = new Uint8Array(width * depth);
  const queue: Cell[] = [];
  if (free(state.hall.entrance)) {
    reach[index(state.hall.entrance)] = 1;
    queue.push(state.hall.entrance);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const n of NEIGHBOURS) {
      const next = { x: cur.x + n.x, y: cur.y + n.y };
      if (!free(next) || reach[index(next)] === 1) continue;
      reach[index(next)] = 1;
      queue.push(next);
    }
  }
  const reachable = (c: Cell): boolean => inside(c) && reach[index(c)] === 1;
  const home = nav.region[index(state.hall.entrance)];
  const wasReachable = (c: Cell): boolean => home >= 0 && nav.region[index(c)] === home;

  // Nothing that can be reached today may be cut off.
  let cutsOff = state.hall.docks.some((dock) => !reachable(dock.cell));
  for (const station of state.hall.stations) {
    const access = nav.stationAccess.get(station.id) ?? [];
    if (access.some(wasReachable) && !access.some(reachable)) cutsOff = true;
  }
  for (const loc of state.locations.values()) {
    if (cutsOff) break;
    const access = nav.access.get(loc.id) ?? [];
    if (access.some(wasReachable) && !access.some(reachable)) cutsOff = true;
  }
  const standing = (pos: Vec2): Cell => ({ x: Math.round(pos.x), y: Math.round(pos.y) });
  for (const worker of state.workers) {
    if (worker.status !== 'off' && wasReachable(standing(worker.pos)) && !reachable(standing(worker.pos))) cutsOff = true;
  }
  for (const vehicle of state.vehicles) {
    if (wasReachable(standing(vehicle.pos)) && !reachable(standing(vehicle.pos))) cutsOff = true;
  }

  let unserved = 0;
  for (const cell of cells) {
    if (!faces.some((face) => reachable({ x: cell.x + face.x, y: cell.y + face.y }))) unserved++;
  }

  const error: PlacementError | null = cutsOff ? 'blocks-access' : unserved === cells.length ? 'no-access' : null;
  return { cells, error, aisles, unserved };
}

/** Workers re-plan their walk after the floor plan changed. */
function layoutChanged(state: GameState): void {
  state.layoutVersion++;
  for (const worker of state.workers) {
    if (worker.path.length === 0) continue;
    worker.path = [];
    const task = state.tasks.find((t) => t.id === worker.taskId);
    if (task) task.stepStarted = false;
  }
}

/**
 * Put a rack into the state. No questions asked: player actions go through
 * `previewRack` first (see actions.ts).
 */
export function addRack(state: GameState, placement: RackPlacement): Rack {
  const rack: Rack = {
    id: state.nextId++,
    x: placement.x,
    y: placement.y,
    orientation: placement.orientation,
    levels: balance.rack.levels,
  };
  state.racks.push(rack);
  const cells = rackCells(rack);
  for (let level = 1; level <= rack.levels; level++) {
    cells.forEach((cell, i) => {
      const loc: Location = {
        id: rackLocId(rack, level, i + 1),
        kind: 'rack',
        rackId: rack.id,
        zoneId: null,
        cell: { x: cell.x, y: cell.y },
        level,
        capacityKg: balance.rack.capacityKg,
        palletId: null,
        reservedBy: null,
      };
      state.locations.set(loc.id, loc);
    });
  }
  layoutChanged(state);
  return rack;
}

/** Why a rack cannot be taken down, or null if it can (GDD: empty it first). */
export function checkDemolition(state: GameView, rackId: Id): DemolitionError | null {
  if (!state.racks.some((r) => r.id === rackId)) return 'unknown-rack';
  for (const loc of state.locations.values()) {
    if (loc.rackId === rackId && (loc.palletId !== null || loc.reservedBy !== null)) return 'rack-in-use';
  }
  return null;
}

/** Take a rack out of the state. It must be empty (`checkDemolition`). */
export function removeRack(state: GameState, rackId: Id): void {
  const ids: LocId[] = [];
  for (const loc of state.locations.values()) {
    if (loc.rackId === rackId) ids.push(loc.id);
  }
  for (const id of ids) state.locations.delete(id);
  state.racks = state.racks.filter((r) => r.id !== rackId);
  layoutChanged(state);
}

/** Highest rack level the vehicles on site can serve. */
export function reachLevels(state: GameView): number {
  let reach = 0;
  for (const v of state.vehicles) reach = Math.max(reach, balance.vehicles[v.kind].reachLevels);
  return reach;
}
