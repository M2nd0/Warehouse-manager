import { describe, expect, it } from 'vitest';
import { bedLength, cargoSlot, sampleTrail, turnTowards } from '../src/render/motion';
import { at, quiet, starterSim } from './helpers';
import { addOrder, addPallet } from './helpers';

describe('animating along a worker’s trail', () => {
  // 3 cells east, then 2 cells south.
  const trail = [
    { x: 10, y: 2 },
    { x: 11, y: 2 },
    { x: 12, y: 2 },
    { x: 13, y: 2 },
    { x: 13, y: 3 },
    { x: 13, y: 4 },
  ];

  it('starts where the tick began and ends where the worker is now', () => {
    expect(sampleTrail(trail, trail[5], 0)).toMatchObject({ x: 10, y: 2, length: 5 });
    expect(sampleTrail(trail, trail[5], 1)).toMatchObject({ x: 13, y: 4 });
  });

  it('follows the corner instead of cutting it', () => {
    // 40 % of 5 cells = 2 cells along the first leg.
    expect(sampleTrail(trail, trail[5], 0.4)).toMatchObject({ x: 12, y: 2, dirX: 1, dirY: 0 });
    // 80 % = 4 cells: 3 east and 1 south — still on the route, facing south.
    expect(sampleTrail(trail, trail[5], 0.8)).toMatchObject({ x: 13, y: 3, dirX: 0, dirY: 1 });
    // Every sample lies on one of the two legs.
    for (let alpha = 0; alpha <= 1; alpha += 0.05) {
      const p = sampleTrail(trail, trail[5], alpha);
      expect(p.y === 2 || p.x === 13).toBe(true);
    }
  });

  it('handles partial cells', () => {
    const p = sampleTrail([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1.5, y: 0 }], { x: 1.5, y: 0 }, 0.5);
    expect(p.x).toBeCloseTo(0.75, 9);
  });

  it('stands still when the worker did not move', () => {
    expect(sampleTrail([{ x: 4, y: 7 }], { x: 4, y: 7 }, 0.3)).toEqual({ x: 4, y: 7, dirX: 0, dirY: 0, length: 0 });
    expect(sampleTrail([], { x: 1, y: 2 }, 0.3)).toMatchObject({ x: 1, y: 2, length: 0 });
  });

  it('clamps alpha', () => {
    expect(sampleTrail(trail, trail[5], -1)).toMatchObject({ x: 10, y: 2 });
    expect(sampleTrail(trail, trail[5], 7)).toMatchObject({ x: 13, y: 4 });
  });

  it('never leaves the aisles in a real game', () => {
    // Follow a worker through a pick in the starter layout and sample every tick's trail.
    const sim = quiet(starterSim());
    const { state } = sim;
    state.tick = at(0, 9);
    state.workers[0].status = 'idle';
    addPallet(state, 'ES-01', 'A-27-1-3');
    addPallet(state, 'ES-02', 'F-15-1-2');
    const order = addOrder(state, 'eshop', [['ES-01', 1], ['ES-02', 1]], at(0, 15));
    const blocked = new Set<string>();
    for (const loc of state.locations.values()) blocked.add(`${loc.cell.x},${loc.cell.y}`);
    for (const station of state.hall.stations) blocked.add(`${station.cell.x},${station.cell.y}`);

    let samples = 0;
    for (let i = 0; i < 200 && order.status !== 'ready'; i++) {
      sim.step();
      const worker = state.workers[0];
      for (let alpha = 0; alpha <= 1; alpha += 0.1) {
        const p = sampleTrail(worker.trail, worker.pos, alpha);
        expect(blocked.has(`${Math.round(p.x)},${Math.round(p.y)}`), `at ${p.x},${p.y}`).toBe(false);
        samples++;
      }
    }
    expect(order.status).toBe('ready');
    expect(samples).toBeGreaterThan(50);
  });
});

describe('turning', () => {
  it('turns the short way round, at most the given step', () => {
    expect(turnTowards(0, 1, 0.25)).toBeCloseTo(0.25, 9);
    expect(turnTowards(0, -1, 0.25)).toBeCloseTo(-0.25, 9);
    expect(turnTowards(0, 0.1, 0.25)).toBeCloseTo(0.1, 9);
    // From just short of half a turn to just past it: go on, not all the way back.
    expect(turnTowards(3, -3, 0.1)).toBeCloseTo(3.1, 9);
    expect(turnTowards(-3, 3, 0.1)).toBeCloseTo(-3.1, 9);
  });
});

describe('truck bed', () => {
  it('stands pallets two abreast from the tail forward, without overlap', () => {
    const slots = Array.from({ length: 8 }, (_, i) => cargoSlot(i));
    expect(slots[0].along).toBe(slots[1].along);
    expect(slots[0].across).toBe(-slots[1].across);
    expect(slots[2].along).toBeGreaterThan(slots[0].along + 1);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const apart =
          Math.abs(slots[i].across - slots[j].across) >= 0.8 || Math.abs(slots[i].along - slots[j].along) >= 1;
        expect(apart, `${i} and ${j}`).toBe(true);
      }
    }
  });

  it('is long enough for its load', () => {
    for (const pallets of [1, 2, 6, 7, 10, 33]) {
      const last = cargoSlot(pallets - 1);
      expect(bedLength(pallets)).toBeGreaterThanOrEqual(last.along + 0.5);
    }
  });
});
