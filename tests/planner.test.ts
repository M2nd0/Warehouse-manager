import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import type { Sim } from '../src/sim';
import { createVehicle } from '../src/sim/state';
import * as planner from '../src/sim/systems/planner';
import type { GameState, Pallet, Truck } from '../src/sim/types';
import { addOrder, addPallet, at, contextFor, quiet, runTo, starterSim, violations } from './helpers';

/** A quiet warehouse at 09:00 with everybody in and idle. */
function morning(workers = 1): Sim {
  const sim = quiet(starterSim({ workers }));
  sim.state.tick = at(0, 9);
  for (const worker of sim.state.workers) worker.status = 'idle';
  return sim;
}

function plan(state: GameState): void {
  planner.step(state, contextFor(state));
}

/** A truck at the dock with `count` pallets of ES-01 on board. */
function dockedTruck(state: GameState, count: number): Truck {
  const dock = state.hall.docks[0];
  const cargo: number[] = [];
  for (let i = 0; i < count; i++) {
    const pallet: Pallet = {
      id: state.nextId++,
      skuId: 'ES-01',
      clientId: 'eshop',
      qty: 48,
      reserved: 0,
      locId: 'in-transit',
      status: 'inbound',
      taskId: null,
      orderId: null,
      arrivedTick: state.tick,
      expiryDay: null,
    };
    state.pallets.set(pallet.id, pallet);
    cargo.push(pallet.id);
  }
  const truck: Truck = {
    id: state.nextId++,
    kind: 'inbound',
    clientId: 'eshop',
    window: { start: state.tick, end: state.tick + 120 },
    etaTick: state.tick,
    departureTick: null,
    status: 'at-dock',
    dockId: dock.id,
    cargo,
    manifest: count,
    arrivedTick: state.tick,
    dockedTick: state.tick,
    leftTick: null,
  };
  state.trucks.push(truck);
  dock.truckId = truck.id;
  return truck;
}

const receivingSlots = (state: GameState) =>
  [...state.locations.values()].filter((l) => l.id.startsWith('RCV'));
const dispatchSlots = (state: GameState) =>
  [...state.locations.values()].filter((l) => l.id.startsWith('DSP'));

describe('task planner', () => {
  it('staff are in the building during the shift only', () => {
    const sim = quiet(starterSim());
    const worker = sim.state.workers[0];
    runTo(sim, balance.shift.start);
    expect(worker.status).toBe('off');
    sim.step();
    expect(worker.status).toBe('idle');
    expect(worker.pos).toEqual(sim.state.hall.entrance);
    runTo(sim, balance.shift.end);
    expect(worker.status).toBe('idle');
    sim.step();
    expect(worker.status).toBe('off');
  });

  it('plans nothing outside the shift', () => {
    const sim = morning();
    sim.state.tick = at(0, 3);
    dockedTruck(sim.state, 2);
    plan(sim.state);
    expect(sim.state.tasks).toHaveLength(0);
  });

  it('unloads a waiting truck before anything else and reserves what it needs', () => {
    const { state } = morning();
    const truck = dockedTruck(state, 2);
    addPallet(state, 'ES-02', 'A-06-1-1');
    addOrder(state, 'eshop', [['ES-02', 1]], at(0, 15));
    addPallet(state, 'ES-03', 'RCV-A-05', 'received');

    plan(state);
    const worker = state.workers[0];
    expect(state.tasks).toHaveLength(1);
    const task = state.tasks[0];
    expect(task).toMatchObject({ kind: 'unload', workerId: worker.id });
    expect(worker.taskId).toBe(task.id);
    expect(state.pallets.get(truck.cargo[0])?.taskId).toBe(task.id);
    expect(receivingSlots(state).filter((l) => l.reservedBy === task.id)).toHaveLength(1);
    expect(state.vehicles[0].userId).toBe(worker.id);
    expect(task.steps.map((s) => s.op)).toEqual(['walk', 'take-vehicle', 'walk', 'unload', 'walk', 'drop']);
  });

  it('clears the receiving zone first when a truck cannot be unloaded', () => {
    const { state } = morning();
    dockedTruck(state, 2);
    for (const slot of receivingSlots(state)) addPallet(state, 'ES-03', slot.id, 'received');
    addPallet(state, 'ES-02', 'A-06-1-1');
    addOrder(state, 'eshop', [['ES-02', 1]], at(0, 15));

    plan(state);
    expect(state.tasks.map((t) => t.kind)).toEqual(['putaway']);
  });

  it('picks orders for the next carrier before putting away, and puts away before picking ahead', () => {
    const today = morning();
    addPallet(today.state, 'ES-02', 'A-06-1-1');
    addPallet(today.state, 'ES-03', 'RCV-A-05', 'received');
    addOrder(today.state, 'eshop', [['ES-02', 1]], at(0, 15));
    plan(today.state);
    expect(today.state.tasks.map((t) => t.kind)).toEqual(['pick']);

    const tomorrow = morning();
    addPallet(tomorrow.state, 'ES-02', 'A-06-1-1');
    addPallet(tomorrow.state, 'ES-03', 'RCV-A-05', 'received');
    addOrder(tomorrow.state, 'eshop', [['ES-02', 1]], at(1, 15));
    plan(tomorrow.state);
    expect(tomorrow.state.tasks.map((t) => t.kind)).toEqual(['putaway']);
  });

  it('picks the order with the earliest deadline first', () => {
    const { state } = morning();
    addPallet(state, 'ES-02', 'A-06-1-1');
    const later = addOrder(state, 'eshop', [['ES-02', 1]], at(0, 15));
    const overdue = addOrder(state, 'eshop', [['ES-02', 1]], at(0, 8));
    plan(state);
    expect(state.tasks[0].orderId).toBe(overdue.id);
    expect(overdue.status).toBe('picking');
    expect(later.status).toBe('open');
  });

  it('put-away picks a free, reachable floor-level slot (chaos) and reserves it', () => {
    const { state } = morning();
    const pallet = addPallet(state, 'ES-03', 'RCV-A-05', 'received');
    plan(state);
    const task = state.tasks[0];
    expect(task.kind).toBe('putaway');
    expect(pallet.taskId).toBe(task.id);
    const target = [...state.locations.values()].filter((l) => l.reservedBy === task.id);
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({ kind: 'rack', level: 1, palletId: null });
  });

  it('chaos put-away spreads pallets all over the place', () => {
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const sim = quiet(starterSim({ seed }));
      sim.state.tick = at(0, 9);
      sim.state.workers[0].status = 'idle';
      addPallet(sim.state, 'ES-03', 'RCV-A-05', 'received');
      plan(sim.state);
      const target = [...sim.state.locations.values()].find((l) => l.reservedBy !== null);
      chosen.add(target?.id ?? '');
    }
    expect(chosen.size).toBeGreaterThan(6);
  });

  it('with one pallet jack, the second worker picks instead of waiting for it', () => {
    const { state } = morning(2);
    dockedTruck(state, 3);
    addPallet(state, 'ES-02', 'A-06-1-1');
    addOrder(state, 'eshop', [['ES-02', 1]], at(0, 15));
    plan(state);
    expect(state.tasks.map((t) => t.kind).sort()).toEqual(['pick', 'unload']);
    expect(violations(state)).toEqual([]);
  });

  it('never sends two workers for the same pallet, slot or vehicle', () => {
    const { state } = morning(3);
    createVehicle(state, 'hand-pallet-jack');
    createVehicle(state, 'hand-pallet-jack');
    const truck = dockedTruck(state, 2);
    plan(state);

    expect(state.tasks.map((t) => t.kind)).toEqual(['unload', 'unload']);
    const claimed = truck.cargo.map((id) => state.pallets.get(id)?.taskId);
    expect(new Set(claimed).size).toBe(2);
    const reserved = receivingSlots(state).filter((l) => l.reservedBy !== null);
    expect(new Set(reserved.map((l) => l.id)).size).toBe(2);
    expect(new Set(state.vehicles.map((v) => v.userId).filter((id) => id !== null)).size).toBe(2);
    expect(state.workers.filter((w) => w.taskId === null)).toHaveLength(1);
    expect(violations(state)).toEqual([]);
  });

  it('an each-pick reserves the units so a second picker goes elsewhere', () => {
    const { state } = morning(2);
    const near = addPallet(state, 'ES-02', 'J-06-1-1', 'stored', 2);
    const far = addPallet(state, 'ES-02', 'A-27-1-3');
    addOrder(state, 'eshop', [['ES-02', 2]], at(0, 15));
    addOrder(state, 'eshop', [['ES-02', 2]], at(0, 15));
    plan(state);
    expect(state.tasks).toHaveLength(2);
    expect(near.reserved).toBe(2);
    expect(far.reserved).toBe(2);
  });

  it('a pallet order waits until the dispatch zone has room for all its pallets', () => {
    const { state } = morning();
    addPallet(state, 'WS-01', 'E-12-1-1');
    addPallet(state, 'WS-01', 'E-12-1-2');
    const order = addOrder(state, 'wholesale', [['WS-01', 96]], at(0, 15));
    const slots = dispatchSlots(state);
    // Four of five slots are taken by pallets staged for someone else.
    const parked = slots.slice(0, 4).map((slot) => addPallet(state, 'WS-02', slot.id, 'staged'));

    plan(state);
    expect(state.tasks).toHaveLength(0);
    expect(order.status).toBe('open');

    state.pallets.delete(parked[0].id);
    slots[0].palletId = null;
    plan(state);
    expect(state.tasks.map((t) => t.kind)).toEqual(['pick']);
    expect(dispatchSlots(state).filter((l) => l.reservedBy === state.tasks[0].id)).toHaveLength(2);
    expect(state.tasks[0].steps.filter((s) => s.op === 'lift')).toHaveLength(2);
  });

  it('leaves alone what nobody can reach', () => {
    const sim = morning();
    const { state } = sim;
    // Wall the worker's corner off from the rest of the hall.
    for (const y of [1, 4]) expect(sim.dispatch({ type: 'build-rack', x: 5, y, orientation: 'v' })).toMatchObject({ ok: true });
    expect(sim.dispatch({ type: 'build-rack', x: 5, y: 7, orientation: 'v' })).toEqual({ ok: false, error: 'occupied' });
    expect(sim.dispatch({ type: 'build-rack', x: 5, y: 7, orientation: 'h' })).toMatchObject({ ok: true });
    expect(sim.dispatch({ type: 'build-rack', x: 5, y: 8, orientation: 'h' })).toMatchObject({ ok: true });
    addPallet(state, 'ES-02', 'A-27-1-3');
    addOrder(state, 'eshop', [['ES-02', 1]], at(0, 15));
    plan(state);
    expect(state.tasks).toHaveLength(0);
  });
});
