import type { GameState, SkuId, SkuStock } from './types';

/** Stock index entry of a SKU (created on first use). */
export function stockOf(state: GameState, skuId: SkuId): SkuStock {
  let stock = state.inventory.get(skuId);
  if (!stock) {
    stock = { stored: 0, allocated: 0 };
    state.inventory.set(skuId, stock);
  }
  return stock;
}

/** Units that can still be promised to new orders. */
export function availableUnits(state: GameState, skuId: SkuId): number {
  const stock = state.inventory.get(skuId);
  return stock ? stock.stored - stock.allocated : 0;
}

/** Recount the stock index from pallets and orders (for tests and repairs). */
export function recountInventory(state: GameState): Map<SkuId, SkuStock> {
  const result = new Map<SkuId, SkuStock>();
  const entry = (skuId: SkuId): SkuStock => {
    let s = result.get(skuId);
    if (!s) {
      s = { stored: 0, allocated: 0 };
      result.set(skuId, s);
    }
    return s;
  };
  for (const skuId of state.skus.keys()) entry(skuId);
  for (const pallet of state.pallets.values()) {
    if (pallet.status === 'stored') entry(pallet.skuId).stored += pallet.qty;
  }
  for (const order of state.orders) {
    if (order.status === 'shipped') continue;
    for (const line of order.lines) entry(line.skuId).allocated += line.qty - line.picked;
  }
  return result;
}
