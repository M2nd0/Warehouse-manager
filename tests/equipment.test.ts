import { describe, expect, it } from 'vitest';
import { createSim } from '../src/sim';
import * as equipment from '../src/sim/systems/equipment';
import { contextFor } from './helpers';

describe('equipment', () => {
  it('a parked vehicle stays put and clocks no hours', () => {
    const { state } = createSim();
    const vehicle = state.vehicles[0];
    const parked = { ...vehicle.pos };
    for (let i = 0; i < 60; i++) equipment.step(state, contextFor(state));
    expect(vehicle.pos).toEqual(parked);
    expect(vehicle.hours).toBe(0);
  });

  it('a reserved vehicle waits where it is until its user picks it up', () => {
    const { state } = createSim();
    const [worker] = state.workers;
    const vehicle = state.vehicles[0];
    const parked = { ...vehicle.pos };
    vehicle.userId = worker.id;
    worker.pos = { x: 20, y: 5 };
    equipment.step(state, contextFor(state));
    expect(vehicle.pos).toEqual(parked);
    expect(vehicle.hours).toBe(0);
  });

  it('a vehicle in hand moves with its user and clocks operating hours', () => {
    const { state } = createSim();
    const [worker] = state.workers;
    const vehicle = state.vehicles[0];
    vehicle.userId = worker.id;
    worker.vehicleId = vehicle.id;
    worker.pos = { x: 12.5, y: 3 };
    for (let i = 0; i < 90; i++) equipment.step(state, contextFor(state));
    expect(vehicle.pos).toEqual({ x: 12.5, y: 3 });
    expect(vehicle.hours).toBeCloseTo(1.5, 9);
  });
});
