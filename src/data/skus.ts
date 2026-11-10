import type { Sku } from '../sim/types';

/**
 * SKU catalogue for the MVP: 10 SKUs, all ambient, no expiry.
 * Display names live in i18n under `sku.<id>`.
 */
export const skuCatalog: Sku[] = [
  // e-shop: home & kitchen goods, picked by the piece
  { id: 'ES-01', clientId: 'eshop', unitsPerPallet: 48, unitWeightKg: 1.2, velocity: 'A', fragility: 0.3, temp: 'ambient', shelfLifeDays: null },
  { id: 'ES-02', clientId: 'eshop', unitsPerPallet: 120, unitWeightKg: 0.4, velocity: 'A', fragility: 0.1, temp: 'ambient', shelfLifeDays: null },
  { id: 'ES-03', clientId: 'eshop', unitsPerPallet: 60, unitWeightKg: 2.8, velocity: 'B', fragility: 0, temp: 'ambient', shelfLifeDays: null },
  { id: 'ES-04', clientId: 'eshop', unitsPerPallet: 40, unitWeightKg: 2.2, velocity: 'B', fragility: 0.8, temp: 'ambient', shelfLifeDays: null },
  { id: 'ES-05', clientId: 'eshop', unitsPerPallet: 36, unitWeightKg: 1.6, velocity: 'C', fragility: 0.3, temp: 'ambient', shelfLifeDays: null },
  { id: 'ES-06', clientId: 'eshop', unitsPerPallet: 24, unitWeightKg: 7.5, velocity: 'C', fragility: 0.9, temp: 'ambient', shelfLifeDays: null },
  // wholesale: household supplies, shipped by the full pallet
  { id: 'WS-01', clientId: 'wholesale', unitsPerPallet: 48, unitWeightKg: 16, velocity: 'A', fragility: 0.2, temp: 'ambient', shelfLifeDays: null },
  { id: 'WS-02', clientId: 'wholesale', unitsPerPallet: 30, unitWeightKg: 6, velocity: 'A', fragility: 0, temp: 'ambient', shelfLifeDays: null },
  { id: 'WS-03', clientId: 'wholesale', unitsPerPallet: 60, unitWeightKg: 13, velocity: 'B', fragility: 0.2, temp: 'ambient', shelfLifeDays: null },
  { id: 'WS-04', clientId: 'wholesale', unitsPerPallet: 36, unitWeightKg: 25, velocity: 'B', fragility: 0, temp: 'ambient', shelfLifeDays: null },
];
