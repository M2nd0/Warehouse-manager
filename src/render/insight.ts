import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import { slotFill } from '../sim/queries';
import type { GameView, Id } from '../sim/types';
import { createInstanced, ensureCapacity } from './instancing';
import type { Placement } from './instancing';
import { heatShade } from './motion';
import { palette } from './palette';
import { rackHeight } from './racks';

/**
 * Overlays that explain the hall (key O cycles them):
 * - heat:   floor cells coloured by how often they were walked today
 * - fill:   a lid on every rack cell — colour = turnover class, strength = how full
 * - routes: where every worker is headed right now
 */
export type InsightMode = 'none' | 'heat' | 'fill' | 'routes';
export const INSIGHT_MODES: InsightMode[] = ['none', 'heat', 'fill', 'routes'];

export interface InsightLayer {
  setMode(mode: InsightMode): void;
  sync(state: GameView, workers: ReadonlyMap<Id, Placement>): void;
}

const VELOCITY_COLOR = { A: palette.insightA, B: palette.insightB, C: palette.insightC } as const;

export function createInsightLayer(parent: Object3D): InsightLayer {
  let mode: InsightMode = 'none';

  const tile = new PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
  let tiles = createInstanced(
    tile,
    new MeshBasicMaterial({ transparent: true, opacity: 0.78, depthWrite: false }),
    320,
    'insight-tiles',
  );
  tiles.renderOrder = 5;
  parent.add(tiles);

  const routeGeometry = new BufferGeometry();
  const routes = new LineSegments(
    routeGeometry,
    new LineBasicMaterial({ color: palette.selection, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  routes.renderOrder = 7;
  routes.frustumCulled = false;
  parent.add(routes);

  const matrix = new Matrix4();
  const position = new Vector3();
  const flat = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const color = new Color();
  const cold = new Color(palette.heatCold);
  const hot = new Color(palette.heatHot);
  const empty = new Color(palette.insightEmpty);
  const held = new Color(palette.incidentRed);

  const put = (index: number, x: number, y: number, z: number, size = 1): void => {
    matrix.compose(position.set(x, y, z), flat, scale.set(size, 1, size));
    tiles.setMatrixAt(index, matrix);
    tiles.setColorAt(index, color);
  };

  return {
    setMode(next) {
      mode = next;
    },
    sync(state, workers) {
      tiles.visible = mode === 'heat' || mode === 'fill';
      routes.visible = mode === 'routes';

      if (mode === 'heat') {
        const { width, depth } = state.hall;
        tiles = ensureCapacity(tiles, width * depth);
        let max = 0;
        for (const n of state.heat) if (n > max) max = n;
        let count = 0;
        for (let i = 0; i < state.heat.length; i++) {
          const shade = heatShade(state.heat[i], max);
          if (shade <= 0) continue;
          color.copy(cold).lerp(hot, shade);
          put(count++, (i % width) + 0.5, 0.02, Math.floor(i / width) + 0.5);
        }
        tiles.count = count;
      } else if (mode === 'fill') {
        const cells = slotFill(state);
        tiles = ensureCapacity(tiles, cells.length);
        const top = rackHeight(state.racks[0]?.levels ?? 1) + 0.04;
        cells.forEach((entry, i) => {
          if (entry.hold) color.copy(held);
          else if (entry.velocity === null) color.copy(empty);
          else color.copy(empty).lerp(new Color(VELOCITY_COLOR[entry.velocity]), 0.35 + 0.65 * entry.fill);
          put(i, entry.cell.x + 0.5, top, entry.cell.y + 0.5);
        });
        tiles.count = cells.length;
      }
      if (tiles.visible) {
        tiles.instanceMatrix.needsUpdate = true;
        if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
      }

      if (mode === 'routes') {
        const points: number[] = [];
        for (const worker of state.workers) {
          const place = workers.get(worker.id);
          if (!place || worker.path.length === 0) continue;
          let x = place.x;
          let z = place.z;
          for (const cell of worker.path) {
            points.push(x, 0.12, z, cell.x + 0.5, 0.12, cell.y + 0.5);
            x = cell.x + 0.5;
            z = cell.y + 0.5;
          }
          // A small cross where the walk ends.
          points.push(x - 0.3, 0.12, z - 0.3, x + 0.3, 0.12, z + 0.3, x - 0.3, 0.12, z + 0.3, x + 0.3, 0.12, z - 0.3);
        }
        routeGeometry.setAttribute('position', new Float32BufferAttribute(points, 3));
      }
    },
  };
}
