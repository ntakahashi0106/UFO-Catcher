import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhysics } from '../src/physics.js';
import { CONFIG } from '../src/config.js';

const simulate = (physics, seconds) => {
  for (let i = 0; i < Math.round(seconds / CONFIG.fixedStep); i++) physics.step();
};

function move(physics, to, seconds, smooth = false) {
  const claw = physics.getState().claw;
  const from = { ...claw.position, open: claw.open };
  const frames = Math.ceil(seconds / CONFIG.fixedStep);
  for (let i = 1; i <= frames; i++) {
    const next = {};
    let progress = Math.min(1, (i * CONFIG.fixedStep) / seconds);
    if (smooth) progress = progress * progress * (3 - 2 * progress);
    for (const key of ['x', 'y', 'z', 'open']) {
      next[key] = from[key] + ((to[key] ?? from[key]) - from[key]) * progress;
    }
    physics.setClawTarget(next);
    physics.step();
  }
}

// This is the same move/descend/close/lift/release sequence available to players;
// it never changes prize poses or applies a test impulse.
function attempt(physics, aim = { x: 0, z: 0.28 }) {
  move(physics, { ...aim, open: 1 }, 1.5);
  move(physics, { y: 1.78 }, 2);
  simulate(physics, 0.25);
  move(physics, { open: 0 }, 1.3);
  simulate(physics, 0.45);
  const closed = physics.getState();
  move(physics, { y: CONFIG.home.y }, 2.3);
  const lifted = physics.getState();
  move(physics, { open: 1 }, 0.8);
  simulate(physics, 3);
  return { closed, lifted, settled: physics.getState() };
}

test('a box bridges both round bars, comes to rest, and never wins while idle', async () => {
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
    assert.equal(state.contact, false);
  } finally { physics.dispose(); }
});

test('gravity drops a rotated carton through the gap and tray contact awards it', async () => {
  const physics = await createPhysics();
  try {
    // The narrow .76m dimension now spans the .91m clear gap between rods.
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

test('two real off-centre claw attempts tip and shift the carton, then drop it', async () => {
  const physics = await createPhysics();
  try {
    const first = attempt(physics);
    assert.equal(first.closed.contact, true, 'spoons physically touch the carton');
    assert.ok(first.lifted.prize.position.y > 1.55, 'off-centre support lifts an end');
    assert.ok(Math.abs(first.lifted.prize.quaternion.x) > 0.15, 'carton tilts under its own weight');
    assert.ok(first.settled.prize.position.z < -0.15, 'released carton retains its displacement');
    assert.equal(first.settled.won, false, 'a successful nudge is not an automatic win');
    const second = attempt(physics);
    assert.equal(second.settled.won, true, 'second physical attempt reaches the collection tray');
    assert.ok(second.settled.prize.position.y < 1.0);
    assert.ok(second.settled.prize.position.y > CONFIG.floorY);
  } finally { physics.dispose(); }
});

test('fresh worlds reproduce the same physical attempt without random win logic', async () => {
  const one = await createPhysics();
  const two = await createPhysics();
  try {
    const a = attempt(one).settled;
    const b = attempt(two).settled;
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Math.abs(a.prize.position[key] - b.prize.position[key]) < 1e-6);
    }
    for (const key of ['x', 'y', 'z', 'w']) {
      assert.ok(Math.abs(a.prize.quaternion[key] - b.prize.quaternion[key]) < 1e-6);
    }
    assert.equal(a.won, b.won);
  } finally { one.dispose(); two.dispose(); }
});

test('the browser state-machine timings preserve progress and allow a real acquisition', async () => {
  const physics = await createPhysics();
  try {
    physics.setClawTarget({ x: 0, y: CONFIG.home.y, z: 0, open: 1 });
    simulate(physics, 1.5); // 180 initialization ticks in main.js.
    const settled = [];
    for (let i = 0; i < 5; i++) {
      move(physics, { x: 0, z: 0.28, open: 1 }, 0.43);
      move(physics, { y: 1.78 }, 1.8, true);
      move(physics, { open: 0 }, 1.1, true);
      simulate(physics, 0.4);
      move(physics, { y: CONFIG.home.y }, 2.3, true);
      simulate(physics, 0.35);
      move(physics, { open: 1 }, 1.0, true);
      simulate(physics, 0.3);
      simulate(physics, 1.2); // Stationary return phase.
      simulate(physics, 1.2); // Physical settling before accepting input.
      const state = physics.getState();
      settled.push(state);
      assert.ok(Object.values(state.prize.position).every(Number.isFinite));
      assert.ok(Object.values(state.prize.velocity).every(Number.isFinite));
      assert.ok(Math.abs(state.prize.position.z) < 1.08);
      for (const finger of state.claw.fingers) {
        assert.ok(Math.abs(finger.position.x) < 1);
        assert.ok(Math.abs(finger.position.y - (CONFIG.home.y - 0.025)) < 0.05,
          'force-driven jaws return without getting trapped after each try');
      }
    }
    assert.equal(settled[0].won, false);
    assert.ok(settled[0].prize.position.z < -0.15);
    assert.ok(settled[0].prize.position.y > 1.2);
    assert.equal(settled.at(-1).won, true);
    assert.ok(settled.at(-1).prize.position.y < 1.0);
  } finally { physics.dispose(); }
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

test('reset restores a moved carton and both jaws to a stable fresh setup', async () => {
  const physics = await createPhysics();
  try {
    attempt(physics);
    physics.resetPrize('hard');
    const reset = physics.getState();
    assert.equal(reset.won, false);
    assert.equal(reset.claw.open, 1);
    assert.equal(reset.claw.position.y, CONFIG.home.y);
    assert.equal(reset.prize.position.z, 0);
    simulate(physics, 5);
    const settled = physics.getState();
    assert.ok(Math.abs(settled.prize.position.z) < 0.001);
    assert.ok(Math.abs(settled.prize.position.y - 1.395) < 0.004);
    for (const finger of settled.claw.fingers) {
      assert.ok(Math.abs(finger.position.y - (CONFIG.home.y - 0.025)) < 0.005);
      assert.ok(Math.abs(finger.position.x - (CONFIG.home.x + finger.side * 0.63)) < 0.005);
    }
    assert.equal(settled.won, false);
  } finally { physics.dispose(); }
});
