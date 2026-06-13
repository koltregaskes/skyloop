# Generated assets — provenance (KOL-4222)

All assets below were generated on 2026-06-13 via the **Magnific / Pikaso MCP**
(server `pikaso`, Freepik) on a Pro plan. They are original generations from the
prompts below — no third-party IP, no reference images.

## Images (tool: `images_generate`, model `seedream-4-5`, 50 credits each)

- **keyart-b.jpg** (1344×768) — start-screen splash. Creation `Bm2pYTZoQR`.
- **keyart-a.jpg** (1344×768) — win-screen background. Creation `y65wxlmPW9`.

Prompt (both, seeds differ):
> Wide cinematic video game key art: a lone original flying hero in a teal and
> indigo suit with a flowing amber cape, arms forward, soaring between floating
> islands at dusk, distant glowing amber light rings, violet to warm-orange
> gradient sky, soft volumetric clouds, a small luminous beacon city on a central
> floating island, stylised low-poly dreamworld, bloom and subtle film grain,
> painterly splash art, no text, no logos

These came out remarkably close to SKYLOOP's actual procedural world (teal hero +
amber cape, floating islands, amber rings, lit beacon city), so they double as
honest key art rather than generic splash images.

## Hero concept (tool: `images_generate`, model `seedream-4-5`, 2:3)

- **hero-concept.jpg** — the "Aurora" character concept (front A-pose, plain
  background) used as the source image for the AI 3D hero. Creation `xghxxLejfW`.
- **hero-aurora.glb** — image-to-3D conversion of that concept (tool
  `models3d_generate`, model `tripo-p1`). Selectable in-game as the AURORA
  character. Creation `xgvLZpCjfW`.

## Music (tool: `audio_music_generate`, model `elevenlabs-music-generation`)

- **audio/music-flight.mp3** (60 s) — looping ambient bed, used on the menu.
  Creation `tfnBTBRmZJ`.
- **audio/music-gameplay.mp3** (95 s) — energetic driving bed, crossfaded in
  during play. Creation `3GL3iWkREY`. Prompt: energetic uplifting electronic
  flight music ~120 BPM, soaring leads, arpeggiated bass, building intensity.

Ambient prompt (music-flight):
> Dreamy ambient flight music bed, weightless and uplifting, soft warm synth
> pads, gentle arpeggios, airy bells, subtle slow pulse, a sense of soaring
> through a dusk sky, no vocals, seamless background loop for a flying game

Note: this track is ElevenLabs-generated music, obtained through the Magnific MCP
(which exposes ElevenLabs music generation as a backend model).

## How these are wired in

- Key art: CSS backgrounds on `#start` and `#win` overlays (`index.html`).
- Music: listed in `assets/audio/manifest.json` under `music`; the audio engine
  (`src/audio.js`) loads it on launch, loops it, and ducks the synthesised pad.
- SFX (`samples` in the manifest) are still synthesised live — drop
  ElevenLabs/Magnific `sfx-ring.mp3` etc. in and list them to upgrade with no
  code change.

## Reproduce

The assets were generated through the Magnific/Pikaso MCP (Streamable-HTTP) with
the tools, models, and prompts listed above: `images_generate` for the key art
and `audio_music_generate` for the music. Each call queues a creation; poll it to
completion (`creations_wait`) and fetch the asset URL (`creations_get`). The
small Node client used to drive this lives outside the repo (it needs a local
Magnific auth token), but any MCP client pointed at `https://mcp.magnific.com`
reproduces these with the prompts above.
