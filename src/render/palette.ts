/** GDD "Vizuál a audio": natural colours of an industrial warehouse. */
export const palette = {
  concrete: 0xb8b5ae,
  gridLine: 0x8f8c85,
  steel: 0x5c6b78,
  rackOrange: 0xe07b39,
  safetyYellow: 0xf2c230,
  incidentRed: 0xd64545,
  asphalt: 0x5d6166,
  sky: 0xcfd6dc,
  rackUpright: 0x4f6272,
  wood: 0xb99a6b,
  vehicleDark: 0x2f3439,
  trousers: 0x3b4652,
  skin: 0xd8c4ad,
  truckBed: 0x4a5057,
  truckGlass: 0x27313a,
  tyre: 0x1f2226,
  /** Building feedback: fine / GDD orange under 3.5 m / GDD red under 2.7 m. */
  buildOk: 0x7fb77e,
  buildTight: 0xe07b39,
  buildNarrow: 0xd64545,
  selection: 0xf2c230,
  /** Overlays: footfall from cold to hot; turnover classes A / B / C; an empty position. */
  heatCold: 0xf2e6a8,
  heatHot: 0xd64545,
  insightA: 0xd64545,
  insightB: 0xf2c230,
  insightC: 0x4f8fb3,
  insightEmpty: 0x3b4652,
  /** Warm white daylight. */
  sunLight: 0xfff6e8,
  skyLight: 0xf4f7fa,
  groundLight: 0x8a8d90,
} as const;

/** Vest colour tells the role (GDD: people have no faces). */
export const vestColors = {
  warehouseman: 0xf2c230,
  temp: 0xe07b39,
} as const;

/** Cab colour tells whose truck it is. */
export const truckColors: Record<string, number> = {
  eshop: 0x3e7c8c,
  wholesale: 0x58734f,
  carrier: 0xe6e3dc,
};

/**
 * Goods on a pallet: cardboard and shrink-wrap tones, one per SKU, so that
 * different SKUs can be told apart at a glance without leaving the palette.
 */
export const loadColors = [
  0xc9a36b, 0xa9825a, 0xdcc9a6, 0x8f7a5c, 0xcdb48a, 0xb5936b, 0x9fb0b8, 0xd3d7d8, 0xa9b79b, 0x7f95a3,
] as const;
