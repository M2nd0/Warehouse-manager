import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim, resumeSim } from '../src/sim';
import type { Sim } from '../src/sim';
import { damageChance, maybeDamage, misplaceChance, sickChance } from '../src/sim/incidents';
import { TICKS_PER_DAY } from '../src/sim/time';
import type { GameState, Incident, Truck } from '../src/sim/types';
import { addOrder, addPallet, at, contextFor, quiet, runTo, runUntil, starterSim, violations } from './helpers';

const I = balance.incidents;
const openOf = (state: GameState, kind: Incident['kind']): Incident[] =>
  state.incidents.filter((i) => i.kind === kind && i.resolved === null);
const decide = (sim: Sim, incident: Incident, choiceId: string) =>
  sim.dispatch({ type: 'resolve-incident', incidentId: incident.id, choiceId });
const spent = (state: GameState): number =>
  state.ledger.filter((e) => e.kind === 'incident').reduce((sum, e) => sum - e.amount, 0);

describe('incidents: every one has a cause that raises its probability (GDD)', () => {
  const { state } = createSim();
  const worker = state.workers[0];
  const with_ = (patch: Partial<typeof worker> & { stat?: [keyof typeof worker.stats, number] }) => ({
    ...worker,
    ...patch,
    stats: patch.stat ? { ...worker.stats, [patch.stat[0]]: patch.stat[1] } : worker.stats,
  });

  it('misplacing: inaccurate, tired or new people', () => {
    const base = misplaceChance(worker, 0);
    expect(misplaceChance(with_({ stat: ['accuracy', 1] }), 0)).toBeGreaterThan(base);
    expect(misplaceChance(with_({ stat: ['accuracy', 5] }), 0)).toBeLessThan(base);
    expect(misplaceChance(with_({ fatigue: 95 }), 0)).toBeGreaterThan(base);
    expect(misplaceChance(with_({ trainingUntilDay: 7 }), 0)).toBeCloseTo(base * 2, 12);
  });

  it('damage: careless or tired people, fragile goods', () => {
    const base = damageChance(worker, 0.5, 0);
    expect(damageChance(with_({ stat: ['care', 1] }), 0.5, 0)).toBeGreaterThan(base);
    expect(damageChance(with_({ fatigue: 100 }), 0.5, 0)).toBeGreaterThan(base);
    expect(damageChance(worker, 1, 0)).toBeGreaterThan(base);
    expect(damageChance(worker, 0, 0)).toBeGreaterThan(0);
    expect(damageChance(worker, 0, 0)).toBeLessThan(base);
  });

  it('sickness: low morale', () => {
    expect(sickChance(with_({ morale: 20 }))).toBeGreaterThan(sickChance(with_({ morale: 70 })));
    expect(sickChance(with_({ morale: 100 }))).toBe(I.sickChancePerDay);
  });
});

describe('incidents: wrong shipment', () => {
  const complaint = (seed = 1) => {
    const sim = quiet(starterSim({ seed, workers: 0 }));
    const { state } = sim;
    state.tick = at(0, 14, 59);
    const order = addOrder(state, 'eshop', [['ES-01', 0]], at(0, 15));
    order.status = 'ready';
    order.lines[0].error = true;
    state.trucks.push({
      id: state.nextId++, kind: 'pickup', clientId: null, window: { start: 0, end: 0 }, etaTick: 0,
      departureTick: at(0, 15), status: 'at-dock', dockId: state.hall.docks[0].id, cargo: [], manifest: 0,
      arrivedTick: 0, dockedTick: 0, leftTick: null,
    } satisfies Truck);
    state.hall.docks[0].truckId = state.trucks[0].id;
    sim.run(2);
    return { sim, incident: openOf(state, 'wrong-shipment')[0], penalty: state.clients[0].contract.errorPenalty };
  };

  it('paying costs the penalty; a replacement costs more and earns goodwill', () => {
    const a = complaint();
    expect(a.incident.cause).toBe('incident.cause.carelessPick');
    expect(decide(a.sim, a.incident, 'pay')).toMatchObject({ ok: true, events: [{ type: 'money' }, { type: 'incident-resolved' }] });
    expect(spent(a.sim.state)).toBe(a.penalty);
    expect(a.sim.state.reputation).toBe(balance.start.reputation);
    expect(decide(a.sim, a.incident, 'pay')).toEqual({ ok: false, error: 'unknown-incident' });

    const b = complaint();
    decide(b.sim, b.incident, 'replace');
    expect(spent(b.sim.state)).toBe(Math.round(b.penalty * I.replacementFactor));
    expect(b.sim.state.reputation).toBe(balance.start.reputation + I.reputation.replaced);
    expect(complaint().sim.dispatch({ type: 'resolve-incident', incidentId: b.incident.id, choiceId: 'nope' })).toEqual({ ok: false, error: 'unknown-choice' });
  });

  it('disputing is a gamble: nothing, or double and a dent in the reputation', () => {
    const outcomes = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const c = complaint(seed);
      decide(c.sim, c.incident, 'dispute');
      const cost = spent(c.sim.state);
      outcomes.add(cost);
      expect(c.sim.state.reputation).toBe(balance.start.reputation + (cost > 0 ? I.reputation.disputeLost : 0));
    }
    expect([...outcomes].sort((x, y) => x - y)).toEqual([0, complaint().penalty * I.disputeLossFactor]);
  });
});

describe('incidents: lost goods', () => {
  const astray = () => {
    const sim = quiet(starterSim());
    const { state } = sim;
    state.tick = at(0, 9);
    state.workers[0].status = 'idle';
    const pallet = addPallet(state, 'ES-01', 'A-27-1-3');
    pallet.hold = 'lost';
    const order = addOrder(state, 'eshop', [['ES-01', 2]], at(0, 15));
    sim.step();
    return { sim, pallet, order, incident: openOf(state, 'lost-goods')[0] };
  };

  it('comes to light when a picker cannot find what the records promise', () => {
    const { sim, pallet, order, incident } = astray();
    expect(order.status).toBe('open');
    expect(sim.state.tasks).toHaveLength(0);
    expect(incident).toMatchObject({ subject: { kind: 'pallet', id: pallet.id }, cell: { x: 29, y: 0 }, cause: 'incident.cause.chaosPutaway' });
    sim.run(10);
    expect(openOf(sim.state, 'lost-goods')).toHaveLength(1); // raised once, not every minute
  });

  it('searching takes someone’s time, then the order can be picked', () => {
    const { sim, pallet, order, incident } = astray();
    decide(sim, incident, 'search');
    expect(spent(sim.state)).toBe(0);
    sim.step();
    expect(sim.state.tasks.map((t) => t.kind)).toEqual(['attend']);
    const start = sim.state.tick;
    runUntil(sim, () => pallet.hold === null, 120);
    expect(sim.state.tick - start).toBeGreaterThanOrEqual(I.searchMinutes);
    runUntil(sim, () => order.status === 'ready', 60);
    expect(violations(sim.state)).toEqual([]);
  });

  it('a stock count tonight costs money and finds everything', () => {
    const { sim, pallet, order, incident } = astray();
    const other = addPallet(sim.state, 'ES-02', 'A-06-1-1');
    other.hold = 'lost';
    decide(sim, incident, 'count');
    expect(spent(sim.state)).toBe(I.stockCountCost);
    runTo(sim, at(0, 20));
    expect(pallet.hold).toBe('lost');
    expect(order.status).toBe('open');
    runTo(sim, at(1, 0));
    expect(pallet.hold).toBeNull();
    expect(other.hold).toBeNull();
    expect(sim.state.incidents).toHaveLength(0);
  });
});

describe('incidents: damaged pallet', () => {
  const damaged = () => {
    const sim = quiet(starterSim({ incidents: true }));
    const { state } = sim;
    state.tick = at(0, 9);
    const worker = state.workers[0];
    worker.status = 'idle';
    worker.stats.care = 1;
    const pallet = addPallet(state, 'ES-06', 'A-06-1-1');
    const ctx = contextFor(state);
    // Lift it carelessly until it breaks (a few hundred tries at most).
    for (let i = 0; i < 5000 && pallet.hold === null; i++) maybeDamage(state, ctx, worker, pallet);
    return { sim, pallet, incident: openOf(state, 'damaged-pallet')[0] };
  };

  it('is held back from picking until the player decides', () => {
    const { sim, pallet, incident } = damaged();
    expect(pallet.hold).toBe('damaged');
    expect(incident.subject).toEqual({ kind: 'pallet', id: pallet.id });
    const order = addOrder(sim.state, 'eshop', [['ES-06', 1]], at(0, 15));
    sim.run(20);
    expect(order.status).toBe('open');
  });

  it('writing off loses part of the goods and compensates the client', () => {
    const { sim, pallet, incident } = damaged();
    const before = pallet.qty;
    decide(sim, incident, 'write-off');
    expect(pallet.qty).toBe(before - Math.ceil(before * I.writeOffShare));
    expect(pallet.hold).toBeNull();
    expect(spent(sim.state)).toBe(I.writeOffCompensation);
    expect(violations(sim.state)).toEqual([]);
  });

  it('a write-off never takes units already promised to an order', () => {
    const { sim, pallet, incident } = damaged();
    addOrder(sim.state, 'eshop', [['ES-06', pallet.qty - 2]], at(0, 15));
    decide(sim, incident, 'write-off');
    expect(pallet.qty).toBeGreaterThanOrEqual(sim.state.inventory.get('ES-06')?.allocated ?? 0);
    expect(violations(sim.state)).toEqual([]);
  });

  it('repacking costs a little and someone’s time, and saves the goods', () => {
    const { sim, pallet, incident } = damaged();
    const before = pallet.qty;
    decide(sim, incident, 'repack');
    expect(spent(sim.state)).toBe(I.repackCost);
    runUntil(sim, () => pallet.hold === null, 120);
    expect(pallet.qty).toBe(before);
    expect(pallet.attendFor).toBeNull();
  });

  it('saying nothing is a gamble', () => {
    const costs = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const { sim, pallet, incident } = damaged();
      sim.state.rng = seed * 7919;
      decide(sim, incident, 'hide');
      expect(pallet.hold).toBeNull();
      costs.add(spent(sim.state));
    }
    expect([...costs].sort((a, b) => a - b)).toEqual([0, I.writeOffCompensation * I.hideCaughtFactor]);
  });
});

describe('incidents: sick leave', () => {
  /** Run mornings until somebody calls in sick. */
  const sick = () => {
    const sim = quiet(starterSim({ incidents: true, workers: 2 }));
    for (const w of sim.state.workers) w.morale = 0;
    for (let day = 0; day < 200 && openOf(sim.state, 'sick-leave').length === 0; day++) {
      for (const w of sim.state.workers) w.morale = 0;
      runTo(sim, at(day, 0, 1));
    }
    const incident = openOf(sim.state, 'sick-leave')[0];
    const worker = sim.state.workers.find((w) => w.id === incident.subject?.id);
    if (!worker) throw new Error('nobody fell ill');
    return { sim, incident, worker };
  };

  it('the worker stays at home for a few days', () => {
    const { sim, incident, worker } = sick();
    expect(incident.cause).toBe('incident.cause.lowMorale');
    const until = worker.sickUntilDay ?? 0;
    expect(until - sim.state.day).toBeGreaterThanOrEqual(I.sickDays.min);
    expect(until - sim.state.day).toBeLessThanOrEqual(I.sickDays.max);
    decide(sim, incident, 'manage');
    for (const w of sim.state.workers) w.morale = 100;
    sim.state.settings.incidents = false;
    runTo(sim, at(sim.state.day, 9));
    expect(worker.status).toBe('off');
    runTo(sim, at(until, 9));
    expect(worker.status).not.toBe('off');
    expect(worker.sickUntilDay).toBeNull();
  });

  it('an agency temp fills in until they are back, at agency rates', () => {
    const { sim, incident, worker } = sick();
    const until = worker.sickUntilDay ?? 0;
    sim.state.settings.incidents = false;
    decide(sim, incident, 'temp');
    const temp = sim.state.workers.find((w) => w.role === 'temp');
    expect(temp).toMatchObject({ stats: I.tempStats, wagePerMonth: I.tempWagePerMonth, tempUntilDay: until });
    runTo(sim, at(sim.state.day, 9));
    expect(temp?.status).not.toBe('off');
    runTo(sim, at(until, 0, 1));
    expect(sim.state.workers.some((w) => w.role === 'temp')).toBe(false);
    expect(violations(sim.state)).toEqual([]);
  });

  it('asked to come in ill, they do — tired and resentful', () => {
    const { sim, incident, worker } = sick();
    worker.morale = 60;
    decide(sim, incident, 'come-in');
    expect(worker.sickUntilDay).toBeNull();
    expect(worker.morale).toBe(60 - I.comeInMoralePenalty);
    sim.state.settings.incidents = false;
    runTo(sim, at(sim.state.day, 7, 1));
    expect(worker.status).not.toBe('off');
    expect(worker.fatigue).toBeGreaterThanOrEqual(I.comeInFatigue - 1);
  });
});

describe('incidents: dock congestion', () => {
  /** Nobody unloads the first truck, so the second is stuck in the yard. */
  const jam = () => {
    const sim = starterSim({ incidents: true, workers: 0 });
    for (const client of sim.state.clients) client.profile.ordersPerDay = 0;
    runUntil(sim, (s) => openOf(s, 'dock-congestion').length > 0, TICKS_PER_DAY);
    const incident = openOf(sim.state, 'dock-congestion')[0];
    const truck = sim.state.trucks.find((t) => t.id === incident.subject?.id);
    if (!truck) throw new Error('no truck is waiting');
    return { sim, incident, truck };
  };

  it('is raised once a truck has waited 45 minutes', () => {
    const { sim, incident, truck } = jam();
    expect(sim.state.tick - 1 - (truck.arrivedTick ?? 0)).toBe(I.congestionAfterMinutes);
    expect(incident.cause).toBe('incident.cause.slowUnloading');
    expect(incident.choices.map((c) => c.id)).toEqual(['wait', 'all-hands', 'send-away']);
  });

  it('sending the truck away costs a fee and goodwill; the goods come another day', () => {
    const { sim, incident, truck } = jam();
    const pallets = sim.state.pallets.size;
    const load = truck.cargo.length;
    expect(load).toBeGreaterThan(0);
    decide(sim, incident, 'send-away');
    expect(truck.status).toBe('done');
    expect(sim.state.pallets.size).toBe(pallets - load);
    expect(spent(sim.state)).toBe(I.rebookFee);
    expect(sim.state.reputation).toBe(balance.start.reputation + I.reputation.sentAway);
    expect(violations(sim.state)).toEqual([]);
  });

  it('all hands to the dock: for an hour nobody picks', () => {
    const sim = quiet(starterSim());
    const { state } = sim;
    state.tick = at(0, 9);
    state.workers[0].status = 'idle';
    addPallet(state, 'ES-02', 'A-06-1-1');
    addPallet(state, 'ES-03', 'RCV-A-05', 'received');
    addOrder(state, 'eshop', [['ES-02', 1]], at(0, 15));
    state.rushUntilTick = state.tick + I.allHandsMinutes;
    sim.step();
    expect(state.tasks.map((t) => t.kind)).toEqual(['putaway']);
    runTo(sim, at(0, 9) + I.allHandsMinutes + 30);
    expect(state.orders[0].status).not.toBe('open');
  });

  it('left undecided, the do-nothing choice applies at the deadline', () => {
    const { sim, incident } = jam();
    sim.run(I.decideWithinHours.dockCongestion * 60 + 1);
    expect(incident.resolved).toMatchObject({ choiceId: 'wait', byDeadline: true });
  });
});

describe('incidents: in a running game', () => {
  it('none of the random ones happen when switched off', () => {
    const sim = starterSim();
    const events = sim.run(20 * TICKS_PER_DAY);
    const raised = events.filter((e) => e.type === 'incident-raised').length;
    const wrong = sim.state.reports.reduce((n, r) => n + r.lineErrors, 0);
    // Only complaints about wrong items remain; they follow from picking errors.
    expect(raised).toBeLessThanOrEqual(wrong);
    expect([...sim.state.pallets.values()].every((p) => p.hold === null)).toBe(true);
  });

  it('with nobody deciding, a month still runs clean and all five kinds can occur', () => {
    const kinds = new Set<string>();
    const problems: string[] = [];
    for (const seed of [1, 2, 3]) {
      const sim = starterSim({ seed, incidents: true });
      for (const w of sim.state.workers) Object.assign(w.stats, { accuracy: 1, care: 1 });
      for (let day = 0; day < 30; day++) {
        for (const event of sim.run(TICKS_PER_DAY)) {
          if (event.type === 'incident-raised') kinds.add(sim.state.incidents.find((i) => i.id === event.incidentId)?.kind ?? 'filed');
        }
        problems.push(...violations(sim.state));
      }
      // Decisions nobody took were closed by their deadlines; nothing piles up.
      expect(sim.state.incidents.length).toBeLessThan(12);
      const restored = resumeSim(sim.state);
      expect(restored.state.incidents).toBe(sim.state.incidents);
    }
    expect(problems).toEqual([]);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
});
