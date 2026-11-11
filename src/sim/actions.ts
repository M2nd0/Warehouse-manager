import { balance } from '../data/balance';
import { emit, navOf } from './context';
import type { SimContext } from './context';
import { post } from './economy/ledger';
import type { SimEvent } from './events';
import { resolve } from './incidents';
import type { ResolveError } from './incidents';
import { addRack, checkDemolition, previewRack, removeRack } from './layout';
import type { DemolitionError, PlacementError } from './layout';
import { dismiss, hire } from './people';
import type { DismissError, HireError } from './people';
import type { Duty, GameState, Id, Orientation } from './types';

/**
 * Player input. An action is applied at once, between two ticks, with the
 * same context the systems get — so it can post money and raise events.
 * The seed plus every action and the tick it was dispatched at fully
 * determine a game.
 */
export type Action =
  | { type: 'build-rack'; x: number; y: number; orientation: Orientation }
  | { type: 'demolish-rack'; rackId: Id }
  | { type: 'hire'; candidateId: Id }
  | { type: 'dismiss'; workerId: Id }
  | { type: 'set-duty'; workerId: Id; duty: Duty }
  | { type: 'resolve-incident'; incidentId: Id; choiceId: string };

export type ActionError =
  | PlacementError
  | DemolitionError
  | HireError
  | DismissError
  | ResolveError
  | 'not-enough-cash';

export type ActionResult = { ok: true; events: SimEvent[] } | { ok: false; error: ActionError };

/** Apply an action; returns why it was refused, or null. Nothing changes on refusal. */
export function applyAction(state: GameState, ctx: SimContext, action: Action): ActionError | null {
  switch (action.type) {
    case 'build-rack': {
      const { error } = previewRack(state, navOf(state, ctx), action);
      if (error) return error;
      if (state.cash < balance.rack.price) return 'not-enough-cash';
      const rack = addRack(state, action);
      post(state, ctx, 'construction', -balance.rack.price);
      emit(ctx, { type: 'rack-built', tick: state.tick, rackId: rack.id });
      return null;
    }
    case 'demolish-rack': {
      const error = checkDemolition(state, action.rackId);
      if (error) return error;
      removeRack(state, action.rackId);
      const refund = Math.round(balance.rack.price * balance.rack.demolishRefund);
      if (refund > 0) post(state, ctx, 'construction', refund);
      emit(ctx, { type: 'rack-demolished', tick: state.tick, rackId: action.rackId });
      return null;
    }
    case 'hire':
      return hire(state, ctx, action.candidateId);
    case 'dismiss':
      return dismiss(state, ctx, action.workerId);
    case 'set-duty': {
      const worker = state.workers.find((w) => w.id === action.workerId);
      if (!worker) return 'unknown-worker';
      worker.duty = action.duty;
      return null;
    }
    case 'resolve-incident':
      return resolve(state, ctx, action.incidentId, action.choiceId);
  }
}
