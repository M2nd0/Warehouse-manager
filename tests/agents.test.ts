import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import type { Sim } from '../src/sim';
import type { GameState, Pallet, Step, Task, Truck, Worker } from '../src/sim/types';
import { addOrder, addPallet, at, quiet, runUntil, starterSim, violations } from './helpers';

const speed = balance.worker.walkSpeed;
const jack = balance.vehicles['hand-pallet-jack'];

const walkTo = (x: number, y: number): Step => ({ op: 'walk', to: { kind: 'cell', cell: { x, y } } });

/** Hand a worker a task made of the given steps. */
function assign(state: GameState, worker: Worker, steps: Step[]): Task {
  const task: Task = {
    id: state.nextId++,
    kind: 'putaway',
    workerId: worker.id,
    steps,
    stepIdx: 0,
    stepStarted: false,
    orderId: null,
    createdTick: state.tick,
  };
  state.tasks.push(task);
  worker.taskId = task.id;
  return task;
}

/** An empty hall mid-morning with one worker standing at (10, 2). */
function emptyHall(): { sim: Sim; worker: Worker } {
  const sim = quiet(createSim());
  sim.state.tick = at(0, 9);
  const worker = sim.state.workers[0];
  worker.status = 'idle';
  worker.pos = { x: 10, y: 2 };
  return { sim, worker };
}

/** The starter warehouse mid-morning, quiet, everybody in. */
function morning(workers = 1): Sim {
  const sim = quiet(starterSim({ workers }));
  sim.state.tick = at(0, 9);
  for (const worker of sim.state.workers) worker.status = 'idle';
  return sim;
}

/** Step and check the consistency rules after every tick. */
function runChecked(sim: Sim, done: (state: GameState) => boolean, limit = 600): void {
  for (let i = 0; i < limit && !done(sim.state); i++) {
    sim.step();
    expect(violations(sim.state)).toEqual([]);
  }
  expect(done(sim.state), 'condition reached in time').toBe(true);
}

describe('agents: walking', () => {
  it('covers walkSpeed metres per minute', () => {
    const { sim, worker } = emptyHall();
    assign(sim.state, worker, [walkTo(10 + 2 * speed, 2)]);

    sim.step();
    expect(worker.pos).toEqual({ x: 10 + speed, y: 2 });
    expect(worker.status).toBe('walking');
    // The trail lists where the worker was at the start of the minute and every cell since.
    expect(worker.trail).toHaveLength(speed + 1);
    expect(worker.trail[0]).toEqual({ x: 10, y: 2 });
    expect(worker.trail[worker.trail.length - 1]).toEqual(worker.pos);

    sim.step();
    expect(worker.pos).toEqual({ x: 10 + 2 * speed, y: 2 });
    expect(worker.status).toBe('idle');
    expect(worker.taskId).toBeNull();
    expect(sim.state.tasks).toHaveLength(0);
  });

  it('leaves a trail through the corners it turned, for the renderer to follow', () => {
    const { sim, worker } = emptyHall();
    worker.pos = { x: 10, y: 3 };
    // A rack right in front: the way to (12, 5) leads around its end.
    expect(sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' })).toMatchObject({ ok: true });
    assign(sim.state, worker, [walkTo(11, 5)]);
    sim.step();
    expect(worker.pos).toEqual({ x: 11, y: 5 });
    expect(worker.trail[0]).toEqual({ x: 10, y: 3 });
    expect(worker.trail).toHaveLength(6);
    // Every leg of the trail is one cell long and never crosses the rack.
    for (let i = 1; i < worker.trail.length; i++) {
      const a = worker.trail[i - 1];
      const b = worker.trail[i];
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
      expect(b.y === 4 && b.x >= 10 && b.x <= 12).toBe(false);
    }
    // Standing still, the trail is just the spot.
    sim.step();
    expect(worker.trail).toEqual([{ x: 11, y: 5 }]);
  });

  it('stops between cells when the minute runs out', () => {
    const { sim, worker } = emptyHall();
    worker.stats.speed = 1;
    assign(sim.state, worker, [walkTo(20, 2)]);
    sim.step();
    expect(worker.pos.x).toBeCloseTo(10 + speed * balance.worker.speedFactorByStat[0], 9);
    expect(worker.pos.y).toBe(2);
  });

  it('uses what is left of a minute on the next step', () => {
    const { sim, worker } = emptyHall();
    const vehicle = sim.state.vehicles[0];
    vehicle.pos = { x: 13, y: 2 };
    vehicle.userId = worker.id;
    assign(sim.state, worker, [
      walkTo(13, 2),
      { op: 'take-vehicle', vehicleId: vehicle.id },
      walkTo(23, 2),
    ]);
    sim.step();
    // 3 m on foot, pick up the jack, then walk on with it for the rest of the minute.
    const left = 1 - 3 / speed - balance.handling.takeVehicle;
    expect(left).toBeGreaterThan(0);
    expect(worker.vehicleId).toBe(vehicle.id);
    expect(worker.pos.x).toBeCloseTo(13 + left * speed * jack.emptySpeedFactor, 9);
    expect(sim.state.today.busyMinutes).toBeCloseTo(1, 9);
  });

  it('is slower with a pallet jack and slowest with a load', () => {
    const distance = 24;
    const minutes = (withJack: boolean, loaded: boolean): number => {
      const sim = quiet(createSim());
      sim.state.tick = at(0, 9);
      const worker = sim.state.workers[0];
      worker.status = 'idle';
      worker.pos = { x: 2, y: 5 };
      if (withJack) {
        sim.state.vehicles[0].userId = worker.id;
        worker.vehicleId = sim.state.vehicles[0].id;
      }
      if (loaded) worker.carrying = 999;
      assign(sim.state, worker, [walkTo(2 + distance, 5)]);
      let ticks = 0;
      while (worker.taskId !== null) {
        sim.step();
        ticks++;
        worker.carrying = loaded && worker.taskId !== null ? 999 : null;
      }
      return ticks;
    };
    expect(minutes(false, false)).toBe(Math.ceil(distance / speed));
    expect(minutes(true, false)).toBe(Math.ceil(distance / (speed * jack.emptySpeedFactor)));
    expect(minutes(true, true)).toBe(Math.ceil(distance / (speed * jack.loadedSpeedFactor)));
  });

  it('finds a new way when a rack is built across the route', () => {
    const { sim, worker } = emptyHall();
    assign(sim.state, worker, [walkTo(22, 2)]);
    sim.step();
    expect(worker.path.some((c) => c.x === 18 && c.y === 2)).toBe(true);

    expect(sim.dispatch({ type: 'build-rack', x: 18, y: 1, orientation: 'v' })).toMatchObject({ ok: true });
    runUntil(sim, () => worker.taskId === null, 30);
    expect(worker.pos).toEqual({ x: 22, y: 2 });
  });

  it('waits and reports when the destination is walled off, then carries on once it is freed', () => {
    const { sim, worker } = emptyHall();
    // A pocket around (21, 5).
    for (const rack of [
      { x: 20, y: 4, orientation: 'h' },
      { x: 20, y: 6, orientation: 'h' },
      { x: 19, y: 4, orientation: 'v' },
      { x: 23, y: 4, orientation: 'v' },
    ] as const) {
      sim.dispatch({ type: 'build-rack', ...rack });
    }
    assign(sim.state, worker, [walkTo(21, 5)]);
    const events = sim.run(5);
    expect(events.filter((e) => e.type === 'worker-blocked')).toHaveLength(1);
    expect(worker.status).toBe('blocked');
    expect(worker.pos).toEqual({ x: 10, y: 2 });
    expect(worker.taskId).not.toBeNull();
    expect(sim.state.today.busyMinutes).toBe(0);

    const wall = sim.state.racks.find((r) => r.x === 19);
    expect(sim.dispatch({ type: 'demolish-rack', rackId: wall?.id ?? -1 })).toMatchObject({ ok: true });
    runUntil(sim, () => worker.taskId === null, 30);
    expect(worker.pos).toEqual({ x: 21, y: 5 });
  });
});

describe('agents: targets', () => {
  it('serves a rack slot from whichever side is open when the worker sets off', () => {
    const { sim, worker } = emptyHall();
    sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' });
    worker.pos = { x: 10, y: 1 };
    assign(sim.state, worker, [{ op: 'walk', to: { kind: 'loc', id: 'E-10-1-1' } }]);
    // After the task was planned, a second rack closes the near side of the first.
    expect(sim.dispatch({ type: 'build-rack', x: 9, y: 3, orientation: 'h' })).toMatchObject({ ok: true });
    runUntil(sim, () => worker.taskId === null, 30);
    expect(worker.pos).toEqual({ x: 10, y: 5 });
  });

  it('walks to docks, stations and vehicles by id', () => {
    const { sim, worker } = emptyHall();
    const { state } = sim;
    const vehicle = state.vehicles[0];
    vehicle.pos = { x: 20, y: 6 };
    assign(state, worker, [
      { op: 'walk', to: { kind: 'vehicle', id: vehicle.id } },
      { op: 'walk', to: { kind: 'station', id: state.hall.stations[0].id } },
      { op: 'walk', to: { kind: 'dock', id: state.hall.docks[0].id } },
    ]);
    const visited: string[] = [];
    for (let i = 0; i < 40 && worker.taskId !== null; i++) {
      sim.step();
      for (const p of worker.trail) visited.push(`${p.x},${p.y}`);
    }
    expect(worker.taskId).toBeNull();
    expect(visited).toContain('20,6');
    expect(visited).toContain('5,8'); // the cell the packing station is served from
    expect(worker.pos).toEqual(state.hall.docks[0].cell);
  });
});

describe('agents: work', () => {
  function truckWith(state: GameState, skus: string[]): Truck {
    const dock = state.hall.docks[0];
    const cargo = skus.map((skuId) => {
      const sku = state.skus.get(skuId)!;
      const pallet: Pallet = {
        id: state.nextId++,
        skuId,
        clientId: sku.clientId,
        qty: sku.unitsPerPallet,
        reserved: 0,
        locId: 'in-transit',
        status: 'inbound',
        taskId: null,
        orderId: null,
        hold: null,
        attendFor: null,
        arrivedTick: state.tick,
        expiryDay: null,
      };
      state.pallets.set(pallet.id, pallet);
      return pallet.id;
    });
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
      manifest: cargo.length,
      arrivedTick: state.tick,
      dockedTick: state.tick,
      leftTick: null,
    };
    state.trucks.push(truck);
    dock.truckId = truck.id;
    return truck;
  }

  it('unloads a truck into receiving, then puts the pallets away', () => {
    const sim = morning();
    const { state } = sim;
    const truck = truckWith(state, ['ES-01', 'ES-02', 'ES-03']);
    const ids = [...truck.cargo];

    // The truck leaves as soon as the last pallet is off, before it is set down.
    runChecked(sim, () => truck.status === 'done');
    expect(state.hall.docks[0].truckId).toBeNull();
    expect(state.today.palletsReceived).toBe(2);
    runChecked(sim, () => state.today.palletsReceived === 3);
    expect(state.clients.find((c) => c.id === 'eshop')?.unbilled.palletsReceived).toBe(3);

    runChecked(sim, () => ids.every((id) => state.pallets.get(id)?.status === 'stored'));
    expect(state.today.palletsPutAway).toBe(3);
    for (const id of ids) {
      const pallet = state.pallets.get(id)!;
      const loc = state.locations.get(pallet.locId)!;
      expect(loc).toMatchObject({ kind: 'rack', level: 1, palletId: id, reservedBy: null });
    }
    expect(state.inventory.get('ES-01')).toEqual({ stored: 48, allocated: 0 });
    expect(state.inventory.get('ES-02')).toEqual({ stored: 120, allocated: 0 });
    expect(state.tasks).toHaveLength(0);
    expect(state.vehicles[0].userId).toBeNull();
    expect(state.vehicles[0].hours).toBeGreaterThan(0);
  });

  it('stops unloading while the receiving zone is full', () => {
    const sim = morning();
    const { state } = sim;
    state.vehicles.length = 0; // no jack: nothing can be put away…
    const truck = truckWith(state, ['ES-01']);
    sim.run(30);
    expect(truck.cargo).toHaveLength(1); // …or unloaded
    expect(state.tasks).toHaveLength(0);
  });

  it('picks an order by the piece, nearest pallet first, and packs it', () => {
    const sim = morning();
    const { state } = sim;
    const far = addPallet(state, 'ES-01', 'A-27-1-3');
    const near = addPallet(state, 'ES-02', 'J-06-1-1');
    const order = addOrder(state, 'eshop', [['ES-01', 2], ['ES-02', 3]], at(0, 15));
    const worker = state.workers[0];

    sim.step();
    const picks = state.tasks[0].steps.filter((s) => s.op === 'pick');
    expect(picks.map((s) => (s.op === 'pick' ? s.palletId : 0))).toEqual([near.id, far.id]);
    expect(order.status).toBe('picking');

    // While picking, the step's progress can be read off workLeft / workTotal.
    runUntil(sim, () => worker.status === 'working', 30);
    expect(worker.workTotal).toBeCloseTo(balance.handling.pickLine + 3 * balance.handling.pickUnit, 9);
    expect(worker.workLeft).toBeGreaterThan(0);
    expect(worker.workLeft).toBeLessThan(worker.workTotal);

    runChecked(sim, () => order.status === 'ready');
    expect(far.qty).toBe(46);
    expect(near.qty).toBe(117);
    expect(far.reserved + near.reserved).toBe(0);
    expect(state.inventory.get('ES-01')).toEqual({ stored: 46, allocated: 0 });
    expect(state.inventory.get('ES-02')).toEqual({ stored: 117, allocated: 0 });
    expect(order.lines.map((l) => l.picked)).toEqual([2, 3]);
    expect(order.readyTick).toBe(state.tick - 1);
    expect(state.today.linesPicked).toBe(2);
    // Packed at the packing station, which is served from the cell north of it.
    expect(worker.pos).toEqual({ x: 5, y: 8 });
    expect(worker.vehicleId).toBeNull();
    expect(worker.workTotal).toBe(0);
  });

  it('takes a line from two pallets when one does not have enough, and removes the empty pallet', () => {
    const sim = morning();
    const { state } = sim;
    const dregs = addPallet(state, 'ES-01', 'J-06-1-1', 'stored', 1);
    const full = addPallet(state, 'ES-01', 'J-09-1-1');
    const order = addOrder(state, 'eshop', [['ES-01', 3]], at(0, 15));

    runChecked(sim, () => order.status === 'ready');
    expect(state.pallets.has(dregs.id)).toBe(false);
    expect(state.locations.get('J-06-1-1')?.palletId).toBeNull();
    expect(full.qty).toBe(46);
    expect(state.today.linesPicked).toBe(1);
  });

  it('brings full pallets to the dispatch zone for a wholesale order', () => {
    const sim = morning();
    const { state } = sim;
    const a = addPallet(state, 'WS-01', 'E-12-1-1');
    const b = addPallet(state, 'WS-01', 'F-15-1-2');
    const other = addPallet(state, 'WS-02', 'E-12-1-2');
    const order = addOrder(state, 'wholesale', [['WS-01', 96]], at(0, 15));

    runChecked(sim, () => order.status === 'ready');
    for (const pallet of [a, b]) {
      expect(pallet).toMatchObject({ status: 'staged', orderId: order.id, taskId: null });
      expect(pallet.locId.startsWith('DSP')).toBe(true);
    }
    expect(other.status).toBe('stored');
    expect(state.locations.get('E-12-1-1')?.palletId).toBeNull();
    expect(state.inventory.get('WS-01')).toEqual({ stored: 0, allocated: 0 });
    expect(order.lines[0].picked).toBe(96);
    expect(state.today.linesPicked).toBe(1);
    expect(state.vehicles[0].userId).toBeNull();
  });

  it('a faster worker gets the same job done sooner', () => {
    const minutes = (stat: number): number => {
      const sim = morning();
      sim.state.workers[0].stats.speed = stat;
      addPallet(sim.state, 'ES-01', 'A-27-1-3');
      const order = addOrder(sim.state, 'eshop', [['ES-01', 2]], at(0, 15));
      const start = sim.state.tick;
      runUntil(sim, () => order.status === 'ready', 200);
      return sim.state.tick - start;
    };
    expect(minutes(5)).toBeLessThan(minutes(3));
    expect(minutes(3)).toBeLessThan(minutes(1));
  });

  it('a careless picker makes more mistakes than a careful one', () => {
    const errorRate = (accuracy: number): number => {
      const sim = starterSim({ seed: 5 });
      sim.state.workers[0].stats.accuracy = accuracy;
      sim.run(20 * 1440);
      const lines = sim.state.reports.reduce((n, r) => n + r.linesPicked, 0);
      const errors = sim.state.reports.reduce((n, r) => n + r.lineErrors, 0);
      expect(lines).toBeGreaterThan(500);
      return errors / lines;
    };
    const sloppy = errorRate(1);
    const careful = errorRate(5);
    expect(sloppy).toBeGreaterThan(0.02);
    expect(sloppy).toBeLessThan(0.09);
    expect(careful).toBeLessThan(0.012);
  });

  it('finishes the task in hand after the shift ends, then goes home', () => {
    const sim = morning();
    const { state } = sim;
    state.tick = balance.shift.end - 2;
    addPallet(state, 'ES-01', 'A-27-1-3');
    const order = addOrder(state, 'eshop', [['ES-01', 2]], at(1, 15));
    const worker = state.workers[0];

    sim.step();
    expect(worker.taskId).not.toBeNull();
    runUntil(sim, () => worker.status === 'off', 120);
    expect(order.status).toBe('ready');
    expect(state.tick).toBeGreaterThan(balance.shift.end);
  });
});
