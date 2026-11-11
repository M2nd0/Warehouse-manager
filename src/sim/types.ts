/**
 * Core data model of the simulation (GDD "Datový model").
 *
 * Conventions
 * - Time is measured in ticks; 1 tick = 1 in-game minute.
 * - Money is integer cents (`Cents`) so that cash always equals the ledger sum.
 * - Grid cells are integer (x, y) with x along the hall width and y along its
 *   depth; cell (x, y) covers the square [x, x+1) × [y, y+1) metres.
 * - Everything in GameState is plain data (objects, arrays, Maps, numbers,
 *   strings). No class instances, no functions, no hidden state elsewhere.
 */

export type Id = number;
export type LocId = string;
export type SkuId = string;
export type ClientId = string;
export type Cents = number;

/** A grid cell: whole numbers. */
export interface Cell {
  x: number;
  y: number;
}

/** A continuous position in cell coordinates (cell centres are whole numbers). */
export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- hall ----

export type Side = 'N' | 'E' | 'S' | 'W';

export interface Dock {
  id: Id;
  /** Interior cell in front of the door where pallets are handed over. */
  cell: Cell;
  /** Wall the door is in. */
  side: Side;
  truckId: Id | null;
}

export type ZoneKind = 'receiving' | 'dispatch';

/** A painted floor area; every cell of it is one floor storage location. */
export interface Zone {
  id: Id;
  kind: ZoneKind;
  cells: Cell[];
}

export type StationKind = 'packing';

export interface Station {
  id: Id;
  kind: StationKind;
  cell: Cell;
}

export interface Hall {
  /** Size in cells (= metres). */
  width: number;
  depth: number;
  docks: Dock[];
  zones: Zone[];
  stations: Station[];
  /** Personnel door: where workers appear at shift start. */
  entrance: Cell;
}

// ------------------------------------------------------ racks, locations ----

/** 'h' = long side along x, 'v' = long side along y. */
export type Orientation = 'h' | 'v';

export interface Rack {
  id: Id;
  /** Origin (lowest x/y) cell of the footprint. */
  x: number;
  y: number;
  orientation: Orientation;
  levels: number;
}

export type LocationKind = 'rack' | 'floor';

export interface Location {
  /** Address. Rack slots: `ROW-COL-LEVEL-POS` (e.g. `C-06-1-2`). */
  id: LocId;
  kind: LocationKind;
  rackId: Id | null;
  zoneId: Id | null;
  /** Grid cell the slot occupies. */
  cell: Cell;
  /** 1 = floor level. */
  level: number;
  capacityKg: number;
  /** Pallet physically standing here. */
  palletId: Id | null;
  /** Task that is bringing a pallet here. */
  reservedBy: Id | null;
}

// ------------------------------------------------------------- goods ----

export type Velocity = 'A' | 'B' | 'C';
export type TempRegime = 'ambient' | 'chilled' | 'frozen';

export interface Sku {
  id: SkuId;
  clientId: ClientId;
  unitsPerPallet: number;
  unitWeightKg: number;
  velocity: Velocity;
  /** 0 = indestructible … 1 = very fragile. */
  fragility: number;
  temp: TempRegime;
  shelfLifeDays: number | null;
}

/**
 * inbound  – on a truck (or being carried off it)
 * received – in the receiving zone (or being carried to its storage location)
 * stored   – in a rack location, available for picking
 * staged   – picked as a full pallet (carried or standing in the dispatch zone)
 */
export type PalletStatus = 'inbound' | 'received' | 'stored' | 'staged';

export interface Pallet {
  id: Id;
  skuId: SkuId;
  clientId: ClientId;
  /** Units on the pallet. */
  qty: number;
  /** Units promised to pick tasks that are under way. */
  reserved: number;
  locId: LocId | 'in-transit';
  status: PalletStatus;
  /** Task that has claimed the whole pallet (unload / put-away / pallet pick). */
  taskId: Id | null;
  /** Order the pallet is staged for. */
  orderId: Id | null;
  /**
   * Why nobody may pick from it right now: 'lost' — it is not where the
   * records say; 'damaged' — waiting for a decision. Null when all is well.
   */
  hold: 'lost' | 'damaged' | null;
  /** Incident that asked for someone to work on this pallet (search, repack). */
  attendFor: Id | null;
  arrivedTick: number;
  expiryDay: number | null;
}

/** Per-SKU stock index kept in sync with pallets and orders. */
export interface SkuStock {
  /** Units on pallets with status 'stored'. */
  stored: number;
  /** Units promised to orders that have not been physically picked yet. */
  allocated: number;
}

// ----------------------------------------------------------- clients ----

export type ClientKind = 'eshop' | 'wholesale';
export type PickMode = 'each' | 'pallet';

export interface Contract {
  storageFeePerPalletMonth: Cents;
  receivingFeePerPallet: Cents;
  pickFeePerLine: Cents;
  /** Promised dispatch time. */
  slaHours: number;
  /** Orders received after this minute of day count as received at midnight. */
  cutoffMinute: number;
  latePenalty: Cents;
  errorPenalty: Cents;
  startDay: number;
  months: number;
}

/** How a client behaves: demand and replenishment. */
export interface ClientProfile {
  pickMode: PickMode;
  ordersPerDay: number;
  /** Relative order intake per hour of day (24 values). */
  hourlyWeights: number[];
  /** Weights for an order having 1, 2, 3… lines. */
  linesPerOrder: number[];
  /** Weights for a line having 1, 2, 3… units ('each') or pallets ('pallet'). */
  qtyPerLine: number[];
  /** Inbound delivery window, minutes of day. */
  deliveryWindow: { start: number; end: number };
  minPalletsPerDelivery: number;
  maxPalletsPerDelivery: number;
  /** Pallets of each SKU the client wants to keep in the warehouse. */
  targetPallets: Record<SkuId, number>;
}

export interface Client {
  id: ClientId;
  kind: ClientKind;
  active: boolean;
  contract: Contract;
  profile: ClientProfile;
  /** Services delivered since the last invoice. */
  unbilled: {
    /** Pallets in racks, summed over the days. */
    palletDays: number;
    /** Storage fees for those pallet-days, rounded day by day. */
    storageFees: Cents;
    palletsReceived: number;
    lines: number;
  };
  /** SLA performance in the current month. */
  month: { shipped: number; late: number; wrong: number; breachDays: number };
  /** Orders due today, and how many of them were late or wrong. */
  today: { due: number; bad: number };
  /** No offer before this day (just left, or was turned down). */
  nextOfferDay: number;
}

// ------------------------------------------------------------ orders ----

/** open → picking → ready (packed / staged at the dock) → shipped */
export type OrderStatus = 'open' | 'picking' | 'ready' | 'shipped';

export interface OrderLine {
  skuId: SkuId;
  /** Units ordered. */
  qty: number;
  picked: number;
  /** The picker took the wrong thing; found out by the customer. */
  error: boolean;
}

export interface Order {
  id: Id;
  clientId: ClientId;
  mode: PickMode;
  createdTick: number;
  /** Must have left on a carrier at or before this tick. */
  deadlineTick: number;
  lines: OrderLine[];
  status: OrderStatus;
  /** Deadline passed before the order shipped. */
  late: boolean;
  readyTick: number | null;
  shippedTick: number | null;
}

// ------------------------------------------------------------ trucks ----

export type TruckKind = 'inbound' | 'pickup';
export type TruckStatus = 'en-route' | 'waiting' | 'at-dock' | 'done';

export interface Truck {
  id: Id;
  kind: TruckKind;
  /** Whose goods are on board (inbound only). */
  clientId: ClientId | null;
  /** Agreed time window (ticks). */
  window: { start: number; end: number };
  /** When it actually reaches the yard. */
  etaTick: number;
  /** Fixed departure (pickup only). */
  departureTick: number | null;
  status: TruckStatus;
  /** Dock it stands at, or stood at before it left. */
  dockId: Id | null;
  /** Pallets still on board. */
  cargo: Id[];
  /** Pallets on board at arrival. */
  manifest: number;
  arrivedTick: number | null;
  dockedTick: number | null;
  leftTick: number | null;
}

// ----------------------------------------------------------- workers ----

export type Role = 'warehouseman' | 'temp';
/** What a worker may be given: everything, only receiving and put-away, or only picking. */
export type Duty = 'all' | 'inbound' | 'picking';
export type Qualification = 'none' | 'forklift' | 'shift-lead';
/**
 * off     – not in the building
 * idle    – in the building with nothing to do
 * blocked – has a task but cannot get where it sends them (layout problem)
 */
export type WorkerStatus = 'off' | 'idle' | 'walking' | 'working' | 'blocked';

/** Each 1–5. */
export interface WorkerStats {
  speed: number;
  accuracy: number;
  care: number;
  stamina: number;
}

export interface Worker {
  id: Id;
  name: string;
  role: Role;
  stats: WorkerStats;
  qualification: Qualification;
  /** 0–100 */
  fatigue: number;
  /** 0–100 */
  morale: number;
  wagePerMonth: Cents;
  /** Wages earned since the last pay day. */
  wagesOwed: Cents;
  hiredDay: number;
  duty: Duty;
  /** Still learning the ropes until this day (GDD: first week). */
  trainingUntilDay: number;
  /** At home ill until this day; null when well. */
  sickUntilDay: number | null;
  /** Came in although ill: starts each shift tired until this day. */
  unwellUntilDay: number | null;
  /** An agency temp goes back on this day; null for employees. */
  tempUntilDay: number | null;
  /** Dismissed: leaves for good as soon as the task in hand is done. */
  leaving: boolean;
  /** Minutes worked after the end of the shift today. */
  overtimeToday: number;
  status: WorkerStatus;
  pos: Vec2;
  /**
   * Where the worker went during the last tick: the position at its start,
   * every corner passed, and `pos` last. A worker covers several cells per
   * tick, so animate along this line rather than straight to `pos`.
   */
  trail: Vec2[];
  taskId: Id | null;
  /** Vehicle in hand. */
  vehicleId: Id | null;
  /** Pallet on the forks. */
  carrying: Id | null;
  /** Remaining cells of the current walk. */
  path: Cell[];
  /** Minutes left on the current work step… */
  workLeft: number;
  /** …out of this many (0 when not on a work step). */
  workTotal: number;
}

// ---------------------------------------------------------- vehicles ----

export type VehicleKind = 'hand-pallet-jack';

export interface Vehicle {
  id: Id;
  kind: VehicleKind;
  /** Where it stands (follows its user while in hand). */
  pos: Vec2;
  /** Worker who holds or has reserved it. */
  userId: Id | null;
  /** Operating hours (motohodiny). */
  hours: number;
}

// ------------------------------------------------------------- tasks ----

export type TaskKind = 'unload' | 'putaway' | 'pick' | 'attend';

/** Somewhere a worker can be sent. */
export type Target =
  | { kind: 'cell'; cell: Cell }
  /** The aisle next to a storage location. */
  | { kind: 'loc'; id: LocId }
  | { kind: 'dock'; id: Id }
  | { kind: 'station'; id: Id }
  | { kind: 'vehicle'; id: Id };

export type Step =
  /** Walk to the target (to the nearest cell it can be served from). */
  | { op: 'walk'; to: Target }
  | { op: 'take-vehicle'; vehicleId: Id }
  /** Pull a pallet out of the truck and check it against the delivery note. */
  | { op: 'unload'; truckId: Id; palletId: Id }
  /** Take a whole pallet from its location; `order` when it is picked for one. */
  | { op: 'lift'; palletId: Id; order: { id: Id; line: number } | null }
  /** Put the carried pallet down. */
  | { op: 'drop'; palletId: Id; locId: LocId }
  /** Pick units from a pallet for an order line. */
  | { op: 'pick'; palletId: Id; orderId: Id; line: number; qty: number }
  | { op: 'pack'; orderId: Id }
  /** Work an incident asked for at a pallet: search for it, repack it. */
  | { op: 'attend'; palletId: Id; incidentId: Id }
  /** All pallets of the order are staged. */
  | { op: 'stage'; orderId: Id };

/** A unit of work assigned to one worker. Only active tasks are kept. */
export interface Task {
  id: Id;
  kind: TaskKind;
  workerId: Id;
  steps: Step[];
  stepIdx: number;
  /** Path / duration of the current step has been set up. */
  stepStarted: boolean;
  orderId: Id | null;
  createdTick: number;
}

// ----------------------------------------------------------- economy ----

export type LedgerKind =
  | 'rent'
  | 'wages'
  | 'invoice'
  | 'penalty-late'
  | 'penalty-error'
  | 'demurrage'
  /** Building and taking down racks (a refund is a positive entry). */
  | 'construction'
  /** What dealing with an incident cost. */
  | 'incident';

export interface LedgerEntry {
  tick: number;
  kind: LedgerKind;
  /** Signed: income > 0, expense < 0. */
  amount: Cents;
  clientId: ClientId | null;
}

export interface Invoice {
  id: Id;
  clientId: ClientId;
  issuedDay: number;
  dueDay: number;
  amount: Cents;
  paid: boolean;
}

/** Counters for the day in progress. */
export interface DayStats {
  ordersCreated: number;
  ordersShipped: number;
  /** Shipped at or before their deadline. */
  ordersOnTime: number;
  /** Shipped on time and without a picking error. */
  ordersPerfect: number;
  /** Deadline missed today. */
  ordersLate: number;
  linesPicked: number;
  lineErrors: number;
  palletsReceived: number;
  palletsPutAway: number;
  palletsShipped: number;
  trucksServed: number;
  /** Total minutes trucks spent between arrival and docking. */
  truckWaitMinutes: number;
  pickupsMissed: number;
  /** Worker-minutes spent on tasks / on shift. */
  busyMinutes: number;
  shiftMinutes: number;
  /** Fees earned today (invoiced at month end). */
  revenue: Cents;
  penalties: Cents;
}

export interface DailyReport extends DayStats {
  day: number;
  /** On time and in full, 0–1; null when nothing was due. */
  otif: number | null;
  /** Wrong lines / picked lines, 0–1; null when nothing was picked. */
  errorRate: number | null;
  /** (wages + rent of the day) / picked lines; null when nothing was picked. */
  costPerLine: Cents | null;
  wages: Cents;
  rent: Cents;
  storageUsed: number;
  storageCapacity: number;
  openOrders: number;
  cash: Cents;
}

// ---------------------------------------------------------- incidents ----

/** Something in the game an incident, event or panel can point at. */
export type EntityRef =
  | { kind: 'worker' | 'vehicle' | 'truck' | 'dock' | 'rack' | 'pallet' | 'order'; id: Id }
  | { kind: 'location'; id: LocId }
  | { kind: 'client'; id: ClientId };

export type IncidentKind = 'wrong-shipment' | 'lost-goods' | 'sick-leave' | 'dock-congestion' | 'damaged-pallet';

/**
 * A problem the player has to decide about (GDD "Realistické problémy").
 * The game does not solve it for them: if the deadline passes, the
 * do-nothing choice (the first one) applies.
 */
export interface Incident {
  id: Id;
  kind: IncidentKind;
  /** i18n key of the cause shown to the player. */
  cause: string;
  /** What it is about, and where its icon goes in the hall. */
  subject: EntityRef | null;
  cell: Cell | null;
  createdTick: number;
  deadlineTick: number | null;
  /** The 2–3 things the player can do about it; the first is what happens if they do nothing. */
  choices: { id: string; labelKey: string }[];
  /** Numbers the texts and consequences refer to (amounts in cents, minutes, days…). */
  params: Record<string, number>;
  resolved: { choiceId: string; tick: number; byDeadline: boolean } | null;
}

/** A client asking for a contract; stands until `expiresDay`. */
export interface Offer {
  clientId: ClientId;
  expiresDay: number;
}

/** The first day's guided tasks (GDD "Onboarding"): how many of the six are done. */
export interface Onboarding {
  done: number;
}

/** Someone who could be hired today. */
export interface Candidate {
  id: Id;
  name: string;
  stats: WorkerStats;
  wagePerMonth: Cents;
}

// -------------------------------------------------------------- state ----

/** chaos – wherever there is room; fixed – every SKU has its own corner of the hall. */
export type PutawayStrategy = 'chaos' | 'fixed';

export interface GameState {
  /** Save format version. */
  version: number;
  seed: number;
  /** Current RNG state (uint32). */
  rng: number;
  nextId: Id;
  /** The minute about to be simulated; `tick % 1440` is the time of day. */
  tick: number;
  day: number;
  cash: Cents;
  reputation: number;
  hall: Hall;
  racks: Rack[];
  /** Bumped whenever walkability changes (racks built / removed). */
  layoutVersion: number;
  locations: Map<LocId, Location>;
  pallets: Map<Id, Pallet>;
  skus: Map<SkuId, Sku>;
  inventory: Map<SkuId, SkuStock>;
  clients: Client[];
  orders: Order[];
  trucks: Truck[];
  workers: Worker[];
  vehicles: Vehicle[];
  tasks: Task[];
  incidents: Incident[];
  offers: Offer[];
  onboarding: Onboarding;
  /** Days in a row that ended with negative cash. */
  overdraftDays: number;
  /** Set when the overdraft ran out: the game is over and time stands still. */
  gameOver: { day: number } | null;
  /** Today's applicants (GDD: three a day). */
  candidates: Candidate[];
  /** "All hands to the dock": until this tick nobody picks. */
  rushUntilTick: number;
  /** An evening stock count has been ordered for today. */
  stockCountTonight: boolean;
  ledger: LedgerEntry[];
  invoices: Invoice[];
  today: DayStats;
  reports: DailyReport[];
  settings: {
    putawayStrategy: PutawayStrategy;
    /** Fixed positions have been marked out (a one-off purchase). */
    fixedPositions: boolean;
    /** Random trouble (lost and damaged pallets, sickness, congestion) can be switched off for tests. */
    incidents: boolean;
  };
}

// ------------------------------------------------------- read-only view ----

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<K, DeepReadonly<V>>
    : T extends object
      ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
      : T;

/**
 * GameState as render and UI get it: they may look, not touch. All changes
 * go through `sim.step()` and `sim.dispatch()` (CLAUDE.md).
 */
export type GameView = DeepReadonly<GameState>;
