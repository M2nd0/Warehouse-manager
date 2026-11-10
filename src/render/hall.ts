import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import type { Cell, GameView, Side } from '../sim/types';

type Hall = GameView['hall'];
import { palette } from './palette';

/**
 * Static geometry of the hall: floor, 1 m grid, cut-away walls with the dock
 * door and staff entrance, and the painted floor zones.
 *
 * World space: grid x → X, grid y → Z, up is +Y; one unit is one metre.
 */

/** Walls are cut down to a kerb so they never hide the floor behind them. */
const WALL_HEIGHT = 0.5;
const DOOR_POST_HEIGHT = 1.4;
const WALL_THICKNESS = 0.2;
const DOCK_DOOR_WIDTH = 3;
const PAINT_WIDTH = 0.1;
/** Painted markings sit just above the floor to avoid z-fighting. */
const PAINT_Y = 0.012;

interface Gap {
  from: number;
  to: number;
}

function sideOfEntrance(hall: Hall): Side {
  const { x, y } = hall.entrance;
  if (x === 0) return 'W';
  if (x === hall.width - 1) return 'E';
  return y === 0 ? 'N' : 'S';
}

/** Position of a cell along a wall. */
const along = (side: Side, cell: Cell): number => (side === 'W' || side === 'E' ? cell.y : cell.x);

function wallGaps(hall: Hall, side: Side): Gap[] {
  const gaps: Gap[] = [];
  for (const dock of hall.docks) {
    if (dock.side !== side) continue;
    const centre = along(side, dock.cell) + 0.5;
    gaps.push({ from: centre - DOCK_DOOR_WIDTH / 2, to: centre + DOCK_DOOR_WIDTH / 2 });
  }
  if (sideOfEntrance(hall) === side) {
    const at = along(side, hall.entrance);
    gaps.push({ from: at, to: at + 1 });
  }
  return gaps.sort((a, b) => a.from - b.from);
}

function buildWalls(hall: Hall): Group {
  const group = new Group();
  const wall = new MeshStandardMaterial({ color: palette.steel, roughness: 0.8, metalness: 0.1 });
  const post = new MeshStandardMaterial({ color: palette.safetyYellow, roughness: 0.6 });

  const addBox = (
    material: MeshStandardMaterial,
    side: Side,
    from: number,
    to: number,
    height: number,
    thickness: number,
  ): void => {
    const length = to - from;
    if (length <= 0) return;
    const horizontal = side === 'N' || side === 'S';
    const mesh = new Mesh(
      new BoxGeometry(horizontal ? length : thickness, height, horizontal ? thickness : length),
      material,
    );
    const mid = (from + to) / 2;
    const offset = WALL_THICKNESS / 2;
    if (side === 'N') mesh.position.set(mid, height / 2, -offset);
    if (side === 'S') mesh.position.set(mid, height / 2, hall.depth + offset);
    if (side === 'W') mesh.position.set(-offset, height / 2, mid);
    if (side === 'E') mesh.position.set(hall.width + offset, height / 2, mid);
    group.add(mesh);
  };

  for (const side of ['N', 'E', 'S', 'W'] as const) {
    const length = side === 'N' || side === 'S' ? hall.width : hall.depth;
    // Walls overlap at the corners so the outline closes.
    let cursor = -WALL_THICKNESS;
    for (const gap of wallGaps(hall, side)) {
      addBox(wall, side, cursor, gap.from, WALL_HEIGHT, WALL_THICKNESS);
      // Yellow posts mark both sides of every door.
      addBox(post, side, gap.from - 0.15, gap.from, DOOR_POST_HEIGHT, WALL_THICKNESS + 0.1);
      addBox(post, side, gap.to, gap.to + 0.15, DOOR_POST_HEIGHT, WALL_THICKNESS + 0.1);
      cursor = gap.to;
    }
    addBox(wall, side, cursor, length + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
  }
  return group;
}

function buildGrid(hall: Hall): LineSegments {
  const points: number[] = [];
  for (let x = 0; x <= hall.width; x++) points.push(x, 0, 0, x, 0, hall.depth);
  for (let z = 0; z <= hall.depth; z++) points.push(0, 0, z, hall.width, 0, z);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const grid = new LineSegments(
    geometry,
    new LineBasicMaterial({ color: palette.gridLine, transparent: true, opacity: 0.55 }),
  );
  grid.position.y = 0.006;
  return grid;
}

/** Yellow outline (and faint fill) around a set of cells, like floor paint. */
function buildPaintedArea(cells: readonly Cell[], color: number, fillOpacity: number): Group {
  const group = new Group();
  const paint = new MeshBasicMaterial({ color });
  const fill = new MeshBasicMaterial({ color, transparent: true, opacity: fillOpacity, depthWrite: false });
  const has = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);

  const stripe = (x: number, z: number, lengthX: number, lengthZ: number): void => {
    const mesh = new Mesh(new PlaneGeometry(lengthX, lengthZ), paint);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, PAINT_Y, z);
    group.add(mesh);
  };

  for (const { x, y } of cells) {
    if (fillOpacity > 0) {
      const tile = new Mesh(new PlaneGeometry(1, 1), fill);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(x + 0.5, PAINT_Y - 0.004, y + 0.5);
      group.add(tile);
    }
    const inset = PAINT_WIDTH / 2;
    if (!has(x, y - 1)) stripe(x + 0.5, y + inset, 1, PAINT_WIDTH);
    if (!has(x, y + 1)) stripe(x + 0.5, y + 1 - inset, 1, PAINT_WIDTH);
    if (!has(x - 1, y)) stripe(x + inset, y + 0.5, PAINT_WIDTH, 1);
    if (!has(x + 1, y)) stripe(x + 1 - inset, y + 0.5, PAINT_WIDTH, 1);
  }
  return group;
}

/** The apron outside each dock door, where the truck backs up. */
function buildDockAprons(hall: Hall): Group {
  const group = new Group();
  const material = new MeshStandardMaterial({ color: palette.steel, roughness: 0.7, metalness: 0.2 });
  for (const dock of hall.docks) {
    const horizontal = dock.side === 'N' || dock.side === 'S';
    const plate = new Mesh(
      new BoxGeometry(horizontal ? DOCK_DOOR_WIDTH : 1.2, 0.06, horizontal ? 1.2 : DOCK_DOOR_WIDTH),
      material,
    );
    const centre = along(dock.side, dock.cell) + 0.5;
    const out = 0.6 + WALL_THICKNESS;
    if (dock.side === 'W') plate.position.set(-out, 0.03, centre);
    if (dock.side === 'E') plate.position.set(hall.width + out, 0.03, centre);
    if (dock.side === 'N') plate.position.set(centre, 0.03, -out);
    if (dock.side === 'S') plate.position.set(centre, 0.03, hall.depth + out);
    group.add(plate);
  }
  return group;
}

export function buildHall(hall: Hall): Group {
  const group = new Group();
  group.name = 'hall';

  const yard = new Mesh(
    new PlaneGeometry(400, 400),
    new MeshStandardMaterial({ color: palette.asphalt, roughness: 1 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(hall.width / 2, -0.03, hall.depth / 2);
  group.add(yard);

  const floor = new Mesh(
    new PlaneGeometry(hall.width, hall.depth),
    new MeshStandardMaterial({ color: palette.concrete, roughness: 0.95, side: DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(hall.width / 2, 0, hall.depth / 2);
  group.add(floor);

  group.add(buildGrid(hall));
  group.add(buildWalls(hall));
  group.add(buildDockAprons(hall));

  for (const zone of hall.zones) group.add(buildPaintedArea(zone.cells, palette.safetyYellow, 0.14));
  for (const station of hall.stations) group.add(buildPaintedArea([station.cell], palette.steel, 0.3));
  // Keep-clear marking in front of every dock door.
  for (const dock of hall.docks) group.add(buildPaintedArea([dock.cell], palette.safetyYellow, 0));

  return group;
}
