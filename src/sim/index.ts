import { applyAction } from './actions';
import type { Action, ActionResult } from './actions';
import { createContext } from './context';
import type { SimContext } from './context';
import type { SimEvent } from './events';
import { createGame } from './state';
import type { NewGameOptions } from './state';
import * as agents from './systems/agents';
import * as clock from './systems/clock';
import * as equipment from './systems/equipment';
import * as finance from './systems/finance';
import * as orders from './systems/orders';
import * as planner from './systems/planner';
import * as trucks from './systems/trucks';
import type { GameState } from './types';

/**
 * The simulation's public face.
 *
 *   const sim = createSim({ seed: 42 });
 *   sim.dispatch({ type: 'build-rack', x: 6, y: 0, orientation: 'h' });
 *   const events = sim.step();      // one in-game minute
 *   render.sync(sim.state);         // render and UI take it as a read-only GameView
 *
 * All changes to GameState go through `step()` or `dispatch()`.
 */
export interface Sim {
  readonly state: GameState;
  /** Simulate one tick (one in-game minute). Returns what happened. */
  step(): SimEvent[];
  /** Simulate several ticks. Returns everything that happened. */
  run(ticks: number): SimEvent[];
  /** Apply a player action now, between ticks. Returns what happened, or why not. */
  dispatch(action: Action): ActionResult;
}

/**
 * Order of systems within a tick (GDD "Simulační tick"):
 * time → trucks → orders → task planner → agents → equipment →
 * [incidents: M4] → finance.
 */
const systems: readonly { step(state: GameState, ctx: SimContext): void }[] = [
  clock,
  trucks,
  orders,
  planner,
  agents,
  equipment,
  finance,
];

function wrap(state: GameState): Sim {
  const ctx = createContext();

  const step = (): SimEvent[] => {
    ctx.events = [];
    for (const system of systems) system.step(state, ctx);
    clock.advance(state);
    return ctx.events;
  };

  return {
    state,
    step,
    run(ticks) {
      const events: SimEvent[] = [];
      for (let i = 0; i < ticks; i++) {
        for (const event of step()) events.push(event);
      }
      return events;
    },
    dispatch(action) {
      ctx.events = [];
      const error = applyAction(state, ctx, action);
      return error ? { ok: false, error } : { ok: true, events: ctx.events };
    },
  };
}

/** Start a new game. */
export function createSim(options: NewGameOptions = {}): Sim {
  return wrap(createGame(options));
}

/** Continue from a saved state. */
export function resumeSim(state: GameState): Sim {
  return wrap(state);
}

export type { Action, ActionError, ActionResult } from './actions';
export type { SimEvent, SimEventType } from './events';
export type { NewGameOptions } from './state';
export { SAVE_VERSION } from './state';
export * from './types';
export { TICKS_PER_DAY, dayOf, dayStartTick, minuteOfDay } from './time';
