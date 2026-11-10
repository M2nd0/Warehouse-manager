import { BoxGeometry, Color, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly models are assembled from coloured primitives and merged into one
 * geometry with vertex colours, so a whole model — and, instanced, every copy
 * of it — is a single draw call.
 */
export interface Part {
  geometry: BufferGeometry;
  /** Position of the primitive's centre. */
  at: [number, number, number];
  color: number;
  /** Euler rotation (XYZ, radians). */
  rotation?: [number, number, number];
}

/** A box given by its size and centre. */
export function box(
  size: [number, number, number],
  at: [number, number, number],
  color: number,
  rotation?: [number, number, number],
): Part {
  return { geometry: new BoxGeometry(size[0], size[1], size[2]), at, color, rotation };
}

export function buildParts(parts: Part[]): BufferGeometry {
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const color = new Color();

  const pieces = parts.map((part) => {
    // Merging needs matching attributes: drop UVs, un-index everything.
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    geometry.deleteAttribute('uv');
    quaternion.setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0])));
    matrix.compose(new Vector3(...part.at), quaternion, scale);
    geometry.applyMatrix4(matrix);

    color.set(part.color);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    part.geometry.dispose();
    return geometry;
  });

  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('could not merge model parts');
  merged.computeBoundingSphere();
  return merged;
}
