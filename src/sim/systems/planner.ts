import { balance } from '../../data/balance';
import type { PlannerRule } from '../../data/balance';
import { navOf } from '../context';
import type { SimContext } from '../context';
import type { NavGrid } from '../nav';
import { planPick, planPutaway, planUnload, receivingBlocked } from '../tasks/plan';
import { nextPickupDeparture } from '../time';
import type { GameState, Order, Task, Worker } from '../types';

/**
 * Task planner: who is in the building, and what each idle worker does next.
 * Priorities come from balance.planner.priorities.
 */
export function step(state: GameState, ctx: SimContext): void {
  const onShift = ctx.minute >= balance.shift.start && ctx.minute < balance.shift.end;
  updatePresence(state, onShift);
  if (!onShift) return;

  for (const worker of state.workers) {
    if (worker.status !== 'idle' || worker.taskId !== null) continue;
    const task = planFor(state, navOf(state, ctx), worker);
    if (!task) continue;
    state.tasks.push(task);
    worker.taskId = task.id;
  }
}

/** Workers come in at shift start and leave at shift end once their task is done. */
function updatePresence(state: GameState, onShift: boolean): void {
  for (const worker of state.workers) {
    if (onShift && worker.status === 'off') {
      worker.status = 'idle';
      worker.pos = { ...state.hall.entrance };
    } else if (!onShift && worker.status !== 'off' && worker.taskId === null) {
      worker.status = 'off';
    }
  }
}

function planFor(state: GameState, nav: NavGrid, worker: Worker): Task | null {
  for (const rule of balance.planner.priorities) {
    const task = applyRule(state, nav, worker, rule);
    if (task) return task;
  }
  return null;
}

function applyRule(state: GameState, nav: NavGrid, worker: Worker, rule: PlannerRule): Task | null {
  switch (rule) {
    case 'unload':
      return planUnload(state, nav, worker);
    case 'putaway-blocked':
      return receivingBlocked(state) ? planPutaway(state, nav, worker) : null;
    case 'pick-due':
      return planNextPick(state, nav, worker, true);
    case 'putaway':
      return planPutaway(state, nav, worker);
    case 'pick-ahead':
      return planNextPick(state, nav, worker, false);
  }
}

/** The most urgent open order (due = must make the next carrier departure) that can be picked now. */
function planNextPick(state: GameState, nav: NavGrid, worker: Worker, due: boolean): Task | null {
  const departure = nextPickupDeparture(state.tick);
  const candidates: Order[] = [];
  for (const order of state.orders) {
    if (order.status === 'open' && order.deadlineTick <= departure === due) candidates.push(order);
  }
  candidates.sort((a, b) => a.deadlineTick - b.deadlineTick || a.id - b.id);
  for (const order of candidates) {
    const task = planPick(state, nav, worker, order);
    if (task) return task;
  }
  return null;
}
