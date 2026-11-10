import { reachLevels } from '../layout';
import type { Cents, DailyReport, DayStats, GameState } from '../types';

export function emptyDayStats(): DayStats {
  return {
    ordersCreated: 0,
    ordersShipped: 0,
    ordersOnTime: 0,
    ordersPerfect: 0,
    ordersLate: 0,
    linesPicked: 0,
    lineErrors: 0,
    palletsReceived: 0,
    palletsPutAway: 0,
    palletsShipped: 0,
    trucksServed: 0,
    truckWaitMinutes: 0,
    pickupsMissed: 0,
    busyMinutes: 0,
    shiftMinutes: 0,
    revenue: 0,
    penalties: 0,
  };
}

/** Rack positions the current equipment can serve, and how many are taken. */
export function storageUse(state: GameState): { used: number; capacity: number } {
  const reach = reachLevels(state);
  let used = 0;
  let capacity = 0;
  for (const loc of state.locations.values()) {
    if (loc.kind !== 'rack' || loc.level > reach) continue;
    capacity++;
    if (loc.palletId !== null) used++;
  }
  return { used, capacity };
}

/**
 * The daily report (GDD "Hlavní metriky").
 *
 * OTIF       = orders shipped on time and without error
 *              ÷ (orders shipped on time + orders that missed their deadline today)
 * error rate = wrong lines ÷ picked lines
 * cost/line  = (wages + rent of the day) ÷ picked lines
 */
export function buildReport(state: GameState, wages: Cents, rent: Cents): DailyReport {
  const t = state.today;
  const due = t.ordersOnTime + t.ordersLate;
  const { used, capacity } = storageUse(state);
  return {
    ...t,
    day: state.day,
    otif: due > 0 ? t.ordersPerfect / due : null,
    errorRate: t.linesPicked > 0 ? t.lineErrors / t.linesPicked : null,
    costPerLine: t.linesPicked > 0 ? Math.round((wages + rent) / t.linesPicked) : null,
    wages,
    rent,
    storageUsed: used,
    storageCapacity: capacity,
    openOrders: state.orders.filter((o) => o.status !== 'shipped').length,
    cash: state.cash,
  };
}
