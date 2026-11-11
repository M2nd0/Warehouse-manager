/**
 * Every tunable game number lives here (CLAUDE.md: never inline).
 *
 * Units
 * - money: integer cents — write amounts as `eur(1600)`
 * - durations: in-game minutes (1 minute = 1 tick)
 * - distances: metres (1 grid cell = 1 m)
 *
 * Numbers marked GDD come from docs/GDD.md; everything else is a first guess
 * to be tuned by playing (milestone M6).
 */

/** Euros → integer cents. */
export const eur = (euros: number): number => Math.round(euros * 100);

const HOUR = 60;

export const balance = {
  time: {
    ticksPerDay: 24 * HOUR,
    /** GDD: 3 ticks per real second at 1x → one day ≈ 8 minutes. */
    ticksPerSecondAt1x: 3,
    /** GDD: 1x / 3x / 10x. */
    speeds: [1, 3, 10],
    daysPerWeek: 7,
    daysPerMonth: 30,
  },

  start: {
    /** GDD */
    cash: eur(15_000),
    reputation: 50,
    /** GDD */
    workers: 1,
    handPalletJacks: 1,
  },

  rent: {
    /** GDD: 900 €/month for the garage, paid in advance on the 1st. */
    garagePerMonth: eur(900),
  },

  rack: {
    /** Pallet positions side by side in one 2.7 m bay (= footprint in cells). */
    positions: 3,
    levels: 3,
    capacityKg: 1000,
    /** Price of one bay, and the share returned when it is taken down. */
    price: eur(150),
    demolishRefund: 0.5,
  },

  build: {
    /** GDD: aisles under 2.7 m are shown red, under 3.5 m orange. Metres. */
    aisleNarrowBelow: 2.7,
    aisleTightBelow: 3.5,
    /** How far from a rack face an aisle is measured. */
    aisleMeasureUpTo: 6,
  },

  floorSlot: {
    capacityKg: 1500,
  },

  /** MVP has a single shift. Minutes of day. */
  shift: {
    start: 7 * HOUR,
    end: 15 * HOUR + 30,
  },

  worker: {
    /** GDD: 1 600 €/month, paid weekly. */
    wagePerMonth: eur(1600),
    /**
     * Metres per in-game minute, on foot, for an average worker.
     * Deliberately far below real life (~80 m/min): with a 1 m grid and
     * 1-minute ticks, realistic speed would make every walk take less than a
     * tick and the layout would not matter (GDD pillar 2).
     */
    walkSpeed: 5,
    /** Multiplier on walking and handling speed for the speed stat 1–5. */
    speedFactorByStat: [0.7, 0.85, 1, 1.15, 1.3],
    /** Chance of a wrong pick per line for the accuracy stat 1–5. */
    mispickChanceByStat: [0.048, 0.024, 0.012, 0.006, 0.003],
    startStat: 3,
    startMorale: 70,
  },

  people: {
    /** GDD: 1–3 people in the garage. */
    maxStaff: 3,
    /** GDD: three random candidates a day. */
    candidatesPerDay: 3,
    /** Wage asked = base + this much per stat point (four stats, 1–5 each; average 1 600 €). */
    wageBase: eur(1000),
    wagePerStatPoint: eur(50),
    /** GDD: a new hire works at half speed with twice the errors for the first week. */
    trainingDays: 7,
    trainingSpeedFactor: 0.5,
    trainingErrorFactor: 2,
    fatigue: {
      /** Points per minute of work for the stamina stat 1–5 (stat 3 reaches 70 after a full busy shift). */
      perBusyMinuteByStamina: [0.19, 0.165, 0.14, 0.12, 0.1],
      /** Points lost per idle minute on shift. */
      recoverPerIdleMinute: 0.04,
      /** GDD: above 70 % every stat drops. */
      threshold: 70,
      /** At 100 % fatigue: this much slower, this many times the errors and accidents. */
      maxSpeedLoss: 0.4,
      maxErrorFactor: 2.5,
    },
    morale: {
      /** Where morale settles with a fair wage and no trouble. */
      base: 70,
      /** Share of the gap to its target that morale closes each day. */
      driftPerDay: 0.25,
      /** Points off the target for ending the day exhausted / per hour of overtime. */
      exhaustedPenalty: 15,
      overtimePenaltyPerHour: 6,
      /** Points on the target per 100 € of wage above what the stats are worth (and off, below). */
      perHundredEuroAboveMarket: 4,
    },
  },

  incidents: {
    /** Chance a pallet is put where the records do not say, by accuracy stat 1–5 (GDD: no WMS, chaos). */
    misplaceChanceByStat: [0.05, 0.03, 0.018, 0.009, 0.004],
    /** Chance of damaging a pallet per lift, by care stat 1–5, for a fully fragile SKU. */
    damageChanceByStat: [0.03, 0.018, 0.01, 0.005, 0.002],
    /** Even solid goods get damaged this share as often as fully fragile ones. */
    damageBaseShare: 0.25,
    /** Daily chance of calling in sick at morale 70, and how much each point below adds. */
    sickChancePerDay: 0.012,
    sickChancePerMoralePoint: 0.0012,
    sickDays: { min: 2, max: 5 },
    /** A truck waiting this long for the dock is a congestion incident. */
    congestionAfterMinutes: 45,
    /** Hours the player has to decide before the default applies. */
    decideWithinHours: { wrongShipment: 24, lostGoods: 48, damagedPallet: 24, dockCongestion: 1 },
    /** Wrong shipment: replacement costs this × the penalty; a lost dispute this × the penalty. */
    replacementFactor: 1.5,
    disputeWinChance: 0.4,
    disputeLossFactor: 2,
    /** Lost goods: minutes one person searches; cost of an evening stock count. */
    searchMinutes: 40,
    stockCountCost: eur(60),
    /** Damaged pallet: share written off and what the client is paid; repacking time and material. */
    writeOffShare: 0.3,
    writeOffCompensation: eur(90),
    repackMinutes: 30,
    repackCost: eur(12),
    hideCaughtChance: 0.5,
    hideCaughtFactor: 2,
    /** Dock congestion: fee for sending a truck away; how long "all hands to the dock" lasts. */
    rebookFee: eur(30),
    allHandsMinutes: 60,
    /** Sick leave: an agency temp's monthly rate and stats; morale cost of asking someone to come in ill. */
    tempWagePerMonth: eur(2400),
    tempStats: { speed: 3, accuracy: 2, care: 2, stamina: 3 },
    comeInMoralePenalty: 15,
    comeInFatigue: 50,
    /** Reputation moves. */
    reputation: { replaced: 1, disputeLost: -2, hideCaught: -3, sentAway: -1, goodDay: 0.5, badDay: -1 },
  },

  putaway: {
    /** One-off cost of marking out fixed positions (labels, a floor plan on the wall). */
    fixedPositionsPrice: eur(400),
    /** GDD: fixed locations prevent lost goods — misplacing happens this share as often. */
    fixedMisplaceFactor: 0.3,
  },

  finance: {
    /** GDD: the overdraft covers 14 days of negative cash, then it is insolvency. */
    overdraftDays: 14,
  },

  clients: {
    /** A new client may come knocking from this day on, if the reputation is at least this. */
    offerFromDay: 2,
    offerMinReputation: 40,
    /** How long an offer stands; how long a client stays away after being turned down / after leaving. */
    offerValidDays: 3,
    declineCooldownDays: 7,
    returnAfterDays: 30,
    /** A day counts as an SLA breach when more than this share of a client's orders were late or wrong. */
    breachShare: 0.2,
    /** GDD: a client leaves after 3 SLA breaches in a month. */
    breachDaysToLeave: 3,
    /** GDD: at the end of the contract the client stays only if the reputation is at least this. */
    renewMinReputation: 40,
  },

  vehicles: {
    'hand-pallet-jack': {
      /** GDD */
      price: eur(400),
      /** GDD: floor only. */
      reachLevels: 1,
      /** Multiplier on walking speed while pulling it. */
      emptySpeedFactor: 0.85,
      loadedSpeedFactor: 0.6,
    },
  },

  /** Handling times in minutes for an average worker. */
  handling: {
    takeVehicle: 0.2,
    /** Pull one pallet out of the trailer. */
    unloadPallet: 1,
    /** Check it against the delivery note. */
    receivingCheck: 1,
    liftPallet: 0.5,
    dropPallet: 0.5,
    /** Per order line, plus per unit picked. */
    pickLine: 0.6,
    pickUnit: 0.15,
    /** Per order, plus per line packed. */
    packOrder: 1.5,
    packLine: 0.4,
  },

  trucks: {
    /** Time on site (waiting + unloading) the haulier does not charge for. */
    freeMinutes: 120,
    /** Demurrage (stojné) per started hour beyond the free time. */
    demurragePerHour: eur(35),
    /** Daily carrier collection (svoz). */
    pickup: {
      arriveMinute: 14 * HOUR + 30,
      departMinute: 15 * HOUR,
    },
  },

  orders: {
    /** Relative demand of a SKU by turnover class. */
    velocityWeight: { A: 6, B: 2.5, C: 1 },
  },

  planner: {
    /**
     * What an idle worker does first.
     * putaway-blocked = clear the receiving zone because a truck cannot unload
     * pick-due        = orders that must make the next carrier departure
     * pick-ahead      = orders for a later departure
     * attend          = work an incident asked for (searching, repacking)
     */
    priorities: ['attend', 'unload', 'putaway-blocked', 'pick-due', 'putaway', 'pick-ahead'],
  },

  invoicing: {
    /** GDD: invoices are paid 30 days after month end. */
    paymentTermDays: 30,
  },

  contracts: {
    /** GDD first client: 40 pallets × 8 €/month + 1.20 €/line, ~60 lines/day. */
    eshop: {
      storageFeePerPalletMonth: eur(8),
      receivingFeePerPallet: eur(4),
      pickFeePerLine: eur(1.2),
      slaHours: 24,
      cutoffMinute: 12 * HOUR,
      latePenalty: eur(6),
      errorPenalty: eur(12),
      months: 6,
      /** × 1.9 lines per order ≈ 60 lines/day */
      ordersPerDay: 32,
      /** Shoppers order mostly in the evening. */
      hourlyWeights: [1, 1, 0.5, 0.5, 0.5, 1, 2, 3, 4, 5, 5, 5, 4, 4, 4, 4, 4, 5, 6, 7, 7, 6, 4, 2],
      linesPerOrder: [45, 30, 15, 10],
      qtyPerLine: [60, 28, 12],
      deliveryWindow: { start: 8 * HOUR, end: 10 * HOUR },
      /** A garage gets vans and small trucks, not full trailers. */
      minPalletsPerDelivery: 3,
      maxPalletsPerDelivery: 6,
    },
    wholesale: {
      storageFeePerPalletMonth: eur(7),
      receivingFeePerPallet: eur(4),
      pickFeePerLine: eur(4.5),
      slaHours: 24,
      cutoffMinute: 12 * HOUR,
      latePenalty: eur(40),
      errorPenalty: eur(60),
      months: 12,
      /** ≈ 2.6 pallets out per day; the garage's dispatch zone holds 5. */
      ordersPerDay: 1.5,
      /** Business hours only, mostly in the morning. */
      hourlyWeights: [0, 0, 0, 0, 0, 0, 0, 3, 4, 4, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      linesPerOrder: [70, 30],
      qtyPerLine: [65, 35],
      deliveryWindow: { start: 10 * HOUR, end: 12 * HOUR },
      minPalletsPerDelivery: 3,
      maxPalletsPerDelivery: 6,
    },
  },
} as const;

export type Balance = typeof balance;
export type PlannerRule = (typeof balance.planner.priorities)[number];
