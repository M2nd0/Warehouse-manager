import type { GameState } from '../sim/types';

/**
 * GameState ⇄ JSON. The state is plain data except for Maps, which are
 * written as `{ "$map": [[key, value], …] }` (insertion order is kept, which
 * the simulation relies on for determinism).
 */

interface SerializedMap {
  $map: [unknown, unknown][];
}

const isSerializedMap = (value: unknown): value is SerializedMap =>
  typeof value === 'object' && value !== null && Array.isArray((value as SerializedMap).$map);

export function serializeState(state: GameState): string {
  return JSON.stringify(state, (_key, value: unknown) =>
    value instanceof Map ? ({ $map: [...value.entries()] } satisfies SerializedMap) : value,
  );
}

export function deserializeState(json: string): GameState {
  return JSON.parse(json, (_key, value: unknown) =>
    isSerializedMap(value) ? new Map(value.$map) : value,
  ) as GameState;
}

/**
 * Read a save, or null if the text is not one this version of the game can
 * continue (damaged file, or written by a different save format).
 */
export function readState(json: string, version: number): GameState | null {
  try {
    const state = deserializeState(json);
    const sound =
      typeof state === 'object' && state !== null && state.version === version && state.pallets instanceof Map;
    return sound ? state : null;
  } catch {
    return null;
  }
}
