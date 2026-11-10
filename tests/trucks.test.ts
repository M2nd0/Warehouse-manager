import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import * as orders from '../src/sim/systems/orders';
import * as trucks from '../src/sim/systems/trucks';
import type { GameState, Truck } from '../src/sim/types';
import { addOrder, addPallet, at, contextFor, quiet, runTo, starterSim, violations } from './helpers';

function addTruck(state: GameState, overrides: Partial<Truck>): Truck {
  const truck: Truck = {
    id: state.nextId++,
    kind: 'inbound',
    clientId: 'eshop',
    window: { start: 0, end: 0 },
    etaTick: 0,
    departureTick: null,
    status: 'waiting',
    dockId: null,
    cargo: [],
    manifest: 0,
    arrivedTick: 0,
    dockedTick: null,
    leftTick: null,
    ...overrides,
  };
  state.trucks.push(truck);
  return truck;
}

function atDock(state: GameState, truck: Truck): void {
  const dock = state.hall.docks[0];
  truck.status = 'at-dock';
  truck.dockId = dock.id;
  dock.truckId = truck.id;
}

describe('trucks', () => {
  it('at midnight plans the day: client deliveries in their windows and the carrier collection', () => {
    const sim = starterSim();
    sim.step();
    const { state } = sim;

    const inbound = state.trucks.filter((t) => t.kind === 'inbound');
    expect(inbound.map((t) => t.clientId).sort()).toEqual(['eshop', 'wholesale']);
    for (const truck of inbound) {
      const client = state.clients.find((c) => c.id === truck.clientId);
      const window = client?.profile.deliveryWindow ?? { start: 0, end: 0 };
      expect(truck.status).toBe('en-route');
      expect(truck.etaTick).toBeGreaterThanOrEqual(window.start);
      expect(truck.etaTick).toBeLessThan(window.end);
      expect(truck.cargo.length).toBe(client?.profile.maxPalletsPerDelivery);
      for (const id of truck.cargo) {
        expect(state.pallets.get(id)).toMatchObject({ status: 'inbound', locId: 'in-transit', clientId: truck.clientId });
      }
    }

    const pickup = state.trucks.find((t) => t.kind === 'pickup');
    expect(pickup).toMatchObject({
      etaTick: balance.trucks.pickup.arriveMinute,
      departureTick: balance.trucks.pickup.departMinute,
    });
  });

  it('clients only top up what is missing, the most depleted SKU first', () => {
    const sim = starterSim({ clients: ['wholesale'] });
    const { state } = sim;
    state.clients[0].profile.ordersPerDay = 0;
    // Full stock of everything except WS-03 (1 of 3) and WS-01 (3 of 4).
    const slots = [...state.locations.values()].filter((l) => l.kind === 'rack' && l.level === 1);
    const stock: Record<string, number> = { 'WS-01': 3, 'WS-02': 4, 'WS-03': 1, 'WS-04': 3 };
    let i = 0;
    for (const [skuId, count] of Object.entries(stock)) {
      for (let n = 0; n < count; n++) addPallet(state, skuId, slots[i++].id);
    }
    sim.step();
    const truck = state.trucks.find((t) => t.kind === 'inbound');
    const load = (truck?.cargo ?? []).map((id) => state.pallets.get(id)?.skuId);
    expect(load.sort()).toEqual(['WS-01', 'WS-03', 'WS-03']);
  });

  it('sends nothing when the stock is full', () => {
    const sim = quiet(starterSim());
    sim.step();
    expect(sim.state.trucks.filter((t) => t.kind === 'inbound')).toHaveLength(0);
  });

  it('arrives at its ETA and docks straight away when the dock is free', () => {
    const sim = starterSim({ workers: 0 });
    sim.step();
    const truck = sim.state.trucks.find((t) => t.clientId === 'eshop') as Truck;
    runTo(sim, truck.etaTick);
    expect(truck.status).toBe('en-route');
    const events = sim.step();
    expect(truck).toMatchObject({ status: 'at-dock', arrivedTick: truck.etaTick, dockedTick: truck.etaTick });
    expect(sim.state.hall.docks[0].truckId).toBe(truck.id);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['truck-arrived', 'truck-docked']));
  });

  it('queues for the single dock; the carrier collection jumps the queue', () => {
    const { state } = quiet(createSim());
    state.tick = at(0, 14, 40);
    const first = addTruck(state, { arrivedTick: at(0, 9), cargo: [1] });
    const second = addTruck(state, { arrivedTick: at(0, 9, 30), cargo: [2] });
    const pickup = addTruck(state, { kind: 'pickup', clientId: null, arrivedTick: at(0, 14, 30), departureTick: at(0, 15) });

    trucks.step(state, contextFor(state));
    expect(pickup.status).toBe('at-dock');
    expect(first.status).toBe('waiting');

    // The carrier leaves; the truck that came first gets the dock.
    state.tick = at(0, 15);
    trucks.step(state, contextFor(state));
    expect(pickup.status).toBe('done');
    expect(first.status).toBe('at-dock');
    expect(second.status).toBe('waiting');
    expect(state.today.truckWaitMinutes).toBe(10 + 6 * 60);
  });

  it('leaves once empty and bills demurrage for every started hour beyond the free time', () => {
    const { state } = quiet(createSim());
    const { freeMinutes, demurragePerHour } = balance.trucks;
    state.tick = at(0, 13);
    const quick = addTruck(state, { arrivedTick: state.tick - freeMinutes });
    atDock(state, quick);
    const ctx = contextFor(state);
    trucks.step(state, ctx);
    expect(quick.status).toBe('done');
    expect(state.hall.docks[0].truckId).toBeNull();
    expect(state.ledger).toHaveLength(0);

    const slow = addTruck(state, { arrivedTick: state.tick - freeMinutes - 61 });
    atDock(state, slow);
    trucks.step(state, ctx);
    expect(state.ledger).toEqual([
      { tick: state.tick, kind: 'demurrage', amount: -2 * demurragePerHour, clientId: 'eshop' },
    ]);
    expect(state.cash).toBe(balance.start.cash - 2 * demurragePerHour);
  });

  it('stays at the dock while pallets are still on board', () => {
    const { state } = quiet(createSim());
    state.tick = at(0, 13);
    const truck = addTruck(state, { cargo: [123] });
    atDock(state, truck);
    trucks.step(state, contextFor(state));
    expect(truck.status).toBe('at-dock');
  });

  it('the carrier takes everything that is ready, parcels and pallets', () => {
    const sim = quiet(starterSim({ workers: 0 }));
    const { state } = sim;
    state.tick = at(0, 15);
    addPallet(state, 'ES-01', 'A-06-1-1');
    const parcel = addOrder(state, 'eshop', [['ES-01', 2]], at(0, 15));
    parcel.status = 'ready';
    parcel.lines[0].picked = 2;
    state.inventory.get('ES-01')!.allocated -= 2;

    const staged = addPallet(state, 'WS-01', 'DSP-J-00', 'staged');
    const pallets = addOrder(state, 'wholesale', [['WS-01', 48]], at(0, 15));
    pallets.status = 'ready';
    pallets.lines[0].picked = 48;
    state.inventory.get('WS-01')!.allocated -= 48;
    staged.orderId = pallets.id;

    const notReady = addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));

    const pickup = addTruck(state, { kind: 'pickup', clientId: null, departureTick: at(0, 15) });
    atDock(state, pickup);
    const ctx = contextFor(state);
    trucks.step(state, ctx);

    expect(parcel).toMatchObject({ status: 'shipped', shippedTick: at(0, 15), late: false });
    expect(pallets.status).toBe('shipped');
    expect(notReady.status).toBe('open');
    expect(state.pallets.has(staged.id)).toBe(false);
    expect(state.locations.get('DSP-J-00')?.palletId).toBeNull();
    expect(state.today).toMatchObject({ ordersShipped: 2, ordersOnTime: 2, ordersPerfect: 2, palletsShipped: 1 });
    expect(state.clients.find((c) => c.id === 'eshop')?.unbilled.lines).toBe(1);
    expect(pickup.status).toBe('done');
    expect(ctx.events.filter((e) => e.type === 'order-shipped')).toHaveLength(2);
    expect(violations(state)).toEqual([]);
  });

  it('a wrong item costs the contract penalty when the order ships', () => {
    const { state } = quiet(starterSim({ workers: 0 }));
    state.tick = at(0, 15);
    const order = addOrder(state, 'eshop', [['ES-01', 0]], at(0, 15));
    order.status = 'ready';
    order.lines[0].error = true;
    const pickup = addTruck(state, { kind: 'pickup', clientId: null, departureTick: at(0, 15) });
    atDock(state, pickup);
    trucks.step(state, contextFor(state));

    const penalty = state.clients[0].contract.errorPenalty;
    expect(state.ledger).toEqual([{ tick: state.tick, kind: 'penalty-error', amount: -penalty, clientId: 'eshop' }]);
    expect(state.today).toMatchObject({ ordersOnTime: 1, ordersPerfect: 0 });
  });

  it('a carrier that never got the dock leaves empty and the orders are late', () => {
    const { state } = quiet(starterSim({ workers: 0 }));
    state.tick = at(0, 15);
    const blocker = addTruck(state, { cargo: [1], arrivedTick: at(0, 14) });
    atDock(state, blocker);
    const order = addOrder(state, 'eshop', [['ES-01', 0]], at(0, 15));
    order.status = 'ready';
    const pickup = addTruck(state, { kind: 'pickup', clientId: null, arrivedTick: at(0, 14, 30), departureTick: at(0, 15) });

    const ctx = contextFor(state);
    trucks.step(state, ctx);
    orders.step(state, ctx);

    expect(pickup.status).toBe('done');
    expect(order).toMatchObject({ status: 'ready', late: true });
    expect(state.today).toMatchObject({ pickupsMissed: 1, ordersLate: 1, ordersShipped: 0 });
    expect(ctx.events.map((e) => e.type)).toEqual(expect.arrayContaining(['pickup-missed', 'order-late']));
  });
});
