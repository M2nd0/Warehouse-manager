import { balance } from '../data/balance';
import { clientCatalog } from '../data/clients';
import type { ClientSpec } from '../data/clients';
import { garage } from '../data/halls';
import type { HallSpec } from '../data/halls';
import { skuCatalog } from '../data/skus';
import { workerNames } from '../data/workers';
import { emptyDayStats } from './economy/report';
import { addRack, floorLocId } from './layout';
import type { RackPlacement } from './layout';
import { seedRng } from './rng';
import type { Client, ClientId, GameState, Vehicle, VehicleKind, Worker } from './types';

/** Bump when the shape of GameState changes; saves carry it for migration. */
export const SAVE_VERSION = 5;

export interface NewGameOptions {
  seed?: number;
  /** Staff on day one (default: GDD start, one warehouseman). */
  workers?: number;
  /** Clients with a running contract from day one (default: all in the catalogue). The others may make an offer later. */
  clients?: ClientId[];
  /** Racks already standing when the game starts (default: none — the player builds). */
  racks?: RackPlacement[];
  /** Random incidents (default on). Tests of other things switch them off. */
  incidents?: boolean;
}

function buildHall(state: GameState, spec: HallSpec): void {
  const hall = state.hall;
  hall.width = spec.width;
  hall.depth = spec.depth;
  hall.entrance = { ...spec.entrance };
  for (const dock of spec.docks) {
    hall.docks.push({ id: state.nextId++, cell: { ...dock.cell }, side: dock.side, truckId: null });
  }
  for (const station of spec.stations) {
    hall.stations.push({ id: state.nextId++, kind: station.kind, cell: { ...station.cell } });
  }
  for (const zoneSpec of spec.zones) {
    const zone = { id: state.nextId++, kind: zoneSpec.kind, cells: zoneSpec.cells.map((c) => ({ ...c })) };
    hall.zones.push(zone);
    for (const cell of zone.cells) {
      const id = floorLocId(zone.kind, cell);
      state.locations.set(id, {
        id,
        kind: 'floor',
        rackId: null,
        zoneId: zone.id,
        cell: { ...cell },
        level: 1,
        capacityKg: balance.floorSlot.capacityKg,
        palletId: null,
        reservedBy: null,
      });
    }
  }
}

function createClient(spec: ClientSpec, startDay: number, active: boolean): Client {
  const terms = balance.contracts[spec.kind];
  return {
    id: spec.id,
    kind: spec.kind,
    active,
    contract: {
      storageFeePerPalletMonth: terms.storageFeePerPalletMonth,
      receivingFeePerPallet: terms.receivingFeePerPallet,
      pickFeePerLine: terms.pickFeePerLine,
      slaHours: terms.slaHours,
      cutoffMinute: terms.cutoffMinute,
      latePenalty: terms.latePenalty,
      errorPenalty: terms.errorPenalty,
      startDay,
      months: terms.months,
    },
    profile: {
      pickMode: spec.pickMode,
      ordersPerDay: terms.ordersPerDay,
      hourlyWeights: [...terms.hourlyWeights],
      linesPerOrder: [...terms.linesPerOrder],
      qtyPerLine: [...terms.qtyPerLine],
      deliveryWindow: { ...terms.deliveryWindow },
      minPalletsPerDelivery: terms.minPalletsPerDelivery,
      maxPalletsPerDelivery: terms.maxPalletsPerDelivery,
      targetPallets: { ...spec.targetPallets },
    },
    unbilled: { palletDays: 0, storageFees: 0, palletsReceived: 0, lines: 0 },
    month: { shipped: 0, late: 0, wrong: 0, breachDays: 0 },
    today: { due: 0, bad: 0 },
    nextOfferDay: 0,
  };
}

/** An experienced, average warehouseman unless told otherwise. */
export function createWorker(state: GameState, spec: Partial<Pick<Worker, 'name' | 'role' | 'stats' | 'wagePerMonth' | 'trainingUntilDay' | 'tempUntilDay'>> = {}): Worker {
  const stat = balance.worker.startStat;
  const worker: Worker = {
    id: state.nextId++,
    name: spec.name ?? workerNames[state.workers.length % workerNames.length],
    role: spec.role ?? 'warehouseman',
    stats: spec.stats ? { ...spec.stats } : { speed: stat, accuracy: stat, care: stat, stamina: stat },
    qualification: 'none',
    fatigue: 0,
    morale: balance.worker.startMorale,
    wagePerMonth: spec.wagePerMonth ?? balance.worker.wagePerMonth,
    wagesOwed: 0,
    hiredDay: state.day,
    duty: 'all',
    trainingUntilDay: spec.trainingUntilDay ?? state.day,
    sickUntilDay: null,
    unwellUntilDay: null,
    tempUntilDay: spec.tempUntilDay ?? null,
    leaving: false,
    overtimeToday: 0,
    idleSinceTick: null,
    status: 'off',
    pos: { ...state.hall.entrance },
    trail: [],
    taskId: null,
    vehicleId: null,
    carrying: null,
    path: [],
    workLeft: 0,
    workTotal: 0,
  };
  state.workers.push(worker);
  return worker;
}

export function createVehicle(state: GameState, kind: VehicleKind, spec: HallSpec = garage): Vehicle {
  const vehicle: Vehicle = { id: state.nextId++, kind, pos: { ...spec.parking }, userId: null, hours: 0 };
  state.vehicles.push(vehicle);
  return vehicle;
}

/** A new game: the phase 1 garage, empty, on day 0 at 00:00. */
export function createGame(options: NewGameOptions = {}): GameState {
  const seed = (options.seed ?? 1) >>> 0;
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seedRng(seed),
    nextId: 1,
    tick: 0,
    day: 0,
    cash: balance.start.cash,
    reputation: balance.start.reputation,
    hall: { width: 0, depth: 0, docks: [], zones: [], stations: [], entrance: { x: 0, y: 0 } },
    racks: [],
    layoutVersion: 0,
    locations: new Map(),
    pallets: new Map(),
    skus: new Map(),
    inventory: new Map(),
    clients: [],
    orders: [],
    trucks: [],
    workers: [],
    vehicles: [],
    tasks: [],
    incidents: [],
    offers: [],
    onboarding: { done: 0 },
    overdraftDays: 0,
    gameOver: null,
    candidates: [],
    rushUntilTick: 0,
    stockCountTonight: false,
    ledger: [],
    invoices: [],
    today: emptyDayStats(),
    heat: [],
    reports: [],
    settings: { putawayStrategy: 'chaos', fixedPositions: false, incidents: options.incidents ?? true },
  };

  buildHall(state, garage);
  state.heat = new Array<number>(state.hall.width * state.hall.depth).fill(0);
  for (const rack of options.racks ?? []) addRack(state, rack);

  const clientIds = options.clients ?? clientCatalog.map((c) => c.id);
  for (const spec of clientCatalog) state.clients.push(createClient(spec, 0, clientIds.includes(spec.id)));
  for (const sku of skuCatalog) {
    state.skus.set(sku.id, { ...sku });
    state.inventory.set(sku.id, { stored: 0, allocated: 0 });
  }

  const workers = options.workers ?? balance.start.workers;
  for (let i = 0; i < workers; i++) createWorker(state);
  for (let i = 0; i < balance.start.handPalletJacks; i++) createVehicle(state, 'hand-pallet-jack');

  return state;
}
