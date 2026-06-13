// Browser verification + evidence capture for SKYLOOP (KOL-4209).
// Drives the real game in headless Chromium: launches, boosts, banks,
// collects all 12 rings through the live collision code, and saves
// screenshots + a video into evidence/.
//
// Usage:  node scripts/verify-capture.mjs   (from the project folder,
//         with the static server already running on 127.0.0.1:8431)

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidenceDir = join(root, 'evidence');
mkdirSync(evidenceDir, { recursive: true });

const URL = 'http://127.0.0.1:8431/?seed=7';
const consoleErrors = [];
const result = { url: URL, started_at: new Date().toISOString(), checks: [] };

const check = (name, pass, detail) => {
  result.checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: evidenceDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__sky, null, { timeout: 20000 });
await page.waitForTimeout(1500); // let shaders compile and a few frames render

check('page loads with game state', true, 'window.__sky present');
await page.screenshot({ path: join(evidenceDir, '01-start-overlay.png') });

// Launch and fly straight with boost: trail, FOV zoom, grain ramp all engage.
await page.keyboard.press('w');           // first key dismisses the start overlay
await page.waitForTimeout(1500);          // give the music bed time to decode + start
await page.keyboard.down('Shift');
await page.waitForTimeout(3200);
await page.screenshot({ path: join(evidenceDir, '02-boost-flight.png') });
const boostSpeed = await page.evaluate(() => Math.round(window.__sky.state.speed));
check('boost raises speed well above base', boostSpeed > 50, `speed ${boostSpeed} (base 30, boost 82; sim time runs slower than wall time under software GL)`);
await page.keyboard.up('Shift');

// Audio engine: launching resumes the AudioContext and starts the ambient bed.
const audioState = await page.evaluate(() => window.__sky.audio.status());
check('audio engine starts (AudioContext running + ambient bed)',
  audioState.ctxState === 'running' && audioState.ambient === true,
  `ctx ${audioState.ctxState}, ambient ${audioState.ambient}, samples [${audioState.samplesLoaded}]`);
check('Magnific-generated music bed loads and plays', audioState.music === true,
  `music playing: ${audioState.music}`);

// Banking turn.
await page.keyboard.down('a');
await page.waitForTimeout(1300);
await page.screenshot({ path: join(evidenceDir, '03-banking-turn.png') });
const roll = await page.evaluate(() => window.__sky.state.roll.toFixed(2));
check('banking roll engages during turn', Math.abs(Number(roll)) > 0.3, `roll ${roll} rad`);
await page.keyboard.up('a');

// Objective loop: teleport in front of each remaining ring and let the real
// per-frame collision detection collect it.
let midRingShot = false;
for (let i = 0; i < 12; i++) {
  const pos = await page.evaluate(() => window.__sky.nextRing());
  if (!pos) break;
  await page.evaluate(([x, y, z]) => window.__sky.setPos(x, y, z), pos);
  await page.waitForTimeout(140);
  if (!midRingShot && i === 5) {
    await page.screenshot({ path: join(evidenceDir, '04-mid-circuit.png') });
    midRingShot = true;
  }
}
const collected = await page.evaluate(() => window.__sky.state.collected);
check('all 12 rings collectable via live collision code', collected === 12, `collected ${collected}/12`);

const scoreState = await page.evaluate(() => ({
  score: window.__sky.state.score, combo: window.__sky.state.combo,
}));
check('score and combo multiplier accumulate', scoreState.score >= 7800 && scoreState.combo === 12,
  `score ${scoreState.score} (12 rings, full combo = 7800+), combo x${scoreState.combo}`);

const winVisible = await page.evaluate(() =>
  !document.getElementById('win').classList.contains('hidden'));
const winTime = await page.evaluate(() => document.getElementById('wintime').textContent);
check('win overlay appears with final time', winVisible, `time ${winTime}`);
await page.waitForTimeout(600);
await page.screenshot({ path: join(evidenceDir, '05-circuit-complete.png') });

// Restart loop.
await page.keyboard.press('r');
await page.waitForTimeout(300);
const afterReset = await page.evaluate(() => ({
  collected: window.__sky.state.collected,
  score: window.__sky.state.score,
  ringsVisible: window.__sky.rings.filter((r) => r.group.visible).length,
}));
check('R restarts the run and zeroes the score', afterReset.collected === 0
  && afterReset.score === 0 && afterReset.ringsVisible === 12, JSON.stringify(afterReset));

// GLB character pipeline demo: swap in the CC0 Fox via ?model= and confirm the
// procedural hero is replaced and the animation mixer is driving the model.
await page.goto('http://127.0.0.1:8431/?seed=7&model=./assets/fox.glb', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sky && window.__sky.modelLoaded === true, null, { timeout: 20000 });
await page.keyboard.press('w');
await page.keyboard.down('Shift');
await page.waitForTimeout(2200);
const glbState = await page.evaluate(() => ({
  modelLoaded: window.__sky.modelLoaded,
  proceduralHidden: !window.__sky.heroVisual.visible,
}));
check('CC0 GLB character swap-in works (?model=./assets/fox.glb)',
  glbState.modelLoaded && glbState.proceduralHidden, JSON.stringify(glbState));
await page.screenshot({ path: join(evidenceDir, '06-glb-fox-swap.png') });
await page.keyboard.up('Shift');

check('no console or page errors', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | ') || 'clean');

result.finished_at = new Date().toISOString();
result.console_errors = consoleErrors;
result.pass = result.checks.every((c) => c.pass);

await context.close(); // flushes the video file
await browser.close();

writeFileSync(join(evidenceDir, 'verification-current.json'), JSON.stringify(result, null, 2));
console.log(`\n${result.pass ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} — evidence in ${evidenceDir}`);
process.exit(result.pass ? 0 : 1);
