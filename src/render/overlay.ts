import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import type { AisleInfo, AisleRating, RackPlacement } from '../sim';
import type { DeepReadonly } from '../sim/types';
import { createInstanced, ensureCapacity } from './instancing';
import type { Placement } from './instancing';
import { palette } from './palette';

/**
 * Things drawn on top of the world for the player's benefit: the outline
 * around what is selected or hovered, and the building tool's ghost rack with
 * its aisle-width colours (GDD "Stavění").
 */

export interface Box extends Placement {
  /** Size across, up and along (the box stands on `y`). */
  width: number;
  height: number;
  length: number;
}

export interface Marker {
  object: LineSegments;
  /** Outline this box, or hide the marker with null. */
  show(box: Box | null): void;
}

export function createMarker(color: number): Marker {
  const geometry = new EdgesGeometry(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  // Drawn through everything, so a selection is never lost behind a rack.
  const material = new LineBasicMaterial({ color, depthTest: false, transparent: true });
  const object = new LineSegments(geometry, material);
  object.renderOrder = 10;
  object.visible = false;
  object.frustumCulled = false;
  return {
    object,
    show(box) {
      object.visible = box !== null;
      if (!box) return;
      object.position.set(box.x, box.y, box.z);
      object.rotation.y = box.angle;
      object.scale.set(box.width, box.height, box.length);
    },
  };
}

/** What the building tool wants drawn. */
export interface BuildGhost {
  placement: RackPlacement;
  /** Can the rack be built here? */
  valid: boolean;
  aisles: DeepReadonly<AisleInfo[]>;
}

const AISLE_COLORS: Record<AisleRating, number> = {
  ok: palette.buildOk,
  tight: palette.buildTight,
  narrow: palette.buildNarrow,
  none: palette.buildOk,
};

export interface BuildPreview {
  object: Group;
  show(ghost: BuildGhost | null): void;
}

export function createBuildPreview(rackGeometry: BufferGeometry): BuildPreview {
  const object = new Group();
  object.visible = false;

  const material = new MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
  const rack = new Mesh(rackGeometry, material);
  object.add(rack);
  // A solid slab on the footprint: the rack model alone is too thin to read.
  const slab = new Mesh(
    new BoxGeometry(1, 0.08, 1).translate(0.5, 0.04, 0.5),
    new MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
  );
  object.add(slab);

  const tile = new PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
  let aisleTiles = createInstanced(
    tile,
    new MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
    48,
    'aisle-preview',
  );
  object.add(aisleTiles);

  const matrix = new Matrix4();
  const position = new Vector3();
  const flat = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const color = new Color();

  return {
    object,
    show(ghost) {
      object.visible = ghost !== null;
      if (!ghost) return;
      const { placement } = ghost;
      const tint = ghost.valid ? palette.buildOk : palette.buildNarrow;
      material.color.set(tint);
      (slab.material as MeshBasicMaterial).color.set(tint);

      if (placement.orientation === 'h') {
        rack.position.set(placement.x, 0, placement.y);
        rack.rotation.y = 0;
        slab.position.set(placement.x, 0.01, placement.y);
        slab.scale.set(3, 1, 1);
      } else {
        rack.position.set(placement.x + 1, 0, placement.y);
        rack.rotation.y = -Math.PI / 2;
        slab.position.set(placement.x, 0.01, placement.y);
        slab.scale.set(1, 1, 3);
      }

      const cells = ghost.aisles.reduce((n, aisle) => n + aisle.cells.length, 0);
      aisleTiles = ensureCapacity(aisleTiles, cells);
      let count = 0;
      for (const aisle of ghost.aisles) {
        color.set(AISLE_COLORS[aisle.rating]);
        for (const cell of aisle.cells) {
          matrix.compose(position.set(cell.x + 0.5, 0.02, cell.y + 0.5), flat, one);
          aisleTiles.setMatrixAt(count, matrix);
          aisleTiles.setColorAt(count, color);
          count++;
        }
      }
      aisleTiles.count = count;
      aisleTiles.instanceMatrix.needsUpdate = true;
      if (aisleTiles.instanceColor) aisleTiles.instanceColor.needsUpdate = true;
    },
  };
}
