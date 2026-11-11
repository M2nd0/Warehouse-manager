import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { garageStarterRacks } from '../src/data/halls';
import { createSim } from '../src/sim';
import { storageUse } from '../src/sim/economy/report';
import { rackLocId, reachLevels } from '../src/sim/layout';
import { buildNav } from '../src/sim/nav';
import { addPallet, starterSim } from './helpers';

describe('hall and racks', () => {
  it('starts as the empty 30 × 10 m garage with one dock', () => {
    const { state } = createSim();
    expect(state.hall.width * state.hall.depth).toBe(300);
    expect(state.hall.docks).toHaveLength(1);
    expect(state.racks).toHaveLength(0);
    expect(state.hall.zones.map((z) => z.kind).sort()).toEqual(['dispatch', 'receiving']);
    // Every zone cell is a floor storage slot.
    const floorSlots = [...state.locations.values()].filter((l) => l.kind === 'floor');
    expect(floorSlots).toHaveLength(state.hall.zones.reduce((n, z) => n + z.cells.length, 0));
  });

  it('builds a rack with addressed slots on every level', () => {
    const sim = createSim();
    expect(sim.dispatch({ type: 'build-rack', x: 6, y: 2, orientation: 'h' })).toMatchObject({ ok: true });
    const rack = sim.state.racks[0];
    expect(rackLocId(rack, 1, 1)).toBe('C-06-1-1');
    const slots = [...sim.state.locations.values()].filter((l) => l.rackId === rack.id);
    expect(slots).toHaveLength(rack.levels * 3);
    expect(sim.state.locations.get('C-06-1-3')?.cell).toEqual({ x: 8, y: 2 });
    expect(sim.state.locations.get('C-06-3-1')?.level).toBe(3);
  });

  it('refuses racks out of bounds, on top of things, or on door cells', () => {
    const sim = createSim();
    const build = (x: number, y: number, orientation: 'h' | 'v' = 'h') =>
      sim.dispatch({ type: 'build-rack', x, y, orientation });

    expect(build(28, 3)).toEqual({ ok: false, error: 'out-of-bounds' });
    expect(build(10, 8, 'v')).toEqual({ ok: false, error: 'out-of-bounds' });
    expect(build(-1, 3)).toEqual({ ok: false, error: 'out-of-bounds' });
    expect(build(0, 4)).toEqual({ ok: false, error: 'reserved-cell' }); // in front of the dock door
    expect(build(0, 7)).toEqual({ ok: false, error: 'reserved-cell' }); // staff entrance
    expect(build(3, 0)).toEqual({ ok: false, error: 'occupied' }); // receiving zone
    expect(build(4, 9)).toEqual({ ok: false, error: 'occupied' }); // dispatch zone + packing station

    expect(build(10, 3)).toMatchObject({ ok: true });
    expect(build(12, 3)).toEqual({ ok: false, error: 'occupied' }); // overlaps the rack above
    expect(build(11, 2, 'v')).toEqual({ ok: false, error: 'occupied' });
    expect(sim.state.racks).toHaveLength(1);
  });

  it('only demolishes racks that are empty', () => {
    const sim = createSim();
    sim.dispatch({ type: 'build-rack', x: 6, y: 0, orientation: 'h' });
    const rack = sim.state.racks[0];
    const pallet = addPallet(sim.state, 'ES-01', 'A-06-1-1');

    expect(sim.dispatch({ type: 'demolish-rack', rackId: rack.id })).toEqual({ ok: false, error: 'rack-in-use' });
    expect(sim.dispatch({ type: 'demolish-rack', rackId: 9999 })).toEqual({ ok: false, error: 'unknown-rack' });

    sim.state.pallets.delete(pallet.id);
    (sim.state.locations.get('A-06-1-1') as { palletId: number | null }).palletId = null;
    expect(sim.dispatch({ type: 'demolish-rack', rackId: rack.id })).toMatchObject({ ok: true });
    expect(sim.state.racks).toHaveLength(0);
    expect([...sim.state.locations.values()].some((l) => l.kind === 'rack')).toBe(false);
  });

  it('the starter layout gives the 60 pallet positions of the GDD garage', () => {
    const sim = starterSim();
    expect(sim.state.racks).toHaveLength(garageStarterRacks.length);
    // A hand pallet jack reaches the floor level only.
    expect(reachLevels(sim.state)).toBe(1);
    expect(storageUse(sim.state)).toEqual({ used: 0, capacity: 60 });
  });

  it('every slot of the starter layout can be reached from the staff entrance', () => {
    const { state } = starterSim();
    const nav = buildNav(state);
    const home = nav.region[state.hall.entrance.y * nav.width + state.hall.entrance.x];
    expect(home).toBeGreaterThanOrEqual(0);
    for (const loc of state.locations.values()) {
      const access = nav.access.get(loc.id) ?? [];
      expect(access.length, `${loc.id} has an aisle next to it`).toBeGreaterThan(0);
      expect(access.some((c) => nav.region[c.y * nav.width + c.x] === home)).toBe(true);
    }
    for (const station of state.hall.stations) {
      expect(nav.stationAccess.get(station.id)?.length).toBeGreaterThan(0);
    }
  });

  it('rack slots are served from the long sides only', () => {
    const sim = createSim();
    sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' });
    sim.dispatch({ type: 'build-rack', x: 20, y: 3, orientation: 'v' });
    const nav = buildNav(sim.state);
    expect(nav.access.get('E-10-1-1')).toEqual([{ x: 10, y: 3 }, { x: 10, y: 5 }]);
    expect(nav.access.get('D-20-1-2')).toEqual([{ x: 19, y: 4 }, { x: 21, y: 4 }]);
  });

  it('tells the UI what an action did', () => {
    const sim = createSim();
    const built = sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' });
    const rackId = sim.state.racks[0].id;
    expect(built).toMatchObject({ ok: true, events: [{ type: 'money' }, { type: 'rack-built', tick: 0, rackId }, { type: 'onboarding-step' }] });
    expect(sim.dispatch({ type: 'demolish-rack', rackId })).toMatchObject({
      ok: true,
      events: [{ type: 'money' }, { type: 'rack-demolished', tick: 0, rackId }],
    });
    // Events of an action are handed back by dispatch, not by the next step.
    expect(sim.step().some((e) => e.type === 'rack-built' || e.type === 'rack-demolished')).toBe(false);
  });

  it('slots do not share their cell objects', () => {
    const sim = createSim();
    sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' });
    const floor = sim.state.locations.get('E-10-1-1');
    const above = sim.state.locations.get('E-10-2-1');
    expect(above?.cell).toEqual(floor?.cell);
    expect(above?.cell).not.toBe(floor?.cell);
  });

  it('a new game can start with racks already standing, free of charge', () => {
    const sim = createSim({ racks: [{ x: 10, y: 4, orientation: 'h' }, { x: 20, y: 2, orientation: 'v' }] });
    expect(sim.state.racks).toHaveLength(2);
    expect(sim.state.cash).toBe(balance.start.cash);
    expect(sim.state.ledger).toHaveLength(0);
    expect(sim.state.locations.has('E-10-1-1')).toBe(true);
  });

  it('bumps the layout version so caches rebuild', () => {
    const sim = createSim();
    const before = sim.state.layoutVersion;
    sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' });
    expect(sim.state.layoutVersion).toBe(before + 1);
    sim.dispatch({ type: 'demolish-rack', rackId: sim.state.racks[0].id });
    expect(sim.state.layoutVersion).toBe(before + 2);
  });
});
