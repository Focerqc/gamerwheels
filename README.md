# GamerWheels

GamerWheels is now focused on a modern asset-first workflow: blockout geometry, raw mesh imports, and a clean path into Unreal or other standard runtime pipelines. The project no longer depends on legacy THPS/THUG map converters, proprietary park formats, or Blender addon tricks for content ingestion.

---

## New Direction

This workspace now emphasizes:

- Standard asset sources such as FBX, GLTF, and GLB
- Clean blockout folders for early layout and gameplay iteration
- Lightweight authoring flows that bypass old engine-specific parsers
- Physics and gameplay validation in a modern 3D runtime
- Reusable content pipelines for real-world production work

The goal is to move from brittle format conversion to a straightforward content pipeline:

1. Create blockouts in a standard modeling tool
2. Export to FBX / GLTF / GLB
3. Place files in the repo under the content and asset folders
4. Validate and import directly into the active engine or runtime

---

## Project Layout

```text
.
├── assets/
│   └── models/
│       └── README.md
├── content/
│   └── blockouts/
│       └── README.md
├── public/
│   └── ...game client assets...
├── scripts/
│   └── export_blockout.py
├── server.js
├── package.json
├── README.md
├── render.yaml
├── railway.json
└── .gitignore
```

### Asset folders

- `content/blockouts/` holds raw blockout and layout prototypes.
- `assets/models/` is reserved for cleaned or runtime-ready imported meshes.
- `scripts/export_blockout.py` is a template for ingesting standard mesh formats without legacy THPS conversion logic.

---

## Standard import workflow

Use standard source files from your DCC tool, such as:

- `.fbx`
- `.gltf`
- `.glb`
- `.obj` (optional for testing-only staging)

Then place them in `content/blockouts/` or `assets/models/` as appropriate, depending on whether they are early concept geometry or final import candidates.

Example:

```bash
python scripts/export_blockout.py --source content/blockouts --dest assets/models --extensions .fbx .gltf .glb
```

The script is intentionally simple: it scans for valid standard meshes and prepares a clean, portable asset manifest without proprietary THPS conversion behavior.

---

## Local development

```bash
npm install
npm start
```

Then open the project locally in the browser or runtime target you are validating against.

---

## Legacy cleanup

The repository has been stripped of the old THPS/THUG conversion pipeline, including:

- Blender addon folders
- THPS map conversion tools
- old PRK/park conversion assets
- stale generated GLB export outputs

This project now treats those as permanently retired and unsupported.

---

## License

MIT © Quinn Foster
