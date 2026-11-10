import { Color, DirectionalLight, Fog, HemisphereLight, Scene, WebGLRenderer } from 'three';
import type { GameView } from '../sim/types';
import { createCameraRig } from './camera';
import { buildHall } from './hall';
import { palette } from './palette';

/**
 * The 3D view. It only ever reads GameState (CLAUDE.md): `sync` copies what
 * it needs from the state, `draw` renders a frame.
 */
export interface View {
  /** Bring the scene in line with the simulation state. */
  sync(state: GameView): void;
  draw(dtSeconds: number): void;
  dispose(): void;
}

export function createView(canvas: HTMLCanvasElement, state: GameView): View {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  scene.background = new Color(palette.sky);
  // The yard fades into the sky instead of ending in a hard horizon.
  scene.fog = new Fog(palette.sky, 90, 260);

  // GDD: one directional (day) light, warm white, plus soft fill.
  scene.add(new HemisphereLight(palette.skyLight, palette.groundLight, 2.1));
  const sun = new DirectionalLight(palette.sunLight, 1.5);
  sun.position.set(-20, 40, 25);
  scene.add(sun);

  let hall = buildHall(state.hall);
  scene.add(hall);
  let hallKey = hallSignature(state);

  const rig = createCameraRig(canvas, state.hall);

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    rig.resize(width, height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return {
    sync(next) {
      // Racks, pallets, people and trucks arrive with milestone M2.
      const key = hallSignature(next);
      if (key === hallKey) return;
      scene.remove(hall);
      hall = buildHall(next.hall);
      scene.add(hall);
      hallKey = key;
    },
    draw(dt) {
      rig.update(dt);
      renderer.render(scene, rig.camera);
    },
    dispose() {
      observer.disconnect();
      rig.dispose();
      renderer.dispose();
    },
  };
}

/** Changes when the building itself changes (a bigger hall, new zones). */
function hallSignature(state: GameView): string {
  const { hall } = state;
  const zoneCells = hall.zones.reduce((n, z) => n + z.cells.length, 0);
  return `${hall.width}x${hall.depth}:${hall.docks.length}:${hall.zones.length}:${zoneCells}:${hall.stations.length}`;
}
