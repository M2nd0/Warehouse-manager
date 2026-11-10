import { balance } from './data/balance';
import { garageStarterRacks } from './data/halls';
import { createView } from './render/scene';
import { createSim } from './sim';
import type { SimEvent } from './sim';
import { mountUi } from './ui';
import { createController } from './ui/controller';
import { formatDailyReport } from './ui/reportText';
import { createStore } from './ui/store';

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

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const uiRoot = document.querySelector<HTMLElement>('#ui');
if (!canvas || !uiRoot) throw new Error('index.html is missing #scene or #ui');

// ?seed=42 fixes the game; ?starter begins with a ready-made rack layout.
const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed')) || Date.now() >>> 0;
const starter = params.has('starter');
const sim = createSim({ seed, racks: starter ? garageStarterRacks : [] });

// An empty hall starts paused: lay out the racks first, then let the day begin.
const loop = { speed: balance.time.speeds[0] as number, paused: !starter };
const view = createView(canvas, sim.state);
const store = createStore();
const controller = createController(canvas, sim, view, store);
const ui = mountUi(uiRoot, store, controller.actions, {
  onSpeed(speed) {
    loop.speed = speed;
    loop.paused = false;
  },
  onPause() {
    loop.paused = !loop.paused;
  },
});

// Space pauses, wherever the focus is. Both key events are cancelled so that
// a focused button is not "clicked" by the same key press.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  if (!event.repeat) loop.paused = !loop.paused;
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') event.preventDefault();
});

function handle(events: SimEvent[]): void {
  for (const event of events) {
    if (event.type === 'day-ended') console.info(formatDailyReport(event.report));
  }
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
    for (let i = 0; i < ticks; i++) handle(sim.step());
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

console.info(`Warehouse Manager — seed ${seed}`);
if (import.meta.env.DEV) Object.assign(window, { sim, view, store });
requestAnimationFrame(frame);
