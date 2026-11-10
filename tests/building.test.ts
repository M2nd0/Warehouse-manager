import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import type { Sim } from '../src/sim';
import { ledgerTotal } from '../src/sim/economy/ledger';
import { addPallet, at, starterSim, violations } from './helpers';

const build = (sim: Sim, x: number, y: number, orientation: 'h' | 'v' = 'h') =>
  sim.dispatch({ type: 'build-rack', x, y, orientation });

describe('building: money', () => {
  it('a rack costs its price; taking it down returns part of it', () => {
    const sim = createSim();
    const { price, demolishRefund } = balance.rack;
    expect(build(sim, 10, 4)).toMatchObject({ ok: true });
    expect(sim.state.cash).toBe(balance.start.cash - price);
    expect(sim.state.ledger).toEqual([{ tick: 0, kind: 'construction', amount: -price, clientId: null }]);

    sim.dispatch({ type: 'demolish-rack', rackId: sim.state.racks[0].id });
    expect(sim.state.cash).toBe(balance.start.cash - price + Math.round(price * demolishRefund));
    expect(sim.state.cash - balance.start.cash).toBe(ledgerTotal(sim.state));
  });

  it('cannot be built without the money, and a refusal costs nothing', () => {
    const sim = createSim();
    sim.state.cash = balance.rack.price - 1;
    expect(build(sim, 10, 4)).toEqual({ ok: false, error: 'not-enough-cash' });
    expect(sim.state.racks).toHaveLength(0);
    expect(sim.state.ledger).toHaveLength(0);

    sim.state.cash = balance.rack.price;
    expect(build(sim, 0, 4)).toEqual({ ok: false, error: 'reserved-cell' });
    expect(sim.state.cash).toBe(balance.rack.price);
    expect(build(sim, 10, 4)).toMatchObject({ ok: true });
    expect(sim.state.cash).toBe(0);
  });
});

describe('building: aisles (GDD: red under 2.7 m, orange under 3.5 m)', () => {
  it('measures the free floor on both long sides of the rack', () => {
    const sim = createSim();
    // The hall is 10 m deep: a rack in row 5 has 5 m of floor to the north and 4 m to the south.
    const preview = sim.previewRack({ x: 10, y: 5, orientation: 'h' });
    expect(preview.error).toBeNull();
    expect(preview.aisles.map((a) => [a.width, a.rating])).toEqual([[5, 'ok'], [4, 'ok']]);
    expect(preview.aisles[0].cells).toHaveLength(3 * 5);
    expect(preview.aisles[1].cells).toContainEqual({ x: 12, y: 9 });
    expect(preview.unserved).toBe(0);
  });

  it('rates a 3 m aisle tight and a 2 m aisle narrow', () => {
    const sim = createSim();
    build(sim, 10, 5);
    // Rows 2–4 free between the racks: 3 m.
    expect(sim.previewRack({ x: 10, y: 1, orientation: 'h' }).aisles[1]).toMatchObject({ width: 3, rating: 'tight' });
    // Rows 3–4 free: 2 m.
    expect(sim.previewRack({ x: 10, y: 2, orientation: 'h' }).aisles[1]).toMatchObject({ width: 2, rating: 'narrow' });
    // Only partly facing the other rack: the aisle is as wide as its narrowest point.
    expect(sim.previewRack({ x: 12, y: 2, orientation: 'h' }).aisles[1]).toMatchObject({ width: 2, rating: 'narrow' });
    expect(sim.previewRack({ x: 14, y: 2, orientation: 'h' }).aisles[1].width).toBeGreaterThan(3);
  });

  it('has no aisle on a side that is against a wall or another rack', () => {
    const sim = createSim();
    build(sim, 10, 5);
    expect(sim.previewRack({ x: 10, y: 0, orientation: 'h' }).aisles[0]).toMatchObject({ width: 0, rating: 'none', cells: [] });
    const backToBack = sim.previewRack({ x: 10, y: 4, orientation: 'h' });
    expect(backToBack.error).toBeNull();
    expect(backToBack.aisles[1].rating).toBe('none');
    expect(backToBack.aisles[0].rating).toBe('ok');
  });

  it('works for racks turned the other way', () => {
    const sim = createSim();
    const preview = sim.previewRack({ x: 12, y: 3, orientation: 'v' });
    expect(preview.cells).toEqual([{ x: 12, y: 3 }, { x: 12, y: 4 }, { x: 12, y: 5 }]);
    // West: 6 m is as far as an aisle is measured. East likewise.
    expect(preview.aisles.map((a) => a.width)).toEqual([balance.build.aisleMeasureUpTo, balance.build.aisleMeasureUpTo]);
  });

  it('the starter layout has 3 m aisles around the island and open floor elsewhere', () => {
    const sim = starterSim();
    const widths = new Set<number>();
    for (const rack of [...sim.state.racks]) {
      // Take each rack out in turn and ask what putting it back would look like.
      const placement = { x: rack.x, y: rack.y, orientation: rack.orientation };
      sim.dispatch({ type: 'demolish-rack', rackId: rack.id });
      for (const aisle of sim.previewRack(placement).aisles) if (aisle.width > 0) widths.add(aisle.width);
      expect(sim.dispatch({ type: 'build-rack', ...placement })).toMatchObject({ ok: true });
    }
    expect([...widths].sort()).toEqual([3, balance.build.aisleMeasureUpTo]);
  });
});

describe('building: walkable routes', () => {
  it('previewing changes nothing', () => {
    const sim = createSim();
    const before = sim.state.layoutVersion;
    sim.previewRack({ x: 10, y: 5, orientation: 'h' });
    expect(sim.state.racks).toHaveLength(0);
    expect(sim.state.layoutVersion).toBe(before);
    expect(sim.state.cash).toBe(balance.start.cash);
  });

  it('refuses a rack no aisle could reach', () => {
    const sim = createSim();
    build(sim, 10, 3);
    build(sim, 10, 5);
    const preview = sim.previewRack({ x: 10, y: 4, orientation: 'h' });
    expect(preview).toMatchObject({ error: 'no-access', unserved: 3 });
    expect(build(sim, 10, 4)).toEqual({ ok: false, error: 'no-access' });
    // Shifted by one, two of its positions stick out and can be served: allowed, with a warning.
    expect(sim.previewRack({ x: 12, y: 4, orientation: 'h' })).toMatchObject({ error: null, unserved: 1 });
  });

  it('refuses to wall off stock that is in the racks', () => {
    const sim = createSim();
    // A pocket at (20–22, 5), open only towards the east, with a rack inside the far wall.
    build(sim, 20, 4);
    build(sim, 20, 6);
    build(sim, 19, 4, 'v');
    addPallet(sim.state, 'ES-01', 'E-20-1-1'); // served from (20, 3) and from the pocket
    // Closing the pocket still leaves (20, 3): fine.
    expect(sim.previewRack({ x: 23, y: 4, orientation: 'v' }).error).toBeNull();
    // Closing the outer side instead would leave it reachable only from the pocket: also fine…
    expect(build(sim, 20, 3)).toMatchObject({ ok: true });
    // …but closing the pocket now cuts the top rack off completely.
    expect(sim.previewRack({ x: 23, y: 4, orientation: 'v' }).error).toBe('blocks-access');
    expect(build(sim, 23, 4, 'v')).toEqual({ ok: false, error: 'blocks-access' });
  });

  it('refuses to cut off the dock, the zones, the packing station or people', () => {
    const sim = createSim();
    // A wall of racks across the hall at x = 5 would separate the dock side from the rest…
    expect(build(sim, 5, 1, 'v')).toMatchObject({ ok: true });
    expect(build(sim, 5, 4, 'v')).toMatchObject({ ok: true });
    // …which is still fine while nothing on the far side is in use…
    expect(build(sim, 5, 7, 'h')).toMatchObject({ ok: true });
    // …but this last one would cut the packing station off from the entrance.
    expect(build(sim, 5, 8, 'h')).toEqual({ ok: false, error: 'blocks-access' });

    const yard = createSim();
    yard.state.tick = at(0, 9);
    const worker = yard.state.workers[0];
    worker.status = 'idle';
    worker.pos = { x: 21, y: 5 };
    for (const [x, y, o] of [[20, 4, 'h'], [20, 6, 'h'], [19, 4, 'v']] as const) build(yard, x, y, o);
    // The worker stands in the pocket: closing it would trap them.
    expect(build(yard, 23, 4, 'v')).toEqual({ ok: false, error: 'blocks-access' });
    expect(violations(yard.state)).toEqual([]);
  });
});
