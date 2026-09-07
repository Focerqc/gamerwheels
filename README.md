# GamerWheels .IO 🛹⚡

A real-time multiplayer 2.5D isometric PEV / Onewheel carving, trail, and skate park freestyle game built with Three.js, Node.js, and Socket.io. Designed for instant drop-in .io gameplay and zero-config deployment on **Railway**.

---

## Features

- **Realistic 2.5D Onewheel Physics**:
  - Progressive motor acceleration, regenerative braking, dynamic roll carving tilt, and inertia.
  - Bunny hops, air pitch (frontflips / backflips), air yaw (180 / 360 / 540 spins), and rodeo combos.
  - Rail grinding and noseslide balance sweetspot mini-game.
- **Massive Free-Roam World**:
  - **Central Town Square**: Funboxes, tabletop jumps, ledges, round & flat rails, quarterpipes, and spine ramps.
  - **Mega Drop (Thunder Peak)**: 7-meter drop-in tower with high-speed launch kicker and canyon landing.
  - **Pine Ridge Slopestyle**: Timber ladder bridges, step-up ramps, whale tail, and curved timber wallride.
  - **Slickrock Motocross**: 16-meter monster tabletop jump, rhythm whoops, and red rock canyon gaps.
  - **Desert Berms**: High-speed sweeping banked bowls and carving rollers.
- **Real-Time Multiplayer (.IO Architecture)**:
  - Instant join with custom rider nickname and rail color selection.
  - Server tick loop (25Hz) broadcasting player snapshots.
  - Buttery smooth client-side interpolation (Lerp / Slerp) for zero network jitter.
  - 3D floating billboard nametags and active trick banners above remote riders.
  - Live .IO Leaderboard card and global trick announcement ticker.
  - In-game quick chat and reaction emotes.
- **Production Ready for Railway**:
  - Lightweight Express + Socket.io server with container health checks (`/health`).
  - Automatic WebSocket / HTTPS termination.

---

## Quick Start (Local Development)

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Game Server**:
   ```bash
   npm start
   ```

3. **Open in Browser**:
   Navigate to [http://localhost:3000](http://localhost:3000). Open multiple tabs to test multiplayer!

---

## Push to GitHub

To push this standalone repository to your GitHub account:

```bash
# 1. Initialize git and commit
git init
git add .
git commit -m "Initial commit: GamerWheels standalone .IO multiplayer game"

# 2. Add your GitHub remote (replace with your repo URL)
git remote add origin https://github.com/Focerqc/gamerwheels.git

# 3. Push to main branch
git branch -M main
git push -u origin main
```

---

## Deploy to Render (Web Service) in 60 Seconds

1. On your [Render Dashboard](https://dashboard.render.com), click **+ New** -> **Web Service** (shown on the "Create a new Service" screen).
2. Connect your **`gamerwheels`** GitHub repository.
3. Configure settings (or let `render.yaml` configure automatically):
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
   - **Health Check Path**: `/health`
4. Click **Create Web Service**.
5. Render will deploy the application and give you a free `onrender.com` HTTPS/WSS URL to share and ride with friends!

---

## Deploy to Railway in 60 Seconds

1. Go to [Railway.app](https://railway.app) and log in.
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Select your `gamerwheels` repository.
4. Railway will automatically detect the `package.json`, install dependencies, run `node server.js`, and generate a live HTTPS/WSS URL (e.g. `https://gamerwheels-production.up.railway.app`).
5. Share the link with friends to ride together!

---

## Controls

| Action | Desktop Keys | Mobile Touch |
| :--- | :--- | :--- |
| **Drive & Steer** | <kbd>▲</kbd> <kbd>◄</kbd> <kbd>▼</kbd> <kbd>►</kbd> / <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Left Virtual Joystick |
| **Mid-Air Flips & Spins** | Numpad <kbd>8</kbd> <kbd>4</kbd> <kbd>6</kbd> <kbd>2</kbd> | Right Virtual Joystick |
| **Snowboard Butter Slides** | Numpad <kbd>1</kbd> <kbd>3</kbd> (Tail Drag), <kbd>7</kbd> <kbd>9</kbd> (Nose Drag) | — |
| **Hop / Jump** | <kbd>Space</kbd> / Numpad <kbd>5</kbd> | HOP Button |
| **Checkpoints** | <kbd>1</kbd>–<kbd>5</kbd> | Checkpoints Bar |
| **Reset / Respawn** | <kbd>R</kbd> | Reset Button |
| **Camera Zoom** | Scroll / <kbd>[</kbd> <kbd>]</kbd> / Numpad <kbd>+</kbd> <kbd>-</kbd> | Zoom Buttons |
| **Chat** | <kbd>Enter</kbd> | Chat Input / Emotes |

---

## License

MIT © Quinn Foster
