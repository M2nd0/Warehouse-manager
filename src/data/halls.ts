import type { Cell, Orientation, Side, StationKind, ZoneKind } from '../sim/types';

export interface RackSpec {
  x: number;
  y: number;
  orientation: Orientation;
}

export interface HallSpec {
  width: number;
  depth: number;
  docks: { cell: Cell; side: Side }[];
  entrance: Cell;
  /** Where vehicles stand at the start. */
  parking: Cell;
  zones: { kind: ZoneKind; cells: Cell[] }[];
  stations: { kind: StationKind; cell: Cell }[];
}

const row = (y: number, fromX: number, toX: number): Cell[] =>
  Array.from({ length: toX - fromX + 1 }, (_, i) => ({ x: fromX + i, y }));

/**
 * Phase 1 — the garage. GDD: 300 m², 1 dock, 60 pallet positions.
 *
 *      x → 0         5                                   29
 *   y=0    R R R R R R  .  (north wall)
 *   y=4    D            .
 *   y=7    E            .
 *   y=9    S S S S S P  .  (south wall)
 *
 *   D dock door (west wall), E staff entrance, R receiving zone,
 *   S dispatch zone, P packing station. Racks go to x ≥ 6.
 */
export const garage: HallSpec = {
  width: 30,
  depth: 10,
  docks: [{ cell: { x: 0, y: 4 }, side: 'W' }],
  entrance: { x: 0, y: 7 },
  parking: { x: 1, y: 6 },
  zones: [
    { kind: 'receiving', cells: row(0, 0, 5) },
    { kind: 'dispatch', cells: row(9, 0, 4) },
  ],
  stations: [{ kind: 'packing', cell: { x: 5, y: 9 } }],
};

const racksInRow = (y: number, fromX: number, count: number): RackSpec[] =>
  Array.from({ length: count }, (_, i) => ({ x: fromX + i * 3, y, orientation: 'h' as const }));

/**
 * A sensible ready-made garage layout: 20 racks = 60 floor-level positions.
 * Two wall rows and a back-to-back island, with 3 m aisles in between.
 * Used by headless runs and tests; in the game the player builds the layout.
 */
export const garageStarterRacks: RackSpec[] = [
  ...racksInRow(0, 6, 8),
  ...racksInRow(9, 6, 8),
  ...racksInRow(4, 12, 2),
  ...racksInRow(5, 12, 2),
];
