import { balance } from '../data/balance';
import { TICKS_PER_DAY, dayStartTick } from './time';
import type {
  Cents,
  ClientId,
  GameView,
  Id,
  LedgerKind,
  LocId,
  Step,
  Target,
  TaskKind,
  WorkerStatus,
} from './types';

/**
 * Read-only questions the UI asks about the game. Pure functions of the
 * state: nothing here changes it, and all of it can be tested in Node.
 */

type View<T> = T extends keyof GameView ? GameView[T] : never;
type WorkerView = View<'workers'>[number];
type OrderView = View<'orders'>[number];
type TruckView = View<'trucks'>[number];
type PalletView = GameView['pallets'] extends ReadonlyMap<Id, infer P> ? P : never;

const { daysPerMonth, daysPerWeek } = balance.time;

// ------------------------------------------------------------ operations ----

/** On time and in full so far today, 0–1; null when nothing was due yet. */
export function otifToday(state: GameView): number | null {
  const due = state.today.ordersOnTime + state.today.ordersLate;
  return due > 0 ? state.today.ordersPerfect / due : null;
}

/** Share of today's staff minutes spent on tasks, 0–1; null before the shift. */
export function labourUseToday(state: GameView): number | null {
  return state.today.shiftMinutes > 0 ? state.today.busyMinutes / state.today.shiftMinutes : null;
}

/** Trucks expected, waiting or at the dock, in the order they come. */
export function truckBoard(state: GameView): TruckView[] {
  return state.trucks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => a.etaTick - b.etaTick || a.id - b.id);
}

/** Orders still in the building, most urgent first. */
export function openOrders(state: GameView): OrderView[] {
  return state.orders
    .filter((o) => o.status !== 'shipped')
    .sort((a, b) => a.deadlineTick - b.deadlineTick || a.id - b.id);
}

export function unresolvedIncidents(state: GameView): number {
  return state.incidents.filter((i) => i.resolved === null).length;
}

// ---------------------------------------------------------------- people ----

export interface Activity {
  status: WorkerStatus;
  /** What kind of task, if any. */
  task: TaskKind | null;
  /** What the worker is doing right now within it. */
  step: Step['op'] | null;
  /** Where the current walk leads. */
  target: Target | null;
  orderId: Id | null;
  /** How far through the current work step, 0–1; null when walking or idle. */
  progress: number | null;
}

/** What a worker is doing right now. */
export function activityOf(state: GameView, worker: WorkerView): Activity {
  const task = worker.taskId === null ? undefined : state.tasks.find((t) => t.id === worker.taskId);
  const step = task ? task.steps[Math.min(task.stepIdx, task.steps.length - 1)] : undefined;
  return {
    status: worker.status,
    task: task ? task.kind : null,
    step: step ? step.op : null,
    target: step && step.op === 'walk' ? (step.to as Target) : null,
    orderId: task ? task.orderId : null,
    progress:
      worker.status !== 'working' ? null : worker.workTotal > 0 ? 1 - worker.workLeft / worker.workTotal : 0,
  };
}

// --------------------------------------------------------------- storage ----

export interface RackLevel {
  level: number;
  /** One entry per position, left to right. */
  slots: { locId: LocId; capacityKg: number; pallet: PalletView | null; reserved: boolean }[];
}

/** A rack's contents, top level first (the way one looks at a rack). */
export function rackContents(state: GameView, rackId: Id): RackLevel[] {
  const levels = new Map<number, RackLevel>();
  for (const loc of state.locations.values()) {
    if (loc.rackId !== rackId) continue;
    let level = levels.get(loc.level);
    if (!level) {
      level = { level: loc.level, slots: [] };
      levels.set(loc.level, level);
    }
    level.slots.push({
      locId: loc.id,
      capacityKg: loc.capacityKg,
      pallet: loc.palletId === null ? null : (state.pallets.get(loc.palletId) ?? null),
      reserved: loc.reservedBy !== null,
    });
  }
  return [...levels.values()].sort((a, b) => b.level - a.level);
}

/** Weight of a pallet's load in kg. */
export function palletWeight(state: GameView, pallet: PalletView): number {
  const sku = state.skus.get(pallet.skuId);
  return sku ? sku.unitWeightKg * pallet.qty : 0;
}

export interface DockDay {
  /** Minutes a truck has stood at this dock today. */
  busyMinutes: number;
  /** Minutes of today that have passed. */
  elapsedMinutes: number;
  trucks: number;
}

/** How busy a dock has been today. */
export function dockDay(state: GameView, dockId: Id): DockDay {
  const midnight = dayStartTick(state.day);
  let busyMinutes = 0;
  let trucks = 0;
  for (const truck of state.trucks) {
    if (truck.dockId !== dockId || truck.dockedTick === null) continue;
    const from = Math.max(truck.dockedTick, midnight);
    const to = truck.leftTick ?? state.tick;
    if (to <= midnight) continue;
    busyMinutes += Math.max(0, to - from);
    trucks++;
  }
  return { busyMinutes, elapsedMinutes: state.tick - midnight, trucks };
}

// --------------------------------------------------------------- clients ----

/** What a client has run up since the last invoice. */
export function unbilledOf(state: GameView, clientId: ClientId): Cents {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return 0;
  return (
    client.unbilled.storageFees +
    client.unbilled.palletsReceived * client.contract.receivingFeePerPallet +
    client.unbilled.lines * client.contract.pickFeePerLine
  );
}

/** Pallets a client has in the building (any state). */
export function palletsOf(state: GameView, clientId: ClientId): number {
  let count = 0;
  for (const pallet of state.pallets.values()) {
    if (pallet.clientId === clientId && pallet.status !== 'inbound') count++;
  }
  return count;
}

/** Day a contract runs out. */
export function contractEndDay(contract: GameView['clients'][number]['contract']): number {
  return contract.startDay + contract.months * daysPerMonth;
}

// --------------------------------------------------------------- finance ----

export interface MonthToDate {
  /** 0-based month of the game. */
  month: number;
  /** Fees earned (invoiced at month end, paid 30 days later). */
  earned: Cents;
  wages: Cents;
  rent: Cents;
  penalties: Cents;
  /** Money spent on racks, net of refunds. */
  construction: Cents;
  /** earned − wages − rent − penalties (construction is investment, not cost). */
  profit: Cents;
}

/** Profit and loss of the month in progress. */
export function monthToDate(state: GameView): MonthToDate {
  const month = Math.floor(state.day / daysPerMonth);
  const firstDay = month * daysPerMonth;
  const since = dayStartTick(firstDay);

  let earned = state.today.revenue;
  let wages = 0;
  for (const report of state.reports) {
    if (report.day < firstDay) continue;
    earned += report.revenue;
    wages += report.wages;
  }

  const spent: Partial<Record<LedgerKind, Cents>> = {};
  for (const entry of state.ledger) {
    if (entry.tick < since) continue;
    spent[entry.kind] = (spent[entry.kind] ?? 0) - entry.amount;
  }
  const rent = spent.rent ?? 0;
  const penalties = (spent['penalty-late'] ?? 0) + (spent['penalty-error'] ?? 0) + (spent.demurrage ?? 0);
  return {
    month,
    earned,
    wages,
    rent,
    penalties,
    construction: spent.construction ?? 0,
    profit: earned - wages - rent - penalties,
  };
}

export interface CashflowDay {
  day: number;
  /** Expected cash at the end of the day. */
  cash: Cents;
  /** What moves the money that day. */
  items: { kind: LedgerKind; amount: Cents; clientId: ClientId | null }[];
}

/**
 * Cash over the coming days from what is already certain: invoices falling
 * due, rent on the 1st and weekly wages for the people on the payroll today.
 * Fees still being earned are not in it — they are paid 30 days after the
 * month ends (GDD: the cash-flow squeeze is intended).
 */
export function cashflow(state: GameView, days: number = balance.invoicing.paymentTermDays): CashflowDay[] {
  const result: CashflowDay[] = [];
  let cash = state.cash;
  let wagesOwed = 0;
  let wagePerDay = 0;
  for (const worker of state.workers) {
    wagesOwed += worker.wagesOwed;
    wagePerDay += Math.round(worker.wagePerMonth / daysPerMonth);
  }
  const startOfDay = state.tick % TICKS_PER_DAY === 0;

  for (let day = state.day; day <= state.day + days; day++) {
    const items: CashflowDay['items'] = [];
    // Morning: rent and invoices (already booked for today unless it is exactly midnight).
    if (day > state.day || startOfDay) {
      if (day % daysPerMonth === 0) items.push({ kind: 'rent', amount: -balance.rent.garagePerMonth, clientId: null });
      for (const invoice of state.invoices) {
        if (!invoice.paid && (invoice.dueDay === day || (day === state.day && invoice.dueDay < day))) {
          items.push({ kind: 'invoice', amount: invoice.amount, clientId: invoice.clientId });
        }
      }
    }
    // Evening: a day's wages accrue; pay day at the end of the week.
    wagesOwed += wagePerDay;
    if ((day + 1) % daysPerWeek === 0 && wagesOwed > 0) {
      items.push({ kind: 'wages', amount: -wagesOwed, clientId: null });
      wagesOwed = 0;
    }
    for (const item of items) cash += item.amount;
    result.push({ day, cash, items });
  }
  return result;
}
