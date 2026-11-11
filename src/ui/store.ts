import type { AisleRating, PlacementError } from '../sim';
import type { InsightMode } from '../render/insight';
import type { Cell, DailyReport, EntityRef, Orientation } from '../sim/types';

/**
 * State of the interface itself (which tool is in hand, what is selected,
 * which panel is open). Nothing here belongs to the game: it is not saved
 * and the simulation never sees it.
 */
export type Tool = 'select' | 'rack' | 'demolish';
export type PanelId = 'operations' | 'people' | 'clients' | 'finance';

export interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

/** Something that happened and is worth remembering for the rest of the day. */
export interface Notice {
  id: number;
  tone: 'bad' | 'warn' | 'info' | 'good';
  text: string;
  /** When it happened. */
  tick: number;
  /** Where to look, if anywhere. */
  subject: EntityRef | null;
  cell: Cell | null;
}

/** When the game stops by itself so that nothing is missed. */
export interface AutoPause {
  incident: boolean;
  offer: boolean;
  truck: boolean;
}
export type AutoPauseKey = keyof AutoPause;

/** What the building tool reports about the spot under the cursor. */
export interface BuildHint {
  error: PlacementError | 'not-enough-cash' | null;
  aisles: { width: number; rating: AisleRating }[];
  /** Positions of the rack no aisle would reach. */
  unserved: number;
}

export interface UiState {
  tool: Tool;
  orientation: Orientation;
  panel: PanelId | null;
  selection: EntityRef | null;
  topDown: boolean;
  toast: Toast | null;
  hint: BuildHint | null;
  /** The daily report on show (the game waits while it is). */
  report: DailyReport | null;
  /** The explanatory overlay drawn over the hall (key O). */
  insight: InsightMode;
  /** News of the day, newest first. */
  notices: Notice[];
  autoPause: AutoPause;
  /** The last change of cash, for the flash in the top bar. */
  cashFlash: { id: number; up: boolean } | null;
}

export interface Store {
  get(): UiState;
  set(patch: Partial<UiState>): void;
  /** Call `listener` after every change; returns how to stop. */
  subscribe(listener: () => void): () => void;
}

export function createStore(): Store {
  let state: UiState = {
    tool: 'select',
    orientation: 'h',
    panel: null,
    selection: null,
    topDown: false,
    toast: null,
    hint: null,
    report: null,
    insight: 'none',
    notices: [],
    autoPause: { incident: true, offer: true, truck: true },
    cashFlash: null,
  };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const sameRef = (a: EntityRef | null, b: EntityRef | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);
