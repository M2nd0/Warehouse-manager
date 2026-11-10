import type { SimContext } from '../context';
import { TICKS_PER_DAY, dayOf, minuteOfDay } from '../time';
import type { GameState } from '../types';

/** Time: work out where in the day the tick being simulated falls. */
export function step(state: GameState, ctx: SimContext): void {
  ctx.minute = minuteOfDay(state.tick);
  ctx.dayStart = ctx.minute === 0;
  ctx.dayEnd = ctx.minute === TICKS_PER_DAY - 1;
}

/** Move on to the next minute. Called once, after all systems have run. */
export function advance(state: GameState): void {
  state.tick += 1;
  state.day = dayOf(state.tick);
}
