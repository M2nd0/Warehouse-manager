import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { SAVE_VERSION, resumeSim } from '../src/sim';
import type { SimEvent } from '../src/sim';
import { ledgerTotal } from '../src/sim/economy/ledger';
import { TICKS_PER_DAY } from '../src/sim/time';
import { deserializeState, readState, serializeState } from '../src/save/serialize';
import { formatDailyReport } from '../src/ui/reportText';
import { starterSim, violations } from './helpers';

describe('three days in the garage, headless', () => {
  const sim = starterSim({ seed: 1 });
  const events: SimEvent[] = [];
  const problems: string[] = [];
  for (let i = 0; i < 3 * TICKS_PER_DAY; i++) {
    for (const event of sim.step()) events.push(event);
    for (const problem of violations(sim.state)) problems.push(problem);
  }
  const { state } = sim;
  const count = (type: SimEvent['type']): number => events.filter((e) => e.type === type).length;

  it('prints a daily report for each day', () => {
    expect(state.reports).toHaveLength(3);
    expect(state.reports.map((r) => r.day)).toEqual([0, 1, 2]);
    for (const report of state.reports) console.log(`${formatDailyReport(report)}\n`);
  });

  it('keeps the books consistent on every single tick', () => {
    expect(problems).toEqual([]);
  });

  it('runs the whole flow: truck → pallets → locations → orders → dispatch', () => {
    expect(count('truck-arrived')).toBeGreaterThanOrEqual(6); // 2 clients + carrier, 3 days
    expect(count('pallet-received')).toBeGreaterThan(20);
    expect(count('pallet-stored')).toBeGreaterThan(20);
    expect(count('order-created')).toBeGreaterThan(40);
    expect(count('order-ready')).toBeGreaterThan(40);
    expect(count('order-shipped')).toBeGreaterThan(40);
    expect(count('pickup-missed')).toBe(0);
    // Goods of both clients have gone out.
    const shippedPallets = state.reports.reduce((n, r) => n + r.palletsShipped, 0);
    expect(shippedPallets).toBeGreaterThan(0);
    // Pallets in the racks are spread around (chaos), all on the floor level.
    const stored = [...state.pallets.values()].filter((p) => p.status === 'stored');
    expect(stored.length).toBeGreaterThan(15);
    for (const pallet of stored) expect(state.locations.get(pallet.locId)?.level).toBe(1);
  });

  it('OTIF is above zero', () => {
    const due = state.reports.reduce((n, r) => n + r.ordersOnTime + r.ordersLate, 0);
    const perfect = state.reports.reduce((n, r) => n + r.ordersPerfect, 0);
    expect(due).toBeGreaterThan(0);
    expect(perfect / due).toBeGreaterThan(0);
    for (const report of state.reports) {
      expect(report.otif).not.toBeNull();
      expect(report.otif).toBeGreaterThan(0);
      expect(report.otif).toBeLessThanOrEqual(1);
    }
    // With the default balance one warehouseman copes with the first days.
    expect(perfect / due).toBeGreaterThan(0.8);
  });

  it('reports error rate and cost per line', () => {
    const last = state.reports[2];
    expect(last.linesPicked).toBeGreaterThan(20);
    expect(last.errorRate).toBeGreaterThanOrEqual(0);
    expect(last.errorRate).toBeLessThan(0.2);
    expect(last.costPerLine).toBe(Math.round((last.wages + last.rent) / last.linesPicked));
  });

  it('cash changes match the ledger', () => {
    expect(state.cash - balance.start.cash).toBe(ledgerTotal(state));
    // …and the money events the UI was told about.
    const announced = events.reduce((sum, e) => (e.type === 'money' ? sum + e.entry.amount : sum), 0);
    expect(announced).toBe(ledgerTotal(state));
    expect(state.ledger.length).toBeGreaterThan(0);
    expect(state.ledger[0]).toMatchObject({ kind: 'rent', tick: 0 });
    // Every report's cash is the running ledger balance at the end of that day.
    for (const report of state.reports) {
      const upTo = (report.day + 1) * TICKS_PER_DAY;
      const balanceThen = state.ledger.filter((e) => e.tick < upTo).reduce((sum, e) => sum + e.amount, 0);
      expect(report.cash).toBe(balance.start.cash + balanceThen);
    }
  });
});

describe('determinism', () => {
  const play = (seed: number, days: number): string => {
    const sim = starterSim({ seed });
    sim.run(days * TICKS_PER_DAY);
    return serializeState(sim.state);
  };

  it('same seed and inputs → the same game, to the last bit', () => {
    expect(play(7, 4)).toBe(play(7, 4));
  });

  it('a different seed → a different game', () => {
    expect(play(7, 2)).not.toBe(play(8, 2));
  });

  it('a save resumes exactly where it left off', () => {
    const original = starterSim({ seed: 3 });
    // Stop mid-morning on day 2, with trucks at the dock and tasks under way.
    original.run(TICKS_PER_DAY + 10 * 60 + 17);
    expect(original.state.tasks.length).toBeGreaterThan(0);

    const save = serializeState(original.state);
    const restored = resumeSim(deserializeState(save));
    expect(serializeState(restored.state)).toBe(save);
    expect(restored.state.locations).toBeInstanceOf(Map);

    const a = original.run(2 * TICKS_PER_DAY);
    const b = restored.run(2 * TICKS_PER_DAY);
    expect(serializeState(restored.state)).toBe(serializeState(original.state));
    expect(b).toEqual(a);
  });

  it('a damaged file or a save of another version is turned away', () => {
    const sim = starterSim({ seed: 3 });
    const json = serializeState(sim.state);
    expect(readState(json, SAVE_VERSION)?.tick).toBe(0);
    expect(readState(json, SAVE_VERSION + 1)).toBeNull();
    expect(readState(json.slice(0, 200), SAVE_VERSION)).toBeNull();
    expect(readState('{"hello":1}', SAVE_VERSION)).toBeNull();
    expect(readState('null', SAVE_VERSION)).toBeNull();
  });

  it('a save is plain JSON', () => {
    const sim = starterSim({ seed: 3 });
    sim.run(TICKS_PER_DAY);
    const parsed = JSON.parse(serializeState(sim.state)) as Record<string, unknown>;
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.seed).toBe(3);
  });
});

describe('a longer run', () => {
  it('two months stay consistent and the first invoices get paid', () => {
    const built = starterSim({ seed: 11 });
    const problems: string[] = [];
    const days = 2 * balance.time.daysPerMonth + 1;
    for (let day = 0; day < days; day++) {
      built.run(TICKS_PER_DAY);
      for (const problem of violations(built.state)) problems.push(problem);
    }
    const { state } = built;
    expect(problems).toEqual([]);
    expect(state.reports).toHaveLength(days);
    expect(state.invoices.length).toBeGreaterThanOrEqual(2);
    expect(state.ledger.filter((e) => e.kind === 'invoice').length).toBeGreaterThanOrEqual(2);
    // What the daily reports showed as earned is exactly what gets invoiced.
    const { daysPerMonth } = balance.time;
    for (const month of [0, 1]) {
      const earned = state.reports
        .filter((r) => Math.floor(r.day / daysPerMonth) === month)
        .reduce((sum, r) => sum + r.revenue, 0);
      const invoiced = state.invoices
        .filter((i) => i.issuedDay === (month + 1) * daysPerMonth - 1)
        .reduce((sum, i) => sum + i.amount, 0);
      expect(invoiced).toBe(earned);
      expect(invoiced).toBeGreaterThan(0);
    }
    // Finished work does not pile up in the state.
    expect(state.orders.every((o) => o.status !== 'shipped')).toBe(true);
    expect(state.trucks.every((t) => t.status !== 'done')).toBe(true);
    expect(state.orders.length).toBeLessThan(120);
    // Clients keep their stock near the contracted level.
    expect(state.pallets.size).toBeGreaterThan(35);
    expect(state.pallets.size).toBeLessThanOrEqual(54 + 12);
  });
});
