# FORGE WORLD

A 3D browser sandbox where you gather raw materials, refine them into components, and fabricate real industrial props from **NVIDIA's SimReady library** — then place, stack and build your own island workshop.

Built with Vite + TypeScript + three.js. No backend, no install, no account: the world saves to `localStorage`.

```
gather → refine → fabricate → place → expand
  6         6       2,595       ∞       10 objectives
```

## Run it

Requires Node 20+ (tested on Node 24) and a desktop browser with keyboard + mouse.

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build and local preview:

```bash
npm run build      # typecheck + bundle to dist/
npm run preview
```

Deploy `dist/` to any static host. All asset URLs are relative, so the build also works from a subdirectory.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Walk |
| `Shift` | Sprint |
| `Space` | Jump |
| Drag / wheel | Orbit / zoom camera |
| `E` | Gather from the nearest resource node |
| `C` | Fabricator: Refine tab |
| `L` | Fabricator: Library tab |
| `B` | Build mode + placement grid |
| `1`–`8` | Select a hotbar prop (press again to cancel) |
| `R` | Rotate the placement ghost |
| `Click` | Place the selected prop |
| `X` / right-click | Recover a placed prop under the cursor |
| `H` | Field manual |
| `Esc` | Close modal → cancel placement → close panel |

## The loop

**1. Gather.** Six node types regrow on a timer:

| Node | Yields |
| --- | --- |
| Silverleaf tree | 4 Wood |
| Stone outcrop | 3 Stone + 1 Metal |
| Scrap heap | 3 Metal |
| Polymer drums | 4 Polymer |
| Silica crystal | 2 Glass + 1 Data |
| Dead terminal | 3 Data |

**2. Refine.** One-step recipes, with intermediates auto-crafted when needed:

| Component | Recipe |
| --- | --- |
| Plank | 2 Wood |
| Metal Plate | 2 Metal |
| Polymer Sheet | 2 Polymer |
| Frame | 2 Plank + 1 Plate |
| Gear | 2 Plate + 1 Stone |
| Circuit | 1 Plate + 1 Glass + 1 Data |

**3. Fabricate.** Every one of the 2,595 catalog assets has a deterministic cost derived from its category and weight tier. Costs may be paid in intermediates or raw stock — the economy walks the recipe tree and consumes raws automatically.

**4. Build.** Snap to a 0.5 m grid, stack on top of placed props, rotate in 15° steps. Recovering a prop returns it to your inventory. The island plot is 114 m across with a 14 m build height.

**5. Progress.** Ten objectives auto-claim material rewards. The island autosaves every 15 seconds.

## Assets

The original [NVIDIA SimReady collection](https://huggingface.co/datasets/nvidia/simready-assets) is roughly **490 GB** of USD — far beyond a browser download. This project uses the web-ready GLB conversion:

- Dataset: [`codepawl/simready-glb`](https://huggingface.co/datasets/codepawl/simready-glb)
- **2,595 assets**, ~3.2 GB total
- Quantized GLB with `EXT_meshopt_compression` + WebP textures
- License: **CC BY 4.0** — models by **NVIDIA**, conversion by **codepawl**

**Hybrid delivery.** A curated 58-asset starter pack (48 MB) is bundled in `public/assets` so the first build, all thumbnails and the opening scene work instantly and offline. The remaining assets stream from the Hugging Face CDN on demand, with thumbnails lazy-loaded and an LRU cache (64 prototypes) bounding GPU memory. If a remote GLB fails, the game substitutes a labelled proxy box instead of breaking.

`public/data/catalog.json` indexes all 2,595 assets with byte size, triangle count, joints, draw calls and bounds. Names, categories, tiers and costs are derived locally — no per-asset authoring required.

### Refreshing the index / starter pack

```bash
npm run fetch-assets
```

This downloads `manifest.jsonl` (cached in `scripts/.cache`), rewrites `public/data/catalog.json` and `public/data/local-assets.json`, and fetches any missing GLB/thumbnail pairs from the curated list in `scripts/fetch-assets.mjs`.

## Project layout

```
index.html               DOM shell (canvas + UI regions)
src/main.ts              entry: styles, Game, boot
src/game.ts              state, input, loop, crafting, placement, saving
src/ui.ts                HUD, hotbar, goals, fabricator, modals, toasts
src/catalog.ts           asset types, names/categories/costs, catalog loader
src/economy.ts           recipes, recursive spending, raw expansion
src/assets.ts            GLTF/meshopt loader, normalization, proxy fallback
src/world.ts             sky shader, day/night, island, water, scenery
src/nodes.ts             resource nodes, respawns, save serialization
src/player.ts            avatar, camera-relative movement, AABB collision
src/build.ts             ghost placement, grid snap, stacking, picking
src/goals.ts             ten objectives + reward functions
src/save.ts              localStorage schema (`forgeworld.save.v1`)
src/sfx.ts               procedural WebAudio effects
src/style.css            dark industrial glass design system
```

Rendering is a single WebGLRenderer with PCF soft shadows and ACES tone mapping. Physics is a small custom AABB solver with step-up and support probes — no physics engine. Audio is synthesized at runtime with oscillators and noise buffers.

## Notes

- Day/night cycles over seven minutes; the clock in the hint bar follows game time.
- To wipe a world: **H → Reset world**, or remove `forgeworld.save.v1` from `localStorage`.
- Remote assets need network access; the 58 bundled props do not.
- On low-end GPUs, lower the browser zoom or window size — pixel ratio is capped at 2.

## Credits

- **Build authorization** — RAJ · [shimul.is-a.dev](https://shimul.is-a.dev) · `FW-RAJ-001`.
- **NVIDIA SimReady** — original 3D assets, licensed CC BY 4.0.
- **codepawl/simready-glb** — optimized web GLB/WebP conversion.
- [three.js](https://threejs.org/) — MIT.
- Everything else (world, UI, economy, code) is original to this project.
