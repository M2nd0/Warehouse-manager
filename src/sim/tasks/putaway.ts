import { reachable } from '../nav';
import type { NavGrid } from '../nav';
import { randomInt } from '../rng';
import type { GameState, Location, Pallet } from '../types';

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
 * Where a pallet is put away.
 *
 * chaos — GDD: without a WMS the warehouseman picks a spot himself: any free
 * slot, with no regard for turnover or where the same SKU already is.
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
  }
}
