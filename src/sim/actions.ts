import { emit } from './context';
import type { SimContext } from './context';
import type { SimEvent } from './events';
import { addRack, checkRackPlacement, removeRack } from './layout';
import type { DemolitionError, PlacementError } from './layout';
import type { GameState, Id, Orientation } from './types';

/**
 * Player input. An action is applied at once, between two ticks, with the
 * same context the systems get — so it can post money and raise events.
 * The seed plus every action and the tick it was dispatched at fully
 * determine a game.
 */
export type Action =
  | { type: 'build-rack'; x: number; y: number; orientation: Orientation }
  | { type: 'demolish-rack'; rackId: Id };

export type ActionError = PlacementError | DemolitionError;

export type ActionResult = { ok: true; events: SimEvent[] } | { ok: false; error: ActionError };

/** Apply an action; returns why it was refused, or null. Nothing changes on refusal. */
export function applyAction(state: GameState, ctx: SimContext, action: Action): ActionError | null {
  switch (action.type) {
    case 'build-rack': {
      const error = checkRackPlacement(state, action);
      if (error) return error;
      const rack = addRack(state, action);
      emit(ctx, { type: 'rack-built', tick: state.tick, rackId: rack.id });
      return null;
    }
    case 'demolish-rack': {
      const error = removeRack(state, action.rackId);
      if (error) return error;
      emit(ctx, { type: 'rack-demolished', tick: state.tick, rackId: action.rackId });
      return null;
    }
  }
}
