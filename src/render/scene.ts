import {
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { balance } from '../data/balance';
import type { Cell, EntityRef, GameView, Id } from '../sim/types';
import { createCameraRig } from './camera';
import { buildHall } from './hall';
import { createInstanced, ensureCapacity } from './instancing';
import type { Placement } from './instancing';
import { createBuildPreview, createMarker } from './overlay';
import type { Box, BuildGhost } from './overlay';
import { createPalletLayer } from './pallets';
import { palette } from './palette';
import { createRackLayer, rackHeight } from './racks';
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
  /** What is under this point of the window, nearest first; `only` narrows the kinds looked for. */
  pick(clientX: number, clientY: number, only?: EntityRef['kind'][]): EntityRef | null;
  /** The floor cell under this point of the window, or null outside the hall. */
  cellAt(clientX: number, clientY: number): Cell | null;
  /** Outline the selected thing (null for nothing). */
  setSelection(ref: EntityRef | null): void;
  /** Outline what the demolition tool is pointing at. */
  setHover(ref: EntityRef | null): void;
  /** Show the building tool's ghost rack and aisle colours. */
  setGhost(ghost: BuildGhost | null): void;
  setTopDown(on: boolean): void;
  /** Cost of the last frame, to keep an eye on the performance budget. */
  stats(): { drawCalls: number; triangles: number };
  dispose(): void;
}

/** Workers and vehicles are small and move: a click this close (pixels) counts. */
const PICK_RADIUS = 22;

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
  /** The apron in front of each dock door: what one clicks to select a dock. */
  const dockPlates = (): Object3D[] => {
    const plates: Object3D[] = [];
    hall.traverse((object) => {
      if (object.userData.dockId !== undefined) plates.push(object);
    });
    return plates;
  };

  const add = (object: Object3D): void => void scene.add(object);
  const racks = createRackLayer(add);
  const pallets = createPalletLayer(add);
  const workers = createWorkerLayer(add);
  const trucks = createTruckLayer(scene);
  /** Pallets that are not in a location this frame: on a truck or on a jack. */
  const moving = new Map<Id, Placement>();

  const selectionMarker = createMarker(palette.selection);
  const hoverMarker = createMarker(palette.buildNarrow);
  const ghost = createBuildPreview(racks.geometry);
  scene.add(selectionMarker.object, hoverMarker.object, ghost.object);
  let selection: EntityRef | null = null;
  let hover: EntityRef | null = null;

  // GDD: an incident shows as a red icon above the place it concerns.
  let incidentIcons = createInstanced(
    new ConeGeometry(0.32, 0.6, 4).rotateX(Math.PI),
    new MeshBasicMaterial({ color: palette.incidentRed, depthTest: false, transparent: true }),
    16,
    'incident-icons',
  );
  incidentIcons.renderOrder = 9;
  scene.add(incidentIcons);
  const iconMatrix = new Matrix4();
  let bob = 0;
  /** The state last shown; picking and outlines refer to it. */
  let shown = state;

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

  /** The box to draw around something, or null if it is not on screen. */
  const boxOf = (ref: EntityRef | null): Box | null => {
    if (!ref) return null;
    switch (ref.kind) {
      case 'rack': {
        const rack = shown.racks.find((r) => r.id === ref.id);
        if (!rack) return null;
        const long = balance.rack.positions + 0.06;
        const across = rack.orientation === 'h';
        return {
          x: rack.x + (across ? balance.rack.positions / 2 : 0.5),
          y: 0,
          z: rack.y + (across ? 0.5 : balance.rack.positions / 2),
          angle: 0,
          width: across ? long : 1.06,
          height: rackHeight(rack.levels),
          length: across ? 1.06 : long,
        };
      }
      case 'pallet': {
        const place = pallets.placed.get(ref.id);
        return place ? { ...place, width: 0.9, height: place.height + 0.05, length: 1.08 } : null;
      }
      case 'worker': {
        const place = workers.workers.get(ref.id);
        return place ? { ...place, width: 0.7, height: 1.85, length: 0.7 } : null;
      }
      case 'vehicle': {
        const place = workers.vehicles.get(ref.id);
        if (!place) return null;
        // The model's origin is the jack's head; the forks run 1.3 m back from it.
        return {
          ...place,
          x: place.x - Math.sin(place.angle) * 0.6,
          z: place.z - Math.cos(place.angle) * 0.6,
          width: 0.7,
          height: 1.4,
          length: 1.7,
        };
      }
      case 'truck': {
        const frame = trucks.frameOf(ref.id);
        if (!frame) return null;
        return {
          ...frame,
          x: frame.x + (Math.sin(frame.angle) * frame.length) / 2,
          z: frame.z + (Math.cos(frame.angle) * frame.length) / 2,
          width: 2.7,
          height: 2.8,
          length: frame.length + 0.2,
        };
      }
      case 'dock': {
        const plate = dockPlates().find((object) => object.userData.dockId === ref.id);
        const dock = shown.hall.docks.find((d) => d.id === ref.id);
        if (!plate || !dock) return null;
        const sideways = dock.side === 'W' || dock.side === 'E';
        return {
          x: plate.position.x,
          y: 0,
          z: plate.position.z,
          angle: 0,
          width: sideways ? 1.3 : 3.1,
          height: 0.3,
          length: sideways ? 3.1 : 1.3,
        };
      }
      default:
        return null;
    }
  };

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const floor = new Plane(new Vector3(0, 1, 0), 0);
  const point = new Vector3();

  const aim = (clientX: number, clientY: number): DOMRect => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, rig.camera);
    return rect;
  };

  const cellAt = (clientX: number, clientY: number): Cell | null => {
    aim(clientX, clientY);
    if (!raycaster.ray.intersectPlane(floor, point)) return null;
    const cell = { x: Math.floor(point.x), y: Math.floor(point.z) };
    const inside = cell.x >= 0 && cell.y >= 0 && cell.x < shown.hall.width && cell.y < shown.hall.depth;
    return inside ? cell : null;
  };

  return {
    sync(next, alpha, dt, simSeconds) {
      shown = next;
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
      selectionMarker.show(boxOf(selection));
      hoverMarker.show(boxOf(hover));

      bob += dt;
      incidentIcons = ensureCapacity(incidentIcons, next.incidents.length);
      let icons = 0;
      for (const incident of next.incidents) {
        if (incident.resolved !== null) continue;
        const box = boxOf(incident.subject);
        const at = box
          ? { x: box.x, y: box.y + box.height, z: box.z }
          : incident.cell
            ? { x: incident.cell.x + 0.5, y: 1.4, z: incident.cell.y + 0.5 }
            : null;
        if (!at) continue;
        iconMatrix.makeRotationY(bob * 1.5).setPosition(at.x, at.y + 0.75 + Math.sin(bob * 3) * 0.08, at.z);
        incidentIcons.setMatrixAt(icons++, iconMatrix);
      }
      incidentIcons.count = icons;
      incidentIcons.instanceMatrix.needsUpdate = true;
    },
    draw(dt) {
      rig.update(dt);
      renderer.render(scene, rig.camera);
    },
    pick(clientX, clientY, only) {
      const wanted = (kind: EntityRef['kind']): boolean => !only || only.includes(kind);
      const rect = aim(clientX, clientY);

      // People and jacks first, by how close the click is on screen.
      const near = (places: ReadonlyMap<Id, Placement>, height: number): Id | null => {
        let best: Id | null = null;
        let bestDistance = PICK_RADIUS;
        for (const [id, place] of places) {
          point.set(place.x, place.y + height, place.z).project(rig.camera);
          const px = rect.left + ((point.x + 1) / 2) * rect.width;
          const py = rect.top + ((1 - point.y) / 2) * rect.height;
          const distance = Math.hypot(px - clientX, py - clientY);
          if (point.z < 1 && distance < bestDistance) {
            best = id;
            bestDistance = distance;
          }
        }
        return best;
      };
      if (wanted('worker')) {
        const id = near(workers.workers, 1);
        if (id !== null) return { kind: 'worker', id };
      }

      let best: EntityRef | null = null;
      let bestDistance = Infinity;
      const test = (object: Object3D, resolve: (instance: number) => EntityRef | null): void => {
        // Instances move every frame; the ray test starts from their bounding sphere.
        if (object instanceof InstancedMesh) object.computeBoundingSphere();
        const hit = raycaster.intersectObject(object, false)[0];
        if (!hit || hit.distance >= bestDistance) return;
        const ref = resolve(hit.instanceId ?? 0);
        if (!ref) return;
        best = ref;
        bestDistance = hit.distance;
      };
      if (wanted('pallet')) {
        for (const mesh of pallets.meshes()) {
          test(mesh, (i) => (pallets.ids[i] === undefined ? null : { kind: 'pallet', id: pallets.ids[i] }));
        }
      }
      if (wanted('rack')) {
        test(racks.mesh(), (i) => (racks.ids[i] === undefined ? null : { kind: 'rack', id: racks.ids[i] }));
      }
      if (wanted('truck')) {
        for (const { mesh, id } of trucks.meshes()) test(mesh, () => ({ kind: 'truck', id }));
      }
      if (wanted('dock')) {
        for (const plate of dockPlates()) {
          const dockId = plate.userData.dockId as Id;
          test(plate, () => ({ kind: 'dock', id: dockId }));
        }
      }
      if (best) return best;

      if (wanted('vehicle')) {
        const id = near(workers.vehicles, 0.4);
        if (id !== null) return { kind: 'vehicle', id };
      }
      // A rack is mostly air: a click between its beams still means the rack.
      if (wanted('rack')) {
        const cell = cellAt(clientX, clientY);
        const rack = cell
          ? shown.racks.find((r) =>
              r.orientation === 'h'
                ? cell.y === r.y && cell.x >= r.x && cell.x < r.x + balance.rack.positions
                : cell.x === r.x && cell.y >= r.y && cell.y < r.y + balance.rack.positions,
            )
          : undefined;
        if (rack) return { kind: 'rack', id: rack.id };
      }
      return null;
    },
    cellAt,
    setSelection(ref) {
      selection = ref;
      selectionMarker.show(boxOf(ref));
    },
    setHover(ref) {
      hover = ref;
      hoverMarker.show(boxOf(ref));
    },
    setGhost(next) {
      ghost.show(next);
    },
    setTopDown(on) {
      rig.setTopDown(on);
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
