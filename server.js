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

// In-Memory Player World State
const players = new Map();

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

  // Default player state upon connection
  const defaultColor = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
  const defaultName = 'Rider_' + Math.floor(100 + Math.random() * 900);

  const initialPlayer = {
    id: socket.id,
    name: defaultName,
    color: defaultColor,
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
    currentZone: 'Central Town Square',
    lastUpdate: Date.now()
  };

  players.set(socket.id, initialPlayer);

  // Send initial world state and assigned socket ID to the new player
  socket.emit('init_world', {
    selfId: socket.id,
    players: Array.from(players.values())
  });

  // Notify all other clients that a new rider joined
  socket.broadcast.emit('player_joined', initialPlayer);

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

    // Broadcast profile update
    io.emit('player_updated', p);
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

  // Trick event broadcast (for global trick ticker & killfeed)
  socket.on('trick_landed', (data) => {
    const p = players.get(socket.id);
    if (!p || !data) return;

    const trickName = String(data.trick || 'SICK TRICK').slice(0, 32);
    const points = Number(data.points) || 100;
    p.score += points;

    io.emit('trick_announcement', {
      playerId: socket.id,
      name: p.name,
      trick: trickName,
      points: points,
      totalScore: p.score
    });
  });

  // In-Game Quick Chat / Emote
  socket.on('chat_message', (msg) => {
    const p = players.get(socket.id);
    if (!p || !msg) return;

    const cleanText = String(msg.text || '').trim().slice(0, 60);
    if (!cleanText) return;

    io.emit('chat_broadcast', {
      id: socket.id,
      name: p.name,
      text: cleanText,
      time: Date.now()
    });
  });

  // Rider Disconnection
  socket.on('disconnect', () => {
    console.log(`[-] Rider disconnected: ${socket.id}`);
    players.delete(socket.id);
    io.emit('player_left', { id: socket.id });
  });
});

// Server 25Hz Snapshot Broadcast Tick Loop (40ms interval)
const TICK_RATE = 25; // 25 times per second
const TICK_INTERVAL_MS = 1000 / TICK_RATE;

setInterval(() => {
  if (players.size === 0) return;

  const now = Date.now();
  // Prune disconnected ghosts if no update received in 30 seconds
  for (const [id, p] of players.entries()) {
    if (now - p.lastUpdate > 30000) {
      players.delete(id);
      io.emit('player_left', { id });
    }
  }

  // Broadcast world snapshot to all clients
  const snapshot = Array.from(players.values());
  io.emit('world_snapshot', snapshot);
}, TICK_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  GamerWheels .IO Multiplayer Engine Online       `);
  console.log(`  Port: ${PORT}                                    `);
  console.log(`  Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`  Local URL: http://localhost:${PORT}              `);
  console.log(`==================================================`);
});
