import { balance } from '../data/balance';
import { workerNames } from '../data/workers';
import { emit } from './context';
import type { SimContext } from './context';
import { post } from './economy/ledger';
import { randomInt } from './rng';
import { createWorker } from './state';
import type { Candidate, Cents, GameState, GameView, Id, Worker, WorkerStats } from './types';

/**
 * People: how fatigue, training and stats turn into performance, and the
 * coming and going of staff (GDD "Zaměstnanci").
 */

type WorkerLike = GameView['workers'][number];

const { fatigue: F, morale: M } = balance.people;
const statIndex = (stat: number): number => Math.min(5, Math.max(1, Math.round(stat))) - 1;

/** 0 while fatigue is under the threshold, rising to 1 at 100 %. */
export function exhaustion(worker: WorkerLike): number {
  return Math.min(1, Math.max(0, (worker.fatigue - F.threshold) / (100 - F.threshold)));
}

export const inTraining = (worker: WorkerLike, day: number): boolean => day < worker.trainingUntilDay;

/** Multiplier on walking and handling speed right now. */
export function speedFactor(worker: WorkerLike, day: number): number {
  let factor = balance.worker.speedFactorByStat[statIndex(worker.stats.speed)];
  factor *= 1 - exhaustion(worker) * F.maxSpeedLoss;
  if (inTraining(worker, day)) factor *= balance.people.trainingSpeedFactor;
  return factor;
}

/** Multiplier on every chance of a mistake (wrong pick, misplaced or damaged pallet). */
export function errorFactor(worker: WorkerLike, day: number): number {
  let factor = 1 + exhaustion(worker) * (F.maxErrorFactor - 1);
  if (inTraining(worker, day)) factor *= balance.people.trainingErrorFactor;
  return factor;
}

/** Chance of picking the wrong item, per line. */
export function mispickChance(worker: WorkerLike, day: number): number {
  return balance.worker.mispickChanceByStat[statIndex(worker.stats.accuracy)] * errorFactor(worker, day);
}

/** A minute on shift: tiring in proportion to how much of it was work. */
export function tire(worker: Worker, busy: number): void {
  const gain = F.perBusyMinuteByStamina[statIndex(worker.stats.stamina)] * busy;
  const rest = F.recoverPerIdleMinute * (1 - busy);
  worker.fatigue = Math.min(100, Math.max(0, worker.fatigue + gain - rest));
}

/** What someone with these stats asks for. */
export function marketWage(stats: WorkerStats): Cents {
  const points = stats.speed + stats.accuracy + stats.care + stats.stamina;
  return balance.people.wageBase + points * balance.people.wagePerStatPoint;
}

/** End of day: morale drifts towards what pay, overtime and exhaustion justify. */
export function updateMorale(worker: Worker): void {
  const wageGap = (worker.wagePerMonth - marketWage(worker.stats)) / 10_000;
  let target = M.base + wageGap * M.perHundredEuroAboveMarket;
  if (worker.fatigue > F.threshold) target -= M.exhaustedPenalty;
  target -= (worker.overtimeToday / 60) * M.overtimePenaltyPerHour;
  target = Math.min(100, Math.max(0, target));
  worker.morale += (target - worker.morale) * M.driftPerDay;
  worker.overtimeToday = 0;
}

/** Today's applicants: random stats, wage to match. */
export function refreshCandidates(state: GameState): void {
  state.candidates = [];
  for (let i = 0; i < balance.people.candidatesPerDay; i++) {
    const stats: WorkerStats = {
      speed: 1 + randomInt(state, 5),
      accuracy: 1 + randomInt(state, 5),
      care: 1 + randomInt(state, 5),
      stamina: 1 + randomInt(state, 5),
    };
    const candidate: Candidate = {
      id: state.nextId++,
      name: workerNames[randomInt(state, workerNames.length)],
      stats,
      wagePerMonth: marketWage(stats),
    };
    state.candidates.push(candidate);
  }
}

/** People on the payroll who are staying (temps and those under notice do not count). */
export function headcount(state: GameView): number {
  return state.workers.filter((w) => !w.leaving && w.tempUntilDay === null).length;
}

export type HireError = 'unknown-candidate' | 'staff-limit';
export type DismissError = 'unknown-worker' | 'last-worker';

export function hire(state: GameState, ctx: SimContext, candidateId: Id): HireError | null {
  const index = state.candidates.findIndex((c) => c.id === candidateId);
  if (index < 0) return 'unknown-candidate';
  if (headcount(state) >= balance.people.maxStaff) return 'staff-limit';
  const [candidate] = state.candidates.splice(index, 1);
  const worker = createWorker(state, {
    name: candidate.name,
    stats: candidate.stats,
    wagePerMonth: candidate.wagePerMonth,
    trainingUntilDay: state.day + balance.people.trainingDays,
  });
  emit(ctx, { type: 'worker-hired', tick: state.tick, workerId: worker.id });
  return null;
}

/** Pay what is owed and take the worker off the books. They must have nothing in hand. */
export function removeWorker(state: GameState, ctx: SimContext, worker: Worker): void {
  if (worker.wagesOwed > 0) post(state, ctx, 'wages', -worker.wagesOwed);
  state.workers = state.workers.filter((w) => w.id !== worker.id);
  emit(ctx, { type: 'worker-left', tick: state.tick, workerId: worker.id });
}

/** Dismiss someone: at once if they are free, otherwise when the task in hand is done. */
export function dismiss(state: GameState, ctx: SimContext, workerId: Id): DismissError | null {
  const worker = state.workers.find((w) => w.id === workerId);
  if (!worker || worker.leaving) return 'unknown-worker';
  if (worker.tempUntilDay === null && headcount(state) <= 1) return 'last-worker';
  if (worker.taskId === null) removeWorker(state, ctx, worker);
  else worker.leaving = true;
  return null;
}
