import { InstancedMesh } from 'three';
import type { BufferGeometry, Material } from 'three';

/** Height of one rack level, metres (level 1 stands on the floor). */
export const LEVEL_HEIGHT = 1.5;

/** Where something movable is drawn this frame (world space, metres). */
export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Rotation about the vertical axis; 0 faces +Z. */
  angle: number;
}

/** An instanced mesh that is redrawn every frame and so skips culling. */
export function createInstanced(
  geometry: BufferGeometry,
  material: Material,
  capacity: number,
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Make room for `needed` instances. InstancedMesh cannot grow, so a bigger
 * one takes its place in the scene; always use the returned mesh.
 */
export function ensureCapacity(mesh: InstancedMesh, needed: number): InstancedMesh {
  const capacity = mesh.instanceMatrix.count;
  if (needed <= capacity) return mesh;
  const next = new InstancedMesh(mesh.geometry, mesh.material, Math.max(needed, capacity * 2));
  next.name = mesh.name;
  next.count = 0;
  next.frustumCulled = mesh.frustumCulled;
  next.castShadow = mesh.castShadow;
  next.receiveShadow = mesh.receiveShadow;
  mesh.parent?.add(next);
  mesh.removeFromParent();
  mesh.dispose();
  return next;
}
