import type { SimEvent } from './events';
import { buildNav } from './nav';
import type { NavGrid } from './nav';
import type { GameState } from './types';

/**
 * Per-simulation scratch data handed to every system. Nothing in here is
 * saved: all of it can be rebuilt from GameState.
 */
export interface SimContext {
  /** Minute of day (0–1439) of the tick being simulated. Set by the clock. */
  minute: number;
  /** This tick is 00:00. */
  dayStart: boolean;
  /** This tick is 23:59, the last one of the day. */
  dayEnd: boolean;
  /** Events raised during the current step. */
  events: SimEvent[];
  nav: NavGrid | null;
}

export function createContext(): SimContext {
  return { minute: 0, dayStart: false, dayEnd: false, events: [], nav: null };
}

export function emit(ctx: SimContext, event: SimEvent): void {
  ctx.events.push(event);
}

/** The navigation grid for the current layout, rebuilt if the layout changed. */
export function navOf(state: GameState, ctx: SimContext): NavGrid {
  if (ctx.nav === null || ctx.nav.version !== state.layoutVersion) ctx.nav = buildNav(state);
  return ctx.nav;
}
