import { balance } from '../../data/balance';
import { emit } from '../context';
import type { SimContext } from '../context';
import { post } from '../economy/ledger';
import { availableUnits, stockOf } from '../inventory';
import { poisson, weightedIndex } from '../rng';
import { slaDeadline } from '../time';
import type { Client, GameState, Order, OrderLine, Sku } from '../types';

/**
 * Customer orders: new ones arrive through the day following each client's
 * demand profile; ones that miss their deadline are flagged and penalised.
 */
export function step(state: GameState, ctx: SimContext): void {
  const hour = Math.floor(ctx.minute / 60);
  for (const client of state.clients) {
    if (!client.active) continue;
    const weights = client.profile.hourlyWeights;
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) continue;
    const perMinute = (client.profile.ordersPerDay * weights[hour]) / total / 60;
    const count = poisson(state, perMinute);
    for (let i = 0; i < count; i++) createOrder(state, ctx, client);
  }
  markLate(state, ctx);
}

/**
 * A customer orders from what the client has in stock with us (a 3PL's
 * clients sell from the stock feed), so every new order can be fulfilled
 * according to the records.
 */
function createOrder(state: GameState, ctx: SimContext, client: Client): Order | null {
  const profile = client.profile;
  const byPallet = profile.pickMode === 'pallet';
  const lineCount = 1 + weightedIndex(state, profile.linesPerOrder);

  const pool: Sku[] = [];
  for (const sku of state.skus.values()) {
    if (sku.clientId !== client.id) continue;
    if (availableUnits(state, sku.id) >= (byPallet ? sku.unitsPerPallet : 1)) pool.push(sku);
  }

  const lines: OrderLine[] = [];
  while (lines.length < lineCount && pool.length > 0) {
    const pick = weightedIndex(state, pool.map((s) => balance.orders.velocityWeight[s.velocity]));
    const sku = pool.splice(pick, 1)[0];
    const wanted = 1 + weightedIndex(state, profile.qtyPerLine);
    const available = availableUnits(state, sku.id);
    const qty = byPallet
      ? Math.min(wanted, Math.floor(available / sku.unitsPerPallet)) * sku.unitsPerPallet
      : Math.min(wanted, available);
    stockOf(state, sku.id).allocated += qty;
    lines.push({ skuId: sku.id, qty, picked: 0, error: false });
  }
  if (lines.length === 0) return null; // nothing to sell

  const order: Order = {
    id: state.nextId++,
    clientId: client.id,
    mode: profile.pickMode,
    createdTick: state.tick,
    deadlineTick: slaDeadline(client.contract, state.tick),
    lines,
    status: 'open',
    late: false,
    readyTick: null,
    shippedTick: null,
  };
  state.orders.push(order);
  state.today.ordersCreated++;
  emit(ctx, { type: 'order-created', tick: state.tick, orderId: order.id });
  return order;
}

/** Runs after the carrier has left: whatever is still here past its deadline is late. */
function markLate(state: GameState, ctx: SimContext): void {
  for (const order of state.orders) {
    if (order.late || order.status === 'shipped' || order.deadlineTick > state.tick) continue;
    order.late = true;
    state.today.ordersLate++;
    const client = state.clients.find((c) => c.id === order.clientId);
    if (client) {
      client.month.late++;
      state.today.penalties += client.contract.latePenalty;
      post(state, ctx, 'penalty-late', -client.contract.latePenalty, client.id);
    }
    emit(ctx, { type: 'order-late', tick: state.tick, orderId: order.id });
  }
}
