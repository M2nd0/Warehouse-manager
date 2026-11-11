import type { SimContext } from '../context';
import { checkCongestion, expire, rollSickness } from '../incidents';
import { refreshCandidates } from '../people';
import type { GameState } from '../types';

/**
 * Incidents that come with the clock: who calls in sick in the morning,
 * trucks that have waited too long, and decisions whose deadline has passed.
 * (Damaged and misplaced pallets and wrong shipments are raised where they
 * happen: see src/sim/incidents.)
 */
export function step(state: GameState, ctx: SimContext): void {
  if (ctx.dayStart) {
    refreshCandidates(state);
    rollSickness(state, ctx);
  }
  checkCongestion(state, ctx);
  expire(state, ctx);
}
