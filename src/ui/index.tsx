import '@fontsource-variable/inter';
import { render } from 'preact';
import type { GameView } from '../sim/types';
import { App } from './App';
import type { UiActions } from './controller';
import type { Store } from './store';
import './styles.css';

export interface LoopState {
  speed: number;
  paused: boolean;
}

export interface UiHandlers {
  onSpeed(speed: number): void;
  onPause(): void;
  onReportClose(): void;
  onNew(): void;
  onExport(): void;
  onImport(file: File): void;
}

export interface Ui {
  /** Show the current state. The UI only reads it. */
  sync(state: GameView, loop: LoopState): void;
}

/** At most this often does the passing of game time redraw the overlay. */
const REDRAW_MS = 100;

/** HTML overlay above the canvas. */
export function mountUi(root: HTMLElement, store: Store, actions: UiActions, handlers: UiHandlers): Ui {
  let dirty = true;
  let shownTick = -1;
  let shownLoop = '';
  let drawnAt = 0;
  store.subscribe(() => {
    dirty = true;
  });

  return {
    sync(state, loop) {
      const now = performance.now();
      const loopKey = `${loop.speed}|${loop.paused}`;
      // Redraw at once for anything the player did; for the game clock, a few times a second is plenty.
      const due = dirty || loopKey !== shownLoop || (state.tick !== shownTick && now - drawnAt >= REDRAW_MS);
      if (!due) return;
      dirty = false;
      shownTick = state.tick;
      shownLoop = loopKey;
      drawnAt = now;
      render(
        <App
          state={state}
          ui={store.get()}
          speed={loop.speed}
          paused={loop.paused}
          actions={actions}
          {...handlers}
        />,
        root,
      );
    },
  };
}
