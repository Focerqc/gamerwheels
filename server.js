/**
 * GamerWheels Multiplayer Server (.IO Architecture)
 * Author: Quinn Foster
 * Backend: Node.js, Express, Socket.io
 * Ready for Railway Deployment (process.env.PORT)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.stack || err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000
});

const PORT = process.env.PORT || 3000;

// Serve public static assets
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Railway container monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    game: 'GamerWheels',
    playersCount: players.size,
    uptime: process.uptime()
  });
});

// In-Memory Player World State & Map States
const players = new Map();
const SUPPORTED_MAPS = ['dust2', 'park'];
const mapStates = {
  dust2: {
    name: 'de_dust2',
    mode: 'freeroam', // 'freeroam' | 'countdown' | 'tactical'
    readyCount: 0,
    minPlayersToStart: 1,
    countdown: null,
    countdownTimer: null
  },
  park: {
    name: 'Plaza Skatepark',
    mode: 'freeroam',
    readyCount: 0,
    minPlayersToStart: 0
  }
};

function getPlayersInMap(mapId) {
  const list = [];
  for (const p of players.values()) {
    if (p.mapId === mapId) list.push(p);
  }
  return list;
}

function updateMapReadyState(mapId) {
  if (mapId !== 'dust2') return;
  const state = mapStates.dust2;
  const mapPlayers = getPlayersInMap('dust2');
  const readyRiders = mapPlayers.filter(p => p.isReady);
  const minRequired = 1; // Temporarily allow 1 rider to start match for testing
  const isSolo = (mapPlayers.length <= 1 || readyRiders.length === 1);

  state.minPlayersToStart = minRequired;
  state.readyCount = readyRiders.length;

  if (state.mode === 'freeroam') {
    if (readyRiders.length >= minRequired && mapPlayers.length >= minRequired) {
      // Start 5-second countdown to tactical mode!
      state.mode = 'countdown';
      state.countdown = 5;
      io.to('dust2').emit('map_state_update', {
        mode: state.mode,
        isSolo: isSolo,
        readyCount: state.readyCount,
        minPlayersToStart: minRequired,
        totalPlayers: mapPlayers.length,
        countdown: state.countdown,
        message: isSolo ? 'Solo Mission starting in 5s...' : 'Tactical Match starting in 5s...'
      });

      if (state.countdownTimer) clearInterval(state.countdownTimer);
      state.countdownTimer = setInterval(() => {
        state.countdown--;
        if (state.countdown <= 0) {
          clearInterval(state.countdownTimer);
          state.countdownTimer = null;
          state.mode = 'tactical';

          // Initialize tactical round state
          state.tactical = {
            isSolo: isSolo,
            bombState: 'carried',
            plantedSite: null,
            bombTimer: null,
            bombTimerInterval: null
          };

          // Assign teams: auto-balance or preserve chosen teams
          if (isSolo) {
            mapPlayers[0].team = 'T';
            mapPlayers[0].hasBomb = true;
          } else {
            let tCount = 0;
            let ctCount = 0;
            mapPlayers.forEach(p => {
              if (p.team === 'CT') ctCount++;
              else if (p.team === 'T') tCount++;
            });
            mapPlayers.forEach((player) => {
              if (!player.team) {
                player.team = (tCount <= ctCount) ? 'T' : 'CT';
                if (player.team === 'T') tCount++; else ctCount++;
              }
            });
            let bombGiven = false;
            mapPlayers.forEach((player) => {
              if (player.team === 'T' && !bombGiven) {
                player.hasBomb = true;
                bombGiven = true;
              } else {
                player.hasBomb = false;
              }
            });
          }

          // Emit individual team assignments
          mapPlayers.forEach((player) => {
            io.to(player.id).emit('team_assigned', {
              team: player.team,
              hasBomb: !!player.hasBomb
            });
          });

          io.to('dust2').emit('map_state_update', {
            mode: state.mode,
            isSolo: isSolo,
            readyCount: state.readyCount,
            minPlayersToStart: minRequired,
            totalPlayers: mapPlayers.length,
            tactical: {
              isSolo: isSolo,
              bombState: 'carried',
              plantedSite: null
            },
            message: isSolo
              ? 'TERRORIST MISSION (Terrace Spawn): Plant C4 at Site A or B!'
              : 'TACTICAL MATCH LIVE — Buy weapons & plant/defuse.'
          });
        } else {
          io.to('dust2').emit('map_state_update', {
            mode: state.mode,
            isSolo: isSolo,
            readyCount: state.readyCount,
            minPlayersToStart: minRequired,
            totalPlayers: mapPlayers.length,
            countdown: state.countdown,
            message: `Starting in ${state.countdown}...`
          });
        }
      }, 1000);
      return;
    }
  } else if (state.mode === 'countdown') {
    if (readyRiders.length < minRequired || mapPlayers.length < minRequired) {
      // Cancel countdown if someone unreadies or leaves
      if (state.countdownTimer) {
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
      }
      state.mode = 'freeroam';
      state.countdown = null;
      io.to('dust2').emit('map_state_update', {
        mode: state.mode,
        isSolo: isSolo,
        readyCount: state.readyCount,
        minPlayersToStart: minRequired,
        totalPlayers: mapPlayers.length,
        message: 'Countdown cancelled. Free Roam active.'
      });
      return;
    }
  }

  const freeRoamMsg = isSolo
    ? 'Solo testing active — ready up to test match'
    : '2+ riders ready up to begin CS match';

  io.to('dust2').emit('map_state_update', {
    mode: state.mode,
    isSolo: isSolo,
    readyCount: state.readyCount,
    minPlayersToStart: minRequired,
    totalPlayers: mapPlayers.length,
    countdown: state.countdown,
    message: state.mode === 'freeroam' ? freeRoamMsg : undefined
  });
}

// Color Palette for randomized player fallback
const DEFAULT_COLORS = [
  '#ef233c', // Blaze Red
  '#06b6d4', // Cyber Cyan
  '#10b981', // Neon Lime
  '#f59e0b', // Sunset Amber
  '#8b5cf6', // Electric Purple
  '#ec4899', // Hot Pink
  '#f8fafc'  // Frost White
];

// =============================================================================
// Bot (AI Opponent) System
// Bots live in the `players` Map and ride the world_snapshot pipeline.
// Clients see them as normal remote riders — no client code changes required.
// =============================================================================
const BOT_NAMES_T    = ['[BOT] Rashid', '[BOT] Viktor', '[BOT] Dima'];
const BOT_NAMES_CT   = ['[BOT] Carter', '[BOT] Reyes',  '[BOT] Chen'];
const BOT_NAMES_PARK = ['[BOT] Skully',  '[BOT] Pipe',   '[BOT] Ramp'];
const BOT_COLORS_T    = ['#f59e0b', '#ef4444'];
const BOT_COLORS_CT   = ['#06b6d4', '#10b981'];
const BOT_COLORS_PARK = ['#8b5cf6', '#ec4899'];

// ── NavGrid & A* Pathfinding Architecture (Counter-Strike: Source Style) ──
const fs = require('fs');

let dust2NavGrid = null;
try {
  const navDataPath = path.join(__dirname, 'public', 'data', 'dust2_navgrid.json');
  if (fs.existsSync(navDataPath)) {
    dust2NavGrid = JSON.parse(fs.readFileSync(navDataPath, 'utf8'));
    console.log(`[NavGrid] Loaded dust2_navgrid.json successfully (${dust2NavGrid.cols}x${dust2NavGrid.rows}, ${dust2NavGrid.walkableCount} walkable cells)`);
  }
} catch (err) {
  console.error('[NavGrid] Failed to load dust2_navgrid.json:', err);
}

// Convert world position (x, z) to NavGrid cell index
function posToNavNode(x, z) {
  if (!dust2NavGrid) return null;
  const col = Math.floor((x - dust2NavGrid.minX) / dust2NavGrid.resolution);
  const row = Math.floor((z - dust2NavGrid.minZ) / dust2NavGrid.resolution);
  if (col < 0 || col >= dust2NavGrid.cols || row < 0 || row >= dust2NavGrid.rows) return null;
  const idx = row * dust2NavGrid.cols + col;
  return dust2NavGrid.grid[idx] !== null ? idx : null;
}

// Convert NavGrid cell index to world position {x, z, y}
function navNodeToPos(idx) {
  if (!dust2NavGrid || idx === null || idx < 0 || idx >= dust2NavGrid.grid.length) return null;
  const col = idx % dust2NavGrid.cols;
  const row = Math.floor(idx / dust2NavGrid.cols);
  const x = dust2NavGrid.minX + col * dust2NavGrid.resolution + dust2NavGrid.resolution / 2;
  const z = dust2NavGrid.minZ + row * dust2NavGrid.resolution + dust2NavGrid.resolution / 2;
  return { x, z, y: dust2NavGrid.grid[idx] || 0.38 };
}

// Priority Queue for A*
class PriorityQueue {
  constructor() { this.nodes = []; }
  enqueue(priority, key) {
    this.nodes.push({ key, priority });
    this.nodes.sort((a, b) => a.priority - b.priority);
  }
  dequeue() { return this.nodes.shift().key; }
  isEmpty() { return this.nodes.length === 0; }
}

/**
 * A* Pathfinding on 2D NavGrid.
 * Returns array of {x, z, y} path nodes.
 */
function findNavPath(startX, startZ, targetX, targetZ) {
  if (!dust2NavGrid) return [];
  let startNode = posToNavNode(startX, startZ);
  let targetNode = posToNavNode(targetX, targetZ);

  // If start or target is inside a wall cell, find nearest walkable cell
  if (startNode === null) startNode = findNearestWalkableNode(startX, startZ);
  if (targetNode === null) targetNode = findNearestWalkableNode(targetX, targetZ);
  if (startNode === null || targetNode === null) return [];

  const openSet = new PriorityQueue();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  const h = (idx) => {
    const p1 = navNodeToPos(idx);
    const p2 = navNodeToPos(targetNode);
    return Math.hypot(p1.x - p2.x, p1.z - p2.z);
  };

  gScore.set(startNode, 0);
  fScore.set(startNode, h(startNode));
  openSet.enqueue(fScore.get(startNode), startNode);

  const cols = dust2NavGrid.cols;
  const neighborsOffset = [
    -1, 1, -cols, cols,           // cardinal
    -cols - 1, -cols + 1, cols - 1, cols + 1 // diagonal
  ];

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue();
    if (current === targetNode) {
      const path = [navNodeToPos(current)];
      let curr = current;
      while (cameFrom.has(curr)) {
        curr = cameFrom.get(curr);
        path.unshift(navNodeToPos(curr));
      }
      return simplifyPath(path);
    }

    for (const offset of neighborsOffset) {
      const neighbor = current + offset;
      if (neighbor < 0 || neighbor >= dust2NavGrid.grid.length) continue;
      if (dust2NavGrid.grid[neighbor] === null) continue; // wall/obstacle

      const currentPos = navNodeToPos(current);
      const neighborPos = navNodeToPos(neighbor);
      const dist = Math.hypot(currentPos.x - neighborPos.x, currentPos.z - neighborPos.z);
      const tentativeG = gScore.get(current) + dist;

      if (!gScore.has(neighbor) || tentativeG < gScore.get(neighbor)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        fScore.set(neighbor, tentativeG + h(neighbor));
        openSet.enqueue(fScore.get(neighbor), neighbor);
      }
    }
  }
  return [];
}

function findNearestWalkableNode(x, z) {
  if (!dust2NavGrid) return null;
  const col = Math.floor((x - dust2NavGrid.minX) / dust2NavGrid.resolution);
  const row = Math.floor((z - dust2NavGrid.minZ) / dust2NavGrid.resolution);
  
  let bestIdx = null, bestDist = Infinity;
  for (let r = Math.max(0, row - 5); r <= Math.min(dust2NavGrid.rows - 1, row + 5); r++) {
    for (let c = Math.max(0, col - 5); c <= Math.min(dust2NavGrid.cols - 1, col + 5); c++) {
      const idx = r * dust2NavGrid.cols + c;
      if (dust2NavGrid.grid[idx] !== null) {
        const p = navNodeToPos(idx);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      }
    }
  }
  return bestIdx;
}

/**
 * Line of sight check across NavGrid.
/**
 * Probe radial points around (x, z) to verify bot body clearance (prevents clipping through walls)
 */
function isPositionWalkable(x, z, radius = 0.40) {
  if (!dust2NavGrid) return true;
  const points = [
    { x, z },
    { x: x + radius, z },
    { x: x - radius, z },
    { x, z: z + radius },
    { x, z: z - radius },
    { x: x + radius * 0.707, z: z + radius * 0.707 },
    { x: x - radius * 0.707, z: z - radius * 0.707 }
  ];
  for (let i = 0; i < points.length; i++) {
    if (posToNavNode(points[i].x, points[i].z) === null) {
      return false;
    }
  }
  return true;
}

/**
 * 3D Line-of-sight check across NavGrid (checks 2D walls & vertical 3D height differences).
 * Returns true if straight ray from (ax, ay, az) to (bx, by, bz) is unblocked by walls or floors.
 */
function hasLineOfSight(ax, ay, az, bx, by, bz) {
  if (!dust2NavGrid) return true;
  const dist = Math.hypot(bx - ax, bz - az);
  if (dist < 0.1) return true;

  // Height separation check: if vertical gap > 2.0m without ramp/elevation match, blocked by floor/roof
  if (ay !== undefined && by !== undefined && Math.abs(ay - by) > 2.2) {
    return false;
  }

  const steps = Math.ceil(dist / (dust2NavGrid.resolution * 0.4));
  for (let i = 0; i <= steps; i++) {
    const t = steps > 0 ? i / steps : 0;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const expectedY = (ay !== undefined && by !== undefined) ? (ay + (by - ay) * t) : undefined;

    const node = posToNavNode(x, z);
    if (node === null) return false; // passes through a wall/obstacle

    if (expectedY !== undefined) {
      const cellPos = navNodeToPos(node);
      if (cellPos && cellPos.y !== undefined) {
        // Block if cell terrain/wall height is significantly above line of sight
        if (cellPos.y > expectedY + 1.2) {
          return false;
        }
      }
    }
  }
  return true;
}

/** Simplify path by skipping collinear nodes where direct line of sight exists */
function simplifyPath(path) {
  if (path.length <= 2) return path;
  const simplified = [path[0]];
  let curr = 0;
  while (curr < path.length - 1) {
    let next = path.length - 1;
    while (next > curr + 1) {
      const p1 = path[curr];
      const p2 = path[next];
      if (hasLineOfSight(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)) {
        const midX = (p1.x + p2.x) * 0.5;
        const midZ = (p1.z + p2.z) * 0.5;
        if (isPositionWalkable(midX, midZ, 0.35)) {
          break;
        }
      }
      next--;
    }
    simplified.push(path[next]);
    curr = next;
  }
  return simplified;
}

// Major Dust2 Strategic Waypoints (for global macro-tactical goals)
const DUST2_TACTICAL_GOALS = [
  { name: 'T Spawn', x: -8.0, z: 32.0 },
  { name: 'Mid Doors', x: 0.5, z: 11.3 },
  { name: 'B Lower Tunnels', x: -14.0, z: -15.0 },
  { name: 'B Site Platform', x: -25.0, z: -15.0 },
  { name: 'CT Spawn', x: -25.0, z: -35.0 },
  { name: 'Short A / Catwalk', x: 8.0, z: -30.0 },
  { name: 'A Site Platform', x: 20.0, z: -25.0 },
  { name: 'Long A Doors', x: 14.0, z: 18.0 }
];

// Park patrol waypoints
const BOT_PARK_WAYPOINTS = [
  { x: 0.0, z: 0.0, y: 0.38 },
  { x: 55.0, z: 42.0, y: 3.62 },
  { x: -58.0, z: 42.0, y: 3.42 },
  { x: 0.0, z: 56.0, y: 0.42 },
];

// Bot AI state map: botId -> bot object
const bots = new Map();
let botIdCounter = 0;

function createBot(team, mapId = 'dust2') {
  const id = `bot-${++botIdCounter}`;
  const isPark = mapId === 'park';
  const isT    = team === 'T';

  const namePool  = isPark ? BOT_NAMES_PARK  : (isT ? BOT_NAMES_T  : BOT_NAMES_CT);
  const colorPool = isPark ? BOT_COLORS_PARK : (isT ? BOT_COLORS_T : BOT_COLORS_CT);

  const startGoalIdx = isPark ? 0 : (isT ? 0 : 4); // T spawn vs CT spawn
  const startPos = isPark ? BOT_PARK_WAYPOINTS[0] : DUST2_TACTICAL_GOALS[startGoalIdx];

  const bot = {
    id,
    name:  namePool[botIdCounter % namePool.length],
    color: colorPool[botIdCounter % colorPool.length],
    mapId,
    team: isPark ? 'T' : team,
    isBot: true,
    isReady: false,
    hp: 100, maxHp: 100, armor: 100,
    isAlive: true,
    kills: 0, deaths: 0, score: 0,
    x: startPos.x + (Math.random() - 0.5) * 2,
    y: 0.38,
    z: startPos.z + (Math.random() - 0.5) * 2,
    vx: 0, vy: 0, vz: 0,
    heading: Math.random() * Math.PI * 2,
    pitch: 0, roll: 0, speed: 0,
    isAirborne: false, isGrinding: false,
    trick: '',
    currentZone: isPark ? 'Central Town Square' : 'Dust 2',
    lastUpdate: Date.now(),
    // NavGrid A* Pathfinding State
    path: [],
    pathIdx: 0,
    goalIdx: startGoalIdx,
    fsm: 'patrol',         // 'patrol' | 'attack'
    lastFireTime: 0,
    lastPathCalc: 0
  };

  bots.set(id, bot);
  players.set(id, bot);
  return bot;
}

function removeBot(botId) {
  const bot = bots.get(botId);
  const mapId = bot ? bot.mapId : 'dust2';
  bots.delete(botId);
  players.delete(botId);
  io.to(mapId).emit('player_left', { id: botId });
}

function rebalanceBots(changedMap = null) {
  const MAPS_TO_CHECK = changedMap ? [changedMap] : SUPPORTED_MAPS;

  for (const mapId of MAPS_TO_CHECK) {
    if (mapId === 'dust2') {
      const TARGET = 2;
      let tReal = 0, ctReal = 0;
      for (const p of players.values()) {
        if (p.mapId !== 'dust2' || p.isBot) continue;
        if (p.team === 'T') tReal++; else ctReal++;
      }
      const tWant  = Math.max(0, TARGET - tReal);
      const ctWant = Math.max(0, TARGET - ctReal);
      const tBots  = [...bots.values()].filter(b => b.mapId === 'dust2' && b.team === 'T');
      const ctBots = [...bots.values()].filter(b => b.mapId === 'dust2' && b.team === 'CT');

      while (tBots.length  > tWant)  removeBot(tBots.pop().id);
      while (ctBots.length > ctWant) removeBot(ctBots.pop().id);
      while (tBots.length  < tWant)  { const b = createBot('T',  'dust2'); tBots.push(b);  io.to('dust2').emit('player_joined', b); }
      while (ctBots.length < ctWant) { const b = createBot('CT', 'dust2'); ctBots.push(b); io.to('dust2').emit('player_joined', b); }

      console.log(`[Bots|dust2] T: ${tWant} bots (${tReal} real) | CT: ${ctWant} bots (${ctReal} real)`);

    } else if (mapId === 'park') {
      const TARGET   = 2;
      const realPark = [...players.values()].filter(p => p.mapId === 'park' && !p.isBot).length;
      const want     = Math.max(0, TARGET - Math.min(realPark, TARGET));
      const parkBots = [...bots.values()].filter(b => b.mapId === 'park');

      while (parkBots.length > want) removeBot(parkBots.pop().id);
      while (parkBots.length < want) {
        const b = createBot('PARK', 'park');
        parkBots.push(b);
        io.to('park').emit('player_joined', b);
      }
      console.log(`[Bots|park] ${want} bots (${realPark} real)`);
    }
  }
}

function scheduleBotRespawn(bot, delayMs = 4000) {
  setTimeout(() => {
    if (!bots.has(bot.id)) return;
    const startGoalIdx = bot.team === 'T' ? 0 : 4;
    const startPos = DUST2_TACTICAL_GOALS[startGoalIdx];
    bot.hp = 100;
    bot.armor = 100;
    bot.isAlive = true;
    bot.fsm = 'patrol';
    bot.x = startPos.x + (Math.random() - 0.5) * 2;
    bot.y = 0.38;
    bot.z = startPos.z + (Math.random() - 0.5) * 2;
    bot.speed = 0;
    bot.path = [];
    bot.pathIdx = 0;
    bot.lastUpdate = Date.now();
    io.to(bot.mapId).emit('player_respawned', {
      id: bot.id, hp: 100, armor: 100,
      x: bot.x, y: bot.y, z: bot.z
    });
  }, delayMs);
}

/**
 * Counter-Strike Source style Bot Movement & Tactical Navigation.
 * Uses NavGrid + A* pathing, obstacle avoidance, elevation snapping & line-of-sight raycasting.
 */
function tickBots(dt) {
  const BOT_SPEED      = 6.705; // 15 MPH
  const ARRIVE_DIST    = 1.0;   // meters to advance path node
  const TURN_RATE      = 5.0;   // heading lerp rad/s
  const ATTACK_RANGE   = 28;    // shooting detection radius
  const FIRE_COOLDOWN  = 2000;  // ms between shots
  const BOT_DAMAGE     = 22;

  const now = Date.now();
  const dust2Tactical = mapStates.dust2.mode === 'tactical';

  for (const bot of bots.values()) {
    if (!bot.isAlive) continue;

    // ── Attack & Target Line of Sight Check ────────────────────────────────
    let attackTarget = null;
    if (bot.mapId === 'dust2' && dust2Tactical) {
      let nearestDist = Infinity;
      for (const p of players.values()) {
        if (p.mapId !== 'dust2' || !p.isAlive || p.id === bot.id) continue;
        // Do NOT attack teammates! Bots only target riders on the opposing team
        if (p.team && bot.team && p.team === bot.team) continue;
        const d = Math.hypot(p.x - bot.x, p.z - bot.z);
        if (d < nearestDist) { nearestDist = d; attackTarget = p; }
      }

      // Check 3D line-of-sight through NavGrid raycasting (checks 3D walls & height differences)
      const canSee = attackTarget && hasLineOfSight(bot.x, bot.y, bot.z, attackTarget.x, attackTarget.y, attackTarget.z);

      if (attackTarget && nearestDist < ATTACK_RANGE && canSee) {
        bot.fsm = 'attack';

        if (now - bot.lastFireTime > FIRE_COOLDOWN) {
          bot.lastFireTime = now;

          io.to('dust2').emit('player_fired', {
            id: bot.id,
            origin: { x: bot.x, y: bot.y + 0.9, z: bot.z },
            target: { x: attackTarget.x, y: attackTarget.y + 0.9, z: attackTarget.z },
            weaponId: 'glock',
            soundType: 'pistol'
          });

          if (attackTarget.isAlive) {
            let dmg = BOT_DAMAGE;
            if (attackTarget.armor > 0) {
              dmg = Math.round(dmg * 0.65);
              attackTarget.armor = Math.max(0, attackTarget.armor - 8);
            }
            attackTarget.hp = Math.max(0, attackTarget.hp - dmg);

            io.to(attackTarget.id).emit('damage_taken', {
              attackerId: bot.id, attackerName: bot.name,
              damage: dmg, isHeadshot: false,
              hp: attackTarget.hp, armor: attackTarget.armor,
            });

            io.to('dust2').emit('player_health_update', {
              id: attackTarget.id, hp: attackTarget.hp, armor: attackTarget.armor,
              isAlive: attackTarget.hp > 0,
            });

            if (attackTarget.hp <= 0) {
              attackTarget.isAlive = false;
              attackTarget.deaths = (attackTarget.deaths || 0) + 1;
              bot.kills = (bot.kills || 0) + 1;
              bot.score = (bot.score || 0) + 300;
              io.to('dust2').emit('player_killed', {
                killerId: bot.id, killerName: bot.name,
                victimId: attackTarget.id, victimName: attackTarget.name,
                weaponId: 'glock', isHeadshot: false,
              });
              setTimeout(() => {
                if (!players.has(attackTarget.id)) return;
                attackTarget.hp = 100; attackTarget.armor = 100;
                attackTarget.isAlive = true;
                io.to('dust2').emit('player_respawned', {
                  id: attackTarget.id, hp: 100, armor: 100,
                  x: attackTarget.x, y: attackTarget.y, z: attackTarget.z
                });
              }, 3000);
            }
          }
        }
      } else {
        bot.fsm = 'patrol';
        attackTarget = null;
      }
    }

    // ── NavGrid A* Pathfinding Navigation ────────────────────────────────
    if (bot.mapId === 'dust2') {
      // Calculate / recalculate A* path if empty or goal reached
      if (bot.path.length === 0 || bot.pathIdx >= bot.path.length || (now - bot.lastPathCalc > 5000)) {
        bot.lastPathCalc = now;
        
        let targetPos = null;
        if (bot.fsm === 'attack' && attackTarget) {
          targetPos = { x: attackTarget.x, z: attackTarget.z };
        } else {
          // Choose next strategic macro goal
          bot.goalIdx = (bot.goalIdx + 1) % DUST2_TACTICAL_GOALS.length;
          targetPos = DUST2_TACTICAL_GOALS[bot.goalIdx];
        }

        const calculatedPath = findNavPath(bot.x, bot.z, targetPos.x, targetPos.z);
        if (calculatedPath.length > 0) {
          bot.path = calculatedPath;
          bot.pathIdx = 0;
        }
      }

      // Steer toward current path node
      if (bot.path.length > 0 && bot.pathIdx < bot.path.length) {
        const node = bot.path[bot.pathIdx];
        const dx = node.x - bot.x;
        const dz = node.z - bot.z;
        const dist = Math.hypot(dx, dz);

        if (dist < ARRIVE_DIST) {
          bot.pathIdx++;
        } else {
          const desiredHeading = Math.atan2(dx, dz);
          let dh = desiredHeading - bot.heading;
          while (dh < -Math.PI) dh += Math.PI * 2;
          while (dh >  Math.PI) dh -= Math.PI * 2;
          bot.heading += dh * Math.min(1.0, TURN_RATE * dt);

          const moveX = Math.sin(bot.heading) * BOT_SPEED * dt;
          const moveZ = Math.cos(bot.heading) * BOT_SPEED * dt;

          // Check if proposed move stays inside walkable NavGrid (with 0.40m body clearance)
          if (isPositionWalkable(bot.x + moveX, bot.z + moveZ, 0.40)) {
            bot.x += moveX;
            bot.z += moveZ;
            const nodePos = navNodeToPos(posToNavNode(bot.x, bot.z));
            bot.y = (nodePos && nodePos.y !== undefined) ? nodePos.y : 0.38; // snap to terrain elevation
          } else {
            // Re-path & advance goal if blocked by wall
            bot.goalIdx = (bot.goalIdx + 1) % DUST2_TACTICAL_GOALS.length;
            bot.path = [];
          }
        }
      }
    } else {
      // Non-dust2 (Park) fallback
      const wp = BOT_PARK_WAYPOINTS[bot.goalIdx % BOT_PARK_WAYPOINTS.length];
      const dx = wp.x - bot.x;
      const dz = wp.z - bot.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ARRIVE_DIST) bot.goalIdx = (bot.goalIdx + 1) % BOT_PARK_WAYPOINTS.length;
      const desiredHeading = Math.atan2(dx, dz);
      let dh = desiredHeading - bot.heading;
      while (dh < -Math.PI) dh += Math.PI * 2;
      while (dh >  Math.PI) dh -= Math.PI * 2;
      bot.heading += dh * Math.min(1.0, TURN_RATE * dt);
      bot.x += Math.sin(bot.heading) * BOT_SPEED * dt;
      bot.z += Math.cos(bot.heading) * BOT_SPEED * dt;
      bot.y = wp.y;
    }

    bot.lastUpdate = now;
  }
}


io.on('connection', (socket) => {
  console.log(`[+] Rider connected: ${socket.id}`);

  // Default to dust2 as featured map
  const defaultColor = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
  const defaultName = 'Rider_' + Math.floor(100 + Math.random() * 900);
  const defaultMap = 'dust2';
  const dustPlayers = getPlayersInMap('dust2');
  let tCount = 0, ctCount = 0;
  dustPlayers.forEach(p => { if (p.team === 'CT') ctCount++; else tCount++; });
  const autoTeam = (tCount > ctCount) ? 'CT' : 'T';

  const initialPlayer = {
    id: socket.id,
    name: defaultName,
    color: defaultColor,
    mapId: defaultMap,
    team: autoTeam,
    hasBomb: (autoTeam === 'T' && tCount === 0),
    isReady: false,
    hp: 100,
    maxHp: 100,
    armor: 100,
    isAlive: true,
    kills: 0,
    deaths: 0,
    x: (Math.random() - 0.5) * 6,
    y: 0.2,
    z: (Math.random() - 0.5) * 6,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: -Math.PI * 0.75,
    pitch: 0,
    roll: 0,
    speed: 0,
    isAirborne: false,
    isGrinding: false,
    trick: '',
    score: 0,
    currentZone: 'Dust 2 Plaza',
    lastUpdate: Date.now()
  };

  players.set(socket.id, initialPlayer);
  socket.join(defaultMap);

  // Send initial world state scoped to this map
  socket.emit('init_world', {
    selfId: socket.id,
    mapId: defaultMap,
    players: getPlayersInMap(defaultMap),
    mapState: mapStates[defaultMap]
  });
  socket.emit('team_assigned', { team: autoTeam, hasBomb: initialPlayer.hasBomb });

  // Notify other clients in the same map room
  socket.to(defaultMap).emit('player_joined', initialPlayer);
  updateMapReadyState(defaultMap);

  // Rebalance bots to account for this new real player
  rebalanceBots(defaultMap);

  // Send existing bots in this map to the newly connected client
  for (const bot of bots.values()) {
    if (bot.mapId === defaultMap) {
      socket.emit('player_joined', bot);
    }
  }

  // Client requests to switch map room
  socket.on('change_map', (data) => {
    const p = players.get(socket.id);
    if (!p || !data || !data.mapId) return;
    const newMap = data.mapId;
    if (!SUPPORTED_MAPS.includes(newMap)) {
      // Ignore unsupported or locked maps (e.g. 2fort)
      return;
    }
    if (p.mapId === newMap) return;

    const oldMap = p.mapId;
    socket.leave(oldMap);
    p.mapId = newMap;
    p.isReady = false;
    socket.join(newMap);

    // Notify previous room
    io.to(oldMap).emit('player_left', { id: socket.id });
    updateMapReadyState(oldMap);
    rebalanceBots(oldMap); // fill the vacated slot in old map

    // Notify new room
    socket.to(newMap).emit('player_joined', p);
    socket.emit('init_world', {
      selfId: socket.id,
      mapId: newMap,
      players: getPlayersInMap(newMap),
      mapState: mapStates[newMap]
    });
    socket.emit('team_assigned', { team: p.team || 'T', hasBomb: !!p.hasBomb });
    updateMapReadyState(newMap);
    rebalanceBots(newMap); // adjust bots now that player arrived

    // Send existing bots in new map to this client
    for (const bot of bots.values()) {
      if (bot.mapId === newMap) socket.emit('player_joined', bot);
    }
  });

  function forceStartMatch(mapId = 'dust2') {
    if (mapId !== 'dust2') return;
    const state = mapStates.dust2;
    const mapPlayers = getPlayersInMap('dust2');
    const isSolo = (mapPlayers.length <= 1);

    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }

    state.mode = 'tactical';
    state.countdown = null;
    state.tactical = {
      isSolo: isSolo,
      bombState: 'carried',
      plantedSite: null,
      bombTimer: null,
      bombTimerInterval: null
    };

    if (isSolo && mapPlayers.length > 0) {
      if (!mapPlayers[0].team) mapPlayers[0].team = 'T';
      mapPlayers[0].hasBomb = (mapPlayers[0].team === 'T');
    } else {
      let tCount = 0, ctCount = 0;
      mapPlayers.forEach(p => {
        if (p.team === 'CT') ctCount++;
        else if (p.team === 'T') tCount++;
      });
      mapPlayers.forEach((player) => {
        if (!player.team) {
          player.team = (tCount <= ctCount) ? 'T' : 'CT';
          if (player.team === 'T') tCount++; else ctCount++;
        }
      });
      let bombGiven = false;
      mapPlayers.forEach((player) => {
        if (player.team === 'T' && !bombGiven) {
          player.hasBomb = true;
          bombGiven = true;
        } else {
          player.hasBomb = false;
        }
      });
    }

    mapPlayers.forEach((player) => {
      io.to(player.id).emit('team_assigned', {
        team: player.team,
        hasBomb: !!player.hasBomb
      });
    });

    io.to('dust2').emit('map_state_update', {
      mode: 'tactical',
      isSolo: isSolo,
      readyCount: mapPlayers.length,
      minPlayersToStart: 1,
      minRequired: 1,
      totalPlayers: mapPlayers.length,
      tactical: {
        isSolo: isSolo,
        bombState: 'carried',
        plantedSite: null
      },
      message: isSolo
        ? 'TERRORIST MISSION (Terrace Spawn): Plant C4 at Site A or B!'
        : 'TACTICAL MATCH LIVE — Buy weapons & plant/defuse.'
    });
  }

  // Client toggles ready-up state
  socket.on('toggle_ready', () => {
    const p = players.get(socket.id);
    if (!p) return;
    p.isReady = !p.isReady;
    p.lastUpdate = Date.now();
    io.to(p.mapId).emit('player_updated', p);

    if (p.isReady) {
      forceStartMatch(p.mapId);
    } else {
      updateMapReadyState(p.mapId);
    }
  });

  // Client switches team between Terrorists (T) and Counter-Terrorists (CT)
  socket.on('switch_team', (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    const requestedTeam = (data && data.team === 'CT') ? 'CT' : 'T';
    p.team = requestedTeam;
    if (p.team === 'CT') {
      p.hasBomb = false;
    }
    p.lastUpdate = Date.now();
    socket.emit('team_assigned', { team: p.team, hasBomb: !!p.hasBomb });
    io.to(p.mapId).emit('player_updated', p);
  });

  socket.on('force_start_match', () => {
    const p = players.get(socket.id);
    forceStartMatch(p ? p.mapId : 'dust2');
  });

  socket.on('end_match', () => {
    const p = players.get(socket.id);
    const mapId = p ? p.mapId : 'dust2';
    const state = mapStates[mapId];
    if (state) {
      if (state.countdownTimer) clearInterval(state.countdownTimer);
      if (state.tactical && state.tactical.bombTimerInterval) clearInterval(state.tactical.bombTimerInterval);
      state.mode = 'freeroam';
      state.countdown = null;
      const mapPlayers = getPlayersInMap(mapId);
      mapPlayers.forEach(pl => pl.isReady = false);
      io.to(mapId).emit('map_state_update', {
        mode: 'freeroam',
        isSolo: (mapPlayers.length <= 1),
        readyCount: 0,
        minPlayersToStart: 1,
        minRequired: 1,
        totalPlayers: mapPlayers.length,
        message: 'Free Roam active — click START MATCH to begin CS test.'
      });
    }
  });

  // Client requests to join/update profile (nickname, chosen board color)
  socket.on('join_game', (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    if (data && typeof data.name === 'string' && data.name.trim().length > 0) {
      p.name = data.name.trim().slice(0, 16);
    }
    if (data && typeof data.color === 'string') {
      p.color = data.color;
    }
    p.lastUpdate = Date.now();

    // Broadcast profile update to room
    io.to(p.mapId).emit('player_updated', p);
  });

  // Continuous high-rate player telemetry update
  socket.on('player_update', (telemetry) => {
    const p = players.get(socket.id);
    if (!p || !telemetry) return;

    p.x = Number(telemetry.x) || 0;
    p.y = Number(telemetry.y) || 0;
    p.z = Number(telemetry.z) || 0;
    p.vx = Number(telemetry.vx) || 0;
    p.vy = Number(telemetry.vy) || 0;
    p.vz = Number(telemetry.vz) || 0;
    p.heading = Number(telemetry.heading) || 0;
    p.pitch = Number(telemetry.pitch) || 0;
    p.roll = Number(telemetry.roll) || 0;
    p.speed = Number(telemetry.speed) || 0;
    p.isAirborne = !!telemetry.isAirborne;
    p.isGrinding = !!telemetry.isGrinding;
    p.trick = typeof telemetry.trick === 'string' ? telemetry.trick : '';
    p.currentZone = typeof telemetry.currentZone === 'string' ? telemetry.currentZone : p.currentZone;
    if (typeof telemetry.score === 'number' && telemetry.score > p.score) {
      p.score = telemetry.score;
    }
    p.lastUpdate = Date.now();
  });

  // Trick event broadcast (scoped to player's map room)
  socket.on('trick_landed', (data) => {
    const p = players.get(socket.id);
    if (!p || !data) return;

    const trickName = String(data.trick || 'SICK TRICK').slice(0, 32);
    const points = Number(data.points) || 100;
    p.score += points;

    io.to(p.mapId).emit('trick_announcement', {
      playerId: socket.id,
      name: p.name,
      trick: trickName,
      points: points,
      totalScore: p.score
    });
  });

  // In-Game Quick Chat / Emote (scoped to player's map room)
  socket.on('chat_message', (msg) => {
    const p = players.get(socket.id);
    if (!p || !msg) return;

    const cleanText = String(msg.text || '').trim().slice(0, 60);
    if (!cleanText) return;

    io.to(p.mapId).emit('chat_broadcast', {
      id: socket.id,
      name: p.name,
      text: cleanText,
      time: Date.now()
    });
  });

  // C4 Bomb Planted by Terrorist
  socket.on('plant_c4', (data) => {
    const p = players.get(socket.id);
    if (!p || p.mapId !== 'dust2') return;
    const state = mapStates.dust2;
    if (state.mode !== 'tactical' || !state.tactical) return;
    if (state.tactical.bombState === 'planted' || state.tactical.bombState === 'exploded') return;

    state.tactical.bombState = 'planted';
    state.tactical.plantedSite = (data && data.site) || 'A';
    state.tactical.bombX = data ? Number(data.x) : 0;
    state.tactical.bombY = data ? Number(data.y) : 0;
    state.tactical.bombZ = data ? Number(data.z) : 0;
    state.tactical.bombTimer = 45;

    io.to('dust2').emit('c4_planted', {
      site: state.tactical.plantedSite,
      x: state.tactical.bombX,
      y: state.tactical.bombY,
      z: state.tactical.bombZ,
      planterName: p.name || 'Terrorist',
      timer: 45
    });

    if (state.tactical.bombTimerInterval) clearInterval(state.tactical.bombTimerInterval);
    state.tactical.bombTimerInterval = setInterval(() => {
      if (state.mode !== 'tactical' || !state.tactical) {
        clearInterval(state.tactical.bombTimerInterval);
        return;
      }
      state.tactical.bombTimer--;
      io.to('dust2').emit('c4_tick', { timer: state.tactical.bombTimer });

      if (state.tactical.bombTimer <= 0) {
        clearInterval(state.tactical.bombTimerInterval);
        state.tactical.bombTimerInterval = null;
        state.tactical.bombState = 'exploded';

        io.to('dust2').emit('c4_exploded', {
          site: state.tactical.plantedSite,
          x: state.tactical.bombX,
          y: state.tactical.bombY,
          z: state.tactical.bombZ,
          winner: 'TERRORISTS',
          message: '💣 TARGET DESTROYED! TERRORISTS WIN!'
        });

        p.score = (p.score || 0) + 1000;
        io.to('dust2').emit('player_updated', p);

        // After 6s victory celebration, return to free roam
        setTimeout(() => {
          if (state.mode === 'tactical') {
            state.mode = 'freeroam';
            state.readyCount = 0;
            const currentPlayers = getPlayersInMap('dust2');
            currentPlayers.forEach(cp => { cp.isReady = false; });
            updateMapReadyState('dust2');
          }
        }, 6000);
      }
    }, 1000);
  });

  // Combat: Player fires weapon (relay sound & tracer origin/target to other riders in map room)
  socket.on('player_shoot', (data) => {
    const p = players.get(socket.id);
    if (!p || !data) return;
    socket.to(p.mapId).emit('player_fired', {
      id: socket.id,
      origin: data.origin,
      target: data.target,
      weaponId: data.weaponId || 'glock',
      soundType: data.soundType || 'pistol'
    });
  });

  // Combat: Player registers hit on another rider
  socket.on('player_hit', (data) => {
    const attacker = players.get(socket.id);
    if (!attacker || !data || !data.targetId) return;
    const victim = players.get(data.targetId);
    if (!victim || !victim.isAlive) return;
    if (attacker.mapId !== victim.mapId) return;
    // Disable friendly fire on teammates
    if (attacker.team && victim.team && attacker.team === victim.team && attacker.id !== victim.id) return;

    // Base damage calculation with CS-style armor absorption
    let rawDamage = Math.max(1, Math.min(250, Number(data.damage) || 25));
    const isHeadshot = !!data.isHeadshot;

    let damageToHp = rawDamage;
    let armorLost = 0;
    if (victim.armor > 0) {
      const armorAbsorbRatio = 0.35; // Armor absorbs 35% damage
      damageToHp = Math.round(rawDamage * (1 - armorAbsorbRatio));
      armorLost = Math.round(rawDamage * 0.25);
      victim.armor = Math.max(0, victim.armor - armorLost);
    }

    victim.hp = Math.max(0, victim.hp - damageToHp);

    // Notify attacker (hitmarker confirm)
    socket.emit('damage_dealt', {
      targetId: victim.id,
      targetName: victim.name,
      damage: damageToHp,
      isHeadshot,
      targetHp: victim.hp,
      hitPoint: data.hitPoint
    });

    // Notify victim (pain sound, red screen vignette, health deduct)
    io.to(victim.id).emit('damage_taken', {
      attackerId: attacker.id,
      attackerName: attacker.name,
      damage: damageToHp,
      isHeadshot,
      hp: victim.hp,
      armor: victim.armor,
      hitPoint: data.hitPoint
    });

    // Broadcast updated health/armor to room
    io.to(victim.mapId).emit('player_health_update', {
      id: victim.id,
      hp: victim.hp,
      armor: victim.armor,
      isAlive: victim.hp > 0
    });

    // Check for elimination
    if (victim.hp <= 0) {
      victim.isAlive = false;
      victim.deaths = (victim.deaths || 0) + 1;
      attacker.kills = (attacker.kills || 0) + 1;
      attacker.score = (attacker.score || 0) + 300;

      io.to(victim.mapId).emit('player_killed', {
        killerId: attacker.id,
        killerName: attacker.name,
        victimId: victim.id,
        victimName: victim.name,
        weaponId: data.weaponId || 'glock',
        isHeadshot
      });

      // Bots respawn at their patrol waypoint; real players respawn in place after 3s
      if (victim.isBot) {
        scheduleBotRespawn(victim, 4000);
      } else {
        setTimeout(() => {
          if (players.has(victim.id)) {
            victim.hp = 100;
            victim.armor = 100;
            victim.isAlive = true;
            victim.x = (Math.random() - 0.5) * 8;
            victim.y = 0.25;
            victim.z = (Math.random() - 0.5) * 8;
            victim.speed = 0;
            victim.vx = 0;
            victim.vy = 0;
            victim.vz = 0;
            io.to(victim.mapId).emit('player_respawned', {
              id: victim.id,
              hp: victim.hp,
              armor: victim.armor,
              x: victim.x,
              y: victim.y,
              z: victim.z
            });
          }
        }, 3000);
      }
    }
  });

  // Client manual respawn request (Key R or Reset button)
  socket.on('respawn_player', () => {
    const p = players.get(socket.id);
    if (!p) return;
    p.hp = 100;
    p.armor = 100;
    p.isAlive = true;
    io.to(p.mapId).emit('player_respawned', {
      id: p.id,
      hp: p.hp,
      armor: p.armor,
      x: p.x,
      y: p.y,
      z: p.z
    });
  });

  // Rider Disconnection
  socket.on('disconnect', () => {
    console.log(`[-] Rider disconnected: ${socket.id}`);
    const p = players.get(socket.id);
    if (p) {
      const mapId = p.mapId;
      players.delete(socket.id);
      io.to(mapId).emit('player_left', { id: socket.id });
      updateMapReadyState(mapId);
      // Rebalance bots to fill the vacated team slot on whichever map they left
      rebalanceBots(mapId);
    }
  });
});

// Server 25Hz Snapshot Broadcast Tick Loop (40ms interval) - Scoped per Map
const TICK_RATE = 25; // 25 times per second
const TICK_INTERVAL_MS = 1000 / TICK_RATE;

// Spawn initial bots on both maps before any players connect
rebalanceBots('dust2');
rebalanceBots('park');

setInterval(() => {
  const dt = TICK_INTERVAL_MS / 1000; // delta time in seconds for this tick

  // Advance bot AI positions (patrol + combat)
  tickBots(dt);

  if (players.size === 0) return;

  const now = Date.now();
  // Prune disconnected ghosts if no update received in 30 seconds
  // (skip bots — they are managed by rebalanceBots, not lastUpdate timeout)
  for (const [id, p] of players.entries()) {
    if (p.isBot) continue;
    if (now - p.lastUpdate > 30000) {
      const mapId = p.mapId;
      players.delete(id);
      io.to(mapId).emit('player_left', { id });
      updateMapReadyState(mapId);
      rebalanceBots(mapId);
    }
  }

  // Broadcast world snapshots to respective map rooms
  for (const m of SUPPORTED_MAPS) {
    const roomPlayers = getPlayersInMap(m);
    if (roomPlayers.length > 0) {
      io.to(m).emit('world_snapshot', roomPlayers);
    }
  }
}, TICK_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  GamerWheels .IO Multiplayer Engine Online       `);
  console.log(`  Port: ${PORT}                                    `);
  console.log(`  Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`  Local URL: http://localhost:${PORT}              `);
  console.log(`==================================================`);
});
