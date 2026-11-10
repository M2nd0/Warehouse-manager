import '@fontsource-variable/inter';
import { render } from 'preact';
import type { GameView } from '../sim/types';
import { Hud } from './Hud';
import './styles.css';

export interface LoopState {
  speed: number;
  paused: boolean;
}

export interface UiHandlers {
  onSpeed(speed: number): void;
  onPause(): void;
}

export interface Ui {
  /** Show the current state. The UI only reads it. */
  sync(state: GameView, loop: LoopState): void;
}

/** HTML overlay above the canvas. */
export function mountUi(root: HTMLElement, handlers: UiHandlers): Ui {
  let shown = '';
  return {
    sync(state, loop) {
      // Re-render only when something visible changed.
      const key = `${state.tick}|${state.cash}|${loop.speed}|${loop.paused}`;
      if (key === shown) return;
      shown = key;
      render(
        <Hud
          day={state.day}
          tick={state.tick}
          cash={state.cash}
          speed={loop.speed}
          paused={loop.paused}
          onSpeed={handlers.onSpeed}
          onPause={handlers.onPause}
        />,
        root,
      );
    },
  };
}
