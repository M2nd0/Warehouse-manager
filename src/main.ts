import { balance } from './data/balance';
import { garageStarterRacks } from './data/halls';
import { t } from './data/i18n';
import { createView } from './render/scene';
import { readState, serializeState } from './save/serialize';
import { clearSave, readSave, writeSave } from './save/storage';
import { SAVE_VERSION, createSim, resumeSim } from './sim';
import type { Sim, SimEvent } from './sim';
import { mountUi } from './ui';
import { createController } from './ui/controller';
import { createFloaters } from './ui/floaters';
import { formatMoney } from './ui/format';
import { incidentTitle } from './ui/incidentText';
import { orderFee } from './sim/queries';
import { formatDailyReport } from './ui/reportText';
import { createStore } from './ui/store';
import { clientName } from './ui/text';

/**
 * Game loop: sim.step() × N → render.sync(state) → ui.sync(state).
 *
 * The simulation advances in whole ticks only (1 tick = 1 in-game minute).
 * Real time merely decides how many ticks are due; it is never passed into
 * the simulation.
 */

/** Safety valve: never try to catch up more than this in one frame. */
const MAX_TICKS_PER_FRAME = 240;
/** Cosmetic animation (trucks driving in) speeds up with the game, up to this factor. */
const MAX_ANIMATION_SPEED = 4;

/** The saved game if there is one this version can continue, else a new one. */
async function openGame(): Promise<{ sim: Sim; resumed: boolean; starter: boolean }> {
  // ?seed=42 fixes the game; ?starter begins with ready-made racks and both
  // clients; either of them (or ?new) starts afresh instead of loading.
  const params = new URLSearchParams(window.location.search);
  const starter = params.has('starter');
  const fresh = starter || params.has('seed') || params.has('new');
  if (!fresh) {
    const saved = await readSave().catch(() => null);
    const state = saved === null ? null : readState(saved, SAVE_VERSION);
    if (state) return { sim: resumeSim(state), resumed: true, starter: false };
  }
  const seed = Number(params.get('seed')) || Date.now() >>> 0;
  console.info(`Warehouse Manager — seed ${seed}`);
  // GDD: the game begins with one client; others make an offer later.
  const sim = starter ? createSim({ seed, racks: garageStarterRacks }) : createSim({ seed, clients: ['eshop'] });
  return { sim, resumed: false, starter };
}

async function start(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const uiRoot = document.querySelector<HTMLElement>('#ui');
  if (!canvas || !uiRoot) throw new Error('index.html is missing #scene or #ui');

  const { sim, resumed, starter } = await openGame();
  // A hall still to be laid out, or a game just loaded, waits for the player.
  const loop = { speed: balance.time.speeds[0] as number, paused: !starter };
  /** Was the game running when the daily report came up? */
  let resumeAfterReport = false;

  const view = createView(canvas, sim.state);
  const store = createStore();
  const controller = createController(canvas, sim, view, store);
  const save = (): Promise<unknown> => writeSave(serializeState(sim.state)).catch(() => undefined);
  // Beside the Preact root, not inside it: Preact owns everything in there.
  const floaters = createFloaters(document.body, view);
  let flashId = 0;

  /** Middle of a floor cell, at about hand height. */
  const over = (cell: { x: number; y: number }, y = 1.5) => ({ x: cell.x + 0.5, y, z: cell.y + 0.5 });
  const dockCell = () => sim.state.hall.docks[0]?.cell ?? sim.state.hall.entrance;

  const ui = mountUi(uiRoot, store, controller.actions, {
    onSpeed(speed) {
      loop.speed = speed;
      loop.paused = false;
    },
    onPause() {
      loop.paused = !loop.paused;
    },
    onReportClose() {
      store.set({ report: null });
      controller.actions.act({ type: 'read-report' });
      loop.paused = !resumeAfterReport;
    },
    onNew() {
      if (!sim.state.gameOver && !window.confirm(t('menu.newConfirm'))) return;
      void clearSave()
        .catch(() => undefined)
        .then(() => window.location.assign(`${window.location.pathname}?new`));
    },
    onExport() {
      const url = URL.createObjectURL(new Blob([serializeState(sim.state)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `warehouse-manager-day-${sim.state.day + 1}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onImport(file) {
      void file.text().then(async (text) => {
        if (!readState(text, SAVE_VERSION)) {
          controller.notify(t('toast.badSave'));
          return;
        }
        await writeSave(text);
        window.location.assign(window.location.pathname);
      });
    },
  });

  // Space pauses, wherever the focus is. Both key events are cancelled so that
  // a focused button is not "clicked" by the same key press.
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    if (!event.repeat && !store.get().report) loop.paused = !loop.paused;
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') event.preventDefault();
  });

  /**
   * React to what happened in the game: news for the alerts column, numbers
   * floating up where money was made or lost, and stopping the clock for the
   * things the player asked to be stopped for. Returns true to pause.
   */
  function handle(events: SimEvent[]): boolean {
    let stop = false;
    const state = sim.state;
    const { autoPause } = store.get();
    let latePenalty = 0;
    let lateOrders = 0;
    let shipped = 0;
    let shippedLate = 0;
    let cashDelta = 0;
    const builtRack = events.find((e) => e.type === 'rack-built');

    for (const event of events) {
      switch (event.type) {
        case 'day-ended':
          // GDD: autosave every in-game day; the day closes with its report.
          console.info(formatDailyReport(event.report));
          void save();
          store.set({ report: event.report });
          resumeAfterReport = true;
          stop = true;
          break;
        case 'incident-raised': {
          const incident = state.incidents.find((i) => i.id === event.incidentId);
          if (!incident) break;
          const title = incidentTitle(incident);
          if (autoPause.incident) {
            stop = true;
            controller.notify(t('notice.paused.incident', { title }));
            if (store.get().panel !== 'operations') store.set({ panel: 'operations' });
          } else {
            controller.notify(t('incident.new', { title }));
          }
          break;
        }
        case 'offer-made':
          controller.note({
            tone: 'info',
            text: t('toast.offer', { client: clientName(event.clientId) }),
            tick: event.tick,
            subject: null,
            cell: null,
          });
          if (autoPause.offer) stop = true;
          break;
        case 'truck-waiting-long':
          if (autoPause.truck) {
            stop = true;
            controller.notify(t('notice.paused.truck', { minutes: balance.alerts.truckWaitingMinutes }));
            view.focus({ kind: 'truck', id: event.truckId });
          }
          break;
        case 'overdraft':
          controller.note({
            tone: 'bad',
            text: t('toast.overdraft', { days: event.days, max: balance.finance.overdraftDays }),
            tick: event.tick,
            subject: null,
            cell: null,
          });
          break;
        case 'sla-breached':
          controller.note({
            tone: 'bad',
            text: t('toast.slaBreached', {
              client: clientName(event.clientId),
              days: event.days,
              max: balance.clients.breachDaysToLeave,
            }),
            tick: event.tick,
            subject: null,
            cell: null,
          });
          break;
        case 'client-left':
          controller.note({
            tone: 'bad',
            text: t(`toast.clientLeft.${event.reason}`, { client: clientName(event.clientId) }),
            tick: event.tick,
            subject: null,
            cell: null,
          });
          break;
        case 'order-ready': {
          // The fee is earned: show it where the order was finished.
          const order = state.orders.find((o) => o.id === event.orderId);
          if (!order) break;
          const station = state.hall.stations.find((s) => s.kind === 'packing');
          const zone = state.hall.zones.find((z) => z.kind === 'dispatch');
          const cell = order.mode === 'each' ? station?.cell : zone?.cells[Math.floor(zone.cells.length / 2)];
          if (cell) floaters.pop(`+${formatMoney(orderFee(state, order))}`, 'good', over(cell));
          break;
        }
        case 'pallet-received': {
          const pallet = state.pallets.get(event.palletId);
          const client = state.clients.find((c) => c.id === pallet?.clientId);
          const loc = pallet && pallet.locId !== 'in-transit' ? state.locations.get(pallet.locId) : undefined;
          if (client && loc) floaters.pop(`+${formatMoney(client.contract.receivingFeePerPallet)}`, 'good', over(loc.cell));
          break;
        }
        case 'order-shipped':
          shipped++;
          if (!event.onTime) shippedLate++;
          break;
        case 'pickup-missed':
          controller.note({
            tone: 'bad',
            text: t('notice.pickupMissed'),
            tick: event.tick,
            subject: null,
            cell: dockCell(),
          });
          break;
        case 'money': {
          const { kind, amount } = event.entry;
          cashDelta += amount;
          if (kind === 'penalty-late') {
            latePenalty += amount;
            lateOrders++;
          } else if (kind === 'demurrage') {
            floaters.pop(formatMoney(amount, 0), 'bad', over(dockCell(), 2.4));
            controller.note({
              tone: 'bad',
              text: t('notice.demurrage', { amount: formatMoney(amount, 0) }),
              tick: event.tick,
              subject: null,
              cell: dockCell(),
            });
          } else if (kind === 'construction' && builtRack && builtRack.type === 'rack-built') {
            const rack = state.racks.find((r) => r.id === builtRack.rackId);
            if (rack) floaters.pop(formatMoney(amount, 0), 'bad', over(rack, 3));
          }
          break;
        }
      }
    }

    if (lateOrders > 0) {
      const amount = formatMoney(latePenalty, 0);
      floaters.pop(amount, 'bad', over(dockCell(), 2.4));
      controller.note({
        tone: 'bad',
        text: t('notice.orderLate', { count: lateOrders, amount }),
        tick: state.tick,
        subject: null,
        cell: dockCell(),
      });
    }
    if (shipped > 0) {
      floaters.pop(t('float.shipped', { count: shipped }), 'good', over(dockCell(), 3));
      controller.note({
        tone: shippedLate > 0 ? 'warn' : 'good',
        text:
          shippedLate > 0
            ? t('notice.shippedLate', { count: shipped, late: shippedLate })
            : t('notice.shipped', { count: shipped }),
        tick: state.tick,
        subject: null,
        cell: dockCell(),
      });
    }
    if (cashDelta !== 0) store.set({ cashFlash: { id: ++flashId, up: cashDelta > 0 } });
    return stop;
  }
  // What the player's own actions cause is shown the same way (never pausing for it).
  controller.onEvents = (events) => void handle(events);

  let last = performance.now();
  let due = 0;

  function frame(now: number): void {
    // A hidden tab or a long hitch must not turn into a burst of ticks.
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    if (!loop.paused) {
      due += dt * balance.time.ticksPerSecondAt1x * loop.speed;
      const ticks = Math.min(Math.floor(due), MAX_TICKS_PER_FRAME);
      due -= Math.floor(due);
      for (let i = 0; i < ticks; i++) {
        if (handle(sim.step())) {
          loop.paused = true;
          break;
        }
      }
    }

    controller.update(sim.state);
    // `due` is now the fraction of the next tick that has passed: the view uses
    // it to animate between ticks. It stands still while the game is paused.
    const simSeconds = loop.paused ? 0 : dt * Math.min(loop.speed, MAX_ANIMATION_SPEED);
    view.sync(sim.state, due, dt, simSeconds);
    view.draw(dt);
    floaters.update(dt);
    ui.sync(sim.state, loop);
    requestAnimationFrame(frame);
  }

  if (resumed) controller.notify(t('toast.loaded', { day: sim.state.day + 1 }), 'info');
  if (import.meta.env.DEV) Object.assign(window, { sim, view, store, game: { loop, handle } });
  requestAnimationFrame(frame);
}

void start();
