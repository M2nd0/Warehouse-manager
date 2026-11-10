import { BoxGeometry, Color, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { InstancedMesh } from 'three';
import type { GameView, Id, Orientation, SkuId } from '../sim/types';
import { LEVEL_HEIGHT, createInstanced, ensureCapacity } from './instancing';
import type { Placement } from './instancing';
import { loadColors, palette } from './palette';
import { box, buildParts } from './parts';

/**
 * Pallets: a wooden pallet plus its load, whose height shows how much is
 * left and whose colour tells the SKU. Two instanced meshes for all of them.
 */

const PALLET_HEIGHT = 0.15;
/** Height of a full load, metres. */
const LOAD_HEIGHT = 1.05;

export interface PalletLayer {
  /**
   * `moving` says where pallets that are not in a location are right now
   * (on a truck, on a pallet jack); those missing from it are not drawn.
   */
  sync(state: GameView, moving: ReadonlyMap<Id, Placement>): void;
}

export function createPalletLayer(add: (mesh: InstancedMesh) => void): PalletLayer {
  // Model space: 0.8 m wide (X), 1 m deep (Z), standing on the origin.
  const baseGeometry = buildParts([
    box([0.8, 0.03, 0.98], [0, PALLET_HEIGHT - 0.015, 0], palette.wood),
    box([0.8, 0.1, 0.1], [0, 0.065, -0.42], palette.wood),
    box([0.8, 0.1, 0.1], [0, 0.065, 0], palette.wood),
    box([0.8, 0.1, 0.1], [0, 0.065, 0.42], palette.wood),
    box([0.8, 0.02, 0.98], [0, 0.01, 0], palette.wood),
  ]);
  const loadGeometry = new BoxGeometry(0.76, 1, 0.94).translate(0, 0.5, 0);

  let bases = createInstanced(
    baseGeometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    256,
    'pallets',
  );
  let loads = createInstanced(loadGeometry, new MeshStandardMaterial({ roughness: 0.85 }), 256, 'pallet-loads');
  add(bases);
  add(loads);

  const colors = new Map<SkuId, Color>();
  const colorOf = (state: GameView, skuId: SkuId): Color => {
    if (colors.size !== state.skus.size) {
      colors.clear();
      let i = 0;
      for (const id of state.skus.keys()) colors.set(id, new Color(loadColors[i++ % loadColors.length]));
    }
    return colors.get(skuId) ?? new Color(loadColors[0]);
  };

  const rackOrientation = new Map<Id, Orientation>();
  let layout = -1;

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const UP = new Vector3(0, 1, 0);

  return {
    sync(state, moving) {
      if (state.layoutVersion !== layout) {
        layout = state.layoutVersion;
        rackOrientation.clear();
        for (const rack of state.racks) rackOrientation.set(rack.id, rack.orientation);
      }
      bases = ensureCapacity(bases, state.pallets.size);
      loads = ensureCapacity(loads, state.pallets.size);

      let count = 0;
      for (const pallet of state.pallets.values()) {
        let x: number;
        let y: number;
        let z: number;
        let angle: number;
        if (pallet.locId === 'in-transit') {
          const place = moving.get(pallet.id);
          if (!place) continue; // still on the road
          ({ x, y, z, angle } = place);
        } else {
          const loc = state.locations.get(pallet.locId);
          if (!loc) continue;
          x = loc.cell.x + 0.5;
          z = loc.cell.y + 0.5;
          y = (loc.level - 1) * LEVEL_HEIGHT;
          // In a rack the pallet's depth runs across the rack.
          angle = loc.rackId !== null && rackOrientation.get(loc.rackId) === 'v' ? Math.PI / 2 : 0;
        }

        quaternion.setFromAxisAngle(UP, angle);
        matrix.compose(position.set(x, y, z), quaternion, scale.set(1, 1, 1));
        bases.setMatrixAt(count, matrix);

        const perPallet = state.skus.get(pallet.skuId)?.unitsPerPallet ?? pallet.qty;
        const fill = Math.min(1, Math.max(0.08, pallet.qty / Math.max(1, perPallet)));
        matrix.compose(position.set(x, y + PALLET_HEIGHT, z), quaternion, scale.set(1, fill * LOAD_HEIGHT, 1));
        loads.setMatrixAt(count, matrix);
        loads.setColorAt(count, colorOf(state, pallet.skuId));
        count++;
      }

      bases.count = count;
      loads.count = count;
      bases.instanceMatrix.needsUpdate = true;
      loads.instanceMatrix.needsUpdate = true;
      if (loads.instanceColor) loads.instanceColor.needsUpdate = true;
    },
  };
}
