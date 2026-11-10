import { CylinderGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { GameView, Id, Side } from '../sim/types';
import type { Placement } from './instancing';
import { bedLength, cargoSlot, turnTowards } from './motion';
import { palette, truckColors } from './palette';
import { box, buildParts } from './parts';
import type { Part } from './parts';

/**
 * Trucks in the yard and at the dock.
 *
 * The simulation only says whether a truck is waiting, docked or gone; how it
 * drives between those places is the view's business. Trucks back up to the
 * door in a single file straight out from the dock; the one that leaves pulls
 * out to the side.
 *
 * Model space: the tail is at the origin, the cab is towards +Z.
 */

const BED_HEIGHT = 0.55;
/** Gap between the wall and the tail of a docked truck, metres. */
const TAIL_GAP = 0.45;
/** Distance between trucks waiting in line. */
const QUEUE_SPACING = 9.5;
/** Where arriving trucks come into view, metres out from the dock. */
const APPROACH_FROM = 34;
const GONE_AT = 75;
/** A truck seen within this many ticks of its arrival drives in; older ones are just there. */
const FRESH_TICKS = 3;

const OUTWARD: Record<Side, { x: number; z: number }> = {
  N: { x: 0, z: -1 },
  E: { x: 1, z: 0 },
  S: { x: 0, z: 1 },
  W: { x: -1, z: 0 },
};

function wheel(x: number, z: number): Part {
  return {
    geometry: new CylinderGeometry(0.42, 0.42, 0.28, 12),
    at: [x, 0.42, z],
    color: palette.tyre,
    rotation: [0, 0, Math.PI / 2],
  };
}

function cab(startZ: number, color: number): Part[] {
  return [
    box([2.3, 1.8, 1.7], [0, 0.45 + 0.9, startZ + 0.85], color),
    box([2.1, 0.62, 0.06], [0, 1.82, startZ + 1.72], palette.truckGlass),
    box([0.06, 0.5, 0.8], [-1.16, 1.85, startZ + 1.15], palette.truckGlass),
    box([0.06, 0.5, 0.8], [1.16, 1.85, startZ + 1.15], palette.truckGlass),
    wheel(-1.05, startZ + 0.9),
    wheel(1.05, startZ + 0.9),
  ];
}

/** Client delivery: an open flatbed, so the pallets still on board can be seen. */
function flatbedGeometry(pallets: number, color: number): BufferGeometry {
  const length = bedLength(pallets);
  const parts: Part[] = [
    box([2.4, 0.16, length], [0, BED_HEIGHT - 0.08, length / 2], palette.truckBed),
    box([0.06, 0.3, length], [-1.2, BED_HEIGHT + 0.15, length / 2], palette.truckBed),
    box([0.06, 0.3, length], [1.2, BED_HEIGHT + 0.15, length / 2], palette.truckBed),
    box([2.4, 1.3, 0.08], [0, BED_HEIGHT + 0.65, length + 0.04], palette.truckBed),
    box([0.9, 0.22, length + 1.9], [0, 0.36, (length + 1.9) / 2], palette.vehicleDark),
    wheel(-1.05, 0.95),
    wheel(1.05, 0.95),
    ...cab(length + 0.2, color),
  ];
  if (length > 4.6) parts.push(wheel(-1.05, 2.0), wheel(1.05, 2.0));
  return buildParts(parts);
}

/** Carrier collection: a closed box van. */
function vanGeometry(color: number): BufferGeometry {
  const length = 4.6;
  return buildParts([
    box([2.4, 2.25, length], [0, BED_HEIGHT + 1.125, length / 2], color),
    box([2.42, 0.28, length - 0.5], [0, 1.45, length / 2], palette.safetyYellow),
    box([0.9, 0.22, length + 1.9], [0, 0.36, (length + 1.9) / 2], palette.vehicleDark),
    wheel(-1.05, 0.95),
    wheel(1.05, 0.95),
    ...cab(length + 0.2, color),
  ]);
}

interface TruckView {
  mesh: Mesh;
  /** Order in which the pallets were loaded: decides where each stands on the bed. */
  slots: Map<Id, number>;
  angle: number;
  leaving: boolean;
}

export interface TruckLayer {
  /**
   * Draw the trucks. `simSeconds` is the time to animate by (0 while paused).
   * Fills `moving` with the placement of every pallet still on a truck bed.
   */
  sync(state: GameView, simSeconds: number, moving: Map<Id, Placement>): void;
}

export function createTruckLayer(parent: Object3D): TruckLayer {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  const views = new Map<Id, TruckView>();
  const target = new Vector3();
  const step = new Vector3();

  /** Point on the wall line in the middle of a dock door, and the way out from it. */
  const dockFrame = (state: GameView, dockId: Id | null) => {
    const dock = state.hall.docks.find((d) => d.id === dockId) ?? state.hall.docks[0];
    const out = OUTWARD[dock?.side ?? 'W'];
    const cx = (dock?.cell.x ?? 0) + 0.5;
    const cz = (dock?.cell.y ?? 0) + 0.5;
    const door = {
      x: out.x === 0 ? cx : out.x < 0 ? 0 : state.hall.width,
      z: out.z === 0 ? cz : out.z < 0 ? 0 : state.hall.depth,
    };
    return { door, out };
  };

  const remove = (id: Id, view: TruckView): void => {
    parent.remove(view.mesh);
    view.mesh.geometry.dispose();
    views.delete(id);
  };

  return {
    sync(state, simSeconds, moving) {
      const waiting = state.trucks
        .filter((t) => t.status === 'waiting')
        .sort((a, b) => (a.arrivedTick ?? 0) - (b.arrivedTick ?? 0) || a.id - b.id);
      const seen = new Set<Id>();

      for (const truck of state.trucks) {
        if (truck.status === 'en-route') continue;
        let view = views.get(truck.id);
        if (!view && truck.status === 'done') continue; // left before we ever saw it

        const { door, out } = dockFrame(state, truck.dockId);
        const facing = Math.atan2(out.x, out.z);
        const place = (distance: number): Vector3 =>
          target.set(door.x + out.x * distance, 0, door.z + out.z * distance);
        // Docked: tail at the door. Waiting: in line behind whoever is ahead.
        const home =
          truck.status === 'at-dock' ? TAIL_GAP : TAIL_GAP + (waiting.indexOf(truck) + 1) * QUEUE_SPACING;

        if (!view) {
          const color = truckColors[truck.clientId ?? 'carrier'] ?? truckColors.carrier;
          const geometry = truck.kind === 'pickup' ? vanGeometry(color) : flatbedGeometry(truck.manifest, color);
          const mesh = new Mesh(geometry, material);
          mesh.castShadow = true;
          const fresh = state.tick - (truck.arrivedTick ?? state.tick) <= FRESH_TICKS;
          mesh.position.copy(place(fresh ? APPROACH_FROM : home));
          parent.add(mesh);
          view = { mesh, slots: new Map(), angle: facing, leaving: false };
          truck.cargo.forEach((palletId, i) => view?.slots.set(palletId, i));
          views.set(truck.id, view);
        }
        seen.add(truck.id);

        if (truck.status === 'done') {
          view.leaving = true;
        } else {
          step.subVectors(place(home), view.mesh.position);
          const distance = step.length();
          if (distance > 1e-4) {
            // Quick on the approach, easing in over the last metres.
            const speed = Math.min(26, Math.max(2.5, distance * 2.4));
            view.mesh.position.addScaledVector(step, Math.min(1, (speed * simSeconds) / distance));
          }
          view.angle = facing;
        }

        // Pallets still on board stand on the bed.
        const sin = Math.sin(view.angle);
        const cos = Math.cos(view.angle);
        for (const palletId of truck.cargo) {
          const slot = cargoSlot(view.slots.get(palletId) ?? 0);
          moving.set(palletId, {
            x: view.mesh.position.x + slot.across * cos + slot.along * sin,
            y: BED_HEIGHT,
            z: view.mesh.position.z - slot.across * sin + slot.along * cos,
            angle: view.angle,
          });
        }
      }

      for (const [id, view] of views) {
        // A truck the simulation has already forgotten still gets to drive off.
        if (!seen.has(id)) view.leaving = true;
        if (view.leaving) {
          // Pull forward and away to the side, turning into the direction of travel.
          const { door, out } = dockFrame(state, null);
          const away = Math.atan2(out.x - out.z * 0.9, out.z + out.x * 0.9);
          view.angle = turnTowards(view.angle, away, 1.1 * simSeconds);
          const speed = 15 * simSeconds;
          view.mesh.position.x += Math.sin(view.angle) * speed;
          view.mesh.position.z += Math.cos(view.angle) * speed;
          const dx = view.mesh.position.x - door.x;
          const dz = view.mesh.position.z - door.z;
          if (dx * dx + dz * dz > GONE_AT * GONE_AT) {
            remove(id, view);
            continue;
          }
        }
        view.mesh.rotation.y = view.angle;
      }
    },
  };
}
