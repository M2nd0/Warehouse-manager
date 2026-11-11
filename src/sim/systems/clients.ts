import { balance } from '../../data/balance';
import { emit } from '../context';
import type { SimContext } from '../context';
import { stockOf } from '../inventory';
import { contractEndDay } from '../queries';
import type { Client, GameState } from '../types';

const C = balance.clients;

/**
 * Clients come and go (GDD "Klienti a zakázky"): new ones make an offer when
 * the reputation is good enough; one whose SLA was breached on three days of
 * a month leaves, as does one whose contract runs out while the reputation
 * is below its threshold.
 */
export function step(state: GameState, ctx: SimContext): void {
  if (ctx.dayStart) makeOffers(state, ctx);
  if (ctx.dayEnd) closeDay(state, ctx);
  advanceOnboarding(state, ctx);
}

function makeOffers(state: GameState, ctx: SimContext): void {
  state.offers = state.offers.filter((offer) => offer.expiresDay > state.day);
  if (state.day < C.offerFromDay || state.reputation < C.offerMinReputation) return;
  for (const client of state.clients) {
    if (client.active || client.nextOfferDay > state.day) continue;
    if (state.offers.some((o) => o.clientId === client.id) || hasGoodsHere(state, client)) continue;
    state.offers.push({ clientId: client.id, expiresDay: state.day + C.offerValidDays });
    emit(ctx, { type: 'offer-made', tick: state.tick, clientId: client.id });
  }
}

const hasGoodsHere = (state: GameState, client: Client): boolean => {
  for (const pallet of state.pallets.values()) if (pallet.clientId === client.id) return true;
  return state.orders.some((o) => o.clientId === client.id && o.status !== 'shipped');
};

export type OfferError = 'unknown-offer';

export function acceptOffer(state: GameState, ctx: SimContext, clientId: string): OfferError | null {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client || !state.offers.some((o) => o.clientId === clientId)) return 'unknown-offer';
  state.offers = state.offers.filter((o) => o.clientId !== clientId);
  client.active = true;
  client.contract.startDay = state.day;
  client.month = { shipped: 0, late: 0, wrong: 0, breachDays: 0 };
  emit(ctx, { type: 'client-joined', tick: state.tick, clientId });
  return null;
}

export function declineOffer(state: GameState, clientId: string): OfferError | null {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client || !state.offers.some((o) => o.clientId === clientId)) return 'unknown-offer';
  state.offers = state.offers.filter((o) => o.clientId !== clientId);
  client.nextOfferDay = state.day + C.declineCooldownDays;
  return null;
}

function leave(state: GameState, ctx: SimContext, client: Client, reason: 'sla' | 'reputation'): void {
  client.active = false;
  client.nextOfferDay = state.day + C.returnAfterDays;
  emit(ctx, { type: 'client-left', tick: state.tick, clientId: client.id, reason });
}

function closeDay(state: GameState, ctx: SimContext): void {
  for (const client of state.clients) {
    const { due, bad } = client.today;
    if (client.active && due > 0 && bad / due > C.breachShare) client.month.breachDays++;
    client.today = { due: 0, bad: 0 };
    if (!client.active) {
      takeGoodsBack(state, client);
      continue;
    }
    if (client.month.breachDays >= C.breachDaysToLeave) {
      leave(state, ctx, client, 'sla');
    } else if (state.day + 1 >= contractEndDay(client.contract)) {
      // GDD: at the end of the contract the client stays only with a good enough reputation.
      if (state.reputation >= C.renewMinReputation) client.contract.startDay = state.day + 1;
      else leave(state, ctx, client, 'reputation');
    }
  }
}

/**
 * A client who has left has its goods collected: orders nobody has started
 * are cancelled and pallets nobody is handling go away.
 */
function takeGoodsBack(state: GameState, client: Client): void {
  state.orders = state.orders.filter((order) => {
    if (order.clientId !== client.id || order.status !== 'open') return true;
    for (const line of order.lines) stockOf(state, line.skuId).allocated -= line.qty - line.picked;
    return false;
  });
  // Its trucks turn round, unless someone is in the middle of unloading one.
  for (const truck of state.trucks) {
    if (truck.clientId !== client.id || truck.status === 'done') continue;
    if (truck.cargo.some((id) => state.pallets.get(id)?.taskId !== null)) continue;
    for (const id of truck.cargo) state.pallets.delete(id);
    truck.cargo = [];
    const dock = state.hall.docks.find((d) => d.truckId === truck.id);
    if (dock) dock.truckId = null;
    truck.status = 'done';
    truck.leftTick = state.tick;
  }
  for (const pallet of [...state.pallets.values()]) {
    if (pallet.clientId !== client.id || pallet.taskId !== null || pallet.reserved > 0) continue;
    if (pallet.status !== 'stored' && pallet.status !== 'received') continue;
    if (pallet.locId === 'in-transit') continue;
    const stock = stockOf(state, pallet.skuId);
    if (pallet.status === 'stored') {
      // Leave what open orders still count on.
      if (stock.stored - stock.allocated < pallet.qty) continue;
      stock.stored -= pallet.qty;
    }
    const loc = state.locations.get(pallet.locId);
    if (loc) loc.palletId = null;
    state.pallets.delete(pallet.id);
  }
}

/** GDD onboarding: six tasks, each done by actually doing it. */
const ONBOARDING: ((state: GameState) => boolean)[] = [
  (s) => s.racks.length > 0,
  (s) => total(s, 'palletsReceived') > 0,
  (s) => total(s, 'palletsPutAway') > 0,
  (s) => total(s, 'linesPicked') > 0,
  (s) => total(s, 'ordersShipped') > 0,
];
export const ONBOARDING_STEPS = ONBOARDING.length + 1;

const total = (state: GameState, key: 'palletsReceived' | 'palletsPutAway' | 'linesPicked' | 'ordersShipped'): number =>
  state.reports.reduce((sum, report) => sum + report[key], state.today[key]);

export function advanceOnboarding(state: GameState, ctx: SimContext): void {
  const next = ONBOARDING[state.onboarding.done];
  if (!next || !next(state)) return;
  state.onboarding.done++;
  emit(ctx, { type: 'onboarding-step', tick: state.tick, done: state.onboarding.done });
}

/** The last task: the player has read a daily report. */
export function reportRead(state: GameState, ctx: SimContext): void {
  if (state.onboarding.done !== ONBOARDING.length || state.reports.length === 0) return;
  state.onboarding.done++;
  emit(ctx, { type: 'onboarding-step', tick: state.tick, done: state.onboarding.done });
}
