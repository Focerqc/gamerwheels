/**
 * GamerWheels RFTR — Race for the Rail Hollister Hills Edition
 * Focused Onewheel Physics, Outdoor Free-Roam Terrain, 3D Track Gates & Ghost Racing
 * Author: Quinn Foster
 */

(function () {
  'use strict';

  // ==========================================================================
  // Core Constants & Physics Parameters
  // ==========================================================================
  const TIRE_RADIUS = 0.14;       // 11.5" x 6.5-6 go-kart tire (~28cm dia)
  const MAX_SPEED = 14.3;         // ~32.0 MPH top speed
  const PUSHBACK_SPEED = 9.8;     // ~22.0 MPH pushback tilt threshold
  const ACCELERATION = 9.8;       // High-torque Hypercore / Superflux acceleration
  const BRAKE_DECEL = 16.0;       // Regenerative braking force
  const TURN_SPEED = 4.2;         // Carving agility
  const GRAVITY = 24.0;           // Gravity m/s^2
  const JUMP_IMPULSE = 6.2;       // Hop / de-weight jump impulse

  // ==========================================================================
  // Game State
  // ==========================================================================
  const state = {
    clock: new THREE.Clock(),
    world: {
      mode: 'track',
      activeMap: 'RFTR_Hollister'
    },
    player: {
      x: 160.0,
      y: 1.5,
      z: -69.1,
      groundY: 1.5,
      vx: 0,
      vy: 0,
      vz: 0,
      speed: 0,
      heading: -1.716, // Facing down the Start Chute towards Node 1
      pitch: 0,
      roll: 0,
      isAirborne: false,
      airtime: 0,
      jumpCharge: 0,
      isPushback: false,
      pushbackTilt: 0,
      butterTilt: 0,
      butterTimer: 0,
      isGrinding: false,
      score: 0
    },
    camera: {
      yaw: -1.716 + Math.PI,
      pitch: 0.32,
      distance: 3.4,
      targetDistance: 3.4,
      manualTimer: 0,
      isOrbiting: false,
      lastPointerX: 0,
      lastPointerY: 0,
      lookTarget: null
    },
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      jump: false,
      jumpPressed: false,
      twistUp: false,
      twistDown: false,
      twistLeft: false,
      twistRight: false,
      butterNoseLeft: false,
      butterNoseRight: false,
      butterTailLeft: false,
      butterTailRight: false,
      joystickActive: false,
      joystickVector: { x: 0, y: 0 }
    },
    particles: [],
    trackObstacles: []
  };

  // Track Session & Ghost Racing Manager State
  const trackSession = {
    state: 'primed', // 'unprimed' | 'primed' | 'racing' | 'finished'
    lap: 0,
    lapStartTime: 0,
    lapElapsed: 0,
    lastLapTime: null,
    bestLapTime: null,
    lastFinishCrossingTime: 0,
    ghostEntity: null,
    ghostActive: false,
    ghostElapsed: 0,
    activeTrackData: null
  };

  // Three.js Core Globals
  let scene, camera, renderer;
  let sunLight, hemiLight;
  let boardGroup, wheelMesh, chassisMesh, boardShadow;
  let terrainMesh;

  // DOM Elements
  let gameCanvas;
  let hudSpeedVal, hudSpeedBar, hudTerrainVal;
  let compassArrow, compassDist, compassCard;
  let trickToast, trickText, trickTicker, tickerText;
  let btnRespawn, btnFullscreen, btnZoomIn, btnZoomOut, btnOpenTrackStudio;
  let trackRacingHud, trackLapStatus, trackLapTimer, trackLapSplit, trackGhostTarget;

  // ==========================================================================
  // 1. DOM Initialization
  // ==========================================================================
  function initDOMElements() {
    gameCanvas = document.getElementById('gameCanvas');
    hudSpeedVal = document.getElementById('hudSpeedVal');
    hudSpeedBar = document.getElementById('hudSpeedBar');
    hudTerrainVal = document.getElementById('hudTerrainVal');

    compassArrow = document.getElementById('compassArrow');
    compassDist = document.getElementById('compassDist');
    compassCard = document.getElementById('compassCard');

    trickToast = document.getElementById('trickToast');
    trickText = document.getElementById('trickText');
    trickTicker = document.getElementById('trickTicker');
    tickerText = document.getElementById('tickerText');

    btnRespawn = document.getElementById('btnRespawn');
    btnFullscreen = document.getElementById('btnFullscreen');
    btnZoomIn = document.getElementById('btnZoomIn');
    btnZoomOut = document.getElementById('btnZoomOut');
    btnOpenTrackStudio = document.getElementById('btnOpenTrackStudio');

    trackRacingHud = document.getElementById('trackRacingHud');
    trackLapStatus = document.getElementById('trackLapStatus') || document.getElementById('trackHudStatePill');
    trackLapTimer = document.getElementById('trackLapTimer') || document.getElementById('trackHudTimer');
    trackLapSplit = document.getElementById('trackLapSplit') || document.getElementById('trackHudSplit');
    trackGhostTarget = document.getElementById('trackGhostTarget') || document.getElementById('trackHudTarget');

    if (btnRespawn) btnRespawn.addEventListener('click', respawnPlayer);
    if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);
    if (btnZoomIn) btnZoomIn.addEventListener('click', () => adjustZoom(-1.5));
    if (btnZoomOut) btnZoomOut.addEventListener('click', () => adjustZoom(+1.5));

    if (btnOpenTrackStudio) {
      btnOpenTrackStudio.addEventListener('click', () => {
        const cont = document.getElementById('trackEditorContainer');
        if (cont) {
          const isOpen = cont.style.display === 'flex';
          cont.style.display = isOpen ? 'none' : 'flex';
          if (!isOpen && window.initEditor) window.initEditor();
        }
      });
    }

    if (hudTerrainVal) hudTerrainVal.textContent = 'Hollister Hills RFTR';
  }

  // ==========================================================================
  // 2. Three.js Scene, Lighting & California Atmosphere
  // ==========================================================================
  function initThreeScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbdd5ea);
    scene.fog = new THREE.FogExp2(0xbdd5ea, 0.0032);

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({
      canvas: gameCanvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // Warm California Sunlight
    sunLight = new THREE.DirectionalLight(0xfff6e5, 1.35);
    sunLight.position.set(120, 180, 80);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 450;
    sunLight.shadow.camera.left = -160;
    sunLight.shadow.camera.right = 160;
    sunLight.shadow.camera.top = 160;
    sunLight.shadow.camera.bottom = -160;
    sunLight.shadow.bias = -0.0003;
    scene.add(sunLight);

    // Ambient & Sky Dome Lighting
    hemiLight = new THREE.HemisphereLight(0x90b8e8, 0x8a7052, 0.75);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(ambientLight);

    // Player Board Root Group
    boardGroup = new THREE.Group();
    boardGroup.position.set(state.player.x, state.player.y, state.player.z);
    scene.add(boardGroup);

    // Initial camera position snap
    snapCamera();
  }

  // ==========================================================================
  // 3. Hollister Hills Seamless Free-Roam Outdoor Terrain
  // ==========================================================================
  let sceneryGroup = null;

  // Unified Surface Elevation (Track Ribbon + Free Roam Dirt Terrain)
  function getSurfaceElevation(x, z) {
    if (window.TrackBuilder && typeof window.TrackBuilder.getGroundElevationAt === 'function') {
      return window.TrackBuilder.getGroundElevationAt(x, z);
    }
    return 1.0;
  }

  function createOutdoorTerrain() {
    if (terrainMesh) {
      scene.remove(terrainMesh);
      if (terrainMesh.geometry) terrainMesh.geometry.dispose();
      if (terrainMesh.material) terrainMesh.material.dispose();
      terrainMesh = null;
    }

    // Centered around track center (X: ~48, Z: ~-72)
    // 650m x 650m expansive terrain with 130x130 quads (5m per quad)
    const geo = new THREE.PlaneGeometry(650, 650, 130, 130);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = [];
    const colNear = new THREE.Color(0xa0522d); // Warm packed dirt / clay near track
    const colMid = new THREE.Color(0x96734e);  // California dry earth
    const colFar = new THREE.Color(0x6b5c3b);  // Distant olive/golden chaparral

    const sps = (window.TrackBuilder && window.TrackBuilder._splinePoints) ? window.TrackBuilder._splinePoints : null;

    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i) + 48;
      const pz = pos.getZ(i) - 72;
      pos.setX(i, px);
      pos.setZ(i, pz);

      const rawY = getSurfaceElevation(px, pz);

      let dist = Infinity;
      if (sps && sps.length > 0) {
        let minDistSq = Infinity;
        for (let j = 0; j < sps.length; j += 2) {
          const dx = px - sps[j].x;
          const dz = pz - sps[j].z;
          const d2 = dx * dx + dz * dz;
          if (d2 < minDistSq) minDistSq = d2;
        }
        dist = Math.sqrt(minDistSq);

        // Vertex color blending based on track distance
        const vCol = new THREE.Color();
        if (dist < 4.5) {
          vCol.copy(colNear);
        } else if (dist < 28.0) {
          const t = (dist - 4.5) / 23.5;
          vCol.lerpColors(colNear, colMid, t);
        } else {
          const t = Math.min(1.0, (dist - 28.0) / 45.0);
          vCol.lerpColors(colMid, colFar, t);
        }
        // Subtle natural dirt noise
        vCol.r += (Math.random() - 0.5) * 0.03;
        vCol.g += (Math.random() - 0.5) * 0.025;
        vCol.b += (Math.random() - 0.5) * 0.02;
        colors.push(vCol.r, vCol.g, vCol.b);
      } else {
        colors.push(colNear.r, colNear.g, colNear.b);
      }

      // Depress the terrain cleanly under the track ribbon by 0.22m with smooth shoulder bevel to prevent z-fighting
      let depression = 0;
      if (dist <= 3.8) {
        depression = 0.22;
      } else if (dist < 7.5) {
        depression = 0.22 * (1.0 - (dist - 3.8) / 3.7);
      }
      pos.setY(i, rawY - depression);
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: false,
      side: THREE.DoubleSide
    });

    terrainMesh = new THREE.Mesh(geo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.name = 'Hollister_Terrain';
    scene.add(terrainMesh);

    createScenicProps();
  }

  function createScenicProps() {
    if (!sceneryGroup) {
      sceneryGroup = new THREE.Group();
      scene.add(sceneryGroup);
    } else {
      while (sceneryGroup.children.length > 0) {
        sceneryGroup.remove(sceneryGroup.children[0]);
      }
    }

    const oakGeo = new THREE.ConeGeometry(3.5, 7.0, 5);
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3.0, 5);
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x2e4225, roughness: 0.9 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.95 });

    // Distant perimeter oaks centered around (48, -72)
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * Math.PI * 2;
      const dist = 140 + (i % 5) * 22 + Math.random() * 20;
      const tx = 48 + Math.cos(angle) * dist;
      const tz = -72 + Math.sin(angle) * dist;
      const ty = getSurfaceElevation(tx, tz);

      const treeGroup = new THREE.Group();
      treeGroup.position.set(tx, ty, tz);

      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.5;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      const foliage = new THREE.Mesh(oakGeo, oakMat);
      foliage.position.y = 5.5;
      foliage.castShadow = true;
      treeGroup.add(foliage);

      const scale = 0.8 + Math.random() * 0.6;
      treeGroup.scale.set(scale, scale, scale);
      sceneryGroup.add(treeGroup);
    }
  }

  function registerTrackObstacle(obs) {
    state.trackObstacles.push(obs);
  }

  // ==========================================================================
  // 4. Board Model & Rider Representation
  // ==========================================================================
  function loadX7BoardModel() {
    setupProceduralBoard();

    if (typeof THREE.GLTFLoader === 'undefined') return;

    const loader = new THREE.GLTFLoader();
    loader.load(
      'models/x7_board.glb',
      (gltf) => {
        const model = gltf.scene;

        while (boardGroup.children.length > 0) {
          boardGroup.remove(boardGroup.children[0]);
        }
        setupBoardLights();

        let foundTire = null;
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const name = (child.name || '').toLowerCase();

            if (name.includes('stompie') || name.includes('pad')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xf1f5f9,
                roughness: 0.8,
                metalness: 0.05,
                side: THREE.DoubleSide
              });
            } else if (name.includes('rail')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xef233c,
                roughness: 0.32,
                metalness: 0.78,
                side: THREE.DoubleSide
              });
            } else if (name.includes('tire')) {
              foundTire = child;
              child.material = new THREE.MeshStandardMaterial({
                color: 0x18181b,
                roughness: 0.88,
                metalness: 0.05,
                side: THREE.DoubleSide
              });
            } else if (name.includes('bumper')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x0f172a,
                roughness: 0.85,
                metalness: 0.1,
                side: THREE.DoubleSide
              });
            } else if (name.includes('superflux') || name.includes('mount')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x92400e,
                roughness: 0.3,
                metalness: 0.85,
                side: THREE.DoubleSide
              });
            } else {
              if (child.material) child.material.side = THREE.DoubleSide;
            }
          }
        });

        // Map CAD coordinate system (+Y front to +Z forward)
        model.rotation.set(0, Math.PI / 2, Math.PI / 2);
        model.updateMatrixWorld(true);

        const rootBbox = new THREE.Box3().setFromObject(model);
        const center = rootBbox.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.position.y += TIRE_RADIUS;

        chassisMesh = model;
        boardGroup.add(chassisMesh);
        wheelMesh = foundTire || null;
      },
      undefined,
      () => {
        // Fallback procedural board remains active
      }
    );
  }

  function setupProceduralBoard() {
    while (boardGroup.children.length > 0) {
      boardGroup.remove(boardGroup.children[0]);
    }

    const board = createBoardMeshInternal(0xef233c);
    wheelMesh = board.wheel;
    boardShadow = board.shadow;
    boardGroup.add(board.group);
    scene.add(boardShadow);

    setupBoardLights();
  }

  function createBoardMeshInternal(railColor = 0xef233c) {
    const colorNum = typeof railColor === 'string' ? parseInt(railColor.replace('#', '0x')) : railColor;
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';

    // Go-Kart Tire
    const tireGeo = new THREE.CylinderGeometry(TIRE_RADIUS, TIRE_RADIUS, 0.18, 24);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.88, metalness: 0.05, side: THREE.DoubleSide });
    const wheel = new THREE.Mesh(tireGeo, tireMat);
    wheel.position.set(0, TIRE_RADIUS, 0);
    wheel.castShadow = true;
    group.add(wheel);

    // Motor Hub
    const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.185, 16);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x92400e, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
    wheel.add(new THREE.Mesh(hubGeo, hubMat));

    // CNC Rails
    const railMat = new THREE.MeshStandardMaterial({ color: colorNum, metalness: 0.78, roughness: 0.32, side: THREE.DoubleSide });
    const railGeo = new THREE.BoxGeometry(0.03, 0.045, 0.74);
    const railL = new THREE.Mesh(railGeo, railMat);
    railL.position.set(-0.115, TIRE_RADIUS, 0);
    railL.castShadow = true;
    group.add(railL);

    const railR = new THREE.Mesh(railGeo, railMat);
    railR.position.set(0.115, TIRE_RADIUS, 0);
    railR.castShadow = true;
    group.add(railR);

    // Footpads
    const padMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.8, side: THREE.DoubleSide });
    const padGeo = new THREE.BoxGeometry(0.23, 0.03, 0.24);
    const padF = new THREE.Mesh(padGeo, padMat);
    padF.position.set(0, TIRE_RADIUS + 0.035, 0.22);
    padF.castShadow = true;
    group.add(padF);

    const padR = new THREE.Mesh(padGeo, padMat);
    padR.position.set(0, TIRE_RADIUS + 0.035, -0.22);
    padR.castShadow = true;
    group.add(padR);

    // Bumpers
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85, side: THREE.DoubleSide });
    const bumpF = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.1), bumperMat);
    bumpF.position.set(0, TIRE_RADIUS - 0.01, 0.34);
    group.add(bumpF);

    const bumpR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.1), bumperMat);
    bumpR.position.set(0, TIRE_RADIUS - 0.01, -0.34);
    group.add(bumpR);

    // Soft Radial Contact Drop Shadow (flat oval lying on ground)
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d');
    const sGrad = sctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    sGrad.addColorStop(0, 'rgba(8, 6, 4, 0.60)');
    sGrad.addColorStop(0.45, 'rgba(12, 10, 6, 0.28)');
    sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sctx.fillStyle = sGrad;
    sctx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowGeo = new THREE.PlaneGeometry(0.50, 0.88);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);

    return { group, wheel, shadow, railMat };
  }

  function setupBoardLights() {
    // Front LED Lightbar (+Z)
    const fMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.0 });
    const fLight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.02), fMat);
    fLight.position.set(0, TIRE_RADIUS + 0.015, 0.345);
    boardGroup.add(fLight);

    // Rear Red LED (-Z)
    const rMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff1616, emissiveIntensity: 2.2 });
    const rLight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.02), rMat);
    rLight.position.set(0, TIRE_RADIUS + 0.015, -0.345);
    boardGroup.add(rLight);
  }

  // ==========================================================================
  // 5. Nico's Ghost Racer Entity & Replay System
  // ==========================================================================
  function createGhostRacerMesh() {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';

    // Translucent glowing wireframe deck
    const deckGeo = new THREE.BoxGeometry(0.28, 0.06, 0.88);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true,
      transparent: true,
      opacity: 0.75
    });
    const deck = new THREE.Mesh(deckGeo, wireMat);
    deck.position.set(0, TIRE_RADIUS + 0.04, 0);
    group.add(deck);

    // Glowing core
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00b4d8,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.35,
      roughness: 0.2
    });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.84), coreMat);
    core.position.set(0, TIRE_RADIUS + 0.04, 0);
    group.add(core);

    // Wireframe Tire
    const tireGeo = new THREE.CylinderGeometry(TIRE_RADIUS, TIRE_RADIUS, 0.18, 16);
    tireGeo.rotateZ(Math.PI / 2);
    const tireWireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    const wheel = new THREE.Mesh(tireGeo, tireWireMat);
    wheel.position.set(0, TIRE_RADIUS, 0);
    group.add(wheel);

    // Floating Nametag Sprite
    const tagCanvas = document.createElement('canvas');
    tagCanvas.width = 256;
    tagCanvas.height = 64;
    const tctx = tagCanvas.getContext('2d');
    tctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    tctx.fillRect(4, 4, 248, 56);
    tctx.strokeStyle = '#00ffff';
    tctx.lineWidth = 3;
    tctx.strokeRect(4, 4, 248, 56);

    tctx.fillStyle = '#00ffff';
    tctx.font = 'bold 22px sans-serif';
    tctx.textAlign = 'center';
    tctx.fillText("NICO (GHOST)", 128, 28);
    tctx.fillStyle = '#94a3b8';
    tctx.font = 'bold 15px sans-serif';
    tctx.fillText('2:15.01 • HOT LAP', 128, 48);

    const tagTex = new THREE.CanvasTexture(tagCanvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tagTex, transparent: true, opacity: 0.95 });
    const tagSprite = new THREE.Sprite(spriteMat);
    tagSprite.scale.set(1.4, 0.35, 1);
    tagSprite.position.set(0, 0.95, 0);
    group.add(tagSprite);

    group.visible = false;
    return group;
  }

  function sampleGhostAtTime(samples, t) {
    if (!samples || samples.length === 0) return null;
    if (t <= samples[0].t) return samples[0];
    if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];

    let low = 0, high = samples.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (samples[mid].t <= t) {
        if (mid === samples.length - 1 || samples[mid + 1].t > t) {
          const s1 = samples[mid];
          const s2 = samples[mid + 1];
          const frac = (t - s1.t) / (s2.t - s1.t || 1);
          const x = s1.x + frac * (s2.x - s1.x);
          const z = s1.z + frac * (s2.z - s1.z);
          const y = s1.y + frac * (s2.y - s1.y);

          let dHeading = s2.heading - s1.heading;
          while (dHeading > Math.PI) dHeading -= Math.PI * 2;
          while (dHeading < -Math.PI) dHeading += Math.PI * 2;
          const heading = s1.heading + frac * dHeading;

          return { x, y, z, heading };
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return samples[0];
  }

  function formatRaceTime(sec) {
    if (isNaN(sec) || sec < 0) return '00:00.00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  function updateSplitDelta(player, playerElapsed, ghostData) {
    if (!trackLapSplit || !ghostData || !ghostData.samples) return;

    const samples = ghostData.samples;
    let minDistSq = Infinity;
    let bestIdx = 0;

    for (let i = 0; i < samples.length; i++) {
      const dx = player.x - samples[i].x;
      const dz = player.z - samples[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDistSq) {
        minDistSq = d2;
        bestIdx = i;
      }
    }

    if (minDistSq < 1600) { // within 40m of track
      const ghostTimeAtNearest = samples[bestIdx].t;
      const delta = playerElapsed - ghostTimeAtNearest;

      if (delta <= -0.05) {
        trackLapSplit.textContent = `${delta.toFixed(2)}s`;
        trackLapSplit.className = 'exp9-track-hud-split ahead';
      } else if (delta >= 0.05) {
        trackLapSplit.textContent = `+${delta.toFixed(2)}s`;
        trackLapSplit.className = 'exp9-track-hud-split behind';
      } else {
        trackLapSplit.textContent = `±0.00s`;
        trackLapSplit.className = 'exp9-track-hud-split neutral';
      }
    } else {
      trackLapSplit.textContent = '--:--';
      trackLapSplit.className = 'exp9-track-hud-split neutral';
    }
  }

  function updateTrackModeSession(dt) {
    if (!window.TrackBuilder) return;

    const trackData = trackSession.activeTrackData || window.TRACK_DATA_HOLLISTER;
    if (!trackData) return;

    const gates = window.TrackBuilder.getGates ? window.TrackBuilder.getGates() : {};
    const p = state.player;
    const now = performance.now();

    // 1. Check Staging / Start Gate (Start Chute Node 0)
    if (gates.startChute) {
      const dStart = Math.hypot(p.x - gates.startChute.x, p.z - gates.startChute.z);
      if (dStart < (gates.startChute.radius || 9.0)) {
        if (trackSession.state === 'unprimed' || trackSession.state === 'finished') {
          trackSession.state = 'primed';
          if (trackLapStatus) {
            trackLapStatus.textContent = 'STAGE READY';
            trackLapStatus.className = 'exp9-track-hud-pill';
          }
          showTrickToast('🏁 STAGED AT START CHUTE — DROP IN TO START RUN');
        }
      } else if (trackSession.state === 'primed' && dStart >= 7.0 && p.speed > 1.2) {
        // Player dropped into the chute and started moving!
        trackSession.state = 'racing';
        trackSession.lap = 1;
        trackSession.lapStartTime = now;
        trackSession.ghostActive = true;
        trackSession.ghostElapsed = 0;

        if (trackSession.ghostEntity) trackSession.ghostEntity.visible = true;
        if (trackLapStatus) {
          trackLapStatus.textContent = 'RACING';
          trackLapStatus.className = 'exp9-track-hud-pill racing';
        }
        showTrickToast('⏱️ GREEN FLAG! RUN STARTED! GO! 🏁');
      }
    }

    // 2. Check Finish Gate (Node 56 at loop exit)
    if (gates.lapFinish) {
      const dFinish = Math.hypot(p.x - gates.lapFinish.x, p.z - gates.lapFinish.z);
      const canTriggerFinish = (now - trackSession.lastFinishCrossingTime) > 8000; // 8s debounce

      if (dFinish < (gates.lapFinish.radius || 8.5) && canTriggerFinish) {
        if (trackSession.state === 'racing') {
          // Race Run Complete!
          const lapTime = (now - trackSession.lapStartTime) / 1000;
          trackSession.lastLapTime = lapTime;
          trackSession.lastFinishCrossingTime = now;
          trackSession.state = 'finished';
          trackSession.ghostActive = false;

          const ghostTarget = (trackData.ghostData && trackData.ghostData.duration) || 125.01;
          const diff = lapTime - ghostTarget;

          if (diff < 0) {
            showTrickToast(`🏆 NEW RECORD! ${formatRaceTime(lapTime)} (Beat Nico by ${Math.abs(diff).toFixed(2)}s!) 🏁`);
          } else {
            showTrickToast(`🏁 FINISH! Official Time: ${formatRaceTime(lapTime)} (+${diff.toFixed(2)}s vs Nico)`);
          }

          if (!trackSession.bestLapTime || lapTime < trackSession.bestLapTime) {
            trackSession.bestLapTime = lapTime;
          }

          if (trackLapStatus) {
            trackLapStatus.textContent = 'FINISHED';
            trackLapStatus.className = 'exp9-track-hud-pill';
          }
        }
      }
    }

    // 3. Update Live Racing Timer & HUD
    if (trackSession.state === 'racing') {
      const elapsed = (now - trackSession.lapStartTime) / 1000;
      trackSession.lapElapsed = elapsed;
      if (trackLapTimer) trackLapTimer.textContent = formatRaceTime(elapsed);

      // 4. Update Ghost Replay Entity
      const ghostData = trackData.ghostData;
      if (ghostData && ghostData.samples && ghostData.samples.length > 1 && trackSession.ghostEntity) {
        trackSession.ghostElapsed = elapsed;
        const duration = ghostData.duration || 135.01;

        if (elapsed <= duration) {
          const sample = sampleGhostAtTime(ghostData.samples, elapsed);
          if (sample) {
            trackSession.ghostEntity.visible = true;
            trackSession.ghostEntity.position.x = sample.x;
            trackSession.ghostEntity.position.z = sample.z;

            // Height matches track ribbon surface
            const surfY = window.TrackBuilder.getSurfaceAt(sample.x, sample.z);
            trackSession.ghostEntity.position.y = surfY !== null ? surfY : sample.y;
            trackSession.ghostEntity.rotation.y = sample.heading;
          }
        } else {
          trackSession.ghostEntity.visible = false;
        }

        // 5. Calculate Real-time Split Delta
        updateSplitDelta(p, elapsed, ghostData);
      }
    }
  }

  function initTrackModeSession(trackData) {
    trackSession.activeTrackData = trackData;
    trackSession.state = 'primed';
    trackSession.lap = 0;
    trackSession.lapStartTime = 0;
    trackSession.lapElapsed = 0;
    trackSession.lastLapTime = null;
    trackSession.bestLapTime = null;
    trackSession.lastFinishCrossingTime = 0;
    trackSession.ghostActive = false;
    trackSession.ghostElapsed = 0;

    if (!trackSession.ghostEntity) {
      trackSession.ghostEntity = createGhostRacerMesh();
      scene.add(trackSession.ghostEntity);
    }
    trackSession.ghostEntity.visible = false;

    if (trackRacingHud) {
      trackRacingHud.style.display = 'flex';
      if (trackLapStatus) {
        trackLapStatus.textContent = 'STAGE READY';
        trackLapStatus.className = 'exp9-track-hud-pill';
      }
      if (trackLapTimer) trackLapTimer.textContent = '00:00.00';
      if (trackLapSplit) {
        trackLapSplit.textContent = '--:--';
        trackLapSplit.className = 'exp9-track-hud-split neutral';
      }
      if (trackGhostTarget && trackData && trackData.ghostData) {
        trackGhostTarget.textContent = trackData.ghostData.lapTimeFormatted || '02:15.01';
      }
    }
  }

  function resetTrackSession() {
    trackSession.state = 'primed';
    trackSession.lap = 0;
    trackSession.lapStartTime = 0;
    trackSession.lapElapsed = 0;
    trackSession.lastFinishCrossingTime = 0;
    trackSession.ghostActive = false;
    trackSession.ghostElapsed = 0;

    if (trackSession.ghostEntity) {
      trackSession.ghostEntity.visible = false;
    }

    if (trackLapStatus) {
      trackLapStatus.textContent = 'STAGE READY';
      trackLapStatus.className = 'exp9-track-hud-pill';
    }
    if (trackLapTimer) trackLapTimer.textContent = '00:00.00';
    if (trackLapSplit) {
      trackLapSplit.textContent = '--:--';
      trackLapSplit.className = 'exp9-track-hud-split neutral';
    }
  }

  // ==========================================================================
  // 6. Track Loading & Build
  // ==========================================================================
  function loadTrackMap(mapName, trackData) {
    if (!trackData || !window.TrackBuilder) {
      console.error('[TrackMode] TrackBuilder or track data not available');
      return;
    }

    // Clear previous collision obstacles
    state.trackObstacles.length = 0;

    // Build the track ribbon & 3D gates
    const result = window.TrackBuilder.build(trackData, scene, registerTrackObstacle);

    // Build seamless outdoor free-roam terrain anchored to the compiled track
    createOutdoorTerrain();

    state.world.mode = 'track';
    state.world.activeMap = mapName;

    // Teleport player to track spawn point
    const spawn = result.spawnPoint || trackData.spawn || { x: 160, y: 1.5, z: -69.1, heading: -1.716 };
    const p = state.player;
    p.x = spawn.x;
    p.y = spawn.y;
    p.z = spawn.z;
    p.groundY = spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.speed = 0;
    p.heading = spawn.heading || -1.716;
    p.pitch = 0;
    p.roll = 0;
    p.isAirborne = false;
    p.airtime = 0;
    p.isGrinding = false;

    // Camera Snap
    snapCamera();

    // Initialize track session & ghost
    initTrackModeSession(trackData);

    showTrickToast(`HOLLISTER HILLS RFTR LOADED 🏁`);
  }

  function respawnPlayer() {
    if (!window.TrackBuilder) return;

    const spawn = window.TrackBuilder.getSpawnPoint() || { x: 160, y: 1.5, z: -69.1, heading: -1.716 };
    const p = state.player;
    p.x = spawn.x;
    p.y = spawn.y;
    p.z = spawn.z;
    p.groundY = spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.speed = 0;
    p.heading = spawn.heading || -1.716;
    p.pitch = 0;
    p.roll = 0;
    p.isAirborne = false;
    p.airtime = 0;
    p.isGrinding = false;

    snapCamera();
    resetTrackSession();
    showTrickToast('🏁 RESTART AT START CHUTE');
  }

  function snapCamera() {
    const p = state.player;
    state.camera.yaw = p.heading + Math.PI;
    state.camera.pitch = 0.32;
    state.camera.manualTimer = 0;

    const hDist = state.camera.distance * Math.cos(state.camera.pitch);
    camera.position.x = p.x + hDist * Math.sin(state.camera.yaw);
    camera.position.y = p.y + 0.85 + state.camera.distance * Math.sin(state.camera.pitch);
    camera.position.z = p.z + hDist * Math.cos(state.camera.yaw);
    camera.lookAt(p.x, p.y + 0.85, p.z);
  }

  // ==========================================================================
  // 7. Particles & Visual FX
  // ==========================================================================
  const particlePool = [];
  const MAX_PARTICLES = 160;

  function initParticlesAndFX() {
    const pGeo = new THREE.SphereGeometry(0.04, 4, 4);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xaa8c68, transparent: true, opacity: 0.6 });

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mesh = new THREE.Mesh(pGeo, pMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      particlePool.push({
        mesh: mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.5,
        active: false
      });
    }
  }

  function emitDustParticle(x, y, z, vx, vy, vz, colorHex = 0xaa8c68) {
    for (let i = 0; i < particlePool.length; i++) {
      const p = particlePool[i];
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        p.mesh.material.color.setHex(colorHex);
        p.mesh.material.opacity = 0.65;
        p.mesh.position.set(x, y, z);
        p.vx = vx + (Math.random() - 0.5) * 0.8;
        p.vy = vy + Math.random() * 0.6;
        p.vz = vz + (Math.random() - 0.5) * 0.8;
        p.life = 0;
        p.maxLife = 0.4 + Math.random() * 0.25;
        return;
      }
    }
  }

  function updateParticles(dt) {
    for (let i = 0; i < particlePool.length; i++) {
      const p = particlePool[i];
      if (p.active) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          p.mesh.visible = false;
        } else {
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;
          const ratio = 1 - (p.life / p.maxLife);
          p.mesh.material.opacity = ratio * 0.6;
          const scale = 1.0 + (1 - ratio) * 2.0;
          p.mesh.scale.set(scale, scale, scale);
        }
      }
    }
  }

  // ==========================================================================
  // 8. Controls & Input Handlers
  // ==========================================================================
  function initControls() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }

      if (e.code === 'BracketLeft' || e.code === 'Minus') { adjustZoom(+1.5); return; }
      if (e.code === 'BracketRight' || e.code === 'Equal') { adjustZoom(-1.5); return; }

      // Drive Controls: Both WASD and Arrow Keys drive the board
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          state.input.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          state.input.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          state.input.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          state.input.right = true;
          break;

        // Numpad Controls: Nose & Tail Butters + Aerial Tricks
        // 7: Nose Butter Left
        case 'Numpad7':
          state.input.butterNoseLeft = true;
          state.input.twistUp = true;
          state.input.twistLeft = true;
          break;
        // 9: Nose Butter Right
        case 'Numpad9':
          state.input.butterNoseRight = true;
          state.input.twistUp = true;
          state.input.twistRight = true;
          break;
        // 1: Tail Butter Left
        case 'Numpad1':
          state.input.butterTailLeft = true;
          state.input.twistDown = true;
          state.input.twistLeft = true;
          break;
        // 3: Tail Butter Right
        case 'Numpad3':
          state.input.butterTailRight = true;
          state.input.twistDown = true;
          state.input.twistRight = true;
          break;

        // 8: Nose Tilt / Lean Forward / Frontflip
        case 'Numpad8':
          state.input.twistUp = true;
          break;
        // 2: Tail Tilt / Lean Back / Backflip
        case 'Numpad2':
          state.input.twistDown = true;
          break;
        // 4: Twist / Spin Left
        case 'Numpad4':
          state.input.twistLeft = true;
          break;
        // 6: Twist / Spin Right
        case 'Numpad6':
          state.input.twistRight = true;
          break;
        // 5: Quick Respawn
        case 'Numpad5':
          respawnPlayer();
          break;

        case 'Space':
          if (!state.input.jump) state.input.jumpPressed = true;
          state.input.jump = true;
          break;
        case 'KeyR':
          respawnPlayer();
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          state.input.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          state.input.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          state.input.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          state.input.right = false;
          break;

        case 'Numpad7':
          state.input.butterNoseLeft = false;
          state.input.twistUp = false;
          state.input.twistLeft = false;
          break;
        case 'Numpad9':
          state.input.butterNoseRight = false;
          state.input.twistUp = false;
          state.input.twistRight = false;
          break;
        case 'Numpad1':
          state.input.butterTailLeft = false;
          state.input.twistDown = false;
          state.input.twistLeft = false;
          break;
        case 'Numpad3':
          state.input.butterTailRight = false;
          state.input.twistDown = false;
          state.input.twistRight = false;
          break;

        case 'Numpad8':
          state.input.twistUp = false;
          break;
        case 'Numpad2':
          state.input.twistDown = false;
          break;
        case 'Numpad4':
          state.input.twistLeft = false;
          break;
        case 'Numpad6':
          state.input.twistRight = false;
          break;

        case 'Space':
          state.input.jump = false;
          state.input.jumpPressed = false;
          break;
      }
    });

    // Mouse Drag Orbit Camera
    window.addEventListener('mousedown', (e) => {
      if (e.target === gameCanvas) {
        state.camera.isOrbiting = true;
        state.camera.lastPointerX = e.clientX;
        state.camera.lastPointerY = e.clientY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (state.camera.isOrbiting) {
        const dx = e.clientX - state.camera.lastPointerX;
        const dy = e.clientY - state.camera.lastPointerY;
        state.camera.lastPointerX = e.clientX;
        state.camera.lastPointerY = e.clientY;

        state.camera.yaw -= dx * 0.005;
        state.camera.pitch = THREE.MathUtils.clamp(state.camera.pitch + dy * 0.005, 0.05, 1.25);
        state.camera.manualTimer = 3.5;
      }
    });

    window.addEventListener('mouseup', () => {
      state.camera.isOrbiting = false;
    });

    window.addEventListener('wheel', (e) => {
      adjustZoom(e.deltaY > 0 ? 0.8 : -0.8);
    }, { passive: true });
  }

  function adjustZoom(delta) {
    state.camera.targetDistance = THREE.MathUtils.clamp(state.camera.targetDistance + delta, 1.8, 8.5);
  }

  // ==========================================================================
  // 9. Physics Simulation & Movement Loop
  // ==========================================================================
  function updatePhysics(dt) {
    const p = state.player;

    // 1. Input Direction
    let inputX = 0, inputY = 0;
    if (state.input.right) inputX += 1;
    if (state.input.left) inputX -= 1;
    if (state.input.up) inputY += 1;
    if (state.input.down) inputY -= 1;

    const len = Math.hypot(inputX, inputY);
    if (len > 0) { inputX /= len; inputY /= len; }

    const sinCam = Math.sin(state.camera.yaw);
    const cosCam = Math.cos(state.camera.yaw);
    const fwdCamX = -sinCam, fwdCamZ = -cosCam;
    const rightCamX = cosCam, rightCamZ = -sinCam;

    const worldDirX = inputY * fwdCamX + inputX * rightCamX;
    const worldDirZ = inputY * fwdCamZ + inputX * rightCamZ;
    const inputMag = Math.min(1.0, Math.hypot(inputX, inputY));

    // Current board local directions
    const fwdX = Math.sin(p.heading);
    const fwdZ = Math.cos(p.heading);
    const rightX = Math.cos(p.heading);
    const rightZ = -Math.sin(p.heading);

    let vFwd = p.vx * fwdX + p.vz * fwdZ;
    let vLat = p.vx * rightX + p.vz * rightZ;

    // 2. Throttle & Steering
    if (inputMag > 0.05) {
      const desiredHeading = Math.atan2(worldDirX, worldDirZ);
      let angleDiff = desiredHeading - p.heading;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

      const isBraking = p.speed > 1.8 && Math.abs(angleDiff) > (Math.PI * 0.60);

      if (isBraking) {
        // Regenerative Braking
        if (vFwd > 0) {
          vFwd = Math.max(0, vFwd - BRAKE_DECEL * inputMag * dt);
        } else {
          vFwd = Math.min(0, vFwd + BRAKE_DECEL * inputMag * dt);
        }
        p.roll = THREE.MathUtils.lerp(p.roll, 0, dt * 8);
      } else {
        // Normal Acceleration & Carving
        p.heading += angleDiff * Math.min(1.0, dt * TURN_SPEED);
        const rollTarget = THREE.MathUtils.clamp(-angleDiff * 1.5, -0.22, 0.22);
        p.roll = THREE.MathUtils.lerp(p.roll, rollTarget, dt * 10);

        const targetSpeed = MAX_SPEED * inputMag;
        if (vFwd < targetSpeed) {
          const speedRatio = THREE.MathUtils.clamp(vFwd / MAX_SPEED, 0, 1);
          const torqueFactor = 1.0 - speedRatio * 0.52;
          vFwd += ACCELERATION * torqueFactor * dt;
          if (vFwd > targetSpeed) vFwd = targetSpeed;
        } else if (targetSpeed < vFwd - 0.5) {
          vFwd = THREE.MathUtils.lerp(vFwd, targetSpeed, dt * 4.5);
        }
      }
    } else {
      // Natural rolling coasting friction
      vFwd = THREE.MathUtils.lerp(vFwd, 0, dt * 0.05);
      p.roll = THREE.MathUtils.lerp(p.roll, 0, dt * 8);
    }

    // 3. Slope Gravity & Banking
    if (!p.isAirborne) {
      const epsG = 0.5;
      const hE = getSurfaceElevation(p.x + epsG, p.z);
      const hW = getSurfaceElevation(p.x - epsG, p.z);
      const hS = getSurfaceElevation(p.x, p.z + epsG);
      const hN = getSurfaceElevation(p.x, p.z - epsG);

      const slopeX = (hW - hE) / (epsG * 2);
      const slopeZ = (hN - hS) / (epsG * 2);

      const slopeFwd = slopeX * fwdX + slopeZ * fwdZ;
      vFwd += slopeFwd * GRAVITY * 0.85 * dt;

      // Lateral tyre grip (prevents sliding like ice on banked dirt)
      vLat = THREE.MathUtils.lerp(vLat, 0, dt * 12.0);
    }

    // 4. Pushback Warning Tilt
    if (vFwd > PUSHBACK_SPEED) {
      p.isPushback = true;
      const pushbackFactor = THREE.MathUtils.clamp((vFwd - PUSHBACK_SPEED) / (MAX_SPEED - PUSHBACK_SPEED), 0, 1);
      p.pushbackTilt = THREE.MathUtils.lerp(p.pushbackTilt, -0.16 * pushbackFactor, dt * 6);
    } else {
      p.isPushback = false;
      p.pushbackTilt = THREE.MathUtils.lerp(p.pushbackTilt, 0, dt * 6);
    }

    // 5. Recompose Horizontal Velocity
    p.vx = vFwd * fwdX + vLat * rightX;
    p.vz = vFwd * fwdZ + vLat * rightZ;
    p.speed = Math.hypot(p.vx, p.vz);

    // Apply translation
    p.x += p.vx * dt;
    p.z += p.vz * dt;

    // 6. Surface Elevation & Grounding
    p.groundY = getSurfaceElevation(p.x, p.z);

    // Hop / Jump
    if (state.input.jumpPressed && !p.isAirborne) {
      p.isAirborne = true;
      p.vy = JUMP_IMPULSE;
      state.input.jumpPressed = false;
      emitDustParticle(p.x, p.y, p.z, -p.vx * 0.5, 1.5, -p.vz * 0.5);
    }

    if (p.isAirborne) {
      p.airtime += dt;
      p.vy -= GRAVITY * dt;
      p.y += p.vy * dt;

      // In-air trick rotation
      if (state.input.twistLeft) p.heading += 4.5 * dt;
      if (state.input.twistRight) p.heading -= 4.5 * dt;
      if (state.input.twistUp) p.pitch -= 4.0 * dt;
      if (state.input.twistDown) p.pitch += 4.0 * dt;

      if (p.y <= p.groundY) {
        // Landing
        p.y = p.groundY;
        p.vy = 0;
        p.isAirborne = false;
        p.airtime = 0;
        emitDustParticle(p.x, p.y, p.z, -p.vx * 0.3, 0.8, -p.vz * 0.3);
      }
    } else {
      // 1. Dual-probe smoothed ground slope pitch to prevent nose vibrating
      const hFront1 = getSurfaceElevation(p.x + fwdX * 0.35, p.z + fwdZ * 0.35);
      const hRear1 = getSurfaceElevation(p.x - fwdX * 0.35, p.z - fwdZ * 0.35);
      const hFront2 = getSurfaceElevation(p.x + fwdX * 0.70, p.z + fwdZ * 0.70);
      const hRear2 = getSurfaceElevation(p.x - fwdX * 0.70, p.z - fwdZ * 0.70);
      const pitch1 = Math.atan2(hFront1 - hRear1, 0.70);
      const pitch2 = Math.atan2(hFront2 - hRear2, 1.40);
      const terrainPitch = (pitch1 * 0.6) + (pitch2 * 0.4);

      // 2. Butter & Remote Tilt Inputs
      let butterPitch = 0;
      if (state.input.butterNoseLeft || (state.input.twistUp && state.input.twistLeft)) {
        butterPitch = 0.20; // Nose down
        p.heading += 4.2 * dt;
        p.roll = THREE.MathUtils.lerp(p.roll, 0.22, dt * 10);
        if (!p.butterTimer || p.butterTimer <= 0) {
          showTrickToast('NOSE BUTTER! 🧈');
          p.butterTimer = 1.2;
        }
        emitDustParticle(p.x + fwdX * 0.35, p.y, p.z + fwdZ * 0.35, -p.vx * 0.4, 0.4, -p.vz * 0.4, 0xd4af37);
      } else if (state.input.butterNoseRight || (state.input.twistUp && state.input.twistRight)) {
        butterPitch = 0.20; // Nose down
        p.heading -= 4.2 * dt;
        p.roll = THREE.MathUtils.lerp(p.roll, -0.22, dt * 10);
        if (!p.butterTimer || p.butterTimer <= 0) {
          showTrickToast('NOSE BUTTER! 🧈');
          p.butterTimer = 1.2;
        }
        emitDustParticle(p.x + fwdX * 0.35, p.y, p.z + fwdZ * 0.35, -p.vx * 0.4, 0.4, -p.vz * 0.4, 0xd4af37);
      } else if (state.input.butterTailLeft || (state.input.twistDown && state.input.twistLeft)) {
        butterPitch = -0.22; // Tail down, nose up
        p.heading += 4.2 * dt;
        p.roll = THREE.MathUtils.lerp(p.roll, 0.22, dt * 10);
        if (!p.butterTimer || p.butterTimer <= 0) {
          showTrickToast('TAIL BUTTER! 🧈');
          p.butterTimer = 1.2;
        }
        emitDustParticle(p.x - fwdX * 0.35, p.y, p.z - fwdZ * 0.35, -p.vx * 0.4, 0.4, -p.vz * 0.4, 0xd4af37);
      } else if (state.input.butterTailRight || (state.input.twistDown && state.input.twistRight)) {
        butterPitch = -0.22; // Tail down, nose up
        p.heading -= 4.2 * dt;
        p.roll = THREE.MathUtils.lerp(p.roll, -0.22, dt * 10);
        if (!p.butterTimer || p.butterTimer <= 0) {
          showTrickToast('TAIL BUTTER! 🧈');
          p.butterTimer = 1.2;
        }
        emitDustParticle(p.x - fwdX * 0.35, p.y, p.z - fwdZ * 0.35, -p.vx * 0.4, 0.4, -p.vz * 0.4, 0xd4af37);
      } else if (state.input.twistUp) {
        butterPitch = 0.16;
      } else if (state.input.twistDown) {
        butterPitch = -0.16;
      } else if (state.input.twistLeft) {
        p.heading += 3.8 * dt;
        p.roll = THREE.MathUtils.lerp(p.roll, 0.18, dt * 8);
      } else if (state.input.twistRight) {
        p.heading -= 3.8 * dt;
        p.roll = THREE.MathUtils.lerp(p.roll, -0.18, dt * 8);
      }

      if (p.butterTimer > 0) p.butterTimer -= dt;

      p.butterTilt = THREE.MathUtils.lerp(p.butterTilt || 0, butterPitch, dt * 12.0);
      const targetPitch = terrainPitch + p.pushbackTilt + p.butterTilt;
      p.pitch = THREE.MathUtils.lerp(p.pitch, targetPitch, dt * 10.0);

      // 3. Multi-point Bumper Clearance: Ensure neither nose nor tail clips below local ground
      const bumperDist = 0.38;
      const hNose = getSurfaceElevation(p.x + fwdX * bumperDist, p.z + fwdZ * bumperDist);
      const hTail = getSurfaceElevation(p.x - fwdX * bumperDist, p.z - fwdZ * bumperDist);
      const noseDeltaY = -Math.sin(p.pitch) * bumperDist;
      const tailDeltaY = Math.sin(p.pitch) * bumperDist;
      const minCenterForNose = hNose - noseDeltaY + 0.04;
      const minCenterForTail = hTail - tailDeltaY + 0.04;
      const targetGround = Math.max(p.groundY, minCenterForNose, minCenterForTail);

      // Smooth suspension snap to ground
      p.y = THREE.MathUtils.lerp(p.y, targetGround, dt * 20.0);

      // Tire dust while moving
      if (p.speed > 3.0 && Math.random() < 0.35) {
        emitDustParticle(p.x - fwdX * 0.3, p.y, p.z - fwdZ * 0.3, -p.vx * 0.2, 0.4, -p.vz * 0.2);
      }
    }

    // 7. Update 3D Board Transform
    boardGroup.position.set(p.x, p.y, p.z);
    boardGroup.rotation.set(p.pitch, p.heading, p.roll, 'YXZ');

    // Spin wheel mesh with forward velocity
    if (wheelMesh) {
      wheelMesh.rotateX((vFwd / TIRE_RADIUS) * dt);
    }

    // Soft flat drop shadow lying on ground (rotated flat, not upright!)
    if (boardShadow) {
      boardShadow.position.set(p.x, p.groundY + 0.015, p.z);
      boardShadow.rotation.set(0, p.heading, 0);
    }
  }

  // ==========================================================================
  // 10. Camera Tracking & HUD Updates
  // ==========================================================================
  function updateCamera(dt) {
    const p = state.player;

    if (state.camera.manualTimer > 0) {
      state.camera.manualTimer -= dt;
    } else {
      // Auto-align camera behind board travel heading
      let targetYaw = p.heading + Math.PI;
      let diff = targetYaw - state.camera.yaw;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      state.camera.yaw += diff * Math.min(1.0, dt * 3.8);
    }

    state.camera.distance = THREE.MathUtils.lerp(state.camera.distance, state.camera.targetDistance, dt * 8);

    const hDist = state.camera.distance * Math.cos(state.camera.pitch);
    const targetCamX = p.x + hDist * Math.sin(state.camera.yaw);
    const targetCamY = p.y + 0.85 + state.camera.distance * Math.sin(state.camera.pitch);
    const targetCamZ = p.z + hDist * Math.cos(state.camera.yaw);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, dt * 9);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, dt * 9);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, dt * 9);

    // Smooth camera lookAt point to eliminate jerky head-shaking
    if (!state.camera.lookTarget) {
      state.camera.lookTarget = new THREE.Vector3(p.x, p.y + 0.85, p.z);
    } else {
      state.camera.lookTarget.x = THREE.MathUtils.lerp(state.camera.lookTarget.x, p.x, dt * 12);
      state.camera.lookTarget.y = THREE.MathUtils.lerp(state.camera.lookTarget.y, p.y + 0.85, dt * 12);
      state.camera.lookTarget.z = THREE.MathUtils.lerp(state.camera.lookTarget.z, p.z, dt * 12);
    }
    camera.lookAt(state.camera.lookTarget);

    // Sun follows player for infinite smooth shadow coverage
    if (sunLight) {
      sunLight.position.set(p.x + 100, p.y + 160, p.z + 70);
      sunLight.target.position.set(p.x, p.y, p.z);
      sunLight.target.updateMatrixWorld();
    }
  }

  function updateHUD() {
    const p = state.player;

    // 1. Speedometer Readout (MPH)
    const mph = p.speed * 2.23694;
    if (hudSpeedVal) hudSpeedVal.textContent = mph.toFixed(1);
    if (hudSpeedBar) {
      const pct = Math.min(100, (mph / 32.0) * 100);
      hudSpeedBar.style.width = `${pct}%`;
      hudSpeedBar.style.background = p.isPushback ? '#ef4444' : '#00e5ff';
    }

    // 2. Compass pointing toward upcoming gate
    if (compassArrow && compassDist && window.TrackBuilder) {
      const gates = window.TrackBuilder.getGates ? window.TrackBuilder.getGates() : {};
      const targetGate = (trackSession.state === 'racing' && gates.lapFinish) ? gates.lapFinish : (gates.startChute || gates.lapFinish);

      if (targetGate) {
        const dx = targetGate.x - p.x;
        const dz = targetGate.z - p.z;
        const dist = Math.hypot(dx, dz);
        compassDist.textContent = `${Math.round(dist)}m`;

        const targetBearing = Math.atan2(dx, dz);
        let relAngle = targetBearing - state.camera.yaw;
        compassArrow.style.transform = `rotate(${relAngle}rad)`;
      }
    }
  }

  function showTrickToast(msg) {
    if (!trickToast || !trickText) return;
    trickText.textContent = msg;
    trickToast.classList.add('show');
    clearTimeout(trickToast._timer);
    trickToast._timer = setTimeout(() => {
      trickToast.classList.remove('show');
    }, 2800);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ==========================================================================
  // 11. Main Animation Loop
  // ==========================================================================
  function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(state.clock.getDelta(), 0.05);

    updatePhysics(dt);
    updateParticles(dt);
    updateCamera(dt);
    updateTrackModeSession(dt);
    updateHUD();

    // Multiplayer Hook
    if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.onGameTick) {
      window.GamerWheelsMultiplayer.onGameTick(dt, state.player);
    }

    renderer.render(scene, camera);
  }

  // ==========================================================================
  // 12. Bootstrap & Global Exports
  // ==========================================================================
  function initGame() {
    initDOMElements();
    initThreeScene();
    initParticlesAndFX();
    loadX7BoardModel();
    initControls();

    window.addEventListener('resize', onWindowResize);

    // Immediately load & compile Hollister Hills RFTR Track
    if (window.TRACK_DATA_HOLLISTER) {
      loadTrackMap('RFTR_Hollister', window.TRACK_DATA_HOLLISTER);
    } else {
      console.warn('[GamerWheels] TRACK_DATA_HOLLISTER not loaded yet; waiting for script');
      window.addEventListener('load', () => {
        if (window.TRACK_DATA_HOLLISTER) {
          loadTrackMap('RFTR_Hollister', window.TRACK_DATA_HOLLISTER);
        }
      });
    }

    animate();
  }

  window.addEventListener('DOMContentLoaded', initGame);

  // Global Engine API
  window.loadTrackMap = loadTrackMap;
  window.respawnPlayer = respawnPlayer;
  window.isTrackModeActive = () => true;

  window.GamerWheels = {
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get player() { return state.player; },
    get TIRE_RADIUS() { return TIRE_RADIUS; },
    showTrickToast,
    respawnPlayer,
    loadTrackMap,
    createBoardMesh: createBoardMeshInternal,
    setPlayerRailColor(hexColor) {
      const colorNum = typeof hexColor === 'string' ? parseInt(hexColor.replace('#', '0x')) : hexColor;
      if (boardGroup) {
        boardGroup.traverse((child) => {
          if (child.isMesh && child.material && child.geometry && child.geometry.type === 'BoxGeometry') {
            if (child.position.x !== 0) child.material.color.setHex(colorNum);
          }
        });
      }
    }
  };

})();
