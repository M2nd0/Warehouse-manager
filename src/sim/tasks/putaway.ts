import { manhattan, reachable } from '../nav';
import type { NavGrid } from '../nav';
import { randomInt } from '../rng';
import type { Cell, GameState, Location, Pallet } from '../types';

/** Rack slots a pallet could go to right now. */
function freeSlots(
  state: GameState,
  nav: NavGrid,
  pallet: Pallet,
  reach: number,
  region: number,
): Location[] {
  const sku = state.skus.get(pallet.skuId);
  const weight = sku ? sku.unitWeightKg * pallet.qty : 0;
  const slots: Location[] = [];
  for (const loc of state.locations.values()) {
    if (loc.kind !== 'rack' || loc.palletId !== null || loc.reservedBy !== null) continue;
    if (loc.level > reach || loc.capacityKg < weight) continue;
    if (!reachable(nav, region, nav.access.get(loc.id) ?? [])) continue;
    slots.push(loc);
  }
  return slots;
}

/**
 * Fixed positions: a SKU lives in one place. A pallet goes to the free slot
 * nearest to where that SKU already stands; the first pallet of a SKU opens
 * its place at the free slot nearest the packing station.
 */
function fixedSlot(state: GameState, pallet: Pallet, slots: Location[]): Location {
  const mates: Cell[] = [];
  for (const other of state.pallets.values()) {
    if (other.skuId !== pallet.skuId || other.id === pallet.id || other.locId === 'in-transit') continue;
    const loc = state.locations.get(other.locId);
    if (loc && loc.kind === 'rack') mates.push(loc.cell);
  }
  const anchors = mates.length > 0 ? mates : state.hall.stations.map((s) => s.cell);
  const distance = (slot: Location): number => {
    let best = Infinity;
    for (const anchor of anchors) best = Math.min(best, manhattan(slot.cell, anchor));
    return best;
  };
  let best = slots[0];
  let bestDistance = distance(best);
  for (const slot of slots) {
    const d = distance(slot);
    if (d < bestDistance) {
      best = slot;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Where a pallet is put away.
 *
 * chaos — GDD: without a WMS the warehouseman picks a spot himself: any free
 * slot, with no regard for turnover or where the same SKU already is.
 * fixed — every SKU has its place (see `fixedSlot`).
 */
export function chooseLocation(
  state: GameState,
  nav: NavGrid,
  pallet: Pallet,
  reach: number,
  region: number,
): Location | null {
  const slots = freeSlots(state, nav, pallet, reach, region);
  if (slots.length === 0) return null;
  switch (state.settings.putawayStrategy) {
    case 'chaos':
      return slots[randomInt(state, slots.length)];
    case 'fixed':
      return fixedSlot(state, pallet, slots);
  }
}
