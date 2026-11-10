import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import { createContext } from '../src/sim/context';
import * as clock from '../src/sim/systems/clock';
import { nextPickupDeparture, slaDeadline } from '../src/sim/time';
import { at } from './helpers';

describe('clock', () => {
  it('one step is one in-game minute', () => {
    const sim = createSim();
    expect(sim.state.tick).toBe(0);
    sim.step();
    expect(sim.state.tick).toBe(1);
    sim.run(59);
    expect(sim.state.tick).toBe(60);
  });

  it('a day is 1440 ticks', () => {
    const sim = createSim({ workers: 0, clients: [] });
    sim.run(1439);
    expect(sim.state.day).toBe(0);
    sim.step();
    expect(sim.state.day).toBe(1);
    expect(sim.state.tick).toBe(1440);
  });

  it('tells systems where in the day the tick falls', () => {
    const { state } = createSim();
    const ctx = createContext();

    clock.step(state, ctx);
    expect(ctx).toMatchObject({ minute: 0, dayStart: true, dayEnd: false });

    state.tick = at(3, 8, 15);
    clock.step(state, ctx);
    expect(ctx).toMatchObject({ minute: 495, dayStart: false, dayEnd: false });

    state.tick = at(3, 23, 59);
    clock.step(state, ctx);
    expect(ctx).toMatchObject({ minute: 1439, dayStart: false, dayEnd: true });
  });

  it('knows the next carrier departure', () => {
    const { departMinute } = balance.trucks.pickup;
    expect(nextPickupDeparture(at(0, 9))).toBe(departMinute);
    expect(nextPickupDeparture(departMinute - 1)).toBe(departMinute);
    // At the departure minute itself the carrier is gone: next one is tomorrow.
    expect(nextPickupDeparture(departMinute)).toBe(at(1, 0) + departMinute);
    expect(nextPickupDeparture(at(2, 22))).toBe(at(3, 0) + departMinute);
  });
});

describe('SLA deadline', () => {
  const { contract } = createSim().state.clients[0];
  const { departMinute } = balance.trucks.pickup;

  it('ordered before the cutoff → leaves with today’s carrier', () => {
    expect(slaDeadline(contract, at(0, 0, 30))).toBe(departMinute);
    expect(slaDeadline(contract, at(4, 9))).toBe(at(4, 0) + departMinute);
    expect(slaDeadline(contract, at(4, 0) + contract.cutoffMinute)).toBe(at(4, 0) + departMinute);
  });

  it('ordered after the cutoff → leaves with tomorrow’s carrier', () => {
    expect(slaDeadline(contract, at(4, 0) + contract.cutoffMinute + 1)).toBe(at(5, 0) + departMinute);
    expect(slaDeadline(contract, at(4, 14, 59))).toBe(at(5, 0) + departMinute);
    expect(slaDeadline(contract, at(4, 23, 30))).toBe(at(5, 0) + departMinute);
  });

  it('is never in the past and never more than the SLA after the cutoff rule allows', () => {
    for (let tick = 0; tick < at(3, 0); tick += 17) {
      const deadline = slaDeadline(contract, tick);
      expect(deadline).toBeGreaterThan(tick);
      expect(deadline - tick).toBeLessThanOrEqual((contract.slaHours + 24) * 60);
    }
  });
});
