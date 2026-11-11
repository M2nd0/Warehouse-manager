import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import { errorFactor, exhaustion, headcount, marketWage, mispickChance, speedFactor, updateMorale } from '../src/sim/people';
import { TICKS_PER_DAY } from '../src/sim/time';
import { addOrder, addPallet, at, quiet, runTo, runUntil, starterSim, violations } from './helpers';

const P = balance.people;

describe('people: fatigue and training', () => {
  it('a busy shift tires an average worker to about the threshold; a night’s rest clears it', () => {
    const sim = starterSim();
    const worker = sim.state.workers[0];
    runTo(sim, at(2, 15, 29));
    const busyShare = sim.state.today.busyMinutes / sim.state.today.shiftMinutes;
    expect(worker.fatigue).toBeGreaterThan(40 * busyShare);
    expect(worker.fatigue).toBeLessThan(P.fatigue.threshold + 5);
    runTo(sim, at(3, 7, 1));
    expect(worker.fatigue).toBeLessThan(1);
  });

  it('stamina decides how fast', () => {
    const tiredness = (stamina: number): number => {
      const sim = starterSim();
      sim.state.workers[0].stats.stamina = stamina;
      runTo(sim, at(1, 15));
      return sim.state.workers[0].fatigue;
    };
    expect(tiredness(1)).toBeGreaterThan(tiredness(3));
    expect(tiredness(3)).toBeGreaterThan(tiredness(5));
  });

  it('above 70 % fatigue people get slower and make more mistakes', () => {
    const { state } = createSim();
    const worker = state.workers[0];
    worker.fatigue = P.fatigue.threshold;
    expect(exhaustion(worker)).toBe(0);
    expect(speedFactor(worker, 0)).toBe(1);
    expect(errorFactor(worker, 0)).toBe(1);
    worker.fatigue = 100;
    expect(speedFactor(worker, 0)).toBeCloseTo(1 - P.fatigue.maxSpeedLoss, 9);
    expect(errorFactor(worker, 0)).toBeCloseTo(P.fatigue.maxErrorFactor, 9);
    worker.fatigue = 85;
    expect(speedFactor(worker, 0)).toBeCloseTo(1 - P.fatigue.maxSpeedLoss / 2, 9);
  });

  it('GDD: a new hire works at half speed with twice the errors for a week', () => {
    const { state } = createSim();
    const worker = state.workers[0];
    const usual = mispickChance(worker, 0);
    worker.trainingUntilDay = P.trainingDays;
    expect(speedFactor(worker, 0)).toBe(P.trainingSpeedFactor);
    expect(mispickChance(worker, P.trainingDays - 1)).toBeCloseTo(usual * P.trainingErrorFactor, 12);
    expect(speedFactor(worker, P.trainingDays)).toBe(1);
  });

  it('overtime and exhaustion pull morale down, a generous wage pulls it up', () => {
    const { state } = createSim();
    const worker = state.workers[0];
    updateMorale(worker);
    expect(worker.morale).toBeCloseTo(P.morale.base, 9);
    worker.overtimeToday = 120;
    worker.fatigue = 90;
    updateMorale(worker);
    expect(worker.morale).toBeLessThan(P.morale.base);
    expect(worker.overtimeToday).toBe(0);
    const before = worker.morale;
    worker.fatigue = 0;
    worker.wagePerMonth = marketWage(worker.stats) + 40_000;
    updateMorale(worker);
    expect(worker.morale).toBeGreaterThan(before);
  });
});

describe('people: hiring and dismissing', () => {
  it('three applicants a day, asking what their stats are worth', () => {
    const sim = quiet(createSim());
    expect(sim.state.candidates).toHaveLength(0);
    sim.step();
    const first = sim.state.candidates.map((c) => c.id);
    expect(first).toHaveLength(P.candidatesPerDay);
    for (const candidate of sim.state.candidates) {
      expect(candidate.wagePerMonth).toBe(marketWage(candidate.stats));
      for (const stat of Object.values(candidate.stats)) {
        expect(stat).toBeGreaterThanOrEqual(1);
        expect(stat).toBeLessThanOrEqual(5);
      }
    }
    sim.run(TICKS_PER_DAY);
    expect(sim.state.candidates.map((c) => c.id)).not.toEqual(first);
    // An average worker is worth the GDD wage.
    expect(marketWage({ speed: 3, accuracy: 3, care: 3, stamina: 3 })).toBe(balance.worker.wagePerMonth);
  });

  it('a hire joins in training, up to the staff limit', () => {
    const sim = quiet(createSim());
    sim.step();
    const [a, b, c] = sim.state.candidates;
    expect(sim.dispatch({ type: 'hire', candidateId: a.id })).toMatchObject({ ok: true, events: [{ type: 'worker-hired' }] });
    const hired = sim.state.workers[1];
    expect(hired).toMatchObject({ name: a.name, stats: a.stats, wagePerMonth: a.wagePerMonth, trainingUntilDay: P.trainingDays });
    expect(sim.state.candidates).toHaveLength(2);
    expect(sim.dispatch({ type: 'hire', candidateId: a.id })).toEqual({ ok: false, error: 'unknown-candidate' });
    expect(sim.dispatch({ type: 'hire', candidateId: b.id })).toMatchObject({ ok: true });
    expect(headcount(sim.state)).toBe(P.maxStaff);
    expect(sim.dispatch({ type: 'hire', candidateId: c.id })).toEqual({ ok: false, error: 'staff-limit' });
    // The newcomer turns up for the shift.
    runTo(sim, at(0, 7, 1));
    expect(hired.status).toBe('idle');
  });

  it('dismissing pays what is owed; the last person cannot be dismissed', () => {
    const sim = quiet(createSim({ workers: 2 }));
    sim.run(3 * TICKS_PER_DAY);
    const [first, second] = sim.state.workers;
    const owed = second.wagesOwed;
    expect(owed).toBeGreaterThan(0);
    const cash = sim.state.cash;
    expect(sim.dispatch({ type: 'dismiss', workerId: second.id })).toMatchObject({ ok: true, events: [{ type: 'money' }, { type: 'worker-left' }] });
    expect(sim.state.workers).toHaveLength(1);
    expect(sim.state.cash).toBe(cash - owed);
    expect(sim.dispatch({ type: 'dismiss', workerId: first.id })).toEqual({ ok: false, error: 'last-worker' });
    expect(sim.dispatch({ type: 'dismiss', workerId: 999 })).toEqual({ ok: false, error: 'unknown-worker' });
  });

  it('someone dismissed mid-task finishes it first, then goes', () => {
    const sim = quiet(starterSim({ workers: 2 }));
    const { state } = sim;
    state.tick = at(0, 9);
    for (const w of state.workers) w.status = 'idle';
    addPallet(state, 'ES-01', 'A-27-1-3');
    const order = addOrder(state, 'eshop', [['ES-01', 2]], at(0, 15));
    sim.step();
    const picker = state.workers.find((w) => w.taskId !== null);
    if (!picker) throw new Error('nobody took the order');
    expect(sim.dispatch({ type: 'dismiss', workerId: picker.id })).toMatchObject({ ok: true });
    expect(picker.leaving).toBe(true);
    runUntil(sim, () => !state.workers.includes(picker), 120);
    expect(order.status).toBe('ready');
    expect(violations(state)).toEqual([]);
  });
});

describe('people: duties', () => {
  const scene = () => {
    const sim = quiet(starterSim());
    const { state } = sim;
    state.tick = at(0, 9);
    state.workers[0].status = 'idle';
    addPallet(state, 'ES-02', 'A-06-1-1');
    addPallet(state, 'ES-03', 'RCV-A-05', 'received');
    addOrder(state, 'eshop', [['ES-02', 1]], at(0, 15));
    return sim;
  };

  it('someone on receiving duty leaves the picking alone, and the other way round', () => {
    const inbound = scene();
    inbound.dispatch({ type: 'set-duty', workerId: inbound.state.workers[0].id, duty: 'inbound' });
    inbound.step();
    expect(inbound.state.tasks.map((t) => t.kind)).toEqual(['putaway']);

    const picking = scene();
    picking.state.orders.length = 0;
    picking.dispatch({ type: 'set-duty', workerId: picking.state.workers[0].id, duty: 'picking' });
    picking.run(5);
    expect(picking.state.tasks).toHaveLength(0);
    expect([...picking.state.pallets.values()].some((p) => p.status === 'received')).toBe(true);

    expect(scene().dispatch({ type: 'set-duty', workerId: 999, duty: 'all' })).toEqual({ ok: false, error: 'unknown-worker' });
  });
});
