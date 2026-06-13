// Browser verification + evidence capture for SKYLOOP 2.0 (KOL-4239).
// Drives the real game in headless Chromium through the full flow: menu →
// countdown → autopiloted flight collecting rings via the live collision code →
// pause → forced run-end → results/grade. Captures screenshots + video + JSON.
//
//   node scripts/verify-capture.mjs   (static server must be on 127.0.0.1:8431)

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
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: evidenceDir, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__sky, null, { timeout: 20000 });
await page.waitForTimeout(1200);
check('loads to menu', await page.evaluate(() => window.__sky.state.mode === 'menu'), 'mode=menu');
await page.screenshot({ path: join(evidenceDir, '01-menu.png') });

// Start → skip countdown → autopilot the real course briefly (proves flight +
// steering work; headless software-GL is slow, so this is for the screenshot and
// a "hero actually moved" check rather than a ring count).
await page.evaluate(() => window.__sky.start());
await page.waitForTimeout(300);
await page.evaluate(() => window.__sky.skipCountdown());
await page.waitForTimeout(1000); // let shaders/fox settle so the loop runs at speed
const p0 = await page.evaluate(() => { window.__sky.setAutopilot(true); return window.__sky.hero.position.toArray().map(Math.round); });
await page.waitForTimeout(4500);
const p1 = await page.evaluate(() => window.__sky.hero.position.toArray().map(Math.round));
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
check('hero flies the course under autopilot', moved > 5, `moved ${Math.round(moved)}m`);
await page.screenshot({ path: join(evidenceDir, '02-flight.png') });

// Deterministic objective test: collect through the real collectRing path so
// scoring/combo/time-extension are exercised independent of render framerate.
await page.evaluate(() => window.__sky.setAutopilot(false));
const before = await page.evaluate(() => window.__sky.state.timeLeft);
for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__sky.collectTarget()); await page.waitForTimeout(40); }
const st = await page.evaluate(() => ({ rings: window.__sky.state.ringsHit, score: window.__sky.state.score, maxCombo: window.__sky.state.maxCombo, time: window.__sky.state.timeLeft }));
check('rings collect via live collectRing code', st.rings >= 12, `rings ${st.rings}`);
check('score accumulates with combo', st.score > 0, `score ${st.score}`);
check('combo multiplier builds from chained rings', st.maxCombo >= 12, `maxCombo ×${st.maxCombo}`);
check('passing rings extends the clock', st.time > before, `time ${before.toFixed(1)}s → ${st.time.toFixed(1)}s`);

const audio = await page.evaluate(() => window.__sky.audio.status());
check('audio engine running + gameplay music target', audio.ctxState === 'running' && audio.music === 'gameplay' && audio.ambient === true, `ctx ${audio.ctxState}, music ${audio.music}, menu=${audio.menuLoaded} gameplay=${audio.gameplayLoaded}`);

// Pause / resume.
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const paused = await page.evaluate(() => window.__sky.state.mode === 'paused' && !document.getElementById('pause').classList.contains('hidden'));
check('Escape pauses the game', paused, 'pause overlay shown');
await page.screenshot({ path: join(evidenceDir, '03-pause.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape resumes', await page.evaluate(() => window.__sky.state.mode === 'playing'), 'resumed');

// Character swap (CC0 fox GLB) should not throw and should keep the run alive.
await page.evaluate(() => window.__sky.setChar('fox'));
await page.waitForTimeout(200);
check('character swap is safe mid-run', await page.evaluate(() => window.__sky.state.mode === 'playing'), 'still playing after setChar(fox)');

// AI-generated 3D hero (Aurora) — image_generate → models3d_generate → GLB.
const auroraUnlocked = await page.evaluate(() => !document.getElementById('charAurora').classList.contains('locked'));
check('AI 3D hero (Aurora) unlocks when its GLB is present', auroraUnlocked, 'aurora unlocked');
await page.evaluate(() => window.__sky.setChar('aurora'));
await page.waitForTimeout(1200);
check('Aurora 3D character is selectable mid-run', await page.evaluate(() => window.__sky.state.mode === 'playing'), 'still playing after setChar(aurora)');
await page.evaluate(() => window.__sky.forceHitTarget());
await page.waitForTimeout(400);
await page.screenshot({ path: join(evidenceDir, '05-aurora-hero.png') });

// End the run → results + grade (deterministic, framerate-independent).
await page.evaluate(() => window.__sky.endNow());
await page.waitForTimeout(300);
const res = await page.evaluate(() => ({ mode: window.__sky.state.mode, shown: !document.getElementById('results').classList.contains('hidden'), grade: document.getElementById('grade').textContent }));
check('run ends to results screen with a grade', res.mode === 'results' && res.shown && ['S', 'A', 'B', 'C', 'D'].includes(res.grade), `mode ${res.mode}, grade ${res.grade}`);
await page.screenshot({ path: join(evidenceDir, '04-results.png') });

check('no console or page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');

result.finished_at = new Date().toISOString();
result.console_errors = consoleErrors;
result.pass = result.checks.every((c) => c.pass);
await context.close();
await browser.close();
writeFileSync(join(evidenceDir, 'verification-current.json'), JSON.stringify(result, null, 2));
console.log(`\n${result.pass ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} — evidence in ${evidenceDir}`);
process.exit(result.pass ? 0 : 1);
