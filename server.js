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

          // Assign teams: solo player is always Terrorist (T) on the Terrace side
          if (isSolo) {
            mapPlayers[0].team = 'T';
            mapPlayers[0].hasBomb = true;
          } else {
            mapPlayers.forEach((player, idx) => {
              player.team = (idx % 2 === 0) ? 'T' : 'CT';
              player.hasBomb = (idx === 0);
            });
          }

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

io.on('connection', (socket) => {
  console.log(`[+] Rider connected: ${socket.id}`);

  // Default to dust2 as featured map
  const defaultColor = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
  const defaultName = 'Rider_' + Math.floor(100 + Math.random() * 900);
  const defaultMap = 'dust2';

  const initialPlayer = {
    id: socket.id,
    name: defaultName,
    color: defaultColor,
    mapId: defaultMap,
    isReady: false,
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

  // Notify other clients in the same map room
  socket.to(defaultMap).emit('player_joined', initialPlayer);
  updateMapReadyState(defaultMap);

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

    // Notify new room
    socket.to(newMap).emit('player_joined', p);
    socket.emit('init_world', {
      selfId: socket.id,
      mapId: newMap,
      players: getPlayersInMap(newMap),
      mapState: mapStates[newMap]
    });
    updateMapReadyState(newMap);
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
      mapPlayers[0].team = 'T';
      mapPlayers[0].hasBomb = true;
    } else {
      mapPlayers.forEach((player, idx) => {
        player.team = (idx % 2 === 0) ? 'T' : 'CT';
        player.hasBomb = (idx === 0);
      });
    }

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

  // Rider Disconnection
  socket.on('disconnect', () => {
    console.log(`[-] Rider disconnected: ${socket.id}`);
    const p = players.get(socket.id);
    if (p) {
      const mapId = p.mapId;
      players.delete(socket.id);
      io.to(mapId).emit('player_left', { id: socket.id });
      updateMapReadyState(mapId);
    }
  });
});

// Server 25Hz Snapshot Broadcast Tick Loop (40ms interval) - Scoped per Map
const TICK_RATE = 25; // 25 times per second
const TICK_INTERVAL_MS = 1000 / TICK_RATE;

setInterval(() => {
  if (players.size === 0) return;

  const now = Date.now();
  // Prune disconnected ghosts if no update received in 30 seconds
  for (const [id, p] of players.entries()) {
    if (now - p.lastUpdate > 30000) {
      const mapId = p.mapId;
      players.delete(id);
      io.to(mapId).emit('player_left', { id });
      updateMapReadyState(mapId);
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
