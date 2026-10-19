import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import typeface from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { CONFIG } from './config.js';
import { CLAW, clawPose } from './claw.js';

const FONT = new FontLoader().parse(typeface);

/** All of the cabinet, package and mechanisms are geometry: no image textures. */
export function createScene(container, { onReady } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e6e4dc');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', '3D crane machine. Drag to rotate the view.');
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.minDistance = 4.2;
  controls.maxDistance = 12;
  controls.minPolarAngle = 0.03;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.target.set(0, 1.38, 0);
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture;
  environment.dispose();
  pmrem.dispose();

  const materials = [];
  const material = (props) => {
    const result = new THREE.MeshStandardMaterial(props);
    materials.push(result);
    return result;
  };
  const ivory = material({ color: '#faf8ef', metalness: 0.17, roughness: 0.28 });
  const pearl = material({ color: '#e8e7dc', metalness: 0.2, roughness: 0.35 });
  const navy = material({ color: '#263a39', metalness: 0.35, roughness: 0.31 });
  const charcoal = material({ color: '#172423', metalness: 0.25, roughness: 0.35 });
  const silver = material({ color: '#c4cdcb', metalness: 0.95, roughness: 0.19 });
  const satin = material({ color: '#a5b2ac', metalness: 0.82, roughness: 0.32 });
  const mint = material({ color: '#c5eea0', metalness: 0.12, roughness: 0.28, emissive: '#9fe47c', emissiveIntensity: 0.24 });
  const led = material({ color: '#d5ffb9', emissive: '#b9ff86', emissiveIntensity: 1.15, roughness: 0.3 });
  const red = material({ color: '#e15e49', metalness: 0.03, roughness: 0.54 });
  const orange = material({ color: '#f6ad83', metalness: 0.02, roughness: 0.52 });
  const white = material({ color: '#fff9e9', roughness: 0.55 });
  const glass = material({ color: '#dce9df', transparent: true, opacity: 0.07, roughness: 0.12, metalness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const rear = material({ color: '#d9ddd4', roughness: 0.73 });
  const ground = material({ color: '#e6e4dc', roughness: 0.95 });
  const shapes = [];

  function mesh(geometry, mat, parent = scene, position = [0, 0, 0], shadow = true) {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(...position);
    object.castShadow = shadow;
    object.receiveShadow = shadow;
    parent.add(object);
    shapes.push(geometry);
    return object;
  }
  function box(w, h, d, mat, parent = scene, position = [0, 0, 0], radius = 0.012, shadow = true) {
    const geom = radius ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    return mesh(geom, mat, parent, position, shadow);
  }
  function cylinder(radius, length, mat, parent = scene, position = [0, 0, 0], axis = 'y', segments = 24) {
    const object = mesh(new THREE.CylinderGeometry(radius, radius, length, segments), mat, parent, position);
    if (axis === 'x') object.rotation.z = Math.PI / 2;
    if (axis === 'z') object.rotation.x = Math.PI / 2;
    return object;
  }
  function text(label, size, mat, parent, position, rotation = [0, 0, 0], depth = 0.002) {
    const geom = new TextGeometry(label, { font: FONT, size, depth, curveSegments: 3, bevelEnabled: false });
    geom.computeBoundingBox();
    geom.translate(-(geom.boundingBox.max.x - geom.boundingBox.min.x) / 2, 0, 0);
    const object = mesh(geom, mat, parent, position, false);
    object.rotation.set(...rotation);
    return object;
  }
  function screw(x, y, z, parent = scene) {
    cylinder(0.022, 0.012, silver, parent, [x, y, z], 'z', 12);
    box(0.023, 0.003, 0.014, navy, parent, [x, y, z + 0.008], 0, false);
  }
  function bentArmRibbon(points, width, depth) {
    // Offset the whole polyline, including its shared miter, so each metal rail
    // is one uninterrupted piece rather than two rods that can appear detached.
    const offsets = points.map((point, index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const incoming = new THREE.Vector2(point.x - previous.x, point.y - previous.y).normalize();
      const outgoing = new THREE.Vector2(next.x - point.x, next.y - point.y).normalize();
      if (index === 0) incoming.copy(outgoing);
      if (index === points.length - 1) outgoing.copy(incoming);
      const normalIn = new THREE.Vector2(-incoming.y, incoming.x);
      const normalOut = new THREE.Vector2(-outgoing.y, outgoing.x);
      const miter = normalIn.add(normalOut).normalize();
      return miter.multiplyScalar(width * 0.5 / Math.max(0.3, miter.dot(normalOut)));
    });
    const contour = points.map((point, index) => new THREE.Vector2(point.x + offsets[index].x, point.y + offsets[index].y));
    for (let index = points.length - 1; index >= 0; index--) {
      contour.push(new THREE.Vector2(points[index].x - offsets[index].x, points[index].y - offsets[index].y));
    }
    const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(contour), {
      depth, steps: 1, bevelEnabled: true, bevelThickness: 0.002,
      bevelSize: 0.002, bevelSegments: 2, curveSegments: 2,
    });
    geometry.translate(0, 0, -depth / 2);
    geometry.computeVertexNormals();
    return geometry;
  }

  scene.add(new THREE.HemisphereLight('#fffff1', '#8c9c91', 2.4));
  const key = new THREE.DirectionalLight('#fff6e5', 4.0);
  key.position.set(-3.5, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -3;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 18;
  key.shadow.normalBias = 0.018;
  key.shadow.bias = -0.00015;
  key.shadow.radius = 3;
  key.target.position.set(0, 1.2, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#edf6ff', 1.5);
  fill.position.set(4, 3.5, -4);
  scene.add(fill);
  const cabinetLight = new THREE.PointLight('#f1ffda', 3.2, 5, 2);
  cabinetLight.position.set(0, 2.8, 0.2);
  scene.add(cabinetLight);

  const floor = mesh(new THREE.PlaneGeometry(100, 100), ground, scene, [0, -0.68, 0], false);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;

  const cabinet = new THREE.Group();
  scene.add(cabinet);
  // Slightly inset feet and a deep, powder coated base ground the glass cabinet.
  for (const x of [-1.35, 1.35]) for (const z of [-0.86, 0.86]) {
    cylinder(0.105, 0.10, charcoal, cabinet, [x, -0.62, z]);
    cylinder(0.075, 0.065, silver, cabinet, [x, -0.555, z]);
  }
  box(3.35, 0.60, 2.42, ivory, cabinet, [0, -0.25, 0], 0.07);
  box(3.39, 0.09, 2.45, navy, cabinet, [0, -0.53, 0], 0.035);
  box(3.38, 0.12, 2.44, pearl, cabinet, [0, 0.09, 0], 0.035);
  // Collection opening is a recessed rubber curtain in the lower front fascia.
  box(1.23, 0.31, 0.045, navy, cabinet, [0.40, -0.245, 1.225], 0.045);
  box(1.11, 0.22, 0.045, charcoal, cabinet, [0.40, -0.26, 1.253], 0.028);
  box(1.11, 0.026, 0.057, satin, cabinet, [0.40, -0.155, 1.277], 0.008);
  for (let i = 0; i < 7; i++) box(0.004, 0.16, 0.008, navy, cabinet, [-0.07 + i * 0.155, -0.29, 1.28], 0, false);
  text('PRIZE OUT', 0.051, navy, cabinet, [0.40, -0.061, 1.276]);
  box(0.46, 0.31, 0.037, pearl, cabinet, [-1.03, -0.245, 1.224], 0.025);
  cylinder(0.047, 0.018, silver, cabinet, [-1.03, -0.245, 1.249], 'z', 20);
  box(0.004, 0.037, 0.012, charcoal, cabinet, [-1.03, -0.245, 1.263], 0);

  // Pit and internal walls; the two polished bridge bars remain unobstructed.
  box(2.99, 0.08, 2.10, rear, cabinet, [0, CONFIG.floorY - 0.06, 0], 0.012);
  box(2.99, 0.028, 2.10, navy, cabinet, [0, CONFIG.floorY - 0.008, 0], 0.008);
  box(2.98, 0.18, 0.06, ivory, cabinet, [0, 0.23, 1.06], 0.014);
  box(0.06, 0.18, 2.13, ivory, cabinet, [-1.47, 0.23, 0], 0.014);
  box(0.06, 0.18, 2.13, ivory, cabinet, [1.47, 0.23, 0], 0.014);

  // Back panel is quiet and bright, with recessed hardware and a mint inset.
  box(3.04, 2.73, 0.065, rear, cabinet, [0, 1.52, -1.145], 0.02);
  box(2.72, 1.56, 0.018, pearl, cabinet, [0, 1.40, -1.104], 0.025);
  box(2.71, 0.016, 0.022, ivory, cabinet, [0, 2.20, -1.09], 0.005);
  text('TAKE YOUR TIME.', 0.086, navy, cabinet, [0, 1.95, -1.075]);
  text('A LITTLE CLOSER. EVERY PLAY.', 0.033, navy, cabinet, [0, 1.84, -1.072]);
  for (const x of [-1.36, 1.36]) {
    box(0.025, 2.46, 0.027, led, cabinet, [x, 1.62, -1.088], 0.01, false);
  }

  for (const x of [-1.59, 1.59]) for (const z of [-1.15, 1.15]) {
    box(0.14, 2.94, 0.14, ivory, cabinet, [x, 1.61, z], 0.025);
    if (z > 0) {
      box(0.033, 2.64, 0.022, navy, cabinet, [x + (x > 0 ? -0.073 : 0.073), 1.57, z + 0.064], 0.006);
      screw(x, 0.31, z + 0.073, cabinet);
      screw(x, 2.92, z + 0.073, cabinet);
    }
  }
  for (const x of [-1.595, 1.595]) {
    box(0.012, 2.66, 2.12, glass, cabinet, [x, 1.62, 0], 0, false);
    box(0.042, 0.026, 2.07, silver, cabinet, [x, 0.30, 0], 0.006);
  }
  const roof = box(3.36, 0.21, 2.45, ivory, cabinet, [0, 3.12, 0], 0.045);
  const roofCap = box(3.39, 0.034, 2.47, navy, cabinet, [0, 3.238, 0], 0.012);
  box(3.10, 0.025, 0.027, led, cabinet, [0, 2.995, 1.12], 0.007, false);
  box(3.10, 0.026, 0.055, led, cabinet, [0, 2.995, -0.92], 0.008, false);
  // Raised lettering on the marquee uses actual geometry, not a decal.
  text('H A S H I', 0.16, navy, cabinet, [0, 3.055, 1.235], [0, 0, 0], 0.005);
  text('BRIDGE CATCHER', 0.040, navy, cabinet, [1.12, 3.11, 1.237]);
  const emblem = cylinder(0.068, 0.014, mint, cabinet, [-1.25, 3.126, 1.239], 'z');
  box(0.074, 0.013, 0.02, navy, cabinet, [-1.25, 3.126, 1.255], 0.003, false);
  box(0.013, 0.074, 0.02, navy, cabinet, [-1.25, 3.126, 1.255], 0.003, false);

  for (const z of [-CONFIG.railZ, CONFIG.railZ]) {
    cylinder(CONFIG.railRadius, CONFIG.railLength, silver, cabinet, [0, CONFIG.railY, z], 'x', 32);
    for (const side of [-1, 1]) {
      box(0.13, 0.15, 0.20, navy, cabinet, [side * 1.46, CONFIG.railY - 0.02, z], 0.02);
      cylinder(0.061, 0.07, satin, cabinet, [side * 1.405, CONFIG.railY, z], 'x', 20);
      cylinder(0.028, 0.94, silver, cabinet, [side * 1.47, 0.68, z], 'y', 16);
    }
  }
  // Fine deck marks make depth and bridge spacing legible from every angle.
  for (const z of [-0.89, 0.89]) {
    for (let x = -1.2; x < 1.3; x += 0.15) box(0.012, 0.006, 0.035, satin, cabinet, [x, 0.145, z], 0, false);
  }

  // Gantry: longitudinal tracks support an independently moving cross carriage.
  for (const x of [-1.40, 1.40]) {
    box(0.095, 0.11, 2.13, navy, cabinet, [x, 2.88, 0], 0.018);
    cylinder(0.019, 2.07, silver, cabinet, [x, 2.955, 0], 'z', 16);
  }
  const bridge = new THREE.Group();
  cabinet.add(bridge);
  bridge.position.set(0, 2.86, CONFIG.home.z);
  box(2.88, 0.10, 0.17, satin, bridge, [0, 0, 0], 0.015);
  cylinder(0.026, 2.79, silver, bridge, [0, -0.078, 0.035], 'x', 16);
  for (const x of [-1.39, 1.39]) box(0.17, 0.17, 0.27, ivory, bridge, [x, 0.015, 0], 0.022);
  const trolley = new THREE.Group();
  bridge.add(trolley);
  trolley.position.x = CONFIG.home.x;
  box(0.34, 0.18, 0.34, ivory, trolley, [0, -0.035, 0], 0.035);
  box(0.24, 0.025, 0.25, navy, trolley, [0, -0.139, 0], 0.015);
  cylinder(0.060, 0.025, silver, trolley, [0, -0.16, 0]);

  const cable = cylinder(0.014, 1, charcoal, scene, [CONFIG.home.x, 2.7, CONFIG.home.z], 'y', 12);
  const coil = new THREE.Group();
  scene.add(coil);
  const coilPoints = [];
  for (let i = 0; i <= 110; i++) {
    const t = i / 110;
    coilPoints.push(new THREE.Vector3(Math.cos(t * Math.PI * 18) * 0.035, t, Math.sin(t * Math.PI * 18) * 0.035));
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPoints), 110, 0.006, 5, false), navy, coil);

  const clawHead = new THREE.Group();
  clawHead.name = 'claw-housing';
  scene.add(clawHead);
  cylinder(0.16, 0.055, silver, clawHead, [0, 0.24, 0]);
  box(0.62, 0.23, 0.41, ivory, clawHead, [0, 0.115, 0], 0.075);
  box(0.53, 0.052, 0.37, navy, clawHead, [0, 0.015, 0], 0.024);
  box(0.43, 0.023, 0.022, led, clawHead, [0, 0.10, 0.207], 0.009, false);
  text('H', 0.075, navy, clawHead, [0, 0.132, 0.209]);
  box(0.43, 0.056, 0.20, charcoal, clawHead, [0, -0.008, 0], 0.018);

  const fingers = [];
  for (const side of [-1, 1]) {
    // The axle is fixed to the head. Its matching arm collar rotates on this
    // same pin; opening never translates the hinge sideways.
    const hinge = new THREE.Group();
    hinge.position.set(side * CLAW.pivotX, -CLAW.pivotDrop, 0);
    clawHead.add(hinge);
    cylinder(0.060, 0.115, navy, hinge, [0, 0, 0], 'z', 24);
    cylinder(0.021, 0.155, silver, hinge, [0, 0, 0], 'z', 20);

    const group = new THREE.Group();
    group.name = side < 0 ? 'claw-arm-left' : 'claw-arm-right';
    scene.add(group);
    const points = CLAW.points.map(point => ({ x: side * point.x, y: point.y, z: point.z }));
    const railDepth = 0.017;
    const railZ = (CLAW.segmentDepth - railDepth) / 2;
    for (const z of [-railZ, railZ]) {
      mesh(bentArmRibbon(points, CLAW.segmentWidth, railDepth), silver, group, [0, 0, z]);
      cylinder(0.041, 0.020, satin, group, [0, 0, z], 'z', 24);
    }
    // Small cross pins tie the twin rails into a rigid bent arm assembly.
    for (const point of points.slice(1)) {
      cylinder(0.027, CLAW.segmentDepth, silver, group, [point.x, point.y, point.z], 'z', 20);
      for (const z of [-CLAW.segmentDepth / 2 - 0.004, CLAW.segmentDepth / 2 + 0.004]) {
        cylinder(0.014, 0.008, satin, group, [point.x, point.y, z], 'z', 6);
      }
    }
    const spoon = CLAW.spoon;
    box(spoon.size.x, spoon.size.y, spoon.size.z, silver, group,
      [side * spoon.center.x, spoon.center.y, spoon.center.z], spoon.radius);
    box(0.070, 0.006, 0.070, satin, group,
      [side * spoon.center.x, spoon.center.y + spoon.size.y / 2 + 0.001, spoon.center.z], 0.003);
    fingers.push({ side, group });
  }

  const prize = new THREE.Group();
  scene.add(prize);
  const p = CONFIG.prize;
  box(p.x, p.y, p.z, red, prize, [0, 0, 0], 0.028);
  // Ivory paper belly band, salmon end panel and embossed packaging marks.
  box(p.x + 0.003, p.y + 0.003, 0.20, white, prize, [0, 0, -0.24], 0.008);
  box(p.x - 0.04, p.y - 0.04, 0.009, orange, prize, [0, 0, p.z / 2 + 0.004], 0.016);
  text('H A S H I', 0.068, navy, prize, [0, 0.032, p.z / 2 + 0.012]);
  text('PLAY OBJECT / 01', 0.025, navy, prize, [0, -0.063, p.z / 2 + 0.013]);
  const topMark = cylinder(0.17, 0.004, white, prize, [0, p.y / 2 + 0.004, 0.20], 'y', 48);
  text('H', 0.18, red, prize, [0, p.y / 2 + 0.008, 0.265], [-Math.PI / 2, 0, 0]);
  text('01', 0.10, white, prize, [p.x / 2 + 0.005, -0.04, 0.28], [0, Math.PI / 2, 0]);
  // Narrow seams catch the light without painted edge textures.
  box(p.x - 0.08, 0.002, 0.002, orange, prize, [0, p.y / 2 + 0.001, -p.z / 2 + 0.04], 0, false);
  prize.position.set(0, CONFIG.railY + CONFIG.railRadius + p.y / 2, 0);

  const guide = new THREE.Group();
  scene.add(guide);
  guide.position.set(CONFIG.home.x, CONFIG.railY + CONFIG.railRadius + CONFIG.prize.y + 0.018, CONFIG.home.z);
  const guideMaterial = new THREE.MeshBasicMaterial({ color: '#b6e88a', transparent: true, opacity: 0.8, depthWrite: false });
  materials.push(guideMaterial);
  const ring = mesh(new THREE.RingGeometry(0.105, 0.117, 48), guideMaterial, guide, [0, 0.006, 0], false);
  ring.rotation.x = -Math.PI / 2;
  for (const axis of ['x', 'z']) {
    const line = box(axis === 'x' ? 0.34 : 0.012, 0.006, axis === 'z' ? 0.34 : 0.012, guideMaterial, guide, [0, 0.008, 0], 0, false);
    line.renderOrder = 2;
  }
  const dashMaterial = new THREE.LineDashedMaterial({ color: '#83ac6a', transparent: true, opacity: 0.42, dashSize: 0.045, gapSize: 0.055, depthWrite: false });
  materials.push(dashMaterial);
  const guideLineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.025, 0), new THREE.Vector3(0, 0.97, 0)]);
  shapes.push(guideLineGeometry);
  const guideLine = new THREE.Line(guideLineGeometry, dashMaterial);
  guideLine.computeLineDistances();
  guide.add(guideLine);

  let mode = 'perspective';
  let quality = 'high';
  let disposed = false;
  let width = 1;
  let height = 1;
  let cameraTween = null;
  const cameraViews = {
    perspective: { direction: new THREE.Vector3(4.15, 2.9, 6.2), target: new THREE.Vector3(0, 1.32, 0) },
    front: { direction: new THREE.Vector3(0, 0.95, 7.1), target: new THREE.Vector3(0, 1.36, 0) },
    side: { direction: new THREE.Vector3(7.2, 1.45, 0.08), target: new THREE.Vector3(0, 1.42, 0) },
    top: { direction: new THREE.Vector3(0, 6.9, 0.001), target: new THREE.Vector3(0, 1.22, 0) },
  };
  function desiredCamera() {
    const view = cameraViews[mode];
    const aspect = width / height;
    // Frame the entire cabinet even inside a short landscape-phone viewport.
    const scale = aspect < 0.85 ? 1.32 : aspect < 1.1 ? 1.13 : aspect > 2.4 ? 0.91 : 1;
    const direction = view.direction.clone().multiplyScalar(scale);
    return { position: view.target.clone().add(direction), target: view.target.clone() };
  }
  function setCamera(next = 'perspective', instant = false) {
    mode = cameraViews[next] ? next : 'perspective';
    // An inspection view removes the ceiling so the bridge stays visible.
    roof.visible = mode !== 'top';
    roofCap.visible = mode !== 'top';
    const desired = desiredCamera();
    camera.up.set(0, 1, 0);
    if (mode === 'top') camera.up.set(0, 0, -1);
    if (instant) {
      camera.position.copy(desired.position);
      controls.target.copy(desired.target);
      cameraTween = null;
      controls.update();
    } else {
      cameraTween = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: desired.position, target: desired.target, elapsed: 0 };
    }
    return mode;
  }
  controls.addEventListener('start', () => { cameraTween = null; });
  function resize() {
    const rect = container.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    setCamera(mode, true);
  }
  function update(state, dt = 1 / 60) {
    if (disposed) return;
    if (state?.prize) {
      prize.position.copy(state.prize.position);
      if (state.prize.quaternion) prize.quaternion.copy(state.prize.quaternion);
    }
    const claw = state?.claw || { position: CONFIG.home, open: 1 };
    const cp = claw.position || CONFIG.home;
    clawHead.position.copy(cp);
    bridge.position.z = cp.z;
    trolley.position.x = cp.x;
    const cableTop = 2.70;
    const cableBottom = cp.y + 0.26;
    const cableLength = Math.max(0.015, cableTop - cableBottom);
    cable.position.set(cp.x, cableBottom + cableLength / 2, cp.z);
    cable.scale.y = cableLength;
    coil.position.set(cp.x + 0.055, cableBottom, cp.z);
    coil.scale.set(1, cableLength, 1);
    const opening = THREE.MathUtils.clamp(claw.open ?? 1, 0, 1);
    for (let i = 0; i < fingers.length; i++) {
      const finger = fingers[i];
      const pose = claw.fingers?.find((f) => f.side === finger.side) || claw.fingers?.[i];
      if (pose) {
        finger.group.position.copy(pose.position);
        finger.group.quaternion.copy(pose.quaternion);
      } else {
        const fallback = clawPose(cp, finger.side, opening);
        finger.group.position.copy(fallback.position);
        finger.group.quaternion.copy(fallback.quaternion);
      }
    }
    if (cameraTween) {
      cameraTween.elapsed += Math.min(dt, 0.05);
      const t = Math.min(1, cameraTween.elapsed / 0.44);
      const ease = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(cameraTween.from, cameraTween.to, ease);
      controls.target.lerpVectors(cameraTween.targetFrom, cameraTween.target, ease);
      if (t === 1) cameraTween = null;
    }
    controls.update();
    renderer.render(scene, camera);
  }
  function setTarget(target) {
    guide.position.x = target.x ?? guide.position.x;
    guide.position.z = target.z ?? guide.position.z;
  }
  function setGuide(visible) { guide.visible = visible; }
  function setQuality(next) {
    quality = next;
    const low = next === 'low' || next === 'performance';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.5));
    key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    renderer.shadowMap.needsUpdate = true;
    renderer.setSize(width, height, false);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  setCamera('perspective', true);
  update(null, 0);
  onReady?.();
  function dispose() {
    if (disposed) return;
    disposed = true;
    resizeObserver.disconnect();
    controls.dispose();
    shapes.forEach((geom) => geom.dispose());
    materials.forEach((mat) => mat.dispose());
    environmentTarget.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  return { update, resize, setCamera, setTarget, setGuide, setQuality, dispose, renderer, camera, scene, controls, get quality() { return quality; } };
}
