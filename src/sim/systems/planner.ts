import { balance } from '../../data/balance';
import type { PlannerRule } from '../../data/balance';
import { navOf } from '../context';
import type { SimContext } from '../context';
import { discoverLost } from '../incidents';
import type { NavGrid } from '../nav';
import { removeWorker } from '../people';
import { lostStockFor, planAttend, planPick, planPutaway, planUnload, receivingBlocked } from '../tasks/plan';
import { nextPickupDeparture } from '../time';
import type { Duty, GameState, Order, Task, Worker } from '../types';

/**
 * Task planner: who is in the building, and what each idle worker does next.
 * Priorities come from balance.planner.priorities; a worker's duty and an
 * "all hands to the dock" call narrow down what they may be given.
 */
export function step(state: GameState, ctx: SimContext): void {
  const onShift = ctx.minute >= balance.shift.start && ctx.minute < balance.shift.end;
  updatePresence(state, ctx, onShift);
  if (!onShift) return;

  for (const worker of state.workers) {
    if (worker.status !== 'idle' || worker.taskId !== null || worker.leaving) continue;
    const task = planFor(state, ctx, navOf(state, ctx), worker);
    if (!task) continue;
    state.tasks.push(task);
    worker.taskId = task.id;
  }
}

/**
 * Workers come in at shift start (unless ill) and leave at shift end once
 * their task is done; someone dismissed leaves for good when free.
 */
function updatePresence(state: GameState, ctx: SimContext, onShift: boolean): void {
  for (const worker of [...state.workers]) {
    if (worker.leaving && worker.taskId === null) {
      removeWorker(state, ctx, worker);
    } else if (onShift && worker.status === 'off' && worker.sickUntilDay === null) {
      worker.status = 'idle';
      worker.pos = { ...state.hall.entrance };
      worker.trail = [{ ...state.hall.entrance }];
      // A night's rest — unless they dragged themselves in ill.
      worker.fatigue = worker.unwellUntilDay !== null ? balance.incidents.comeInFatigue : 0;
    } else if (!onShift && worker.status !== 'off' && worker.taskId === null) {
      worker.status = 'off';
    }
  }
}

const DUTY_RULES: Record<Duty, readonly PlannerRule[]> = {
  all: balance.planner.priorities,
  inbound: ['attend', 'unload', 'putaway-blocked', 'putaway'],
  picking: ['attend', 'pick-due', 'pick-ahead'],
};

function planFor(state: GameState, ctx: SimContext, nav: NavGrid, worker: Worker): Task | null {
  const rush = state.tick < state.rushUntilTick;
  for (const rule of balance.planner.priorities) {
    // During "all hands to the dock" everybody works the dock, whatever their duty.
    if (rush ? rule === 'pick-due' || rule === 'pick-ahead' : !DUTY_RULES[worker.duty].includes(rule)) continue;
    const task = applyRule(state, ctx, nav, worker, rule);
    if (task) return task;
  }
  return null;
}

function applyRule(state: GameState, ctx: SimContext, nav: NavGrid, worker: Worker, rule: PlannerRule): Task | null {
  switch (rule) {
    case 'attend':
      return planAttend(state, nav, worker);
    case 'unload':
      return planUnload(state, nav, worker);
    case 'putaway-blocked':
      return receivingBlocked(state) ? planPutaway(state, nav, worker) : null;
    case 'pick-due':
      return planNextPick(state, ctx, nav, worker, true);
    case 'putaway':
      return planPutaway(state, nav, worker);
    case 'pick-ahead':
      return planNextPick(state, ctx, nav, worker, false);
  }
}

/** The most urgent open order (due = must make the next carrier departure) that can be picked now. */
function planNextPick(state: GameState, ctx: SimContext, nav: NavGrid, worker: Worker, due: boolean): Task | null {
  const departure = nextPickupDeparture(state.tick);
  const candidates: Order[] = [];
  for (const order of state.orders) {
    if (order.status === 'open' && order.deadlineTick <= departure === due) candidates.push(order);
  }
  candidates.sort((a, b) => a.deadlineTick - b.deadlineTick || a.id - b.id);
  for (const order of candidates) {
    const task = planPick(state, nav, worker, order);
    if (task) return task;
    // The picker cannot find the goods: a misplaced pallet comes to light.
    for (const pallet of lostStockFor(state, order)) discoverLost(state, ctx, pallet);
  }
  return null;
}
