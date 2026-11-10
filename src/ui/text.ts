import { balance } from '../data/balance';
import { t, tData } from '../data/i18n';
import { activityOf } from '../sim/queries';
import { TICKS_PER_DAY } from '../sim/time';
import type { GameView, Target } from '../sim/types';
import { formatClock } from './format';

/** Wording shared by the panels. */

type Worker = GameView['workers'][number];
type Truck = GameView['trucks'][number];

export const clientName = (id: string | null): string =>
  id === null ? t('truck.carrier') : tData(`client.${id}`, id);

export const skuName = (id: string): string => tData(`sku.${id}`, id);

/** A point in time relative to today: "Today 15:00", "Tomorrow 15:00", "Day 12, 15:00". */
export function whenText(state: GameView, tick: number): string {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const time = formatClock(tick);
  if (day === state.day) return t('time.today', { time });
  if (day === state.day + 1) return t('time.tomorrow', { time });
  if (day === state.day - 1) return t('time.yesterday', { time });
  return t('time.day', { day: day + 1, time });
}

/** "45 min", "2 h 05 min". */
export function durationText(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return t('time.minutes', { minutes: whole });
  const rest = whole % 60;
  return t('time.hours', { hours: Math.floor(whole / 60), minutes: rest < 10 ? `0${rest}` : rest });
}

export const windowText = (truck: Truck): string =>
  t('time.window', { from: formatClock(truck.window.start), to: formatClock(truck.window.end) });

export const shiftText = (): string =>
  t('time.window', { from: formatClock(balance.shift.start), to: formatClock(balance.shift.end) });

function targetText(target: Target): string {
  switch (target.kind) {
    case 'loc':
      return t('activity.to.loc', { loc: target.id });
    case 'dock':
      return t('activity.to.dock');
    case 'station':
      return t('activity.to.station');
    case 'vehicle':
      return t('activity.to.vehicle');
    case 'cell':
      return t('activity.to.cell');
  }
}

/** What a worker is doing, in a few words. */
export function activityText(state: GameView, worker: Worker): string {
  const activity = activityOf(state, worker);
  if (activity.status === 'off') return t('activity.off');
  if (activity.status === 'blocked') return t('activity.blocked');
  if (activity.task === null) return t('activity.idle');

  const what =
    activity.task === 'pick' && activity.orderId !== null
      ? t('activity.pick', { order: activity.orderId })
      : t(`activity.${activity.task}`);
  if (activity.step === 'walk' && activity.target) return `${what} · ${targetText(activity.target)}`;
  if (activity.step && activity.step !== 'walk') return `${what} · ${t(`activity.step.${activity.step}`)}`;
  return what;
}

export function truckStatusText(state: GameView, truck: Truck): string {
  switch (truck.status) {
    case 'en-route':
      return t('truck.status.enRoute');
    case 'waiting':
      return t('truck.status.waiting', { time: durationText(state.tick - (truck.arrivedTick ?? state.tick)) });
    case 'at-dock':
      return truck.kind === 'pickup'
        ? t('truck.status.loading', { time: formatClock(truck.departureTick ?? 0) })
        : t('truck.status.unloading', { left: truck.cargo.length, total: truck.manifest });
    case 'done':
      return t('truck.status.done');
  }
}
