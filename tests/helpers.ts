import { expect } from 'vitest';
import { balance } from '../src/data/balance';
import { garageStarterRacks } from '../src/data/halls';
import { createSim } from '../src/sim';
import type { NewGameOptions, Sim, SimEvent } from '../src/sim';
import { createContext } from '../src/sim/context';
import type { SimContext } from '../src/sim/context';
import { ledgerTotal } from '../src/sim/economy/ledger';
import { recountInventory, stockOf } from '../src/sim/inventory';
import * as clock from '../src/sim/systems/clock';
import { TICKS_PER_DAY } from '../src/sim/time';
import type { GameState, LocId, Order, Pallet, PalletStatus, SkuId } from '../src/sim/types';

/** A new game with the ready-made garage layout (20 racks, 60 floor slots). */
export function starterSim(options: NewGameOptions = {}): Sim {
  const sim = createSim({ seed: 1, ...options });
  for (const rack of garageStarterRacks) {
    expect(sim.dispatch({ type: 'build-rack', ...rack })).toMatchObject({ ok: true });
  }
  return sim;
}

/** Tick of a clock time. */
export const at = (day: number, hour: number, minute = 0): number =>
  day * TICKS_PER_DAY + hour * 60 + minute;

/** Step until the clock shows `tick` (that tick itself is not simulated yet). */
export function runTo(sim: Sim, tick: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.state.tick < tick) events.push(...sim.step());
  return events;
}

/** Step until `done` holds; fails the test if it takes longer than `limit` ticks. */
export function runUntil(sim: Sim, done: (state: GameState) => boolean, limit = TICKS_PER_DAY): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < limit && !done(sim.state); i++) events.push(...sim.step());
  expect(done(sim.state), 'condition reached in time').toBe(true);
  return events;
}

/** Switch off customer orders and client deliveries, to test one thing at a time. */
export function quiet(sim: Sim): Sim {
  for (const client of sim.state.clients) {
    client.profile.ordersPerDay = 0;
    client.profile.targetPallets = {};
  }
  return sim;
}

/** A context positioned at the state's current tick, for calling a system directly. */
export function contextFor(state: GameState): SimContext {
  const ctx = createContext();
  clock.step(state, ctx);
  return ctx;
}

/** Put a pallet straight into a location. */
export function addPallet(
  state: GameState,
  skuId: SkuId,
  locId: LocId,
  status: PalletStatus = 'stored',
  qty?: number,
): Pallet {
  const sku = state.skus.get(skuId);
  const loc = state.locations.get(locId);
  if (!sku || !loc) throw new Error(`unknown sku ${skuId} or location ${locId}`);
  const pallet: Pallet = {
    id: state.nextId++,
    skuId,
    clientId: sku.clientId,
    qty: qty ?? sku.unitsPerPallet,
    reserved: 0,
    locId,
    status,
    taskId: null,
    orderId: null,
    arrivedTick: state.tick,
    expiryDay: null,
  };
  state.pallets.set(pallet.id, pallet);
  loc.palletId = pallet.id;
  if (status === 'stored') stockOf(state, skuId).stored += pallet.qty;
  return pallet;
}

/** Place an order by hand (allocates the stock like a real one). */
export function addOrder(
  state: GameState,
  clientId: string,
  lines: [SkuId, number][],
  deadlineTick: number,
): Order {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) throw new Error(`unknown client ${clientId}`);
  const order: Order = {
    id: state.nextId++,
    clientId,
    mode: client.profile.pickMode,
    createdTick: state.tick,
    deadlineTick,
    lines: lines.map(([skuId, qty]) => ({ skuId, qty, picked: 0, error: false })),
    status: 'open',
    late: false,
    readyTick: null,
    shippedTick: null,
  };
  for (const line of order.lines) stockOf(state, line.skuId).allocated += line.qty;
  state.orders.push(order);
  return order;
}

/**
 * Consistency rules that must hold after every tick. Returns the list of
 * violations (empty when all is well).
 */
export function violations(state: GameState): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => void problems.push(`tick ${state.tick}: ${message}`);

  if (state.cash !== balance.start.cash + ledgerTotal(state)) fail('cash does not match the ledger');

  const recount = recountInventory(state);
  for (const [skuId, stock] of state.inventory) {
    const real = recount.get(skuId);
    if (!real || real.stored !== stock.stored || real.allocated !== stock.allocated) {
      fail(`stock index of ${skuId} is ${JSON.stringify(stock)}, recount says ${JSON.stringify(real)}`);
    }
    if (stock.allocated > stock.stored) fail(`${skuId} is oversold`);
    if (stock.allocated < 0 || stock.stored < 0) fail(`${skuId} has negative stock`);
  }

  const taskIds = new Set(state.tasks.map((t) => t.id));
  const carried = new Set(state.workers.map((w) => w.carrying).filter((id) => id !== null));
  const onTrucks = new Set(state.trucks.flatMap((t) => t.cargo));

  for (const loc of state.locations.values()) {
    if (loc.palletId !== null && state.pallets.get(loc.palletId)?.locId !== loc.id) {
      fail(`${loc.id} holds pallet ${loc.palletId}, which thinks it is elsewhere`);
    }
    if (loc.reservedBy !== null && !taskIds.has(loc.reservedBy)) fail(`${loc.id} is reserved by a dead task`);
    if (loc.reservedBy !== null && loc.palletId !== null) fail(`${loc.id} is both full and reserved`);
  }
  for (const pallet of state.pallets.values()) {
    if (pallet.locId === 'in-transit') {
      if (!carried.has(pallet.id) && !onTrucks.has(pallet.id)) fail(`pallet ${pallet.id} is nowhere`);
    } else if (state.locations.get(pallet.locId)?.palletId !== pallet.id) {
      fail(`pallet ${pallet.id} claims ${pallet.locId}, which does not hold it`);
    }
    if (pallet.reserved < 0 || pallet.reserved > pallet.qty) fail(`pallet ${pallet.id} is over-reserved`);
    if (pallet.qty <= 0) fail(`pallet ${pallet.id} is empty but still exists`);
    if (pallet.taskId !== null && !taskIds.has(pallet.taskId)) fail(`pallet ${pallet.id} is claimed by a dead task`);
  }
  for (const worker of state.workers) {
    if (worker.taskId !== null && !taskIds.has(worker.taskId)) fail(`${worker.name} has a dead task`);
    if (worker.taskId === null && (worker.vehicleId !== null || worker.carrying !== null)) {
      fail(`${worker.name} is idle but still holds something`);
    }
  }
  for (const task of state.tasks) {
    if (state.workers.find((w) => w.id === task.workerId)?.taskId !== task.id) fail(`task ${task.id} has no worker`);
  }
  for (const vehicle of state.vehicles) {
    if (vehicle.userId !== null && !state.workers.some((w) => w.id === vehicle.userId && w.taskId !== null)) {
      fail(`vehicle ${vehicle.id} is held by someone without a task`);
    }
  }
  for (const dock of state.hall.docks) {
    if (dock.truckId !== null && state.trucks.find((t) => t.id === dock.truckId)?.dockId !== dock.id) {
      fail(`dock ${dock.id} and its truck disagree`);
    }
  }
  return problems;
}
