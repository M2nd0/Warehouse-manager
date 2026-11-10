import type { DailyReport, Id, LedgerEntry, LocId } from './types';

/**
 * Things that happened during a tick, for the UI (notifications, sounds,
 * icons). Events are transient: they are returned by `sim.step()` and are not
 * part of the saved state.
 */
export type SimEvent =
  | { type: 'truck-arrived'; tick: number; truckId: Id }
  | { type: 'truck-docked'; tick: number; truckId: Id; dockId: Id }
  | { type: 'truck-left'; tick: number; truckId: Id }
  /** The carrier left without loading because it never got a dock. */
  | { type: 'pickup-missed'; tick: number; truckId: Id }
  | { type: 'pallet-received'; tick: number; palletId: Id }
  | { type: 'pallet-stored'; tick: number; palletId: Id; locId: LocId }
  | { type: 'order-created'; tick: number; orderId: Id }
  | { type: 'order-ready'; tick: number; orderId: Id }
  | { type: 'order-shipped'; tick: number; orderId: Id; onTime: boolean }
  | { type: 'order-late'; tick: number; orderId: Id }
  /** A worker cannot reach where the task sends them (layout problem). */
  | { type: 'worker-blocked'; tick: number; workerId: Id }
  | { type: 'money'; tick: number; entry: LedgerEntry }
  | { type: 'day-ended'; tick: number; report: DailyReport };

export type SimEventType = SimEvent['type'];
