import { balance } from '../data/balance';
import { t } from '../data/i18n';
import type { View } from '../render/scene';
import type { Action, RackPlacement, Sim } from '../sim';
import type { Cell, EntityRef, GameView, Id } from '../sim/types';
import { sameRef } from './store';
import type { PanelId, Store, Tool } from './store';

/**
 * Mouse and keyboard in the 3D view: selecting things, placing and removing
 * racks. Everything it changes in the game goes through `sim.dispatch()`.
 */

/** A press that moves less than this many pixels is a click, not a camera drag. */
const CLICK_SLOP = 5;
const TOAST_MS = 3200;
const PANEL_KEYS: Record<string, PanelId> = {
  Digit1: 'operations',
  Digit2: 'people',
  Digit3: 'clients',
  Digit4: 'finance',
};

/** What the interface can ask for; handed to the components. */
export interface UiActions {
  setTool(tool: Tool): void;
  rotate(): void;
  togglePanel(panel: PanelId): void;
  select(ref: EntityRef | null): void;
  toggleTopDown(): void;
  demolish(rackId: Id): void;
  /** Send an action to the game; a refusal is shown as a message. Returns whether it went through. */
  act(action: Action): boolean;
}

export interface Controller {
  actions: UiActions;
  /** Call once per frame: keeps the ghost and the selection in step with the game. */
  update(state: GameView): void;
  /** Show a short message above the toolbar. */
  notify(text: string, tone?: 'error' | 'info'): void;
  dispose(): void;
}

/** Does the thing a reference points at still exist? */
function exists(state: GameView, ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'worker':
      return state.workers.some((w) => w.id === ref.id && w.status !== 'off');
    case 'vehicle':
      return state.vehicles.some((v) => v.id === ref.id);
    case 'truck':
      return state.trucks.some((tr) => tr.id === ref.id && tr.status !== 'done' && tr.status !== 'en-route');
    case 'dock':
      return state.hall.docks.some((d) => d.id === ref.id);
    case 'rack':
      return state.racks.some((r) => r.id === ref.id);
    case 'pallet':
      return state.pallets.has(ref.id);
    default:
      return true;
  }
}

export function createController(canvas: HTMLCanvasElement, sim: Sim, view: View, store: Store): Controller {
  let pointer: { x: number; y: number } | null = null;
  let pressed: { x: number; y: number; button: number } | null = null;
  let toastTimer = 0;
  let toastId = 0;
  /** What the ghost was last worked out for, to skip needless work. */
  let ghostKey = '';

  const toast = (text: string, tone: 'error' | 'info' = 'error'): void => {
    const id = ++toastId;
    store.set({ toast: { id, text, tone } });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (store.get().toast?.id === id) store.set({ toast: null });
    }, TOAST_MS);
  };

  /** The rack the building tool would place with the cursor over `cell`: centred on it. */
  const placementAt = (cell: Cell): RackPlacement => {
    const { orientation } = store.get();
    const half = Math.floor(balance.rack.positions / 2);
    return orientation === 'h'
      ? { x: cell.x - half, y: cell.y, orientation }
      : { x: cell.x, y: cell.y - half, orientation };
  };

  const clearGhost = (): void => {
    ghostKey = '';
    view.setGhost(null);
    if (store.get().hint) store.set({ hint: null });
  };

  const refreshGhost = (): void => {
    const cell = pointer ? view.cellAt(pointer.x, pointer.y) : null;
    if (!cell) {
      if (ghostKey !== '') clearGhost();
      return;
    }
    const placement = placementAt(cell);
    const affordable = sim.state.cash >= balance.rack.price;
    const key = `${placement.x},${placement.y},${placement.orientation},${sim.state.layoutVersion},${sim.state.tick},${affordable}`;
    if (key === ghostKey) return;
    ghostKey = key;
    const preview = sim.previewRack(placement);
    const error = preview.error ?? (affordable ? null : 'not-enough-cash');
    view.setGhost({ placement, valid: error === null, aisles: preview.aisles });
    store.set({
      hint: {
        error,
        aisles: preview.aisles.map((a) => ({ width: a.width, rating: a.rating })),
        unserved: preview.unserved,
      },
    });
  };

  const refreshHover = (): void => {
    const { tool } = store.get();
    if (tool === 'rack') {
      refreshGhost();
    } else if (tool === 'demolish') {
      view.setHover(pointer ? view.pick(pointer.x, pointer.y, ['rack']) : null);
    }
  };

  const select = (ref: EntityRef | null): void => {
    if (!sameRef(store.get().selection, ref)) store.set({ selection: ref });
    view.setSelection(ref);
  };

  const setTool = (tool: Tool): void => {
    if (store.get().tool === tool) return;
    clearGhost();
    view.setHover(null);
    store.set({ tool });
    canvas.dataset.tool = tool;
    refreshHover();
  };

  const demolish = (rackId: Id): void => {
    const result = sim.dispatch({ type: 'demolish-rack', rackId });
    if (!result.ok) {
      toast(t(`build.error.${result.error}`));
      return;
    }
    view.setHover(null);
    if (sameRef(store.get().selection, { kind: 'rack', id: rackId })) select(null);
  };

  const click = (x: number, y: number): void => {
    const { tool } = store.get();
    if (tool === 'rack') {
      const cell = view.cellAt(x, y);
      if (!cell) return;
      const result = sim.dispatch({ type: 'build-rack', ...placementAt(cell) });
      if (!result.ok) toast(t(`build.error.${result.error}`));
      ghostKey = '';
      refreshGhost();
    } else if (tool === 'demolish') {
      const ref = view.pick(x, y, ['rack']);
      if (ref && ref.kind === 'rack') demolish(ref.id);
    } else {
      select(view.pick(x, y));
    }
  };

  /** Esc / right click: put the tool down, or let go of the selection. */
  const cancel = (): void => {
    if (store.get().tool !== 'select') setTool('select');
    else select(null);
  };

  const actions: UiActions = {
    setTool,
    rotate() {
      store.set({ orientation: store.get().orientation === 'h' ? 'v' : 'h' });
      ghostKey = '';
      refreshHover();
    },
    togglePanel(panel) {
      store.set({ panel: store.get().panel === panel ? null : panel });
    },
    select,
    toggleTopDown() {
      const topDown = !store.get().topDown;
      store.set({ topDown });
      view.setTopDown(topDown);
    },
    demolish,
    act(action) {
      const result = sim.dispatch(action);
      if (!result.ok) toast(t(`build.error.${result.error}`));
      // Whatever changed, the panels should show it now, paused or not.
      store.set({});
      return result.ok;
    },
  };

  const onPointerDown = (event: PointerEvent): void => {
    pressed = { x: event.clientX, y: event.clientY, button: event.button };
  };
  const onPointerUp = (event: PointerEvent): void => {
    const start = pressed;
    pressed = null;
    if (!start || start.button !== event.button) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return;
    if (event.button === 0) click(event.clientX, event.clientY);
    else if (event.button === 2) cancel();
  };
  const onPointerMove = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
    refreshHover();
  };
  const onPointerLeave = (): void => {
    pointer = null;
    clearGhost();
    view.setHover(null);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const el = event.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const panel = PANEL_KEYS[event.code];
    if (panel) actions.togglePanel(panel);
    else if (event.code === 'Escape') cancel();
    else if (event.code === 'KeyB') setTool('rack');
    else if (event.code === 'KeyX') setTool('demolish');
    else if (event.code === 'KeyR' && store.get().tool === 'rack') actions.rotate();
    else if (event.code === 'KeyT') actions.toggleTopDown();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('keydown', onKeyDown);
  canvas.dataset.tool = store.get().tool;

  return {
    actions,
    notify: toast,
    update(state) {
      const { selection, tool } = store.get();
      // What was selected may have left the building.
      if (selection && !exists(state, selection)) select(null);
      // The floor under a still cursor changes as the game runs.
      if (tool === 'rack' && pointer) refreshGhost();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(toastTimer);
    },
  };
}
