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

// Dust2 patrol waypoints {x, z, y} — along actual corridors & open pathways
const BOT_DUST2_WAYPOINTS = [
  { x:  -8.0, z:  32.0, y: 2.58 },   // 0: T Spawn Terrace
  { x:  -2.0, z:  24.0, y: 1.40 },   // 1: Top of Mid / Suicide
  { x:   0.5, z:  11.3, y: 0.38 },   // 2: Mid Doors
  { x:  -2.0, z:  -8.0, y: 0.38 },   // 3: Lower Mid / Under Short
  { x: -14.0, z: -15.0, y: 0.38 },   // 4: B Lower / B Doors entry
  { x: -25.0, z: -15.0, y: 0.38 },   // 5: B Bomb Site
  { x: -25.0, z: -25.0, y: 0.38 },   // 6: CT to B Ramp
  { x: -25.0, z: -35.0, y: 0.38 },   // 7: CT Spawn (under cat, ground floor)
  { x: -10.0, z: -35.0, y: 0.38 },   // 8: CT Spawn to A Ramp
  { x:   8.0, z: -30.0, y: 1.20 },   // 9: Short A / CT Cross
  { x:  20.0, z: -25.0, y: 2.03 },   // 10: A Bomb Site
  { x:  20.0, z:  -5.0, y: 0.38 },   // 11: Long A Corner
  { x:  14.0, z:  18.0, y: 0.38 },   // 12: Long Doors
  { x:   5.0, z:  30.0, y: 1.80 },   // 13: Outside Long / T Yard
];

// Park patrol waypoints — skip Mega Drop (7m tower, bots can't jump there)
const BOT_PARK_WAYPOINTS = [
  { x:   0.0, z:   0.0, y: 0.38 },   // 0: Plaza Center
  { x:  55.0, z:  42.0, y: 3.62 },   // 1: Pine Ridge Slopestyle
  { x: -58.0, z:  42.0, y: 3.42 },   // 2: Slickrock MX
  { x:   0.0, z:  56.0, y: 0.42 },   // 3: Desert Berms
];

// Bot AI state map: botId -> bot object (also inserted into `players` Map)
const bots = new Map();
let botIdCounter = 0;

/**
 * Create a bot for the given team and map.
 * @param {'T'|'CT'|'PARK'} team
 * @param {'dust2'|'park'} mapId
 */
function createBot(team, mapId = 'dust2') {
  const id = `bot-${++botIdCounter}`;
  const isPark = mapId === 'park';
  const isT    = team === 'T';

  const namePool  = isPark ? BOT_NAMES_PARK  : (isT ? BOT_NAMES_T  : BOT_NAMES_CT);
  const colorPool = isPark ? BOT_COLORS_PARK : (isT ? BOT_COLORS_T : BOT_COLORS_CT);
  const waypoints = isPark ? BOT_PARK_WAYPOINTS : BOT_DUST2_WAYPOINTS;

  // T bots start from T-spawn (idx 0), CT from CT-spawn (idx 7), park bots spread out
  const startWpIdx = isPark
    ? (botIdCounter % waypoints.length)
    : (isT ? 0 : 7);
  const wp = waypoints[startWpIdx];

  const bot = {
    id,
    name:  namePool[botIdCounter % namePool.length],
    color: colorPool[botIdCounter % colorPool.length],
    mapId,
    team: isPark ? 'T' : team, // park bots have no real team; use T as neutral
    isBot: true,
    isReady: false,
    hp: 100, maxHp: 100, armor: 100,
    isAlive: true,
    kills: 0, deaths: 0, score: 0,
    x: wp.x + (Math.random() - 0.5) * 2,
    y: wp.y,
    z: wp.z + (Math.random() - 0.5) * 2,
    vx: 0, vy: 0, vz: 0,
    heading: Math.random() * Math.PI * 2,
    pitch: 0, roll: 0, speed: 0,
    isAirborne: false, isGrinding: false,
    trick: '',
    currentZone: isPark ? 'Central Town Square' : 'Dust 2',
    lastUpdate: Date.now(),
    // AI steering state
    waypointIdx: startWpIdx,
    fsm: 'patrol',         // 'patrol' | 'attack'
    lastFireTime: 0,       // ms timestamp of last shot
    respawnWpIdx: startWpIdx, // waypoint to respawn at
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

/**
 * Keep each team/map topped up to TARGET_PER_TEAM members (real + bots).
 * @param {'dust2'|'park'|null} changedMap  Pass map to scope update; null = all maps.
 */
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
      const TARGET   = 2; // 2 neutral roaming bots on park
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

/** Respawn a dead bot back to its home waypoint after a delay (ms). */
function scheduleBotRespawn(bot, delayMs = 4000) {
  setTimeout(() => {
    if (!bots.has(bot.id)) return; // bot was removed during the delay
    const waypoints = bot.mapId === 'park' ? BOT_PARK_WAYPOINTS : BOT_DUST2_WAYPOINTS;
    const wp = waypoints[bot.respawnWpIdx];
    bot.hp = 100;
    bot.armor = 100;
    bot.isAlive = true;
    bot.fsm = 'patrol';
    bot.x = wp.x + (Math.random() - 0.5) * 2;
    bot.y = wp.y;
    bot.z = wp.z + (Math.random() - 0.5) * 2;
    bot.speed = 0;
    bot.waypointIdx = bot.respawnWpIdx;
    bot.lastUpdate = Date.now();
    io.to(bot.mapId).emit('player_respawned', {
      id: bot.id, hp: 100, armor: 100,
      x: bot.x, y: bot.y, z: bot.z
    });
  }, delayMs);
}

/**
 * Advance all bot positions each server tick.
 * Handles patrol (both maps) and attack FSM (dust2 tactical only).
 * @param {number} dt - Delta time in seconds
 */
function tickBots(dt) {
  const BOT_SPEED      = 6.705; // m/s patrol cruise ≈ 15.0 MPH
  const ARRIVE_DIST    = 1.5;   // m — waypoint switch threshold
  const TURN_RATE      = 4.0;   // rad/s heading lerp
  const ATTACK_RANGE   = 28;    // m — detection radius for shooting
  const FIRE_COOLDOWN  = 2000;  // ms between shots
  const BOT_DAMAGE     = 22;    // HP per shot (Glock-level)
  const ARMOR_LOSS     = 8;     // armor lost per shot

  const now = Date.now();
  const dust2Tactical = mapStates.dust2.mode === 'tactical';

  for (const bot of bots.values()) {
    if (!bot.isAlive) continue;

    const waypoints = bot.mapId === 'park' ? BOT_PARK_WAYPOINTS : BOT_DUST2_WAYPOINTS;

    // ── Attack FSM (dust2 tactical mode only) ──────────────────────────────
    let attackTarget = null;
    if (bot.mapId === 'dust2' && dust2Tactical) {
      let nearestDist = Infinity;
      for (const p of players.values()) {
        if (p.isBot || p.mapId !== 'dust2' || !p.isAlive) continue;
        const d = Math.hypot(p.x - bot.x, p.z - bot.z);
        if (d < nearestDist) { nearestDist = d; attackTarget = p; }
      }

      if (attackTarget && nearestDist < ATTACK_RANGE) {
        bot.fsm = 'attack';

        // Fire if cooldown elapsed
        if (now - bot.lastFireTime > FIRE_COOLDOWN) {
          bot.lastFireTime = now;

          // Bullet tracer (visual on all clients)
          io.to('dust2').emit('player_fired', {
            id: bot.id,
            origin: { x: bot.x, y: bot.y + 0.9, z: bot.z },
            target: { x: attackTarget.x, y: attackTarget.y + 0.9, z: attackTarget.z },
            weaponId: 'glock',
            soundType: 'pistol'
          });

          // Apply damage directly server-side
          if (attackTarget.isAlive) {
            let dmg = BOT_DAMAGE;
            if (attackTarget.armor > 0) {
              dmg = Math.round(dmg * 0.65); // armor absorbs 35%
              attackTarget.armor = Math.max(0, attackTarget.armor - ARMOR_LOSS);
            }
            attackTarget.hp = Math.max(0, attackTarget.hp - dmg);

            // Pain feedback to victim
            io.to(attackTarget.id).emit('damage_taken', {
              attackerId:   bot.id,
              attackerName: bot.name,
              damage:       dmg,
              isHeadshot:   false,
              hp:           attackTarget.hp,
              armor:        attackTarget.armor,
            });

            // Health update to whole room
            io.to('dust2').emit('player_health_update', {
              id:      attackTarget.id,
              hp:      attackTarget.hp,
              armor:   attackTarget.armor,
              isAlive: attackTarget.hp > 0,
            });

            // Kill
            if (attackTarget.hp <= 0) {
              attackTarget.isAlive = false;
              attackTarget.deaths  = (attackTarget.deaths || 0) + 1;
              bot.kills  = (bot.kills  || 0) + 1;
              bot.score  = (bot.score  || 0) + 300;
              io.to('dust2').emit('player_killed', {
                killerId:   bot.id,
                killerName: bot.name,
                victimId:   attackTarget.id,
                victimName: attackTarget.name,
                weaponId:   'glock',
                isHeadshot: false,
              });
              // Respawn victim after 3s (mirrors real player_hit respawn)
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
      }
    }

    // ── Steering ───────────────────────────────────────────────────────────
    let targetX, targetZ, targetY;
    if (bot.fsm === 'attack' && attackTarget) {
      // Chase: steer toward player
      targetX = attackTarget.x;
      targetZ = attackTarget.z;
      targetY = bot.y; // keep current y during chase
    } else {
      // Patrol: steer toward next waypoint
      const wp = waypoints[bot.waypointIdx];
      targetX = wp.x;
      targetZ = wp.z;
      targetY = wp.y;
    }

    const dx   = targetX - bot.x;
    const dz   = targetZ - bot.z;
    const dist = Math.hypot(dx, dz);

    // Advance patrol waypoint when close enough
    if (bot.fsm === 'patrol' && dist < ARRIVE_DIST) {
      bot.waypointIdx = (bot.waypointIdx + 1) % waypoints.length;
    }

    const desiredHeading = Math.atan2(dx, dz);
    let dh = desiredHeading - bot.heading;
    while (dh < -Math.PI) dh += Math.PI * 2;
    while (dh >  Math.PI) dh -= Math.PI * 2;
    bot.heading += dh * Math.min(1.0, TURN_RATE * dt);

    // Arrive speed scaling (only during patrol; full speed when chasing)
    const arriveScale = bot.fsm === 'attack'
      ? 1.0
      : Math.min(1.0, dist / (ARRIVE_DIST * 4));
    bot.speed = BOT_SPEED * arriveScale;

    bot.roll = dh * -0.12; // gentle carving roll

    bot.x += Math.sin(bot.heading) * bot.speed * dt;
    bot.z += Math.cos(bot.heading) * bot.speed * dt;
    if (bot.fsm === 'patrol') bot.y = Math.max(0.0, targetY); // clamp above world floor

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
