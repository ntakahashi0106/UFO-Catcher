import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhysics } from '../src/physics.js';
import { CONFIG } from '../src/config.js';
import { clawAngle, clawPivot } from '../src/claw.js';
import { PRIZE_TYPES, getPrizeType, getPrizeLowerHeadY } from '../src/prizes.js';

function simulate(physics, seconds, inspect) {
  for (let i = 0; i < Math.round(seconds / CONFIG.fixedStep); i++) {
    physics.step();
    inspect?.(physics.getState());
  }
}

function move(physics, to, seconds, smooth = true, inspect) {
  const claw = physics.getState().claw;
  const from = { ...claw.position, open: claw.open };
  const frames = Math.ceil(seconds / CONFIG.fixedStep);
  for (let i = 1; i <= frames; i++) {
    let progress = Math.min(1, (i * CONFIG.fixedStep) / seconds);
    if (smooth) progress = progress * progress * (3 - 2 * progress);
    const next = {};
    for (const key of ['x', 'y', 'z', 'open']) {
      next[key] = from[key] + ((to[key] ?? from[key]) - from[key]) * progress;
    }
    physics.setClawTarget(next);
    physics.step();
    inspect?.(physics.getState());
  }
}

function initializeAtCentre(physics) {
  physics.setClawTarget({ x: 0, y: CONFIG.home.y, z: 0, open: 1 });
  simulate(physics, 1.5); // The same 180 initial ticks as the browser.
}

// Browser state-machine timings. Neither prize poses nor test impulses are used
// in these gameplay regressions: all displacement comes from rigid-body contact.
function attempt(physics, aim = { x: 0, z: 0.28 }, inspect) {
  move(physics, { ...aim, open: 1 }, 0.43, false, inspect);
  move(physics, { y: getPrizeLowerHeadY(physics.getState().prize.type) }, 1.8, true, inspect);
  move(physics, { open: 0 }, 1.1, true, inspect);
  simulate(physics, 0.4, inspect);
  const closed = physics.getState();
  move(physics, { y: CONFIG.home.y }, 2.3, true, inspect);
  simulate(physics, 0.35, inspect);
  const lifted = physics.getState();
  move(physics, { open: 1 }, 1.0, true, inspect);
  simulate(physics, 2.7, inspect); // Open hold, stationary return, and settling.
  return { closed, lifted, settled: physics.getState() };
}

function verifyHinges(state) {
  for (const finger of state.claw.fingers) {
    const hinge = clawPivot(state.claw.position, finger.side);
    // Inspect raw simulated body origins, not the renderer's head position.
    const separation = Math.hypot(finger.position.x - hinge.x,
      finger.position.y - hinge.y, finger.position.z - hinge.z);
    assert.ok(separation < 0.002, `joint anchor separated by ${separation} metres`);
    assert.ok(Math.abs(separation - finger.anchorError) < 1e-9);
    assert.ok(Math.abs(finger.quaternion.x) < 0.002);
    assert.ok(Math.abs(finger.quaternion.y) < 0.002);
    assert.ok(Math.abs(finger.motorTorque) <= finger.maxTorque + 1e-9);
    assert.ok(Object.values(finger.position).every(Number.isFinite));
  }
}

test('a box bridges both round bars, sleeps, and never wins while idle', async () => {
  const physics = await createPhysics();
  try {
    simulate(physics, 60);
    const state = physics.getState();
    const restY = CONFIG.railY + CONFIG.railRadius + CONFIG.prize.y / 2;
    assert.ok(Math.abs(state.prize.position.y - restY) < 0.004);
    assert.ok(Math.abs(state.prize.position.x) < 0.001);
    assert.ok(Math.abs(state.prize.position.z) < 0.001);
    assert.equal(state.prize.sleeping, true);
    assert.equal(state.won, false);
    verifyHinges(state);
  } finally { physics.dispose(); }
});

test('gravity drops a rotated carton through the gap and actual tray contact awards it', async () => {
  const physics = await createPhysics();
  try {
    // The .76m dimension now spans the .91m clear gap between round bars.
    physics.debug.setPrizePose({ x: 0, y: 2.1, z: 0 },
      { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
    simulate(physics, 0.1);
    const falling = physics.getState();
    assert.ok(falling.prize.velocity.y < -0.8);
    assert.ok(falling.prize.position.y < 2.08);
    assert.equal(falling.won, false);
    simulate(physics, 2);
    const landed = physics.getState();
    assert.ok(Math.abs(landed.prize.position.y - (CONFIG.floorY + CONFIG.prize.y / 2)) < 0.02);
    assert.equal(landed.won, true);
  } finally { physics.dispose(); }
});

test('arms open along a rotation arc around fixed head hinges', async () => {
  const physics = await createPhysics();
  try {
    initializeAtCentre(physics);
    const opened = physics.getState();
    move(physics, { open: 0 }, 1.1, true, verifyHinges);
    simulate(physics, 0.6, verifyHinges);
    const closed = physics.getState();
    for (const arm of closed.claw.fingers) {
      const openArm = opened.claw.fingers.find((finger) => finger.side === arm.side);
      assert.ok(Math.abs(openArm.angle - clawAngle(arm.side, 1)) < 0.005);
      assert.ok(Math.abs(arm.angle - clawAngle(arm.side, 0)) < 0.005);
      assert.ok(Math.abs(openArm.position.x - arm.position.x) < 0.0001);
      assert.ok(Math.abs(openArm.position.y - arm.position.y) < 0.0001);
      const radius = (finger) => Math.hypot(finger.tip.x - finger.position.x,
        finger.tip.y - finger.position.y, finger.tip.z - finger.position.z);
      assert.ok(Math.abs(radius(openArm) - radius(arm)) < 0.00001);
      assert.ok(arm.side * (openArm.tip.x - arm.tip.x) > 0.3);
      assert.ok(openArm.tip.y - arm.tip.y > 0.1);
    }
  } finally { physics.dispose(); }
});

test('loaded joints stay attached while a finite closing motor stalls and slips', async () => {
  const physics = await createPhysics();
  try {
    initializeAtCentre(physics);
    let maximumSeparation = 0;
    const inspect = (state) => {
      verifyHinges(state);
      for (const arm of state.claw.fingers) maximumSeparation = Math.max(maximumSeparation, arm.anchorError);
    };
    const result = attempt(physics, { x: 0, z: 0.28 }, inspect);
    assert.equal(result.closed.contact, true);
    assert.ok(result.closed.claw.fingers.some((arm) => Math.abs(arm.angle - arm.targetAngle) > 0.1),
      'carton contact prevents a finite motor from reaching its requested angle');
    assert.ok(result.closed.claw.fingers.every((arm) => arm.maxTorque <= 0.28),
      'gripping strength is explicitly bounded while contacts stall the arms');
    assert.ok(result.lifted.prize.position.y > 1.65, 'real spoons support and tilt the box during lifting');
    assert.ok(maximumSeparation < 0.001, 'ordinary loaded lift keeps pivots within one millimetre');
    for (const arm of result.settled.claw.fingers) {
      assert.ok(Math.abs(arm.angle - clawAngle(arm.side, 1)) < 0.01,
        'the stronger but finite opening actuator releases the loaded spoons');
    }
    assert.ok(result.settled.prize.position.y < 1.6, 'box is not permanently trapped in the open claw');
  } finally { physics.dispose(); }
});

test('abrupt carriage targets and obstruction by bars cannot detach the arms', async () => {
  const physics = await createPhysics();
  try {
    initializeAtCentre(physics);
    let previousHead = physics.getState().claw.position;
    const inspect = (state) => {
      verifyHinges(state);
      const p = state.claw.position;
      assert.ok(Math.hypot(p.x - previousHead.x, p.y - previousHead.y, p.z - previousHead.z)
        <= 1.5 * CONFIG.fixedStep + 0.000001, 'kinematic head is rate limited instead of teleporting');
      previousHead = p;
    };
    for (const target of [
      { x: 0.84, z: 0.5, y: 1.70, open: 1 },
      { x: 0.84, z: 0.5, y: 1.70, open: 0 },
      { x: -0.84, z: -0.5, y: 2.52, open: 0 },
      { x: -0.84, z: -0.5, y: 1.70, open: 0 },
      { x: 0, z: 0.5, y: 2.52, open: 1 },
    ]) {
      physics.setClawTarget(target);
      simulate(physics, 2, inspect);
    }
    assert.ok(Object.values(physics.getState().prize.position).every(Number.isFinite));
  } finally { physics.dispose(); }
});

test('withdrawing the spoons wakes a sleeping supported carton so it falls', async () => {
  const physics = await createPhysics();
  try {
    physics.setClawTarget({ x: 0, y: CONFIG.home.y, z: 0, open: 0 });
    simulate(physics, 2);
    physics.debug.setPrizePose({ x: 0, y: 2.065, z: 0 });
    simulate(physics, 3);
    const supported = physics.getState();
    assert.ok(supported.prize.position.y > 1.9);
    assert.equal(supported.contact, true);
    physics.setClawTarget({ open: 1 });
    simulate(physics, 3);
    const released = physics.getState();
    assert.equal(released.contact, false);
    assert.ok(released.prize.position.y < 1.6,
      'removing physical support must resume gravity even when the carton had slept');
    for (const arm of released.claw.fingers) assert.ok(Math.abs(arm.angle - clawAngle(arm.side, 1)) < 0.01);
  } finally { physics.dispose(); }
});

test('browser-timed attempts retain displacement and can physically acquire the carton', async () => {
  const physics = await createPhysics();
  try {
    initializeAtCentre(physics);
    const first = attempt(physics, undefined, verifyHinges);
    assert.equal(first.settled.won, false, 'a nudge does not automatically award a prize');
    assert.ok(Math.abs(first.settled.prize.position.z) > 0.08);
    let state = first.settled;
    // Re-aim after the box tilts: repeatedly using the old low corner can miss
    // the shifted carton. These are ordinary player actions, not test impulses.
    const aims = [{ x: 0, z: 0.28 }, { x: 0, z: 0.28 },
      { x: 0.2, z: 0 }, { x: -0.2, z: 0.15 }, { x: 0.2, z: 0.15 }];
    for (const aim of aims) {
      if (state.won) break;
      state = attempt(physics, aim, verifyHinges).settled;
    }
    assert.equal(state.won, true);
    assert.ok(state.prize.position.y < 1.0);
    assert.ok(state.prize.position.y > CONFIG.floorY);
  } finally { physics.dispose(); }
});

test('fresh worlds reproduce physical movement without random win logic', async () => {
  const one = await createPhysics();
  const two = await createPhysics();
  try {
    initializeAtCentre(one);
    initializeAtCentre(two);
    const a = attempt(one).settled;
    const b = attempt(two).settled;
    for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(a.prize.position[key] - b.prize.position[key]) < 1e-6);
    for (const key of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(a.prize.quaternion[key] - b.prize.quaternion[key]) < 1e-6);
    assert.equal(a.won, b.won);
  } finally { one.dispose(); two.dispose(); }
});

test('cabinet walls retain a carton after a hard sideways impact', async () => {
  const physics = await createPhysics();
  try {
    physics.debug.applyPrizeImpulse({ x: 1.6, y: 0.1, z: 1.3 });
    simulate(physics, 8);
    const state = physics.getState();
    assert.ok(Math.abs(state.prize.position.x) < 1.52);
    assert.ok(Math.abs(state.prize.position.z) < 1.08);
    assert.ok(state.prize.position.y >= CONFIG.floorY);
    assert.ok(Object.values(state.prize.velocity).every(Number.isFinite));
  } finally { physics.dispose(); }
});

test('reset restores the carton, head, and hinged arms to a stable setup', async () => {
  const physics = await createPhysics();
  try {
    initializeAtCentre(physics);
    attempt(physics);
    physics.resetPrize('hard');
    const reset = physics.getState();
    assert.equal(reset.won, false);
    assert.equal(reset.claw.open, 1);
    assert.ok(Math.abs(reset.claw.position.y - CONFIG.home.y) < 1e-6);
    assert.equal(reset.prize.position.z, 0);
    simulate(physics, 5, verifyHinges);
    const settled = physics.getState();
    assert.ok(Math.abs(settled.prize.position.z) < 0.001);
    assert.ok(Math.abs(settled.prize.position.y - 1.395) < 0.004);
    for (const finger of settled.claw.fingers) {
      const hinge = clawPivot(CONFIG.home, finger.side);
      assert.ok(Math.abs(finger.position.x - hinge.x) < 0.0001);
      assert.ok(Math.abs(finger.position.y - hinge.y) < 0.0001);
      assert.ok(Math.abs(finger.angle - clawAngle(finger.side, 1)) < 0.005);
    }
    assert.equal(settled.won, false);
  } finally { physics.dispose(); }
});

test('each selected box has its own physical size, mass, and resting height', async () => {
  const configPrize = { ...CONFIG.prize };
  for (const type of PRIZE_TYPES) {
    const physics = await createPhysics({ prizeType: type.id });
    try {
      const initial = physics.getState().prize;
      assert.equal(initial.type, type.id);
      assert.deepEqual(initial.size, type.size);
      assert.ok(Math.abs(initial.mass - type.mass) < 1e-6);
      const expectedInertia = {
        x: type.mass * (type.size.y ** 2 + type.size.z ** 2) / 12,
        y: type.mass * (type.size.x ** 2 + type.size.z ** 2) / 12,
        z: type.mass * (type.size.x ** 2 + type.size.y ** 2) / 12,
      };
      for (const axis of ['x', 'y', 'z']) {
        // Rounded cardboard edges have slightly less inertia than a sharp box.
        assert.ok(Math.abs(initial.inertia[axis] / expectedInertia[axis] - 1) < 0.04,
          `${type.id} ${axis} inertia must match its actual dimensions`);
      }
      simulate(physics, 5, verifyHinges);
      const settled = physics.getState();
      const restY = CONFIG.railY + CONFIG.railRadius + type.size.y / 2;
      assert.ok(Math.abs(settled.prize.position.y - restY) < 0.004);
      assert.ok(Math.abs(settled.prize.position.z) < 0.001);
      assert.equal(settled.prize.sleeping, true);
      assert.equal(settled.won, false);
    } finally { physics.dispose(); }
  }
  assert.deepEqual(CONFIG.prize, configPrize, 'choosing a box must not mutate the global default');
});

test('switching box types immediately replaces physical mass and inertia without accumulating colliders', async () => {
  const physics = await createPhysics();
  try {
    // Repeated switches expose accidental duplicate colliders or stale mass.
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const type of PRIZE_TYPES) {
        assert.equal(physics.setPrizeType(type.id), type.id);
        const initial = physics.getState().prize;
        physics.debug.applyPrizeImpulse({ x: 0.06, y: 0, z: 0 });
        const moved = physics.getState().prize;
        assert.ok(Math.abs(moved.velocity.x - 0.06 / type.mass) < 1e-6,
          'linear impulse must use the newly selected mass before any simulation step');
        physics.resetPrize('hard');
        const reset = physics.getState().prize;
        physics.debug.applyPrizeImpulse({ x: 0, y: 0.04, z: 0 },
          { x: 0.12, y: reset.position.y, z: 0 });
        const turned = physics.getState().prize;
        assert.ok(Math.abs(turned.angularVelocity.z - 0.0048 / initial.inertia.z) < 1e-5,
          'an off-centre impulse must use the new shape inertia');
        assert.equal(turned.type, type.id, 'difficulty resets retain the selected box');
        assert.deepEqual(turned.size, type.size);
        assert.ok(Math.abs(turned.mass - type.mass) < 1e-6);
      }
    }
  } finally { physics.dispose(); }
});

test('changing box type clears acquisition, motion, and claw state and invalid IDs use the shared fallback', async () => {
  const physics = await createPhysics();
  try {
    physics.debug.setPrizePose({ x: 0, y: 2.1, z: 0 },
      { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
    simulate(physics, 2.1);
    assert.equal(physics.getState().won, true);
    physics.debug.applyPrizeImpulse({ x: 0.1, y: 0.1, z: 0.1 });
    physics.setClawTarget({ x: 0.5, y: 1.75, z: 0.3, open: 0 });
    simulate(physics, 0.2);
    physics.setPrizeType('flat');
    const reset = physics.getState();
    assert.equal(reset.prize.type, 'flat');
    assert.equal(reset.won, false);
    assert.equal(reset.contact, false);
    assert.equal(reset.elapsed, 0);
    assert.deepEqual(reset.prize.velocity, { x: 0, y: 0, z: 0 });
    assert.deepEqual(reset.prize.angularVelocity, { x: 0, y: 0, z: 0 });
    assert.deepEqual(reset.prize.quaternion, { x: 0, y: 0, z: 0, w: 1 });
    assert.equal(reset.claw.open, 1);
    verifyHinges(reset);
    simulate(physics, 5, verifyHinges);
    assert.ok(Math.abs(physics.getState().prize.position.y - 1.32) < 0.004);
    assert.equal(physics.setPrizeType('not-a-prize'), getPrizeType('not-a-prize').id);
    assert.equal(physics.getState().prize.type, 'standard');
    physics.resetPrize('easy');
    assert.equal(physics.getState().prize.type, 'standard');
  } finally { physics.dispose(); }
});

test('all box shapes physically move with edge aims while the hinges stay attached', async () => {
  const physics = await createPhysics();
  try {
    const tall = getPrizeType('tall');
    const aims = {
      standard: { x: 0, z: 0.28 },
      flat: { x: 0.15, z: 0.35 },
      // Offset the narrower carton slightly so the spoons lift its edge unevenly.
      tall: { x: tall.size.x * 0.2, z: tall.size.z * 0.25 },
    };
    for (const type of PRIZE_TYPES) {
      physics.setPrizeType(type.id);
      initializeAtCentre(physics);
      const result = attempt(physics, aims[type.id], verifyHinges);
      assert.equal(result.closed.contact, true, `${type.id} must use actual physical claw contacts`);
      assert.equal(result.settled.prize.type, type.id);
      assert.ok(Object.values(result.settled.prize.position).every(Number.isFinite));
      assert.ok(result.settled.prize.position.y >= CONFIG.floorY);
      assert.ok(Math.hypot(result.settled.prize.position.x, result.settled.prize.position.z) > 0.02,
        `${type.id} must retain meaningful displacement after an ordinary edge attempt`);
    }
  } finally { physics.dispose(); }
});

test('the smaller tall box can be gripped and lifted at central and nearby aims', async () => {
  for (const aim of [{ x: 0, z: 0 }, { x: 0, z: 0.28 }]) {
    const physics = await createPhysics({ prizeType: 'tall' });
    try {
      initializeAtCentre(physics);
      const restingY = physics.getState().prize.position.y;
      const result = attempt(physics, aim, verifyHinges);
      assert.equal(result.closed.contact, true, 'closing must make real claw contact');
      assert.equal(result.lifted.contact, true, 'the spoons must retain the carton at full lift');
      assert.ok(result.lifted.prize.position.y > restingY + 0.5,
        'a centred or nearby grip must lift the actual carton by more than half a metre');
      assert.equal(result.settled.contact, false, 'opening must release the lifted carton');
      assert.ok(result.settled.prize.position.y < restingY + 0.15,
        'the carton must return under gravity instead of remaining stuck in the open claw');
    } finally { physics.dispose(); }
  }
});
