# THPS Map Pipeline — GamerWheels

Converts Tony Hawk's Pro Skater `.prk` park files into web-ready `.glb` maps that the
GamerWheels frontend loads from `public/assets/maps/`.

## Layout

```
tools/map-pipeline/
├── pipeline.js       # Node.js orchestrator: finds Blender, runs the converter, writes maps-manifest.json
└── convert_thps.py   # Blender headless script: .prk → .glb (compat-shimmed for Blender 3.6–5.x)
```

## Quick Start

1. Drop a `.prk` file into `maps-in/` (kept at the project root, next to `Blender-Addons/`).
2. Run from the project root:

   ```bash
   npm run convert:map -- Braille.PRK
   ```

   or convert everything in the folder:

   ```bash
   npm run convert:maps
   ```

   or invoke the orchestrator directly:

   ```bash
   node tools/map-pipeline/pipeline.js Braille.PRK
   ```

3. Output land in `public/assets/maps/<name>.glb` and `maps-manifest.json` is regenerated.

## Manual Blender Debug Invocation

The orchestrator builds this Blender command (with proper quoting). To see the full
Blender output and isolate converter errors, run it directly:

```bash
"<blender-executable>" -b -P tools/map-pipeline/convert_thps.py -- \
  "Blender-Addons/io_thps_scene" \
  "maps-in/Braille.PRK" \
  "out/Braille.glb"
```

- `<blender-executable>` is auto-detected (`where blender` → then common install paths).
- `--` marks the start of script args: first the addon source dir, then input `.prk`, then output `.glb`.
- Output to `out/` is safe temporary space and is not served by the game.

## Diagnosis Checklist (Braille.glb not loading)

1. **GLB exists where the game looks** — the frontend fetches `assets/maps/<name>.glb`
   (relative to `/`), which is `public/assets/maps/<name>.glb`. If you exported manually
   to `out/Braille.glb`, copy it over and re-run the pipeline so the manifest regenerates.
2. **Manifest is in sync** — `public/assets/maps/maps-manifest.json` lists `Braille.glb`.
   It is regenerated on every successful conversion.
3. **Run the manual command above** — stderr/stdout from Blender will show the real failure
   (addon load, import step, or glTF export). Compare with a known-good export in `out/`.
4. **Browser console** — `❌ Failed to load map Braille:` in the console identifies
   fetch/parse errors vs. game classification issues.

## Notes

- `convert_thps.py` receives the addon directory as a CLI arg, so it stays runnable
  regardless of where it lives.
- `pipeline.js` computes project paths from its own location (`../../`) — do not move it
  without updating the `CONFIG` block.