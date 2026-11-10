import { balance } from '../../data/balance';
import { emit } from '../context';
import type { SimContext } from '../context';
import { post } from '../economy/ledger';
import { randomInt } from '../rng';
import { dayStartTick } from '../time';
import type { Client, GameState, Id, Order, Pallet, SkuId, Truck } from '../types';

/**
 * Carriers and the dock: the day's schedule, arrivals, docking, the carrier
 * collection (which ships everything that is ready) and departures.
 */
export function step(state: GameState, ctx: SimContext): void {
  if (ctx.dayStart) scheduleDay(state);
  arrive(state, ctx);
  depart(state, ctx);
  dock(state, ctx);
}

// ---------------------------------------------------------- schedule ----

function newTruck(state: GameState, truck: Omit<Truck, 'id' | 'status' | 'dockId' | 'arrivedTick' | 'dockedTick' | 'leftTick'>): Truck {
  const full: Truck = {
    ...truck,
    id: state.nextId++,
    status: 'en-route',
    dockId: null,
    arrivedTick: null,
    dockedTick: null,
    leftTick: null,
  };
  state.trucks.push(full);
  return full;
}

/**
 * What a client sends today. Clients keep their stock at the contracted
 * number of pallets per SKU: they top up whatever has been used, most
 * depleted SKU first, once it is worth sending a truck.
 */
function planDelivery(state: GameState, client: Client): SkuId[] {
  const profile = client.profile;
  const onHand = new Map<SkuId, number>();
  for (const pallet of state.pallets.values()) {
    if (pallet.clientId !== client.id || pallet.status === 'staged') continue;
    onHand.set(pallet.skuId, (onHand.get(pallet.skuId) ?? 0) + 1);
  }
  const needs = Object.entries(profile.targetPallets).map(([skuId, target]) => ({
    skuId,
    target,
    need: Math.max(0, target - (onHand.get(skuId) ?? 0)),
  }));
  const total = needs.reduce((sum, n) => sum + n.need, 0);
  if (total < profile.minPalletsPerDelivery) return [];

  const load: SkuId[] = [];
  const count = Math.min(total, profile.maxPalletsPerDelivery);
  while (load.length < count) {
    let best = needs[0];
    for (const n of needs) {
      if (n.need / n.target > best.need / best.target) best = n;
    }
    if (best.need <= 0) break;
    best.need--;
    load.push(best.skuId);
  }
  return load;
}

function scheduleDay(state: GameState): void {
  const midnight = dayStartTick(state.day);

  for (const client of state.clients) {
    if (!client.active) continue;
    const load = planDelivery(state, client);
    if (load.length === 0) continue;
    const timeWindow = {
      start: midnight + client.profile.deliveryWindow.start,
      end: midnight + client.profile.deliveryWindow.end,
    };
    const cargo: Id[] = [];
    for (const skuId of load) {
      const sku = state.skus.get(skuId);
      if (!sku) continue;
      const pallet: Pallet = {
        id: state.nextId++,
        skuId,
        clientId: client.id,
        qty: sku.unitsPerPallet,
        reserved: 0,
        locId: 'in-transit',
        status: 'inbound',
        taskId: null,
        orderId: null,
        arrivedTick: timeWindow.start,
        expiryDay: sku.shelfLifeDays === null ? null : state.day + sku.shelfLifeDays,
      };
      state.pallets.set(pallet.id, pallet);
      cargo.push(pallet.id);
    }
    newTruck(state, {
      kind: 'inbound',
      clientId: client.id,
      window: timeWindow,
      etaTick: timeWindow.start + randomInt(state, timeWindow.end - timeWindow.start),
      departureTick: null,
      cargo,
      manifest: cargo.length,
    });
  }

  // The daily carrier collection.
  const { arriveMinute, departMinute } = balance.trucks.pickup;
  newTruck(state, {
    kind: 'pickup',
    clientId: null,
    window: { start: midnight + arriveMinute, end: midnight + departMinute },
    etaTick: midnight + arriveMinute,
    departureTick: midnight + departMinute,
    cargo: [],
    manifest: 0,
  });
}

// ----------------------------------------------------------- arrivals ----

function arrive(state: GameState, ctx: SimContext): void {
  for (const truck of state.trucks) {
    if (truck.status !== 'en-route' || truck.etaTick > state.tick) continue;
    truck.status = 'waiting';
    truck.arrivedTick = state.tick;
    for (const id of truck.cargo) {
      const pallet = state.pallets.get(id);
      if (pallet) pallet.arrivedTick = state.tick;
    }
    emit(ctx, { type: 'truck-arrived', tick: state.tick, truckId: truck.id });
  }
}

// ------------------------------------------------------------ docking ----

/** Free docks take the next truck: the carrier collection first, then first come first served. */
function dock(state: GameState, ctx: SimContext): void {
  for (const bay of state.hall.docks) {
    if (bay.truckId !== null) continue;
    let next: Truck | null = null;
    for (const truck of state.trucks) {
      if (truck.status !== 'waiting') continue;
      if (
        next === null ||
        (truck.kind === 'pickup' && next.kind !== 'pickup') ||
        (truck.kind === next.kind && (truck.arrivedTick ?? 0) < (next.arrivedTick ?? 0))
      ) {
        next = truck;
      }
    }
    if (!next) return;
    next.status = 'at-dock';
    next.dockId = bay.id;
    next.dockedTick = state.tick;
    bay.truckId = next.id;
    state.today.trucksServed++;
    state.today.truckWaitMinutes += state.tick - (next.arrivedTick ?? state.tick);
    emit(ctx, { type: 'truck-docked', tick: state.tick, truckId: next.id, dockId: bay.id });
  }
}

// --------------------------------------------------------- departures ----

function leave(state: GameState, ctx: SimContext, truck: Truck): void {
  if (truck.dockId !== null) {
    const bay = state.hall.docks.find((d) => d.id === truck.dockId);
    if (bay) bay.truckId = null;
  }
  truck.status = 'done';
  truck.leftTick = state.tick;
  emit(ctx, { type: 'truck-left', tick: state.tick, truckId: truck.id });
}

function depart(state: GameState, ctx: SimContext): void {
  for (const truck of state.trucks) {
    if (truck.kind === 'inbound') {
      // Empty and nobody is still pulling a pallet off it.
      if (truck.status !== 'at-dock' || truck.cargo.length > 0) continue;
      chargeDemurrage(state, ctx, truck);
      leave(state, ctx, truck);
    } else if (truck.status !== 'done' && truck.status !== 'en-route') {
      if (truck.departureTick === null || state.tick < truck.departureTick) continue;
      if (truck.status === 'at-dock') {
        shipReadyOrders(state, ctx);
      } else {
        // GDD: the carrier leaves on time, loaded or not.
        state.today.pickupsMissed++;
        emit(ctx, { type: 'pickup-missed', tick: state.tick, truckId: truck.id });
      }
      leave(state, ctx, truck);
    }
  }
}

/** Stojné: the haulier bills every started hour on site beyond the free time. */
function chargeDemurrage(state: GameState, ctx: SimContext, truck: Truck): void {
  const onSite = state.tick - (truck.arrivedTick ?? state.tick);
  const billable = onSite - balance.trucks.freeMinutes;
  if (billable <= 0) return;
  const amount = Math.ceil(billable / 60) * balance.trucks.demurragePerHour;
  state.today.penalties += amount;
  post(state, ctx, 'demurrage', -amount, truck.clientId);
}

/** Everything packed or staged goes on the carrier. */
function shipReadyOrders(state: GameState, ctx: SimContext): void {
  const shipped = new Set<Id>();
  for (const order of state.orders) {
    if (order.status !== 'ready') continue;
    shipOrder(state, ctx, order);
    shipped.add(order.id);
  }
  if (shipped.size === 0) return;
  for (const pallet of [...state.pallets.values()]) {
    if (pallet.status !== 'staged' || pallet.orderId === null || !shipped.has(pallet.orderId)) continue;
    if (pallet.locId !== 'in-transit') {
      const loc = state.locations.get(pallet.locId);
      if (loc) loc.palletId = null;
    }
    state.pallets.delete(pallet.id);
    state.today.palletsShipped++;
  }
}

function shipOrder(state: GameState, ctx: SimContext, order: Order): void {
  const client = state.clients.find((c) => c.id === order.clientId);
  const onTime = !order.late && state.tick <= order.deadlineTick;
  const wrong = order.lines.some((line) => line.error);
  order.status = 'shipped';
  order.shippedTick = state.tick;

  const today = state.today;
  today.ordersShipped++;
  if (onTime) {
    today.ordersOnTime++;
    if (!wrong) today.ordersPerfect++;
  }
  if (client) {
    client.month.shipped++;
    client.unbilled.lines += order.lines.length;
    today.revenue += order.lines.length * client.contract.pickFeePerLine;
    if (wrong) {
      // The customer finds the wrong item: the contract's penalty applies.
      client.month.wrong++;
      today.penalties += client.contract.errorPenalty;
      post(state, ctx, 'penalty-error', -client.contract.errorPenalty, client.id);
    }
  }
  emit(ctx, { type: 'order-shipped', tick: state.tick, orderId: order.id, onTime });
}
