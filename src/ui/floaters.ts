import type { View } from '../render/scene';

/**
 * Numbers that pop up where something happened and float away: "+1.20 €"
 * over the packing table, "−35 €" over a truck charged demurrage. Plain DOM
 * elements pinned to a point of the 3D world; nothing here is game state.
 */
export type FloatTone = 'good' | 'bad' | 'info';

export interface Floaters {
  /** Show `text` rising from a point of the world (metres). */
  pop(text: string, tone: FloatTone, at: { x: number; y: number; z: number }): void;
  /** Call once per frame with the real time passed. */
  update(dtSeconds: number): void;
}

const LIFE_SECONDS = 2.2;
const RISE_PX = 46;
/** Pop-ups from the same spot at the same moment are spread out in time. */
const STAGGER_SECONDS = 0.28;
const MAX_ALIVE = 24;

interface Floater {
  el: HTMLElement;
  at: { x: number; y: number; z: number };
  /** Negative while waiting its turn. */
  age: number;
}

export function createFloaters(root: HTMLElement, view: View): Floaters {
  const layer = document.createElement('div');
  layer.className = 'floaters';
  root.appendChild(layer);
  const alive: Floater[] = [];

  return {
    pop(text, tone, at) {
      if (alive.length >= MAX_ALIVE) alive.shift()?.el.remove();
      const el = document.createElement('div');
      el.className = `floater floater--${tone}`;
      el.textContent = text;
      el.style.opacity = '0';
      layer.appendChild(el);
      // Queue behind others still waiting at the same place.
      let delay = 0;
      for (const other of alive) {
        if (other.at.x === at.x && other.at.z === at.z && other.age < STAGGER_SECONDS) {
          delay = Math.max(delay, STAGGER_SECONDS - other.age);
        }
      }
      alive.push({ el, at, age: -delay });
    },
    update(dt) {
      for (let i = alive.length - 1; i >= 0; i--) {
        const floater = alive[i];
        floater.age += dt;
        if (floater.age >= LIFE_SECONDS) {
          floater.el.remove();
          alive.splice(i, 1);
          continue;
        }
        const screen = floater.age < 0 ? null : view.project(floater.at.x, floater.at.y, floater.at.z);
        if (!screen) {
          floater.el.style.opacity = '0';
          continue;
        }
        const life = floater.age / LIFE_SECONDS;
        // Quick out of the gate, then slowing; fades over the last third.
        const rise = (1 - (1 - life) * (1 - life)) * RISE_PX;
        floater.el.style.opacity = String(Math.min(1, (1 - life) * 3));
        floater.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y - rise}px) scale(${Math.min(1, 0.6 + floater.age * 4)})`;
      }
    },
  };
}
