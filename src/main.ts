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
import { incidentTitle } from './ui/incidentText';
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
      if (!window.confirm(t('menu.newConfirm'))) return;
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

  /** Returns true when the game should stop for the player to look at something. */
  function handle(events: SimEvent[]): boolean {
    let stop = false;
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
          const incident = sim.state.incidents.find((i) => i.id === event.incidentId);
          if (incident) controller.notify(t('incident.new', { title: incidentTitle(incident) }));
          break;
        }
        case 'offer-made':
          controller.notify(t('toast.offer', { client: clientName(event.clientId) }), 'info');
          break;
        case 'client-left':
          controller.notify(t(`toast.clientLeft.${event.reason}`, { client: clientName(event.clientId) }));
          break;
      }
    }
    return stop;
  }

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
    ui.sync(sim.state, loop);
    requestAnimationFrame(frame);
  }

  if (resumed) controller.notify(t('toast.loaded', { day: sim.state.day + 1 }), 'info');
  if (import.meta.env.DEV) Object.assign(window, { sim, view, store });
  requestAnimationFrame(frame);
}

void start();
