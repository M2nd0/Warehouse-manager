import { addRack, checkRackPlacement, removeRack } from './layout';
import type { DemolitionError, PlacementError } from './layout';
import type { GameState, Id, Orientation } from './types';

/**
 * Player input. Together with the seed, the list of actions and the ticks
 * they were dispatched at fully determines a game.
 */
export type Action =
  | { type: 'build-rack'; x: number; y: number; orientation: Orientation }
  | { type: 'demolish-rack'; rackId: Id };

export type ActionError = PlacementError | DemolitionError;

export type ActionResult = { ok: true } | { ok: false; error: ActionError };

const fail = (error: ActionError): ActionResult => ({ ok: false, error });

export function applyAction(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case 'build-rack': {
      const error = checkRackPlacement(state, action);
      if (error) return fail(error);
      addRack(state, action);
      return { ok: true };
    }
    case 'demolish-rack': {
      const error = removeRack(state, action.rackId);
      return error ? fail(error) : { ok: true };
    }
  }
}
