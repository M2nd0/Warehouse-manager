import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import type { Object3D } from 'three';
import { bubbleOf } from '../sim/queries';
import type { Bubble } from '../sim/queries';
import type { GameView, Id } from '../sim/types';
import type { Placement } from './instancing';

/**
 * State bubbles: a small icon over every worker's head saying what they are
 * doing — or, more to the point, that they are idle, blocked or exhausted.
 * Icons are drawn once into a canvas atlas; they keep the same size on screen
 * at any zoom and show through racks, so trouble is never hidden.
 */

const CELL = 96;
const ORDER: Bubble[] = ['blocked', 'tired', 'idle', 'carrying', 'picking', 'packing', 'attend', 'break', 'overtime'];
/** Ring colour: red = problem, orange = warning, yellow = attention, grey = at work. */
const RING: Record<Bubble, string> = {
  blocked: '#d64545',
  tired: '#e07b39',
  idle: '#f2c230',
  carrying: '#5c6b78',
  picking: '#5c6b78',
  packing: '#5c6b78',
  attend: '#5c6b78',
  break: '#4f8fb3',
  overtime: '#e07b39',
};
/** Height of an icon as a share of the viewport height. */
const SIZE = 0.036;
/** Above the head, metres. */
const LIFT = 2.15;

type Draw = (c: CanvasRenderingContext2D) => void;

/** Pictograms, drawn in a 96 px cell around its centre (48, 48). */
const ICONS: Record<Bubble, Draw> = {
  blocked(c) {
    c.fillStyle = '#d64545';
    c.fillRect(43, 22, 10, 34);
    c.beginPath();
    c.arc(48, 68, 6, 0, Math.PI * 2);
    c.fill();
  },
  tired(c) {
    // A drop of sweat.
    c.fillStyle = '#e07b39';
    c.beginPath();
    c.moveTo(48, 20);
    c.bezierCurveTo(66, 44, 68, 56, 62, 66);
    c.bezierCurveTo(56, 76, 40, 76, 34, 66);
    c.bezierCurveTo(28, 56, 30, 44, 48, 20);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.beginPath();
    c.ellipse(42, 58, 4, 8, 0.3, 0, Math.PI * 2);
    c.fill();
  },
  idle(c) {
    c.fillStyle = '#8a6d0c';
    c.font = '700 30px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('z', 36, 60);
    c.font = '700 24px sans-serif';
    c.fillText('z', 52, 46);
    c.font = '700 18px sans-serif';
    c.fillText('z', 64, 34);
  },
  carrying(c) {
    // A loaded pallet.
    c.fillStyle = '#c9a36b';
    c.fillRect(28, 28, 40, 30);
    c.strokeStyle = '#8f7a5c';
    c.lineWidth = 3;
    c.strokeRect(28, 28, 40, 30);
    c.beginPath();
    c.moveTo(48, 28);
    c.lineTo(48, 58);
    c.stroke();
    c.fillStyle = '#8a6a3f';
    c.fillRect(24, 60, 48, 6);
    c.fillRect(26, 66, 8, 6);
    c.fillRect(44, 66, 8, 6);
    c.fillRect(62, 66, 8, 6);
  },
  picking(c) {
    // An arrow lifting a carton off the shelf.
    c.fillStyle = '#c9a36b';
    c.fillRect(30, 46, 26, 22);
    c.strokeStyle = '#8f7a5c';
    c.lineWidth = 3;
    c.strokeRect(30, 46, 26, 22);
    c.strokeStyle = '#3b4652';
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(62, 58);
    c.lineTo(62, 26);
    c.moveTo(52, 36);
    c.lineTo(62, 24);
    c.lineTo(72, 36);
    c.stroke();
  },
  packing(c) {
    // A taped parcel.
    c.fillStyle = '#c9a36b';
    c.fillRect(26, 34, 44, 34);
    c.strokeStyle = '#8f7a5c';
    c.lineWidth = 3;
    c.strokeRect(26, 34, 44, 34);
    c.fillStyle = '#f1f0ec';
    c.fillRect(43, 34, 10, 34);
    c.fillStyle = '#8f7a5c';
    c.beginPath();
    c.moveTo(26, 34);
    c.lineTo(36, 24);
    c.lineTo(80, 24);
    c.lineTo(70, 34);
    c.fill();
  },
  attend(c) {
    // A magnifying glass.
    c.strokeStyle = '#3b4652';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(43, 42, 15, 0, Math.PI * 2);
    c.moveTo(55, 54);
    c.lineTo(70, 70);
    c.stroke();
  },
  break(c) {
    // A mug.
    c.fillStyle = '#4f8fb3';
    c.fillRect(28, 38, 32, 32);
    c.strokeStyle = '#4f8fb3';
    c.lineWidth = 6;
    c.beginPath();
    c.arc(62, 54, 9, -Math.PI / 2, Math.PI / 2);
    c.stroke();
    c.strokeStyle = '#8f99a3';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(38, 30);
    c.quadraticCurveTo(34, 24, 38, 18);
    c.moveTo(50, 30);
    c.quadraticCurveTo(46, 24, 50, 18);
    c.stroke();
  },
  overtime(c) {
    // A clock.
    c.strokeStyle = '#e07b39';
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(48, 48, 22, 0, Math.PI * 2);
    c.moveTo(48, 34);
    c.lineTo(48, 48);
    c.lineTo(58, 54);
    c.stroke();
  },
};

function drawAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * ORDER.length;
  canvas.height = CELL;
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  ORDER.forEach((kind, i) => {
    c.save();
    c.translate(i * CELL, 0);
    // A white disc with a coloured ring and a little pointer underneath.
    c.fillStyle = RING[kind];
    c.beginPath();
    c.arc(48, 46, 42, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(36, 82);
    c.lineTo(48, 96);
    c.lineTo(60, 82);
    c.fill();
    c.fillStyle = '#fbfaf7';
    c.beginPath();
    c.arc(48, 46, 35, 0, Math.PI * 2);
    c.fill();
    c.translate(0, -2);
    ICONS[kind](c);
    c.restore();
  });
  return canvas;
}

export interface BubbleLayer {
  /** Put the right icon over everyone; `places` is where the workers are drawn this frame. */
  sync(state: GameView, places: ReadonlyMap<Id, Placement>, seconds: number): void;
  setVisible(on: boolean): void;
}

export function createBubbleLayer(parent: Object3D): BubbleLayer {
  const atlas = new CanvasTexture(drawAtlas());
  atlas.colorSpace = SRGBColorSpace;
  const materials = new Map<Bubble, SpriteMaterial>();
  ORDER.forEach((kind, i) => {
    const map = atlas.clone();
    map.repeat.set(1 / ORDER.length, 1);
    map.offset.set(i / ORDER.length, 0);
    map.needsUpdate = true;
    materials.set(kind, new SpriteMaterial({ map, depthTest: false, sizeAttenuation: false, transparent: true }));
  });

  const pool: Sprite[] = [];
  let visible = true;
  let clock = 0;

  return {
    sync(state, places, seconds) {
      clock += seconds;
      let used = 0;
      if (visible) {
        for (const worker of state.workers) {
          const place = places.get(worker.id);
          const kind = place ? bubbleOf(state, worker) : null;
          const material = kind ? materials.get(kind) : undefined;
          if (!place || !kind || !material) continue;
          let sprite = pool[used];
          if (!sprite) {
            sprite = new Sprite(material);
            sprite.center.set(0.5, 0);
            sprite.renderOrder = 8;
            parent.add(sprite);
            pool.push(sprite);
          }
          sprite.material = material;
          sprite.visible = true;
          // Trouble pulses so that it catches the eye.
          const pulse = kind === 'blocked' || kind === 'idle' ? 1 + Math.sin(clock * 5 + worker.id) * 0.08 : 1;
          sprite.scale.setScalar(SIZE * pulse);
          sprite.position.set(place.x, place.y + LIFT, place.z);
          used++;
        }
      }
      for (let i = used; i < pool.length; i++) pool[i].visible = false;
    },
    setVisible(on) {
      visible = on;
    },
  };
}
