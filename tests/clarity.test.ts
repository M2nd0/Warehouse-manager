import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { floorLocId } from '../src/sim/layout';
import { alerts, bubbleOf, dayTimeline, paceForecast, slotFill } from '../src/sim/queries';
import { addOrder, addPallet, at, quiet, runTo, runUntil, starterSim } from './helpers';

const { pickup } = balance.trucks;
const A = balance.alerts;

describe('day timeline', () => {
  it('has the shift, the cutoff, the carrier and every truck of today', () => {
    const sim = starterSim();
    sim.step();
    const line = dayTimeline(sim.state);
    expect(line.now).toBe(1);
    expect(line.shift).toEqual({ start: balance.shift.start, end: balance.shift.end });
    expect(line.cutoffs).toEqual([balance.contracts.eshop.cutoffMinute]);
    expect(line.departure).toBe(pickup.departMinute);
    const carrier = line.trucks.find((t) => t.kind === 'pickup');
    expect(carrier).toMatchObject({ from: pickup.arriveMinute, to: pickup.departMinute, arrived: null, waiting: false });
    expect(line.trucks.filter((t) => t.kind === 'inbound').length).toBeGreaterThan(0);
    for (const truck of line.trucks) expect(truck.from).toBeLessThanOrEqual(truck.to);
  });

  it('follows a truck through arriving, docking and leaving', () => {
    const sim = starterSim({ clients: ['eshop'] });
    runUntil(sim, (s) => s.trucks.some((t) => t.kind === 'inbound' && t.status === 'done'));
    const truck = dayTimeline(sim.state).trucks.find((t) => t.kind === 'inbound');
    expect(truck?.arrived).not.toBeNull();
    expect(truck?.docked).toBeGreaterThanOrEqual(truck?.arrived ?? Infinity);
    expect(truck?.left).toBeGreaterThan(truck?.docked ?? Infinity);
  });

  it('marks a truck that stands in the yard without a dock', () => {
    const sim = starterSim();
    const state = sim.state;
    // Nobody unloads, so the first truck keeps the dock and the next one waits.
    state.workers.length = 0;
    runUntil(sim, (s) => s.trucks.filter((t) => t.status === 'waiting' || t.status === 'at-dock').length >= 2);
    const line = dayTimeline(state);
    expect(line.trucks.filter((t) => t.waiting)).toHaveLength(state.trucks.filter((t) => t.status === 'waiting').length);
    expect(line.trucks.some((t) => t.waiting)).toBe(true);
  });
});

describe('pace forecast', () => {
  it('nothing due: nothing at risk', () => {
    const sim = quiet(starterSim());
    runTo(sim, at(0, 9));
    expect(paceForecast(sim.state)).toMatchObject({ due: 0, atRisk: 0, pickers: 1 });
  });

  it('counts the orders that cannot be picked before the carrier leaves', () => {
    const sim = quiet(starterSim());
    const state = sim.state;
    addPallet(state, 'ES-01', 'A-06-1-1');
    runTo(sim, at(0, 14, 30));
    for (let i = 0; i < 12; i++) addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));
    const pace = paceForecast(state);
    expect(pace.minutesLeft).toBe(30);
    expect(pace.due).toBe(12);
    expect(pace.minutesPerOrder).toBe(A.defaultMinutesPerOrder);
    expect(pace.capacity).toBe(Math.floor(30 / A.defaultMinutesPerOrder));
    expect(pace.atRisk).toBe(12 - pace.capacity);
    // Orders for tomorrow's carrier do not count.
    addOrder(state, 'eshop', [['ES-01', 1]], at(1, 15));
    expect(paceForecast(state).due).toBe(12);
  });

  it('uses the pace of the day once a few orders are picked', () => {
    const sim = quiet(starterSim());
    const state = sim.state;
    addPallet(state, 'ES-01', 'A-06-1-1');
    runTo(sim, at(0, 8));
    for (let i = 0; i < 6; i++) addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));
    runUntil(sim, (s) => s.today.picksDone >= A.paceAfterPicks);
    const pace = paceForecast(state);
    expect(pace.minutesPerOrder).toBeCloseTo(state.today.pickMinutes / state.today.picksDone, 10);
    expect(pace.minutesPerOrder).toBeGreaterThan(1);
  });

  it('more pickers, more capacity; people on receiving only do not count', () => {
    const sim = quiet(starterSim({ workers: 2 }));
    runTo(sim, at(0, 10));
    const both = paceForecast(sim.state);
    expect(both.pickers).toBe(2);
    sim.dispatch({ type: 'set-duty', workerId: sim.state.workers[0].id, duty: 'inbound' });
    const one = paceForecast(sim.state);
    expect(one.pickers).toBe(1);
    expect(one.capacity).toBeLessThan(both.capacity);
  });
});

describe('alerts', () => {
  const kinds = (sim: ReturnType<typeof starterSim>) => alerts(sim.state).map((a) => a.kind);

  it('a quiet warehouse has none', () => {
    const sim = quiet(starterSim());
    runTo(sim, at(0, 7, 10));
    expect(alerts(sim.state)).toEqual([]);
  });

  it('orders that will miss the carrier, with the numbers behind the forecast', () => {
    const sim = quiet(starterSim());
    const state = sim.state;
    addPallet(state, 'ES-01', 'A-06-1-1');
    runTo(sim, at(0, 14, 40));
    for (let i = 0; i < 10; i++) addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));
    const risk = alerts(state).find((a) => a.kind === 'orders-at-risk');
    expect(risk).toBeDefined();
    expect(risk?.tone).toBe('bad');
    expect(risk?.params).toMatchObject({ due: 10, pickers: 1, minutesLeft: 20 });
    expect(risk?.cell).toEqual(state.hall.stations[0].cell);
    // After the carrier has gone they are late, not at risk.
    runTo(sim, at(0, 15, 5));
    expect(kinds(sim)).toContain('orders-late');
    expect(kinds(sim)).not.toContain('orders-at-risk');
  });

  it('someone with nothing to do for half an hour, and only during the shift', () => {
    const sim = quiet(starterSim());
    runTo(sim, at(0, 7, A.idleMinutes - 1));
    expect(kinds(sim)).not.toContain('worker-idle');
    runTo(sim, at(0, 7, A.idleMinutes + 2));
    const idle = alerts(sim.state).find((a) => a.kind === 'worker-idle');
    expect(idle?.subject).toEqual({ kind: 'worker', id: sim.state.workers[0].id });
    expect(idle?.params.minutes).toBeGreaterThanOrEqual(A.idleMinutes);
    runTo(sim, at(0, 16));
    expect(kinds(sim)).not.toContain('worker-idle');
  });

  it('a waiting truck is a warning, then a problem; the game says when it turns', () => {
    const sim = starterSim();
    const state = sim.state;
    // Nobody unloads, so the first truck keeps the dock and the next one waits.
    state.workers.length = 0;
    runUntil(sim, (s) => s.trucks.some((t) => t.status === 'waiting'));
    const waiting = state.trucks.find((t) => t.status === 'waiting');
    expect(alerts(state).find((a) => a.kind === 'truck-waiting')).toMatchObject({
      tone: 'warn',
      subject: { kind: 'truck', id: waiting?.id },
    });
    const events = runTo(sim, (waiting?.arrivedTick ?? 0) + A.truckWaitingMinutes + 1);
    expect(events.filter((e) => e.type === 'truck-waiting-long')).toHaveLength(1);
    expect(alerts(state).find((a) => a.kind === 'truck-waiting')?.tone).toBe('bad');
  });

  it('a full receiving zone, and racks with no room left', () => {
    const sim = quiet(starterSim());
    const state = sim.state;
    state.workers.length = 0;
    for (const zone of state.hall.zones) {
      if (zone.kind !== 'receiving') continue;
      for (const cell of zone.cells) addPallet(state, 'ES-01', floorLocId('receiving', cell), 'received');
    }
    expect(kinds(sim)).toContain('receiving-full');
    expect(alerts(state).find((a) => a.kind === 'storage-full')).toBeUndefined();
    for (const loc of state.locations.values()) {
      if (loc.kind === 'rack' && loc.level === 1) addPallet(state, 'ES-02', loc.id);
    }
    expect(alerts(state).find((a) => a.kind === 'storage-full')).toMatchObject({ tone: 'bad' });
  });

  it('unresolved incidents, blocked and tired people, offers — worst first', () => {
    const sim = quiet(starterSim({ clients: ['eshop'] }));
    const state = sim.state;
    runTo(sim, at(0, 7, 5));
    const worker = state.workers[0];
    worker.fatigue = 90;
    state.offers.push({ clientId: 'wholesale', expiresDay: 3 });
    state.incidents.push({
      id: state.nextId++,
      kind: 'sick-leave',
      cause: 'incident.cause.badLuck',
      subject: { kind: 'worker', id: worker.id },
      cell: null,
      createdTick: state.tick,
      deadlineTick: null,
      choices: [{ id: 'manage', labelKey: 'x' }],
      params: {},
      resolved: null,
    });
    const list = alerts(state);
    expect(list.map((a) => a.kind)).toEqual(['incident', 'worker-tired', 'offer']);
    expect(list.map((a) => a.tone)).toEqual(['bad', 'warn', 'info']);
    expect(new Set(list.map((a) => a.key)).size).toBe(list.length);
    worker.status = 'blocked';
    expect(alerts(state)[1]).toMatchObject({ kind: 'worker-blocked', tone: 'bad' });
  });

  it('nobody in during the shift', () => {
    const sim = quiet(starterSim());
    sim.state.workers[0].sickUntilDay = 2;
    runTo(sim, at(0, 9));
    expect(kinds(sim)).toContain('nobody-in');
  });
});

describe('footfall and idle time', () => {
  it('every cell walked over is counted, and the count starts afresh each day', () => {
    const sim = starterSim({ clients: ['eshop'] });
    const state = sim.state;
    expect(state.heat).toHaveLength(state.hall.width * state.hall.depth);
    runTo(sim, at(0, 12));
    const walked = state.heat.reduce((sum, n) => sum + n, 0);
    expect(walked).toBeGreaterThan(50);
    // Nobody walks through a rack.
    for (const rack of state.racks) expect(state.heat[rack.y * state.hall.width + rack.x]).toBe(0);
    runTo(sim, at(1, 0, 1));
    expect(state.heat.every((n) => n === 0)).toBe(true);
  });

  it('idle time runs from the moment the last task ended', () => {
    const sim = quiet(starterSim());
    const state = sim.state;
    const worker = state.workers[0];
    expect(worker.idleSinceTick).toBeNull();
    runTo(sim, at(0, 7, 5));
    expect(worker.idleSinceTick).toBe(at(0, 7));
    addPallet(state, 'ES-01', 'A-06-1-1');
    addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));
    sim.step();
    sim.step();
    expect(worker.idleSinceTick).toBeNull();
    runUntil(sim, (s) => s.orders[0].status === 'ready');
    sim.step();
    expect(worker.idleSinceTick).not.toBeNull();
    runTo(sim, at(0, 16));
    expect(worker.idleSinceTick).toBeNull();
  });
});

describe('state bubbles', () => {
  it('trouble first, then what the hands are doing', () => {
    const sim = quiet(starterSim());
    const state = sim.state;
    const worker = state.workers[0];
    expect(bubbleOf(state, worker)).toBeNull(); // off shift
    runTo(sim, at(0, 7, 2));
    expect(bubbleOf(state, worker)).toBe('idle');

    addPallet(state, 'ES-01', 'A-27-1-3');
    addOrder(state, 'eshop', [['ES-01', 2]], at(0, 15));
    sim.step();
    sim.step();
    expect(bubbleOf(state, worker)).toBe('picking');
    runUntil(sim, (s) => s.tasks[0]?.steps[s.tasks[0].stepIdx]?.op === 'pack');
    expect(bubbleOf(state, worker)).toBe('packing');
    worker.fatigue = 95;
    expect(bubbleOf(state, worker)).toBe('tired');
    worker.status = 'blocked';
    expect(bubbleOf(state, worker)).toBe('blocked');
  });

  it('a pallet on the forks shows as carrying', () => {
    const sim = starterSim({ clients: ['eshop'] });
    runUntil(sim, (s) => s.workers[0].carrying !== null);
    expect(bubbleOf(sim.state, sim.state.workers[0])).toBe('carrying');
  });
});

describe('slot fill', () => {
  it('one entry per rack cell: fastest class there and how full it is', () => {
    const sim = quiet(starterSim());
    const state = sim.state;
    const fill = slotFill(state);
    expect(fill).toHaveLength(state.racks.length * balance.rack.positions);
    expect(fill.every((c) => c.velocity === null && c.fill === 0)).toBe(true);

    const half = addPallet(state, 'ES-05', 'A-06-1-1', 'stored', 10);
    half.hold = 'lost';
    addPallet(state, 'ES-01', 'A-06-1-2');
    const sku = state.skus.get('ES-05');
    const cells = slotFill(state);
    const first = cells.find((c) => c.cell.x === 6 && c.cell.y === 0);
    const second = cells.find((c) => c.cell.x === 7 && c.cell.y === 0);
    expect(first).toMatchObject({ velocity: sku?.velocity, hold: true });
    expect(first?.fill).toBeCloseTo(10 / (sku?.unitsPerPallet ?? 1), 10);
    expect(second).toMatchObject({ velocity: state.skus.get('ES-01')?.velocity, fill: 1, hold: false });
  });
});
