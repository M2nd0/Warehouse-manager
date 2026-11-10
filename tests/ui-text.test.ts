import { describe, expect, it } from 'vitest';
import { t, tData } from '../src/data/i18n';
import en from '../src/data/i18n/en.json';
import { formatAmount, formatClock, formatMoney, formatPercent } from '../src/ui/format';
import { createStore, sameRef } from '../src/ui/store';
import { activityText, clientName, durationText, skuName, truckStatusText, whenText } from '../src/ui/text';
import { addOrder, addPallet, at, quiet, runUntil, starterSim } from './helpers';

describe('formatting', () => {
  it('money is cents in, grouped euros out', () => {
    expect(formatMoney(1_500_000, 0)).toBe('15 000 €');
    expect(formatMoney(123_456)).toBe('1 234.56 €');
    expect(formatMoney(-9_300)).toBe('−93.00 €');
    expect(formatAmount(99, 2)).toBe('0.99');
  });

  it('clock, percent', () => {
    expect(formatClock(at(3, 8, 5))).toBe('08:05');
    expect(formatClock(at(0, 23, 59))).toBe('23:59');
    expect(formatPercent(0.953)).toBe('95.3 %');
    expect(formatPercent(1, 0)).toBe('100 %');
  });

  it('durations', () => {
    expect(durationText(0)).toBe('0 min');
    expect(durationText(45)).toBe('45 min');
    expect(durationText(125)).toBe('2 h 05 min');
  });
});

describe('i18n', () => {
  it('fills placeholders and leaves unknown ones alone', () => {
    expect(t('hud.day', { day: 4 })).toBe('Day 4');
    expect(t('hud.day')).toBe('Day {day}');
  });

  it('data-driven keys fall back when there is no entry', () => {
    expect(tData('sku.ES-01', '?')).toBe('Pour-over coffee set');
    expect(tData('sku.NOPE', 'NOPE')).toBe('NOPE');
    expect(skuName('WS-04')).toBe('Rock salt, 25 kg bag');
    expect(clientName('eshop')).toBe('Hearth & Home');
    expect(clientName(null)).toBe('Carrier collection');
  });

  it('every SKU and client in the game has a name', () => {
    const { state } = starterSim();
    const keys = Object.keys(en);
    for (const skuId of state.skus.keys()) expect(keys).toContain(`sku.${skuId}`);
    for (const client of state.clients) expect(keys).toContain(`client.${client.id}`);
  });
});

describe('wording', () => {
  it('times are told relative to today', () => {
    const { state } = starterSim();
    state.tick = at(4, 9);
    state.day = 4;
    expect(whenText(state, at(4, 15))).toBe('today 15:00');
    expect(whenText(state, at(5, 15))).toBe('tomorrow 15:00');
    expect(whenText(state, at(3, 11, 25))).toBe('yesterday 11:25');
    expect(whenText(state, at(11, 15))).toBe('day 12, 15:00');
  });

  it('says what a worker is up to through a whole pick', () => {
    const sim = quiet(starterSim());
    const { state } = sim;
    const worker = state.workers[0];
    expect(activityText(state, worker)).toBe('Off shift');

    state.tick = at(0, 9);
    worker.status = 'idle';
    expect(activityText(state, worker)).toBe('Nothing to do');

    addPallet(state, 'ES-01', 'A-27-1-3');
    const order = addOrder(state, 'eshop', [['ES-01', 2]], at(0, 15));
    sim.step();
    expect(activityText(state, worker)).toBe(`Picking order ${order.id} · walking to A-27-1-3`);

    const seen = new Set<string>();
    runUntil(sim, () => {
      seen.add(activityText(state, worker));
      return order.status === 'ready';
    }, 60);
    expect([...seen].some((text) => text.endsWith('walking to packing'))).toBe(true);
    expect([...seen].some((text) => text.endsWith('packing'))).toBe(true);
    for (const text of seen) expect(text).not.toMatch(/[{}]|activity\./);

    worker.status = 'blocked';
    expect(activityText(state, worker)).toBe('Cannot get through – the way is blocked');
  });

  it('describes trucks in every state', () => {
    const sim = starterSim({ workers: 0 });
    sim.step();
    const { state } = sim;
    const inbound = state.trucks.find((tr) => tr.kind === 'inbound');
    const pickup = state.trucks.find((tr) => tr.kind === 'pickup');
    if (!inbound || !pickup) throw new Error('no trucks scheduled');
    expect(truckStatusText(state, inbound)).toBe('On the way');
    runUntil(sim, () => inbound.status === 'at-dock', 700);
    expect(truckStatusText(state, inbound)).toBe('At the dock · 6 of 6 pallets still on board');
    // Nobody unloads it, so the carrier has to wait in the yard.
    runUntil(sim, () => pickup.status === 'waiting', 900);
    sim.run(12);
    const waited = state.tick - (pickup.arrivedTick ?? 0);
    expect(waited).toBeGreaterThanOrEqual(12);
    expect(truckStatusText(state, pickup)).toBe(`Waiting for the dock for ${waited} min`);
  });
});

describe('interface state', () => {
  it('tells listeners about every change and stops when asked', () => {
    const store = createStore();
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    store.set({ tool: 'rack' });
    store.set({ panel: 'finance' });
    expect(store.get()).toMatchObject({ tool: 'rack', panel: 'finance', selection: null });
    expect(calls).toBe(2);
    stop();
    store.set({ tool: 'select' });
    expect(calls).toBe(2);
  });

  it('compares references by what they point at', () => {
    expect(sameRef({ kind: 'rack', id: 3 }, { kind: 'rack', id: 3 })).toBe(true);
    expect(sameRef({ kind: 'rack', id: 3 }, { kind: 'pallet', id: 3 })).toBe(false);
    expect(sameRef(null, null)).toBe(true);
    expect(sameRef(null, { kind: 'rack', id: 3 })).toBe(false);
  });
});
