import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';
import { CLAW, clawAngle, clawPivot, clawPose, fingerSegments } from './claw.js';
import { getPrizeType } from './prizes.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const vector = ({ x, y, z }) => ({ x, y, z });
const rotation = ({ x, y, z, w }) => ({ x, y, z, w });
const identity = { x: 0, y: 0, z: 0, w: 1 };
let initialization;

export const FINGER_GEOMETRY = CLAW;

/** A metre/kilogram/second simulation. Prize motion is exclusively Rapier motion. */
export async function createPhysics({ prizeType = 'standard' } = {}) {
  initialization ??= RAPIER.init();
  await initialization;

  const world = new RAPIER.World({ x: 0, y: CONFIG.gravity, z: 0 });
  world.timestep = CONFIG.fixedStep;
  world.numSolverIterations = 20;
  world.numInternalPgsIterations = 2;
  let elapsed = 0;
  let accumulator = 0;
  let won = false;
  let disposed = false;
  let contact = false;
  let difficulty = 'normal';
  let selectedPrize = getPrizeType(prizeType);
  let target = { ...CONFIG.home, open: 1 };

  // The carriage is driven, but each arm is a separate rigid body permanently
  // pinned to it. A revolute joint removes translation and out-of-plane motion;
  // only rotation about the real Z-axis hinge remains free.
  const head = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(target.x, target.y, target.z));

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
      .setTranslation(0, CONFIG.railY + CONFIG.railRadius + selectedPrize.size.y / 2 + 0.002, 0)
      .setLinearDamping(0.08).setAngularDamping(0.14)
      .setCcdEnabled(true).setCanSleep(true)
      .setAdditionalSolverIterations(8),
  );
  function prizeFriction() {
    return selectedPrize.friction + (difficulty === 'easy' ? -0.12 : difficulty === 'hard' ? 0.16 : 0);
  }

  function createPrizeCollider() {
    const { size, mass } = selectedPrize;
    const collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(size.x / 2 - 0.004,
        size.y / 2 - 0.004, size.z / 2 - 0.004, 0.004)
        .setMass(mass).setFriction(prizeFriction()).setRestitution(0)
        .setCollisionGroups(0x0002ffff), prize,
    );
    // Replacing the shape must replace its mass and rotational inertia too,
    // including before the next physics step or an immediate diagnostic impulse.
    prize.recomputeMassPropertiesFromColliders();
    return collider;
  }

  let prizeCollider = createPrizeCollider();

  const fingers = [-1, 1].map((side) => {
    const pose = clawPose(target, side, target.open);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pose.position.x, pose.position.y, pose.position.z)
        .setRotation(pose.quaternion)
        .setCcdEnabled(true).setCanSleep(false)
        .setLinearDamping(0.05).setAngularDamping(0.15)
        .setAdditionalSolverIterations(20),
    );
    const colliders = fingerSegments(side).map((segment) => world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(segment.size.x / 2 - 0.006,
        segment.size.y / 2 - 0.006, segment.size.z / 2 - 0.006, 0.006)
        .setTranslation(segment.position.x, segment.position.y, segment.position.z)
        .setRotation(segment.quaternion)
        .setMass(0.036).setFriction(0.31).setRestitution(0)
        .setCollisionGroups(0x0001fffe), body,
    ));
    const spoon = CLAW.spoon;
    const spoonCollider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(spoon.size.x / 2 - spoon.radius,
        spoon.size.y / 2 - spoon.radius, spoon.size.z / 2 - spoon.radius, spoon.radius)
        .setTranslation(side * spoon.center.x, spoon.center.y, spoon.center.z)
        .setMass(0.023).setFriction(0.30).setRestitution(0)
        .setCollisionGroups(0x0001fffe), body,
    );
    colliders.push(spoonCollider);
    const joint = world.createImpulseJoint(RAPIER.JointData.revolute(
      { x: side * CLAW.pivotX, y: -CLAW.pivotDrop, z: 0 },
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), head, body, true);
    joint.setContactsEnabled(false);
    // Closing is compliant past zero rather than an infinitely strong closed
    // stop. Under a load an arm may rotate and let the carton slide free.
    joint.setLimits(side < 0 ? -0.82 : -0.35, side < 0 ? 0.35 : 0.82);
    return { side, body, joint, colliders, motorTorque: 0, maxTorque: 0 };
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
    prizeCollider.setFriction(prizeFriction());
    resetBody(prize, {
      x: 0,
      y: CONFIG.railY + CONFIG.railRadius + selectedPrize.size.y / 2 + 0.002,
      z: 0,
    });
    target = { ...CONFIG.home, open: 1 };
    resetBody(head, target);
    head.setNextKinematicTranslation(target);
    for (const finger of fingers) {
      const { side, body } = finger;
      const pose = clawPose(target, side, target.open);
      resetBody(body, pose.position, pose.quaternion);
      finger.motorTorque = 0;
      finger.maxTorque = 0;
    }
    won = false;
    contact = false;
    elapsed = 0;
    accumulator = 0;
  }

  function setPrizeType(id) {
    selectedPrize = getPrizeType(id);
    world.removeCollider(prizeCollider, true);
    prizeCollider = createPrizeCollider();
    resetPrize(difficulty);
    return selectedPrize.id;
  }

  function setClawTarget(next) {
    target = {
      x: clamp(Number.isFinite(next.x) ? next.x : target.x, -CONFIG.moveLimit.x, CONFIG.moveLimit.x),
      y: clamp(Number.isFinite(next.y) ? next.y : target.y, 1.70, CONFIG.home.y + 0.05),
      z: clamp(Number.isFinite(next.z) ? next.z : target.z, -CONFIG.moveLimit.z, CONFIG.moveLimit.z),
      open: clamp(Number.isFinite(next.open) ? next.open : target.open, 0, 1),
    };
  }

  function driveFinger(finger) {
    const { side, body } = finger;
    const strength = difficulty === 'easy' ? 1.12 : difficulty === 'hard' ? 0.88 : 1;
    const q = body.rotation();
    const angle = 2 * Math.atan2(q.z, q.w);
    const desired = clawAngle(side, target.open);
    const error = Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle));
    const gravityTorque = CONFIG.gravity * body.mass() * (body.worldCom().x - body.translation().x);
    // Rapier's JS joint motor has no force-cap API in this package version.
    // Apply an explicitly bounded physical torque instead. No translational
    // spring and no pose correction can pull an arm away from its joint.
    // Opening has a stronger actuator so a loaded bent spoon can rotate up and
    // out without permanently trapping the box. Closing remains deliberately
    // weak; both directions still have finite torque and angular speed.
    const opening = target.open > 0.5;
    const limit = (opening ? 1.8 : 0.27) * strength;
    const angularVelocity = clamp(error * 7, -1.2, 1.2);
    const torque = clamp((angularVelocity - body.angvel().z) * (opening ? 1.2 : 0.35) - gravityTorque, -limit, limit);
    body.resetTorques(false);
    body.addTorque({ x: 0, y: 0, z: torque }, true);
    finger.motorTorque = torque;
    finger.maxTorque = limit;
  }

  function tick() {
    const wasContact = contact;
    // Position-based kinematics supply the correct carriage velocity to joints
    // and contacts instead of teleporting the finger bodies every frame.
    const current = head.translation();
    const dx = target.x - current.x, dy = target.y - current.y, dz = target.z - current.z;
    const distance = Math.hypot(dx, dy, dz);
    const fraction = distance > 0 ? Math.min(1, 1.5 * CONFIG.fixedStep / distance) : 1;
    head.setNextKinematicTranslation({
      x: current.x + dx * fraction,
      y: current.y + dy * fraction,
      z: current.z + dz * fraction,
    });
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
    // A carton can sleep while resting on the spoons. Removing that support
    // must wake it so gravity resumes; a sleeping carton must not float in air.
    // Cartons resting independently on the bars or floor may still sleep.
    if (wasContact && !contact) prize.wakeUp();
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
    const headPosition = vector(head.translation());
    const poses = fingers.map(({ side, body, motorTorque, maxTorque }) => {
      const p = vector(body.translation());
      const q = rotation(body.rotation());
      // Transform the spoon's lower centre into world space for UI/debug views.
      const local = { x: side * CLAW.spoon.center.x, y: CLAW.spoon.center.y, z: 0 };
      const ix = q.w * local.x + q.y * local.z - q.z * local.y;
      const iy = q.w * local.y + q.z * local.x - q.x * local.z;
      const iz = q.w * local.z + q.x * local.y - q.y * local.x;
      const iw = -q.x * local.x - q.y * local.y - q.z * local.z;
      const hinge = clawPivot(headPosition, side);
      return { side, position: p, quaternion: q, hinge,
        angle: 2 * Math.atan2(q.z, q.w), targetAngle: clawAngle(side, target.open),
        anchorError: Math.hypot(p.x - hinge.x, p.y - hinge.y, p.z - hinge.z),
        motorTorque, maxTorque, tip: {
        x: p.x + ix * q.w - iw * q.x - iy * q.z + iz * q.y,
        y: p.y + iy * q.w - iw * q.y - iz * q.x + ix * q.z,
        z: p.z + iz * q.w - iw * q.z - ix * q.y + iy * q.x,
      } };
    });
    return {
      prize: {
        type: selectedPrize.id, size: { ...selectedPrize.size }, mass: prize.mass(),
        inertia: vector(prize.principalInertia()),
        position: vector(prize.translation()), quaternion: rotation(prize.rotation()),
        velocity: vector(prize.linvel()), angularVelocity: vector(prize.angvel()),
        sleeping: prize.isSleeping(),
      },
      claw: { position: headPosition, open: target.open, fingers: poses },
      won, contact, elapsed,
    };
  }

  return {
    step, setClawTarget, resetPrize, setPrizeType, getState,
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
