import { describe, expect, it } from 'vitest';
import { balance, eur } from '../src/data/balance';
import { createSim } from '../src/sim';
import type { Sim } from '../src/sim';
import { ledgerTotal, post } from '../src/sim/economy/ledger';
import { createWorker } from '../src/sim/state';
import { unbilledAmount } from '../src/sim/systems/finance';
import { TICKS_PER_DAY } from '../src/sim/time';
import type { LedgerEntry, LedgerKind } from '../src/sim/types';
import { addPallet, contextFor, quiet, starterSim } from './helpers';

const { daysPerMonth, daysPerWeek } = balance.time;
const entries = (sim: Sim, kind: LedgerKind): LedgerEntry[] =>
  sim.state.ledger.filter((e) => e.kind === kind);

describe('ledger', () => {
  it('eur() converts to integer cents', () => {
    expect(eur(1600)).toBe(160_000);
    expect(eur(1.2)).toBe(120);
    expect(eur(0.07)).toBe(7);
  });

  it('every posting moves cash and is recorded', () => {
    const { state } = createSim();
    const ctx = contextFor(state);
    post(state, ctx, 'demurrage', -3500, 'eshop');
    post(state, ctx, 'invoice', 12_345, 'eshop');
    expect(state.cash).toBe(balance.start.cash - 3500 + 12_345);
    expect(ledgerTotal(state)).toBe(8845);
    expect(ctx.events.filter((e) => e.type === 'money')).toHaveLength(2);
  });
});

describe('finance', () => {
  it('starts with the GDD cash and pays the first rent straight away', () => {
    const sim = quiet(createSim());
    expect(sim.state.cash).toBe(eur(15_000));
    sim.step();
    expect(sim.state.ledger).toEqual([
      { tick: 0, kind: 'rent', amount: -balance.rent.garagePerMonth, clientId: null },
    ]);
    expect(sim.state.cash).toBe(eur(15_000) - eur(900));
  });

  it('pays rent on the first day of every month', () => {
    const sim = quiet(createSim({ workers: 0 }));
    sim.run((2 * daysPerMonth + 1) * TICKS_PER_DAY);
    expect(entries(sim, 'rent').map((e) => e.tick)).toEqual([
      0,
      daysPerMonth * TICKS_PER_DAY,
      2 * daysPerMonth * TICKS_PER_DAY,
    ]);
  });

  it('wages are earned by the day and paid at the end of every week', () => {
    const sim = quiet(createSim({ workers: 2 }));
    const daily = Math.round(balance.worker.wagePerMonth / daysPerMonth);
    sim.run(6 * TICKS_PER_DAY);
    expect(entries(sim, 'wages')).toHaveLength(0);
    expect(sim.state.workers.map((w) => w.wagesOwed)).toEqual([6 * daily, 6 * daily]);

    sim.run(TICKS_PER_DAY);
    expect(entries(sim, 'wages')).toEqual([
      { tick: daysPerWeek * TICKS_PER_DAY - 1, kind: 'wages', amount: -2 * daysPerWeek * daily, clientId: null },
    ]);
    expect(sim.state.workers.map((w) => w.wagesOwed)).toEqual([0, 0]);
    // What the daily reports showed as wages is exactly what was paid.
    expect(sim.state.reports.reduce((sum, r) => sum + r.wages, 0)).toBe(2 * daysPerWeek * daily);

    sim.run(daysPerWeek * TICKS_PER_DAY);
    expect(entries(sim, 'wages')).toHaveLength(2);
  });

  it('someone who joins mid-week is paid for the days they were on the payroll', () => {
    const sim = quiet(createSim({ workers: 1 }));
    const daily = Math.round(balance.worker.wagePerMonth / daysPerMonth);
    sim.run(5 * TICKS_PER_DAY);
    createWorker(sim.state);
    sim.run(2 * TICKS_PER_DAY);
    expect(entries(sim, 'wages')[0].amount).toBe(-(7 + 2) * daily);
  });

  it('prices unbilled services per the contract', () => {
    const { state } = createSim();
    const client = state.clients[0];
    client.unbilled = { palletDays: 45, storageFees: 1200, palletsReceived: 7, lines: 100 };
    const { receivingFeePerPallet, pickFeePerLine } = client.contract;
    expect(unbilledAmount(client)).toBe(1200 + 7 * receivingFeePerPallet + 100 * pickFeePerLine);
  });

  it('charges storage per pallet per day in a rack', () => {
    const sim = quiet(starterSim({ workers: 0 }));
    addPallet(sim.state, 'ES-01', 'A-06-1-1');
    addPallet(sim.state, 'ES-02', 'A-06-1-2');
    addPallet(sim.state, 'WS-01', 'A-06-1-3');
    addPallet(sim.state, 'ES-03', 'RCV-A-00', 'received'); // not stored yet: free
    sim.run(3 * TICKS_PER_DAY);
    const byId = Object.fromEntries(sim.state.clients.map((c) => [c.id, c.unbilled.palletDays]));
    expect(byId).toEqual({ eshop: 6, wholesale: 3 });
    const fee = sim.state.clients[0].contract.storageFeePerPalletMonth;
    expect(sim.state.reports[0].revenue).toBe(
      Math.round((2 * fee) / daysPerMonth) +
        Math.round(sim.state.clients[1].contract.storageFeePerPalletMonth / daysPerMonth),
    );
  });

  it('invoices at month end and gets paid 30 days later', () => {
    const sim = quiet(starterSim({ workers: 0 }));
    for (let i = 1; i <= 3; i++) addPallet(sim.state, 'ES-01', `A-06-1-${i}`);

    sim.run(daysPerMonth * TICKS_PER_DAY);
    const { state } = sim;
    const fee = state.clients[0].contract.storageFeePerPalletMonth;
    expect(state.invoices).toEqual([
      {
        id: expect.any(Number),
        clientId: 'eshop',
        issuedDay: daysPerMonth - 1,
        dueDay: daysPerMonth - 1 + balance.invoicing.paymentTermDays,
        amount: 3 * fee,
        paid: false,
      },
    ]);
    expect(state.clients[0].unbilled).toEqual({ palletDays: 0, storageFees: 0, palletsReceived: 0, lines: 0 });
    expect(entries(sim, 'invoice')).toHaveLength(0);

    const due = state.invoices[0].dueDay;
    sim.run((due - daysPerMonth) * TICKS_PER_DAY);
    expect(entries(sim, 'invoice')).toHaveLength(0);
    sim.step();
    expect(entries(sim, 'invoice')).toEqual([
      { tick: due * TICKS_PER_DAY, kind: 'invoice', amount: 3 * fee, clientId: 'eshop' },
    ]);
    expect(state.invoices[0].paid).toBe(true);

    // Never paid twice.
    sim.run(5 * TICKS_PER_DAY);
    expect(entries(sim, 'invoice')).toHaveLength(1);
  });

  it('closes each day with a report and a clean slate', () => {
    const sim = quiet(createSim());
    const events = sim.run(2 * TICKS_PER_DAY);
    const closes = events.filter((e) => e.type === 'day-ended');
    expect(closes.map((e) => e.tick)).toEqual([TICKS_PER_DAY - 1, 2 * TICKS_PER_DAY - 1]);
    expect(sim.state.reports.map((r) => r.day)).toEqual([0, 1]);
    const report = sim.state.reports[0];
    expect(report.wages).toBe(Math.round(balance.worker.wagePerMonth / daysPerMonth));
    expect(report.rent).toBe(Math.round(balance.rent.garagePerMonth / daysPerMonth));
    expect(report).toMatchObject({ otif: null, errorRate: null, costPerLine: null, cash: sim.state.cash });
    expect(report.shiftMinutes).toBe(balance.shift.end - balance.shift.start);
    expect(sim.state.today.shiftMinutes).toBe(0);
  });
});
