import { balance } from '../data/balance';
import { storageUse } from './economy/report';
import { floorLocId, reachLevels } from './layout';
import { TICKS_PER_DAY, dayStartTick, minuteOfDay, nextPickupDeparture } from './time';
import type {
  Cell,
  Cents,
  EntityRef,
  TruckKind,
  TruckStatus,
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

/** What shipping this order earns (invoiced at the end of the month). */
export function orderFee(state: GameView, order: OrderView): Cents {
  const client = state.clients.find((c) => c.id === order.clientId);
  return client ? order.lines.length * client.contract.pickFeePerLine : 0;
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

/** The one thing worth knowing about a worker at a glance, shown as an icon over their head. */
export type Bubble =
  | 'blocked'
  | 'tired'
  | 'idle'
  | 'carrying'
  | 'picking'
  | 'packing'
  | 'attend'
  /** Step 2: on a break / working past the end of the shift. */
  | 'break'
  | 'overtime';

/**
 * What to show above a worker: trouble first (blocked, exhausted, idle),
 * otherwise what their hands are doing. Null when off shift or just walking
 * with nothing in hand.
 */
export function bubbleOf(state: GameView, worker: WorkerView): Bubble | null {
  if (worker.status === 'off') return null;
  if (worker.status === 'blocked') return 'blocked';
  if (worker.fatigue > balance.people.fatigue.threshold) return 'tired';
  const task = worker.taskId === null ? undefined : state.tasks.find((t) => t.id === worker.taskId);
  if (!task) return 'idle';
  if (worker.carrying !== null) return 'carrying';
  const step = task.steps[Math.min(task.stepIdx, task.steps.length - 1)];
  if (task.kind === 'attend') return 'attend';
  if (task.kind === 'pick' && task.steps.some((s) => s.op === 'pack')) {
    // An order picked by the piece: at the shelves until the last pick is done, then packing.
    const lastPick = task.steps.map((s) => s.op).lastIndexOf('pick');
    return task.stepIdx > lastPick ? 'packing' : 'picking';
  }
  if (step.op === 'unload' || step.op === 'lift' || step.op === 'drop') return 'carrying';
  return null;
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

export interface CellFill {
  cell: Cell;
  /** Fastest turnover class of the goods standing here; null when the positions are empty. */
  velocity: 'A' | 'B' | 'C' | null;
  /** How full the positions the equipment can reach are, 0–1 (a full pallet counts 1). */
  fill: number;
  /** Something here is on hold (lost or damaged). */
  hold: boolean;
}

/** Per rack cell: what turnover class stands there and how full it is (the slot-fill overlay). */
export function slotFill(state: GameView): CellFill[] {
  const reach = reachLevels(state);
  const cells = new Map<string, CellFill>();
  for (const loc of state.locations.values()) {
    if (loc.kind !== 'rack' || loc.level > reach) continue;
    const key = `${loc.cell.x},${loc.cell.y}`;
    let entry = cells.get(key);
    if (!entry) {
      entry = { cell: { x: loc.cell.x, y: loc.cell.y }, velocity: null, fill: 0, hold: false };
      cells.set(key, entry);
    }
    const pallet = loc.palletId === null ? undefined : state.pallets.get(loc.palletId);
    const sku = pallet ? state.skus.get(pallet.skuId) : undefined;
    if (!pallet || !sku) continue;
    entry.fill += Math.min(1, pallet.qty / sku.unitsPerPallet) / reach;
    if (entry.velocity === null || sku.velocity < entry.velocity) entry.velocity = sku.velocity;
    if (pallet.hold !== null) entry.hold = true;
  }
  return [...cells.values()];
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

// -------------------------------------------------------------- the day ----

export interface TimelineTruck {
  id: Id;
  kind: TruckKind;
  clientId: ClientId | null;
  status: TruckStatus;
  /** Agreed window, minutes of today (0–1440). */
  from: number;
  to: number;
  /** Minutes of today it actually arrived, got a dock and left; null if not yet. */
  arrived: number | null;
  docked: number | null;
  left: number | null;
  /** In the yard without a dock right now. */
  waiting: boolean;
}

export interface DayTimeline {
  /** Minute of the day it is now. */
  now: number;
  shift: { start: number; end: number };
  /** Order cutoffs of the active clients (minutes of day), earliest first, each minute once. */
  cutoffs: number[];
  /** When the carrier leaves. */
  departure: number;
  trucks: TimelineTruck[];
  /** Minutes of overtime called for today (drawn after the shift). */
  overtime: number;
  /** Other moments worth a tick on the strip. */
  marks: { key: string; kind: TimelineMarkKind; minute: number }[];
}

export type TimelineMarkKind = 'rush';

/** Everything with a time today, for the strip under the top bar. */
export function dayTimeline(state: GameView): DayTimeline {
  const midnight = dayStartTick(state.day);
  const today = (tick: number | null): number | null =>
    tick === null ? null : Math.min(TICKS_PER_DAY, Math.max(0, tick - midnight));
  const cutoffs = new Set<number>();
  for (const client of state.clients) if (client.active) cutoffs.add(client.contract.cutoffMinute);

  const trucks: TimelineTruck[] = [];
  for (const truck of state.trucks) {
    const { start, end } = truck.window;
    if (end <= midnight || start >= midnight + TICKS_PER_DAY) continue;
    trucks.push({
      id: truck.id,
      kind: truck.kind,
      clientId: truck.clientId,
      status: truck.status,
      from: today(start) ?? 0,
      to: today(end) ?? 0,
      arrived: today(truck.arrivedTick),
      docked: today(truck.dockedTick),
      left: today(truck.leftTick),
      waiting: truck.status === 'waiting',
    });
  }
  trucks.sort((a, b) => a.from - b.from || a.id - b.id);
  return {
    now: minuteOfDay(state.tick),
    shift: shiftToday(state),
    cutoffs: [...cutoffs].sort((a, b) => a - b),
    departure: balance.trucks.pickup.departMinute,
    trucks,
    overtime: 0,
    marks: [],
  };
}

/** Today's working hours, minutes of day. */
export function shiftToday(_state: GameView): { start: number; end: number } {
  return { start: balance.shift.start, end: balance.shift.end };
}

export interface PaceForecast {
  /** Orders that must be on the next carrier and are not packed or staged yet. */
  due: number;
  /** How many of them the pickers can still get through. */
  capacity: number;
  /** due − capacity, never below 0: orders that will miss the carrier at this pace. */
  atRisk: number;
  /** Working minutes left before the carrier leaves. */
  minutesLeft: number;
  /** People who pick (in the building, or expected in when the shift starts). */
  pickers: number;
  minutesPerOrder: number;
  /** Tick of the carrier departure the forecast is for. */
  departureTick: number;
}

/**
 * Will today's orders make the carrier? Orders still to pick × the minutes
 * one takes, against the working minutes left × the people picking.
 * The pace is the day's own once a few orders are done, else yesterday's,
 * else a guess from balance.
 */
export function paceForecast(state: GameView): PaceForecast {
  const departureTick = nextPickupDeparture(state.tick);
  const midnight = dayStartTick(Math.floor(departureTick / TICKS_PER_DAY));
  const shift = shiftToday(state);
  const from = Math.max(state.tick, midnight + shift.start);
  const to = Math.min(departureTick, midnight + shift.end);
  const minutesLeft = Math.max(0, to - from);

  let due = 0;
  for (const order of state.orders) {
    if ((order.status === 'open' || order.status === 'picking') && !order.late && order.deadlineTick <= departureTick) {
      due++;
    }
  }

  const beforeShift = minuteOfDay(state.tick) < shift.start || state.tick < midnight;
  let pickers = 0;
  for (const worker of state.workers) {
    if (worker.duty === 'inbound' || worker.leaving) continue;
    const here = beforeShift ? worker.sickUntilDay === null : worker.status !== 'off';
    if (here) pickers++;
  }

  const A = balance.alerts;
  let minutesPerOrder: number = A.defaultMinutesPerOrder;
  const last = state.reports[state.reports.length - 1];
  if (state.today.picksDone >= A.paceAfterPicks) minutesPerOrder = state.today.pickMinutes / state.today.picksDone;
  else if (last && last.picksDone >= A.paceAfterPicks) minutesPerOrder = last.pickMinutes / last.picksDone;

  const capacity = Math.floor((minutesLeft * pickers) / Math.max(0.5, minutesPerOrder));
  return { due, capacity, atRisk: Math.max(0, due - capacity), minutesLeft, pickers, minutesPerOrder, departureTick };
}

// ---------------------------------------------------------------- alerts ----

export type AlertKind =
  | 'incident'
  | 'orders-late'
  | 'orders-at-risk'
  | 'worker-blocked'
  | 'nobody-in'
  | 'truck-waiting'
  | 'receiving-full'
  | 'storage-full'
  | 'worker-tired'
  | 'worker-idle'
  | 'offer';

export type AlertTone = 'bad' | 'warn' | 'info';

/** Something the player should know about right now, and where to look. */
export interface Alert {
  /** Stable while the situation lasts (for list keys). */
  key: string;
  kind: AlertKind;
  tone: AlertTone;
  /** What to select and where to point the camera. */
  subject: EntityRef | null;
  cell: Cell | null;
  /** Numbers and ids the wording needs. */
  params: Record<string, number | string>;
}

const TONE_ORDER: Record<AlertTone, number> = { bad: 0, warn: 1, info: 2 };

const zoneCell = (state: GameView, kind: 'receiving' | 'dispatch'): Cell | null => {
  const zone = state.hall.zones.find((z) => z.kind === kind);
  const cell = zone?.cells[Math.floor((zone.cells.length - 1) / 2)];
  return cell ? { x: cell.x, y: cell.y } : null;
};

/**
 * The alerts column: every problem that is visible in the hall right now,
 * worst first. Nothing here is stored — the list is worked out from the
 * state, so an alert goes away the moment its cause does.
 */
export function alerts(state: GameView): Alert[] {
  const list: Alert[] = [];
  const A = balance.alerts;
  const minute = minuteOfDay(state.tick);
  const shift = shiftToday(state);
  const onShift = minute >= shift.start && minute < shift.end;
  const packing = state.hall.stations.find((s) => s.kind === 'packing');
  const packingCell = packing ? { x: packing.cell.x, y: packing.cell.y } : null;

  for (const incident of state.incidents) {
    if (incident.resolved !== null) continue;
    list.push({
      key: `incident-${incident.id}`,
      kind: 'incident',
      tone: 'bad',
      subject: incident.subject as EntityRef | null,
      cell: incident.cell ? { x: incident.cell.x, y: incident.cell.y } : null,
      params: { incidentId: incident.id },
    });
  }

  const late = state.orders.filter((o) => o.late && o.status !== 'shipped').length;
  if (late > 0) {
    list.push({ key: 'orders-late', kind: 'orders-late', tone: 'bad', subject: null, cell: packingCell, params: { count: late } });
  }

  const pace = paceForecast(state);
  const departsToday = Math.floor(pace.departureTick / TICKS_PER_DAY) === state.day;
  if (pace.atRisk > 0 && departsToday && minute >= shift.start) {
    list.push({
      key: 'orders-at-risk',
      kind: 'orders-at-risk',
      tone: pace.atRisk * 4 >= pace.due ? 'bad' : 'warn',
      subject: null,
      cell: packingCell,
      params: {
        count: pace.atRisk,
        due: pace.due,
        pickers: pace.pickers,
        minutesLeft: pace.minutesLeft,
        minutesPerOrder: Math.round(pace.minutesPerOrder * 10) / 10,
        departureTick: pace.departureTick,
      },
    });
  }

  let present = 0;
  for (const worker of state.workers) {
    if (worker.status === 'off') continue;
    present++;
    const subject: EntityRef = { kind: 'worker', id: worker.id };
    if (worker.status === 'blocked') {
      list.push({ key: `blocked-${worker.id}`, kind: 'worker-blocked', tone: 'bad', subject, cell: null, params: { name: worker.name } });
    } else if (worker.status === 'idle' && worker.idleSinceTick !== null && onShift) {
      const minutes = state.tick - worker.idleSinceTick;
      if (minutes >= A.idleMinutes) {
        list.push({ key: `idle-${worker.id}`, kind: 'worker-idle', tone: 'info', subject, cell: null, params: { name: worker.name, minutes } });
      }
    }
    if (worker.fatigue > balance.people.fatigue.threshold) {
      list.push({
        key: `tired-${worker.id}`,
        kind: 'worker-tired',
        tone: 'warn',
        subject,
        cell: null,
        params: { name: worker.name, fatigue: Math.round(worker.fatigue) },
      });
    }
  }
  if (onShift && present === 0 && state.workers.length > 0 && state.tick > 0) {
    list.push({ key: 'nobody-in', kind: 'nobody-in', tone: 'bad', subject: null, cell: null, params: {} });
  }

  for (const truck of state.trucks) {
    if (truck.status !== 'waiting' || truck.arrivedTick === null) continue;
    const minutes = state.tick - truck.arrivedTick;
    list.push({
      key: `truck-${truck.id}`,
      kind: 'truck-waiting',
      tone: minutes >= A.truckWaitingMinutes ? 'bad' : 'warn',
      subject: { kind: 'truck', id: truck.id },
      cell: null,
      params: { minutes, client: truck.clientId ?? '', pickup: truck.kind === 'pickup' ? 1 : 0 },
    });
  }

  // Receiving zone: full means the next pallet cannot come off a truck.
  let slots = 0;
  let taken = 0;
  let waitingPallets = 0;
  for (const zone of state.hall.zones) {
    if (zone.kind !== 'receiving') continue;
    for (const cell of zone.cells) {
      const loc = state.locations.get(floorLocId('receiving', cell));
      if (!loc) continue;
      slots++;
      if (loc.palletId !== null || loc.reservedBy !== null) taken++;
      if (loc.palletId !== null) waitingPallets++;
    }
  }
  if (slots > 0 && taken >= slots) {
    list.push({
      key: 'receiving-full',
      kind: 'receiving-full',
      tone: 'warn',
      subject: null,
      cell: zoneCell(state, 'receiving'),
      params: { pallets: taken },
    });
  }

  const storage = storageUse(state);
  if (storage.capacity === 0 ? waitingPallets > 0 : storage.used >= storage.capacity && waitingPallets > 0) {
    list.push({
      key: 'storage-full',
      kind: 'storage-full',
      tone: 'bad',
      subject: null,
      cell: zoneCell(state, 'receiving'),
      params: { pallets: waitingPallets, used: storage.used, capacity: storage.capacity },
    });
  } else if (storage.capacity > 0 && storage.used / storage.capacity > A.storageNearlyFull) {
    list.push({
      key: 'storage-full',
      kind: 'storage-full',
      tone: 'info',
      subject: null,
      cell: null,
      params: { pallets: 0, used: storage.used, capacity: storage.capacity },
    });
  }

  for (const offer of state.offers) {
    list.push({
      key: `offer-${offer.clientId}`,
      kind: 'offer',
      tone: 'info',
      subject: { kind: 'client', id: offer.clientId },
      cell: null,
      params: { client: offer.clientId, untilDay: offer.expiresDay },
    });
  }

  // Worst first; within a tone, in the order found (stable).
  return list
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => TONE_ORDER[a.alert.tone] - TONE_ORDER[b.alert.tone] || a.index - b.index)
    .map((entry) => entry.alert);
}
