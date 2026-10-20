import assert from 'node:assert/strict';
import test from 'node:test';
import { createActionGate } from '../src/input.js';

test('a double tap performs a single reset, while a later intentional action works', () => {
  const allow = createActionGate();
  let resets = 0;
  for (const time of [0, 100, 240, 400]) if (allow('reset', time)) resets++;
  assert.equal(resets, 2);
});

test('debouncing an action does not consume a different control', () => {
  const allow = createActionGate();
  assert.equal(allow('start', 100), true);
  assert.equal(allow('start', 150), false);
  assert.equal(allow('sound', 150), true);
  assert.equal(allow('start', 450), true);
});
