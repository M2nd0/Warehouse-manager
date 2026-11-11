import { MOUSE, PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GameView } from '../sim/types';

/**
 * Manager's-eye camera (GDD "Kamera"): orbit around the hall, zoom from the
 * whole building down to a single pallet, WASD to move, Q/E to turn by 90°.
 */

const MIN_DISTANCE = 3;
/** A manager looks down on the floor: never flatter than about 20° above it. */
const MAX_POLAR = Math.PI / 2 - 0.35;
const START_POLAR = Math.PI / 4;
/** Looking straight down, for laying out racks (GDD: top-down 2D view when building). */
const TOP_DOWN_POLAR = 0.02;
const QUARTER_TURN_SECONDS = 0.25;
/** How far outside the hall the camera target may wander, metres. */
const TARGET_MARGIN = 12;
/** Width of yard west of the hall that the opening view takes in, metres. */
const YARD_IN_VIEW = 8;

/** `focus` brings the camera at least this close, metres. */
const FOCUS_DISTANCE = 32;

const UP = new Vector3(0, 1, 0);

export interface CameraRig {
  camera: PerspectiveCamera;
  /** Swing up to look straight down, or back to the angle it was at before. */
  setTopDown(on: boolean): void;
  /** Glide over to look at this point on the floor, coming closer if the view is far out. */
  focus(x: number, z: number): void;
  update(dtSeconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createCameraRig(dom: HTMLElement, hall: GameView['hall']): CameraRig {
  const camera = new PerspectiveCamera(35, 1, 0.5, 600);
  const controls = new OrbitControls(camera, dom);
  const span = Math.max(hall.width, hall.depth);

  // Start on the whole hall plus the strip of yard where trucks stand.
  const centre = { x: hall.width / 2 - YARD_IN_VIEW / 2, z: hall.depth / 2 };
  controls.target.set(centre.x, 0, centre.z);
  const distance = (span + YARD_IN_VIEW) * 1.13;
  camera.position.set(centre.x, distance * Math.cos(START_POLAR), centre.z + distance * Math.sin(START_POLAR));

  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = span * 3;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = MAX_POLAR;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
  controls.update();

  const held = new Set<string>();
  /** Radians of Q/E rotation still to play out. */
  let turnLeft = 0;
  /** Tilt the camera is swinging towards, if any, and the tilt to return to. */
  let polarGoal: number | null = null;
  let polarBefore = START_POLAR;
  const spherical = new Spherical();
  /** Point the camera is gliding towards (see `focus`). */
  let focusGoal: Vector3 | null = null;
  // Taking the camera by hand ends the swing.
  const onPointerDown = (): void => {
    polarGoal = null;
    focusGoal = null;
  };
  dom.addEventListener('pointerdown', onPointerDown);

  const isTyping = (event: KeyboardEvent): boolean => {
    const el = event.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTyping(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyQ' && !event.repeat) turnLeft += Math.PI / 2;
    else if (event.code === 'KeyE' && !event.repeat) turnLeft -= Math.PI / 2;
    else held.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code);
  };
  const onBlur = (): void => held.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const forward = new Vector3();
  const right = new Vector3();
  const move = new Vector3();
  const offset = new Vector3();

  const update = (dt: number): void => {
    // WASD: slide over the floor, relative to where the camera looks.
    const ahead = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    const side = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
    if (ahead !== 0 || side !== 0) {
      focusGoal = null;
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.copy(camera.up).setY(0);
      forward.normalize();
      right.crossVectors(forward, UP);
      const speed = Math.max(4, controls.getDistance() * 0.9);
      move.set(0, 0, 0).addScaledVector(forward, ahead).addScaledVector(right, side);
      move.normalize().multiplyScalar(speed * dt);
      camera.position.add(move);
      controls.target.add(move);
    }

    // Q/E: quarter turn around the point being looked at.
    if (turnLeft !== 0) {
      const max = (Math.PI / 2 / QUARTER_TURN_SECONDS) * dt;
      const angle = Math.sign(turnLeft) * Math.min(Math.abs(turnLeft), max);
      turnLeft -= angle;
      offset.subVectors(camera.position, controls.target).applyAxisAngle(UP, angle);
      camera.position.copy(controls.target).add(offset);
    }

    if (polarGoal !== null) {
      offset.subVectors(camera.position, controls.target);
      spherical.setFromVector3(offset);
      const next = spherical.phi + (polarGoal - spherical.phi) * (1 - Math.exp(-10 * dt));
      const arrived = Math.abs(next - polarGoal) < 0.003;
      spherical.phi = arrived ? polarGoal : next;
      if (arrived) polarGoal = null;
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    }

    if (focusGoal !== null) {
      const ease = 1 - Math.exp(-7 * dt);
      move.subVectors(focusGoal, controls.target).multiplyScalar(ease);
      controls.target.add(move);
      camera.position.add(move);
      // Come in to a comfortable distance if the view is far out.
      offset.subVectors(camera.position, controls.target);
      const distance = offset.length();
      if (distance > FOCUS_DISTANCE) {
        offset.multiplyScalar(1 - ease * (1 - FOCUS_DISTANCE / distance));
        camera.position.copy(controls.target).add(offset);
      }
      if (move.lengthSq() < 1e-6 && distance <= FOCUS_DISTANCE * 1.02) focusGoal = null;
    }

    controls.update();

    // Keep the hall in sight.
    const x = Math.min(hall.width + TARGET_MARGIN, Math.max(-TARGET_MARGIN, controls.target.x));
    const z = Math.min(hall.depth + TARGET_MARGIN, Math.max(-TARGET_MARGIN, controls.target.z));
    if (x !== controls.target.x || z !== controls.target.z) {
      camera.position.x += x - controls.target.x;
      camera.position.z += z - controls.target.z;
      controls.target.x = x;
      controls.target.z = z;
    }
  };

  return {
    camera,
    setTopDown(on) {
      if (on) {
        polarBefore = Math.max(0.35, controls.getPolarAngle());
        polarGoal = TOP_DOWN_POLAR;
      } else {
        polarGoal = polarBefore;
      }
    },
    focus(x, z) {
      focusGoal = new Vector3(x, 0, z);
    },
    update,
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      dom.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
    },
  };
}
