import { Color, DirectionalLight, Fog, HemisphereLight, Scene, WebGLRenderer } from 'three';
import type { GameView, Id } from '../sim/types';
import { createCameraRig } from './camera';
import { buildHall } from './hall';
import type { Placement } from './instancing';
import { createPalletLayer } from './pallets';
import { palette } from './palette';
import { createRackLayer } from './racks';
import { createTruckLayer } from './trucks';
import { createWorkerLayer } from './workers';

/**
 * The 3D view. It only ever reads the game state (CLAUDE.md): `sync` brings
 * the scene in line with it, `draw` renders a frame.
 */
export interface View {
  /**
   * Show the state.
   * @param alpha     how far real time is into the next tick (0–1), for
   *                  animating between ticks
   * @param dtSeconds real time since the last frame
   * @param simSeconds time to play cosmetic animation by: real time scaled
   *                  by the game speed, 0 while paused
   */
  sync(state: GameView, alpha: number, dtSeconds: number, simSeconds: number): void;
  draw(dtSeconds: number): void;
  /** Cost of the last frame, to keep an eye on the performance budget. */
  stats(): { drawCalls: number; triangles: number };
  dispose(): void;
}

export function createView(canvas: HTMLCanvasElement, state: GameView): View {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  const scene = new Scene();
  scene.background = new Color(palette.sky);
  // The yard fades into the sky instead of ending in a hard horizon.
  scene.fog = new Fog(palette.sky, 90, 260);

  // GDD: one directional (day) light, warm white, plus soft fill.
  // Only big things cast shadows: racks, trucks and walls.
  scene.add(new HemisphereLight(palette.skyLight, palette.groundLight, 2.1));
  const sun = new DirectionalLight(palette.sunLight, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  /** Aim the sun (and its shadow frustum) at the hall. */
  const aimSun = (hall: GameView['hall']): void => {
    const cx = hall.width / 2;
    const cz = hall.depth / 2;
    const reach = Math.max(hall.width, hall.depth) / 2 + 14;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx - 22, 46, cz + 26);
    const camera = sun.shadow.camera;
    camera.left = -reach;
    camera.right = reach;
    camera.top = reach;
    camera.bottom = -reach;
    camera.near = 1;
    camera.far = 140;
    camera.updateProjectionMatrix();
  };

  let hall = buildHall(state.hall);
  scene.add(hall);
  let hallKey = hallSignature(state);
  aimSun(state.hall);

  const add = (object: Parameters<Scene['add']>[0]): void => void scene.add(object);
  const racks = createRackLayer(add);
  const pallets = createPalletLayer(add);
  const workers = createWorkerLayer(add);
  const trucks = createTruckLayer(scene);
  /** Pallets that are not in a location this frame: on a truck or on a jack. */
  const moving = new Map<Id, Placement>();

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
    sync(next, alpha, dt, simSeconds) {
      const key = hallSignature(next);
      if (key !== hallKey) {
        scene.remove(hall);
        hall = buildHall(next.hall);
        scene.add(hall);
        hallKey = key;
        aimSun(next.hall);
      }
      racks.sync(next);
      moving.clear();
      trucks.sync(next, simSeconds, moving);
      workers.sync(next, alpha, dt, moving);
      pallets.sync(next, moving);
    },
    draw(dt) {
      rig.update(dt);
      renderer.render(scene, rig.camera);
    },
    stats() {
      return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
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
