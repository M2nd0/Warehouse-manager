import { balance } from '../data/balance';
import type { Contract } from './types';

export const TICKS_PER_DAY = balance.time.ticksPerDay;

/** Minute of day, 0–1439. */
export const minuteOfDay = (tick: number): number => tick % TICKS_PER_DAY;

export const dayOf = (tick: number): number => Math.floor(tick / TICKS_PER_DAY);

/** First tick (00:00) of a day. */
export const dayStartTick = (day: number): number => day * TICKS_PER_DAY;

/** Tick of the next carrier departure strictly after `tick`. */
export function nextPickupDeparture(tick: number): number {
  const today = dayStartTick(dayOf(tick)) + balance.trucks.pickup.departMinute;
  return tick < today ? today : today + TICKS_PER_DAY;
}

/**
 * Deadline of an order: the last carrier departure that still keeps the SLA.
 *
 * The SLA clock starts when the order arrives, or at midnight if it arrives
 * after the contract's cutoff. With a 24 h SLA and one collection a day this
 * means: ordered before the cutoff → leaves today; after → leaves tomorrow.
 */
export function slaDeadline(contract: Contract, createdTick: number): number {
  const day = dayOf(createdTick);
  const clockStart =
    minuteOfDay(createdTick) <= contract.cutoffMinute ? createdTick : dayStartTick(day + 1);
  const limit = clockStart + contract.slaHours * 60;
  let departure = dayStartTick(dayOf(limit)) + balance.trucks.pickup.departMinute;
  if (departure > limit) departure -= TICKS_PER_DAY;
  // No scheduled departure fits (very short SLA): the limit itself is the deadline.
  return departure > createdTick ? departure : limit;
}
