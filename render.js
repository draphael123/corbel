/* ============================================================================
   CORBEL — the three.js scene.

   The simulation is 2D and lives in sim.js. Everything here is presentation:
   sim pixels map onto a build plane at z = 0, one grid cell to one metre.
   ========================================================================== */
import * as THREE from './vendor/three.module.js';

let SIM, S, CELL, W, DECK_Y, LEFT_EDGE, RIGHT_EDGE;
let renderer, scene, camera, canvas;
let timber, rope, joints, anchors;
let bodies, heads, packs, armL, armR, legL, legR, limbs = [];
let grid, ghost, snapRing, ash, ashData, mist = [], braziers = [];
let key, rim, emberLight;

const MAX_MEMBERS = 420, ROPE_SEGS = 9, MAX_W = 80, ASH_N = 460;
const DECK_Z = 0.62, WEB_Z = 0.20, WALKABLE_RISE = 1.2;

let U = 40, SPAN_HALF = 4;
const wx = px => (px - W / 2) / U;
const wy = py => -(py - DECK_Y) / U;
const px_ = x => x * U + W / 2;
const py_ = y => -y * U + DECK_Y;

export const opts = {
  shadows: true,
  shake: true,
  cvdPalette: false,
  reducedMotion: false,
  showLoads: false,
};

const LOOK = new THREE.Vector3(0, -0.75, 0);
const CAM_Y = 3.1;
let camMode = 'play', camT = 0, shakeT = 0, wind = 0, windT = 0;

/* ------------------------------- palettes --------------------------------- */
const srgb = (r, g, b) => [r, g, b].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
const _col = new THREE.Color();

// Default: timber brown → amber → hot red.
// CVD: blue → pale → yellow, which stays separable under red-green deficiency
// and also ramps luminance, so it reads even in greyscale.
function stressColour(s){
  const k = Math.min(1, Math.max(0, s));
  if (opts.cvdPalette){
    return k < 0.5
      ? _col.setRGB(...srgb(66 + 150 * k / 0.5, 96 + 130 * k / 0.5, 148 + 90 * k / 0.5))
      : _col.setRGB(...srgb(216 + 39 * (k - 0.5) / 0.5, 226 - 22 * (k - 0.5) / 0.5, 238 - 200 * (k - 0.5) / 0.5));
  }
  return k < 0.55
    ? _col.setRGB(...srgb(168 + 33 * k / 0.55, 118 - 4 * k / 0.55, 62 - 14 * k / 0.55))
    : _col.setRGB(...srgb(201 + 34 * (k - 0.55) / 0.45, 114 - 45 * (k - 0.55) / 0.45, 48 - 8 * (k - 0.55) / 0.45));
}
export const restColour = () => opts.cvdPalette ? '#4a6a9a' : '#a8763e';

/* --------------------------------- setup ---------------------------------- */
export function init(cv, sim){
  canvas = cv; SIM = sim; S = sim.S;
  CELL = sim.CELL; W = sim.W; DECK_Y = sim.DECK_Y;
  LEFT_EDGE = sim.LEFT_EDGE; RIGHT_EDGE = sim.RIGHT_EDGE;
  U = CELL; SPAN_HALF = (RIGHT_EDGE - LEFT_EDGE) / 2 / U;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2f3a45, 22, 78);
  camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 400);

  buildLights();
  buildSky();
  buildTerrain();
  buildStructure();
  buildWalkers();
  buildOverlay();
  buildAsh();
  resize();
  return { scene, camera, renderer, THREE };
}

function buildLights(){
  scene.add(new THREE.HemisphereLight(0x8fa6b8, 0x141a20, 1.05));
  key = new THREE.DirectionalLight(0xffb37a, 2.5);
  key.position.set(-15, 9, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -16; key.shadow.camera.right = 16;
  key.shadow.camera.top = 12;   key.shadow.camera.bottom = -14;
  key.shadow.camera.near = 1;   key.shadow.camera.far = 60;
  key.shadow.bias = -0.0012; key.shadow.normalBias = 0.02;
  scene.add(key);

  rim = new THREE.DirectionalLight(0x6f92b5, 0.75);
  rim.position.set(9, 5, -12);
  scene.add(rim);

  emberLight = new THREE.PointLight(0xff5f26, 26, 46, 2.0);
  emberLight.position.set(-17, 3.4, -9);
  scene.add(emberLight);
}

function buildSky(){
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, '#161f2a'); grad.addColorStop(0.34, '#33414e');
  grad.addColorStop(0.62, '#6d7a85'); grad.addColorStop(0.84, '#9c9789');
  grad.addColorStop(1.00, '#6d6357');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);

  const glow = g.createRadialGradient(70, 400, 5, 70, 400, 300);
  glow.addColorStop(0, 'rgba(255,120,52,0.62)');
  glow.addColorStop(0.35, 'rgba(214,84,40,0.24)');
  glow.addColorStop(1, 'rgba(214,84,40,0)');
  g.fillStyle = glow; g.fillRect(0, 120, 460, 392);

  g.globalAlpha = 0.30; g.fillStyle = '#1b232c';
  for (let i = 0; i < 6; i++){
    const bx = 18 + i * 27;
    g.beginPath(); g.moveTo(bx - 7, 420);
    g.quadraticCurveTo(bx - 20, 300, bx - 4, 150);
    g.lineTo(bx + 12, 150);
    g.quadraticCurveTo(bx + 22, 302, bx + 9, 420);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(190, 108),
    new THREE.MeshBasicMaterial({ map: t, fog: false, depthWrite: false }));
  backdrop.position.set(-6, 8, -62);
  scene.add(backdrop);
}

function rng(seed){
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function cliff(side, depth, zPos, colour, seed, casts){
  const r = rng(seed), sh = new THREE.Shape();
  const lip = side < 0 ? wx(LEFT_EDGE) : wx(RIGHT_EDGE);
  const out = side < 0 ? -30 : 30;
  sh.moveTo(out, 0); sh.lineTo(lip, 0);
  let x = lip;
  for (let y = -0.4; y > -17; y -= 1.15){ x += side * (0.10 + r() * 0.55); sh.lineTo(x, y); }
  sh.lineTo(out, -18); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: colour, roughness: 0.98, metalness: 0, flatShading: true }));
  m.position.z = zPos; m.receiveShadow = true;
  if (casts) m.castShadow = true;
  return m;
}

function buildTerrain(){
  scene.add(cliff(-1, 3.2, 1.1, 0x2b333c, 7, true));
  scene.add(cliff( 1, 3.2, 1.1, 0x2b333c, 13, true));
  scene.add(cliff(-1, 5.0, -3.4, 0x222a33, 21, false));
  scene.add(cliff( 1, 5.0, -3.4, 0x222a33, 29, false));
  scene.add(cliff(-1, 7.0, -10.5, 0x1a212a, 33, false));
  scene.add(cliff( 1, 7.0, -10.5, 0x1a212a, 41, false));

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 60),
    new THREE.MeshBasicMaterial({ color: 0x05070a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -19, -6);
  scene.add(floor);

  for (let i = 0; i < 3; i++){
    const r = rng(101 + i * 17), sh = new THREE.Shape();
    sh.moveTo(-70, -30);
    for (let x = -70; x <= 70; x += 6) sh.lineTo(x, 1 + Math.sin(x * 0.09 + i) * 1.6 + r() * 2.4 - i * 1.1);
    sh.lineTo(70, -30); sh.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh),
      new THREE.MeshBasicMaterial({ color: [0x46525e, 0x3a4550, 0x2f3a44][i], fog: true }));
    m.position.set(0, 1.4 + i * 0.5, -46 + i * 9);
    scene.add(m);
  }

  // mist
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const rad = g.createRadialGradient(128, 128, 8, 128, 128, 126);
  rad.addColorStop(0, 'rgba(150,170,186,0.30)');
  rad.addColorStop(0.55, 'rgba(140,162,180,0.11)');
  rad.addColorStop(1, 'rgba(140,162,180,0)');
  g.fillStyle = rad; g.fillRect(0, 0, 256, 256);
  const mistTex = new THREE.CanvasTexture(cv);
  for (let i = 0; i < 8; i++){
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(18 + Math.random() * 14, 4 + Math.random() * 3),
      new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false,
        opacity: 0.10 + Math.random() * 0.10, fog: true }));
    m.position.set((Math.random() - 0.5) * 20, -5.5 - Math.random() * 10, -8 + Math.random() * 10);
    m.userData = { sp: 0.10 + Math.random() * 0.24, ph: Math.random() * 6.28, x0: m.position.x };
    mist.push(m); scene.add(m);
  }

  // Braziers on both lips. Warm local anchors for the eye, and they make the
  // crossing look like something people prepared for.
  for (const side of [-1, 1]){
    const x = side < 0 ? wx(LEFT_EDGE) - 1.5 : wx(RIGHT_EDGE) + 1.5;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 }));
    post.position.set(x, 0.75, 0.5); post.castShadow = true; scene.add(post);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.15, 0.24, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3129, roughness: 0.8, metalness: 0.3 }));
    bowl.position.set(x, 1.6, 0.5); bowl.castShadow = true; scene.add(bowl);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff9440, transparent: true, opacity: 0.92, fog: false }));
    flame.position.set(x, 1.78, 0.5); scene.add(flame);
    const lt = new THREE.PointLight(0xff8a3c, 6, 9, 2);
    lt.position.set(x, 1.9, 0.5); scene.add(lt);
    braziers.push({ flame, lt, ph: Math.random() * 6.28 });
  }
}

/* --------------------------------- ash ------------------------------------ */
function buildAsh(){
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const rad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rad.addColorStop(0, 'rgba(255,236,214,1)');
  rad.addColorStop(0.4, 'rgba(255,190,130,0.6)');
  rad.addColorStop(1, 'rgba(255,170,110,0)');
  g.fillStyle = rad; g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);

  const pos = new Float32Array(ASH_N * 3), col = new Float32Array(ASH_N * 3);
  ashData = [];
  for (let i = 0; i < ASH_N; i++){
    const d = { x: (Math.random() - 0.5) * 46, y: Math.random() * 22 - 4,
                z: -14 + Math.random() * 20,
                vy: -0.16 - Math.random() * 0.34, ph: Math.random() * 6.28,
                sw: 0.3 + Math.random() * 0.9,
                hot: Math.random() < 0.22 };           // a few are still embers
    ashData.push(d);
    pos[i*3] = d.x; pos[i*3+1] = d.y; pos[i*3+2] = d.z;
    const c = d.hot ? [1.0, 0.52, 0.20] : [0.62, 0.64, 0.66];
    col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ash = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.075, map: tex, transparent: true, depthWrite: false,
    vertexColors: true, blending: THREE.AdditiveBlending, opacity: 0.75, fog: true,
    sizeAttenuation: true }));
  ash.frustumCulled = false;
  scene.add(ash);
}

function stepAsh(dt){
  const p = ash.geometry.attributes.position.array;
  for (let i = 0; i < ASH_N; i++){
    const d = ashData[i];
    d.y += d.vy * dt;
    d.x += (wind * 1.5 + Math.sin(d.ph + performance.now() * 0.0004 * d.sw) * 0.4) * dt;
    d.ph += dt * 0.6;
    if (d.y < -18){ d.y = 20 + Math.random() * 4; d.x = (Math.random() - 0.5) * 46; }
    if (d.x > 26) d.x = -26; else if (d.x < -26) d.x = 26;
    p[i*3] = d.x; p[i*3+1] = d.y; p[i*3+2] = d.z;
  }
  ash.geometry.attributes.position.needsUpdate = true;
}

/* ------------------------------- structure -------------------------------- */
function buildStructure(){
  timber = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, flatShading: true }), MAX_MEMBERS);
  rope = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 5),
    new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), MAX_MEMBERS * ROPE_SEGS);
  joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a361f, roughness: 0.7 }), MAX_MEMBERS);
  anchors = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.17, 0.72, 8),
    new THREE.MeshStandardMaterial({ color: 0x555c63, roughness: 0.55, metalness: 0.65 }), 16);
  for (const m of [timber, rope, joints, anchors]){
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.frustumCulled = false;
    scene.add(m);
  }
  timber.receiveShadow = true;
}

/* Articulated figures. Each limb is its own instanced mesh whose geometry is
   shifted so the pivot (shoulder / hip) sits at the origin — then posing a limb
   is just position + a rotation about Z. */
const LIMB = { leg: 0.21, arm: 0.18, torso: 0.25, headR: 0.075, limbR: 0.037 };
const HIP = 0.23, SHOULDER = 0.455, HEAD_Y = 0.545;   // heights above the feet

function buildWalkers(){
  const mat = new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: 1 });
  const pivoted = (len, r) => {
    const g = new THREE.CapsuleGeometry(r, len, 2, 6);
    g.translate(0, -len / 2 - r, 0);          // origin at the top cap = the joint
    return g;
  };
  bodies = new THREE.InstancedMesh(pivoted(LIMB.torso, 0.088), mat, MAX_W);
  heads  = new THREE.InstancedMesh(new THREE.SphereGeometry(LIMB.headR, 7, 6), mat, MAX_W);
  packs  = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), mat, MAX_W);
  armL   = new THREE.InstancedMesh(pivoted(LIMB.arm, LIMB.limbR), mat, MAX_W);
  armR   = new THREE.InstancedMesh(pivoted(LIMB.arm, LIMB.limbR), mat, MAX_W);
  legL   = new THREE.InstancedMesh(pivoted(LIMB.leg, LIMB.limbR * 1.15), mat, MAX_W);
  legR   = new THREE.InstancedMesh(pivoted(LIMB.leg, LIMB.limbR * 1.15), mat, MAX_W);
  limbs = [bodies, heads, packs, armL, armR, legL, legR];
  for (const m of limbs){
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.frustumCulled = false;
    scene.add(m);
  }
}

function buildOverlay(){
  const v = [];
  const x0 = wx(LEFT_EDGE) - 3.4, x1 = wx(RIGHT_EDGE) + 3.4;
  for (let x = Math.ceil(x0); x <= x1; x++) v.push(x, 0.02, 0, x, 5.2, 0);
  for (let y = 0; y <= 5; y++) v.push(x0, y + 0.02, 0, x1, y + 0.02, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0x9fb4c2, transparent: true, opacity: 0.10, fog: false }));
  scene.add(grid);

  ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xd8a866, transparent: true, opacity: 0.62, fog: false }));
  ghost.visible = false; ghost.matrixAutoUpdate = false; scene.add(ghost);

  snapRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0xe8e2d6, transparent: true, opacity: 0.85, fog: false }));
  snapRing.visible = false; scene.add(snapRing);
}

/* ------------------------------ frame update ------------------------------ */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(),
      _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(),
      _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0),
      _xa = new THREE.Vector3(1, 0, 0), _za = new THREE.Vector3(0, 0, 1);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function spanMatrix(ax, ay, bx, by, thick, depth, axis){
  _a.set(ax, ay, 0); _b.set(bx, by, 0);
  _d.subVectors(_b, _a);
  const len = _d.length() || 1e-5;
  _p.addVectors(_a, _b).multiplyScalar(0.5);
  _d.normalize();
  if (axis === 'y'){ _q.setFromUnitVectors(_up, _d); _s.set(1, len, 1); }
  else { _q.setFromUnitVectors(_xa, _d); _s.set(len, thick, depth); }
  return _m.compose(_p, _q, _s);
}

function syncStructure(){
  let ti = 0, ri = 0, ji = 0, ai = 0;
  for (const l of S.links){
    const a = S.points[l.a], b = S.points[l.b];
    const ax = wx(a.x), ay = wy(a.y), bx = wx(b.x), by = wy(b.y);
    if (l.type === 'beam'){
      if (ti >= MAX_MEMBERS) continue;
      // The slope rule that decides walkability also decides the look: shallow
      // members are decking, steep ones are bracing.
      const deckish = Math.abs(b.y - a.y) <= Math.abs(b.x - a.x) * WALKABLE_RISE;
      timber.setMatrixAt(ti, spanMatrix(ax, ay, bx, by,
        deckish ? 0.19 : 0.15, deckish ? DECK_Z : WEB_Z, 'x'));
      if (l.broken) _col.setRGB(0.055, 0.048, 0.042); else stressColour(l.stress);
      timber.setColorAt(ti, _col); ti++;
    } else {
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const slack = Math.max(0, l.rest - dist) / U;
      if (l.broken) _col.setRGB(0.05, 0.045, 0.04);
      else if (l.stress > 0.05) stressColour(Math.max(l.stress, 0.15));
      else _col.setRGB(...srgb(201, 179, 145));
      let x0 = ax, y0 = ay;
      const cx = (ax + bx) / 2 + wind * 0.25, cy = (ay + by) / 2 - slack * 1.5;
      for (let k = 1; k <= ROPE_SEGS; k++){
        if (ri >= MAX_MEMBERS * ROPE_SEGS) break;
        const t = k / ROPE_SEGS, mt = 1 - t;
        const x1 = mt * mt * ax + 2 * mt * t * cx + t * t * bx;
        const y1 = mt * mt * ay + 2 * mt * t * cy + t * t * by;
        rope.setMatrixAt(ri, spanMatrix(x0, y0, x1, y1, 1, 1, 'y'));
        rope.setColorAt(ri, _col); ri++; x0 = x1; y0 = y1;
      }
    }
  }
  for (const p of S.points){
    if (p.pinned){
      if (ai < 16){ _q.setFromAxisAngle(_xa, Math.PI / 2);
        anchors.setMatrixAt(ai++, _m.compose(_p.set(wx(p.x), wy(p.y), 0), _q, _s.set(1, 1, 1))); }
    } else if (ji < MAX_MEMBERS){
      joints.setMatrixAt(ji++, _m.compose(_p.set(wx(p.x), wy(p.y), 0), _q.identity(), _s.set(1, 1, 1)));
    }
  }
  timber.count = ti; rope.count = ri; joints.count = ji; anchors.count = ai;
  for (const m of [timber, rope, joints, anchors]) m.instanceMatrix.needsUpdate = true;
  if (timber.instanceColor) timber.instanceColor.needsUpdate = true;
  if (rope.instanceColor) rope.instanceColor.needsUpdate = true;
}

function poseLimb(mesh, n, x, y, angle, sc){
  _q.setFromAxisAngle(_za, angle);
  mesh.setMatrixAt(n, _m.compose(_p.set(x, y, 0), _q, _s.set(sc, sc, sc)));
}

function syncWalkers(){
  let n = 0;
  const r = SIM.WALKER_R / U;
  for (const w of S.walkers){
    if (w.safe || n >= MAX_W) continue;
    const sc = w.child ? 0.68 : 1;
    const x = wx(w.x);
    const feet = wy(w.y) - r;                     // collision circle sits on the deck

    // Gait is driven by distance covered, not by time, so nobody moonwalks when
    // the crowd bunches up or stalls.
    const gait = w.bob * 5.2 + w.phase;
    const moving = !w.fell && !w.stranded && Math.abs(w.vx) > 4;
    const swing = moving ? Math.sin(gait) * 0.62 : 0;
    const bounce = moving && !opts.reducedMotion ? Math.abs(Math.cos(gait)) * 0.022 : 0;

    if (w.fell){
      // tumbling — splay everything and spin the whole figure
      const spin = w.bob * 3 + w.phase;
      const cx = x, cy = feet + 0.28 * sc;
      poseLimb(bodies, n, cx, cy + 0.25 * sc, spin, sc * w.bulk);
      poseLimb(heads,  n, cx + Math.sin(spin) * 0.1, cy + 0.33 * sc, 0, sc);
      poseLimb(armL,   n, cx, cy + 0.2 * sc, spin + 2.2, sc);
      poseLimb(armR,   n, cx, cy + 0.2 * sc, spin - 2.4, sc);
      poseLimb(legL,   n, cx, cy, spin + 0.9, sc);
      poseLimb(legR,   n, cx, cy, spin - 1.1, sc);
      packs.setMatrixAt(n, HIDE);
      n++; continue;
    }

    const hipY   = feet + (HIP + bounce) * sc;
    const shldrY = feet + (SHOULDER + bounce) * sc;
    const headY  = feet + (HEAD_Y + bounce) * sc;
    const lean   = w.stranded ? 0.10 : moving ? 0.07 : 0;

    // torso hangs down from the shoulders, so it pivots naturally with the lean
    poseLimb(bodies, n, x, shldrY, lean, sc * w.bulk);
    poseLimb(heads,  n, x + Math.sin(lean) * 0.09, headY, 0, sc);
    poseLimb(armL,   n, x, shldrY, lean - swing * 0.75, sc);
    poseLimb(armR,   n, x, shldrY, lean + swing * 0.75, sc);
    poseLimb(legL,   n, x, hipY,   swing, sc);
    poseLimb(legR,   n, x, hipY,  -swing, sc);
    if (w.pack){
      _q.setFromAxisAngle(_za, lean);
      packs.setMatrixAt(n, _m.compose(
        _p.set(x - 0.11 * sc, shldrY - 0.09 * sc, -0.10), _q, _s.set(sc, sc * 1.3, sc * 0.8)));
    } else packs.setMatrixAt(n, HIDE);
    n++;
  }
  for (const m of limbs){ m.count = n; m.instanceMatrix.needsUpdate = true; }
}

/* --------------------------------- camera --------------------------------- */
export function setCameraMode(m){ camMode = m; }

export function resize(){
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const need = SPAN_HALF + 5.0;
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.z = Math.max(11, need / (half * camera.aspect));
  camera.position.y = CAM_Y;
  camera.updateProjectionMatrix();
  camera.lookAt(LOOK);
}

/* -------------------------------- overlay --------------------------------- */
export function syncOverlay(hover, building){
  grid.visible = building && !!hover;
  ghost.visible = false; snapRing.visible = false;
  if (!building || !hover) return null;

  if (!S.drag){
    const i = SIM.findPoint(hover[0], hover[1]);
    if (i >= 0){ const p = S.points[i]; snapRing.position.set(wx(p.x), wy(p.y), 0); snapRing.visible = true; }
    return null;
  }
  const pr = SIM.proposal(hover[0], hover[1]);
  if (!pr) return null;
  const a = S.points[pr.from], ok = !pr.bad;
  ghost.material.color.set(ok ? (S.tool === 'rope' ? 0xc9b391 : 0xd8a866) : 0xd4552a);
  ghost.material.opacity = ok ? 0.62 : 0.4;
  ghost.matrix.copy(spanMatrix(wx(a.x), wy(a.y), wx(pr.tx), wy(pr.ty),
    S.tool === 'rope' ? 0.09 : 0.19, S.tool === 'rope' ? 0.09 : DECK_Z, 'x'));
  ghost.visible = true;
  const mid = new THREE.Vector3((wx(a.x) + wx(pr.tx)) / 2, (wy(a.y) + wy(pr.ty)) / 2 + 0.45, 0).project(camera);
  return { pr, ok, sx: (mid.x * 0.5 + 0.5) * innerWidth, sy: (-mid.y * 0.5 + 0.5) * innerHeight };
}

/** Screen position of a sim point, for anchoring tutorial callouts. */
export function screenOf(simX, simY){
  const v = new THREE.Vector3(wx(simX), wy(simY), 0).project(camera);
  return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
}

export function simFromPointer(clientX, clientY){
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - r.left) / r.width) * 2 - 1,
    -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit)) return null;
  return [px_(hit.x), py_(hit.y)];
}

/* ---------------------------------- draw ---------------------------------- */
export function applyOptions(){
  renderer.shadowMap.enabled = opts.shadows;
  key.castShadow = opts.shadows;
  scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
}

export function frame(dt){
  const t = performance.now() * 0.001;

  windT += dt * 0.21;
  wind = Math.sin(windT) * Math.sin(windT * 0.37 + 1.1);

  if (camMode === 'title'){
    camT += dt * (opts.reducedMotion ? 0 : 1);
    camera.position.x = Math.sin(camT * 0.11) * 2.6;
    camera.position.y = CAM_Y + 0.5 + Math.sin(camT * 0.07) * 0.5;
    camera.lookAt(LOOK.x, LOOK.y + 0.4, LOOK.z);
  } else if (opts.shake && S.shake > 0.3){
    shakeT += 0.1;
    camera.position.x = Math.sin(shakeT * 7.3) * S.shake * 0.012;
    camera.position.y = CAM_Y + Math.cos(shakeT * 9.1) * S.shake * 0.010;
    camera.lookAt(LOOK);
  } else {
    camera.position.x *= 0.85;
    camera.position.y += (CAM_Y - camera.position.y) * 0.15;
    camera.lookAt(LOOK);
  }

  if (!opts.reducedMotion){
    for (const m of mist){
      m.position.x = m.userData.x0 + Math.sin(t * m.userData.sp + m.userData.ph) * 5.5 + wind * 1.2;
      m.lookAt(camera.position);
    }
    stepAsh(dt);
    for (const b of braziers){
      const f = 0.78 + Math.sin(t * 9 + b.ph) * 0.12 + Math.sin(t * 23.7 + b.ph) * 0.08;
      b.flame.scale.setScalar(f);
      b.lt.intensity = 5 + f * 3;
    }
    emberLight.intensity = 24 + Math.sin(t * 0.9) * 5;
  }
  ash.visible = !opts.reducedMotion;

  syncStructure();
  syncWalkers();
  renderer.render(scene, camera);
}

export function peakStress(){
  let m = 0;
  for (const l of S.links) if (!l.broken && l.stress > m) m = l.stress;
  return m;
}
