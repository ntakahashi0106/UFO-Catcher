import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const vector = ({ x, y, z }) => ({ x, y, z });
const rotation = ({ x, y, z, w }) => ({ x, y, z, w });
const identity = { x: 0, y: 0, z: 0, w: 1 };
let initialization;

// Shapes in finger-local coordinates. Kept explicit so scene geometry and contact
// geometry agree; the narrow, rounded spoons can actually slide under the carton.
export const FINGER_GEOMETRY = {
  shaft: { half: { x: 0.025, y: 0.275, z: 0.035 }, y: -0.275, x: 0.055 },
  spoon: { half: { x: 0.09, y: 0.028, z: 0.065 }, y: -0.60, x: -0.055 },
  pivotDrop: 0.025,
  openWidth: 0.63,
  closedWidth: 0.22,
};

/** A metre/kilogram/second simulation. Prize motion is exclusively Rapier motion. */
export async function createPhysics() {
  initialization ??= RAPIER.init();
  await initialization;

  const world = new RAPIER.World({ x: 0, y: CONFIG.gravity, z: 0 });
  world.timestep = CONFIG.fixedStep;
  world.numSolverIterations = 12;
  world.numInternalPgsIterations = 2;
  let elapsed = 0;
  let accumulator = 0;
  let won = false;
  let disposed = false;
  let contact = false;
  let difficulty = 'normal';
  let target = { ...CONFIG.home, open: 1 };

  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const floorCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(1.8, 0.06, 1.5)
      .setTranslation(0, CONFIG.floorY - 0.06, 0)
      .setFriction(0.65).setRestitution(0.06), ground,
  );
  // Glass enclosure: even an awkward lift/release stays inside the machine.
  for (const x of [-1.55, 1.55]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.03, 1.55, 1.15)
      .setTranslation(x, 1.65, 0).setFriction(0.22).setRestitution(0)
      .setCollisionGroups(0x00040002), ground);
  }
  for (const z of [-1.11, 1.11]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.58, 1.55, 0.03)
      .setTranslation(0, 1.65, z).setFriction(0.22).setRestitution(0)
      .setCollisionGroups(0x00040002), ground);
  }

  // Rapier cylinders point along Y, so rotate them to the machine's X axis.
  for (const z of [-CONFIG.railZ, CONFIG.railZ]) {
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(CONFIG.railLength / 2, CONFIG.railRadius)
        .setTranslation(0, CONFIG.railY, z)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
        .setFriction(0.44).setRestitution(0), ground,
    );
  }

  const prize = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, CONFIG.railY + CONFIG.railRadius + CONFIG.prize.y / 2 + 0.002, 0)
      .setLinearDamping(0.08).setAngularDamping(0.14)
      .setCcdEnabled(true).setCanSleep(true)
      .setAdditionalSolverIterations(8),
  );
  const prizeCollider = world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(CONFIG.prize.x / 2 - 0.004,
      CONFIG.prize.y / 2 - 0.004, CONFIG.prize.z / 2 - 0.004, 0.004)
      .setMass(CONFIG.prize.mass).setFriction(0.52).setRestitution(0)
      .setCollisionGroups(0x0002ffff), prize,
  );

  const fingers = [-1, 1].map((side) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(target.x + side * FINGER_GEOMETRY.openWidth,
          target.y - FINGER_GEOMETRY.pivotDrop, target.z)
        .setCcdEnabled(true).setCanSleep(false)
        .setLinearDamping(0.25).setAngularDamping(1)
        .setAdditionalSolverIterations(8),
    );
    const shaft = FINGER_GEOMETRY.shaft;
    const spoon = FINGER_GEOMETRY.spoon;
    const shaftCollider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(shaft.half.x - 0.007,
        shaft.half.y - 0.007, shaft.half.z - 0.007, 0.007)
        .setTranslation(side * shaft.x, shaft.y, 0)
        .setMass(0.072).setFriction(0.31).setRestitution(0)
        .setCollisionGroups(0x0001ffff), body,
    );
    const spoonCollider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(spoon.half.x - 0.009,
        spoon.half.y - 0.009, spoon.half.z - 0.009, 0.009)
        .setTranslation(side * spoon.x, spoon.y, 0)
        .setMass(0.023).setFriction(0.30).setRestitution(0)
        .setCollisionGroups(0x0001ffff), body,
    );
    return { side, body, colliders: [shaftCollider, spoonCollider] };
  });

  function resetBody(body, position, quaternion = identity) {
    body.setTranslation(position, true);
    body.setRotation(quaternion, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.resetForces(true);
    body.resetTorques(true);
  }

  function resetPrize(level = 'normal') {
    difficulty = ['easy', 'normal', 'hard'].includes(level) ? level : 'normal';
    // Difficulty changes physical friction/available motor force, never the drop
    // condition or a hidden probability of winning.
    prizeCollider.setFriction(difficulty === 'easy' ? 0.40 : difficulty === 'hard' ? 0.68 : 0.52);
    resetBody(prize, {
      x: 0,
      y: CONFIG.railY + CONFIG.railRadius + CONFIG.prize.y / 2 + 0.002,
      z: 0,
    });
    target = { ...CONFIG.home, open: 1 };
    for (const { side, body } of fingers) {
      resetBody(body, {
        x: target.x + side * FINGER_GEOMETRY.openWidth,
        y: target.y - FINGER_GEOMETRY.pivotDrop,
        z: target.z,
      });
    }
    won = false;
    contact = false;
    elapsed = 0;
    accumulator = 0;
  }

  function setClawTarget(next) {
    target = {
      x: clamp(Number.isFinite(next.x) ? next.x : target.x, -CONFIG.moveLimit.x, CONFIG.moveLimit.x),
      y: clamp(Number.isFinite(next.y) ? next.y : target.y, 1.70, CONFIG.home.y + 0.05),
      z: clamp(Number.isFinite(next.z) ? next.z : target.z, -CONFIG.moveLimit.z, CONFIG.moveLimit.z),
      open: clamp(Number.isFinite(next.open) ? next.open : target.open, 0, 1),
    };
  }

  function driveFinger({ side, body }) {
    const width = FINGER_GEOMETRY.closedWidth +
      (FINGER_GEOMETRY.openWidth - FINGER_GEOMETRY.closedWidth) * target.open;
    const desired = { x: target.x + side * width, y: target.y - FINGER_GEOMETRY.pivotDrop, z: target.z };
    const p = body.translation();
    const v = body.linvel();
    const strength = difficulty === 'easy' ? 1.12 : difficulty === 'hard' ? 0.88 : 1;

    // Independent, force-limited motors rather than kinematic colliders or a
    // welded prize. A jammed finger yields; a supported box can slip and turn.
    const force = {
      x: clamp((clamp((desired.x - p.x) * 16, -0.85, 0.85) - v.x) * 5.1, -2.1 * strength, 2.1 * strength),
      y: clamp((clamp((desired.y - p.y) * 18, -0.65, 0.65) - v.y) * 5.8 - CONFIG.gravity * body.mass(), -3.0, 2.65 * strength),
      z: clamp((clamp((desired.z - p.z) * 16, -0.85, 0.85) - v.z) * 5.1, -3.0, 3.0),
    };
    body.resetForces(false);
    body.addForce(force, true);

    const q = body.rotation();
    const av = body.angvel();
    const sign = q.w < 0 ? -1 : 1;
    body.resetTorques(false);
    body.addTorque({
      x: clamp(-q.x * sign * 6 - av.x * 0.34, -0.50, 0.50),
      y: clamp(-q.y * sign * 6 - av.y * 0.34, -0.50, 0.50),
      z: clamp(-q.z * sign * 6 - av.z * 0.34, -0.50, 0.50),
    }, true);
  }

  function tick() {
    fingers.forEach(driveFinger);
    world.step();
    elapsed += CONFIG.fixedStep;
    contact = false;
    for (const finger of fingers) {
      for (const collider of finger.colliders) {
        world.contactPair(prizeCollider, collider, (manifold) => {
          if (manifold.numSolverContacts() > 0) contact = true;
        });
      }
    }
    // A vertical carton reaches the tray with COM higher than a flat carton.
    // Require actual tray contact instead of an arbitrary COM-height shortcut.
    const p = prize.translation();
    if (!won && p.y < CONFIG.railY - 0.15 && Math.abs(p.x) < 1.6 && Math.abs(p.z) < 1.3) {
      world.contactPair(prizeCollider, floorCollider, (manifold) => {
        if (manifold.numSolverContacts() > 0) won = true;
      });
    }
  }

  function step(dt = CONFIG.fixedStep) {
    if (disposed) return;
    accumulator += clamp(Number.isFinite(dt) ? dt : 0, 0, 0.10);
    while (accumulator + 1e-10 >= CONFIG.fixedStep) {
      tick();
      accumulator -= CONFIG.fixedStep;
    }
  }

  function getState() {
    const poses = fingers.map(({ side, body }) => {
      const p = vector(body.translation());
      const q = rotation(body.rotation());
      // Transform the spoon's lower centre into world space for UI/debug views.
      const local = { x: side * FINGER_GEOMETRY.spoon.x, y: FINGER_GEOMETRY.spoon.y, z: 0 };
      const ix = q.w * local.x + q.y * local.z - q.z * local.y;
      const iy = q.w * local.y + q.z * local.x - q.x * local.z;
      const iz = q.w * local.z + q.x * local.y - q.y * local.x;
      const iw = -q.x * local.x - q.y * local.y - q.z * local.z;
      return { side, position: p, quaternion: q, tip: {
        x: p.x + ix * q.w - iw * q.x - iy * q.z + iz * q.y,
        y: p.y + iy * q.w - iw * q.y - iz * q.x + ix * q.z,
        z: p.z + iz * q.w - iw * q.z - ix * q.y + iy * q.x,
      } };
    });
    return {
      prize: {
        position: vector(prize.translation()), quaternion: rotation(prize.rotation()),
        velocity: vector(prize.linvel()), angularVelocity: vector(prize.angvel()),
        sleeping: prize.isSleeping(),
      },
      claw: { position: { x: target.x, y: target.y, z: target.z }, open: target.open, fingers: poses },
      won, contact, elapsed,
    };
  }

  return {
    step, setClawTarget, resetPrize, getState,
    dispose() { if (!disposed) { disposed = true; world.free(); } },
    // Deterministic diagnostics used by regression tests. Gameplay never invokes
    // these: setting pose only establishes a test's initial physical conditions.
    debug: {
      setPrizePose(position, quaternion = identity) { resetBody(prize, position, quaternion); won = false; },
      applyPrizeImpulse(impulse, point) {
        if (point) prize.applyImpulseAtPoint(impulse, point, true);
        else prize.applyImpulse(impulse, true);
      },
    },
  };
}
