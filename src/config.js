export const CONFIG = {
  fixedStep: 1 / 120,
  gravity: -9.81,
  railZ: 0.50,
  railY: 1.15,
  railRadius: 0.045,
  railLength: 2.85,
  prize: { x: 0.76, y: 0.40, z: 1.42, mass: 0.38 },
  home: { x: -0.80, y: 2.52, z: -0.68 },
  // Keep the fully opened arms inside the glass, including their swept arc.
  moveLimit: { x: 0.84, z: 0.88 },
  floorY: 0.12,
};
