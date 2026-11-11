import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import { ONBOARDING_STEPS } from '../src/sim/systems/clients';
import { TICKS_PER_DAY } from '../src/sim/time';
import { addPallet, at, quiet, runTo, runUntil, starterSim, violations } from './helpers';

const C = balance.clients;

describe('clients: offers', () => {
  it('a client without a contract makes an offer once the reputation allows', () => {
    const sim = starterSim({ clients: ['eshop'] });
    const wholesale = sim.state.clients.find((c) => c.id === 'wholesale');
    expect(wholesale?.active).toBe(false);
    const events = sim.run(C.offerFromDay * TICKS_PER_DAY + 1);
    expect(sim.state.offers).toEqual([{ clientId: 'wholesale', expiresDay: C.offerFromDay + C.offerValidDays }]);
    expect(events.filter((e) => e.type === 'offer-made')).toHaveLength(1);
    // No goods and no orders of a client without a contract.
    expect([...sim.state.pallets.values()].every((p) => p.clientId === 'eshop')).toBe(true);
    expect(sim.state.orders.every((o) => o.clientId === 'eshop')).toBe(true);
  });

  it('no offers with a poor reputation', () => {
    const sim = starterSim({ clients: ['eshop'] });
    sim.state.reputation = C.offerMinReputation - 1;
    sim.run(2 * C.offerFromDay * TICKS_PER_DAY);
    for (let day = 0; day < 4; day++) {
      sim.state.reputation = C.offerMinReputation - 1;
      sim.run(TICKS_PER_DAY);
    }
    expect(sim.state.offers).toHaveLength(0);
  });

  it('accepting starts the contract: deliveries and orders begin', () => {
    const sim = starterSim({ clients: ['eshop'] });
    sim.run(C.offerFromDay * TICKS_PER_DAY + 1);
    expect(sim.dispatch({ type: 'accept-offer', clientId: 'wholesale' })).toMatchObject({ ok: true, events: [{ type: 'client-joined' }] });
    const wholesale = sim.state.clients.find((c) => c.id === 'wholesale');
    expect(wholesale).toMatchObject({ active: true, contract: { startDay: C.offerFromDay } });
    expect(sim.state.offers).toHaveLength(0);
    expect(sim.dispatch({ type: 'accept-offer', clientId: 'wholesale' })).toEqual({ ok: false, error: 'unknown-offer' });
    sim.run(3 * TICKS_PER_DAY);
    expect([...sim.state.pallets.values()].some((p) => p.clientId === 'wholesale')).toBe(true);
    expect(violations(sim.state)).toEqual([]);
  });

  it('declined or ignored, the client stays away for a while', () => {
    const sim = starterSim({ clients: ['eshop'] });
    sim.run(C.offerFromDay * TICKS_PER_DAY + 1);
    sim.dispatch({ type: 'decline-offer', clientId: 'wholesale' });
    expect(sim.state.offers).toHaveLength(0);
    runTo(sim, at(C.offerFromDay + C.declineCooldownDays - 1, 12));
    expect(sim.state.offers).toHaveLength(0);
    runTo(sim, at(C.offerFromDay + C.declineCooldownDays, 12));
    expect(sim.state.offers).toHaveLength(1);
    // Ignored: it lapses, and comes again later.
    runTo(sim, at(C.offerFromDay + C.declineCooldownDays + C.offerValidDays, 0, 1));
    expect(sim.state.offers.every((o) => o.expiresDay > sim.state.day)).toBe(true);
  });
});

describe('clients: leaving', () => {
  it('GDD: three days of breached SLA in a month and the client is gone', () => {
    // Nobody works: every order is late.
    const sim = starterSim({ workers: 0, clients: ['eshop'] });
    const client = sim.state.clients[0];
    const slots = [...sim.state.locations.values()].filter((l) => l.kind === 'rack' && l.level === 1);
    ['ES-01', 'ES-02', 'ES-03', 'ES-04'].forEach((sku, i) => addPallet(sim.state, sku, slots[i].id));
    const events = runUntil(sim, () => !client.active, 8 * TICKS_PER_DAY);
    // The player is warned on each of the days leading up to it.
    expect(events.filter((e) => e.type === 'sla-breached').map((e) => (e.type === 'sla-breached' ? e.days : 0))).toEqual([1, 2, 3]);
    expect(client.month.breachDays).toBe(C.breachDaysToLeave);
    expect(events.find((e) => e.type === 'client-left')).toMatchObject({ clientId: 'eshop', reason: 'sla' });
    // It left at the close of yesterday.
    expect(client.nextOfferDay).toBe(sim.state.day - 1 + C.returnAfterDays);

    // Its goods are collected and the orders nobody started are dropped.
    sim.run(2 * TICKS_PER_DAY);
    expect([...sim.state.pallets.values()].filter((p) => p.clientId === 'eshop')).toHaveLength(0);
    expect(sim.state.orders).toHaveLength(0);
    expect(sim.state.trucks.filter((t) => t.kind === 'inbound' && t.status === 'en-route')).toHaveLength(0);
    expect(violations(sim.state)).toEqual([]);
  });

  it('a few late orders on a good day are not a breach', () => {
    const s2 = quiet(starterSim());
    s2.state.clients[0].today = { due: 20, bad: 4 };
    s2.run(TICKS_PER_DAY);
    expect(s2.state.clients[0].month.breachDays).toBe(0);
    const s3 = quiet(starterSim());
    s3.state.clients[0].today = { due: 20, bad: 5 };
    s3.run(TICKS_PER_DAY);
    expect(s3.state.clients[0].month.breachDays).toBe(1);
    expect(s3.state.reports).toHaveLength(1);
    expect(s3.state.clients[0].today).toEqual({ due: 0, bad: 0 });
  });

  it('GDD: when the contract runs out the client stays only with a good enough reputation', () => {
    const stays = quiet(starterSim({ workers: 0 }));
    const eshop = stays.state.clients[0];
    const end = eshop.contract.months * balance.time.daysPerMonth;
    stays.state.tick = at(end - 1, 23, 0);
    stays.state.day = end - 1;
    stays.run(61);
    expect(eshop).toMatchObject({ active: true, contract: { startDay: end } });

    const goes = quiet(starterSim({ workers: 0 }));
    goes.state.reputation = C.renewMinReputation - 1;
    goes.state.tick = at(end - 1, 23, 0);
    goes.state.day = end - 1;
    const events = goes.run(61);
    expect(goes.state.clients[0].active).toBe(false);
    expect(events.find((e) => e.type === 'client-left')).toMatchObject({ reason: 'reputation' });
  });
});

describe('onboarding (GDD: six tasks, each done by doing it)', () => {
  it('ticks off build → receive → put away → pick → dispatch → read the report', () => {
    const sim = createSim({ seed: 4 });
    sim.run(30);
    expect(sim.state.onboarding.done).toBe(0);
    const first = sim.dispatch({ type: 'build-rack', x: 6, y: 0, orientation: 'h' });
    expect(first).toMatchObject({ ok: true, events: [{ type: 'money' }, { type: 'rack-built' }, { type: 'onboarding-step', done: 1 }] });
    for (const y of [0, 9]) for (let x = 9; x < 27; x += 3) sim.dispatch({ type: 'build-rack', x, y, orientation: 'h' });
    expect(sim.state.onboarding.done).toBe(1);

    const seen: number[] = [];
    for (const event of runUntil(sim, (s) => s.onboarding.done === ONBOARDING_STEPS - 1, 3 * TICKS_PER_DAY)) {
      if (event.type === 'onboarding-step') seen.push(event.done);
    }
    expect(seen).toEqual([2, 3, 4, 5]);

    // The last one needs a report to exist and the player to have looked at it.
    runTo(sim, at(sim.state.day + 1, 0, 5));
    expect(sim.dispatch({ type: 'read-report' })).toMatchObject({ ok: true, events: [{ type: 'onboarding-step', done: 6 }] });
    expect(sim.dispatch({ type: 'read-report' })).toMatchObject({ ok: true, events: [] });
    expect(sim.state.onboarding.done).toBe(ONBOARDING_STEPS);
  });

  it('reading a report before the other tasks does not skip them', () => {
    const sim = quiet(createSim());
    sim.run(TICKS_PER_DAY + 1);
    sim.dispatch({ type: 'read-report' });
    expect(sim.state.onboarding.done).toBe(0);
  });
});
