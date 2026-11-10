import type { SimContext } from '../context';
import type { GameState } from '../types';

/**
 * Equipment: vehicles in hand move with their user and clock up operating
 * hours. (Batteries and breakdowns arrive with phase 2.)
 */
export function step(state: GameState, _ctx: SimContext): void {
  for (const vehicle of state.vehicles) {
    if (vehicle.userId === null) continue;
    const user = state.workers.find((w) => w.id === vehicle.userId);
    if (!user || user.vehicleId !== vehicle.id) continue; // reserved, not yet picked up
    vehicle.pos = { x: user.pos.x, y: user.pos.y };
    vehicle.hours += 1 / 60;
  }
}
