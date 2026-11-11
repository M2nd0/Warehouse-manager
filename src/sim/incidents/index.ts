import { balance } from '../../data/balance';
import { emit } from '../context';
import type { SimContext } from '../context';
import { post } from '../economy/ledger';
import { stockOf } from '../inventory';
import { errorFactor, removeWorker } from '../people';
import { chance, randomInt } from '../rng';
import { createWorker } from '../state';
import type {
  Cell,
  Cents,
  EntityRef,
  GameState,
  GameView,
  Id,
  Incident,
  IncidentKind,
  Pallet,
  Truck,
  Worker,
} from '../types';

/**
 * Incidents (GDD "Realistické problémy a události").
 *
 * Every incident has a cause the player could have influenced, a probability
 * that grows with it, and two or three choices with consequences. The first
 * choice of each is what happens if the player lets the deadline pass.
 */

const I = balance.incidents;
const statIndex = (stat: number): number => Math.min(5, Math.max(1, Math.round(stat))) - 1;
const clamp = (value: number): number => Math.min(100, Math.max(0, value));
type WorkerLike = GameView['workers'][number];

// ------------------------------------------------------- probabilities ----

/** Chance that a pallet being put away ends up where the records do not say. */
export function misplaceChance(worker: WorkerLike, day: number): number {
  return I.misplaceChanceByStat[statIndex(worker.stats.accuracy)] * errorFactor(worker, day);
}

/** Chance of damaging a pallet while lifting it: care, tiredness and how fragile the goods are. */
export function damageChance(worker: WorkerLike, fragility: number, day: number): number {
  const fragile = I.damageBaseShare + (1 - I.damageBaseShare) * fragility;
  return I.damageChanceByStat[statIndex(worker.stats.care)] * fragile * errorFactor(worker, day);
}

/** Chance of calling in sick this morning: low morale makes it likelier. */
export function sickChance(worker: WorkerLike): number {
  const below = Math.max(0, balance.people.morale.base - worker.morale);
  return I.sickChancePerDay + below * I.sickChancePerMoralePoint;
}

// ---------------------------------------------------------------- raise ----

const CHOICES: Record<IncidentKind, string[]> = {
  'wrong-shipment': ['pay', 'replace', 'dispute'],
  'lost-goods': ['count', 'search'],
  'sick-leave': ['manage', 'temp', 'come-in'],
  'dock-congestion': ['wait', 'all-hands', 'send-away'],
  'damaged-pallet': ['write-off', 'repack', 'hide'],
};

function raise(
  state: GameState,
  ctx: SimContext,
  kind: IncidentKind,
  cause: string,
  subject: EntityRef | null,
  cell: Cell | null,
  deadlineTick: number | null,
  params: Record<string, number>,
): Incident {
  const incident: Incident = {
    id: state.nextId++,
    kind,
    cause: `incident.cause.${cause}`,
    subject,
    cell,
    createdTick: state.tick,
    deadlineTick,
    choices: CHOICES[kind].map((id) => ({ id, labelKey: `incident.${kind}.choice.${id}` })),
    params,
    resolved: null,
  };
  state.incidents.push(incident);
  emit(ctx, { type: 'incident-raised', tick: state.tick, incidentId: incident.id });
  return incident;
}

const open = (state: GameState, kind: IncidentKind, subject: EntityRef): Incident | undefined =>
  state.incidents.find(
    (i) => i.resolved === null && i.kind === kind && i.subject?.kind === subject.kind && i.subject.id === subject.id,
  );

const cellOfPallet = (state: GameState, pallet: Pallet): Cell | null =>
  pallet.locId === 'in-transit' ? null : (state.locations.get(pallet.locId)?.cell ?? null);

/** A customer received the wrong item (GDD: low accuracy, fatigue). */
export function raiseWrongShipment(state: GameState, ctx: SimContext, clientId: string, orderId: Id, penalty: Cents): void {
  raise(
    state,
    ctx,
    'wrong-shipment',
    'carelessPick',
    { kind: 'client', id: clientId },
    null,
    state.tick + I.decideWithinHours.wrongShipment * 60,
    { orderId, penalty },
  );
}

/** Putting a pallet away: it may go astray without anyone noticing yet. */
export function maybeMisplace(state: GameState, worker: Worker, pallet: Pallet): void {
  if (!state.settings.incidents || pallet.hold !== null) return;
  if (chance(state, misplaceChance(worker, state.day))) pallet.hold = 'lost';
}

/** A picker could not find the goods: the misplaced pallet comes to light. */
export function discoverLost(state: GameState, ctx: SimContext, pallet: Pallet): void {
  const subject: EntityRef = { kind: 'pallet', id: pallet.id };
  if (pallet.hold !== 'lost' || open(state, 'lost-goods', subject)) return;
  raise(state, ctx, 'lost-goods', 'chaosPutaway', subject, cellOfPallet(state, pallet),
    state.tick + I.decideWithinHours.lostGoods * 60, { searchMinutes: I.searchMinutes, countCost: I.stockCountCost });
}

/** Lifting a pallet: it may get damaged (GDD: care, fatigue, fragile goods). */
export function maybeDamage(state: GameState, ctx: SimContext, worker: Worker, pallet: Pallet): void {
  if (!state.settings.incidents || pallet.hold !== null) return;
  const sku = state.skus.get(pallet.skuId);
  if (!chance(state, damageChance(worker, sku?.fragility ?? 0, state.day))) return;
  pallet.hold = 'damaged';
  raise(
    state,
    ctx,
    'damaged-pallet',
    worker.fatigue > balance.people.fatigue.threshold ? 'tiredHandling' : 'roughHandling',
    { kind: 'pallet', id: pallet.id },
    { x: Math.round(worker.pos.x), y: Math.round(worker.pos.y) },
    state.tick + I.decideWithinHours.damagedPallet * 60,
    { compensation: I.writeOffCompensation, repackCost: I.repackCost, repackMinutes: I.repackMinutes },
  );
}

/** Morning: does anyone call in sick? (GDD: low morale, overtime.) */
export function rollSickness(state: GameState, ctx: SimContext): void {
  if (!state.settings.incidents) return;
  for (const worker of state.workers) {
    if (worker.sickUntilDay !== null || worker.tempUntilDay !== null || worker.leaving) continue;
    if (!chance(state, sickChance(worker))) continue;
    const days = I.sickDays.min + randomInt(state, I.sickDays.max - I.sickDays.min + 1);
    worker.sickUntilDay = state.day + days;
    raise(
      state,
      ctx,
      'sick-leave',
      worker.morale < balance.people.morale.base - 15 ? 'lowMorale' : 'badLuck',
      { kind: 'worker', id: worker.id },
      null,
      state.tick + balance.shift.end,
      { days, untilDay: worker.sickUntilDay },
    );
  }
}

/** A truck has waited too long for the dock (GDD: more trucks than docks, slow unloading). */
export function checkCongestion(state: GameState, ctx: SimContext): void {
  if (!state.settings.incidents) return;
  for (const truck of state.trucks) {
    if (truck.status !== 'waiting' || truck.arrivedTick === null) continue;
    if (state.tick - truck.arrivedTick !== I.congestionAfterMinutes) continue;
    const blocker = state.trucks.find((t) => t.status === 'at-dock');
    raise(
      state,
      ctx,
      'dock-congestion',
      blocker && blocker.cargo.length > 0 ? 'slowUnloading' : 'tooManyTrucks',
      { kind: 'truck', id: truck.id },
      state.hall.docks[0]?.cell ?? null,
      state.tick + I.decideWithinHours.dockCongestion * 60,
      { rebookFee: I.rebookFee, allHandsMinutes: I.allHandsMinutes, inbound: truck.kind === 'inbound' ? 1 : 0 },
    );
  }
}

// -------------------------------------------------------------- resolve ----

export type ResolveError = 'unknown-incident' | 'unknown-choice' | 'not-possible';

const pay = (state: GameState, ctx: SimContext, amount: Cents, clientId: string | null = null): void => {
  if (amount <= 0) return;
  state.today.penalties += amount;
  post(state, ctx, 'incident', -amount, clientId);
};

const repute = (state: GameState, delta: number): void => {
  state.reputation = clamp(state.reputation + delta);
};

/** Take damaged units off a pallet without breaking promises already made to orders. */
function writeOff(state: GameState, pallet: Pallet): void {
  const stock = stockOf(state, pallet.skuId);
  const free = pallet.status === 'stored' ? stock.stored - stock.allocated : pallet.qty;
  const lost = Math.max(0, Math.min(Math.ceil(pallet.qty * I.writeOffShare), pallet.qty - pallet.reserved - 1, free));
  pallet.qty -= lost;
  if (pallet.status === 'stored') stock.stored -= lost;
}

function sendAway(state: GameState, ctx: SimContext, truck: Truck): void {
  for (const id of truck.cargo) state.pallets.delete(id);
  truck.cargo = [];
  truck.status = 'done';
  truck.leftTick = state.tick;
  emit(ctx, { type: 'truck-left', tick: state.tick, truckId: truck.id });
}

/** Can this choice be taken right now? (Some depend on the situation.) */
export function choiceAvailable(state: GameView, incident: GameView['incidents'][number], choiceId: string): boolean {
  if (incident.kind === 'dock-congestion' && choiceId === 'send-away') {
    const truck = state.trucks.find((t) => t.id === incident.subject?.id);
    return !!truck && truck.kind === 'inbound' && truck.status === 'waiting';
  }
  if (incident.kind === 'sick-leave' && choiceId !== 'manage') {
    const worker = state.workers.find((w) => w.id === incident.subject?.id);
    return !!worker && worker.sickUntilDay !== null;
  }
  return true;
}

/** Apply a choice. Returns why it could not be, or null. */
export function resolve(
  state: GameState,
  ctx: SimContext,
  incidentId: Id,
  choiceId: string,
  byDeadline = false,
): ResolveError | null {
  const incident = state.incidents.find((i) => i.id === incidentId && i.resolved === null);
  if (!incident) return 'unknown-incident';
  if (!incident.choices.some((c) => c.id === choiceId)) return 'unknown-choice';
  if (!choiceAvailable(state, incident, choiceId)) return 'not-possible';
  const subjectId = incident.subject?.id;

  switch (incident.kind) {
    case 'wrong-shipment': {
      const clientId = typeof subjectId === 'string' ? subjectId : null;
      const penalty = incident.params.penalty ?? 0;
      if (choiceId === 'pay') pay(state, ctx, penalty, clientId);
      if (choiceId === 'replace') {
        pay(state, ctx, Math.round(penalty * I.replacementFactor), clientId);
        repute(state, I.reputation.replaced);
      }
      if (choiceId === 'dispute' && !chance(state, I.disputeWinChance)) {
        pay(state, ctx, Math.round(penalty * I.disputeLossFactor), clientId);
        repute(state, I.reputation.disputeLost);
      }
      break;
    }

    case 'lost-goods': {
      const pallet = typeof subjectId === 'number' ? state.pallets.get(subjectId) : undefined;
      if (choiceId === 'count') {
        // Everything astray turns up tonight, for the price of the overtime.
        if (!state.stockCountTonight) pay(state, ctx, I.stockCountCost);
        state.stockCountTonight = true;
      } else if (pallet && pallet.hold === 'lost') {
        pallet.attendFor = incident.id;
      }
      break;
    }

    case 'damaged-pallet': {
      const pallet = typeof subjectId === 'number' ? state.pallets.get(subjectId) : undefined;
      if (!pallet) break;
      if (choiceId === 'write-off') {
        writeOff(state, pallet);
        pay(state, ctx, I.writeOffCompensation, pallet.clientId);
        pallet.hold = null;
      } else if (choiceId === 'repack') {
        pay(state, ctx, I.repackCost);
        pallet.attendFor = incident.id;
      } else {
        pallet.hold = null;
        if (chance(state, I.hideCaughtChance)) {
          pay(state, ctx, Math.round(I.writeOffCompensation * I.hideCaughtFactor), pallet.clientId);
          repute(state, I.reputation.hideCaught);
        }
      }
      break;
    }

    case 'sick-leave': {
      const worker = state.workers.find((w) => w.id === subjectId);
      if (!worker || worker.sickUntilDay === null) break;
      if (choiceId === 'temp') {
        createWorker(state, {
          role: 'temp',
          stats: { ...I.tempStats },
          wagePerMonth: I.tempWagePerMonth,
          tempUntilDay: worker.sickUntilDay,
        });
      } else if (choiceId === 'come-in') {
        worker.unwellUntilDay = worker.sickUntilDay;
        worker.sickUntilDay = null;
        worker.morale = clamp(worker.morale - I.comeInMoralePenalty);
      }
      break;
    }

    case 'dock-congestion': {
      const truck = state.trucks.find((t) => t.id === subjectId);
      if (choiceId === 'all-hands') state.rushUntilTick = state.tick + I.allHandsMinutes;
      if (choiceId === 'send-away' && truck) {
        sendAway(state, ctx, truck);
        pay(state, ctx, I.rebookFee, truck.clientId);
        repute(state, I.reputation.sentAway);
      }
      break;
    }
  }

  incident.resolved = { choiceId, tick: state.tick, byDeadline };
  emit(ctx, { type: 'incident-resolved', tick: state.tick, incidentId: incident.id, choiceId });
  return null;
}

/** Someone has finished the work an incident asked for at a pallet. */
export function attended(pallet: Pallet): void {
  pallet.hold = null;
  pallet.attendFor = null;
}

// ------------------------------------------------------------- upkeep ----

/** Deadlines: an incident nobody decided gets its do-nothing choice. */
export function expire(state: GameState, ctx: SimContext): void {
  for (const incident of state.incidents) {
    if (incident.resolved !== null || incident.deadlineTick === null || incident.deadlineTick > state.tick) continue;
    const fallback = incident.choices.find((c) => choiceAvailable(state, incident, c.id));
    if (fallback) resolve(state, ctx, incident.id, fallback.id, true);
  }
}

/** End of day: the stock count, temps and the sick going back, old incidents filed away. */
export function closeDay(state: GameState, ctx: SimContext): void {
  if (state.stockCountTonight) {
    for (const pallet of state.pallets.values()) {
      if (pallet.hold === 'lost' && pallet.taskId === null) attended(pallet);
    }
    for (const incident of state.incidents) {
      if (incident.resolved === null && incident.kind === 'lost-goods') resolve(state, ctx, incident.id, 'count', true);
    }
    state.stockCountTonight = false;
  }
  const tomorrow = state.day + 1;
  for (const worker of [...state.workers]) {
    if (worker.sickUntilDay !== null && worker.sickUntilDay <= tomorrow) worker.sickUntilDay = null;
    if (worker.unwellUntilDay !== null && worker.unwellUntilDay <= tomorrow) worker.unwellUntilDay = null;
    if (worker.tempUntilDay !== null && worker.tempUntilDay <= tomorrow && worker.taskId === null) {
      removeWorker(state, ctx, worker);
    }
  }
  state.incidents = state.incidents.filter((i) => i.resolved === null);
}
