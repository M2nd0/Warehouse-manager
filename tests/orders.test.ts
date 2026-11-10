import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import * as orders from '../src/sim/systems/orders';
import { TICKS_PER_DAY } from '../src/sim/time';
import type { GameState } from '../src/sim/types';
import { addOrder, addPallet, at, contextFor, starterSim, violations } from './helpers';

/** No staff, no deliveries: only the order book moves. */
function shop() {
  const sim = starterSim({ workers: 0 });
  for (const client of sim.state.clients) client.profile.targetPallets = {};
  return sim;
}

function stock(state: GameState, skus: string[]): void {
  const slots = [...state.locations.values()].filter((l) => l.kind === 'rack' && l.level === 1);
  skus.forEach((skuId, i) => addPallet(state, skuId, slots[i].id));
}

describe('orders', () => {
  it('nobody can order what is not in stock', () => {
    const sim = shop();
    sim.run(TICKS_PER_DAY);
    expect(sim.state.orders).toHaveLength(0);
    expect(sim.state.reports[0].ordersCreated).toBe(0);
  });

  it('arrive through the day at roughly the contracted rate', () => {
    const sim = shop();
    // Plenty of everything, so that nothing sells out during the test.
    const everything = ['ES-01', 'ES-02', 'ES-03', 'ES-04', 'ES-05', 'ES-06'];
    stock(sim.state, Array.from({ length: 36 }, (_, i) => everything[i % everything.length]));
    const days = 8;
    sim.run(days * TICKS_PER_DAY);
    const created = sim.state.reports.reduce((n, r) => n + r.ordersCreated, 0);
    const perDay = created / days;
    expect(perDay).toBeGreaterThan(balance.contracts.eshop.ordersPerDay * 0.8);
    expect(perDay).toBeLessThan(balance.contracts.eshop.ordersPerDay * 1.2);
  });

  it('follow the hourly profile: wholesale orders only come in business hours', () => {
    const sim = shop();
    stock(sim.state, ['WS-01', 'WS-01', 'WS-02', 'WS-02', 'WS-03', 'WS-04']);
    sim.state.clients.find((c) => c.id === 'wholesale')!.profile.ordersPerDay = 3;
    const created = sim.run(TICKS_PER_DAY).filter((e) => e.type === 'order-created');
    expect(created.length).toBeGreaterThan(0);
    for (const event of created) {
      const hour = Math.floor((event.tick % TICKS_PER_DAY) / 60);
      expect(balance.contracts.wholesale.hourlyWeights[hour]).toBeGreaterThan(0);
    }
  });

  it('allocate stock and never oversell it', () => {
    const sim = shop();
    stock(sim.state, ['ES-05', 'ES-06']); // 36 + 24 units of slow movers only
    for (let i = 0; i < 3 * TICKS_PER_DAY; i++) {
      sim.step();
      expect(violations(sim.state)).toEqual([]);
    }
    const { state } = sim;
    const ordered = (skuId: string): number =>
      state.orders.flatMap((o) => o.lines).filter((l) => l.skuId === skuId).reduce((n, l) => n + l.qty, 0);
    expect(ordered('ES-05')).toBe(36);
    expect(ordered('ES-06')).toBe(24);
    expect(state.inventory.get('ES-05')).toEqual({ stored: 36, allocated: 36 });
    // Sold out: nothing else in the order book.
    expect(state.orders.flatMap((o) => o.lines).every((l) => l.skuId === 'ES-05' || l.skuId === 'ES-06')).toBe(true);
    expect(state.orders.every((o) => o.lines.every((l) => l.qty > 0))).toBe(true);
  });

  it('e-shop orders are a few pieces of different SKUs', () => {
    const sim = shop();
    stock(sim.state, ['ES-01', 'ES-02', 'ES-03', 'ES-04', 'ES-05', 'ES-06']);
    sim.run(TICKS_PER_DAY);
    const eshop = sim.state.orders.filter((o) => o.clientId === 'eshop');
    expect(eshop.length).toBeGreaterThan(10);
    for (const order of eshop) {
      expect(order.mode).toBe('each');
      expect(order.lines.length).toBeGreaterThanOrEqual(1);
      expect(order.lines.length).toBeLessThanOrEqual(balance.contracts.eshop.linesPerOrder.length);
      expect(new Set(order.lines.map((l) => l.skuId)).size).toBe(order.lines.length);
      for (const line of order.lines) expect(line.qty).toBeLessThanOrEqual(balance.contracts.eshop.qtyPerLine.length);
    }
  });

  it('wholesale orders are whole pallets', () => {
    const sim = shop();
    stock(sim.state, ['WS-01', 'WS-01', 'WS-02', 'WS-02', 'WS-03', 'WS-03', 'WS-04', 'WS-04']);
    sim.state.clients.find((c) => c.id === 'wholesale')!.profile.ordersPerDay = 4;
    sim.run(TICKS_PER_DAY);
    const wholesale = sim.state.orders.filter((o) => o.clientId === 'wholesale');
    expect(wholesale.length).toBeGreaterThan(0);
    for (const order of wholesale) {
      expect(order.mode).toBe('pallet');
      for (const line of order.lines) {
        const perPallet = sim.state.skus.get(line.skuId)!.unitsPerPallet;
        expect(line.qty % perPallet).toBe(0);
        expect(line.qty).toBeGreaterThan(0);
      }
    }
  });

  it('get the deadline of the carrier departure the SLA requires', () => {
    const sim = shop();
    stock(sim.state, ['ES-01', 'ES-02', 'ES-03', 'ES-04']);
    sim.run(TICKS_PER_DAY);
    const { departMinute } = balance.trucks.pickup;
    for (const order of sim.state.orders) {
      const beforeCutoff = order.createdTick <= sim.state.clients[0].contract.cutoffMinute;
      expect(order.deadlineTick).toBe(beforeCutoff ? departMinute : TICKS_PER_DAY + departMinute);
    }
  });

  it('missing the deadline is flagged and penalised exactly once', () => {
    const sim = shop();
    const { state } = sim;
    stock(state, ['ES-01']);
    state.clients.forEach((c) => (c.profile.ordersPerDay = 0));
    state.tick = at(0, 14, 59);
    const order = addOrder(state, 'eshop', [['ES-01', 1]], at(0, 15));

    orders.step(state, contextFor(state));
    expect(order.late).toBe(false);

    state.tick = at(0, 15);
    const ctx = contextFor(state);
    orders.step(state, ctx);
    orders.step(state, ctx);
    const penalty = state.clients[0].contract.latePenalty;
    expect(order.late).toBe(true);
    expect(state.ledger).toEqual([{ tick: at(0, 15), kind: 'penalty-late', amount: -penalty, clientId: 'eshop' }]);
    expect(state.today).toMatchObject({ ordersLate: 1, penalties: penalty });
    expect(state.clients[0].month.late).toBe(1);
    expect(ctx.events.filter((e) => e.type === 'order-late')).toHaveLength(1);
  });
});
