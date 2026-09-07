/**
 * GamerWheels Multiplayer Client Engine (.IO Architecture)
 * Handles: Socket.io, remote player 3D meshes, smooth interpolation,
 * 3D billboard floating nametags, real-time leaderboard, trick announcements.
 */

(function () {
  'use strict';

  let socket = null;
  let selfId = null;
  let selfName = 'Rider_' + Math.floor(100 + Math.random() * 900);
  let selfColor = '#ef233c';
  let selfScore = 0;

  // Remote Players Map: id -> { id, name, color, group, wheel, shadow, nametagSprite, current, target }
  const remotePlayers = new Map();

  // DOM Elements
  let joinModal, nameInput, btnRide, onlineCountEl, leaderboardListEl, trickTickerEl, tickerTextEl;

  // Interpolation rate
  const LERP_FACTOR = 16.0;

  // Track trick points
  const TRICK_POINTS = {
    '180 SPIN': 250,
    '360 SPIN': 500,
    '540 SPIN': 1000,
    'BACKFLIP': 750,
    'FRONTFLIP': 750,
    'RODEO FLIP': 1200,
    'BIG AIR': 150,
    'KICKER POP': 200,
    'MEGA DROP LAUNCH': 500,
    'CANYON GAP CLEARED': 800,
    'RAIL GRIND': 300,
    'NOSESLIDE': 400
  };

  function initMultiplayer() {
    initDOM();
    connectSocket();
  }

  function initDOM() {
    joinModal = document.getElementById('joinModal');
    nameInput = document.getElementById('nameInput');
    btnRide = document.getElementById('btnRide');
    onlineCountEl = document.getElementById('onlineCount');
    leaderboardListEl = document.getElementById('leaderboardList');
    trickTickerEl = document.getElementById('trickTicker');
    tickerTextEl = document.getElementById('tickerText');

    // Preset random name
    if (nameInput) {
      nameInput.value = selfName;
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleJoin();
      });
    }

    if (btnRide) {
      btnRide.addEventListener('click', handleJoin);
    }

    // Color Swatches
    const swatches = document.querySelectorAll('.exp9-color-swatch');
    swatches.forEach((swatch) => {
      swatch.addEventListener('click', () => {
        swatches.forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
        selfColor = swatch.dataset.color || '#ef233c';
        if (window.GamerWheels && window.GamerWheels.setPlayerRailColor) {
          window.GamerWheels.setPlayerRailColor(selfColor);
        }
      });
    });

    // Chat bar input
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && chatInput.value.trim().length > 0) {
          sendChat(chatInput.value.trim());
          chatInput.value = '';
          chatInput.blur();
        }
      });
    }

    // Emote buttons
    const emoteBtns = document.querySelectorAll('.exp9-emote-btn');
    emoteBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const emote = btn.textContent.trim();
        sendChat(emote);
      });
    });
  }

  function handleJoin() {
    if (nameInput && nameInput.value.trim()) {
      selfName = nameInput.value.trim().slice(0, 16);
    }
    if (joinModal) {
      joinModal.classList.add('hidden');
    }

    if (window.GamerWheels && window.GamerWheels.setPlayerRailColor) {
      window.GamerWheels.setPlayerRailColor(selfColor);
    }

    if (socket && socket.connected) {
      socket.emit('join_game', { name: selfName, color: selfColor });
    }
  }

  function connectSocket() {
    if (typeof io === 'undefined') {
      console.warn('[Multiplayer] Socket.io client not loaded; running offline singleplayer.');
      return;
    }

    socket = io();

    socket.on('connect', () => {
      console.log('[Multiplayer] Connected to GamerWheels server. Socket ID:', socket.id);
      selfId = socket.id;
      socket.emit('join_game', { name: selfName, color: selfColor });
    });

    socket.on('init_world', (data) => {
      selfId = data.selfId;
      // Clear previous room's remote players
      remotePlayers.forEach((rp, id) => despawnRemotePlayer(id));
      remotePlayers.clear();

      if (Array.isArray(data.players)) {
        data.players.forEach((p) => {
          if (p.id !== selfId) spawnRemotePlayer(p);
        });
        updateLeaderboard(data.players);
      }

      if (data.mapState) {
        updateMapStateHUD(data.mapState);
        if (window.GamerWheels && window.GamerWheels.onMapStateUpdate) {
          window.GamerWheels.onMapStateUpdate(data.mapState);
        }
      }
    });

    socket.on('map_state_update', (state) => {
      updateMapStateHUD(state);
      if (window.GamerWheels && window.GamerWheels.onMapStateUpdate) {
        window.GamerWheels.onMapStateUpdate(state);
      }
    });

    socket.on('c4_planted', (data) => {
      if (window.GamerWheels && window.GamerWheels.onC4Planted) {
        window.GamerWheels.onC4Planted(data);
      }
    });

    socket.on('c4_tick', (data) => {
      if (window.GamerWheels && window.GamerWheels.onC4Tick) {
        window.GamerWheels.onC4Tick(data);
      }
    });

    socket.on('c4_exploded', (data) => {
      if (window.GamerWheels && window.GamerWheels.onC4Exploded) {
        window.GamerWheels.onC4Exploded(data);
      }
    });

    socket.on('player_fired', (data) => {
      if (window.GamerWheels && window.GamerWheels.onRemotePlayerFired) {
        window.GamerWheels.onRemotePlayerFired(data);
      }
    });

    socket.on('damage_dealt', (data) => {
      if (window.GamerWheels && window.GamerWheels.onDamageDealt) {
        window.GamerWheels.onDamageDealt(data);
      }
    });

    socket.on('damage_taken', (data) => {
      if (window.GamerWheels && window.GamerWheels.onDamageTaken) {
        window.GamerWheels.onDamageTaken(data);
      }
    });

    socket.on('player_health_update', (data) => {
      const rp = remotePlayers.get(data.id);
      if (rp) {
        rp.hp = data.hp;
        rp.armor = data.armor;
        rp.isAlive = data.isAlive;
        updateNametag(rp);
        if (!data.isAlive) {
          rp.group.visible = false;
          rp.shadow.visible = false;
        } else {
          rp.group.visible = true;
          rp.shadow.visible = true;
        }
      }
      if (window.GamerWheels && window.GamerWheels.onPlayerHealthUpdate) {
        window.GamerWheels.onPlayerHealthUpdate(data);
      }
    });

    socket.on('player_killed', (data) => {
      const rp = remotePlayers.get(data.victimId);
      if (rp) {
        rp.isAlive = false;
        rp.hp = 0;
        updateNametag(rp);
        rp.group.visible = false;
        rp.shadow.visible = false;
      }
      if (window.GamerWheels && window.GamerWheels.onPlayerKilled) {
        window.GamerWheels.onPlayerKilled(data);
      }
    });

    socket.on('player_respawned', (data) => {
      const rp = remotePlayers.get(data.id);
      if (rp) {
        rp.isAlive = true;
        rp.hp = data.hp !== undefined ? data.hp : 100;
        rp.armor = data.armor !== undefined ? data.armor : 100;
        updateNametag(rp);
        rp.group.visible = true;
        rp.shadow.visible = true;
        if (data.x !== undefined) {
          rp.current.x = data.x;
          rp.current.y = data.y;
          rp.current.z = data.z;
          rp.group.position.set(data.x, data.y, data.z);
        }
      }
      if (window.GamerWheels && window.GamerWheels.onPlayerRespawned) {
        window.GamerWheels.onPlayerRespawned(data);
      }
    });

    socket.on('team_assigned', (data) => {
      if (window.GamerWheels && window.GamerWheels.onTeamAssigned) {
        window.GamerWheels.onTeamAssigned(data);
      }
    });

    socket.on('player_joined', (p) => {
      if (p.id !== selfId) {
        spawnRemotePlayer(p);
      }
    });

    socket.on('player_updated', (p) => {
      if (p.id !== selfId) {
        const rp = remotePlayers.get(p.id);
        if (rp) {
          rp.name = p.name;
          rp.color = p.color;
          updateNametag(rp);
        }
      }
    });

    socket.on('player_left', (data) => {
      despawnRemotePlayer(data.id);
    });

    socket.on('world_snapshot', (players) => {
      if (!Array.isArray(players)) return;

      if (onlineCountEl) {
        onlineCountEl.textContent = `${players.length} Rider${players.length === 1 ? '' : 's'}`;
      }

      // Track active ids in this snapshot to prune any missed leaves
      const activeIds = new Set(players.map(p => p.id));
      remotePlayers.forEach((_, id) => {
        if (!activeIds.has(id)) {
          despawnRemotePlayer(id);
        }
      });

      players.forEach((p) => {
        if (p.id === selfId) return;

        let rp = remotePlayers.get(p.id);
        if (!rp) {
          rp = spawnRemotePlayer(p);
        }

        if (rp) {
          rp.target.x = p.x;
          rp.target.y = p.y;
          rp.target.z = p.z;
          rp.target.heading = p.heading;
          rp.target.pitch = p.pitch;
          rp.target.roll = p.roll;
          rp.target.speed = p.speed;
          rp.target.isAirborne = p.isAirborne;
          rp.target.isGrinding = p.isGrinding;
          rp.target.trick = p.trick;
          rp.score = p.score || 0;
          rp.name = p.name || rp.name;
        }
      });

      updateLeaderboard(players);
    });

    socket.on('trick_announcement', (data) => {
      showGlobalTrickTicker(data);
    });

    socket.on('chat_broadcast', (data) => {
      const rp = remotePlayers.get(data.id);
      if (rp) {
        flashRemotePlayerChat(rp, data.text);
      }
    });

    socket.on('disconnect', () => {
      console.log('[Multiplayer] Disconnected from server.');
      remotePlayers.forEach((rp, id) => despawnRemotePlayer(id));
      remotePlayers.clear();
      if (onlineCountEl) onlineCountEl.textContent = 'Offline';
    });
  }

  // Update HUD state for CS mode / Free Roam
  function updateMapStateHUD(state) {
    const matchBanner = document.getElementById('matchBanner');
    const matchModeText = document.getElementById('matchModeText');
    const matchStatusMsg = document.getElementById('matchStatusMsg');
    const readyCountBadge = document.getElementById('readyCountBadge');

    if (!matchBanner || !state) return;

    matchBanner.className = 'exp9-match-banner ' + (state.mode || 'freeroam');

    const btnForceStart = document.getElementById('btnForceStart');
    const btnReadyUp = document.getElementById('btnReadyUp');
    const btnEndMatch = document.getElementById('btnEndMatch');

    if (state.mode === 'freeroam') {
      if (matchModeText) matchModeText.textContent = 'FREE ROAM';
      if (matchStatusMsg) {
        matchStatusMsg.textContent = state.message || 'Ready up or click START MATCH to begin';
      }
      if (btnForceStart) btnForceStart.classList.remove('hidden');
      if (btnReadyUp) btnReadyUp.classList.remove('hidden');
      if (btnEndMatch) btnEndMatch.classList.add('hidden');
    } else if (state.mode === 'countdown') {
      if (matchModeText) matchModeText.textContent = `STARTING IN ${state.countdown || 5}s`;
      if (matchStatusMsg) {
        matchStatusMsg.textContent = `Get ready! Match begins in ${state.countdown}s`;
      }
      if (btnForceStart) btnForceStart.classList.remove('hidden');
      if (btnReadyUp) btnReadyUp.classList.remove('hidden');
      if (btnEndMatch) btnEndMatch.classList.add('hidden');
    } else if (state.mode === 'tactical' || state.mode === 'match') {
      if (matchModeText) matchModeText.textContent = 'TACTICAL MATCH';
      if (matchStatusMsg) {
        matchStatusMsg.textContent = state.message || 'CS Mode Active — Buy Weapons & Plant/Defuse';
      }
      if (btnForceStart) btnForceStart.classList.add('hidden');
      if (btnReadyUp) btnReadyUp.classList.add('hidden');
      if (btnEndMatch) btnEndMatch.classList.remove('hidden');
    }

    if (readyCountBadge) {
      const readyNum = state.readyCount !== undefined ? state.readyCount : 0;
      const minNum = state.minPlayersToStart || state.minRequired || 1;
      readyCountBadge.textContent = `${readyNum}/${minNum}`;
    }
  }

  // 3D Canvas Nametag Billboard Generator
  function createNametagSprite(name, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');

    drawNametagCanvas(ctx, canvas.width, canvas.height, name, colorHex, '', 100);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.4, 0.4, 1);
    sprite.position.set(0, 1.85, 0); // Above the rider
    sprite.raycast = () => {}; // Never intercept weapon rays!

    return { sprite, canvas, ctx, texture };
  }

  function drawNametagCanvas(ctx, w, h, name, colorHex, trickText, hp = 100) {
    ctx.clearRect(0, 0, w, h);

    // Pill background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.strokeStyle = colorHex || '#6366f1';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, h - 12, 18);
    ctx.fill();
    ctx.stroke();

    // Color indicator dot
    ctx.fillStyle = colorHex || '#6366f1';
    ctx.beginPath();
    ctx.arc(26, 24, 7, 0, Math.PI * 2);
    ctx.fill();

    // Rider name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0, 14), 42, 24);

    // Overhead Health Bar
    const barX = 42;
    const barY = 42;
    const barW = w - 60;
    const barH = 12;

    // Track
    ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    // HP Fill
    const pct = Math.max(0, Math.min(1.0, (hp !== undefined ? hp : 100) / 100));
    const fillW = Math.max(0, barW * pct);
    if (fillW > 0) {
      ctx.fillStyle = pct > 0.5 ? '#22c55e' : (pct > 0.25 ? '#eab308' : '#ef4444');
      ctx.beginPath();
      ctx.roundRect(barX, barY, fillW, barH, 4);
      ctx.fill();
    }
  }

  function updateNametag(rp, trickText = '') {
    if (!rp || !rp.nametag) return;
    drawNametagCanvas(
      rp.nametag.ctx,
      rp.nametag.canvas.width,
      rp.nametag.canvas.height,
      rp.name,
      rp.color,
      trickText,
      rp.hp !== undefined ? rp.hp : 100
    );
    rp.nametag.texture.needsUpdate = true;
  }

  function spawnRemotePlayer(p) {
    if (!window.GamerWheels || !window.GamerWheels.scene) return null;

    const board = window.GamerWheels.createBoardMesh(p.color || '#ef233c');
    const nametag = createNametagSprite(p.name || 'Rider', p.color || '#ef233c');
    board.group.add(nametag.sprite);

    // Hitbox cylinder for weapon bullet hits & damage registration
    const hitboxGeo = new THREE.CylinderGeometry(0.50, 0.50, 1.80, 12);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitboxMesh.position.set(0, 0.90, 0); // 0 to 1.80m standing height
    hitboxMesh.userData = {
      isPlayerHitbox: true,
      playerId: p.id
    };
    board.group.add(hitboxMesh);

    // Position initial
    board.group.position.set(p.x, p.y, p.z);
    board.group.rotation.y = p.heading;
    board.shadow.position.set(p.x, p.y + 0.015, p.z);

    window.GamerWheels.scene.add(board.group);
    window.GamerWheels.scene.add(board.shadow);

    const remoteObj = {
      id: p.id,
      name: p.name || 'Rider',
      color: p.color || '#ef233c',
      hp: p.hp !== undefined ? p.hp : 100,
      armor: p.armor !== undefined ? p.armor : 100,
      isAlive: p.isAlive !== undefined ? p.isAlive : true,
      group: board.group,
      wheel: board.wheel,
      shadow: board.shadow,
      hitbox: hitboxMesh,
      nametag: nametag,
      score: p.score || 0,
      current: {
        x: p.x,
        y: p.y,
        z: p.z,
        heading: p.heading,
        pitch: p.pitch,
        roll: p.roll,
        speed: p.speed
      },
      target: {
        x: p.x,
        y: p.y,
        z: p.z,
        heading: p.heading,
        pitch: p.pitch,
        roll: p.roll,
        speed: p.speed,
        isAirborne: p.isAirborne,
        isGrinding: p.isGrinding,
        trick: p.trick
      }
    };

    remotePlayers.set(p.id, remoteObj);
    return remoteObj;
  }

  function despawnRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if (!rp) return;

    if (window.GamerWheels && window.GamerWheels.scene) {
      window.GamerWheels.scene.remove(rp.group);
      window.GamerWheels.scene.remove(rp.shadow);
    }
    remotePlayers.delete(id);
  }

  function updateLeaderboard(players) {
    if (!leaderboardListEl) return;

    // Sort descending by score, then speed
    const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.speed || 0) - (a.speed || 0));

    leaderboardListEl.innerHTML = '';
    sorted.slice(0, 10).forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'exp9-leaderboard-row' + (p.id === selfId ? ' self' : '');

      const userGroup = document.createElement('div');
      userGroup.className = 'exp9-leaderboard-user';

      const rank = document.createElement('span');
      rank.className = 'exp9-leaderboard-rank';
      rank.textContent = idx + 1;

      const dot = document.createElement('span');
      dot.className = 'exp9-leaderboard-dot';
      dot.style.backgroundColor = p.color || '#6366f1';

      const name = document.createElement('span');
      name.className = 'exp9-leaderboard-name';
      name.textContent = p.name;

      userGroup.appendChild(rank);
      userGroup.appendChild(dot);
      userGroup.appendChild(name);

      const score = document.createElement('span');
      score.className = 'exp9-leaderboard-score';
      score.textContent = (p.score || 0).toLocaleString();

      row.appendChild(userGroup);
      row.appendChild(score);
      leaderboardListEl.appendChild(row);
    });
  }

  let tickerTimeout = null;
  function showGlobalTrickTicker(data) {
    if (!trickTickerEl || !tickerTextEl) return;

    tickerTextEl.textContent = `🔥 ${data.name} landed ${data.trick}! (+${data.points} pts)`;
    trickTickerEl.classList.add('visible');

    clearTimeout(tickerTimeout);
    tickerTimeout = setTimeout(() => {
      trickTickerEl.classList.remove('visible');
    }, 2800);

    // If it's a remote player, show it over their 3D nametag
    const rp = remotePlayers.get(data.playerId);
    if (rp) {
      updateNametag(rp, `★ ${data.trick}`);
      setTimeout(() => updateNametag(rp, ''), 2800);
    }
  }

  function flashRemotePlayerChat(rp, text) {
    updateNametag(rp, `💬 "${text}"`);
    setTimeout(() => updateNametag(rp, ''), 3500);
  }

  function sendChat(text) {
    if (!socket || !socket.connected) return;
    socket.emit('chat_message', { text });
  }

  // Hook called every frame from game.js
  let lastBroadcast = 0;
  function onGameTick(dt, localPlayer) {
    const now = performance.now();

    // 1. Send Telemetry to Server at ~22Hz (every 45ms)
    if (socket && socket.connected && now - lastBroadcast > 45) {
      lastBroadcast = now;
      socket.emit('player_update', {
        x: Number(localPlayer.x.toFixed(3)),
        y: Number(localPlayer.y.toFixed(3)),
        z: Number(localPlayer.z.toFixed(3)),
        vx: Number(localPlayer.vx.toFixed(2)),
        vy: Number(localPlayer.vy.toFixed(2)),
        vz: Number(localPlayer.vz.toFixed(2)),
        heading: Number(localPlayer.heading.toFixed(3)),
        pitch: Number(localPlayer.pitch.toFixed(3)),
        roll: Number(localPlayer.roll.toFixed(3)),
        speed: Number(localPlayer.speed.toFixed(2)),
        isAirborne: localPlayer.isAirborne,
        isGrinding: localPlayer.isGrinding,
        currentZone: localPlayer.currentZone,
        score: selfScore
      });
    }

    // 2. Interpolate all Remote Riders
    const lerpAlpha = Math.min(dt * LERP_FACTOR, 1.0);
    remotePlayers.forEach((rp) => {
      const cur = rp.current;
      const tgt = rp.target;

      // Position Lerp with wall collision resolution for bots/remote riders
      const nextX = cur.x + (tgt.x - cur.x) * lerpAlpha;
      const nextZ = cur.z + (tgt.z - cur.z) * lerpAlpha;
      cur.y += (tgt.y - cur.y) * lerpAlpha;

      if (window.GamerWheels && typeof window.GamerWheels.checkDust2Wall === 'function') {
        const moveX = nextX - cur.x;
        const moveZ = nextZ - cur.z;
        const BOT_RADIUS = 0.35;

        // Test X movement against walls
        if (Math.abs(moveX) > 0.0001) {
          const dirX = Math.sign(moveX);
          const wallX = window.GamerWheels.checkDust2Wall(cur.x, cur.y, cur.z, dirX, 0, BOT_RADIUS + Math.abs(moveX));
          if (wallX && wallX.distance <= (BOT_RADIUS + Math.abs(moveX))) {
            const allowedX = Math.max(0, wallX.distance - BOT_RADIUS);
            cur.x += dirX * allowedX;
          } else {
            cur.x = nextX;
          }
        } else {
          cur.x = nextX;
        }

        // Test Z movement against walls
        if (Math.abs(moveZ) > 0.0001) {
          const dirZ = Math.sign(moveZ);
          const wallZ = window.GamerWheels.checkDust2Wall(cur.x, cur.y, cur.z, 0, dirZ, BOT_RADIUS + Math.abs(moveZ));
          if (wallZ && wallZ.distance <= (BOT_RADIUS + Math.abs(moveZ))) {
            const allowedZ = Math.max(0, wallZ.distance - BOT_RADIUS);
            cur.z += dirZ * allowedZ;
          } else {
            cur.z = nextZ;
          }
        } else {
          cur.z = nextZ;
        }
      } else {
        cur.x = nextX;
        cur.z = nextZ;
      }

      // Heading angular lerp
      let dHeading = tgt.heading - cur.heading;
      while (dHeading < -Math.PI) dHeading += Math.PI * 2;
      while (dHeading > Math.PI) dHeading -= Math.PI * 2;
      cur.heading += dHeading * lerpAlpha;

      // Pitch & Roll Lerp
      cur.pitch += (tgt.pitch - cur.pitch) * lerpAlpha;
      cur.roll += (tgt.roll - cur.roll) * lerpAlpha;
      cur.speed += (tgt.speed - cur.speed) * lerpAlpha;

      // Apply to 3D meshes (prevent bots/riders from clipping into or sinking under floor)
      let meshY = cur.y;
      if (window.GamerWheels && typeof window.GamerWheels.getSurfaceElevation === 'function') {
        const groundElevation = window.GamerWheels.getSurfaceElevation(cur.x, cur.z);
        if (groundElevation !== null && groundElevation !== undefined && !isNaN(groundElevation) && groundElevation > -10) {
          meshY = Math.max(meshY, groundElevation);
        }
      }

      rp.group.position.set(cur.x, meshY, cur.z);
      rp.group.rotation.y = cur.heading;
      rp.group.rotation.x = cur.pitch;
      rp.group.rotation.z = cur.roll;

      // Wheel Spin
      if (rp.wheel) {
        rp.wheel.rotateX((cur.speed / (window.GamerWheels.TIRE_RADIUS || 0.14)) * dt);
      }

      // Shadow
      rp.shadow.position.set(cur.x, meshY + 0.015, cur.z);
      rp.shadow.rotation.y = cur.heading;
      const jumpHeight = Math.max(0, meshY - (window.GamerWheels && window.GamerWheels.getSurfaceElevation ? window.GamerWheels.getSurfaceElevation(cur.x, cur.z) : cur.y));
      const shadowScale = Math.max(0.45, 1 - jumpHeight * 0.35);
      rp.shadow.scale.set(shadowScale, shadowScale, shadowScale);
    });
  }

  // Hook called when local player lands a trick
  function onTrickLanded(trickName) {
    const pts = TRICK_POINTS[trickName] || 200;
    selfScore += pts;

    if (socket && socket.connected) {
      socket.emit('trick_landed', { trick: trickName, points: pts });
    }
  }

  let isSelfReady = false;

  function changeMap(mapId) {
    if (!socket || !socket.connected) return;
    remotePlayers.forEach((rp, id) => despawnRemotePlayer(id));
    remotePlayers.clear();
    isSelfReady = false;
    updateReadyButtonUI(false);
    socket.emit('change_map', { mapId });
  }

  function toggleReady() {
    if (!socket || !socket.connected) return;
    isSelfReady = !isSelfReady;
    updateReadyButtonUI(isSelfReady);
    socket.emit('toggle_ready');
  }

  function updateReadyButtonUI(ready) {
    const btnReadyUp = document.getElementById('btnReadyUp');
    const readyBtnLabel = document.getElementById('readyBtnLabel');
    if (!btnReadyUp) return;
    btnReadyUp.classList.toggle('ready', ready);
    if (readyBtnLabel) {
      readyBtnLabel.textContent = ready ? 'READY!' : 'READY UP (F)';
    }
  }

  function forceStartMatch() {
    if (socket && socket.connected) {
      socket.emit('force_start_match');
    }
  }

  function endMatch() {
    if (socket && socket.connected) {
      socket.emit('end_match');
    }
  }

  // Setup ready button, force start button, and key listeners
  window.addEventListener('DOMContentLoaded', () => {
    const btnReadyUp = document.getElementById('btnReadyUp');
    if (btnReadyUp) {
      btnReadyUp.addEventListener('click', () => {
        toggleReady();
        forceStartMatch();
      });
    }

    const btnForceStart = document.getElementById('btnForceStart');
    if (btnForceStart) {
      btnForceStart.addEventListener('click', forceStartMatch);
    }

    const btnEndMatch = document.getElementById('btnEndMatch');
    if (btnEndMatch) {
      btnEndMatch.addEventListener('click', endMatch);
    }

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === 'f' || e.key === 'F') {
        toggleReady();
        forceStartMatch();
      }
      if (e.key === 'g' || e.key === 'G') {
        forceStartMatch();
      }
      if (e.key === 'm' || e.key === 'M') {
        // Toggle team switch shortcut
        const currentTeam = (window.GamerWheels && window.GamerWheels.getPlayerTeam) ? window.GamerWheels.getPlayerTeam() : 'T';
        const newTeam = currentTeam === 'T' ? 'CT' : 'T';
        if (socket && socket.connected) {
          socket.emit('switch_team', { team: newTeam });
        }
      }
    });
  });

  function getPlayerHitboxes() {
    const boxes = [];
    remotePlayers.forEach((rp) => {
      if (rp.hitbox && rp.isAlive !== false) {
        boxes.push(rp.hitbox);
      }
    });
    return boxes;
  }

  // Expose to window for game.js hook
  window.GamerWheelsMultiplayer = {
    onGameTick,
    onTrickLanded,
    sendChat,
    changeMap,
    toggleReady,
    forceStartMatch,
    endMatch,
    switchTeam: (team) => {
      if (socket && socket.connected) {
        socket.emit('switch_team', { team });
      }
    },
    plantC4: (site, x, y, z) => {
      if (socket && socket.connected) {
        socket.emit('plant_c4', { site, x, y, z });
      }
    },
    sendHit: (targetId, damage, isHeadshot, weaponId, hitPoint) => {
      if (socket && socket.connected) {
        socket.emit('player_hit', { targetId, damage, isHeadshot, weaponId, hitPoint });
      }
    },
    sendShoot: (origin, target, weaponId, soundType) => {
      if (socket && socket.connected) {
        socket.emit('player_shoot', { origin, target, weaponId, soundType });
      }
    },
    sendRespawn: () => {
      if (socket && socket.connected) {
        socket.emit('respawn_player');
      }
    },
    getPlayerHitboxes,
    getRemotePlayers: () => remotePlayers,
    getSelfId: () => selfId
  };

  window.addEventListener('DOMContentLoaded', initMultiplayer);
})();

