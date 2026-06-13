# Unreal / Fab → Three.js web asset pipeline

Implementation guide for [KOL-4209](https://linear.app/koltregaskes/issue/KOL-4209).
This documents the workflow the SUPERFLIGHT source demo used, generalised into a
repeatable Rooms OS pipeline. SKYLOOP itself uses route C (fully procedural) so it
ships with zero licensing risk; routes A and B are the asset-sourcing paths for a
richer version.

Updated: 2026-06-12

## The pipeline at a glance

```
source asset            convert/optimise           web scene                run/deploy
(Fab, MetaHuman,   →    (FBX → GLB,           →    (Three.js GLTFLoader →  (static server
 CC0 packs,              gltf-transform,            controller + post)      locally; Vercel/
 World Labs)             splat formats)                                     Netlify with approval)
```

## Step 1 — source a character (check the licence FIRST)

| Source | Licence position | Notes |
|---|---|---|
| Fab marketplace (fab.com) | Per-asset: Fab Standard Licence generally permits use inside interactive products, including web; "Personal" tier restricts commercial use | Read the licence tab on the specific listing before downloading. Free monthly assets keep their stated licence |
| MetaHuman (Epic) | Historically locked to Unreal Engine rendering. Epic relaxed this in 2025 (UE 5.6-era EULA change) so MetaHuman Creator output can leave Unreal — but **re-check the current EULA text before any public use** | MetaHumans are very heavy (millions of triangles, many 4K textures) — they need aggressive decimation for web |
| Mixamo (Adobe) | Royalty-free use in projects with an Adobe account; characters + a large animation library (including flying-style clips) | The classic quick route: pick character, apply "Flying" animation, download FBX |
| CC0 packs: Quaternius, Kenney, KayKit | CC0 / public domain — zero risk | Low-poly style matches SKYLOOP's look; no attribution required |
| Generated in code (SKYLOOP's route) | No licence at all | Full control of pose/cape/effects; this is what `src/main.js` does |

Rule from the ticket: never use protected IP (Superman etc.) even as a "temp" asset.

## Step 2 — get it out of Unreal/DCC as glTF

- From **Unreal**: install the free **glTF Exporter** plugin (Epic), then
  File → Export → glTF — export Skeletal Mesh with animations straight to `.glb`.
  Alternative: export FBX, then convert in Blender (import FBX → export glTF 2.0).
- From **Mixamo**: download FBX (with skin), import to Blender, export `.glb`
  with the animation clips you need baked in.
- From **MetaHuman**: export to Unreal first, use a lower LOD (LOD4–LOD6),
  strip groom/strands (use cards), then glTF-export as above.

## Step 3 — optimise the GLB for web

Target: hero under ~100k triangles and ~10–25 MB total download.

```powershell
npx @gltf-transform/cli optimize hero.glb hero-web.glb --compress draco --texture-compress webp
# or meshopt + KTX2:
npx gltfpack -i hero.glb -o hero-web.glb -cc -tc
```

- Draco or meshopt halves (or better) geometry size.
- KTX2/WebP texture compression matters more than geometry for MetaHuman-class assets.
- Remove unused animation tracks and morph targets before shipping.

## Step 4 — import into the Three.js scene

SKYLOOP already has the hook — `?model=<url>` loads a GLB and replaces the
procedural hero (see the `GLTFLoader` block in `src/main.js`). For a full
integration you would also:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('./node_modules/three/examples/jsm/libs/draco/');
loader.setDRACOLoader(draco);

loader.load('assets/hero-web.glb', (gltf) => {
  hero.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find(a => a.name.includes('Fly'))).play();
  // call mixer.update(dt) in the frame loop
});
```

Orientation gotcha: glTF characters face +Z; the controller flies along -Z, so
rotate the loaded scene `rotation.y = Math.PI` (already done in the hook).

## Step 5 — the environment (the "World Labs" part)

Three workable routes:

- **A. Gaussian splats (true World Labs route)**: World Labs / Marble exports
  splat scenes (`.ply` / `.spz`). Load in Three.js with the **Spark** library or
  `@mkkellogg/GaussianSplats3D`. Splats are view-dependent and heavy
  (50–300 MB); best used as backdrop/outskirts with collision-free flight, which
  is exactly what the source author suggested ("populate the outskirts with
  World Labs gsplats"). Check World Labs' terms for what generated worlds may be
  used for before publishing.
- **B. City/terrain GLB**: a licensed city block from Fab or a CC-BY Sketchfab
  model, optimised exactly as in step 3 (scenes compress dramatically with
  meshopt + KTX2).
- **C. Procedural (SKYLOOP's route)**: seeded generation in code — zero
  download, zero licence, infinite variants (`?seed=`). See `makeIsland()` in
  `src/main.js`.

## Step 6 — controller + camera + post (reference implementation)

`src/main.js` is the reusable reference for the feel layer:

- flight model: yaw/pitch with banking roll, auto-level, dive bonus, damped boost
- chase camera: exponential smoothing, FOV kick on boost, decaying shake impulses
- post chain: `EffectComposer` → `RenderPass` → `UnrealBloomPass` → grain/vignette
  `ShaderPass` → `OutputPass`, with ACES tone mapping
- objective loop: distance-test ring collection, HUD marker via NDC projection

## Step 7 — run locally / deploy

- Local: any static server (the page is plain ES modules + an import map; no build
  step) — e.g. `npm run serve` (python http.server) or `npx serve`.
- Deploy: it's a static site, so GitHub Pages serves it directly from the repo
  root (this is how the live build runs). Vercel/Netlify would work unchanged.

## Step 4 verified in practice (KOL-4220)

The `?model=` hook was exercised with a real licensed asset:
`?model=./assets/fox.glb` loads the **CC0 Khronos Fox sample** (163 KB,
`assets/FOX-LICENCE.md`), auto-centres and auto-scales it from its bounding box,
plays its Run animation through an `AnimationMixer`, and inherits banking from
the pose group. Headless verification check: `modelLoaded: true`,
`proceduralHidden: true`, zero console errors — see
`evidence/06-glb-fox-swap.png`. The same path takes any optimised
Fab/Mixamo/MetaHuman GLB.

## Verified-working notes from this build

- three r184 import map: `"three": "./node_modules/three/build/three.module.js"`,
  `"three/addons/": "./node_modules/three/examples/jsm/"`.
- Hidden browser tabs throttle `requestAnimationFrame` to zero — the prototype
  drives frames from a `setInterval` fallback when `document.hidden`, which is
  what makes headless/preview verification possible.
- Headless Chromium needs `--enable-unsafe-swiftshader` for software WebGL
  (Chrome 139+); under software GL, simulated time runs slower than wall time,
  so verification assertions should test ratios, not absolute timings.
- GLSL `smoothstep` with reversed edges is undefined behaviour — keep edge0 < edge1.

## Next steps (mapped from the source author's own improvement list)

1. ~~Larger city centre~~ — done procedurally in v2 (KOL-4220): 18-tower city on the hub island.
2. World Labs gaussian-splat outskirts (route A) — needs a World Labs scene export and the Spark loader.
3. ~~Exercise the GLB swap~~ — done in v2 with the CC0 Fox; a *hero-quality* rigged character with a
   true flying animation (Mixamo/Fab) remains an optional upgrade via the same hook.
4. ~~Ring combos/multipliers and score~~ — done in v2. Remaining ideas: timed gates, simple enemies.
5. Optional deploy to Vercel once Kol approves public exposure.
