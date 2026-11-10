import { Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { BufferGeometry, InstancedMesh } from 'three';
import { balance } from '../data/balance';
import type { GameView } from '../sim/types';
import { LEVEL_HEIGHT, createInstanced, ensureCapacity } from './instancing';
import { palette } from './palette';
import { box, buildParts } from './parts';
import type { Part } from './parts';

/**
 * Pallet racks: one bay = two end frames and a pair of orange beams per upper
 * level (level 1 stands on the floor). All racks are one instanced mesh.
 *
 * Model space: the footprint starts at the origin and runs along +X
 * (`positions` metres long, 1 m deep along +Z).
 */
function rackGeometry(levels: number, positions: number): BufferGeometry {
  const length = positions;
  const height = (levels - 1) * LEVEL_HEIGHT + 1.25;
  const parts: Part[] = [];
  for (const x of [0.06, length - 0.06]) {
    for (const z of [0.1, 0.9]) {
      parts.push(box([0.09, height, 0.08], [x, height / 2, z], palette.rackUpright));
    }
    for (let y = 0.3; y < height; y += 1.05) {
      parts.push(box([0.04, 0.04, 0.8], [x, y, 0.5], palette.rackUpright));
    }
  }
  for (let level = 2; level <= levels; level++) {
    const top = (level - 1) * LEVEL_HEIGHT;
    for (const z of [0.1, 0.9]) {
      parts.push(box([length - 0.12, 0.12, 0.05], [length / 2, top - 0.06, z], palette.rackOrange));
    }
  }
  return buildParts(parts);
}

export interface RackLayer {
  readonly mesh: () => InstancedMesh;
  sync(state: GameView): void;
}

export function createRackLayer(add: (mesh: InstancedMesh) => void): RackLayer {
  const geometry = rackGeometry(balance.rack.levels, balance.rack.positions);
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25 });
  let mesh = createInstanced(geometry, material, 64, 'racks');
  mesh.castShadow = true;
  add(mesh);

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);
  const along = new Quaternion();
  const across = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
  let shown = -1;

  return {
    mesh: () => mesh,
    sync(state) {
      // Racks only change when the floor plan does.
      if (state.layoutVersion === shown) return;
      shown = state.layoutVersion;
      mesh = ensureCapacity(mesh, state.racks.length);
      state.racks.forEach((rack, i) => {
        if (rack.orientation === 'h') {
          matrix.compose(position.set(rack.x, 0, rack.y), along, scale);
        } else {
          // Turned a quarter: the model's +X runs along +Z, its depth along -X.
          matrix.compose(position.set(rack.x + 1, 0, rack.y), across, scale);
        }
        mesh.setMatrixAt(i, matrix);
      });
      mesh.count = state.racks.length;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
