// One local-space mechanism definition for the rendered arms and Rapier shapes.
// Each arm stays attached at a fixed hinge inside the underside of the housing.
export const CLAW = {
  pivotX: 0.14,
  pivotDrop: 0.025,
  openAngle: 0.65,
  closedAngle: 0,
  lowerHeadY: 1.80,
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 0.30, y: -0.30, z: 0 },
    { x: 0.09, y: -0.66, z: 0 },
  ],
  segmentWidth: 0.045,
  segmentDepth: 0.075,
  spoon: {
    center: { x: 0.035, y: -0.66, z: 0 },
    size: { x: 0.18, y: 0.052, z: 0.13 },
    radius: 0.009,
  },
};

export function clawAngle(side, open) {
  return side * (CLAW.closedAngle + (CLAW.openAngle - CLAW.closedAngle) * Math.min(1, Math.max(0, open)));
}

export function clawPivot(position, side) {
  return { x: position.x + side * CLAW.pivotX, y: position.y - CLAW.pivotDrop, z: position.z };
}

export function clawPose(position, side, open) {
  const angle = clawAngle(side, open);
  return { position: clawPivot(position, side), quaternion: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) } };
}

export function fingerSegments(side) {
  return CLAW.points.slice(1).map((point, index) => {
    const start = CLAW.points[index];
    const dx = side * (point.x - start.x), dy = point.y - start.y;
    const angle = Math.atan2(dx, -dy);
    return {
      position: { x: side * (point.x + start.x) / 2, y: (point.y + start.y) / 2, z: 0 },
      size: { x: CLAW.segmentWidth, y: Math.hypot(dx, dy) + 0.012, z: CLAW.segmentDepth },
      angle,
      quaternion: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
    };
  });
}
