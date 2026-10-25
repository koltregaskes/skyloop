// SKYLOOP 2.0 — an original arcade sky-ring time attack (Three.js).
// Fly an endless procedural ring course, add time by passing rings, chain them
// for combo, manage boost, and chase a grade before the clock runs out.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { createAudio } from './audio.js';

const audio = createAudio();

// ------------------------------------------------------------- tuning knobs
const START_TIME = 22;          // seconds on the clock
const BASE_SPEED = 34;
const BOOST_SPEED = 92;
const RING_SPACING = 58;
const COLLECT_RADIUS = 6.6;
const AHEAD = 5;                 // rings kept visible ahead of the target
const WORLD_RADIUS = 720;
const BOOST_MAX = 1.0;
const BOOST_DRAIN = 0.42;        // per second while boosting
const BOOST_REGEN = 0.16;       // per second otherwise

// ---------------------------------------------------------------- utilities
const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 7);
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let rng = mulberry32(SEED);
const rand = (lo, hi) => lo + rng() * (hi - lo);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, inner); grad.addColorStop(0.4, outer); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// ------------------------------------------------------------ renderer/scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc7a3aa, 0.00085);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 4000);
camera.position.set(0, 90, 200);

// Lighting: cool hemisphere fill + warm key sun + a low warm rim to separate
// islands from the sky. The equirectangular panorama below also drives
// image-based lighting (scene.environment), which lifts every PBR material.
scene.add(new THREE.HemisphereLight(0xcdb4ff, 0x4a3a63, 0.7));
const sun = new THREE.DirectionalLight(0xffd9b0, 1.7); sun.position.set(-500, 420, -900); scene.add(sun);
const rim = new THREE.DirectionalLight(0xffc9a0, 0.6); rim.position.set(380, 130, 640); scene.add(rim);

// Generated equirectangular dusk sky panorama = the actual sky + IBL.
// Loaded from assets/manifest.json (skyPanorama) so a missing file never 404s;
// until it loads, a flat dusk colour stands in.
scene.background = new THREE.Color(0x2a1f4a);
const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
fetch('./assets/manifest.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('no manifest')))).then((m) => {
  if (!m.skyPanorama) return;
  new THREE.TextureLoader().load(`./assets/${m.skyPanorama}`, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.environment = pmrem.fromEquirectangular(tex).texture;
  });
}).catch(() => {});

// ---------------------------------------------------------------- the world
const world = new THREE.Group(); scene.add(world);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d5a7a, flatShading: true, roughness: 0.95 });
const grassMat = new THREE.MeshStandardMaterial({ color: 0x7fd6a8, flatShading: true, roughness: 0.9 });
const crystalMat = new THREE.MeshStandardMaterial({ color: 0x9ae8ff, emissive: 0x4fd8ff, emissiveIntensity: 0.9, flatShading: true, roughness: 0.3 });
const towerMat = new THREE.MeshStandardMaterial({ color: 0xf2e3c9, flatShading: true, roughness: 0.85 });
const windowMat = new THREE.MeshStandardMaterial({ color: 0xffc887, emissive: 0xffa040, emissiveIntensity: 1.4, roughness: 0.6 });
const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f78, flatShading: true, roughness: 0.95 });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x70513e, flatShading: true, roughness: 1 });

function jitter(geo, amt) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (rng() - 0.5) * amt, p.getY(i) + (rng() - 0.5) * amt, p.getZ(i) + (rng() - 0.5) * amt); geo.computeVertexNormals(); return geo; }

function makeIsland(radius, bare = false) {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(jitter(new THREE.ConeGeometry(radius, radius * 1.7, 8, 3), radius * 0.12), rockMat);
  rock.rotation.x = Math.PI; rock.position.y = -radius * 0.85; g.add(rock);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 0.94, radius * 0.16, 9), grassMat));
  const kind = pick(['crystal', 'town', 'grove', 'crystal', 'grove']);
  const n = bare ? 0 : Math.floor(rand(2, 6));
  for (let i = 0; i < n; i++) {
    const fx = rand(-0.55, 0.55) * radius, fz = rand(-0.55, 0.55) * radius;
    if (kind === 'crystal') { const h = rand(2.5, 7) * (radius / 14); const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.22, h, 5), crystalMat); c.position.set(fx, h * 0.5, fz); c.rotation.set(rand(-0.2, 0.2), rand(0, Math.PI), rand(-0.2, 0.2)); g.add(c); }
    else if (kind === 'town') { const w = rand(1.6, 3.2) * (radius / 14), h = rand(3, 11) * (radius / 14); const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat); b.position.set(fx, h * 0.5, fz); b.rotation.y = rand(0, Math.PI); g.add(b); const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, h * 0.7, w * 0.18), windowMat); s.position.set(fx, h * 0.5, fz + w * 0.48); s.rotation.y = b.rotation.y; g.add(s); }
    else { const h = rand(2, 4.5) * (radius / 14); const tr = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.07, h * 0.1, h * 0.5, 5), trunkMat); tr.position.set(fx, h * 0.25, fz); g.add(tr); const cr = new THREE.Mesh(new THREE.ConeGeometry(h * 0.4, h, 6), treeMat); cr.position.set(fx, h * 0.95, fz); g.add(cr); }
  }
  return g;
}

// Sea far below + a soft glowing central beacon as a landmark.
const sea = new THREE.Mesh(new THREE.CircleGeometry(1700, 48), new THREE.MeshStandardMaterial({ color: 0x16314f, roughness: 0.5, metalness: 0.3 }));
sea.rotation.x = -Math.PI / 2; sea.position.y = -54; world.add(sea);
const beaconTip = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 16), new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffc36b, emissiveIntensity: 2.6 }));
beaconTip.position.set(0, 60, 0); world.add(beaconTip);

// The world is built from AI-generated 3D island models (assets/island-*.glb),
// scattered and scaled. Loaded async from the manifest so a missing variant
// never 404s; the layout is seeded so it stays stable. Clones share geometry,
// so each placement is cheap.
const islandPlacements = [{ x: 0, y: 30, z: 0, r: 84, rotY: 0 }];
for (let i = 0; i < 17; i++) { const a = rand(0, Math.PI * 2), d = rand(120, 540); islandPlacements.push({ x: Math.cos(a) * d, y: rand(8, 158), z: Math.sin(a) * d, r: rand(28, 58), rotY: rand(0, Math.PI * 2) }); }
const islandVariants = [];
const islandLoader = new GLTFLoader();
function placeIslands() {
  if (!islandVariants.length) return;
  islandPlacements.forEach((p, i) => {
    const inst = islandVariants[i % islandVariants.length].clone(true);
    inst.scale.multiplyScalar(p.r); inst.position.set(p.x, p.y, p.z); inst.rotation.y = p.rotY;
    world.add(inst);
  });
}
fetch('./assets/manifest.json').then((r) => (r.ok ? r.json() : null)).then((m) => {
  const list = (m && m.islands) || [];
  let pending = list.length; if (!pending) return;
  list.forEach((file) => islandLoader.load(`./assets/${file}`, (gltf) => {
    const g = gltf.scene;
    const box = new THREE.Box3().setFromObject(g); const sz = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
    g.position.sub(c);
    const holder = new THREE.Group(); holder.add(g); holder.scale.setScalar(1 / Math.max(sz.x, sz.z, 0.001));
    islandVariants.push(holder);
    if (--pending === 0) placeIslands();
  }, undefined, () => { if (--pending === 0) placeIslands(); }));
}).catch(() => {});

const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
const clouds = new THREE.InstancedMesh(cloudGeo, new THREE.MeshLambertMaterial({ color: 0xfff4ec, transparent: true, opacity: 0.8 }), 80);
{ const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(); for (let i = 0; i < 80; i++) { const a = rand(0, Math.PI * 2), d = rand(60, 760); p.set(Math.cos(a) * d, rand(15, 270), Math.sin(a) * d); q.setFromEuler(new THREE.Euler(0, rand(0, Math.PI), 0)); s.set(rand(7, 18), rand(2.2, 4.5), rand(7, 18)); m.compose(p, q, s); clouds.setMatrixAt(i, m); } }
scene.add(clouds);

// ----------------------------------------------------------------- the hero
const hero = new THREE.Group(); scene.add(hero);
const heroPose = new THREE.Group(); hero.add(heroPose);          // banking + tilt
const driftVisual = new THREE.Group(); driftVisual.scale.setScalar(1.35); heroPose.add(driftVisual);

const suitMat = new THREE.MeshStandardMaterial({ color: 0x14495c, roughness: 0.55, metalness: 0.15 });
const accentMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
const visorMat = new THREE.MeshStandardMaterial({ color: 0x66f2ff, emissive: 0x4fe8ff, emissiveIntensity: 2.2, roughness: 0.2 });
const capeMat = new THREE.MeshStandardMaterial({ color: 0xff9a3d, emissive: 0xb35a14, emissiveIntensity: 0.28, side: THREE.DoubleSide, roughness: 0.8 });
const thrustMat = new THREE.MeshStandardMaterial({ color: 0xaef6ff, emissive: 0x5fe8ff, emissiveIntensity: 2.6 });
{
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.78, 6, 12), suitMat); torso.rotation.x = Math.PI / 2; driftVisual.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), suitMat); head.position.set(0, 0.04, -0.86); driftVisual.add(head);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0.9, 0.7), visorMat); visor.position.copy(head.position); visor.rotation.x = Math.PI / 2; driftVisual.add(visor);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.62, 4, 8), suitMat); arm.position.set(sx * 0.42, 0.02, 0.12); arm.rotation.x = Math.PI / 2; arm.rotation.z = sx * -0.14; driftVisual.add(arm); const fist = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), accentMat); fist.position.set(sx * 0.46, 0, 0.56); driftVisual.add(fist); }
  for (const sx of [-0.16, 0.16]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.7, 4, 8), suitMat); leg.position.set(sx, -0.02, 0.95); leg.rotation.x = Math.PI / 2; driftVisual.add(leg); const boot = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 8), thrustMat); boot.position.set(sx, -0.02, 1.42); boot.rotation.x = -Math.PI / 2; driftVisual.add(boot); }
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.7), visorMat); spine.position.set(0, 0.36, 0.05); driftVisual.add(spine);
}
const capeGeo = new THREE.PlaneGeometry(1.35, 2.3, 10, 14); capeGeo.rotateX(Math.PI / 2); capeGeo.translate(0, 0, 1.15);
const capeBase = capeGeo.attributes.position.array.slice();
const cape = new THREE.Mesh(capeGeo, capeMat); cape.position.set(0, 0.3, 0.15); driftVisual.add(cape);
const boostGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(170,250,255,1)', 'rgba(90,200,255,0.5)'), blending: THREE.AdditiveBlending, depthWrite: false }));
boostGlow.position.set(0, 0, 1.8); boostGlow.scale.setScalar(0.001); driftVisual.add(boostGlow);

// Character swap (fox = CC0 GLB, aurora = generated GLB if present).
const gltfLoader = new GLTFLoader();
const glbHolders = {};
let glbMixer = null;
function loadGlbHero(name, url) {
  gltfLoader.load(url, (gltf) => {
    const g = gltf.scene;
    const box = new THREE.Box3().setFromObject(g); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
    g.position.sub(c);
    const holder = new THREE.Group(); holder.scale.setScalar(3.4 / Math.max(size.x, size.y, size.z)); holder.rotation.y = Math.PI; holder.add(g);
    holder.visible = false; heroPose.add(holder); glbHolders[name] = { holder, gltf, mixer: gltf.animations.length ? new THREE.AnimationMixer(g) : null };
    if (glbHolders[name].mixer) { const clip = gltf.animations.find((a) => /fly|run|walk/i.test(a.name)) || gltf.animations[0]; glbHolders[name].mixer.clipAction(clip).play(); }
    if (name === 'aurora') { const el = document.getElementById('charAurora'); el.classList.remove('locked'); el.querySelector('.dsc').textContent = 'AI hero'; el.title = ''; }
    if (selectedChar === name) applyHero();
  }, undefined, () => {});
}
loadGlbHero('fox', './assets/fox.glb');
// 'aurora' (AI-generated 3D hero) loads only if listed in assets/manifest.json,
// so a not-yet-generated model never causes a 404.
fetch('./assets/manifest.json').then((r) => r.ok ? r.json() : null).then((m) => { if (m && m.heroAurora) loadGlbHero('aurora', `./assets/${m.heroAurora}`); }).catch(() => {});

let selectedChar = 'drift';
function applyHero() {
  driftVisual.visible = selectedChar === 'drift';
  glbMixer = null;
  for (const [name, h] of Object.entries(glbHolders)) { const on = name === selectedChar; h.holder.visible = on; if (on && h.mixer) glbMixer = h.mixer; }
}

// Trail
const TRAIL_N = 130; const trailPos = new Float32Array(TRAIL_N * 3); const trailCol = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, map: glowTexture('rgba(190,245,255,1)', 'rgba(100,200,255,0.45)'), blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); trail.frustumCulled = false; scene.add(trail);

// Collect burst
const BURST_N = 80; const burstPos = new Float32Array(BURST_N * 3); const burstVel = Array.from({ length: BURST_N }, () => new THREE.Vector3());
const burstGeo = new THREE.BufferGeometry(); burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
const burst = new THREE.Points(burstGeo, new THREE.PointsMaterial({ size: 1.3, color: 0xffc36b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); burst.frustumCulled = false; scene.add(burst);
let burstLife = 0;
function fireBurst(centre, color) { burst.material.color.set(color); for (let i = 0; i < BURST_N; i++) { burstPos[i * 3] = centre.x; burstPos[i * 3 + 1] = centre.y; burstPos[i * 3 + 2] = centre.z; burstVel[i].set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(10, 30)); } burstGeo.attributes.position.needsUpdate = true; burstLife = 1; }

// ----------------------------------------------------------- the ring course
const RING_TYPES = {
  standard: { color: 0xffc36b, emissive: 0xff9a2e, time: 2.2, score: 100, tube: 0.55, r: 6 },
  gold: { color: 0xfff0a8, emissive: 0xffd24a, time: 3.4, score: 300, tube: 0.42, r: 4.6 },
  boost: { color: 0x8ff6ff, emissive: 0x46d8ff, time: 1.4, score: 80, tube: 0.6, r: 6.4 },
};
const ringGlowTex = glowTexture('rgba(255,210,140,0.9)', 'rgba(255,160,60,0.35)');
const course = [];
let courseHead = new THREE.Vector3();
let courseDir = new THREE.Vector3();
let targetIndex = 0;

function chooseType(n) {
  const r = rng();
  if (n > 3 && r < 0.16) return 'gold';
  if (r < 0.30) return 'boost';
  return 'standard';
}

function spawnRing() {
  const n = course.length;
  // Drift the course direction; steer back toward the world centre near bounds.
  const e = new THREE.Euler(rand(-0.32, 0.18), rand(-0.5, 0.5), 0, 'YXZ');
  courseDir.applyEuler(e).normalize();
  const next = courseHead.clone().addScaledVector(courseDir, RING_SPACING);
  const horiz = Math.hypot(next.x, next.z);
  if (horiz > WORLD_RADIUS || next.y < 35 || next.y > 240) {
    const toCentre = new THREE.Vector3(-courseHead.x, 70 - courseHead.y, -courseHead.z).normalize();
    courseDir.lerp(toCentre, 0.6).normalize();
    next.copy(courseHead).addScaledVector(courseDir, RING_SPACING);
  }
  courseHead.copy(next);

  const type = chooseType(n);
  const def = RING_TYPES[type];
  const group = new THREE.Group(); group.position.copy(next);
  const torus = new THREE.Mesh(new THREE.TorusGeometry(def.r, def.tube, 12, 40), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.emissive, emissiveIntensity: 1.9, roughness: 0.35 }));
  // Face the ring roughly along the course direction so you fly through it.
  torus.lookAt(courseDir.clone().add(next).x, next.y + courseDir.y, courseDir.clone().add(next).z);
  group.add(torus);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringGlowTex, color: def.color, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 })); glow.scale.setScalar(def.r * 2.6); group.add(glow);
  scene.add(group);
  course.push({ group, torus, type, def, baseY: next.y, phase: rand(0, Math.PI * 2), collected: false });
}

function resetCourse() {
  for (const r of course) disposeRing(r);
  course.length = 0; targetIndex = 0;
  rng = mulberry32(SEED + state.runs);
  courseHead.set(0, 100, 120);
  courseDir.set(0, -0.04, -1).normalize();
  for (let i = 0; i < AHEAD + 2; i++) spawnRing();
}

// ----------------------------------------------------------- post-processing
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: 2, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.55, 0.6);
composer.addPass(bloom);

// Cheap, clean post: NO film grain. A single tap + a soft vignette at cruise;
// radial speed-streak follows airspeed; chromatic fringe still waits for boost
// (a true no-op otherwise), so the common case is one texture fetch per pixel.
const FXShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.3 }, speed: { value: 0 }, aberration: { value: 0 }, flash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float speed; uniform float aberration; uniform float flash;
    varying vec2 vUv;
    void main(){
      vec2 dir = vUv - 0.5;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (speed > 0.001) {
        vec3 acc = vec3(0.0); float total = 0.0;
        for (int i = 0; i < 4; i++){ float t = float(i)/3.0; float s = 1.0 - t*speed*0.12; float w = 1.0 - t*0.5; acc += texture2D(tDiffuse, 0.5 + dir*s).rgb * w; total += w; }
        col = acc/total;
      }
      if (aberration > 0.001) {
        float ab = aberration*0.006 + length(dir)*aberration*0.005;
        col.r = texture2D(tDiffuse, vUv + dir*ab).r;
        col.b = texture2D(tDiffuse, vUv - dir*ab).b;
      }
      col *= 1.0 - smoothstep(0.32, 0.9, length(dir)*1.05)*vignette;
      col += flash;
      gl_FragColor = vec4(col,1.0);
    }`,
};
const fxPass = new ShaderPass(FXShader); composer.addPass(fxPass);
composer.addPass(new OutputPass());

// ----------------------------------------------------------------- HUD refs
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), timer: $('timer'), score: $('score'), comboChip: $('comboChip'), comboFill: $('comboFill'),
  rings: $('rings'), best: $('best'), boostFill: $('boostFill'), boostLabel: $('boostLabel'),
  marker: $('marker'), markerDist: document.querySelector('#marker .dist'), popups: $('popups'),
  flash: $('flash'), lowVig: $('lowVignette'),
  menu: $('menu'), countdown: $('countdown'), countNum: $('countNum'), pause: $('pause'), results: $('results'),
  grade: $('grade'), newbest: $('newbest'), rScore: $('rScore'), rRings: $('rRings'), rCombo: $('rCombo'), rSpeed: $('rSpeed'),
  menuBest: $('menuBest'), touch: $('touch'),
};

function fmtTime(s) { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; }
function showScreen(name) {
  for (const s of ['menu', 'countdown', 'pause', 'results']) ui[s].classList.toggle('hidden', s !== name);
  ui.hud.classList.toggle('on', name === null || name === 'pause');
}
function popup(text, color, screenX, screenY, size = 22) {
  const el = document.createElement('div'); el.className = 'popup'; el.textContent = text; el.style.color = color;
  el.style.left = `${screenX}px`; el.style.top = `${screenY}px`; el.style.fontSize = `${size}px`;
  ui.popups.appendChild(el); setTimeout(() => el.remove(), 1000);
}
function flash(amount) { ui.flash.style.transition = 'none'; ui.flash.style.opacity = amount; requestAnimationFrame(() => { ui.flash.style.transition = 'opacity 0.35s'; ui.flash.style.opacity = 0; }); }

// ----------------------------------------------------------------- game state
const STATE = { MENU: 'menu', COUNTDOWN: 'countdown', PLAYING: 'playing', PAUSED: 'paused', RESULTS: 'results' };
const state = {
  mode: STATE.MENU, yaw: Math.PI, pitch: 0, roll: 0, speed: 0,
  timeLeft: START_TIME, score: 0, displayScore: 0, combo: 0, maxCombo: 0, lastCollect: 0,
  ringsHit: 0, boost: BOOST_MAX, topSpeed: 0, shake: 0, hitStop: 0, trailHead: 0, runs: 0,
  countT: 0, countN: 3,
};
const bestScore = () => Number(localStorage.getItem('skyloop2-best') || 0);
ui.menuBest.textContent = bestScore() ? `Best score ${bestScore()}` : 'Best score —';
ui.best.textContent = bestScore() ? `BEST ${bestScore()}` : 'BEST —';

function toMenu() { state.mode = STATE.MENU; showScreen('menu'); audio.toMenu(); ui.menuBest.textContent = bestScore() ? `Best score ${bestScore()}` : 'Best score —'; }
function startCountdown() {
  state.mode = STATE.COUNTDOWN; showScreen('countdown'); audio.resume(); audio.toGameplay();
  applyHero();
  hero.position.set(0, 100, 180); state.yaw = 0; state.pitch = 0; state.roll = 0; state.speed = 0;
  state.timeLeft = START_TIME; state.score = 0; state.displayScore = 0; state.combo = 0; state.maxCombo = 0;
  state.ringsHit = 0; state.boost = BOOST_MAX; state.topSpeed = 0; state.runs++;
  resetCourse();
  state.countN = 3; state.countT = 0; ui.countNum.textContent = '3'; if (!audio.say('3', { force: true })) audio.count();
}
function startPlaying() { state.mode = STATE.PLAYING; showScreen(null); }
function pauseGame() { if (state.mode !== STATE.PLAYING) return; state.mode = STATE.PAUSED; showScreen('pause'); }
function resumeGame() { if (state.mode !== STATE.PAUSED) return; state.mode = STATE.PLAYING; showScreen(null); }
function endRun() {
  state.mode = STATE.RESULTS; showScreen('results'); audio.toMenu();
  const sc = state.score; const prev = bestScore(); const isBest = sc > prev;
  if (isBest) localStorage.setItem('skyloop2-best', String(sc));
  // grade by score thresholds
  const g = sc >= 6000 ? 'S' : sc >= 4000 ? 'A' : sc >= 2400 ? 'B' : sc >= 1200 ? 'C' : 'D';
  const gc = { S: '#ffd86b', A: '#7afcff', B: '#9be38a', C: '#ffb347', D: '#ff6b8a' }[g];
  ui.grade.textContent = g; ui.grade.style.color = gc; ui.grade.style.textShadow = `0 0 50px ${gc}88`;
  ui.newbest.textContent = isBest ? 'NEW BEST!' : '';
  ui.rScore.textContent = sc; ui.rRings.textContent = state.ringsHit; ui.rCombo.textContent = `×${state.maxCombo}`; ui.rSpeed.textContent = Math.round(state.topSpeed);
  // Announcer: "Time!" then the rank reveal a beat later (fall back to the win chime).
  if (!audio.say('time', { force: true })) audio.win();
  setTimeout(() => audio.say(`rank-${g.toLowerCase()}`, { force: true }), 900);
}

// ----------------------------------------------------------------- input
const keys = new Set();
let wasBoosting = false;
let autopilot = false;
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { const m = audio.toggleMute(); document.getElementById('soundToggle').classList.toggle('on', !m); document.getElementById('soundToggle').textContent = m ? '♪ Muted' : '♪ Sound'; return; }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state.mode === STATE.PLAYING) pauseGame(); else if (state.mode === STATE.PAUSED) resumeGame(); return; }
  if (state.mode === STATE.MENU || state.mode === STATE.RESULTS) { if (e.code === 'Enter' || e.code === 'Space') startCountdown(); }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));

// Buttons
$('playBtn').onclick = startCountdown;
$('retryBtn').onclick = startCountdown;
$('resultsMenu').onclick = toMenu;
$('resumeBtn').onclick = resumeGame;
$('pauseRestart').onclick = startCountdown;
$('pauseMenu').onclick = toMenu;
$('pauseBtn').onclick = () => (state.mode === STATE.PLAYING ? pauseGame() : resumeGame());
$('soundToggle').onclick = () => { const m = audio.toggleMute(); $('soundToggle').classList.toggle('on', !m); $('soundToggle').textContent = m ? '♪ Muted' : '♪ Sound'; };
$('howToggle').onclick = () => { $('howBox').classList.toggle('hidden'); $('howToggle').classList.toggle('on'); };
document.querySelectorAll('.char').forEach((el) => el.onclick = () => {
  if (el.classList.contains('locked')) return;
  document.querySelectorAll('.char').forEach((c) => c.classList.remove('sel')); el.classList.add('sel');
  selectedChar = el.dataset.char; applyHero();
});

// Touch input
let touchSteer = { x: 0, y: 0 }; let touchBoost = false; let stickId = null; let stickOrigin = { x: 0, y: 0 };
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) ui.touch.classList.add('on');
const stickBase = $('stickBase'), stickNub = $('stickNub');
$('stickZone').addEventListener('pointerdown', (e) => { stickId = e.pointerId; stickOrigin = { x: e.clientX, y: e.clientY }; stickBase.style.display = stickNub.style.display = 'block'; stickBase.style.left = stickNub.style.left = `${e.clientX}px`; stickBase.style.top = stickNub.style.top = `${e.clientY}px`; });
addEventListener('pointermove', (e) => { if (e.pointerId !== stickId) return; const dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y; const max = 56; const cx = Math.max(-max, Math.min(max, dx)), cy = Math.max(-max, Math.min(max, dy)); stickNub.style.left = `${stickOrigin.x + cx}px`; stickNub.style.top = `${stickOrigin.y + cy}px`; touchSteer.x = cx / max; touchSteer.y = cy / max; });
addEventListener('pointerup', (e) => { if (e.pointerId === stickId) { stickId = null; touchSteer = { x: 0, y: 0 }; stickBase.style.display = stickNub.style.display = 'none'; } });
const boostBtn = $('boostTouch');
boostBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); touchBoost = true; boostBtn.classList.add('on'); });
boostBtn.addEventListener('pointerup', () => { touchBoost = false; boostBtn.classList.remove('on'); });
boostBtn.addEventListener('pointerleave', () => { touchBoost = false; boostBtn.classList.remove('on'); });

// ----------------------------------------------------------------- main loop
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), camOffset = new THREE.Vector3(), camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3(), toCentre = new THREE.Vector3(), ndc = new THREE.Vector3(), trailSpawn = new THREE.Vector3(), tmp = new THREE.Vector3();
// Pre-allocated Eulers reused every frame (no per-frame heap churn).
const eFwd = new THREE.Euler(0, 0, 0, 'YXZ'), eHero = new THREE.Euler(0, 0, 0, 'YXZ'), eCam = new THREE.Euler(0, 0, 0, 'YXZ');
let frameCount = 0;

function animate() {
  const dtReal = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (state.mode === STATE.COUNTDOWN) {
    state.countT += dtReal;
    if (state.countT >= 1) { state.countT = 0; state.countN--; if (state.countN > 0) { ui.countNum.textContent = String(state.countN); ui.countNum.style.animation = 'none'; void ui.countNum.offsetWidth; ui.countNum.style.animation = 'countpop 1s ease-out'; if (!audio.say(String(state.countN), { force: true })) audio.count(); } else { ui.countNum.textContent = 'GO'; startPlaying(); audio.say('go', { force: true }); audio.go(); } }
  }

  const playing = state.mode === STATE.PLAYING;
  const hs = state.hitStop > 0 ? 0.08 : 1; state.hitStop = Math.max(0, state.hitStop - dtReal);
  const dt = dtReal * hs;

  // input → orientation
  const yawIn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - touchSteer.x;
  const pitchIn = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - touchSteer.y;
  const wantBoost = (keys.has('ShiftLeft') || keys.has('ShiftRight') || touchBoost) && state.boost > 0.02;
  const boosting = playing && wantBoost;

  if (boosting && !wasBoosting) audio.boost();
  wasBoosting = boosting;

  if (playing) {
    state.yaw += Math.max(-1, Math.min(1, yawIn)) * 1.6 * dt;
    state.pitch = THREE.MathUtils.clamp(state.pitch + Math.max(-1, Math.min(1, pitchIn)) * 1.2 * dt, -1.05, 1.05);
    if (!pitchIn) state.pitch = THREE.MathUtils.damp(state.pitch, 0, 0.9, dt);
    state.boost = THREE.MathUtils.clamp(state.boost + (boosting ? -BOOST_DRAIN : BOOST_REGEN) * dtReal, 0, BOOST_MAX);
    state.timeLeft -= dtReal;
    if (state.timeLeft <= 0) { state.timeLeft = 0; endRun(); }
  }
  state.roll = THREE.MathUtils.damp(state.roll, -Math.max(-1, Math.min(1, yawIn)) * 0.9, 5, dt);

  // Autopilot (verification/demo): aim straight at the current target so the
  // real collision + collect code runs without manual steering.
  if (playing && autopilot) {
    const at = course[targetIndex];
    if (at) { tmp.copy(at.group.position).sub(hero.position); state.yaw = Math.atan2(-tmp.x, -tmp.z); state.pitch = THREE.MathUtils.clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -1.05, 1.05); }
  }

  const diveBonus = Math.max(0, -Math.sin(state.pitch)) * 18;
  const target = (boosting ? BOOST_SPEED : BASE_SPEED) + diveBonus;
  state.speed = THREE.MathUtils.damp(state.speed, playing ? target : (state.mode === STATE.COUNTDOWN ? BASE_SPEED * 0.3 : 0), 2.4, dt);
  if (playing) state.topSpeed = Math.max(state.topSpeed, state.speed);

  eFwd.set(state.pitch, state.yaw, 0); fwd.set(0, 0, -1).applyEuler(eFwd);
  if (state.mode === STATE.PLAYING || state.mode === STATE.COUNTDOWN) hero.position.addScaledVector(fwd, state.speed * dt);

  // soft bounds
  toCentre.set(-hero.position.x, 0, -hero.position.z); const horiz = toCentre.length();
  if (horiz > WORLD_RADIUS) { const desired = Math.atan2(toCentre.x / horiz, toCentre.z / horiz) + Math.PI; let d = desired - state.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); state.yaw += d * dt * 1.2; }
  hero.position.y = THREE.MathUtils.clamp(hero.position.y, -10, 360);

  eHero.set(state.pitch, state.yaw, 0); hero.quaternion.setFromEuler(eHero);
  heroPose.rotation.z = state.roll; heroPose.rotation.x = pitchIn * 0.16;
  if (glbMixer) glbMixer.update(dt);

  // cape — normals only need refreshing a few times a second, not every frame
  frameCount++;
  const cp = capeGeo.attributes.position; const flutter = 0.1 + (state.speed / BOOST_SPEED) * 0.22;
  for (let i = 0; i < cp.count; i++) { const bx = capeBase[i * 3], bz = capeBase[i * 3 + 2], tail = bz / 2.3; cp.setY(i, Math.sin(bz * 2.4 - t * 7) * flutter * tail + Math.sin(bx * 3 + t * 4.4) * flutter * 0.35 * tail + tail * tail * 0.5); }
  cp.needsUpdate = true; if ((frameCount & 3) === 0) capeGeo.computeVertexNormals();

  const boostAmt = THREE.MathUtils.clamp((state.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED), 0, 1);
  boostGlow.scale.setScalar(0.001 + boostAmt * 1.4 + Math.sin(t * 31) * 0.1 * boostAmt);
  audio.setBoost(boostAmt);

  // trail
  state.trailHead = (state.trailHead + 1) % TRAIL_N; trailSpawn.copy(hero.position).addScaledVector(fwd, -1.8);
  trailPos[state.trailHead * 3] = trailSpawn.x; trailPos[state.trailHead * 3 + 1] = trailSpawn.y; trailPos[state.trailHead * 3 + 2] = trailSpawn.z;
  for (let i = 0; i < TRAIL_N; i++) { const age = ((state.trailHead - i + TRAIL_N) % TRAIL_N) / TRAIL_N; const k = (1 - age) * (0.12 + boostAmt * 0.88); trailCol[i * 3] = 0.45 * k; trailCol[i * 3 + 1] = 0.9 * k; trailCol[i * 3 + 2] = 1 * k; }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;

  // burst
  if (burstLife > 0) { burstLife = Math.max(0, burstLife - dtReal * 1.4); for (let i = 0; i < BURST_N; i++) { burstPos[i * 3] += burstVel[i].x * dt; burstPos[i * 3 + 1] += burstVel[i].y * dt; burstPos[i * 3 + 2] += burstVel[i].z * dt; } burstGeo.attributes.position.needsUpdate = true; burst.material.opacity = burstLife; }

  // rings: animate + collision on the current target
  for (const r of course) { if (r.collected) continue; r.torus.rotation.z += dt * 0.6; r.group.position.y = r.baseY + Math.sin(t * 0.8 + r.phase) * 1.4; }
  const tgt = course[targetIndex];
  if (playing && tgt) {
    const d = hero.position.distanceTo(tgt.group.position);
    if (d < COLLECT_RADIUS) collectRing(tgt);
    else { tmp.copy(tgt.group.position).sub(hero.position); if (tmp.dot(fwd) < -0.2 && d > COLLECT_RADIUS) missRing(tgt); }
  }
  // marker → current target
  if (tgt && playing) {
    ndc.copy(tgt.group.position).project(camera);
    const x = THREE.MathUtils.clamp((ndc.x * 0.5 + 0.5) * innerWidth, 30, innerWidth - 30);
    const y = THREE.MathUtils.clamp((-ndc.y * 0.5 + 0.5) * innerHeight, 70, innerHeight - 70);
    ui.marker.style.display = 'block'; ui.marker.style.left = `${ndc.z > 1 ? innerWidth / 2 : x}px`; ui.marker.style.top = `${ndc.z > 1 ? 70 : y}px`;
    ui.marker.style.opacity = (ndc.z < 1 && Math.abs(ndc.x) < 0.92 && Math.abs(ndc.y) < 0.9) ? '1' : '0.55';
    ui.markerDist.textContent = `${Math.round(hero.position.distanceTo(tgt.group.position))} m`;
  } else ui.marker.style.display = 'none';

  clouds.rotation.y += dt * 0.0035;

  // camera
  const camDist = 9.5 + boostAmt * 3.0;
  eCam.set(state.pitch * 0.45, state.yaw, 0); camOffset.set(0, 2.6 + state.pitch * -1.2, camDist).applyEuler(eCam);
  camTarget.copy(hero.position).add(camOffset);
  camera.position.lerp(camTarget, 1 - Math.exp(-6.5 * dtReal));
  state.shake = Math.max(0, state.shake - dtReal * 2.2);
  const amp = state.shake * 0.45 + boostAmt * 0.14;
  camera.position.x += (Math.random() - 0.5) * amp; camera.position.y += (Math.random() - 0.5) * amp; camera.position.z += (Math.random() - 0.5) * amp;
  lookTarget.copy(hero.position).addScaledVector(fwd, 14); lookTarget.y += 1.2; camera.lookAt(lookTarget);
  camera.fov = THREE.MathUtils.damp(camera.fov, 62 + boostAmt * 18 + (state.hitStop > 0 ? -6 : 0), 5, dtReal); camera.updateProjectionMatrix();

  // post + HUD
  // Cruise already moves the hero; the streak used to wait for boost, so level
  // flight read as a hover. Drive it from airspeed, and let boost still max it.
  const motion = THREE.MathUtils.clamp((state.speed - 12) / (BOOST_SPEED - 12), 0, 1);
  const streak = (playing || state.mode === STATE.COUNTDOWN) ? motion : 0;
  fxPass.uniforms.speed.value = THREE.MathUtils.damp(fxPass.uniforms.speed.value, streak, 6, dtReal);
  fxPass.uniforms.aberration.value = boostAmt;
  bloom.strength = 0.9 + boostAmt * 0.35;

  if (playing || state.mode === STATE.RESULTS) {
    state.displayScore += (state.score - state.displayScore) * (1 - Math.exp(-10 * dtReal));
    ui.score.textContent = Math.round(state.displayScore);
    ui.timer.textContent = fmtTime(state.timeLeft);
    ui.timer.classList.toggle('low', state.timeLeft < 5 && playing);
    ui.lowVig.classList.toggle('on', state.timeLeft < 5 && playing);
    ui.rings.textContent = state.ringsHit;
    if (state.combo > 1 && performance.now() - state.lastCollect > 7000) { state.combo = 1; }
    const comboWindow = Math.max(0, 1 - (performance.now() - state.lastCollect) / 7000);
    ui.comboFill.style.width = `${state.combo > 1 ? comboWindow * 100 : 0}%`;
    ui.comboChip.textContent = state.combo > 1 ? `COMBO ×${state.combo}` : '';
    ui.boostFill.style.width = `${state.boost * 100}%`;
    ui.boostFill.classList.toggle('empty', state.boost < 0.15);
    ui.boostLabel.classList.toggle('on', boosting);
  }

  composer.render();
}

function collectRing(r) {
  r.collected = true; r.group.visible = false;
  state.ringsHit++;
  const now = performance.now();
  state.combo = now - state.lastCollect < 7000 ? state.combo + 1 : 1; state.lastCollect = now;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  // perfect = passed near the centre
  const dCentre = hero.position.distanceTo(r.group.position);
  const perfect = dCentre < r.def.r * 0.4;
  const gain = r.def.time * (perfect ? 1.25 : 1) * Math.max(0.55, 1 - state.ringsHit * 0.012);
  state.timeLeft = Math.min(START_TIME + 8, state.timeLeft + gain);
  const sc = Math.round((r.def.score + (perfect ? 150 : 0)) * state.combo);
  state.score += sc;
  if (r.type === 'boost') state.boost = BOOST_MAX;
  // juice
  state.shake = Math.min(state.shake + (r.type === 'gold' ? 1.3 : 0.85), 1.5);
  state.hitStop = perfect ? 0.07 : 0.04;
  flash(perfect ? 0.32 : 0.16);
  fireBurst(r.group.position, r.def.color);
  audio.ring(state.combo, r.type);
  // Announcer callouts (throttled so they never stack): a combo milestone wins
  // over a perfect call when both land at once.
  if (state.combo === 5 || state.combo === 10 || state.combo === 15 || state.combo === 20) audio.say('combo');
  else if (perfect) audio.say('perfect');
  // popups at the ring's screen position
  ndc.copy(r.group.position).project(camera);
  const px = (ndc.x * 0.5 + 0.5) * innerWidth, py = (-ndc.y * 0.5 + 0.5) * innerHeight;
  popup(`+${gain.toFixed(1)}s`, '#7afcff', px, py - 8, perfect ? 26 : 22);
  if (state.combo > 1) popup(`×${state.combo}`, '#ffd86b', px + 44, py + 18, 18);
  if (perfect) popup('PERFECT', '#fff', px, py - 40, 16);
  advanceTarget();
}
function missRing(r) { r.collected = true; r.group.visible = false; state.combo = 0; advanceTarget(); }
function disposeRing(r) { scene.remove(r.group); r.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
function advanceTarget() {
  targetIndex++;
  while (course.length - targetIndex < AHEAD) spawnRing();
  // Retire rings well behind the player so course[] and the scene graph stay
  // bounded (~13 rings) instead of growing for the entire run.
  while (targetIndex > 8) { disposeRing(course.shift()); targetIndex--; }
}

// initial menu
toMenu();
function loop() { animate(); requestAnimationFrame(loop); }
// (No hidden-tab render fallback — rendering a backgrounded tab wastes GPU/battery.)
requestAnimationFrame(loop);

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth, innerHeight); });

// verification + debug hooks
window.__sky = {
  state, STATE, hero, course, audio,
  get target() { return course[targetIndex]; },
  start() { startCountdown(); },
  skipCountdown() { if (state.mode === STATE.COUNTDOWN) { startPlaying(); } },
  forceHitTarget() { const tgt = course[targetIndex]; if (tgt) { hero.position.copy(tgt.group.position); } },
  // Deterministic collect: place the hero at the target (centre = perfect),
  // run the real collectRing, then aim at the next ring — mirrors real forward
  // progress so the miss-check never spuriously fires during verification.
  collectTarget() {
    const tgt = course[targetIndex];
    if (!tgt || state.mode !== STATE.PLAYING) return;
    hero.position.copy(tgt.group.position);
    collectRing(tgt);
    const nx = course[targetIndex];
    if (nx) { tmp.copy(nx.group.position).sub(hero.position); state.yaw = Math.atan2(-tmp.x, -tmp.z); state.pitch = THREE.MathUtils.clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -1.05, 1.05); }
  },
  endNow() { if (state.mode === STATE.PLAYING) { state.timeLeft = 0; endRun(); } },
  setAutopilot(b) { autopilot = b; },
  setChar(c) { selectedChar = c; applyHero(); },
};
