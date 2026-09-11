# GamerWheels

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r128-black.svg)](https://threejs.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-v4.7-purple.svg)](https://socket.io/)

**GamerWheels** is a real-time multiplayer 3D PEV (Personal Electric Vehicle / Onewheel) trail carving, street park, and RFTR (Race for the Rail) track racing simulator built with **Three.js**, **Node.js**, **Express**, and **Socket.io**.

It combines custom board physics, dynamic multi-camera tracking, real-time multiplayer rider synchronization, an interactive 2D track editor with 3D inspection support, and a modern asset-first content pipeline.

---

## Key Features

- **Custom PEV / Onewheel Physics**: Realistic carving mechanics, pitch/roll tilt control, airborne dynamics, trick execution, and jump/launch ramps.
- **Real-Time Multiplayer (.IO Architecture)**: Low-latency socket synchronization of rider positions, orientation, speeds, customizable board colors, and tricks powered by Node.js and Socket.io.
- **Interactive 2D Track Editor & 3D Inspector**:
  - Draw track centerlines, adjust node coordinates, and place elevation markers (peaks & valleys).
  - Add discrete track features (Tabletops, Kickers, Rollers, Drops, Banked Berms, Gap Jumps).
  - Inspect generated 3D spline tracks in real-time with full 3D viewport controls.
- **RFTR Racing Engine**: Lap timing, checkpoint/gate validation, split times against target ghosts (e.g., Nico), and track HUD.
- **Track Markup Protocol**: Image markup protocol to quickly convert overhead satellite photos or Figma designs into playable 3D track splines. See [`TRACK_MARKUP_PROTOCOL.md`](file:///c:/Users/quinn/Documents/GitHub/gamerwheels/TRACK_MARKUP_PROTOCOL.md).
- **Asset-First Modern Pipeline**: Support for standard 3D file formats (`.gltf`, `.glb`, `.fbx`, `.obj`) with automated blockout ingestion scripts, removing dependency on legacy game engine conversion formats.

---

## Project Layout

```text
gamerwheels/
├── assets/                  # Runtime 3D asset directory
│   └── models/              # Cleaned & runtime-ready imported meshes (.glb / .gltf)
├── content/                 # Blockout geometry & source layout prototypes
│   └── blockouts/           # Raw FBX/GLTF blockouts for rapid prototyping
├── public/                  # Static web application & game client
│   ├── css/                 # Modern design system & HUD styling (game.css)
│   ├── images/              # Satellite maps, ground textures, and thumbnails
│   ├── js/
│   │   ├── game.js          # Core Three.js render loop, physics engine & controls
│   │   ├── trackEditor.js   # Interactive 2D track editor & 3D inspection modal
│   │   ├── trackBuilder.js  # Procedural track mesh & spline generation engine
│   │   ├── trackData_*.js   # Pre-configured track datasets (e.g., Hollister Hills)
│   │   ├── mapLoader.js     # Terrain mesh & environment asset loader
│   │   └── multiplayer.js  # Socket.io client connection & rider state interpolator
│   └── index.html           # Main web entry point and HUD UI layout
├── scripts/
│   └── export_blockout.py   # Python utility for ingestion & manifest creation
├── server.js                # Express & Socket.io multiplayer server backend
├── TRACK_MARKUP_PROTOCOL.md # Satellite markup specification for track creation
├── render.yaml              # Render cloud hosting blueprint configuration
├── railway.json             # Railway.app deployment configuration
└── package.json             # Project dependencies & npm scripts
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18.0.0 or higher
- [Python](https://www.python.org/) 3.x (optional, for asset blockout scripts)

### Installation & Local Server

1. **Clone the repository:**
   ```bash
   git clone https://github.com/quinncfoster/gamerwheels.git
   cd gamerwheels
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the local development server:**
   ```bash
   npm run dev
   ```
   Or for production mode:
   ```bash
   npm start
   ```

4. **Access the game:**
   Open your browser and navigate to `http://localhost:3000`.

---

## Interactive Track Editor & 3D Inspection

GamerWheels includes a built-in track editor for designing and previewing tracks directly in the browser:

- **2D Canvas Editor**: Draw centerlines, insert control points, modify track width, set banking angles, and configure feature properties (kickers, tabletops, rollers, berms).
- **3D Inspector Mode**: Instantly visualize the generated 3D spline mesh, camera orbit controls, surface materials, and feature geometries.
- **Export / Import**: Save track data as JSON objects compatible with `trackBuilder.js`.

---

## Track Markup Protocol

We maintain a dead-simple visual convention for drawing over satellite imagery or layout blueprints to quickly build tracks.

For full specifications, color codes, marker shapes, and elevation rules, refer to [`TRACK_MARKUP_PROTOCOL.md`](file:///c:/Users/quinn/Documents/GitHub/gamerwheels/TRACK_MARKUP_PROTOCOL.md).

Quick color reference:
- **Cyan (`#00FFFF`)**: Track Centerline & Direction
- **Green (`#00FF00`)**: Elevation Peak
- **Red (`#FF0000`)**: Elevation Valley / Drop Feature
- **Orange (`#FF8800`)**: Tabletop Jump
- **Magenta (`#FF00FF`)**: Kicker Ramp
- **Blue (`#0088FF`)**: Banked Berm

---

## Modern Asset Pipeline

GamerWheels uses a clean asset ingestion pipeline designed for modern 3D modeling tools (Blender, Maya, 3ds Max):

1. Prototype layout geometry in your DCC tool.
2. Export to `.fbx`, `.gltf`, or `.glb`.
3. Place files in `content/blockouts/` or `assets/models/`.
4. Run the export script to prepare manifests:
   ```bash
   npm run build:assets
   # or directly:
   python scripts/export_blockout.py --source content/blockouts --dest assets/models
   ```

---

## Server & Deployment

The backend server ([`server.js`](file:///c:/Users/quinn/Documents/GitHub/gamerwheels/server.js)) is powered by Node.js, Express, and Socket.io.

- **Health Check Endpoint**: `GET /health` (returns server status, active rider count, and uptime).
- **Container / Cloud Deployment**: Standard Node.js environment variable `PORT` is automatically respected for cloud hosting.
- **Render.com Deployment**: Declarative Blueprint provided via [`render.yaml`](file:///c:/Users/quinn/Documents/GitHub/gamerwheels/render.yaml) for zero-config Web Service deploys with automatic `/health` checks.
- **Railway Deployment**: Configured via [`railway.json`](file:///c:/Users/quinn/Documents/GitHub/gamerwheels/railway.json) using Nixpacks builder and automatic restarts.

---

## License

Distributed under the MIT License. See `LICENSE` for details.

Developed by **Quinn Foster**.

