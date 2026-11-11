import { balance } from '../../data/balance';
import { floorLocId } from '../layout';
import { manhattan, reachable, regionAt } from '../nav';
import type { NavGrid } from '../nav';
import type {
  Cell,
  GameState,
  Id,
  LocId,
  Location,
  Order,
  Pallet,
  Step,
  Target,
  Task,
  TaskKind,
  Vec2,
  Vehicle,
  Worker,
  ZoneKind,
} from '../types';
import { chooseLocation } from './putaway';

/**
 * Task planning: turn a piece of pending work into a list of steps for one
 * worker and reserve everything the task needs (pallets, slots, vehicle), so
 * that two workers never go for the same thing.
 *
 * Every planner returns null and changes nothing if the work cannot be done
 * right now.
 */

const walk = (to: Target): Step => ({ op: 'walk', to });
const toLoc = (id: LocId): Step => walk({ kind: 'loc', id });

const cellOf = (pos: Vec2): Cell => ({ x: Math.round(pos.x), y: Math.round(pos.y) });

const accessOf = (nav: NavGrid, locId: LocId): Cell[] => nav.access.get(locId) ?? [];

function newTask(
  state: GameState,
  kind: TaskKind,
  worker: Worker,
  steps: Step[],
  orderId: Id | null = null,
): Task {
  return {
    id: state.nextId++,
    kind,
    workerId: worker.id,
    steps,
    stepIdx: 0,
    stepStarted: false,
    orderId,
    createdTick: state.tick,
  };
}

/** Nearest vehicle nobody is using that the worker can walk to. */
function findVehicle(state: GameState, nav: NavGrid, worker: Worker): Vehicle | null {
  const region = regionAt(nav, worker.pos);
  let best: Vehicle | null = null;
  let bestDistance = Infinity;
  for (const vehicle of state.vehicles) {
    if (vehicle.userId !== null || regionAt(nav, vehicle.pos) !== region) continue;
    const distance = manhattan(worker.pos, vehicle.pos);
    if (distance < bestDistance) {
      best = vehicle;
      bestDistance = distance;
    }
  }
  return best;
}

const fetchVehicle = (vehicle: Vehicle): Step[] => [
  walk({ kind: 'vehicle', id: vehicle.id }),
  { op: 'take-vehicle', vehicleId: vehicle.id },
];

/** Free, reachable floor slots of a zone kind, nearest to `near` first. */
function freeFloorSlots(
  state: GameState,
  nav: NavGrid,
  kind: ZoneKind,
  region: number,
  near: Cell,
): Location[] {
  const slots: Location[] = [];
  for (const zone of state.hall.zones) {
    if (zone.kind !== kind) continue;
    for (const cell of zone.cells) {
      const loc = state.locations.get(floorLocId(kind, cell));
      if (!loc || loc.palletId !== null || loc.reservedBy !== null) continue;
      if (!reachable(nav, region, accessOf(nav, loc.id))) continue;
      slots.push(loc);
    }
  }
  return slots.sort((a, b) => manhattan(a.cell, near) - manhattan(b.cell, near));
}

/** A truck is at the dock with pallets nobody can take off because receiving is full. */
export function receivingBlocked(state: GameState): boolean {
  const waiting = state.trucks.some(
    (t) =>
      t.kind === 'inbound' &&
      t.status === 'at-dock' &&
      t.cargo.some((id) => state.pallets.get(id)?.taskId === null),
  );
  if (!waiting) return false;
  for (const zone of state.hall.zones) {
    if (zone.kind !== 'receiving') continue;
    for (const cell of zone.cells) {
      const loc = state.locations.get(floorLocId('receiving', cell));
      if (loc && loc.palletId === null && loc.reservedBy === null) return false;
    }
  }
  return true;
}

/** Take one pallet off a docked truck into the receiving zone. */
export function planUnload(state: GameState, nav: NavGrid, worker: Worker): Task | null {
  const region = regionAt(nav, worker.pos);
  for (const truck of state.trucks) {
    if (truck.kind !== 'inbound' || truck.status !== 'at-dock') continue;
    const palletId = truck.cargo.find((id) => state.pallets.get(id)?.taskId === null);
    const pallet = palletId === undefined ? undefined : state.pallets.get(palletId);
    const dock = state.hall.docks.find((d) => d.id === truck.dockId);
    if (!pallet || !dock || !reachable(nav, region, [dock.cell])) continue;

    const slot = freeFloorSlots(state, nav, 'receiving', region, dock.cell)[0];
    if (!slot) return null;
    const vehicle = findVehicle(state, nav, worker);
    if (!vehicle) return null;

    const task = newTask(state, 'unload', worker, [
      ...fetchVehicle(vehicle),
      walk({ kind: 'dock', id: dock.id }),
      { op: 'unload', truckId: truck.id, palletId: pallet.id },
      toLoc(slot.id),
      { op: 'drop', palletId: pallet.id, locId: slot.id },
    ]);
    pallet.taskId = task.id;
    slot.reservedBy = task.id;
    vehicle.userId = worker.id;
    return task;
  }
  return null;
}

/** Move the oldest pallet waiting in receiving to a storage location. */
export function planPutaway(state: GameState, nav: NavGrid, worker: Worker): Task | null {
  const region = regionAt(nav, worker.pos);
  // Look in the receiving zone only: no need to go through every pallet in the building.
  let pallet: Pallet | null = null;
  for (const zone of state.hall.zones) {
    if (zone.kind !== 'receiving') continue;
    for (const cell of zone.cells) {
      const slot = state.locations.get(floorLocId('receiving', cell));
      const p = slot && slot.palletId !== null ? state.pallets.get(slot.palletId) : undefined;
      if (!p || p.status !== 'received' || p.taskId !== null) continue;
      if (!reachable(nav, region, accessOf(nav, slot?.id ?? ''))) continue;
      if (!pallet || p.arrivedTick < pallet.arrivedTick || (p.arrivedTick === pallet.arrivedTick && p.id < pallet.id)) {
        pallet = p;
      }
    }
  }
  if (!pallet || pallet.locId === 'in-transit') return null;

  const vehicle = findVehicle(state, nav, worker);
  if (!vehicle) return null;
  const reach = balance.vehicles[vehicle.kind].reachLevels;
  const target = chooseLocation(state, nav, pallet, reach, region);
  if (!target) return null;

  const task = newTask(state, 'putaway', worker, [
    ...fetchVehicle(vehicle),
    toLoc(pallet.locId),
    { op: 'lift', palletId: pallet.id, order: null },
    toLoc(target.id),
    { op: 'drop', palletId: pallet.id, locId: target.id },
  ]);
  pallet.taskId = task.id;
  target.reservedBy = task.id;
  vehicle.userId = worker.id;
  return task;
}

/**
 * Pick an order by the piece and pack it.
 *
 * GDD: without a WMS pickers take what is closest — so the route is built
 * greedily: from where the picker stands, go to the nearest pallet that has
 * anything the order still needs.
 */
function planEachPick(state: GameState, nav: NavGrid, worker: Worker, order: Order): Task | null {
  const region = regionAt(nav, worker.pos);
  const station = state.hall.stations.find(
    (s) => s.kind === 'packing' && reachable(nav, region, nav.stationAccess.get(s.id) ?? []),
  );
  if (!station) return null;

  const need = order.lines.map((line) => line.qty - line.picked);
  const planned = new Map<Id, number>();
  const stops: { pallet: Pallet; loc: Location; line: number; qty: number }[] = [];
  let here = cellOf(worker.pos);

  while (need.some((n) => n > 0)) {
    let best: { pallet: Pallet; loc: Location; line: number; free: number } | null = null;
    let bestDistance = Infinity;
    for (const pallet of state.pallets.values()) {
      if (pallet.status !== 'stored' || pallet.taskId !== null || pallet.locId === 'in-transit') continue;
      if (pallet.hold !== null) continue; // astray or damaged: not to be picked from
      const line = order.lines.findIndex((l, i) => need[i] > 0 && l.skuId === pallet.skuId);
      if (line < 0) continue;
      const free = pallet.qty - pallet.reserved - (planned.get(pallet.id) ?? 0);
      if (free <= 0) continue;
      const loc = state.locations.get(pallet.locId);
      if (!loc || !reachable(nav, region, accessOf(nav, loc.id))) continue;
      const distance = manhattan(here, loc.cell);
      if (distance < bestDistance) {
        best = { pallet, loc, line, free };
        bestDistance = distance;
      }
    }
    if (!best) return null; // the goods cannot be found: leave the order open
    const qty = Math.min(need[best.line], best.free);
    stops.push({ pallet: best.pallet, loc: best.loc, line: best.line, qty });
    planned.set(best.pallet.id, (planned.get(best.pallet.id) ?? 0) + qty);
    need[best.line] -= qty;
    here = best.loc.cell;
  }

  const steps: Step[] = [];
  for (const stop of stops) {
    steps.push(toLoc(stop.loc.id));
    steps.push({ op: 'pick', palletId: stop.pallet.id, orderId: order.id, line: stop.line, qty: stop.qty });
  }
  steps.push(walk({ kind: 'station', id: station.id }));
  steps.push({ op: 'pack', orderId: order.id });

  const task = newTask(state, 'pick', worker, steps, order.id);
  for (const stop of stops) stop.pallet.reserved += stop.qty;
  order.status = 'picking';
  return task;
}

/** Bring the full pallets of an order to the dispatch zone. */
function planPalletPick(state: GameState, nav: NavGrid, worker: Worker, order: Order): Task | null {
  const region = regionAt(nav, worker.pos);
  const vehicle = findVehicle(state, nav, worker);
  if (!vehicle) return null;
  // Cheap check first: with a full dispatch zone there is no point looking for pallets.
  const dock = state.hall.docks[0];
  const slots = freeFloorSlots(state, nav, 'dispatch', region, dock ? dock.cell : cellOf(worker.pos));
  if (slots.length === 0) return null;

  const chosen: { pallet: Pallet; loc: Location; line: number }[] = [];
  const taken = new Set<Id>();
  let here = cellOf(worker.pos);
  for (let line = 0; line < order.lines.length; line++) {
    let need = order.lines[line].qty - order.lines[line].picked;
    while (need > 0) {
      let best: { pallet: Pallet; loc: Location } | null = null;
      let bestDistance = Infinity;
      for (const pallet of state.pallets.values()) {
        if (pallet.status !== 'stored' || pallet.skuId !== order.lines[line].skuId) continue;
        if (pallet.taskId !== null || pallet.reserved > 0 || pallet.locId === 'in-transit') continue;
        if (pallet.hold !== null || taken.has(pallet.id) || pallet.qty > need) continue;
        const loc = state.locations.get(pallet.locId);
        if (!loc || !reachable(nav, region, accessOf(nav, loc.id))) continue;
        const distance = manhattan(here, loc.cell);
        if (distance < bestDistance) {
          best = { pallet, loc };
          bestDistance = distance;
        }
      }
      if (!best) return null;
      chosen.push({ ...best, line });
      taken.add(best.pallet.id);
      need -= best.pallet.qty;
      here = best.loc.cell;
    }
  }

  if (slots.length < chosen.length) return null; // not enough room in the dispatch zone

  const steps: Step[] = [...fetchVehicle(vehicle)];
  chosen.forEach((item, i) => {
    steps.push(toLoc(item.loc.id));
    steps.push({ op: 'lift', palletId: item.pallet.id, order: { id: order.id, line: item.line } });
    steps.push(toLoc(slots[i].id));
    steps.push({ op: 'drop', palletId: item.pallet.id, locId: slots[i].id });
  });
  steps.push({ op: 'stage', orderId: order.id });

  const task = newTask(state, 'pick', worker, steps, order.id);
  chosen.forEach((item, i) => {
    item.pallet.taskId = task.id;
    slots[i].reservedBy = task.id;
  });
  vehicle.userId = worker.id;
  order.status = 'picking';
  return task;
}

/** Go to a pallet an incident needs worked on: search for it, or repack it. */
export function planAttend(state: GameState, nav: NavGrid, worker: Worker): Task | null {
  const region = regionAt(nav, worker.pos);
  for (const pallet of state.pallets.values()) {
    if (pallet.attendFor === null || pallet.taskId !== null || pallet.locId === 'in-transit') continue;
    if (!reachable(nav, region, accessOf(nav, pallet.locId))) continue;
    const task = newTask(state, 'attend', worker, [
      toLoc(pallet.locId),
      { op: 'attend', palletId: pallet.id, incidentId: pallet.attendFor },
    ]);
    pallet.taskId = task.id;
    return task;
  }
  return null;
}

/** Misplaced pallets holding what this order needs: why it cannot be picked. */
export function lostStockFor(state: GameState, order: Order): Pallet[] {
  const lost: Pallet[] = [];
  for (const pallet of state.pallets.values()) {
    if (pallet.hold !== 'lost') continue;
    if (order.lines.some((line) => line.picked < line.qty && line.skuId === pallet.skuId)) lost.push(pallet);
  }
  return lost;
}

export function planPick(state: GameState, nav: NavGrid, worker: Worker, order: Order): Task | null {
  if (order.status !== 'open') return null;
  return order.mode === 'each'
    ? planEachPick(state, nav, worker, order)
    : planPalletPick(state, nav, worker, order);
}
