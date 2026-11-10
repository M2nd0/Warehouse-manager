import { emit } from '../context';
import type { SimContext } from '../context';
import type { Cents, ClientId, GameState, LedgerEntry, LedgerKind } from '../types';

/**
 * The only way cash changes. Every movement is recorded, so
 * `cash === starting cash + sum of ledger amounts` always holds.
 */
export function post(
  state: GameState,
  ctx: SimContext,
  kind: LedgerKind,
  amount: Cents,
  clientId: ClientId | null = null,
): LedgerEntry {
  const entry: LedgerEntry = { tick: state.tick, kind, amount, clientId };
  state.ledger.push(entry);
  state.cash += amount;
  emit(ctx, { type: 'money', tick: state.tick, entry });
  return entry;
}

export function ledgerTotal(state: GameState): Cents {
  let total = 0;
  for (const entry of state.ledger) total += entry.amount;
  return total;
}
