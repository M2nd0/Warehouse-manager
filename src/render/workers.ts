import { BoxGeometry, Color, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { InstancedMesh } from 'three';
import type { GameView, Id } from '../sim/types';
import { createInstanced, ensureCapacity } from './instancing';
import type { Placement } from './instancing';
import { sampleTrail, turnTowards } from './motion';
import { palette, vestColors } from './palette';
import { box, buildParts } from './parts';

/**
 * People and the pallet jacks they pull.
 *
 * A worker covers several cells per tick, so each is drawn somewhere along
 * the trail of their last tick (`alpha` of the way through), which follows
 * the A* route around the racks. This puts the picture one tick behind the
 * simulation, which nobody can see.
 */

/** How fast a figure turns to face where it is going, radians per second. */
const TURN_RATE = 14;
/** The jack trails this far behind the person pulling it, metres. */
const JACK_BEHIND = 0.6;
/** Centre of the forks, measured back from the jack's head. */
const FORKS_CENTRE = 0.72;
/** A loaded pallet rides this high on the forks. */
const FORK_LIFT = 0.1;

export interface WorkerLayer {
  /**
   * Draw workers and vehicles. Fills `moving` with the placement of every
   * pallet that is riding on a jack.
   */
  sync(state: GameView, alpha: number, dtSeconds: number, moving: Map<Id, Placement>): void;
}

export function createWorkerLayer(add: (mesh: InstancedMesh) => void): WorkerLayer {
  // People: no faces (GDD); the vest colour is the role. Front is +Z.
  const figureGeometry = buildParts([
    box([0.3, 0.82, 0.2], [0, 0.41, 0], palette.trousers),
    { geometry: new SphereGeometry(0.13, 10, 8), at: [0, 1.6, 0], color: palette.skin },
    box([0.09, 0.5, 0.11], [-0.26, 1.13, 0], palette.trousers),
    box([0.09, 0.5, 0.11], [0.26, 1.13, 0], palette.trousers),
  ]);
  const vestGeometry = new BoxGeometry(0.42, 0.62, 0.25).translate(0, 1.13, 0);

  // Hand pallet jack. Its head is at the origin, the forks run back along -Z.
  const jackGeometry = buildParts([
    box([0.16, 0.06, 1.12], [-0.19, 0.08, -0.74], palette.safetyYellow),
    box([0.16, 0.06, 1.12], [0.19, 0.08, -0.74], palette.safetyYellow),
    box([0.54, 0.26, 0.18], [0, 0.19, -0.1], palette.safetyYellow),
    box([0.13, 0.42, 0.13], [0, 0.5, -0.06], palette.vehicleDark),
    box([0.045, 0.85, 0.045], [0, 0.95, 0.2], palette.vehicleDark, [0.5, 0, 0]),
    box([0.3, 0.05, 0.05], [0, 1.31, 0.41], palette.vehicleDark),
    box([0.22, 0.14, 0.14], [0, 0.07, -0.08], palette.vehicleDark),
  ]);

  let figures = createInstanced(
    figureGeometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    32,
    'workers',
  );
  let vests = createInstanced(vestGeometry, new MeshStandardMaterial({ roughness: 0.7 }), 32, 'worker-vests');
  let jacks = createInstanced(
    jackGeometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
    16,
    'vehicles',
  );
  add(figures);
  add(vests);
  add(jacks);

  /** What the view remembers between frames, per worker / vehicle. */
  const facing = new Map<Id, number>();
  const parkedFacing = new Map<Id, number>();
  const inHand = new Map<Id, Placement>();

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const UP = new Vector3(0, 1, 0);
  const vest = new Color();

  return {
    sync(state, alpha, dt, moving) {
      figures = ensureCapacity(figures, state.workers.length);
      vests = ensureCapacity(vests, state.workers.length);
      jacks = ensureCapacity(jacks, state.vehicles.length);
      inHand.clear();

      let count = 0;
      for (const worker of state.workers) {
        if (worker.status === 'off') {
          facing.delete(worker.id);
          continue;
        }
        const at = sampleTrail(worker.trail, worker.pos, alpha);
        const x = at.x + 0.5;
        const z = at.y + 0.5;
        const walking = at.dirX !== 0 || at.dirY !== 0;

        let angle = facing.get(worker.id) ?? Math.PI / 2;
        if (walking) angle = turnTowards(angle, Math.atan2(at.dirX, at.dirY), TURN_RATE * dt);
        facing.set(worker.id, angle);

        // A small bounce while walking, driven by the distance covered.
        const bounce = walking ? Math.abs(Math.sin((at.x + at.y) * Math.PI * 1.6)) * 0.035 : 0;
        quaternion.setFromAxisAngle(UP, angle);
        matrix.compose(position.set(x, bounce, z), quaternion, scale);
        figures.setMatrixAt(count, matrix);
        vests.setMatrixAt(count, matrix);
        vests.setColorAt(count, vest.set(vestColors[worker.role]));
        count++;

        if (worker.vehicleId !== null) {
          const sin = Math.sin(angle);
          const cos = Math.cos(angle);
          const jack = { x: x - sin * JACK_BEHIND, y: 0, z: z - cos * JACK_BEHIND, angle };
          inHand.set(worker.vehicleId, jack);
          if (worker.carrying !== null) {
            moving.set(worker.carrying, {
              x: jack.x - sin * FORKS_CENTRE,
              y: FORK_LIFT,
              z: jack.z - cos * FORKS_CENTRE,
              angle,
            });
          }
        }
      }
      figures.count = count;
      vests.count = count;
      figures.instanceMatrix.needsUpdate = true;
      vests.instanceMatrix.needsUpdate = true;
      if (vests.instanceColor) vests.instanceColor.needsUpdate = true;

      let vehicles = 0;
      for (const vehicle of state.vehicles) {
        let place = inHand.get(vehicle.id);
        if (place) {
          parkedFacing.set(vehicle.id, place.angle);
        } else {
          // Parked where it was left, pointing the way it was last pulled.
          place = {
            x: vehicle.pos.x + 0.5,
            y: 0,
            z: vehicle.pos.y + 0.5,
            angle: parkedFacing.get(vehicle.id) ?? Math.PI / 2,
          };
        }
        quaternion.setFromAxisAngle(UP, place.angle);
        matrix.compose(position.set(place.x, place.y, place.z), quaternion, scale);
        jacks.setMatrixAt(vehicles++, matrix);
      }
      jacks.count = vehicles;
      jacks.instanceMatrix.needsUpdate = true;
    },
  };
}
