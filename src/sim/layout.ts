import { balance } from '../data/balance';
import type { Cell, GameState, Id, LocId, Location, Orientation, Rack, Zone } from './types';

export interface RackPlacement {
  x: number;
  y: number;
  orientation: Orientation;
}

export type PlacementError = 'out-of-bounds' | 'occupied' | 'reserved-cell';
export type DemolitionError = 'unknown-rack' | 'rack-in-use';

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
  const here = (pos: Cell): boolean => Math.round(pos.x) === cell.x && Math.round(pos.y) === cell.y;
  if (state.vehicles.some((v) => here(v.pos))) return true;
  return state.workers.some((w) => w.status !== 'off' && here(w.pos));
}

/** Why a rack cannot be built here, or null if it can. */
export function checkRackPlacement(state: GameState, rack: RackPlacement): PlacementError | null {
  const { width, depth } = state.hall;
  if (!Number.isInteger(rack.x) || !Number.isInteger(rack.y)) return 'out-of-bounds';
  for (const cell of rackCells(rack)) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= depth) return 'out-of-bounds';
    if (isReservedCell(state, cell)) return 'reserved-cell';
    if (isOccupiedCell(state, cell)) return 'occupied';
  }
  return null;
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
        cell,
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

/** A rack can only be removed once it is empty and nothing is on its way to it. */
export function removeRack(state: GameState, rackId: Id): DemolitionError | null {
  const index = state.racks.findIndex((r) => r.id === rackId);
  if (index < 0) return 'unknown-rack';
  const ids: LocId[] = [];
  for (const loc of state.locations.values()) {
    if (loc.rackId !== rackId) continue;
    if (loc.palletId !== null || loc.reservedBy !== null) return 'rack-in-use';
    ids.push(loc.id);
  }
  for (const id of ids) state.locations.delete(id);
  state.racks.splice(index, 1);
  layoutChanged(state);
  return null;
}

/** Highest rack level the vehicles on site can serve. */
export function reachLevels(state: GameState): number {
  let reach = 0;
  for (const v of state.vehicles) reach = Math.max(reach, balance.vehicles[v.kind].reachLevels);
  return reach;
}
