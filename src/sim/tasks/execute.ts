import { balance } from '../../data/balance';
import { emit, navOf } from '../context';
import type { SimContext } from '../context';
import { stockOf } from '../inventory';
import { isWalkable } from '../nav';
import type { NavGrid } from '../nav';
import { findPath } from '../pathfinding';
import { chance } from '../rng';
import type { Cell, GameState, Order, OrderLine, Step, Target, Task, Vec2, Worker } from '../types';

/**
 * Carrying out task steps: how long each takes and what it changes.
 */

const statIndex = (stat: number): number => Math.min(5, Math.max(1, Math.round(stat))) - 1;

export function speedFactor(worker: Worker): number {
  return balance.worker.speedFactorByStat[statIndex(worker.stats.speed)];
}

/** Metres per minute right now (slower with a pallet jack, slower still loaded). */
export function walkSpeed(state: GameState, worker: Worker): number {
  let speed = balance.worker.walkSpeed * speedFactor(worker);
  if (worker.vehicleId !== null) {
    const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
    if (vehicle) {
      const spec = balance.vehicles[vehicle.kind];
      speed *= worker.carrying !== null ? spec.loadedSpeedFactor : spec.emptySpeedFactor;
    }
  }
  return speed;
}

function stepMinutes(state: GameState, worker: Worker, step: Step): number {
  const h = balance.handling;
  let minutes = 0;
  switch (step.op) {
    case 'walk':
    case 'stage':
      return 0;
    case 'take-vehicle':
      minutes = h.takeVehicle;
      break;
    case 'unload':
      minutes = h.unloadPallet + h.receivingCheck;
      break;
    case 'lift':
      minutes = h.liftPallet;
      break;
    case 'drop':
      minutes = h.dropPallet;
      break;
    case 'pick':
      minutes = h.pickLine + h.pickUnit * step.qty;
      break;
    case 'pack': {
      const order = state.orders.find((o) => o.id === step.orderId);
      minutes = h.packOrder + h.packLine * (order ? order.lines.length : 0);
      break;
    }
  }
  return minutes / speedFactor(worker);
}

/** Cells from which a target can be reached or served, on the current floor plan. */
export function targetCells(state: GameState, nav: NavGrid, to: Target): Cell[] {
  switch (to.kind) {
    case 'cell':
      return [to.cell];
    case 'loc':
      return nav.access.get(to.id) ?? [];
    case 'station':
      return nav.stationAccess.get(to.id) ?? [];
    case 'dock': {
      const dock = state.hall.docks.find((d) => d.id === to.id);
      return dock ? [dock.cell] : [];
    }
    case 'vehicle': {
      const vehicle = state.vehicles.find((v) => v.id === to.id);
      return vehicle ? [{ x: Math.round(vehicle.pos.x), y: Math.round(vehicle.pos.y) }] : [];
    }
  }
}

/** The walkable cell a (possibly mid-step) worker is standing closest to. */
function standingCell(nav: NavGrid, pos: Vec2): Cell {
  const rounded = { x: Math.round(pos.x), y: Math.round(pos.y) };
  if (isWalkable(nav, rounded.x, rounded.y)) return rounded;
  const candidates: Cell[] = [
    { x: Math.floor(pos.x), y: Math.floor(pos.y) },
    { x: Math.ceil(pos.x), y: Math.ceil(pos.y) },
  ];
  return candidates.find((c) => isWalkable(nav, c.x, c.y)) ?? rounded;
}

/**
 * Set up the current step: find the path for a walk, or start the clock on a
 * work step. Returns false if the worker cannot get there (layout problem);
 * the worker is then 'blocked' and the step is retried every tick, so the
 * task carries on as soon as the way is clear again.
 */
export function beginStep(state: GameState, ctx: SimContext, worker: Worker, task: Task): boolean {
  const step = task.steps[task.stepIdx];
  if (step.op === 'walk') {
    const nav = navOf(state, ctx);
    const from = standingCell(nav, worker.pos);
    // Goal cells are worked out now, not when the task was planned: the floor
    // plan may have changed since.
    const path = findPath(nav, from, targetCells(state, nav, step.to));
    if (!path) {
      if (worker.status !== 'blocked') {
        worker.status = 'blocked';
        emit(ctx, { type: 'worker-blocked', tick: state.tick, workerId: worker.id });
      }
      return false;
    }
    const onCell = worker.pos.x === from.x && worker.pos.y === from.y;
    worker.path = onCell ? path : [from, ...path];
  } else {
    worker.workTotal = stepMinutes(state, worker, step);
    worker.workLeft = worker.workTotal;
  }
  task.stepStarted = true;
  return true;
}

function mispick(state: GameState, worker: Worker): boolean {
  return chance(state, balance.worker.mispickChanceByStat[statIndex(worker.stats.accuracy)]);
}

function linePicked(state: GameState, line: OrderLine): void {
  if (line.picked < line.qty) return;
  state.today.linesPicked++;
  if (line.error) state.today.lineErrors++;
}

function orderReady(state: GameState, ctx: SimContext, order: Order | undefined): void {
  if (!order) return;
  order.status = 'ready';
  order.readyTick = state.tick;
  emit(ctx, { type: 'order-ready', tick: state.tick, orderId: order.id });
}

/** Apply the effect of the step the worker has just finished. */
export function finishStep(state: GameState, ctx: SimContext, worker: Worker, task: Task): void {
  const step = task.steps[task.stepIdx];
  worker.workLeft = 0;
  worker.workTotal = 0;
  switch (step.op) {
    case 'walk':
      break;

    case 'take-vehicle':
      worker.vehicleId = step.vehicleId;
      break;

    case 'unload': {
      const truck = state.trucks.find((t) => t.id === step.truckId);
      if (truck) truck.cargo = truck.cargo.filter((id) => id !== step.palletId);
      worker.carrying = step.palletId;
      break;
    }

    case 'lift': {
      const pallet = state.pallets.get(step.palletId);
      if (!pallet) break;
      if (pallet.locId !== 'in-transit') {
        const loc = state.locations.get(pallet.locId);
        if (loc) loc.palletId = null;
      }
      pallet.locId = 'in-transit';
      worker.carrying = pallet.id;
      if (step.order) {
        // A full pallet leaves storage for an order.
        const stock = stockOf(state, pallet.skuId);
        stock.stored -= pallet.qty;
        stock.allocated -= pallet.qty;
        pallet.status = 'staged';
        pallet.orderId = step.order.id;
        const order = state.orders.find((o) => o.id === step.order?.id);
        const line = order?.lines[step.order.line];
        if (line) {
          line.picked += pallet.qty;
          if (mispick(state, worker)) line.error = true;
          linePicked(state, line);
        }
      }
      break;
    }

    case 'drop': {
      const pallet = state.pallets.get(step.palletId);
      const loc = state.locations.get(step.locId);
      worker.carrying = null;
      if (!pallet || !loc) break;
      loc.palletId = pallet.id;
      loc.reservedBy = null;
      pallet.locId = loc.id;
      pallet.taskId = null;
      if (loc.kind === 'rack') {
        pallet.status = 'stored';
        stockOf(state, pallet.skuId).stored += pallet.qty;
        state.today.palletsPutAway++;
        emit(ctx, { type: 'pallet-stored', tick: state.tick, palletId: pallet.id, locId: loc.id });
      } else if (pallet.status === 'inbound') {
        // Off the truck, checked, standing in receiving: the receiving fee is earned.
        pallet.status = 'received';
        state.today.palletsReceived++;
        const client = state.clients.find((c) => c.id === pallet.clientId);
        if (client) {
          client.unbilled.palletsReceived++;
          state.today.revenue += client.contract.receivingFeePerPallet;
        }
        emit(ctx, { type: 'pallet-received', tick: state.tick, palletId: pallet.id });
      }
      break;
    }

    case 'pick': {
      const pallet = state.pallets.get(step.palletId);
      const order = state.orders.find((o) => o.id === step.orderId);
      const line = order?.lines[step.line];
      if (!pallet || !line) break;
      pallet.qty -= step.qty;
      pallet.reserved -= step.qty;
      const stock = stockOf(state, pallet.skuId);
      stock.stored -= step.qty;
      stock.allocated -= step.qty;
      line.picked += step.qty;
      if (mispick(state, worker)) line.error = true;
      linePicked(state, line);
      if (pallet.qty <= 0) {
        // Last unit taken: the empty pallet goes away and frees the slot.
        if (pallet.locId !== 'in-transit') {
          const loc = state.locations.get(pallet.locId);
          if (loc) loc.palletId = null;
        }
        state.pallets.delete(pallet.id);
      }
      break;
    }

    case 'pack':
    case 'stage':
      orderReady(state, ctx, state.orders.find((o) => o.id === step.orderId));
      break;
  }
}

/** The task is done: put the vehicle down and free the worker. */
export function completeTask(state: GameState, worker: Worker, task: Task): void {
  const here = { x: Math.round(worker.pos.x), y: Math.round(worker.pos.y) };
  for (const vehicle of state.vehicles) {
    if (vehicle.userId !== worker.id) continue;
    vehicle.userId = null;
    vehicle.pos = worker.vehicleId === vehicle.id ? here : vehicle.pos;
  }
  worker.vehicleId = null;
  worker.taskId = null;
  worker.path = [];
  worker.workLeft = 0;
  worker.workTotal = 0;
  const index = state.tasks.indexOf(task);
  if (index >= 0) state.tasks.splice(index, 1);
}
