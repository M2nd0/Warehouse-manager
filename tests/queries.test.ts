import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import {
  activityOf,
  cashflow,
  contractEndDay,
  dockDay,
  labourUseToday,
  monthToDate,
  openOrders,
  otifToday,
  palletWeight,
  palletsOf,
  rackContents,
  truckBoard,
  unbilledOf,
  unresolvedIncidents,
} from '../src/sim/queries';
import { unbilledAmount } from '../src/sim/systems/finance';
import { TICKS_PER_DAY } from '../src/sim/time';
import { addOrder, addPallet, at, quiet, runTo, runUntil, starterSim } from './helpers';

const { daysPerMonth, daysPerWeek } = balance.time;

describe('queries: operations', () => {
  it('OTIF and labour use of the day in progress', () => {
    const sim = starterSim();
    expect(otifToday(sim.state)).toBeNull();
    expect(labourUseToday(sim.state)).toBeNull();
    runTo(sim, at(1, 15, 1));
    const { today } = sim.state;
    expect(otifToday(sim.state)).toBe(today.ordersPerfect / (today.ordersOnTime + today.ordersLate));
    expect(labourUseToday(sim.state)).toBeCloseTo(today.busyMinutes / today.shiftMinutes, 12);
  });

  it('the truck board lists what is coming in the order it comes, without trucks that left', () => {
    const sim = starterSim();
    sim.step();
    const board = truckBoard(sim.state);
    expect(board).toHaveLength(3);
    expect(board.map((t) => t.etaTick)).toEqual([...board.map((t) => t.etaTick)].sort((a, b) => a - b));
    expect(board[2].kind).toBe('pickup');
    runTo(sim, at(0, 15, 1));
    expect(truckBoard(sim.state).some((t) => t.kind === 'pickup')).toBe(false);
  });

  it('open orders come most urgent first', () => {
    const { state } = quiet(starterSim());
    addPallet(state, 'ES-01', 'A-06-1-1');
    const tomorrow = addOrder(state, 'eshop', [['ES-01', 1]], at(1, 15));
    const today = addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));
    const gone = addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));
    gone.status = 'shipped';
    expect(openOrders(state).map((o) => o.id)).toEqual([today.id, tomorrow.id]);
  });

  it('counts incidents that still wait for a decision', () => {
    const { state } = createSim();
    expect(unresolvedIncidents(state)).toBe(0);
    const base = { kind: 'sick-leave' as const, cause: 'c', subject: null, cell: null, createdTick: 0, deadlineTick: null, choices: [], params: {} };
    state.incidents.push({ ...base, id: 1, resolved: null }, { ...base, id: 2, resolved: { choiceId: 'a', tick: 5, byDeadline: false } });
    expect(unresolvedIncidents(state)).toBe(1);
  });
});

describe('queries: people', () => {
  it('says what a worker is doing', () => {
    const sim = quiet(starterSim());
    const { state } = sim;
    const worker = state.workers[0];
    expect(activityOf(state, worker)).toMatchObject({ status: 'off', task: null, step: null });

    state.tick = at(0, 9);
    worker.status = 'idle';
    addPallet(state, 'ES-01', 'A-27-1-3');
    const order = addOrder(state, 'eshop', [['ES-01', 2]], at(0, 15));
    sim.step();
    expect(activityOf(state, worker)).toMatchObject({
      status: 'walking',
      task: 'pick',
      step: 'walk',
      target: { kind: 'loc', id: 'A-27-1-3' },
      orderId: order.id,
      progress: null,
    });

    runUntil(sim, () => worker.status === 'working' && worker.workLeft < worker.workTotal, 30);
    const working = activityOf(state, worker);
    // Picking two pieces takes under a minute, so the first step caught half-done may be the packing.
    expect(working).toMatchObject({ task: 'pick', target: null });
    expect(['pick', 'pack']).toContain(working.step);
    expect(working.progress).toBeGreaterThan(0);
    expect(working.progress).toBeLessThan(1);
  });
});

describe('queries: storage', () => {
  it('lists a rack top level first, with what stands where', () => {
    const { state } = quiet(starterSim());
    const pallet = addPallet(state, 'ES-03', 'A-06-1-2');
    const rack = state.racks.find((r) => r.x === 6 && r.y === 0);
    const levels = rackContents(state, rack?.id ?? -1);
    expect(levels.map((l) => l.level)).toEqual([3, 2, 1]);
    expect(levels[2].slots.map((s) => s.locId)).toEqual(['A-06-1-1', 'A-06-1-2', 'A-06-1-3']);
    expect(levels[2].slots[1].pallet?.id).toBe(pallet.id);
    expect(levels[2].slots[0]).toMatchObject({ pallet: null, reserved: false, capacityKg: balance.rack.capacityKg });
    expect(palletWeight(state, pallet)).toBeCloseTo(60 * 2.8, 9);
  });

  it('adds up how long trucks stood at the dock today', () => {
    const sim = starterSim();
    const dock = sim.state.hall.docks[0];
    runTo(sim, at(0, 7));
    expect(dockDay(sim.state, dock.id)).toEqual({ busyMinutes: 0, elapsedMinutes: 7 * 60, trucks: 0 });
    runTo(sim, at(0, 16));
    const day = dockDay(sim.state, dock.id);
    expect(day.trucks).toBe(3);
    // The carrier alone stands there for half an hour.
    expect(day.busyMinutes).toBeGreaterThan(30);
    expect(day.busyMinutes).toBeLessThan(9 * 60);
    // A new day starts from zero.
    runTo(sim, at(1, 0, 1));
    expect(dockDay(sim.state, dock.id).busyMinutes).toBe(0);
  });
});

describe('queries: clients', () => {
  it('unbilled fees match what the invoice will say', () => {
    const sim = starterSim();
    sim.run(5 * TICKS_PER_DAY);
    for (const client of sim.state.clients) {
      expect(unbilledOf(sim.state, client.id)).toBe(unbilledAmount(client));
      expect(unbilledOf(sim.state, client.id)).toBeGreaterThan(0);
      expect(palletsOf(sim.state, client.id)).toBeGreaterThan(0);
    }
    expect(unbilledOf(sim.state, 'nobody')).toBe(0);
    expect(contractEndDay(sim.state.clients[0].contract)).toBe(6 * daysPerMonth);
  });
});

describe('queries: finance', () => {
  it('month to date: what was earned and what it cost', () => {
    const sim = starterSim();
    sim.run(10 * TICKS_PER_DAY + 9 * 60);
    const { state } = sim;
    const m = monthToDate(state);
    expect(m.month).toBe(0);
    expect(m.earned).toBe(state.reports.reduce((sum, r) => sum + r.revenue, 0) + state.today.revenue);
    expect(m.rent).toBe(balance.rent.garagePerMonth);
    expect(m.wages).toBe(10 * Math.round(balance.worker.wagePerMonth / daysPerMonth));
    const fines = state.ledger
      .filter((e) => e.kind.startsWith('penalty') || e.kind === 'demurrage')
      .reduce((sum, e) => sum - e.amount, 0);
    expect(m.penalties).toBe(fines);
    expect(m.construction).toBe(0);
    expect(m.profit).toBe(m.earned - m.wages - m.rent - m.penalties);
  });

  it('month to date starts afresh in a new month and counts building separately', () => {
    const sim = quiet(createSim({ workers: 0 }));
    sim.run(daysPerMonth * TICKS_PER_DAY + 1);
    sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' });
    const m = monthToDate(sim.state);
    expect(m).toMatchObject({ month: 1, earned: 0, wages: 0, rent: balance.rent.garagePerMonth, construction: balance.rack.price });
    expect(m.profit).toBe(-balance.rent.garagePerMonth);
  });

  it('the cash-flow projection agrees with what then actually happens', () => {
    // Nothing random in a quiet warehouse: rent, wages and one invoice.
    const sim = quiet(starterSim());
    for (let i = 1; i <= 3; i++) addPallet(sim.state, 'ES-01', `A-06-1-${i}`);
    sim.run(daysPerMonth * TICKS_PER_DAY + 10 * 60);
    const forecast = cashflow(sim.state, 35);
    expect(forecast).toHaveLength(36);
    expect(forecast[0].day).toBe(sim.state.day);

    const pays = forecast.flatMap((d) => d.items.filter((i) => i.kind === 'wages').map(() => d.day));
    expect(pays.every((day) => (day + 1) % daysPerWeek === 0)).toBe(true);
    const invoiceDay = forecast.find((d) => d.items.some((i) => i.kind === 'invoice'));
    expect(invoiceDay?.day).toBe(sim.state.invoices[0].dueDay);
    expect(forecast.find((d) => d.items.some((i) => i.kind === 'rent'))?.day).toBe(2 * daysPerMonth);

    for (const point of forecast) {
      runTo(sim, (point.day + 1) * TICKS_PER_DAY);
      expect(sim.state.cash, `end of day ${point.day}`).toBe(point.cash);
    }
  });

  it('on the stroke of midnight today’s rent is still to come', () => {
    const sim = quiet(createSim({ workers: 0 }));
    const first = cashflow(sim.state, 2)[0];
    expect(first.items).toEqual([{ kind: 'rent', amount: -balance.rent.garagePerMonth, clientId: null }]);
    sim.step();
    expect(cashflow(sim.state, 2)[0].items).toEqual([]);
    expect(cashflow(sim.state, 2)[0].cash).toBe(sim.state.cash);
  });
});
