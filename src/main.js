// SKYLOOP — original Rooms OS flying prototype (KOL-4209)
// Pattern reproduced from the public SUPERFLIGHT concept (character + flying
// controller + generated world + camera/post polish + objective), with all
// assets generated procedurally in code so there is zero licensing risk.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAudio } from './audio.js';

const audio = createAudio();

// ---------------------------------------------------------------- utilities

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 7);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const rand = (lo, hi) => lo + rng() * (hi - lo);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------ renderer/scene

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9a6e96, 0.00135);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 4000);
camera.position.set(0, 90, 200);

// Dusk gradient sky dome.
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1900, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x241a4f) },
      mid: { value: new THREE.Color(0x6f4d8c) },
      horizon: { value: new THREE.Color(0xff9d76) },
      below: { value: new THREE.Color(0x33264a) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h < 0.0
          ? mix(horizon, below, smoothstep(0.0, -0.45, h))
          : h < 0.25
            ? mix(horizon, mid, smoothstep(0.0, 0.25, h))
            : mix(mid, zenith, smoothstep(0.25, 0.9, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
scene.add(sky);

scene.add(new THREE.HemisphereLight(0xcdb4ff, 0x3a2c4f, 0.85));
const sun = new THREE.DirectionalLight(0xffd9b0, 2.0);
sun.position.set(-500, 420, -900);
scene.add(sun);

const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture('rgba(255,236,200,1)', 'rgba(255,160,90,0.55)'),
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
sunSprite.position.set(-700, 540, -1500);
sunSprite.scale.setScalar(560);
scene.add(sunSprite);

// ---------------------------------------------------------------- the world
// "Aurora Shoals" — a procedural, World Labs-style dreamscape of floating
// islands. Seeded so every run with the same ?seed= is identical.

const world = new THREE.Group();
scene.add(world);

const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d5a7a, flatShading: true, roughness: 0.95 });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x7fd6a8, flatShading: true, roughness: 0.9 });
const crystalMat = new THREE.MeshStandardMaterial({
  color: 0x9ae8ff, emissive: 0x4fd8ff, emissiveIntensity: 0.9, flatShading: true, roughness: 0.3,
});
const towerMat = new THREE.MeshStandardMaterial({ color: 0xf2e3c9, flatShading: true, roughness: 0.85 });
const windowMat = new THREE.MeshStandardMaterial({
  color: 0xffc887, emissive: 0xffa040, emissiveIntensity: 1.4, roughness: 0.6,
});
const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f78, flatShading: true, roughness: 0.95 });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x70513e, flatShading: true, roughness: 1 });

function jitterVertices(geo, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (rng() - 0.5) * amount,
      pos.getY(i) + (rng() - 0.5) * amount,
      pos.getZ(i) + (rng() - 0.5) * amount
    );
  }
  geo.computeVertexNormals();
  return geo;
}

function makeIsland(radius, bare = false) {
  const island = new THREE.Group();

  const rock = new THREE.Mesh(
    jitterVertices(new THREE.ConeGeometry(radius, radius * 1.7, 8, 3), radius * 0.12),
    rockMat
  );
  rock.rotation.x = Math.PI;
  rock.position.y = -radius * 0.85;
  island.add(rock);

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 0.94, radius * 0.16, 9),
    grassMat
  );
  island.add(top);

  const kind = pick(['crystal', 'town', 'grove', 'crystal', 'grove']);
  const features = bare ? 0 : Math.floor(rand(2, 6));
  for (let i = 0; i < features; i++) {
    const fx = rand(-0.55, 0.55) * radius;
    const fz = rand(-0.55, 0.55) * radius;
    if (kind === 'crystal') {
      const h = rand(2.5, 7) * (radius / 14);
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(h * 0.22, h, 5), crystalMat);
      crystal.position.set(fx, h * 0.5, fz);
      crystal.rotation.set(rand(-0.2, 0.2), rand(0, Math.PI), rand(-0.2, 0.2));
      island.add(crystal);
    } else if (kind === 'town') {
      const w = rand(1.6, 3.2) * (radius / 14);
      const h = rand(3, 11) * (radius / 14);
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat);
      block.position.set(fx, h * 0.5, fz);
      block.rotation.y = rand(0, Math.PI);
      island.add(block);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, h * 0.7, w * 0.18), windowMat);
      strip.position.set(fx, h * 0.5, fz + w * 0.48);
      strip.rotation.y = block.rotation.y;
      island.add(strip);
    } else {
      const h = rand(2, 4.5) * (radius / 14);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.07, h * 0.1, h * 0.5, 5), trunkMat);
      trunk.position.set(fx, h * 0.25, fz);
      island.add(trunk);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(h * 0.4, h, 6), treeMat);
      crown.position.set(fx, h * 0.5 + h * 0.45, fz);
      island.add(crown);
    }
  }
  return island;
}

for (let i = 0; i < 34; i++) {
  const radius = rand(8, 26);
  const angle = rand(0, Math.PI * 2);
  const dist = rand(80, 540);
  const island = makeIsland(radius);
  island.position.set(Math.cos(angle) * dist, rand(25, 175), Math.sin(angle) * dist);
  island.rotation.y = rand(0, Math.PI * 2);
  world.add(island);
}

// Central beacon island — the visual anchor of the course, now a small city
// (the source author's "larger city" improvement, done procedurally).
const hubIsland = makeIsland(34, true);
hubIsland.position.set(0, 48, 0);
world.add(hubIsland);
for (let i = 0; i < 18; i++) {
  const w = rand(2.4, 5);
  const h = rand(6, 26);
  const a = rand(0, Math.PI * 2);
  const d = rand(6, 26);
  const x = Math.cos(a) * d;
  const z = Math.sin(a) * d;
  const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat);
  block.position.set(x, 48 + h * 0.5, z);
  block.rotation.y = rand(0, Math.PI);
  world.add(block);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, h * 0.75, w * 0.16), windowMat);
  strip.position.set(x, 48 + h * 0.5, z);
  strip.rotation.y = block.rotation.y;
  strip.translateZ(w * 0.48);
  world.add(strip);
}
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 26, 7), towerMat);
beacon.position.set(0, 61, 0);
world.add(beacon);
const beaconTip = new THREE.Mesh(
  new THREE.SphereGeometry(2.6, 12, 12),
  new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffc36b, emissiveIntensity: 2.4 })
);
beaconTip.position.set(0, 75.5, 0);
world.add(beaconTip);

// Sea far below.
const sea = new THREE.Mesh(
  new THREE.CircleGeometry(1700, 48),
  new THREE.MeshStandardMaterial({ color: 0x16314f, roughness: 0.55, metalness: 0.25 })
);
sea.rotation.x = -Math.PI / 2;
sea.position.y = -42;
world.add(sea);

// Drifting cloud field (one instanced mesh = one draw call).
const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xfff4ec, transparent: true, opacity: 0.8 });
const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 80);
{
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < 80; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(60, 760);
    p.set(Math.cos(angle) * dist, rand(15, 270), Math.sin(angle) * dist);
    q.setFromEuler(new THREE.Euler(0, rand(0, Math.PI), 0));
    s.set(rand(7, 18), rand(2.2, 4.5), rand(7, 18));
    m.compose(p, q, s);
    clouds.setMatrixAt(i, m);
  }
}
scene.add(clouds);

// ----------------------------------------------------------------- the hero
// "Drift" — an original, generated low-poly flying hero. Indigo-teal suit,
// amber cape, cyan visor. Built head-first along -Z (the flight direction).
// A licensed GLB (Fab / Mixamo / CC0 pack) can replace this via ?model=<url>
// — see PIPELINE.md for the Unreal/Fab-to-web route.

const hero = new THREE.Group();
scene.add(hero);
const heroPose = new THREE.Group(); // banking roll + nose tilt apply here, so GLB swaps inherit them
hero.add(heroPose);
const heroVisual = new THREE.Group();
heroVisual.scale.setScalar(1.35);
heroPose.add(heroVisual);

const suitMat = new THREE.MeshStandardMaterial({ color: 0x14495c, roughness: 0.55, metalness: 0.15 });
const accentMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
const visorMat = new THREE.MeshStandardMaterial({
  color: 0x66f2ff, emissive: 0x4fe8ff, emissiveIntensity: 2.2, roughness: 0.2,
});
const capeMat = new THREE.MeshStandardMaterial({
  color: 0xff9a3d, emissive: 0xb35a14, emissiveIntensity: 0.28,
  side: THREE.DoubleSide, roughness: 0.8,
});
const thrustMat = new THREE.MeshStandardMaterial({
  color: 0xaef6ff, emissive: 0x5fe8ff, emissiveIntensity: 2.6,
});

{
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.78, 6, 12), suitMat);
  torso.rotation.x = Math.PI / 2;
  heroVisual.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), suitMat);
  head.position.set(0, 0.04, -0.86);
  heroVisual.add(head);

  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0.9, 0.7), visorMat);
  visor.position.copy(head.position);
  visor.rotation.x = Math.PI / 2;
  heroVisual.add(visor);

  // Arms swept back along the body, fists by the hips — a diver's pose.
  for (const sideX of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.62, 4, 8), suitMat);
    arm.position.set(sideX * 0.42, 0.02, 0.12);
    arm.rotation.x = Math.PI / 2;
    arm.rotation.z = sideX * -0.14;
    heroVisual.add(arm);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), accentMat);
    fist.position.set(sideX * 0.46, 0.0, 0.56);
    heroVisual.add(fist);
  }

  // Legs together, boots ending in thruster cones.
  for (const sideX of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.7, 4, 8), suitMat);
    leg.position.set(sideX, -0.02, 0.95);
    leg.rotation.x = Math.PI / 2;
    heroVisual.add(leg);
    const boot = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 8), thrustMat);
    boot.position.set(sideX, -0.02, 1.42);
    boot.rotation.x = -Math.PI / 2;
    heroVisual.add(boot);
  }

  // Back spine glow — reads nicely from the chase camera.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.7), visorMat);
  spine.position.set(0, 0.36, 0.05);
  heroVisual.add(spine);
}

// Cape — vertex-animated cloth ribbon.
const capeGeo = new THREE.PlaneGeometry(1.35, 2.3, 10, 14);
capeGeo.rotateX(Math.PI / 2);
capeGeo.translate(0, 0, 1.15);
const capeBase = capeGeo.attributes.position.array.slice();
const cape = new THREE.Mesh(capeGeo, capeMat);
cape.position.set(0, 0.3, 0.15);
heroVisual.add(cape);

// Boost glow sprite behind the boots.
const boostGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture('rgba(170,250,255,1)', 'rgba(90,200,255,0.5)'),
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
boostGlow.position.set(0, 0, 1.8);
boostGlow.scale.setScalar(0.001);
heroVisual.add(boostGlow);

// Optional licensed character swap-in (exercises the Fab/GLB pipeline).
// Try it: ?model=./assets/fox.glb (CC0 Khronos sample — see assets/FOX-LICENCE.md).
// The model is auto-centred and auto-scaled, and its first fly/run/walk
// animation clip plays. ?modelRotY=<degrees> corrects facing (default 180,
// since glTF characters face +Z and the controller flies along -Z).
const modelUrl = params.get('model');
let mixer = null;
if (modelUrl) {
  new GLTFLoader().load(modelUrl, (gltf) => {
    heroVisual.visible = false;
    const g = gltf.scene;
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    g.position.sub(centre);
    const holder = new THREE.Group();
    holder.scale.setScalar(3.2 / Math.max(size.x, size.y, size.z));
    holder.rotation.y = THREE.MathUtils.degToRad(Number(params.get('modelRotY') ?? 180));
    holder.add(g);
    heroPose.add(holder);
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(g);
      const clip = gltf.animations.find((a) => /fly|run|walk/i.test(a.name)) || gltf.animations[0];
      mixer.clipAction(clip).play();
    }
    window.__sky.modelLoaded = true;
  }, undefined, (err) => console.error('model load failed:', err));
}

// Fading light trail (vertex-coloured additive points).
const TRAIL_N = 130;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
  size: 1.1, vertexColors: true, transparent: true,
  map: glowTexture('rgba(190,245,255,1)', 'rgba(100,200,255,0.45)'),
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
}));
trail.frustumCulled = false;
scene.add(trail);

// Collect-burst particles.
const BURST_N = 70;
const burstPos = new Float32Array(BURST_N * 3);
const burstVel = [];
const burstGeo = new THREE.BufferGeometry();
burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
const burst = new THREE.Points(burstGeo, new THREE.PointsMaterial({
  size: 1.1, color: 0xffc36b, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
burst.frustumCulled = false;
scene.add(burst);
let burstLife = 0;

function fireBurst(centre) {
  for (let i = 0; i < BURST_N; i++) {
    burstPos[i * 3] = centre.x;
    burstPos[i * 3 + 1] = centre.y;
    burstPos[i * 3 + 2] = centre.z;
    burstVel[i] = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 26));
  }
  burstGeo.attributes.position.needsUpdate = true;
  burstLife = 1;
}

// ------------------------------------------------------------ the objective
// Twelve sky rings laid out as a rough circuit. Fly through all of them.

const RING_COUNT = 12;
const rings = [];
const ringGlowTex = glowTexture('rgba(255,210,140,0.9)', 'rgba(255,160,60,0.35)');

for (let i = 0; i < RING_COUNT; i++) {
  const angle = (i / RING_COUNT) * Math.PI * 2 + rand(-0.18, 0.18);
  const dist = rand(130, 420);
  const group = new THREE.Group();
  group.position.set(Math.cos(angle) * dist, rand(45, 195), Math.sin(angle) * dist);

  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(6, 0.55, 12, 40),
    new THREE.MeshStandardMaterial({
      color: 0xffc36b, emissive: 0xff9a2e, emissiveIntensity: 1.9, roughness: 0.35,
    })
  );
  torus.lookAt(0, group.position.y, 0); // face the beacon so the course flows
  group.add(torus);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ringGlowTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
  }));
  glow.scale.setScalar(17);
  group.add(glow);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.3, 320, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd28a, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  beam.position.y = -160;
  group.add(beam);

  scene.add(group);
  rings.push({ group, torus, glow, collected: false, phase: rand(0, Math.PI * 2), baseY: group.position.y });
}

// ----------------------------------------------------------- post-processing

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  samples: 4, type: THREE.HalfFloatType,
}));
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.62);
composer.addPass(bloom);

const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.032 },
    vignette: { value: 0.34 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time; uniform float grain; uniform float vignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float n = hash(vUv * (1.0 + fract(time)) * 1000.0) * 2.0 - 1.0;
      col.rgb += n * grain;
      float d = distance(vUv, vec2(0.5));
      col.rgb *= 1.0 - smoothstep(0.3, 0.85, d * 1.05) * vignette;
      gl_FragColor = col;
    }`,
};
const grainPass = new ShaderPass(GrainVignetteShader);
composer.addPass(grainPass);
composer.addPass(new OutputPass());

// -------------------------------------------------------------------- input

const keys = new Set();
let launched = false;
let wasBoosting = false;

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { const m = audio.toggleMute(); ui.boost.textContent = m ? 'MUTED' : 'BOOST'; return; }
  if (!launched) {
    launched = true;
    document.getElementById('start').classList.add('hidden');
    state.t0 = performance.now();
    audio.resume();
    audio.startAmbient();
    return;
  }
  if (e.code === 'KeyR') resetGame();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));

// ----------------------------------------------------------------- game state

const state = {
  yaw: Math.PI,           // face the beacon from the spawn point
  pitch: 0,
  roll: 0,
  speed: 30,
  t0: 0,
  elapsed: 0,
  collected: 0,
  score: 0,
  combo: 0,
  lastCollect: 0,
  finished: false,
  shake: 0,
  trailHead: 0,
};
hero.position.set(0, 95, 230);

const BASE_SPEED = 30;
const BOOST_SPEED = 82;
const WORLD_RADIUS = 760;

function resetGame() {
  hero.position.set(0, 95, 230);
  state.yaw = Math.PI;
  state.pitch = 0;
  state.roll = 0;
  state.speed = BASE_SPEED;
  state.collected = 0;
  state.score = 0;
  state.combo = 0;
  state.lastCollect = 0;
  state.finished = false;
  state.t0 = performance.now();
  for (const r of rings) {
    r.collected = false;
    r.group.visible = true;
  }
  document.getElementById('win').classList.add('hidden');
  ui.rings.textContent = `0 / ${RING_COUNT}`;
  ui.score.textContent = '0';
  ui.combo.textContent = '—';
}

// ---------------------------------------------------------------------- HUD

const ui = {
  rings: document.getElementById('rings'),
  score: document.getElementById('score'),
  combo: document.getElementById('combo'),
  time: document.getElementById('time'),
  best: document.getElementById('best'),
  fill: document.getElementById('speedfill'),
  boost: document.getElementById('boostlabel'),
  marker: document.getElementById('marker'),
  markerDist: document.querySelector('#marker .dist'),
};

function fmtTime(ms) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

const storedBest = Number(localStorage.getItem('skyloop-best') || 0);
if (storedBest > 0) ui.best.textContent = fmtTime(storedBest);

function finishRun() {
  state.finished = true;
  const t = state.elapsed;
  const best = Number(localStorage.getItem('skyloop-best') || 0);
  if (!best || t < best) {
    localStorage.setItem('skyloop-best', String(t));
    ui.best.textContent = fmtTime(t);
    document.getElementById('winbest').textContent = 'NEW BEST TIME';
  } else {
    document.getElementById('winbest').textContent = `Best ${fmtTime(best)}`;
  }
  const bestScore = Number(localStorage.getItem('skyloop-best-score') || 0);
  if (state.score > bestScore) localStorage.setItem('skyloop-best-score', String(state.score));
  document.getElementById('winscore').textContent =
    `SCORE ${state.score}${state.score > bestScore ? ' — NEW BEST' : ` (best ${bestScore})`}`;
  document.getElementById('wintime').textContent = fmtTime(t);
  document.getElementById('win').classList.remove('hidden');
  audio.win();
}

// ---------------------------------------------------------------- main loop

const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const camOffset = new THREE.Vector3();
const camTargetPos = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const toCentre = new THREE.Vector3();
const ndc = new THREE.Vector3();
const trailSpawn = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // --- input → orientation
  const yawIn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const pitchIn = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const boosting = launched && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  if (boosting && !wasBoosting && !state.finished) audio.boost(); // rising edge whoosh
  wasBoosting = boosting;

  if (launched && !state.finished) {
    state.yaw += yawIn * 1.55 * dt;
    state.pitch = THREE.MathUtils.clamp(state.pitch + pitchIn * 1.15 * dt, -1.05, 1.05);
    if (!pitchIn) state.pitch = THREE.MathUtils.damp(state.pitch, 0, 0.9, dt); // gentle auto-level
  }
  state.roll = THREE.MathUtils.damp(state.roll, -yawIn * 0.85, 5, dt);

  // --- speed & motion
  const diveBonus = Math.max(0, -Math.sin(state.pitch)) * 18;
  const targetSpeed = (boosting ? BOOST_SPEED : BASE_SPEED) + diveBonus;
  state.speed = THREE.MathUtils.damp(state.speed, launched ? targetSpeed : 0, 2.4, dt);

  fwd.set(0, 0, -1).applyEuler(new THREE.Euler(state.pitch, state.yaw, 0, 'YXZ'));
  hero.position.addScaledVector(fwd, state.speed * dt);

  // Soft world bounds: nudge back toward the beacon.
  toCentre.set(-hero.position.x, 0, -hero.position.z);
  const horizDist = toCentre.length();
  if (horizDist > WORLD_RADIUS) {
    const desired = Math.atan2(toCentre.x / horizDist, toCentre.z / horizDist) + Math.PI;
    let dyaw = desired - state.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    state.yaw += dyaw * dt * 1.2;
  }
  hero.position.y = THREE.MathUtils.clamp(hero.position.y, -20, 420);

  hero.quaternion.setFromEuler(new THREE.Euler(state.pitch, state.yaw, 0, 'YXZ'));
  heroPose.rotation.z = state.roll;
  heroPose.rotation.x = pitchIn * 0.18;
  if (mixer) mixer.update(dt);

  // --- cape cloth
  const capePos = capeGeo.attributes.position;
  const flutter = 0.1 + (state.speed / BOOST_SPEED) * 0.22;
  for (let i = 0; i < capePos.count; i++) {
    const bx = capeBase[i * 3];
    const bz = capeBase[i * 3 + 2];
    const tail = bz / 2.3;
    capePos.setY(i,
      Math.sin(bz * 2.4 - t * 7) * flutter * tail +
      Math.sin(bx * 3.0 + t * 4.4) * flutter * 0.35 * tail +
      tail * tail * 0.5 // cape lifts as it trails
    );
  }
  capePos.needsUpdate = true;
  capeGeo.computeVertexNormals();

  // --- boost glow + trail
  const boostAmount = THREE.MathUtils.clamp((state.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED), 0, 1);
  boostGlow.scale.setScalar(0.001 + boostAmount * 1.4 + Math.sin(t * 31) * 0.1 * boostAmount);
  audio.setBoost(boostAmount);

  state.trailHead = (state.trailHead + 1) % TRAIL_N;
  trailSpawn.copy(hero.position).addScaledVector(fwd, -1.8); // just behind the boots
  trailPos[state.trailHead * 3] = trailSpawn.x;
  trailPos[state.trailHead * 3 + 1] = trailSpawn.y;
  trailPos[state.trailHead * 3 + 2] = trailSpawn.z;
  for (let i = 0; i < TRAIL_N; i++) {
    const age = ((state.trailHead - i + TRAIL_N) % TRAIL_N) / TRAIL_N;
    const k = (1 - age) * (0.12 + boostAmount * 0.88);
    trailCol[i * 3] = 0.45 * k;
    trailCol[i * 3 + 1] = 0.9 * k;
    trailCol[i * 3 + 2] = 1.0 * k;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;

  // --- burst particles
  if (burstLife > 0) {
    burstLife = Math.max(0, burstLife - dt * 1.4);
    for (let i = 0; i < BURST_N; i++) {
      burstPos[i * 3] += burstVel[i].x * dt;
      burstPos[i * 3 + 1] += burstVel[i].y * dt;
      burstPos[i * 3 + 2] += burstVel[i].z * dt;
    }
    burstGeo.attributes.position.needsUpdate = true;
    burst.material.opacity = burstLife;
  }

  // --- rings: animate, detect collection, drive the edge marker
  let nearest = null;
  let nearestDist = Infinity;
  for (const r of rings) {
    if (r.collected) continue;
    r.torus.rotation.z += dt * 0.6;
    r.group.position.y = r.baseY + Math.sin(t * 0.8 + r.phase) * 1.6;
    const d = hero.position.distanceTo(r.group.position);
    if (d < nearestDist) { nearestDist = d; nearest = r; }
    if (launched && !state.finished && d < 6.2) {
      r.collected = true;
      r.group.visible = false;
      state.collected += 1;
      const now = performance.now();
      state.combo = now - state.lastCollect < 8000 ? state.combo + 1 : 1;
      state.lastCollect = now;
      state.score += 100 * state.combo + (boosting ? 50 : 0);
      state.shake = Math.min(state.shake + 0.9, 1.4);
      fireBurst(r.group.position);
      audio.ring(state.combo);
      ui.rings.textContent = `${state.collected} / ${RING_COUNT}`;
      ui.score.textContent = String(state.score);
      ui.combo.textContent = state.combo > 1 ? `×${state.combo}` : '—';
      if (state.collected === RING_COUNT) finishRun();
    }
  }
  if (nearest) {
    nearest.glow.material.opacity = 0.75 + Math.sin(t * 5) * 0.25;
    ndc.copy(nearest.group.position).project(camera);
    const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 0.93 && Math.abs(ndc.y) < 0.9;
    const margin = 30;
    const x = THREE.MathUtils.clamp((ndc.x * 0.5 + 0.5) * innerWidth, margin, innerWidth - margin);
    const y = THREE.MathUtils.clamp((-ndc.y * 0.5 + 0.5) * innerHeight, margin + 40, innerHeight - margin - 40);
    ui.marker.style.display = launched && !state.finished ? 'block' : 'none';
    ui.marker.style.left = `${ndc.z > 1 ? innerWidth / 2 : x}px`;
    ui.marker.style.top = `${ndc.z > 1 ? margin + 40 : y}px`;
    ui.marker.style.opacity = onScreen ? '1' : '0.65';
    ui.markerDist.textContent = `${Math.round(nearestDist)} m`;
  } else {
    ui.marker.style.display = 'none';
  }

  // --- clouds drift
  clouds.rotation.y += dt * 0.0035;

  // --- camera: chase + zoom + shake
  const camDist = 9.5 + boostAmount * 3.0;
  camOffset.set(0, 2.6 + state.pitch * -1.2, camDist)
    .applyEuler(new THREE.Euler(state.pitch * 0.45, state.yaw, 0, 'YXZ'));
  camTargetPos.copy(hero.position).add(camOffset);
  const k = 1 - Math.exp(-6.5 * dt);
  camera.position.lerp(camTargetPos, k);

  state.shake = Math.max(0, state.shake - dt * 2.2);
  const shakeAmp = state.shake * 0.4 + boostAmount * 0.16;
  camera.position.x += (Math.random() - 0.5) * shakeAmp;
  camera.position.y += (Math.random() - 0.5) * shakeAmp;
  camera.position.z += (Math.random() - 0.5) * shakeAmp;

  lookTarget.copy(hero.position).addScaledVector(fwd, 14);
  lookTarget.y += 1.2;
  camera.lookAt(lookTarget);

  camera.fov = THREE.MathUtils.damp(camera.fov, 62 + boostAmount * 18, 5, dt);
  camera.updateProjectionMatrix();

  // --- post tuning + HUD
  grainPass.uniforms.time.value = t;
  grainPass.uniforms.grain.value = 0.032 + boostAmount * 0.04;
  bloom.strength = 0.85 + boostAmount * 0.35;

  if (launched && !state.finished) {
    state.elapsed = performance.now() - state.t0;
    ui.time.textContent = fmtTime(state.elapsed);
    if (state.combo > 1 && performance.now() - state.lastCollect > 8000) {
      state.combo = 1;
      ui.combo.textContent = '—';
    }
  }
  ui.fill.style.width = `${(state.speed / (BOOST_SPEED + 18)) * 100}%`;
  ui.boost.classList.toggle('on', boosting);

  composer.render();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

// Drive frames with requestAnimationFrame when visible; fall back to a timer
// when the tab is hidden so headless/preview verification still renders.
function loop() {
  animate();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(() => { if (document.hidden) animate(); }, 33);

// Debug/verification hook (used by the browser-verification step; harmless to keep).
window.__sky = {
  state, hero, rings, heroVisual, audio,
  modelLoaded: false,
  setPos(x, y, z) { hero.position.set(x, y, z); },
  nextRing() { return rings.find((r) => !r.collected)?.group.position.toArray(); },
};
