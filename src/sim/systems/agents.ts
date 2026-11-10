import type { SimContext } from '../context';
import { beginStep, completeTask, finishStep, walkSpeed } from '../tasks/execute';
import type { GameState, Worker } from '../types';

const EPSILON = 1e-9;

/**
 * Agents: every worker spends this minute on their task — walking along the
 * path and doing the work steps. A minute is split exactly: a worker who
 * arrives after 0.4 min uses the remaining 0.6 min on the next step.
 */
export function step(state: GameState, ctx: SimContext): void {
  for (const worker of state.workers) {
    if (worker.status === 'off') continue;
    state.today.shiftMinutes++;

    const task = worker.taskId === null ? undefined : state.tasks.find((t) => t.id === worker.taskId);
    if (!task) {
      worker.status = 'idle';
      continue;
    }

    let budget = 1;
    let blocked = false;
    while (budget > EPSILON && task.stepIdx < task.steps.length) {
      if (!task.stepStarted && !beginStep(state, ctx, worker, task)) {
        blocked = true;
        break;
      }
      const current = task.steps[task.stepIdx];
      if (current.op === 'walk') {
        budget = walk(worker, budget, walkSpeed(state, worker));
        if (worker.path.length > 0) break; // still on the way
      } else {
        const used = Math.min(budget, worker.workLeft);
        worker.workLeft -= used;
        budget -= used;
        if (worker.workLeft > EPSILON) break; // still working
      }
      finishStep(state, ctx, worker, task);
      task.stepIdx++;
      task.stepStarted = false;
    }
    state.today.busyMinutes += blocked ? 0 : 1 - Math.max(0, budget);

    if (task.stepIdx >= task.steps.length) {
      completeTask(state, worker, task);
      worker.status = 'idle';
    } else if (!blocked) {
      worker.status = task.steps[task.stepIdx].op === 'walk' ? 'walking' : 'working';
    }
  }
}

/** Advance along the path; returns the part of the minute left over. */
function walk(worker: Worker, budget: number, speed: number): number {
  while (budget > EPSILON && worker.path.length > 0) {
    const next = worker.path[0];
    const dx = next.x - worker.pos.x;
    const dy = next.y - worker.pos.y;
    const distance = Math.abs(dx) + Math.abs(dy);
    const range = speed * budget;
    if (range + EPSILON >= distance) {
      worker.pos = { x: next.x, y: next.y };
      worker.path.shift();
      budget = Math.max(0, budget - distance / speed);
    } else {
      const f = range / distance;
      worker.pos = { x: worker.pos.x + dx * f, y: worker.pos.y + dy * f };
      budget = 0;
    }
  }
  return budget;
}
