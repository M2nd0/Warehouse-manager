import type { ClientId, ClientKind, PickMode, SkuId } from '../sim/types';

/**
 * Client roster for the MVP. Prices, SLA and demand numbers of each kind are
 * in balance.ts (`balance.contracts[kind]`); display names in i18n under
 * `client.<id>`.
 */
export interface ClientSpec {
  id: ClientId;
  kind: ClientKind;
  pickMode: PickMode;
  /** Pallets of each SKU the client keeps in the warehouse. */
  targetPallets: Record<SkuId, number>;
}

export const clientCatalog: ClientSpec[] = [
  {
    id: 'eshop',
    kind: 'eshop',
    pickMode: 'each',
    // GDD: the first client stores 40 pallets.
    targetPallets: { 'ES-01': 10, 'ES-02': 8, 'ES-03': 6, 'ES-04': 6, 'ES-05': 5, 'ES-06': 5 },
  },
  {
    id: 'wholesale',
    kind: 'wholesale',
    pickMode: 'pallet',
    targetPallets: { 'WS-01': 4, 'WS-02': 4, 'WS-03': 3, 'WS-04': 3 },
  },
];
