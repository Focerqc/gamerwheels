/**
 * Experience 9: GamerWheels — 2.5D Isometric PEV Physics Engine
 * Author: Quinn Foster
 * Engine: Three.js Orthographic 2.5D Isometric Physics & Renderer
 * Version: 2.0 (Non-flat Contoured Terrain, Advanced Jumps, Model Fixes & Checkpoints)
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const GRAVITY = -28.0;         // m/s^2
  const DEFAULT_MAX_SPEED = 20.12; // ~45.0 MPH (flat ground top speed for park)
  const DUST2_MAX_SPEED = 30.0 / 2.23694; // 30.0 MPH (~13.411 m/s) speed limit for dust2 map
  const MAX_SPEED = DEFAULT_MAX_SPEED;
  const ACCELERATION = 14.0;     // m/s^2 progressive motor torque rate
  const DECELERATION = 16.0;     // m/s^2 (regenerative braking & coasting)
  const JUMP_VELOCITY = 8.5;     // m/s initial bunny-hop impulse
  const TIRE_RADIUS = 0.14;      // ~11 inch tire radius in meters
  const TURN_SPEED = 9.0;        // rad/s angular turning responsiveness

  // Map-specific speed limit helpers
  function getMapMaxSpeed() {
    return (currentMapId === 'dust2') ? DUST2_MAX_SPEED : DEFAULT_MAX_SPEED;
  }

  function getMapDownhillSpeedCap() {
    return (currentMapId === 'dust2') ? DUST2_MAX_SPEED : 26.8;
  }

  // --- Checkpoints Data (Per-Map) ---
  const MAP_CHECKPOINTS = {
    dust2: [
      {
        id: 0,
        name: 'T Spawn (Terrace)',
        zone: 'T Terrace / Spawn',
        x: -8.0,
        z: 32.0,
        heading: 0,
        spawnYOffset: 2.38,
        desc: 'Terrorist staging ramp and terrace overlooking courtyard & tunnels'
      },
      {
        id: 1,
        name: 'CT Spawn',
        zone: 'CT Spawn Base',
        x: -25.0,
        z: -35.0,
        heading: Math.PI,
        spawnYOffset: 4.58,
        desc: 'Counter-Terrorist base ramp below Short A and B slope'
      },
      {
        id: 2,
        name: 'Mid Doors',
        zone: 'Middle Cross',
        x: 0.5,
        z: 11.3,
        heading: 0,
        spawnYOffset: 0.18,
        desc: 'Mid double doors connecting Suicide to CT Spawn'
      },
      {
        id: 3,
        name: 'A Bomb Site',
        zone: 'Bombsite A Platform',
        x: 20.0,
        z: -25.0,
        heading: -Math.PI * 0.5,
        spawnYOffset: 1.83,
        desc: 'Elevated A bombsite overlooking Long A and Short Catwalk'
      },
      {
        id: 4,
        name: 'B Bomb Site',
        zone: 'Bombsite B Plat',
        x: -25.0,
        z: -15.0,
        heading: Math.PI * 0.5,
        spawnYOffset: 0.18,
        desc: 'Bombsite B platform with scaffolding, tunnels & car'
      }
    ],
    park: [
      {
        id: 0,
        name: 'Plaza Park',
        zone: 'Central Town Square',
        x: 0,
        z: 0,
        heading: -Math.PI * 0.75, // Screen-up facing
        spawnYOffset: 0.18,
        desc: 'Central skate park with funboxes, tabletop jumps, rails, and ledges'
      },
      {
        id: 1,
        name: 'Mega Drop',
        zone: 'Thunder Peak',
        x: 0,
        z: -74,
        heading: 0, // Facing South down the runway
        spawnYOffset: 7.22, // On top of 7m tower deck
        desc: '7-meter tall drop-in tower into massive canyon launch kicker'
      },
      {
        id: 2,
        name: 'Pine Ridge Slopestyle',
        zone: 'Pine Ridge Timber Course',
        x: 55,
        z: 42,
        heading: Math.PI, // Facing North down the slopestyle line
        spawnYOffset: 3.42, // On top of timber staging deck
        desc: 'Red Bull mountain bike slopestyle course with timber step-ups, bridges, whale tail & wallride'
      },
      {
        id: 3,
        name: 'Slickrock Motocross',
        zone: 'Slickrock Canyon MX',
        x: -58,
        z: 42,
        heading: Math.PI, // Facing North into MX jump line
        spawnYOffset: 3.22, // On top of MX starting mound
        desc: 'High-speed motocross jump line with 16m monster dirt tabletop, rhythm whoops & canyon gap'
      },
      {
        id: 4,
        name: 'Desert Berms',
        zone: 'Cactus Canyon',
        x: 0,
        z: 56,
        heading: Math.PI, // Facing North into desert carving berms
        spawnYOffset: 0.22,
        desc: 'High-speed banked desert berm carving bowls and rollers'
      }
    ]
  };

  let currentMapId = 'dust2';
  let CHECKPOINTS = MAP_CHECKPOINTS.dust2;
  let parkWorldGroup = null;
  let dust2Group = null;
  let dust2Model = null;
  let dust2WalkMeshes = [];
  let isDust2Loading = false;

  // --- Game State ---
  const state = {
    player: {
      x: 0,
      y: 0.2,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      speed: 0,
      heading: -Math.PI * 0.75, // board yaw angle (radians)
      pitch: 0,                 // nose-down/up tilt
      roll: 0,                  // carving bank roll
      isAirborne: false,
      isGrinding: false,
      airtime: 0,
      groundY: 0.08,
      currentZone: 'Central Town Square',
      zoneType: 'PLAZA',
      inTabletop: false,
      inGap: false,
      inMegaDrop: false,
    },
    camera: {
      fov: 65,
      yaw: -Math.PI * 0.75 + Math.PI, // initial camera yaw trailing behind spawn heading
      pitch: 0.35,                    // ~20 degrees elevation
      distance: 2.2,
      targetDistance: 2.2,
      minDistance: 0.0,               // 0 = true first-person
      maxDistance: 15.0,
      manualTimer: 0,
    },
    grind: {
      active: false,
      type: '50-50', // 'noseslide', 'tailslide', 'boardslide', '50-50'
      balance: 0.0,  // -1.0 (tipped forward) to +1.0 (tipped back)
      balanceVel: 0.0,
      timer: 0.0,
      railX: 0,
      railMinZ: 0,
      railMaxZ: 0,
    },
    aerial: {
      airYaw: 0,
      airPitch: 0,
      spin180Done: false,
      spin360Done: false,
      flipDone: false,
    },
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      jump: false,
      jumpPressed: false,
      joystickActive: false,
      joystickVector: { x: 0, y: 0 },
      // Right Twist / Flip / Balance / Carve Stick (Arrows on desktop)
      twistUp: false,
      twistDown: false,
      twistLeft: false,
      twistRight: false,
      rightJoystickActive: false,
      rightJoystickVector: { x: 0, y: 0 },
    },
    obstacles: [],
    trailSigns: [],
    particles: [],
    activeCheckpoint: 0,
    clock: new THREE.Clock(),
  };

  // ==========================================================================
  // CS Tactical Combat, Weapon Arsenal & Buy Menu System
  // ==========================================================================
  const WEAPON_ARSENAL = {
    pistols: [
      { id: 'glock', name: 'Glock-18', category: 'Sidearm (T)', price: 200, damage: 28, rpm: 400, magSize: 20, maxAmmo: 120, slot: 2, soundType: 'pistol', desc: 'Default T sidearm with high capacity and rapid tap fire.' },
      { id: 'usps', name: 'USP-S', category: 'Sidearm (CT)', price: 200, damage: 35, rpm: 352, magSize: 12, maxAmmo: 24, slot: 2, soundType: 'silenced', desc: 'Silenced tactical pistol with laser-like pinpoint accuracy.' },
      { id: 'p250', name: 'P250', category: 'Sidearm', price: 300, damage: 38, rpm: 400, magSize: 13, maxAmmo: 26, slot: 2, soundType: 'pistol', desc: 'High armor-penetration sidearm for close-quarters carving.' },
      { id: 'berettas', name: 'Dual Berettas', category: 'Sidearms', price: 400, damage: 38, rpm: 500, magSize: 30, maxAmmo: 120, slot: 2, soundType: 'pistol', desc: 'Akimbo rapid spam pistols with 30-round mag for drive-bys.' },
      { id: 'deagle', name: 'Desert Eagle', category: 'Hand Cannon', price: 700, damage: 63, rpm: 267, magSize: 7, maxAmmo: 35, slot: 2, soundType: 'heavy_pistol', desc: 'Heavy hand cannon with lethal 1-tap headshot stopping power.' }
    ],
    smgs: [
      { id: 'mac10', name: 'MAC-10', category: 'SMG (T)', price: 1050, damage: 29, rpm: 800, magSize: 30, maxAmmo: 100, slot: 1, soundType: 'smg', desc: 'High-mobility blazing 800 RPM spray machine for fast carving.' },
      { id: 'mp9', name: 'MP9', category: 'SMG (CT)', price: 1250, damage: 26, rpm: 857, magSize: 30, maxAmmo: 120, slot: 1, soundType: 'smg', desc: 'Laser-accurate high-RPM SMG for aggressive cornering.' },
      { id: 'p90', name: 'P90', category: 'SMG', price: 2350, damage: 26, rpm: 857, magSize: 50, maxAmmo: 100, slot: 1, soundType: 'smg', desc: '50-round high-capacity bullet hose with low moving recoil.' }
    ],
    rifles: [
      { id: 'galil', name: 'Galil AR', category: 'Rifle (T)', price: 1800, damage: 30, rpm: 666, magSize: 35, maxAmmo: 90, slot: 1, soundType: 'rifle', desc: '35-round budget Terrorist assault rifle.' },
      { id: 'famas', name: 'FAMAS', category: 'Rifle (CT)', price: 2050, damage: 30, rpm: 666, magSize: 25, maxAmmo: 90, slot: 1, soundType: 'rifle', desc: 'Compact CT assault rifle with tight burst fire.' },
      { id: 'ak47', name: 'AK-47', category: 'Rifle (T)', price: 2700, damage: 36, rpm: 600, magSize: 30, maxAmmo: 90, slot: 1, soundType: 'rifle', desc: 'The gold standard. 1-tap lethal headshot through helmets.' },
      { id: 'm4a4', name: 'M4A4', category: 'Rifle (CT)', price: 3100, damage: 33, rpm: 666, magSize: 30, maxAmmo: 90, slot: 1, soundType: 'rifle', desc: 'High-capacity CT primary rifle with reliable spray pattern.' },
      { id: 'aug', name: 'AUG', category: 'Scoped Rifle (CT)', price: 3300, damage: 32, rpm: 666, magSize: 30, maxAmmo: 90, slot: 1, soundType: 'rifle', hasScope: true, opticType: 'aug', desc: 'Bullpup assault rifle equipped with high-accuracy ACOG optic.' },
      { id: 'sg553', name: 'SG 553', category: 'Scoped Rifle (T)', price: 3000, damage: 35, rpm: 666, magSize: 30, maxAmmo: 90, slot: 1, soundType: 'rifle', hasScope: true, opticType: 'sg553', desc: '100% armor-penetration assault rifle with holographic combat scope.' },
      { id: 'scout', name: 'SSG 08', category: 'Sniper', price: 1700, damage: 88, rpm: 48, magSize: 10, maxAmmo: 90, slot: 1, soundType: 'sniper', hasScope: true, opticType: 'scout', desc: 'Lightweight sniper rifle; maintains accuracy while bunny hopping!' },
      { id: 'awp', name: 'AWP', category: 'Sniper', price: 4750, damage: 115, rpm: 41, magSize: 10, maxAmmo: 30, slot: 1, soundType: 'sniper', hasScope: true, opticType: 'awp', desc: 'The legendary 1-shot, 1-kill magnum sniper rifle with 2-stage zoom.' }
    ],
    heavy: [
      { id: 'nova', name: 'Nova', category: 'Shotgun', price: 1050, damage: 120, rpm: 68, magSize: 8, maxAmmo: 32, slot: 1, soundType: 'shotgun', desc: 'Tight-spread pump-action shotgun for corridor defense.' },
      { id: 'xm1014', name: 'XM1014', category: 'Auto Shotgun', price: 2000, damage: 100, rpm: 240, magSize: 7, maxAmmo: 32, slot: 1, soundType: 'shotgun', desc: 'Full-auto combat shotgun for high-speed drive-by sweeps.' },
      { id: 'negev', name: 'Negev', category: 'LMG', price: 1700, damage: 35, rpm: 800, magSize: 150, maxAmmo: 300, slot: 1, soundType: 'rifle', desc: '150-round suppressive fire laser beam.' }
    ],
    gear: [
      { id: 'kevlar', name: 'Kevlar + Helmet', category: 'Armor', price: 1000, desc: 'Maximum armor and headshot flinch protection.' },
      { id: 'hegrenade', name: 'HE Grenade', category: 'Explosive', price: 300, desc: 'High explosive fragmentation grenade.' },
      { id: 'flashbang', name: 'Flashbang', category: 'Utility', price: 200, desc: 'Blinds opposing riders with brilliant screen flash.' },
      { id: 'smoke', name: 'Smoke Grenade', category: 'Utility', price: 300, desc: 'Deploys a thick dust cloud for sightline denial.' },
      { id: 'defuser', name: 'Defuse Kit', category: 'Equipment (CT)', price: 400, desc: 'Cuts bomb defusal time from 10s down to 5s.' }
    ]
  };

  const combat = {
    cash: 16000, // Starts at $16,000 for instant free-roam testing!
    team: 'T',   // 'T' (Terrorist) or 'CT' (Counter-Terrorist)
    hp: 100,
    maxHp: 100,
    isAlive: true,
    currentCategory: 'pistols',
    equippedPrimary: null,
    equippedSecondary: { ...WEAPON_ARSENAL.pistols[0], ammoInMag: 20, ammoInReserve: 120 },
    activeSlot: 2, // 1 = primary, 2 = secondary
    gear: { armor: 100, helmet: true, defuser: false },
    hasBomb: false,
    bombPlanted: false,
    bombSite: null,
    bombTimer: null,
    isPlanting: false,
    plantProgress: 0,
    lastFireTime: 0,
    isReloading: false,
    scopeLevel: 0,        // 0 = unzoomed, 1 = zoom 1, 2 = zoom 2
    scopedTargetFov: 65,  // Target FOV when zoomed
    weaponRecoil: 0       // Recoil displacement lerp for floating 3D weapon
  };

  let lastTacticalMatchMode = 'freeroam';

  // --- DOM Elements ---
  let container, canvas;
  let hudSpeedVal, hudSpeedBar, hudTerrainVal;
  let compassArrow, compassDist;
  let areaToast, areaBadge, areaName, trickToast, trickText;
  let btnRespawn, btnFullscreen, btnTouchJump;
  let btnZoomIn, btnZoomOut;
  let joystickZone, joystickBase, joystickThumb;
  let rightJoystickZone, rightJoystickBase, rightJoystickThumb;
  let balanceHud, balanceLabel, balanceNeedle;
  let cpButtons = [];

  // --- Three.js Globals ---
  let scene, camera, renderer;
  let boardGroup, wheelMesh, chassisMesh, shadowMesh;
  let boardWeaponGroup = null;
  let headlightSpot, taillightSpot, taillightLens;
  let sunLight, ambientLight, hemiLight;
  let particleGroup;

  // --- Init on DOM Load ---
  window.addEventListener('DOMContentLoaded', () => {
    initDOMElements();
    initThreeScene();
    buildWorld();
    loadX7BoardModel();
    initControls();
    initParticlesAndFX();

    // Initialize starting map (Dust 2)
    switchMap('dust2', true);

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('fullscreenchange', onWindowResize);
    document.addEventListener('webkitfullscreenchange', onWindowResize);
    onWindowResize();

    // Start Animation Loop
    animate();
  });

  // ==========================================================================
  // 1. DOM Elements & Checkpoint Binding
  // ==========================================================================
  function initDOMElements() {
    container = document.getElementById('gameContainer');
    canvas = document.getElementById('gameCanvas');

    hudSpeedVal = document.getElementById('hudSpeedVal');
    hudSpeedBar = document.getElementById('hudSpeedBar');
    hudTerrainVal = document.getElementById('hudTerrainVal');

    compassArrow = document.getElementById('compassArrow');
    compassDist = document.getElementById('compassDist');

    areaToast = document.getElementById('areaToast');
    areaBadge = document.getElementById('areaBadge');
    areaName = document.getElementById('areaName');
    trickToast = document.getElementById('trickToast');
    trickText = document.getElementById('trickText');

    btnRespawn = document.getElementById('btnRespawn');
    btnFullscreen = document.getElementById('btnFullscreen');
    btnTouchJump = document.getElementById('btnTouchJump');

    btnZoomIn = document.getElementById('btnZoomIn');
    btnZoomOut = document.getElementById('btnZoomOut');

    joystickZone = document.getElementById('joystickZone');
    joystickBase = document.getElementById('joystickBase');
    joystickThumb = document.getElementById('joystickThumb');

    rightJoystickZone = document.getElementById('rightJoystickZone');
    rightJoystickBase = document.getElementById('rightJoystickBase');
    rightJoystickThumb = document.getElementById('rightJoystickThumb');

    balanceHud = document.getElementById('balanceHud');
    balanceLabel = document.getElementById('balanceLabel');
    balanceNeedle = document.getElementById('balanceNeedle');

    if (btnRespawn) btnRespawn.addEventListener('click', respawnPlayer);
    if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);
    if (btnZoomIn) btnZoomIn.addEventListener('click', () => adjustZoom(-3));
    if (btnZoomOut) btnZoomOut.addEventListener('click', () => adjustZoom(+3));

    // Weapon Buy Menu Controls
    const btnOpenBuyMenu = document.getElementById('btnOpenBuyMenu');
    const btnCloseBuyMenu = document.getElementById('btnCloseBuyMenu');
    if (btnOpenBuyMenu) btnOpenBuyMenu.addEventListener('click', toggleBuyMenu);
    if (btnCloseBuyMenu) btnCloseBuyMenu.addEventListener('click', closeBuyMenu);

    document.querySelectorAll('.exp9-buy-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const cat = tab.getAttribute('data-category');
        if (cat) renderBuyMenuGrid(cat);
      });
    });

    updateWeaponHUD();
    updateBuyMenuCash();

    // Weapon slot quickswitch by clicking HUD weapon card
    const weaponCard = document.getElementById('weaponCard');
    if (weaponCard) {
      weaponCard.style.cursor = 'pointer';
      weaponCard.title = 'Click or Press Q to switch weapon';
      weaponCard.addEventListener('click', () => {
        quickSwitchWeapon();
      });
    }

    // Team Switcher Buttons
    const btnJoinT = document.getElementById('btnJoinT');
    const btnJoinCT = document.getElementById('btnJoinCT');
    if (btnJoinT) {
      btnJoinT.addEventListener('click', () => {
        if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.switchTeam) {
          window.GamerWheelsMultiplayer.switchTeam('T');
        }
      });
    }
    if (btnJoinCT) {
      btnJoinCT.addEventListener('click', () => {
        if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.switchTeam) {
          window.GamerWheelsMultiplayer.switchTeam('CT');
        }
      });
    }

    updateVitalsHUD();
    updateTeamHUD();

    // Touch scope button for mobile/tablet riders
    const btnTouchScope = document.getElementById('btnTouchScope');
    if (btnTouchScope) {
      btnTouchScope.addEventListener('click', () => {
        toggleWeaponScope();
      });
    }

    // Checkpoint navigation buttons
    cpButtons = Array.from(document.querySelectorAll('.exp9-cp-btn'));
    cpButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const cpIdx = parseInt(btn.getAttribute('data-cp'), 10);
        if (!isNaN(cpIdx)) {
          teleportToCheckpoint(cpIdx);
        }
      });
    });

    // Collapsible Game Info Accordion Toggle
    const btnGameInfoToggle = document.getElementById('btnGameInfoToggle');
    const gameInfoPanel = document.getElementById('gameInfoPanel');
    const accordionHintText = document.getElementById('accordionHintText');

    if (btnGameInfoToggle && gameInfoPanel) {
      btnGameInfoToggle.addEventListener('click', () => {
        const isOpen = gameInfoPanel.classList.contains('open');
        btnGameInfoToggle.setAttribute('aria-expanded', !isOpen);
        btnGameInfoToggle.classList.toggle('active', !isOpen);
        gameInfoPanel.classList.toggle('open', !isOpen);
        if (accordionHintText) {
          accordionHintText.textContent = !isOpen ? 'Hide Info' : 'Show Info';
        }
      });
    }

    // Controls Settings Dropdown & Jump Button Toggle
    const btnControlsDropdown = document.getElementById('btnControlsDropdown');
    const controlsMenu = document.getElementById('controlsMenu');
    const toggleJumpBtn = document.getElementById('toggleJumpBtn');
    const gameContainer = document.getElementById('gameContainer') || document.querySelector('.exp9-viewport-container');

    function setJumpButtonVisible(visible) {
      if (gameContainer) {
        gameContainer.classList.toggle('has-jump-button', visible);
      }
      if (toggleJumpBtn) {
        toggleJumpBtn.checked = visible;
      }
      try {
        localStorage.setItem('gamerwheels_jump_button', visible ? 'true' : 'false');
      } catch (e) {}
    }

    // Off by default as requested; persist if explicitly enabled
    let initialJumpBtn = false;
    try {
      const savedJump = localStorage.getItem('gamerwheels_jump_button');
      if (savedJump !== null) {
        initialJumpBtn = savedJump === 'true';
      }
    } catch (e) {}
    setJumpButtonVisible(initialJumpBtn);

    if (toggleJumpBtn) {
      toggleJumpBtn.addEventListener('change', (e) => {
        setJumpButtonVisible(e.target.checked);
      });
    }

    if (btnControlsDropdown && controlsMenu) {
      btnControlsDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = controlsMenu.classList.contains('open');
        controlsMenu.classList.toggle('open', !isOpen);
        btnControlsDropdown.setAttribute('aria-expanded', !isOpen);
        btnControlsDropdown.classList.toggle('active', !isOpen);
      });

      controlsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      window.addEventListener('click', () => {
        if (controlsMenu.classList.contains('open')) {
          controlsMenu.classList.remove('open');
          btnControlsDropdown.setAttribute('aria-expanded', 'false');
          btnControlsDropdown.classList.remove('active');
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && controlsMenu.classList.contains('open')) {
          controlsMenu.classList.remove('open');
          btnControlsDropdown.setAttribute('aria-expanded', 'false');
          btnControlsDropdown.classList.remove('active');
        }
      });
    }

    // Map Selector Dropdown
    const btnMapDropdown = document.getElementById('btnMapDropdown');
    const mapMenu = document.getElementById('mapMenu');

    if (btnMapDropdown && mapMenu) {
      btnMapDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = mapMenu.classList.contains('open');
        mapMenu.classList.toggle('open', !isOpen);
        btnMapDropdown.setAttribute('aria-expanded', !isOpen);
        btnMapDropdown.classList.toggle('active', !isOpen);
      });

      mapMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      window.addEventListener('click', () => {
        if (mapMenu.classList.contains('open')) {
          mapMenu.classList.remove('open');
          btnMapDropdown.setAttribute('aria-expanded', 'false');
          btnMapDropdown.classList.remove('active');
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mapMenu.classList.contains('open')) {
          mapMenu.classList.remove('open');
          btnMapDropdown.setAttribute('aria-expanded', 'false');
          btnMapDropdown.classList.remove('active');
        }
      });
    }

    const mapItems = document.querySelectorAll('.exp9-map-item');
    mapItems.forEach((item) => {
      item.addEventListener('click', () => {
        const targetMap = item.getAttribute('data-map');
        if (targetMap === '2fort') {
          showTrickToast('🔒 2FORT IS LOCKED: COMING SOON');
          return;
        }
        if (mapMenu) {
          mapMenu.classList.remove('open');
          if (btnMapDropdown) {
            btnMapDropdown.classList.remove('active');
            btnMapDropdown.setAttribute('aria-expanded', 'false');
          }
        }
        switchMap(targetMap);
      });
    });
  }

  // ==========================================================================
  // 2. Three.js Isometric Scene & Camera Setup
  // ==========================================================================
  function initThreeScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1d);
    scene.fog = new THREE.FogExp2(0x0a0f1d, 0.0075);

    // Full 3D Third-Person Perspective Camera
    const aspect = container.clientWidth / container.clientHeight;
    camera = new THREE.PerspectiveCamera(state.camera.fov, aspect, 0.1, 800);

    // Position camera behind spawn heading looking at rider
    const initHDist = state.camera.distance * Math.cos(state.camera.pitch);
    camera.position.set(
      state.player.x + initHDist * Math.sin(state.camera.yaw),
      state.player.y + 0.85 + state.camera.distance * Math.sin(state.camera.pitch),
      state.player.z + initHDist * Math.cos(state.camera.yaw)
    );
    camera.lookAt(state.player.x, state.player.y + 0.85, state.player.z);

    // WebGL Renderer
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (typeof THREE.ACESFilmicToneMapping !== 'undefined') {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.16;
    }

    // --- Lighting (Global Radiosity & Ambient Fill for Tunnels, Interiors & Slopes) ---
    ambientLight = new THREE.AmbientLight(0xfff7ed, 0.85);
    scene.add(ambientLight);

    // Hemisphere light (sky vs warm ground bounce)
    hemiLight = new THREE.HemisphereLight(0xffedd5, 0x78350f, 0.65);
    hemiLight.position.set(0, 60, 0);
    scene.add(hemiLight);

    // Directional Sun Light (strong directional shading for hills and berms)
    sunLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
    sunLight.position.set(50, 75, 40);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 180;

    const shadowBoxSize = 32;
    sunLight.shadow.camera.left = -shadowBoxSize;
    sunLight.shadow.camera.right = shadowBoxSize;
    sunLight.shadow.camera.top = shadowBoxSize;
    sunLight.shadow.camera.bottom = -shadowBoxSize;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // Create Root Board Group (Rotation order 'YXZ' allows correct pitch along heading)
    boardGroup = new THREE.Group();
    boardGroup.rotation.order = 'YXZ';
    boardGroup.position.set(state.player.x, state.player.y, state.player.z);
    scene.add(boardGroup);

    // Dynamic Drop Shadow Decal (Oriented along X width and Z length)
    const shadowGeo = new THREE.PlaneGeometry(0.42, 0.88);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const ctx = shadowCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.set(0, 0.02, 0);
    scene.add(shadowMesh);
  }

  // ==========================================================================
  // 3. Procedural Heightfield & World Topography
  // ==========================================================================

  /**
   * Continuous mathematical heightfield function.
   * Returns terrain elevation Y (meters) for any world (x, z) coordinate.
   */
  function getTerrainElevation(x, z) {
    const dist = Math.hypot(x, z);

    // 1. Central Town Square Plaza is flat at +0.08m
    if (dist < 19) {
      return 0.08;
    }

    // Smooth transition feathering from plaza to wild terrain
    const plazaBlend = dist < 25 ? (dist - 19) / 6 : 1;

    let h = 0.5;

    // A. North: Thunder Peak (High mountain ridge, rugged terraces, Mega Drop tower hill)
    if (z < -18 && Math.abs(x) <= Math.abs(z) * 1.6) {
      const n = (-z - 18);
      const ridge = Math.sin(x * 0.14) * 1.1 + Math.cos(z * 0.09) * 0.9;
      const terrace = Math.floor(n / 16) * 0.75;
      h = 1.0 + 0.05 * n + ridge + terrace;

      // Mountain peak backdrop behind the tower (z <= -80)
      if (z <= -80) {
        const peakDist = Math.hypot(x, z - (-88));
        if (peakDist < 20) {
          const peakFactor = Math.cos((peakDist / 20) * Math.PI * 0.5);
          h = Math.max(h, 4.0 + peakFactor * 4.5);
        }
      }

      // Carve Mega Drop Canyon Corridor (z from -90 to -17, perfectly clear below all ramps)
      if (Math.abs(x) < 11.5 && z >= -90 && z <= -17) {
        let targetFloor = 0.6;
        if (z < -78) {
          // Smooth mountain slope rising behind tower staging (z: -90 to -78)
          const backT = (-78 - z) / 12.0;
          targetFloor = THREE.MathUtils.lerp(2.5, 8.5, Math.min(1.0, backT));
        } else if (z <= -71.5) {
          // Under tower staging platform (z: -78 to -71.5)
          targetFloor = 2.5; // Platform is at 7.0m (4.5m elevated on pillars!)
        } else if (z <= -49.5) {
          // Under roll-in runway (z: -71.5 to -49.5, runway drops from 7.0m to 2.0m)
          const t = (z - (-71.5)) / 22.0;
          targetFloor = 2.5 - t * 1.8; // drops 2.5m to 0.7m, staying 1.3m to 4.5m below runway!
        } else if (z <= -43.5) {
          // Under launch kicker (z: -49.5 to -43.5, kicker rises 2.0m to 4.8m)
          targetFloor = 0.7; // 1.3m to 4.1m below kicker!
        } else if (z <= -35.5) {
          // Under canyon jump gap chasm (z: -43.5 to -35.5)
          targetFloor = 0.4;
        } else {
          // Under landing transition (z: -35.5 to -17, landing slopes 3.6m to 0.12m)
          const t = (z - (-35.5)) / 18.5;
          targetFloor = THREE.MathUtils.lerp(0.35, 0.08, THREE.MathUtils.clamp(t, 0, 1));
        }

        // Smooth canyon profile: perfectly flat 10m wide floor (|x| <= 5.0m), smooth walls up to 11.5m
        let canyonH = targetFloor;
        const absX = Math.abs(x);
        if (absX > 5.0) {
          const wallT = (absX - 5.0) / 6.5;
          const smoothWall = wallT * wallT * (3 - 2 * wallT);
          canyonH = targetFloor + smoothWall * 4.5;
        }
        h = Math.min(h, canyonH);
      }
    }
    // B. South: Cactus Canyon & Banked Berms Trail Circuit
    else if (z > 18 && Math.abs(x) <= Math.abs(z) * 1.6) {
      const s = (z - 18);
      // Base rolling desert dunes
      const dunes = Math.sin(x * 0.10) * 1.1 * Math.cos(s * 0.07) + Math.cos((x + s) * 0.06) * 0.8;
      const canyonFlanks = Math.max(0, (Math.abs(x) - 18) * 0.22);
      h = 1.0 + dunes + canyonFlanks;

      // 1. Entrance Roller Pump Track (z: 21 to 38, near center)
      if (Math.abs(x) < 8 && z >= 20 && z <= 40) {
        const roller = Math.sin((z - 20) * 0.65) * 0.5;
        h += roller;
      }

      // 2. East Banked Berm Turn (Apex near x=24, z=48)
      // Carves riders into a high-banked right sweep
      const distBermE = Math.hypot(x - 24, z - 48);
      if (distBermE < 16) {
        const outsideRise = Math.max(0, (x - 16) / 8.5) * 2.5; // Outer wall up to 2.5m
        const bowlPocket = -Math.cos((distBermE / 16) * Math.PI * 0.5) * 0.6;
        h += outsideRise + bowlPocket;
      }

      // 3. South Sweeper Berm Turn (Apex near x=0, z=76)
      // High-speed banked turn around the southern canyon rim
      const distBermS = Math.hypot(x, z - 76);
      if (distBermS < 18) {
        const outsideRise = Math.max(0, (z - 68) / 8.5) * 2.8; // Outer wall up to 2.8m
        const bowlPocket = -Math.cos((distBermS / 18) * Math.PI * 0.5) * 0.7;
        h += outsideRise + bowlPocket;
      }

      // 4. West Banked Berm Turn (Apex near x=-24, z=52)
      // Carves riders back northward toward town
      const distBermW = Math.hypot(x - (-24), z - 52);
      if (distBermW < 16) {
        const outsideRise = Math.max(0, (-x - 16) / 8.5) * 2.5; // Outer wall up to 2.5m
        const bowlPocket = -Math.cos((distBermW / 16) * Math.PI * 0.5) * 0.6;
        h += outsideRise + bowlPocket;
      }

      // 5. Central Infield Tabletop Roller / Hump (x ~ 0, z ~ 56)
      const distInfield = Math.hypot(x, z - 56);
      if (distInfield < 9) {
        h += Math.cos((distInfield / 9) * Math.PI * 0.5) * 1.25;
      }
    }
    // C. East: Pine Ridge (Forest singletrack, wooded knolls, stream ravine)
    else if (x > 18 && Math.abs(z) <= Math.abs(x) * 1.6) {
      const e = (x - 18);
      const forestKnolls = Math.sin(z * 0.13) * 1.3 + Math.cos(e * 0.11) * 1.1;
      const ravineDist = Math.abs(x - 46);
      const ravine = ravineDist < 7 ? -Math.cos((ravineDist / 7) * Math.PI * 0.5) * 1.2 : 0;
      h = 1.6 + forestKnolls + ravine;

      // Grade smooth downhill corridor under Pine Ridge Slopestyle course (x ~ 55, z: -28 to 45)
      if (Math.abs(x - 55) < 8.0 && z >= -28 && z <= 45) {
        const gradeT = (45 - z) / 73.0;
        const trailFloor = THREE.MathUtils.lerp(2.2, 1.0, gradeT);
        const distFromCenter = Math.abs(x - 55);
        if (distFromCenter < 4.2) {
          h = trailFloor;
        } else {
          const blend = (distFromCenter - 4.2) / 3.8;
          h = THREE.MathUtils.lerp(trailFloor, h, blend);
        }
      }
    }
    // D. West: Slickrock Bluff (Tiered sandstone shelves, jump bowl)
    else if (x < -18 && Math.abs(z) <= Math.abs(x) * 1.6) {
      const w = (-x - 18);
      const shelves = Math.sin(z * 0.12) * 1.2 + Math.floor(w / 14) * 0.9;
      const bowlDist = Math.hypot(x - (-52), z);
      const bowl = bowlDist < 16 ? -Math.cos((bowlDist / 16) * Math.PI * 0.5) * 1.3 : 0;
      h = 1.4 + shelves + bowl;

      // Grade smooth downhill corridor under Slickrock Motocross course (x ~ -58, z: -28 to 45)
      if (Math.abs(x - (-58)) < 8.0 && z >= -28 && z <= 45) {
        const gradeT = (45 - z) / 73.0;
        const trailFloor = THREE.MathUtils.lerp(2.2, 1.0, gradeT);
        const distFromCenter = Math.abs(x - (-58));
        if (distFromCenter < 4.2) {
          h = trailFloor;
        } else {
          const blend = (distFromCenter - 4.2) / 3.8;
          h = THREE.MathUtils.lerp(trailFloor, h, blend);
        }
      }
    } else {
      // Diagonal corner transitions
      h = 0.8 + Math.sin(x * 0.09) * 0.7 + Math.cos(z * 0.09) * 0.7;
    }

    return THREE.MathUtils.lerp(0.08, Math.max(0.05, h), plazaBlend);
  }

  /**
   * Helper to check if a world point lies along the Desert Berm dirt trail circuit
   */
  function isDesertBermTrail(x, z) {
    if (z < 20 || z > 86 || Math.abs(x) > 38) return 0;

    // Entrance pump rollers
    if (Math.abs(x) < 6 && z >= 20 && z <= 38) return 1;

    // East Berm Arc (around 24, 48)
    const dE = Math.hypot(x - 24, z - 48);
    if (dE >= 6 && dE <= 15.5) return Math.max(0, 1 - Math.abs(dE - 11) / 4.5);

    // South Sweeper Arc (around 0, 76)
    const dS = Math.hypot(x, z - 76);
    if (dS >= 6 && dS <= 17) return Math.max(0, 1 - Math.abs(dS - 12) / 5);

    // West Berm Arc (around -24, 52)
    const dW = Math.hypot(x - (-24), z - 52);
    if (dW >= 6 && dW <= 15.5) return Math.max(0, 1 - Math.abs(dW - 11) / 4.5);

    // Connecting straightaways
    if (Math.abs(x) < 7 && z >= 36 && z <= 52) return 0.8;

    return 0;
  }

  // Procedural Topographical Grid Texture for crystal-clear slope & contour visibility
  function createTopographicalGridTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Clean neutral base
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);

    // Primary 2m Grid Outer Border (accent line)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 256, 256);

    // Secondary sub-grid lines (1m subdivisions)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(128, 0); ctx.lineTo(128, 256);
    ctx.moveTo(0, 128); ctx.lineTo(256, 128);
    ctx.stroke();

    // Center crosshair for enhanced perspective
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(128, 120); ctx.lineTo(128, 136);
    ctx.moveTo(120, 128); ctx.lineTo(136, 128);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // 300m world width with 150 repeats = 1 grid tile exactly every 2.0 meters
    texture.repeat.set(150, 150);
    return texture;
  }

  // ==========================================================================
  // 4. World Generation: Topography, Park, Stunt Jumps & Biomes
  // ==========================================================================
  function buildWorld() {
    parkWorldGroup = new THREE.Group();
    dust2Group = new THREE.Group();

    const origSceneAdd = scene.add.bind(scene);
    scene.add = function (...objs) {
      parkWorldGroup.add(...objs);
    };

    // 1. Base Contoured Terrain Mesh (160x160 grid for smooth hills)
    const groundGeo = new THREE.PlaneGeometry(300, 300, 160, 160);
    groundGeo.rotateX(-Math.PI / 2);

    const colors = [];
    const pos = groundGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const gx = pos.getX(i);
      const gz = pos.getZ(i);

      // Displace Y coordinate according to mathematical heightfield
      const gy = getTerrainElevation(gx, gz);
      pos.setY(i, gy);

      // Biome vertex color blending
      let col = new THREE.Color(0x27303f); // City asphalt slate
      const dist = Math.hypot(gx, gz);

      if (dist > 22) {
        if (gz < -20 && Math.abs(gx) < Math.abs(gz) * 1.6) {
          // North: Mountain (Dark granite / slate rock)
          col = new THREE.Color(0x334155).lerp(new THREE.Color(0x1e293b), Math.min(1, (-gz - 20) / 65));
        } else if (gz > 20 && Math.abs(gx) < Math.abs(gz) * 1.6) {
          // South: Cactus Canyon (Warm terracotta / red sand)
          col = new THREE.Color(0xd97736).lerp(new THREE.Color(0x9a3412), Math.min(1, (gz - 20) / 65));

          // Highlight sculpted dirt trail loops with packed singletrack dirt color
          const trailFactor = isDesertBermTrail(gx, gz);
          if (trailFactor > 0.05) {
            const dirtTrackCol = new THREE.Color(0x78350f).lerp(new THREE.Color(0xb45309), 0.6);
            col.lerp(dirtTrackCol, trailFactor * 0.85);
          }
        } else if (gx > 20 && Math.abs(gz) < Math.abs(gx) * 1.6) {
          // East: Pine Ridge (Deep moss forest loam)
          col = new THREE.Color(0x2f603c).lerp(new THREE.Color(0x1e3a29), Math.min(1, (gx - 20) / 65));
        } else if (gx < -20 && Math.abs(gz) < Math.abs(gx) * 1.6) {
          // West: Slickrock Bluff (Warm sandstone / terracotta rock)
          col = new THREE.Color(0xd97736).lerp(new THREE.Color(0xb45309), Math.min(1, (-gx - 20) / 65));
        }
      }

      // Exact slope gradient calculation
      const epsG = 0.5;
      const hE = getTerrainElevation(gx + epsG, gz);
      const hW = getTerrainElevation(gx - epsG, gz);
      const hS = getTerrainElevation(gx, gz + epsG);
      const hN = getTerrainElevation(gx, gz - epsG);
      const slopeX = (hE - hW) / (2 * epsG);
      const slopeZ = (hS - hN) / (2 * epsG);
      const slopeGrad = Math.hypot(slopeX, slopeZ);

      // Contrast slope shading: steep slopes become visibly darker, revealing ridges and drops
      const slopeFactor = THREE.MathUtils.clamp(1.0 - slopeGrad * 0.45, 0.45, 1.0);
      col.multiplyScalar(slopeFactor);

      // Topographic elevation contour lines (dark rings every 0.5 and 1.0 meters)
      const contourMod = Math.abs((gy % 0.5) - 0.25);
      const isContour = contourMod > 0.21;
      if (isContour && dist > 20) {
        col.multiplyScalar(0.76); // Crisp contour stripe
      }

      colors.push(col.r, col.g, col.b);
    }

    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();

    const topoTexture = createTopographicalGridTexture();
    const groundMat = new THREE.MeshStandardMaterial({
      map: topoTexture,
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // 2. Central Plaza Pavers (Town Square)
    const plazaGeo = new THREE.BoxGeometry(38, 0.12, 38);
    const plazaMat = new THREE.MeshStandardMaterial({
      color: 0x3e4758,
      roughness: 0.7,
      metalness: 0.1,
    });
    const plazaMesh = new THREE.Mesh(plazaGeo, plazaMat);
    plazaMesh.position.set(0, 0.06, 0);
    plazaMesh.receiveShadow = true;
    scene.add(plazaMesh);

    // Center Inset Mosaic / Charging Pad
    const padGeo = new THREE.BoxGeometry(10, 0.16, 10);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x6366f1,
      roughness: 0.4,
      metalness: 0.4,
      emissive: 0x24285b,
      emissiveIntensity: 0.35,
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.set(0, 0.08, 0);
    padMesh.receiveShadow = true;
    scene.add(padMesh);

    // 3. Central Plaza Features (Rails, Ledges, Curbs)
    createStreetParkFeatures();

    // 4. Stunt Features (Tabletop, Gap Jump, Whale Tail, Mega Drop)
    createStuntJumpLines();

    // 5. Trail Signs
    createTrailSign('North: Thunder Peak', '[MEGA DROP]', -6.0, -18, 0, 0xf59e0b);
    createTrailSign('South: Cactus Canyon', '[DESERT BERMS]', 0, 20, Math.PI, 0x14b8a6);
    createTrailSign('East: Pine Ridge', '[SLOPESTYLE TIMBER]', 20, 0, Math.PI / 2, 0x10b981);
    createTrailSign('West: Slickrock Bluff', '[MOTOCROSS CANYON]', -20, 0, -Math.PI / 2, 0xf59e0b);

    // 6. Scenery (Trees, Rocks, Cacti placed on contour elevation)
    populateScenery();

    scene.add = origSceneAdd;
    scene.add(parkWorldGroup);
    scene.add(dust2Group);
  }

  // Solid mathematical 3D wedge prism (zero rotation/centroid distortion)
  function createWedgeMesh(width, length, yStart, yEnd, mat) {
    mat.side = THREE.DoubleSide;
    const halfW = width / 2;
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      // Top slope (2 triangles, CCW upward normals)
      -halfW, yStart, 0,   -halfW, yEnd, length,  halfW, yEnd, length,
      -halfW, yStart, 0,   halfW, yEnd, length,   halfW, yStart, 0,
      // Bottom face
      -halfW, 0, 0,        halfW, 0, 0,           halfW, 0, length,
      -halfW, 0, 0,        halfW, 0, length,      -halfW, 0, length,
      // Left side face
      -halfW, 0, 0,        -halfW, yEnd, length,  -halfW, yStart, 0,
      -halfW, 0, 0,        -halfW, 0, length,     -halfW, yEnd, length,
      // Right side face
      halfW, 0, 0,         halfW, yStart, 0,      halfW, yEnd, length,
      halfW, 0, 0,         halfW, yEnd, length,   halfW, 0, length,
      // Front face (at 0)
      -halfW, 0, 0,        -halfW, yStart, 0,     halfW, yStart, 0,
      -halfW, 0, 0,        halfW, yStart, 0,      halfW, 0, 0,
      // Back face (at length)
      -halfW, 0, length,   halfW, 0, length,      halfW, yEnd, length,
      -halfW, 0, length,   halfW, yEnd, length,   -halfW, yEnd, length,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // Curved Quarter Bank Mesh with Steel Coping
  function createQuarterBankMesh(width, length, height, facingAngle, mat) {
    mat.side = THREE.DoubleSide;
    const group = new THREE.Group();
    const halfW = width / 2;
    const segments = 10;
    const geo = new THREE.BufferGeometry();
    const pos = [];

    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const z0 = t0 * length;
      const z1 = t1 * length;
      const y0 = Math.pow(t0, 1.6) * height;
      const y1 = Math.pow(t1, 1.6) * height;

      // Top curved face (CCW upward normals)
      pos.push(-halfW, y0, z0,  halfW, y1, z1,   halfW, y0, z0);
      pos.push(-halfW, y0, z0, -halfW, y1, z1,   halfW, y1, z1);
      // Bottom face
      pos.push(-halfW, 0, z0,   halfW, 0, z0,    halfW, 0, z1);
      pos.push(-halfW, 0, z0,   halfW, 0, z1,   -halfW, 0, z1);
      // Left side
      pos.push(-halfW, 0, z0,  -halfW, y1, z1,  -halfW, y0, z0);
      pos.push(-halfW, 0, z0,  -halfW, 0, z1,   -halfW, y1, z1);
      // Right side
      pos.push(halfW, 0, z0,    halfW, y0, z0,   halfW, y1, z1);
      pos.push(halfW, 0, z0,    halfW, y1, z1,   halfW, 0, z1);
    }
    // Back wall at length
    pos.push(-halfW, 0, length, -halfW, height, length, halfW, height, length);
    pos.push(-halfW, 0, length,  halfW, height, length, halfW, 0, length);

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Steel Coping Pipe along top lip
    const copingGeo = new THREE.CylinderGeometry(0.045, 0.045, width, 12);
    copingGeo.rotateZ(Math.PI / 2);
    const copingMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 });
    const coping = new THREE.Mesh(copingGeo, copingMat);
    coping.position.set(0, height + 0.03, length);
    coping.castShadow = true;
    group.add(coping);

    group.rotation.y = facingAngle;
    return group;
  }

  // Authentic Street Skate Park (Multi-Line Flow: Funbox, Banks, Ledges, Rails)
  function createStreetParkFeatures() {
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65 });
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 });
    const woodDeckMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });
    const copingMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.88, roughness: 0.2 });

    // =========================================================================
    // 1. CENTRAL FUNBOX / PYRAMID (x: 0, z: 0)
    // =========================================================================
    const funboxH = 0.52;
    const deckSize = 4.6;

    // A. Center Flat Deck
    const centerDeck = new THREE.Mesh(new THREE.BoxGeometry(deckSize, funboxH, deckSize), concreteMat);
    centerDeck.position.set(0, funboxH / 2 + 0.06, 0);
    centerDeck.castShadow = true;
    centerDeck.receiveShadow = true;
    scene.add(centerDeck);

    registerObstacle({
      type: 'deck',
      x: 0,
      z: 0,
      width: deckSize,
      length: deckSize,
      height: funboxH + 0.06,
    });

    // B. North Bank (Slopes up to center deck from z = -5.9 to z = -2.3)
    const bankNorth = createWedgeMesh(deckSize, 3.6, 0.06, funboxH + 0.06, bankMat);
    bankNorth.position.set(0, 0, -5.9);
    scene.add(bankNorth);
    registerObstacle({
      type: 'bank_z',
      x: 0,
      zStart: -5.9,
      zEnd: -2.3,
      width: deckSize,
      yStart: 0.06,
      yEnd: funboxH + 0.06,
    });

    // C. South Bank (Slopes up to center deck from z = 5.9 to z = 2.3)
    const bankSouth = createWedgeMesh(deckSize, 3.6, funboxH + 0.06, 0.06, bankMat);
    bankSouth.position.set(0, 0, 2.3);
    scene.add(bankSouth);
    registerObstacle({
      type: 'bank_z',
      x: 0,
      zStart: 2.3,
      zEnd: 5.9,
      width: deckSize,
      yStart: funboxH + 0.06,
      yEnd: 0.06,
    });

    // D. West Bank (Slopes up to center deck from x = -5.9 to x = -2.3)
    const bankWest = createWedgeMesh(deckSize, 3.6, 0.06, funboxH + 0.06, bankMat);
    bankWest.rotation.y = -Math.PI / 2;
    bankWest.position.set(-2.3, 0, 0);
    scene.add(bankWest);
    registerObstacle({
      type: 'bank_x',
      z: 0,
      xStart: -5.9,
      xEnd: -2.3,
      length: deckSize,
      yStart: 0.06,
      yEnd: funboxH + 0.06,
    });

    // E. East Bank (Slopes up to center deck from x = 5.9 to x = 2.3)
    const bankEast = createWedgeMesh(deckSize, 3.6, funboxH + 0.06, 0.06, bankMat);
    bankEast.rotation.y = -Math.PI / 2;
    bankEast.position.set(5.9, 0, 0);
    scene.add(bankEast);
    registerObstacle({
      type: 'bank_x',
      z: 0,
      xStart: 2.3,
      xEnd: 5.9,
      length: deckSize,
      yStart: funboxH + 0.06,
      yEnd: 0.06,
    });

    // F. Center Down-Rail (Electric Cyan Rail down the North/South axis)
    createGrindRail(0, 0, 9.5, 0.42 + funboxH, 0x38bdf8);

    // G. Funbox Hubba Ledge with Steel Coping (East Flank)
    const hubbaW = 0.55;
    const hubbaL = 6.8;
    const hubbaH = funboxH + 0.16;
    const hubbaMesh = new THREE.Mesh(new THREE.BoxGeometry(hubbaW, hubbaH, hubbaL), concreteMat);
    hubbaMesh.position.set(deckSize / 2 + hubbaW / 2, hubbaH / 2 + 0.06, 0);
    hubbaMesh.castShadow = true;
    hubbaMesh.receiveShadow = true;
    scene.add(hubbaMesh);

    const hubbaCoping = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, hubbaL, 8), copingMat);
    hubbaCoping.position.set(deckSize / 2 + hubbaW, hubbaH + 0.06, 0);
    hubbaCoping.castShadow = true;
    scene.add(hubbaCoping);

    registerObstacle({
      type: 'ledge',
      x: deckSize / 2 + hubbaW / 2,
      z: 0,
      width: hubbaW + 0.2,
      length: hubbaL,
      height: hubbaH + 0.06,
    });

    // =========================================================================
    // 2. PERIMETER QUARTER BANK TRANSITIONS (North & South Returns)
    // =========================================================================
    // North Bank Return (Faces South into the park)
    const qbNorth = createQuarterBankMesh(15.0, 3.2, 0.85, Math.PI, bankMat);
    qbNorth.position.set(0, 0.06, -15.5);
    scene.add(qbNorth);
    registerObstacle({
      type: 'bank_z',
      x: 0,
      zStart: -12.3,
      zEnd: -15.5,
      width: 15.0,
      yStart: 0.06,
      yEnd: 0.91,
    });

    // South Bank Return (Faces North into the park)
    const qbSouth = createQuarterBankMesh(15.0, 3.2, 0.85, 0, bankMat);
    qbSouth.position.set(0, 0.06, 12.3);
    scene.add(qbSouth);
    registerObstacle({
      type: 'bank_z',
      x: 0,
      zStart: 12.3,
      zEnd: 15.5,
      width: 15.0,
      yStart: 0.06,
      yEnd: 0.91,
    });

    // =========================================================================
    // 3. WEST STREET LINE (Double-Tier Manual Pad & Gold Flatbar Rail)
    // =========================================================================
    // Stage 1 Low Manny Pad (0.22m)
    const mp1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 3.6), concreteMat);
    mp1.position.set(-10.5, 0.11 + 0.06, -1.8);
    mp1.castShadow = true;
    mp1.receiveShadow = true;
    scene.add(mp1);
    registerObstacle({ type: 'deck', x: -10.5, z: -1.8, width: 2.4, length: 3.6, height: 0.28 });

    // Stage 2 Elevated Manny Pad (0.38m)
    const mp2 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.38, 3.6), concreteMat);
    mp2.position.set(-10.5, 0.19 + 0.06, 1.8);
    mp2.castShadow = true;
    mp2.receiveShadow = true;
    scene.add(mp2);
    registerObstacle({ type: 'deck', x: -10.5, z: 1.8, width: 2.4, length: 3.6, height: 0.44 });

    // Anodized Gold Flatbar Rail (Parallel to manny pad)
    createGrindRail(-13.2, 0, 9.0, 0.38, 0xfacc15);

    // =========================================================================
    // 4. EAST STREET LINE (Euro Gap Step-Up & Neon Violet Rail)
    // =========================================================================
    // Euro Gap Launch Kicker (South approach)
    createKickerRamp(10.5, 3.5, 2.8, 2.8, 0.62, Math.PI);
    // Elevated Landing Deck (North of kicker with 1.4m gap)
    const euroDeck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.55, 3.8), woodDeckMat);
    euroDeck.position.set(10.5, 0.55 / 2 + 0.06, -1.2);
    euroDeck.castShadow = true;
    euroDeck.receiveShadow = true;
    scene.add(euroDeck);
    registerObstacle({ type: 'deck', x: 10.5, z: -1.2, width: 3.2, length: 3.8, height: 0.61 });

    // Neon Violet Flatbar Rail
    createGrindRail(13.4, 0, 9.0, 0.38, 0xa855f7);

    // =========================================================================
    // 5. PLAZA STREET JUMP LINES (Tabletop, Quarter Spine & Hip Transfer)
    // =========================================================================
    // A. Concrete Street Tabletop / Launch Box (Northwest Plaza, x: -7.5, z: -7.5)
    createTabletopJump(-7.5, -7.5, 7.0, 3.4, 0.62);

    // B. Curved Launch Kicker to Bank Transfer (Northeast Plaza, x: 7.5, z: -7.5)
    createKickerRamp(7.5, -7.5, 3.2, 3.4, 0.68, Math.PI * 0.75);

    // C. Quarter Pipe Return Spine (Southeast Plaza, x: 7.5, z: 7.5)
    const plazaQuarter = createQuarterBankMesh(5.2, 3.2, 0.78, -Math.PI * 0.25, bankMat);
    plazaQuarter.position.set(7.5, 0.06, 7.5);
    scene.add(plazaQuarter);
    registerObstacle({
      type: 'bank_z',
      x: 7.5,
      zStart: 5.9,
      zEnd: 9.1,
      width: 5.2,
      yStart: 0.06,
      yEnd: 0.84,
    });

    // Curbs surrounding the plaza
    createCurbs();
  }

  // Grind Rail Builder with Stanchions & Spark Collider
  function createGrindRail(x, z, length = 11.0, height = 0.40, colorHex = 0xfacc15) {
    const railGeo = new THREE.CylinderGeometry(0.045, 0.045, length, 12);
    railGeo.rotateX(Math.PI / 2);
    const railMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.9, roughness: 0.22 });
    const railMesh = new THREE.Mesh(railGeo, railMat);
    railMesh.position.set(x, height + 0.06, z);
    railMesh.castShadow = true;
    scene.add(railMesh);

    const postSpacing = length / 3;
    [-postSpacing, 0, postSpacing].forEach((offset) => {
      const postGeo = new THREE.CylinderGeometry(0.035, 0.035, height, 8);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8 });
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, (height / 2) + 0.06, z + offset);
      post.castShadow = true;
      scene.add(post);
    });

    registerObstacle({
      type: 'rail',
      x: x,
      z: z,
      width: 0.52,
      length: length,
      height: height + 0.06,
    });
  }

  // Curbs surrounding the plaza
  function createCurbs() {
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7 });
    const curbH = 0.22;
    const curbW = 0.35;
    const half = 19;

    const sides = [
      { x: 0, z: -half, len: 14, rot: 0, offX: -11 },
      { x: 0, z: -half, len: 14, rot: 0, offX: 11 },
      { x: 0, z: half, len: 14, rot: 0, offX: -11 },
      { x: 0, z: half, len: 14, rot: 0, offX: 11 },
      { x: -half, z: 0, len: 14, rot: Math.PI / 2, offZ: -11 },
      { x: -half, z: 0, len: 14, rot: Math.PI / 2, offZ: 11 },
      { x: half, z: 0, len: 14, rot: Math.PI / 2, offZ: -11 },
      { x: half, z: 0, len: 14, rot: Math.PI / 2, offZ: 11 },
    ];

    sides.forEach((s) => {
      const curbGeo = new THREE.BoxGeometry(s.len, curbH, curbW);
      const curb = new THREE.Mesh(curbGeo, curbMat);
      curb.position.set(s.x + (s.offX || 0), curbH / 2 + 0.06, s.z + (s.offZ || 0));
      curb.rotation.y = s.rot;
      curb.castShadow = true;
      curb.receiveShadow = true;
      scene.add(curb);

      registerObstacle({
        type: 'curb',
        x: curb.position.x,
        z: curb.position.z,
        width: s.rot === 0 ? s.len : curbW,
        length: s.rot === 0 ? curbW : s.len,
        height: curbH + 0.06,
      });
    });
  }

  // ==========================================================================
  // 5. Specialized Stunt Jumps (Tabletop, Gap, Whale Tail, Mega Drop)
  // ==========================================================================
  function createStuntJumpLines() {
    // 1. EAST: Pine Ridge Red Bull Mountain Bike / Slopestyle Timber Course
    createPineRidgeTimberCourse(55, 42);

    // 2. WEST: Slickrock Red Bull Hardline / Motocross Canyon Course
    createSlickrockMotocrossCourse(-58, 42);

    // 3. NORTH: Mega Drop Roll-In Tower & Super Jump (Thunder Peak)
    createMegaDropRamp(0, -72);
  }

  // General Reusable Tabletop Jump (Used in Central Skatepark and Beyond)
  function createTabletopJump(x, z, length, width, height, customDeckMat, customSideMat) {
    const baseY = getTerrainElevation(x, z);
    const group = new THREE.Group();

    const takeoffLen = Math.min(4.0, length * 0.32);
    const landingLen = Math.min(4.0, length * 0.32);
    const deckLen = length - takeoffLen - landingLen;

    const deckMat = customDeckMat || new THREE.MeshStandardMaterial({ color: 0xcd853f, roughness: 0.65 });
    const sideMat = customSideMat || new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });

    // 1. Takeoff Ramp (Wedge up)
    const takeoffShape = new THREE.Shape();
    takeoffShape.moveTo(0, 0);
    takeoffShape.lineTo(takeoffLen, height);
    takeoffShape.lineTo(takeoffLen, 0);
    takeoffShape.closePath();

    const takeoffGeom = new THREE.ExtrudeGeometry(takeoffShape, { depth: width, bevelEnabled: false });
    takeoffGeom.center();
    const takeoffMesh = new THREE.Mesh(takeoffGeom, deckMat);
    takeoffMesh.position.set(0, height / 2, takeoffLen / 2 + deckLen / 2);
    takeoffMesh.rotation.y = Math.PI / 2;
    takeoffMesh.castShadow = true;
    takeoffMesh.receiveShadow = true;
    group.add(takeoffMesh);

    // 2. Flat Table Deck
    const deckGeo = new THREE.BoxGeometry(width, height, deckLen);
    const deckMesh = new THREE.Mesh(deckGeo, deckMat);
    deckMesh.position.set(0, height / 2, 0);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    group.add(deckMesh);

    // 3. Landing Slope (Wedge down)
    const landShape = new THREE.Shape();
    landShape.moveTo(0, height);
    landShape.lineTo(landingLen, 0);
    landShape.lineTo(0, 0);
    landShape.closePath();

    const landGeom = new THREE.ExtrudeGeometry(landShape, { depth: width, bevelEnabled: false });
    landGeom.center();
    const landMesh = new THREE.Mesh(landGeom, deckMat);
    landMesh.position.set(0, height / 2, -landingLen / 2 - deckLen / 2);
    landMesh.rotation.y = Math.PI / 2;
    landMesh.castShadow = true;
    landMesh.receiveShadow = true;
    group.add(landMesh);

    group.position.set(x, baseY, z);
    scene.add(group);

    registerObstacle({
      type: 'tabletop',
      x: x,
      z: z,
      baseY: baseY,
      width: width,
      length: length,
      height: height,
      takeoffLen: takeoffLen,
      deckLen: deckLen,
      landingLen: landingLen,
    });
  }

  // General Reusable Gap Jump Helper
  function createGapJump(x, z, kickerLen, width, kickerHeight, gapDist, landLen, landHeight) {
    const baseY = getTerrainElevation(x, z);
    const group = new THREE.Group();

    const rampMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });
    const hazardMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, emissiveIntensity: 0.5 });

    const shapeKicker = new THREE.Shape();
    shapeKicker.moveTo(0, 0);
    shapeKicker.lineTo(kickerLen, kickerHeight);
    shapeKicker.lineTo(kickerLen, 0);
    shapeKicker.closePath();

    const kickerGeom = new THREE.ExtrudeGeometry(shapeKicker, { depth: width, bevelEnabled: false });
    kickerGeom.center();
    const kickerMesh = new THREE.Mesh(kickerGeom, rampMat);
    kickerMesh.position.set(0, kickerHeight / 2, (gapDist / 2) + (kickerLen / 2));
    kickerMesh.rotation.y = Math.PI / 2;
    kickerMesh.castShadow = true;
    kickerMesh.receiveShadow = true;
    group.add(kickerMesh);

    [-width / 2 - 0.3, width / 2 + 0.3].forEach((px) => {
      const pylonGeo = new THREE.CylinderGeometry(0.1, 0.12, 1.2, 8);
      const pylon = new THREE.Mesh(pylonGeo, hazardMat);
      pylon.position.set(px, 0.6, gapDist / 2);
      pylon.castShadow = true;
      group.add(pylon);

      const pylonLand = pylon.clone();
      pylonLand.position.set(px, 0.6, -gapDist / 2);
      group.add(pylonLand);
    });

    const shapeLand = new THREE.Shape();
    shapeLand.moveTo(0, landHeight);
    shapeLand.lineTo(landLen, 0);
    shapeLand.lineTo(0, 0);
    shapeLand.closePath();

    const landGeom = new THREE.ExtrudeGeometry(shapeLand, { depth: width, bevelEnabled: false });
    landGeom.center();
    const landMesh = new THREE.Mesh(landGeom, rampMat);
    landMesh.position.set(0, landHeight / 2, (-gapDist / 2) - (landLen / 2));
    landMesh.rotation.y = Math.PI / 2;
    landMesh.castShadow = true;
    landMesh.receiveShadow = true;
    group.add(landMesh);

    group.position.set(x, baseY, z);
    scene.add(group);

    registerObstacle({
      type: 'gap_kicker',
      x: x,
      z: z + (gapDist / 2) + (kickerLen / 2),
      baseY: baseY,
      width: width,
      length: kickerLen,
      height: kickerHeight,
    });

    registerObstacle({
      type: 'gap_landing',
      x: x,
      z: z - (gapDist / 2) - (landLen / 2),
      baseY: baseY,
      width: width,
      length: landLen,
      height: landHeight,
    });
  }

  // ==========================================================================
  // TRAIL 1: PINE RIDGE RED BULL SLOPESTYLE TIMBER COURSE (East: x ~ 55, z: 42 to -23)
  // Natural rustic wooden features linked into a continuous slopestyle flow trail
  // ==========================================================================
  function createPineRidgeTimberCourse(courseX = 55, startZ = 42) {
    const group = new THREE.Group();

    // Natural Rustic Timber Materials
    const cedarDeckMat = new THREE.MeshStandardMaterial({ color: 0x925c2b, roughness: 0.82 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x4a2a11, roughness: 0.94 });
    const logPostMat = new THREE.MeshStandardMaterial({ color: 0x3b220e, roughness: 0.95 });
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.5, metalness: 0.1 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.4 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.9, flatShading: true });

    // 1. TIMBER STAGING TOWER & ROLL-IN DROP CHUTE (z: 44 to 32)
    const towerBaseY = getTerrainElevation(courseX, 42);
    const towerH = 3.2;
    const towerPlatformY = towerBaseY + towerH;

    // Platform Deck (5.4m x 4.0m at z: 40 to 44)
    const platGeo = new THREE.BoxGeometry(5.4, 0.35, 4.0);
    const platMesh = new THREE.Mesh(platGeo, cedarDeckMat);
    platMesh.position.set(courseX, towerPlatformY - 0.175, 42);
    platMesh.castShadow = true;
    platMesh.receiveShadow = true;
    group.add(platMesh);

    // Supporting Log Pilings down to ground
    [-2.4, 2.4].forEach((px) => {
      [40.3, 43.7].forEach((pz) => {
        const postH = towerPlatformY - getTerrainElevation(courseX + px, pz);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, postH, 8), logPostMat);
        post.position.set(courseX + px, towerPlatformY - postH / 2, pz);
        post.castShadow = true;
        group.add(post);
      });
    });

    // Rustic Log Railings (Left, Right, and Back)
    const railMat = logPostMat;
    [-2.55, 2.55].forEach((rx) => {
      const sideRail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.0, 8), railMat);
      sideRail.rotation.x = Math.PI / 2;
      sideRail.position.set(courseX + rx, towerPlatformY + 0.55, 42);
      sideRail.castShadow = true;
      group.add(sideRail);
    });
    const backRail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.2, 8), railMat);
    backRail.rotation.z = Math.PI / 2;
    backRail.position.set(courseX, towerPlatformY + 0.55, 43.85);
    group.add(backRail);

    // Start Gate Arch & Banner: "PINE RIDGE SLOPESTYLE"
    [-2.6, 2.6].forEach((ax) => {
      const archPost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.0, 8), logPostMat);
      archPost.position.set(courseX + ax, towerPlatformY + 2.5, 40.2);
      archPost.castShadow = true;
      group.add(archPost);
    });
    const archBeam = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.55, 0.18), bannerMat);
    archBeam.position.set(courseX, towerPlatformY + 4.6, 40.2);
    group.add(archBeam);

    registerObstacle({
      type: 'deck',
      x: courseX,
      z: 42,
      width: 5.4,
      length: 4.0,
      height: towerPlatformY,
    });

    // Roll-In Downward Drop Runway (z: 40 to 32, drops from 3.2m down to 0.15m)
    const dropRunwayLen = 8.0;
    const dropBottomY = getTerrainElevation(courseX, 32) + 0.15;
    const dropHeightDelta = towerPlatformY - dropBottomY;

    const dropShape = new THREE.Shape();
    dropShape.moveTo(0, dropHeightDelta);
    dropShape.lineTo(dropRunwayLen, 0);
    dropShape.lineTo(0, 0);
    dropShape.closePath();

    const dropGeom = new THREE.ExtrudeGeometry(dropShape, { depth: 4.4, bevelEnabled: false });
    dropGeom.center();
    const dropMesh = new THREE.Mesh(dropGeom, cedarDeckMat);
    dropMesh.position.set(courseX, dropBottomY + dropHeightDelta / 2, 36);
    dropMesh.rotation.y = -Math.PI / 2; // High at South (+Z), Low at North (-Z)
    dropMesh.castShadow = true;
    dropMesh.receiveShadow = true;
    group.add(dropMesh);

    // Cross slat rungs along roll-in
    for (let i = 0; i < 7; i++) {
      const rz = 39.0 - i * 1.0;
      const t = (39.0 - rz) / 7.0;
      const ry = towerPlatformY - t * dropHeightDelta;
      const slat = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 0.12), darkWoodMat);
      slat.position.set(courseX, ry + 0.04, rz);
      group.add(slat);
    }

    registerObstacle({
      type: 'slopestyle_rollin',
      x: courseX,
      zStart: 40.0,
      zEnd: 32.0,
      yStart: towerPlatformY,
      yEnd: dropBottomY,
      width: 4.4,
      accelForce: 24.0,
    });

    // 2. LADDER STEP-UP RAMP (z: 29.8 to 25.8)
    const stepUpLen = 4.0;
    const stepUpBaseY = getTerrainElevation(courseX, 27.8);
    const stepUpTopY = stepUpBaseY + 1.85;
    const stepUpHeight = 1.85;

    const stepUpShape = new THREE.Shape();
    stepUpShape.moveTo(0, 0);
    stepUpShape.lineTo(stepUpLen, stepUpHeight);
    stepUpShape.lineTo(stepUpLen, 0);
    stepUpShape.closePath();

    const stepUpGeom = new THREE.ExtrudeGeometry(stepUpShape, { depth: 3.6, bevelEnabled: false });
    stepUpGeom.center();
    const stepUpMesh = new THREE.Mesh(stepUpGeom, cedarDeckMat);
    stepUpMesh.position.set(courseX, stepUpBaseY + stepUpHeight / 2, 27.8);
    stepUpMesh.rotation.y = Math.PI / 2; // Low at South (+Z), High at North (-Z)
    stepUpMesh.castShadow = true;
    stepUpMesh.receiveShadow = true;
    group.add(stepUpMesh);

    // Ladder rungs
    for (let i = 0; i < 5; i++) {
      const rz = 29.2 - i * 0.8;
      const t = (29.8 - rz) / 4.0;
      const ry = stepUpBaseY + t * stepUpHeight;
      const rung = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.07, 0.14), darkWoodMat);
      rung.position.set(courseX, ry + 0.04, rz);
      group.add(rung);
    }

    registerObstacle({
      type: 'slopestyle_stepup',
      x: courseX,
      zStart: 29.8,
      zEnd: 25.8,
      yStart: stepUpBaseY + 0.15,
      yEnd: stepUpTopY,
      width: 3.6,
    });

    // 3. ELEVATED LOG BOARDWALK BRIDGE (z: 25.8 to 15.8)
    const bridgeLen = 10.0;
    const bridgeY = stepUpTopY;
    const bridgeGeo = new THREE.BoxGeometry(3.4, 0.30, bridgeLen);
    const bridgeMesh = new THREE.Mesh(bridgeGeo, cedarDeckMat);
    bridgeMesh.position.set(courseX, bridgeY - 0.15, 20.8);
    bridgeMesh.castShadow = true;
    bridgeMesh.receiveShadow = true;
    group.add(bridgeMesh);

    // Side log curbs
    [-1.6, 1.6].forEach((cx) => {
      const curb = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, bridgeLen, 8), logPostMat);
      curb.rotation.x = Math.PI / 2;
      curb.position.set(courseX + cx, bridgeY + 0.08, 20.8);
      curb.castShadow = true;
      group.add(curb);
    });

    // Support pilings
    [24.5, 21.0, 17.5].forEach((pz) => {
      [-1.5, 1.5].forEach((px) => {
        const postH = bridgeY - getTerrainElevation(courseX + px, pz);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, postH, 8), logPostMat);
        post.position.set(courseX + px, bridgeY - postH / 2, pz);
        post.castShadow = true;
        group.add(post);
      });
    });

    registerObstacle({
      type: 'bridge',
      x: courseX,
      z: 20.8,
      width: 3.4,
      length: bridgeLen,
      height: bridgeY,
    });

    // 4. NATURAL CURVED WOODEN WHALE TAIL FEATURE (z: 15.0 to 1.0)
    const wtBaseY = getTerrainElevation(courseX, 8.0);
    const wtHeight = 2.2;
    const wtWidth = 3.6;

    // Stage 1: Curved Step-Up (z: 15.0 to 10.5, len: 4.5)
    const wtStepShape = new THREE.Shape();
    wtStepShape.moveTo(0, 0);
    wtStepShape.quadraticCurveTo(3.2, 0.5, 4.5, wtHeight);
    wtStepShape.lineTo(4.5, 0);
    wtStepShape.closePath();

    const wtStepGeom = new THREE.ExtrudeGeometry(wtStepShape, { depth: wtWidth, bevelEnabled: false });
    wtStepGeom.center();
    const wtStepMesh = new THREE.Mesh(wtStepGeom, cedarDeckMat);
    wtStepMesh.position.set(courseX, wtBaseY + wtHeight / 2, 12.75);
    wtStepMesh.rotation.y = Math.PI / 2; // Rises going North
    wtStepMesh.castShadow = true;
    wtStepMesh.receiveShadow = true;
    group.add(wtStepMesh);

    // Stage 2: Arched Whale Tail Spine Deck with Flared Wings (z: 10.5 to 5.5, len: 5.0)
    const wtSpineGeo = new THREE.BoxGeometry(wtWidth, 0.28, 5.0);
    const wtSpineMesh = new THREE.Mesh(wtSpineGeo, cedarDeckMat);
    wtSpineMesh.position.set(courseX, wtBaseY + wtHeight + 0.14, 8.0);
    wtSpineMesh.castShadow = true;
    wtSpineMesh.receiveShadow = true;
    group.add(wtSpineMesh);

    // Flared "whale tail" side wings
    [-wtWidth / 2 - 0.45, wtWidth / 2 + 0.45].forEach((wx, wIdx) => {
      const wingGeo = new THREE.BoxGeometry(0.85, 0.2, 3.2);
      const wing = new THREE.Mesh(wingGeo, darkWoodMat);
      wing.position.set(courseX + wx, wtBaseY + wtHeight + 0.18, 8.0);
      wing.rotation.z = (wIdx === 0 ? 1 : -1) * 0.18;
      group.add(wing);
    });

    // Stage 3: Step-Down Drop Kicker (z: 5.5 to 1.0, len: 4.5)
    const wtDropShape = new THREE.Shape();
    wtDropShape.moveTo(0, wtHeight);
    wtDropShape.lineTo(4.5, 0);
    wtDropShape.lineTo(0, 0);
    wtDropShape.closePath();

    const wtDropGeom = new THREE.ExtrudeGeometry(wtDropShape, { depth: wtWidth, bevelEnabled: false });
    wtDropGeom.center();
    const wtDropMesh = new THREE.Mesh(wtDropGeom, cedarDeckMat);
    wtDropMesh.position.set(courseX, wtBaseY + wtHeight / 2, 3.25);
    wtDropMesh.rotation.y = -Math.PI / 2; // Drops going North
    wtDropMesh.castShadow = true;
    wtDropMesh.receiveShadow = true;
    group.add(wtDropMesh);

    // Timber support pilings under whale tail
    [10.5, 8.0, 5.5].forEach((pz) => {
      [-1.6, 1.6].forEach((px) => {
        const postH = wtHeight + 0.2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, postH, 8), logPostMat);
        post.position.set(courseX + px, wtBaseY + postH / 2, pz);
        post.castShadow = true;
        group.add(post);
      });
    });

    registerObstacle({
      type: 'timber_whaletail',
      x: courseX,
      zStart: 15.0,
      zEnd: 1.0,
      baseY: wtBaseY,
      width: wtWidth,
      height: wtHeight,
    });

    // 5. BANKED TIMBER WALLRIDE (z: 0.0 to -7.5)
    const wallBaseY = getTerrainElevation(courseX, -3.75);
    const wallLen = 7.5;
    const wallW = 4.6;
    const wallH = 2.4;

    const wallGeo = new THREE.BoxGeometry(wallW, 0.22, wallLen);
    const wallMesh = new THREE.Mesh(wallGeo, cedarDeckMat);
    wallMesh.position.set(courseX, wallBaseY + 0.85, -3.75);
    wallMesh.rotation.z = -0.42; // Banked: high on East side (+X), low on West (-X)
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    group.add(wallMesh);

    // A-frame timber braces behind the high wall
    [-1.8, -3.8, -5.8].forEach((bz) => {
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8), logPostMat);
      brace.position.set(courseX + 2.0, wallBaseY + 1.1, bz);
      brace.rotation.z = 0.55;
      brace.castShadow = true;
      group.add(brace);
    });

    registerObstacle({
      type: 'wallride',
      x: courseX,
      zStart: 0.0,
      zEnd: -7.5,
      baseY: wallBaseY,
      width: wallW,
      height: wallH,
    });

    // 6. FOREST RAVINE LOG ROAD GAP MEGA JUMP (z: -9.0 to -23.0)
    const gapBaseY = getTerrainElevation(courseX, -16.0);
    const kickerLen = 4.0;
    const kickerW = 3.8;
    const kickerH = 2.1;
    const landLen = 5.0;
    const landW = 4.4;
    const landH = 1.9;

    // Takeoff Kicker (z: -9.0 to -13.0, center z: -11.0)
    const kShape = new THREE.Shape();
    kShape.moveTo(0, 0);
    kShape.quadraticCurveTo(kickerLen * 0.7, 0.4, kickerLen, kickerH);
    kShape.lineTo(kickerLen, 0);
    kShape.closePath();

    const kGeom = new THREE.ExtrudeGeometry(kShape, { depth: kickerW, bevelEnabled: false });
    kGeom.center();
    const kMesh = new THREE.Mesh(kGeom, cedarDeckMat);
    kMesh.position.set(courseX, gapBaseY + kickerH / 2, -11.0);
    kMesh.rotation.y = Math.PI / 2; // Rises going North
    kMesh.castShadow = true;
    kMesh.receiveShadow = true;
    group.add(kMesh);

    // Hazard markers at kicker lip
    [-kickerW / 2 - 0.25, kickerW / 2 + 0.25].forEach((px) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), logPostMat);
      post.position.set(courseX + px, gapBaseY + kickerH + 0.6, -13.0);
      post.castShadow = true;
      group.add(post);

      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.04), flagMat);
      flag.position.set(courseX + px + 0.18, gapBaseY + kickerH + 1.2, -13.0);
      group.add(flag);
    });

    // Natural rocky ravine below the gap (z: -13.0 to -17.5)
    for (let i = 0; i < 5; i++) {
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + Math.random() * 0.6, 1), rockMat);
      rk.position.set(courseX + (Math.random() - 0.5) * 4.0, gapBaseY + 0.3, -15.2 + (Math.random() - 0.5) * 2.5);
      rk.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      rk.castShadow = true;
      group.add(rk);
    }

    // Banked Landing Receiver (z: -17.5 to -22.5, center z: -20.0)
    const lShape = new THREE.Shape();
    lShape.moveTo(0, landH);
    lShape.lineTo(landLen, 0);
    lShape.lineTo(0, 0);
    lShape.closePath();

    const lGeom = new THREE.ExtrudeGeometry(lShape, { depth: landW, bevelEnabled: false });
    lGeom.center();
    const lMesh = new THREE.Mesh(lGeom, cedarDeckMat);
    lMesh.position.set(courseX, gapBaseY + landH / 2, -20.0);
    lMesh.rotation.y = -Math.PI / 2; // Slopes down going North
    lMesh.castShadow = true;
    lMesh.receiveShadow = true;
    group.add(lMesh);

    registerObstacle({
      type: 'gap_kicker',
      x: courseX,
      z: -11.0,
      baseY: gapBaseY,
      width: kickerW,
      length: kickerLen,
      height: kickerH,
      dir: -1,
    });

    registerObstacle({
      type: 'gap_landing',
      x: courseX,
      z: -20.0,
      baseY: gapBaseY,
      width: landW,
      length: landLen,
      height: landH,
      dir: -1,
    });

    scene.add(group);
  }

  // ==========================================================================
  // TRAIL 2: SLICKROCK MOTOCROSS CANYON COURSE (West: x ~ -58, z: 42 to -23)
  // High-speed Red Bull Hardline / Motocross dirt jumps, rhythm whoops & canyon gaps
  // ==========================================================================
  function createSlickrockMotocrossCourse(courseX = -58, startZ = 42) {
    const group = new THREE.Group();

    // Red Sandstone & Terracotta Dirt Materials
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0xbd4b1e, roughness: 0.94 });
    const darkDirtMat = new THREE.MeshStandardMaterial({ color: 0x8a3010, roughness: 0.96 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e240a, roughness: 0.95, flatShading: true });
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });

    // 1. MOTOCROSS STARTING MOUND & DROP-IN (z: 44 to 33.5)
    const moundBaseY = getTerrainElevation(courseX, 42);
    const moundH = 3.0;
    const moundTopY = moundBaseY + moundH;

    // Starting Mound Flat Deck (5.6m x 4.0m at z: 40 to 44)
    const moundGeo = new THREE.BoxGeometry(5.6, moundH, 4.0);
    const moundMesh = new THREE.Mesh(moundGeo, dirtMat);
    moundMesh.position.set(courseX, moundBaseY + moundH / 2, 42);
    moundMesh.castShadow = true;
    moundMesh.receiveShadow = true;
    group.add(moundMesh);

    // Starting Arch Truss: "RED BULL HARDLINE CANYON"
    [-2.7, 2.7].forEach((ax) => {
      const archPole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.8, 8), steelMat);
      archPole.position.set(courseX + ax, moundTopY + 2.4, 40.2);
      archPole.castShadow = true;
      group.add(archPole);
    });
    const archBanner = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.65, 0.15), markerMat);
    archBanner.position.set(courseX, moundTopY + 4.5, 40.2);
    group.add(archBanner);

    registerObstacle({
      type: 'deck',
      x: courseX,
      z: 42,
      width: 5.6,
      length: 4.0,
      height: moundTopY,
    });

    // Roll-In Steep Drop Chute (z: 40 to 33.5, len: 6.5)
    const chuteLen = 6.5;
    const chuteBottomY = getTerrainElevation(courseX, 33.5) + 0.15;
    const chuteH = moundTopY - chuteBottomY;

    const chuteShape = new THREE.Shape();
    chuteShape.moveTo(0, chuteH);
    chuteShape.lineTo(chuteLen, 0);
    chuteShape.lineTo(0, 0);
    chuteShape.closePath();

    const chuteGeom = new THREE.ExtrudeGeometry(chuteShape, { depth: 5.0, bevelEnabled: false });
    chuteGeom.center();
    const chuteMesh = new THREE.Mesh(chuteGeom, dirtMat);
    chuteMesh.position.set(courseX, chuteBottomY + chuteH / 2, 36.75);
    chuteMesh.rotation.y = -Math.PI / 2; // Drops going North
    chuteMesh.castShadow = true;
    chuteMesh.receiveShadow = true;
    group.add(chuteMesh);

    registerObstacle({
      type: 'mx_rollin',
      x: courseX,
      zStart: 40.0,
      zEnd: 33.5,
      yStart: moundTopY,
      yEnd: chuteBottomY,
      width: 5.0,
      accelForce: 26.0,
    });

    // 2. 16-METER MONSTER DIRT TABLETOP (z: 32.0 to 16.0)
    const ttBaseY = getTerrainElevation(courseX, 24.0);
    const ttWidth = 5.0;
    const ttHeight = 2.25;
    const ttTakeoffLen = 5.0; // z: 32 to 27
    const ttDeckLen = 6.0;    // z: 27 to 21
    const ttLandLen = 5.0;    // z: 21 to 16

    // Takeoff Ramp (z: 32 to 27, center z: 29.5)
    const ttTkShape = new THREE.Shape();
    ttTkShape.moveTo(0, 0);
    ttTkShape.lineTo(ttTakeoffLen, ttHeight);
    ttTkShape.lineTo(ttTakeoffLen, 0);
    ttTkShape.closePath();

    const ttTkGeom = new THREE.ExtrudeGeometry(ttTkShape, { depth: ttWidth, bevelEnabled: false });
    ttTkGeom.center();
    const ttTkMesh = new THREE.Mesh(ttTkGeom, dirtMat);
    ttTkMesh.position.set(courseX, ttBaseY + ttHeight / 2, 29.5);
    ttTkMesh.rotation.y = Math.PI / 2; // Rises going North
    ttTkMesh.castShadow = true;
    ttTkMesh.receiveShadow = true;
    group.add(ttTkMesh);

    // Tabletop Flat Deck (z: 27 to 21, center z: 24.0)
    const ttDeckGeo = new THREE.BoxGeometry(ttWidth, ttHeight, ttDeckLen);
    const ttDeckMesh = new THREE.Mesh(ttDeckGeo, dirtMat);
    ttDeckMesh.position.set(courseX, ttBaseY + ttHeight / 2, 24.0);
    ttDeckMesh.castShadow = true;
    ttDeckMesh.receiveShadow = true;
    group.add(ttDeckMesh);

    // Landing Slope (z: 21 to 16, center z: 18.5)
    const ttLdShape = new THREE.Shape();
    ttLdShape.moveTo(0, ttHeight);
    ttLdShape.lineTo(ttLandLen, 0);
    ttLdShape.lineTo(0, 0);
    ttLdShape.closePath();

    const ttLdGeom = new THREE.ExtrudeGeometry(ttLdShape, { depth: ttWidth, bevelEnabled: false });
    ttLdGeom.center();
    const ttLdMesh = new THREE.Mesh(ttLdGeom, dirtMat);
    ttLdMesh.position.set(courseX, ttBaseY + ttHeight / 2, 18.5);
    ttLdMesh.rotation.y = -Math.PI / 2; // Slopes down going North
    ttLdMesh.castShadow = true;
    ttLdMesh.receiveShadow = true;
    group.add(ttLdMesh);

    // High-vis flex-marker pylons flanking the tabletop
    [-ttWidth / 2 - 0.3, ttWidth / 2 + 0.3].forEach((mx) => {
      [27.0, 24.0, 21.0].forEach((mz) => {
        const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.1, 8), markerMat);
        marker.position.set(courseX + mx, ttBaseY + ttHeight + 0.55, mz);
        marker.castShadow = true;
        group.add(marker);
      });
    });

    registerObstacle({
      type: 'tabletop',
      x: courseX,
      z: 24.0,
      baseY: ttBaseY,
      width: ttWidth,
      length: 16.0,
      height: ttHeight,
      takeoffLen: ttTakeoffLen,
      deckLen: ttDeckLen,
      landingLen: ttLandLen,
      dir: -1,
      zStart: 32.0,
      zEnd: 16.0,
    });

    // 3. QUAD RHYTHM WHOOP ROLLERS (z: 15.0 to 1.0)
    const whoopBaseY = getTerrainElevation(courseX, 8.0);
    const whoopLen = 14.0;
    const whoopW = 5.2;
    const whoopH = 0.65;
    const count = 4;
    const wavelength = whoopLen / count;

    // Solid base box
    const whoopBaseGeo = new THREE.BoxGeometry(whoopW, 0.55, whoopLen);
    const whoopBaseMesh = new THREE.Mesh(whoopBaseGeo, darkDirtMat);
    whoopBaseMesh.position.set(courseX, whoopBaseY + 0.275, 8.0);
    group.add(whoopBaseMesh);

    // 4 undulating dirt rollers
    for (let i = 0; i < count; i++) {
      const rollerZ = 15.0 - (i + 0.5) * wavelength;
      const rollerGeo = new THREE.CylinderGeometry(0.7, 0.7, whoopW, 16, 1, false, 0, Math.PI);
      rollerGeo.rotateZ(Math.PI / 2);
      const roller = new THREE.Mesh(rollerGeo, dirtMat);
      roller.position.set(courseX, whoopBaseY + 0.55, rollerZ);
      roller.castShadow = true;
      roller.receiveShadow = true;
      group.add(roller);
    }

    registerObstacle({
      type: 'whoops',
      x: courseX,
      zStart: 15.0,
      zEnd: 1.0,
      baseY: whoopBaseY,
      width: whoopW,
      height: whoopH,
      count: count,
    });

    // 4. CANYON MEGA-LAUNCHER GAP JUMP (z: -1.0 to -17.5)
    const gapBaseY = getTerrainElevation(courseX, -9.25);
    const kickerLen = 4.5;
    const kickerW = 4.8;
    const kickerH = 2.5;
    const landLen = 5.0;
    const landW = 5.4;
    const landH = 2.3;

    // Mega Takeoff Kicker (z: -1.0 to -5.5, center z: -3.25)
    const mkShape = new THREE.Shape();
    mkShape.moveTo(0, 0);
    mkShape.quadraticCurveTo(kickerLen * 0.65, 0.4, kickerLen, kickerH);
    mkShape.lineTo(kickerLen, 0);
    mkShape.closePath();

    const mkGeom = new THREE.ExtrudeGeometry(mkShape, { depth: kickerW, bevelEnabled: false });
    mkGeom.center();
    const mkMesh = new THREE.Mesh(mkGeom, dirtMat);
    mkMesh.position.set(courseX, gapBaseY + kickerH / 2, -3.25);
    mkMesh.rotation.y = Math.PI / 2; // Rises going North
    mkMesh.castShadow = true;
    mkMesh.receiveShadow = true;
    group.add(mkMesh);

    // Marker flags on kicker
    [-kickerW / 2 - 0.25, kickerW / 2 + 0.25].forEach((px) => {
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 8), steelMat);
      flagPole.position.set(courseX + px, gapBaseY + kickerH + 0.7, -5.5);
      flagPole.castShadow = true;
      group.add(flagPole);
      const flagMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.02), markerMat);
      flagMesh.position.set(courseX + px + 0.18, gapBaseY + kickerH + 1.25, -5.5);
      group.add(flagMesh);
    });

    // Deep rocky chasm below the gap (z: -5.5 to -12.5)
    for (let i = 0; i < 7; i++) {
      const bld = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85 + Math.random() * 0.7, 1), rockMat);
      bld.position.set(courseX + (Math.random() - 0.5) * 5.0, gapBaseY + 0.35, -9.0 + (Math.random() - 0.5) * 3.5);
      bld.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      bld.castShadow = true;
      group.add(bld);
    }

    // Banked Landing Receiver (z: -12.5 to -17.5, center z: -15.0)
    const mlShape = new THREE.Shape();
    mlShape.moveTo(0, landH);
    mlShape.lineTo(landLen, 0);
    mlShape.lineTo(0, 0);
    mlShape.closePath();

    const mlGeom = new THREE.ExtrudeGeometry(mlShape, { depth: landW, bevelEnabled: false });
    mlGeom.center();
    const mlMesh = new THREE.Mesh(mlGeom, dirtMat);
    mlMesh.position.set(courseX, gapBaseY + landH / 2, -15.0);
    mlMesh.rotation.y = -Math.PI / 2; // Slopes down going North
    mlMesh.castShadow = true;
    mlMesh.receiveShadow = true;
    group.add(mlMesh);

    registerObstacle({
      type: 'gap_kicker',
      x: courseX,
      z: -3.25,
      baseY: gapBaseY,
      width: kickerW,
      length: kickerLen,
      height: kickerH,
      dir: -1,
    });

    registerObstacle({
      type: 'gap_landing',
      x: courseX,
      z: -15.0,
      baseY: gapBaseY,
      width: landW,
      length: landLen,
      height: landH,
      dir: -1,
    });

    // 5. HIGH-BANKED TERRACOTTA BERM BOWL (z: -19.0 to -26.0)
    const bermBaseY = getTerrainElevation(courseX, -22.5);
    const bermRadius = 4.8;
    const bermH = 2.2;

    const bermGeo = new THREE.CylinderGeometry(bermRadius, bermRadius + 1.2, bermH, 24, 1, true, 0, Math.PI);
    bermGeo.rotateY(Math.PI / 2);
    const bermMesh = new THREE.Mesh(bermGeo, dirtMat);
    bermMesh.position.set(courseX, bermBaseY + bermH / 2, -22.5);
    bermMesh.castShadow = true;
    bermMesh.receiveShadow = true;
    group.add(bermMesh);

    registerObstacle({
      type: 'berm_bowl',
      x: courseX,
      z: -22.5,
      baseY: bermBaseY,
      radius: bermRadius,
      height: bermH,
    });

    scene.add(group);
  }

  // D. MEGA DROP ROLL-IN TOWER & CANYON LAUNCH KICKER
  function createMegaDropRamp(x, z) {
    const group = new THREE.Group();

    const towerTopY = 7.0;
    const kickerBottomY = 2.0;
    const kickerLipY = 4.8;
    const landingTopY = 3.6;
    const landingBottomY = 0.12;

    const scaffoldMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7, roughness: 0.35 });
    const runwayMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45, metalness: 0.15 });
    const kickerMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4, metalness: 0.2 });
    const landingMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.65 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 });
    const copingMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.88, roughness: 0.2 });

    // 1. High Tower Staging Platform (Flat 6m x 5m at Y = 7.0m, z: -76.5 to -71.5)
    const platformGeo = new THREE.BoxGeometry(6.0, 0.35, 5.0);
    const platformMesh = new THREE.Mesh(platformGeo, runwayMat);
    platformMesh.position.set(0, towerTopY - 0.175, -2.0);
    platformMesh.castShadow = true;
    platformMesh.receiveShadow = true;
    group.add(platformMesh);

    // Platform Safety Railings
    const railL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 5.0), railMat);
    railL.position.set(-2.95, towerTopY + 0.45, -2.0);
    group.add(railL);
    const railR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 5.0), railMat);
    railR.position.set(2.95, towerTopY + 0.45, -2.0);
    group.add(railR);
    const railBack = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.9, 0.1), railMat);
    railBack.position.set(0, towerTopY + 0.45, -4.45);
    group.add(railBack);

    // Scaffolding Support Pillars
    [-2.7, 2.7].forEach((px) => {
      [-4.2, -0.2].forEach((pz) => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, towerTopY, 8), scaffoldMat);
        pillar.position.set(px, towerTopY / 2, pz);
        pillar.castShadow = true;
        group.add(pillar);
      });
    });

    // 2. Downhill Roll-In Runway (Drops from 7.0m to 2.0m over 22m, z: -71.5 to -49.5)
    const runwayMesh = createWedgeMesh(4.8, 22.0, towerTopY, kickerBottomY, runwayMat);
    runwayMesh.position.set(0, 0, 0.5);
    group.add(runwayMesh);

    // Runway safety curbs along sides
    [-2.4, 2.4].forEach((cx) => {
      const curbGeo = new THREE.BoxGeometry(0.12, 0.3, 22.0);
      const curb = new THREE.Mesh(curbGeo, scaffoldMat);
      curb.position.set(cx, (towerTopY + kickerBottomY) / 2 + 0.15, 11.5);
      group.add(curb);
    });

    // 3. Mega Launch Kicker (Wedge from 2.0m up to 4.8m over 6m, z: -49.5 to -43.5)
    const kickerMesh = createWedgeMesh(4.8, 6.0, kickerBottomY, kickerLipY, kickerMat);
    kickerMesh.position.set(0, 0, 22.5);
    group.add(kickerMesh);

    // Electric Cyan Coping at Launch Lip
    const lipCoping = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.0, 12), copingMat);
    lipCoping.rotateZ(Math.PI / 2);
    lipCoping.position.set(0, kickerLipY + 0.04, 28.5);
    lipCoping.castShadow = true;
    group.add(lipCoping);

    // 4. Downhill Landing Transition (High-contrast concrete, z: -35.5 to -17.5, drops 3.6m to 0.4m)
    const landingMesh = createWedgeMesh(5.8, 18.0, landingTopY, landingBottomY, landingMat);
    landingMesh.position.set(0, 0, 36.5);
    group.add(landingMesh);

    // Yellow / Black Hazard Chevrons along Landing Sides
    const hazardMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
    [-2.95, 2.95].forEach((hx) => {
      const hCurb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.35, 18.0), hazardMat);
      hCurb.position.set(hx, (landingTopY + landingBottomY) / 2 + 0.18, 45.5);
      group.add(hCurb);
    });

    group.position.set(x, 0, z);
    scene.add(group);

    // --- Registered Obstacle Colliders ---
    // A. Stationary Platform (Zero downhill gravity)
    registerObstacle({
      type: 'megadrop_platform',
      x: x,
      z: z - 2.0,
      width: 6.2,
      length: 5.2,
      height: towerTopY,
    });

    // B. Roll-in Runway (Active downhill acceleration)
    registerObstacle({
      type: 'megadrop_runway',
      x: x,
      zStart: z + 0.5,
      zEnd: z + 22.5,
      width: 5.0,
      yStart: towerTopY,
      yEnd: kickerBottomY,
    });

    // C. Launch Kicker (Super Air boost at lip)
    registerObstacle({
      type: 'megadrop_kicker',
      x: x,
      zStart: z + 22.5,
      zEnd: z + 28.5,
      width: 5.0,
      yStart: kickerBottomY,
      yEnd: kickerLipY,
    });

    // D. Downhill Landing Transition (Catches falling rider cleanly)
    registerObstacle({
      type: 'megadrop_landing',
      x: x,
      zStart: z + 36.5,
      zEnd: z + 54.5,
      width: 6.0,
      yStart: landingTopY,
      yEnd: landingBottomY,
    });
  }

  // Generic Kicker Ramp with Precise Wedge Geometry & Lip Coping
  function createKickerRamp(x, z, width, length, height, rotation) {
    const baseY = getTerrainElevation(x, z);
    const rampGroup = new THREE.Group();
    const halfL = length / 2;

    // Wedge Shape in Z-Y: entrance at +Z (South), launch lip at -Z (North)
    const shape = new THREE.Shape();
    shape.moveTo(halfL, 0); // Ground entrance
    shape.quadraticCurveTo(0, height * 0.28, -halfL, height); // Smooth transition up to lip
    shape.lineTo(-halfL, 0); // Vertical back drop
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geom.center(); // Centered in X, Y, Z

    const woodMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.65, metalness: 0.1 });
    const rampMesh = new THREE.Mesh(geom, woodMat);
    rampMesh.position.set(0, height / 2, 0);
    rampMesh.rotation.y = Math.PI / 2; // Extrusion aligns width with local X
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    rampGroup.add(rampMesh);

    // High-visibility launch coping along the takeoff lip
    const lipGeo = new THREE.BoxGeometry(width, 0.05, 0.08);
    const lipMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.85, roughness: 0.2 });
    const lipMesh = new THREE.Mesh(lipGeo, lipMat);
    lipMesh.position.set(0, height + 0.02, -halfL);
    lipMesh.castShadow = true;
    rampGroup.add(lipMesh);

    rampGroup.position.set(x, baseY, z);
    rampGroup.rotation.y = rotation;
    scene.add(rampGroup);

    registerObstacle({
      type: 'kicker',
      x: x,
      z: z,
      baseY: baseY,
      width: width,
      length: length,
      height: height,
      rotation: rotation,
    });
  }

  // Wooden Boardwalk Platform
  function createBoardwalk(x, z, length, width) {
    const baseY = getTerrainElevation(x, z);
    const geo = new THREE.BoxGeometry(length, 0.28, width);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.75 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, baseY + 0.14, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    registerObstacle({
      type: 'boardwalk',
      x: x,
      z: z,
      width: length,
      length: width,
      height: baseY + 0.28,
    });
  }

  function registerObstacle(obs) {
    state.obstacles.push(obs);
  }

  // Clear sightline culling helper: excludes scenery from blocking jump lines, runways, and park
  function isExcludedSceneryZone(x, z) {
    // 1. Central Skatepark
    if (Math.abs(x) < 22 && Math.abs(z) < 22) return true;
    // 2. North Mega Drop line (runway, kicker, landing, roll-out, tower)
    if (Math.abs(x) < 14 && z <= -16 && z >= -90) return true;
    // 3. East Pine Ridge Timber Slopestyle course (x ~ 55, z from -28 to +48)
    if (Math.abs(x - 55) < 18 && z >= -28 && z <= 48) return true;
    // 4. West Slickrock Motocross Canyon course (x ~ -58, z from -28 to +48)
    if (Math.abs(x - (-58)) < 18 && z >= -28 && z <= 48) return true;
    // 5. South Desert Berms trail circuit
    if (isDesertBermTrail(x, z) > 0.05) return true;
    return false;
  }

  // Scenery (Populate on terrain elevation with sightline culling)
  function populateScenery() {
    // North (Mountain rocks)
    for (let i = 0; i < 24; i++) {
      const rx = (Math.random() - 0.5) * 80;
      const rz = -28 - Math.random() * 70;
      if (!isExcludedSceneryZone(rx, rz)) {
        createBoulder(rx, rz, 1.0 + Math.random() * 1.8, 0x475569);
      }
    }

    // South (Desert cacti and red hoodoo boulders)
    for (let i = 0; i < 26; i++) {
      const rx = (Math.random() - 0.5) * 80;
      const rz = 28 + Math.random() * 70;
      if (!isExcludedSceneryZone(rx, rz)) {
        if (Math.random() > 0.45) {
          createCactus(rx, rz, 1.4 + Math.random() * 1.0);
        } else {
          createBoulder(rx, rz, 1.2 + Math.random() * 1.8, 0x9a3412);
        }
      }
    }

    // East (Pine Ridge forest - Natural scale & zero jump obstruction)
    for (let i = 0; i < 36; i++) {
      const rx = 24 + Math.random() * 85;
      const rz = (Math.random() - 0.5) * 90;
      if (!isExcludedSceneryZone(rx, rz)) {
        createPineTree(rx, rz, 1.0 + Math.random() * 0.7);
      }
    }

    // West (Slickrock boulders)
    for (let i = 0; i < 24; i++) {
      const rx = -28 - Math.random() * 80;
      const rz = (Math.random() - 0.5) * 85;
      if (!isExcludedSceneryZone(rx, rz)) {
        createBoulder(rx, rz, 1.4 + Math.random() * 2.0, 0xc2410c);
      }
    }
  }

  function createPineTree(x, z, scale) {
    const baseY = getTerrainElevation(x, z);
    const tree = new THREE.Group();

    const trunkGeo = new THREE.CylinderGeometry(0.18 * scale, 0.25 * scale, 1.2 * scale, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = (1.2 * scale) / 2;
    trunk.castShadow = true;
    tree.add(trunk);

    const folMat = new THREE.MeshStandardMaterial({ color: 0x1e3a29, roughness: 0.8 });
    [1.0, 1.8, 2.5].forEach((yOff, idx) => {
      const coneR = (1.3 - idx * 0.3) * scale;
      const coneH = (1.4 - idx * 0.2) * scale;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 6), folMat);
      cone.position.y = yOff * scale;
      cone.castShadow = true;
      cone.receiveShadow = true;
      tree.add(cone);
    });

    tree.position.set(x, baseY, z);
    scene.add(tree);
  }

  function createCactus(x, z, scale) {
    const baseY = getTerrainElevation(x, z);
    const cactus = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.7 });

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.22 * scale, 2.4 * scale, 8), mat);
    stem.position.y = (2.4 * scale) / 2;
    stem.castShadow = true;
    cactus.add(stem);

    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.14 * scale, 0.8 * scale, 6), mat);
    armR.position.set(0.45 * scale, 1.2 * scale, 0);
    armR.rotation.z = Math.PI / 2;
    cactus.add(armR);

    const armRUp = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.14 * scale, 0.9 * scale, 6), mat);
    armRUp.position.set(0.85 * scale, 1.6 * scale, 0);
    cactus.add(armRUp);

    cactus.position.set(x, baseY, z);
    scene.add(cactus);
  }

  function createBoulder(x, z, scale, color) {
    const baseY = getTerrainElevation(x, z);
    const geo = new THREE.DodecahedronGeometry(scale, 1);
    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.9, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, baseY + scale * 0.55, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.scale.set(1.2, 0.8, 1.0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  function createTrailSign(title, badgeText, x, z, rotation, badgeColorHex) {
    const baseY = getTerrainElevation(x, z);
    const group = new THREE.Group();
    const postH = 2.4;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.9 });

    [-1.2, 1.2].forEach((offX) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, postH, 8), postMat);
      post.position.set(offX, postH / 2, 0);
      post.castShadow = true;
      group.add(post);
    });

    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512;
    signCanvas.height = 160;
    const sCtx = signCanvas.getContext('2d');
    sCtx.fillStyle = '#1e1610';
    sCtx.fillRect(0, 0, 512, 160);
    sCtx.lineWidth = 8;
    sCtx.strokeStyle = '#8d5b38';
    sCtx.strokeRect(4, 4, 504, 152);

    sCtx.fillStyle = '#' + badgeColorHex.toString(16).padStart(6, '0');
    sCtx.beginPath();
    sCtx.roundRect(140, 20, 232, 38, 8);
    sCtx.fill();

    sCtx.fillStyle = '#0f172a';
    sCtx.font = 'bold 22px system-ui, sans-serif';
    sCtx.textAlign = 'center';
    sCtx.fillText(badgeText, 256, 47);

    sCtx.fillStyle = '#f8fafc';
    sCtx.font = 'bold 36px system-ui, sans-serif';
    sCtx.fillText(title.toUpperCase(), 256, 118);

    const signTex = new THREE.CanvasTexture(signCanvas);
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.6),
      new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, side: THREE.DoubleSide })
    );
    signMesh.position.set(0, postH - 1.2, 0);
    signMesh.castShadow = true;
    group.add(signMesh);

    group.position.set(x, baseY, z);
    group.rotation.y = rotation;
    scene.add(group);
  }

  // ==========================================================================
  // 6. Loading Fungineers X7 Model (Horizontal Orientation & Lighting Fix)
  // ==========================================================================
  function loadX7BoardModel() {
    // 1. Procedural fallback immediately
    setupProceduralBoard();

    // 2. Load optimized CAD GLB
    if (typeof THREE.GLTFLoader === 'undefined') {
      console.warn('GLTFLoader not available, using procedural X7 board.');
      return;
    }

    const loader = new THREE.GLTFLoader();
    loader.load(
      'models/x7_board.glb',
      (gltf) => {
        console.log('Successfully loaded models/x7_board.glb!');
        const model = gltf.scene;

        // Clear procedural stand-in
        while (boardGroup.children.length > 0) {
          boardGroup.remove(boardGroup.children[0]);
        }

        // Re-add headlights (+Z forward) and taillights (-Z rear)
        setupBoardLights();

        // Traverse to apply authentic materials, fix face culling, and identify tire
        let foundTire = null;
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            const name = (child.name || '').toLowerCase();

            // Footpads (Stompie Front & Rear) -> Clean solid footpads with DoubleSide & smooth normals
            if (name.includes('stompie') || name.includes('pad')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xf1f5f9,
                roughness: 0.8,
                metalness: 0.05,
                side: THREE.DoubleSide,
              });
              if (child.geometry) {
                child.geometry.computeVertexNormals();
              }
            }
            // CNC Rails -> Anodized Metallic Red (authentic to user's Fungineers build)
            else if (name.includes('rail')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xef233c,
                roughness: 0.32,
                metalness: 0.78,
                side: THREE.DoubleSide,
              });
            }
            // Go-Kart Tire -> Vulcanized Black Tread
            else if (name.includes('tire')) {
              foundTire = child;
              child.material = new THREE.MeshStandardMaterial({
                color: 0x18181b,
                roughness: 0.88,
                metalness: 0.05,
                side: THREE.DoubleSide,
              });
            }
            // Bumpers -> Durable Dark Bumper Plastic
            else if (name.includes('bumper')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x0f172a,
                roughness: 0.85,
                metalness: 0.1,
                side: THREE.DoubleSide,
              });
            }
            // Superflux Motor Hub & Mounts -> Anodized Bronze
            else if (name.includes('superflux') || name.includes('mount')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x92400e,
                roughness: 0.3,
                metalness: 0.85,
                side: THREE.DoubleSide,
              });
            }
            // Battery & Controller Enclosures -> Matte Dark Slate CNC
            else if (name.includes('box') || name.includes('lid')) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x1e293b,
                roughness: 0.65,
                metalness: 0.3,
                side: THREE.DoubleSide,
              });
            } else {
              // Ensure all other meshes are DoubleSide to prevent z-fighting / missing faces
              if (child.material) {
                child.material.side = THREE.DoubleSide;
              }
            }
          }
        });

        // ROTATION FIX:
        // In the original CAD assembly, length is along Y (+Y Front, -Y Rear), height is X, and width is Z.
        // Euler (0, Math.PI / 2, Math.PI / 2) maps CAD +Y to Three.js +Z (Forward), +X to +Y (Up), and Z to X (Width).
        model.rotation.set(0, Math.PI / 2, Math.PI / 2);
        model.updateMatrixWorld(true);

        // Center model and elevate on tire radius
        const rootBbox = new THREE.Box3().setFromObject(model);
        const center = rootBbox.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.position.y += TIRE_RADIUS; // elevate by tire radius

        chassisMesh = model;
        boardGroup.add(chassisMesh);

        // Assign isolated wheel mesh for axle rolling
        wheelMesh = foundTire || null;
      },
      undefined,
      (err) => {
        console.warn('Could not load models/x7_board.glb (using procedural):', err);
      }
    );
  }

  // Procedural Onewheel (Horizontal Orientation)
  function setupProceduralBoard() {
    while (boardGroup.children.length > 0) {
      boardGroup.remove(boardGroup.children[0]);
    }

    // A. Central Go-Kart Tire (Axle along X)
    const tireGeo = new THREE.CylinderGeometry(TIRE_RADIUS, TIRE_RADIUS, 0.18, 24);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.88, metalness: 0.05, side: THREE.DoubleSide });
    wheelMesh = new THREE.Mesh(tireGeo, tireMat);
    wheelMesh.position.set(0, TIRE_RADIUS, 0);
    wheelMesh.castShadow = true;
    boardGroup.add(wheelMesh);

    // Motor Hub Anodized Bronze
    const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.185, 16);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x92400e, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
    const hubMesh = new THREE.Mesh(hubGeo, hubMat);
    wheelMesh.add(hubMesh);

    // B. CNC Rails (Anodized Metallic Red along Z length)
    const railMat = new THREE.MeshStandardMaterial({ color: 0xef233c, metalness: 0.78, roughness: 0.32, side: THREE.DoubleSide });
    const railGeo = new THREE.BoxGeometry(0.03, 0.045, 0.74);

    const railLeft = new THREE.Mesh(railGeo, railMat);
    railLeft.position.set(-0.115, TIRE_RADIUS, 0);
    railLeft.castShadow = true;
    boardGroup.add(railLeft);

    const railRight = new THREE.Mesh(railGeo, railMat);
    railRight.position.set(0.115, TIRE_RADIUS, 0);
    railRight.castShadow = true;
    boardGroup.add(railRight);

    // C. Footpads (+Z Front, -Z Rear)
    const padMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.8, side: THREE.DoubleSide });
    const padGeo = new THREE.BoxGeometry(0.23, 0.03, 0.24);

    // Front Pad (+Z)
    const padFront = new THREE.Mesh(padGeo, padMat);
    padFront.position.set(0, TIRE_RADIUS + 0.035, 0.22);
    padFront.castShadow = true;
    boardGroup.add(padFront);

    // Rear Pad (-Z)
    const padRear = new THREE.Mesh(padGeo, padMat);
    padRear.position.set(0, TIRE_RADIUS + 0.035, -0.22);
    padRear.castShadow = true;
    boardGroup.add(padRear);

    // D. Bumpers (+Z Front, -Z Rear)
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85, side: THREE.DoubleSide });
    const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.1), bumperMat);
    bumperFront.position.set(0, TIRE_RADIUS - 0.01, 0.34);
    boardGroup.add(bumperFront);

    const bumperRear = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.1), bumperMat);
    bumperRear.position.set(0, TIRE_RADIUS - 0.01, -0.34);
    boardGroup.add(bumperRear);

    setupBoardLights();
  }

  // Headlight & Taillight System (+Z White Front, -Z Red Rear)
  function setupBoardLights() {
    // 1. Front Headlight Beam (Bright White Spotlight shining forward along ground)
    headlightSpot = new THREE.SpotLight(0xecfeff, 2.6, 16, 0.55, 0.35, 1.4);
    headlightSpot.position.set(0, TIRE_RADIUS + 0.03, 0.34);
    const frontTargetObj = new THREE.Object3D();
    frontTargetObj.position.set(0, -0.15, 8); // Shines forward along +Z onto ground
    boardGroup.add(frontTargetObj);
    headlightSpot.target = frontTargetObj;
    boardGroup.add(headlightSpot);

    // Glowing LED Lens (Front - White)
    const frontLensGeo = new THREE.BoxGeometry(0.18, 0.02, 0.02);
    const frontLens = new THREE.Mesh(
      frontLensGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.1 })
    );
    frontLens.position.set(0, TIRE_RADIUS + 0.015, 0.345);
    boardGroup.add(frontLens);

    // 2. Rear Taillight Beam (Focused Red Spotlight shining backwards towards -Z rear along ground)
    taillightSpot = new THREE.SpotLight(0xff1414, 3.0, 14, 0.58, 0.45, 1.3);
    taillightSpot.position.set(0, TIRE_RADIUS + 0.03, -0.34);
    const rearTargetObj = new THREE.Object3D();
    rearTargetObj.position.set(0, -0.15, -8); // Shines backwards along -Z onto ground behind board
    boardGroup.add(rearTargetObj);
    taillightSpot.target = rearTargetObj;
    boardGroup.add(taillightSpot);

    // Glowing LED Lens (Rear - Red Light Bar on Bumper)
    const rearLensGeo = new THREE.BoxGeometry(0.18, 0.02, 0.02);
    taillightLens = new THREE.Mesh(
      rearLensGeo,
      new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff1616, emissiveIntensity: 1.8, roughness: 0.15 })
    );
    taillightLens.position.set(0, TIRE_RADIUS + 0.015, -0.345);
    boardGroup.add(taillightLens);

    // 3. Tactical Rider Ambient Lantern (Illuminates dark tunnels, underpasses & corridors around player)
    const riderFill = new THREE.PointLight(0xffedd5, 1.4, 20, 1.5);
    riderFill.position.set(0, 0.45, 0);
    boardGroup.add(riderFill);

    // Mount floating 3D weapon above tire
    if (typeof setupBoardWeapon === 'function') {
      setupBoardWeapon();
    }
  }

  // ==========================================================================
  // 7. Particles & Sparks
  // ==========================================================================
  function initParticlesAndFX() {
    particleGroup = new THREE.Group();
    scene.add(particleGroup);

    const pGeo = new THREE.SphereGeometry(0.06, 6, 6);
    for (let i = 0; i < 48; i++) {
      const pMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0 });
      const p = new THREE.Mesh(pGeo, pMat);
      p.visible = false;
      p.userData = { life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 };
      particleGroup.add(p);
      state.particles.push(p);
    }
  }

  function emitDustParticle(x, y, z, groundColorHex) {
    const p = state.particles.find((item) => !item.visible);
    if (!p) return;

    p.visible = true;
    p.position.set(x + (Math.random() - 0.5) * 0.1, y + 0.04, z + (Math.random() - 0.5) * 0.1);
    p.material.color.setHex(groundColorHex);
    p.material.opacity = 0.65;
    p.scale.setScalar(0.7 + Math.random() * 0.6);

    p.userData.life = 0;
    p.userData.maxLife = 0.35 + Math.random() * 0.25;
    p.userData.vx = (Math.random() - 0.5) * 0.8;
    p.userData.vy = 0.4 + Math.random() * 0.6;
    p.userData.vz = (Math.random() - 0.5) * 0.8;
  }

  function emitGrindSparks(x, y, z) {
    for (let i = 0; i < 3; i++) {
      const p = state.particles.find((item) => !item.visible);
      if (!p) continue;
      p.visible = true;
      p.position.set(x, y, z);
      p.material.color.setHex(0xfef08a);
      p.material.opacity = 1.0;
      p.scale.setScalar(0.4);

      p.userData.life = 0;
      p.userData.maxLife = 0.2;
      p.userData.vx = (Math.random() - 0.5) * 3.5;
      p.userData.vy = 1.2 + Math.random() * 2.0;
      p.userData.vz = (Math.random() - 0.5) * 3.5;
    }
  }

  function updateParticles(dt) {
    state.particles.forEach((p) => {
      if (!p.visible) return;
      p.userData.life += dt;
      if (p.userData.life >= p.userData.maxLife) {
        p.visible = false;
        return;
      }
      const progress = p.userData.life / p.userData.maxLife;
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.material.opacity = (1 - progress) * 0.7;
      p.scale.multiplyScalar(1 + dt * 0.8);
    });
  }

  // ==========================================================================
  // 8. Controls, Scroll-Lock & Stuck-Movement Prevention
  // ==========================================================================
  function initControls() {
    // 0. GLOBAL SCROLL & GESTURE LOCK
    // Prevents iPad / iPhone rubber-band bounce, document scroll, and accidental fullscreen exits
    document.addEventListener('touchmove', (e) => {
      // Allow horizontal scroll inside checkpoints bar if it overflows
      if (e.target.closest && e.target.closest('.exp9-checkpoints-bar')) {
        return;
      }
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
    // Prevent browser context menu on right click for tactical weapon scoping
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Keyboard Handler
    window.addEventListener('keydown', (e) => {
      // 1. SCROLL-LOCK: Prevent page scrolling on arrow keys and spacebar
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }

      // 2. BUY MENU & COMBAT SHORTCUTS
      if (e.code === 'KeyB') {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)) {
          toggleBuyMenu();
          return;
        }
      }
      if (e.code === 'KeyQ') {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)) {
          quickSwitchWeapon();
          return;
        }
      }
      if (e.code === 'Escape') {
        closeBuyMenu();
        return;
      }
      if (e.code === 'KeyJ') {
        fireCurrentWeapon();
        return;
      }

      // 3. CHECKPOINT HOTKEYS (Keys 1 - 5) OR BUY MENU CATEGORY SWITCHING
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        if (isBuyMenuOpen()) { renderBuyMenuGrid('pistols'); return; }
        if (!isTacticalMatchActive()) { teleportToCheckpoint(0); }
        return;
      }
      if (e.code === 'Digit2' || e.code === 'Numpad2') {
        if (isBuyMenuOpen()) { renderBuyMenuGrid('smgs'); return; }
        if (!isTacticalMatchActive()) { teleportToCheckpoint(1); }
        return;
      }
      if (e.code === 'Digit3' || e.code === 'Numpad3') {
        if (isBuyMenuOpen()) { renderBuyMenuGrid('rifles'); return; }
        if (!isTacticalMatchActive()) { teleportToCheckpoint(2); }
        return;
      }
      if (e.code === 'Digit4' || e.code === 'Numpad4') {
        if (isBuyMenuOpen()) { renderBuyMenuGrid('heavy'); return; }
        if (!isTacticalMatchActive()) { teleportToCheckpoint(3); }
        return;
      }
      if (e.code === 'Digit5' || e.code === 'Numpad5') {
        if (isBuyMenuOpen()) { renderBuyMenuGrid('gear'); return; }
        if (!isTacticalMatchActive()) { teleportToCheckpoint(4); }
        return;
      }

      // 4. ZOOM HOTKEYS
      if (e.code === 'BracketLeft' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
        adjustZoom(+2.5); // Zoom out
        return;
      }
      if (e.code === 'BracketRight' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        adjustZoom(-2.5); // Zoom in
        return;
      }

      // 5. MOVEMENT & TRICK / BALANCE INPUTS
      switch (e.code) {
        // Left Stick / Movement (WASD on desktop)
        case 'KeyW':
          state.input.up = true;
          break;
        case 'KeyS':
          state.input.down = true;
          break;
        case 'KeyA':
          state.input.left = true;
          break;
        case 'KeyD':
          state.input.right = true;
          break;
        case 'KeyE':
          state.input.plant = true;
          break;

        // Right Stick / Twist, Flip & Grind Balance (Arrow Keys on desktop)
        case 'ArrowUp':
          state.input.twistUp = true;
          if (state.grind.active) {
            // Tapping Up applies corrective torque impulse to push nose up / balance
            state.grind.balanceVel -= 2.6;
          }
          break;
        case 'ArrowDown':
          state.input.twistDown = true;
          if (state.grind.active) {
            // Tapping Down applies corrective torque impulse to push nose down / balance
            state.grind.balanceVel += 2.6;
          }
          break;
        case 'ArrowLeft':
          state.input.twistLeft = true;
          break;
        case 'ArrowRight':
          state.input.twistRight = true;
          break;

        case 'Space':
          if (!state.input.jump) state.input.jumpPressed = true;
          state.input.jump = true;
          break;
        case 'KeyR':
          if (combat.equippedPrimary && combat.equippedPrimary.ammoInMag < combat.equippedPrimary.magSize) {
            reloadCurrentWeapon();
          } else if (combat.equippedSecondary && combat.equippedSecondary.ammoInMag < combat.equippedSecondary.magSize) {
            reloadCurrentWeapon();
          } else {
            respawnPlayer();
          }
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
          state.input.up = false;
          break;
        case 'KeyS':
          state.input.down = false;
          break;
        case 'KeyA':
          state.input.left = false;
          break;
        case 'KeyD':
          state.input.right = false;
          break;
        case 'KeyE':
          state.input.plant = false;
          break;
        case 'ArrowUp':
          state.input.twistUp = false;
          break;
        case 'ArrowDown':
          state.input.twistDown = false;
          break;
        case 'ArrowLeft':
          state.input.twistLeft = false;
          break;
        case 'ArrowRight':
          state.input.twistRight = false;
          break;
        case 'Space':
          state.input.jump = false;
          break;
      }
    });

    // Reset input states on window blur/visibilitychange so keys never get stuck
    function resetInputs() {
      state.input.up = false;
      state.input.down = false;
      state.input.left = false;
      state.input.right = false;
      state.input.twistUp = false;
      state.input.twistDown = false;
      state.input.twistLeft = false;
      state.input.twistRight = false;
      state.input.jump = false;
      state.input.jumpPressed = false;
      state.input.joystickActive = false;
      state.input.rightJoystickActive = false;
      state.input.joystickVector.x = 0;
      state.input.joystickVector.y = 0;
      state.input.rightJoystickVector.x = 0;
      state.input.rightJoystickVector.y = 0;
    }

    window.addEventListener('blur', resetInputs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetInputs();
    });

    // Mouse Wheel Zoom (Desktop)
    if (container) {
      container.addEventListener('wheel', (e) => {
        e.preventDefault();
        adjustZoom(Math.sign(e.deltaY) * 0.8);
      }, { passive: false });

      // Desktop Mouse Look Camera Aiming (Pointer Lock) & Shooting Controls
      let isPointerLocked = false;

      function updatePointerLockState() {
        isPointerLocked = (document.pointerLockElement === container || (canvas && document.pointerLockElement === canvas));
        const crosshair = document.getElementById('tacticalCrosshair');
        if (crosshair) {
          crosshair.style.opacity = isPointerLocked ? '0.95' : '0.65';
        }
      }

      document.addEventListener('pointerlockchange', updatePointerLockState);
      document.addEventListener('mozpointerlockchange', updatePointerLockState);

      // Request Pointer Lock on clicking inside game canvas (outside interactive UI)
      window.addEventListener('mousedown', (e) => {
        if (e.button !== 0 && e.button !== 2) return; // Left or Right click

        const isInsideUI = e.target.closest && (
          e.target.closest('.exp9-buymenu-overlay') ||
          e.target.closest('.exp9-join-modal-overlay') ||
          e.target.closest('.exp9-controls-menu') ||
          e.target.closest('.exp9-controls-dropdown') ||
          e.target.closest('.exp9-chat-bar') ||
          e.target.closest('.exp9-hud-top-row') ||
          e.target.closest('.exp9-checkpoints-bar') ||
          e.target.closest('.exp9-joystick-zone') ||
          e.target.closest('.exp9-right-joystick-zone') ||
          e.target.closest('.exp9-ready-btn')
        );

        if (isInsideUI) return;

        updatePointerLockState();

        // Right Click: Tactical Optic Zoom / Scope
        if (e.button === 2) {
          e.preventDefault();
          toggleWeaponScope();
          return;
        }

        // Left Click: Fire weapon
        if (isPointerLocked) {
          combat.isFiring = true;
          fireCurrentWeapon();
        } else {
          // If buy menu is closed, engage mouse look
          if (!isBuyMenuOpen()) {
            try {
              if (container && container.requestPointerLock) {
                container.requestPointerLock();
              }
            } catch (err) {}
          }
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
          combat.isFiring = false;
        }
      });

      // Mouse Aiming / Camera Rotation with Pointer Lock (Sensitivity scales dynamically with optic FOV)
      window.addEventListener('mousemove', (e) => {
        updatePointerLockState();
        if (isPointerLocked) {
          const baseSens = 0.0018; // Slightly reduced for smoother feel
          const sensScale = (combat && combat.scopeLevel > 0 && camera && camera.fov) ? (camera.fov / 65) : 1.0;
          const mouseSens = baseSens * sensScale;
          state.camera.yaw -= (e.movementX || 0) * mouseSens;
          state.camera.pitch = THREE.MathUtils.clamp(
            state.camera.pitch + (e.movementY || 0) * mouseSens,
            -0.20,  // allow slight upward look
            1.30
          );
          state.camera.manualTimer = 999999; // Never auto-chase camera while mouse aiming!
        }
      });

      // Fallback touch / non-locked drag orbit
      let isMouseDraggingCam = false;
      let lastMouseX = 0;
      let lastMouseY = 0;

      container.addEventListener('pointerdown', (e) => {
        if (isPointerLocked) return;
        if (e.target.closest && (
            e.target.closest('.exp9-joystick-zone') || 
            e.target.closest('.exp9-right-joystick-zone') || 
            e.target.closest('.exp9-jump-btn-zone') ||
            e.target.closest('.exp9-controls-dropdown') ||
            e.target.closest('.exp9-hud-top-row') ||
            e.target.closest('.exp9-checkpoints-bar'))) {
          return;
        }
        isMouseDraggingCam = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
      });

      window.addEventListener('pointermove', (e) => {
        if (!isPointerLocked && isMouseDraggingCam) {
          const dx = e.clientX - lastMouseX;
          const dy = e.clientY - lastMouseY;
          lastMouseX = e.clientX;
          lastMouseY = e.clientY;

          state.camera.manualTimer = 999999; // Hold manual until user releases drag
          state.camera.yaw -= dx * 0.0040;
          state.camera.pitch = THREE.MathUtils.clamp(state.camera.pitch + dy * 0.0035, -0.20, 1.30);
        }
      });

      window.addEventListener('pointerup', () => {
        if (isMouseDraggingCam) {
          isMouseDraggingCam = false;
          // After releasing drag, allow auto-chase to resume after 2s
          state.camera.manualTimer = 2.0;
        }
      });

      window.addEventListener('pointercancel', () => { isMouseDraggingCam = false; });
    }

    // Touch Jump Button
    if (btnTouchJump) {
      btnTouchJump.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      btnTouchJump.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        state.input.jumpPressed = true;
        state.input.jump = true;
      });
      btnTouchJump.addEventListener('pointerup', () => {
        state.input.jump = false;
      });
      btnTouchJump.addEventListener('pointercancel', () => {
        state.input.jump = false;
      });
    }

    // Virtual Touch & Mouse Drag Joysticks (Left Drive + Right Camera Orbit & Balance)
    setupVirtualJoystick();
    setupRightVirtualJoystick();
  }

  function adjustZoom(delta) {
    state.camera.targetDistance = THREE.MathUtils.clamp(
      state.camera.targetDistance + delta,
      state.camera.minDistance,
      state.camera.maxDistance
    );
  }

  function setupVirtualJoystick() {
    if (!joystickZone || !joystickBase || !joystickThumb) return;

    let activePointerId = null;
    let baseRect = null;
    const maxRadius = 65; // Expanded travel area (140px base) for analog precision

    function handleStart(clientX, clientY, pointerId, target) {
      activePointerId = pointerId;
      state.input.joystickActive = true;
      joystickThumb.classList.add('active');
      baseRect = joystickBase.getBoundingClientRect();
      if (target && target.setPointerCapture && pointerId !== undefined) {
        try { target.setPointerCapture(pointerId); } catch (e) {}
      }
      handleMove(clientX, clientY);
    }

    function handleMove(clientX, clientY) {
      if (!state.input.joystickActive || !baseRect) return;
      const centerX = baseRect.left + baseRect.width / 2;
      const centerY = baseRect.top + baseRect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;

      // Smooth exponential power curve with a gentle deadzone
      const rawMag = Math.min(1.0, dist / maxRadius);
      const deadzone = 0.05;
      if (rawMag <= deadzone) {
        state.input.joystickVector.x = 0;
        state.input.joystickVector.y = 0;
      } else {
        const norm = (rawMag - deadzone) / (1 - deadzone);
        const smoothMag = Math.pow(norm, 1.8);
        const angle = Math.atan2(dy, dx);
        state.input.joystickVector.x = Math.cos(angle) * smoothMag;
        state.input.joystickVector.y = -Math.sin(angle) * smoothMag;
      }
    }

    function handleEnd(pointerId, target) {
      if (activePointerId !== null && pointerId !== undefined && pointerId !== activePointerId) return;
      activePointerId = null;
      state.input.joystickActive = false;
      state.input.joystickVector.x = 0;
      state.input.joystickVector.y = 0;
      joystickThumb.classList.remove('active');
      joystickThumb.style.transform = 'translate(0px, 0px)';
      if (target && target.releasePointerCapture && pointerId !== undefined) {
        try { target.releasePointerCapture(pointerId); } catch (e) {}
      }
    }

    // Prevent Safari/iPadOS gesture interference
    joystickZone.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    joystickZone.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    // Unified Pointer Events (mouse drag on desktop + multi-touch on mobile)
    joystickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleStart(e.clientX, e.clientY, e.pointerId, joystickZone);
    });

    window.addEventListener('pointermove', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        e.preventDefault();
        handleMove(e.clientX, e.clientY);
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        handleEnd(e.pointerId, joystickZone);
      }
    });

    window.addEventListener('pointercancel', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        handleEnd(e.pointerId, joystickZone);
      }
    });
  }

  function setupRightVirtualJoystick() {
    if (!rightJoystickZone || !rightJoystickBase || !rightJoystickThumb) return;

    let activePointerId = null;
    let baseRect = null;
    let pressStartTime = 0;
    let holdTimer = null;
    const maxRadius = 60; // Expanded travel area for balance & trick analog control

    function handleStart(clientX, clientY, pointerId, target) {
      activePointerId = pointerId;
      pressStartTime = performance.now();
      state.input.rightJoystickActive = true;
      rightJoystickThumb.classList.add('active');
      rightJoystickThumb.classList.remove('holding');

      // Visual indicator timer when held for over 1 second
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        if (state.input.rightJoystickActive) {
          rightJoystickThumb.classList.add('holding');
        }
      }, 1000);

      baseRect = rightJoystickBase.getBoundingClientRect();
      if (target && target.setPointerCapture && pointerId !== undefined) {
        try { target.setPointerCapture(pointerId); } catch (e) {}
      }
      handleMove(clientX, clientY);
    }

    function handleMove(clientX, clientY) {
      if (!state.input.rightJoystickActive || !baseRect) return;
      const centerX = baseRect.left + baseRect.width / 2;
      const centerY = baseRect.top + baseRect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      rightJoystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;

      const rawMag = Math.min(1.0, dist / maxRadius);
      const deadzone = 0.05;
      if (rawMag <= deadzone) {
        state.input.rightJoystickVector.x = 0;
        state.input.rightJoystickVector.y = 0;
      } else {
        const norm = (rawMag - deadzone) / (1 - deadzone);
        const smoothMag = Math.pow(norm, 1.5);
        const angle = Math.atan2(dy, dx);
        state.input.rightJoystickVector.x = Math.cos(angle) * smoothMag;
        state.input.rightJoystickVector.y = -Math.sin(angle) * smoothMag;
      }
    }

    function handleEnd(pointerId, target, isCancelled = false) {
      if (activePointerId !== null && pointerId !== undefined && pointerId !== activePointerId) return;
      activePointerId = null;

      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }

      const pressDuration = performance.now() - pressStartTime;

      state.input.rightJoystickActive = false;
      state.input.rightJoystickVector.x = 0;
      state.input.rightJoystickVector.y = 0;
      rightJoystickThumb.classList.remove('active');
      rightJoystickThumb.classList.remove('holding');
      rightJoystickThumb.style.transform = 'translate(0px, 0px)';
      if (target && target.releasePointerCapture && pointerId !== undefined) {
        try { target.releasePointerCapture(pointerId); } catch (e) {}
      }

      // Tapping and releasing within 1 sec triggers jump (no stick movement required)
      // Holding for over 1 sec (> 1000ms) does NOT trigger jump on release
      if (!isCancelled && pressDuration < 1000) {
        state.input.jumpPressed = true;
        state.input.jump = true;
        setTimeout(() => {
          state.input.jump = false;
        }, 80);
      }
    }

    // Prevent Safari/iPadOS gesture interference
    rightJoystickZone.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    rightJoystickZone.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    rightJoystickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleStart(e.clientX, e.clientY, e.pointerId, rightJoystickZone);
    });

    window.addEventListener('pointermove', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        e.preventDefault();
        handleMove(e.clientX, e.clientY);
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        handleEnd(e.pointerId, rightJoystickZone, false);
      }
    });

    window.addEventListener('pointercancel', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        handleEnd(e.pointerId, rightJoystickZone, true);
      }
    });
  }

  // ==========================================================================
  // 9. Checkpoint Teleportation System & Multi-Map Manager
  // ==========================================================================
  function teleportToCheckpoint(index) {
    if (index < 0 || index >= CHECKPOINTS.length) return;
    const cp = CHECKPOINTS[index];
    state.activeCheckpoint = index;

    let spawnY = 0.2;
    if (currentMapId === 'dust2') {
      const groundH = getDust2SurfaceElevation(cp.x, cp.z, 20.0);
      spawnY = (groundH !== null && groundH !== undefined && !isNaN(groundH) && groundH > -10)
        ? groundH + 0.18
        : (cp.spawnYOffset || 0.2);
    } else {
      const baseElevation = getTerrainElevation(cp.x, cp.z);
      spawnY = index === 1 ? cp.spawnYOffset : baseElevation + cp.spawnYOffset;
    }

    state.player.x = cp.x;
    state.player.y = spawnY;
    state.player.groundY = spawnY;
    state.player.z = cp.z;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.vz = 0;
    state.player.speed = 0;
    state.player.heading = cp.heading;
    state.player.pitch = 0;
    state.player.roll = 0;
    state.player.isAirborne = false;
    state.player.airtime = 0;
    state.player.isGrinding = false;
    state.grind.active = false;
    if (balanceHud) balanceHud.classList.remove('active');
    state.player.inTabletop = false;
    state.player.inGap = false;
    state.player.inMegaDrop = false;
    if (typeof setScopeLevel === 'function') setScopeLevel(0);

    // Instant camera target snap behind rider
    state.camera.yaw = cp.heading + Math.PI;
    state.camera.pitch = 0.25;
    state.camera.manualTimer = 0;
    const snapHDist = state.camera.distance * Math.cos(state.camera.pitch);
    camera.position.x = cp.x + snapHDist * Math.sin(state.camera.yaw);
    camera.position.y = spawnY + 0.85 + state.camera.distance * Math.sin(state.camera.pitch);
    camera.position.z = cp.z + snapHDist * Math.cos(state.camera.yaw);
    camera.lookAt(cp.x, spawnY + 0.85, cp.z);

    // Update active UI button
    updateCheckpointButtonsUI(index);
    showTrickToast(`WARPED: ${cp.name.toUpperCase()}`);
  }

  function updateCheckpointButtonsUI(activeIndex) {
    cpButtons.forEach((btn, idx) => {
      if (idx === activeIndex) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function updateCheckpointsUI() {
    const bar = document.getElementById('checkpointsBar');
    if (!bar) return;
    bar.innerHTML = '';
    cpButtons = [];

    CHECKPOINTS.forEach((cp, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exp9-cp-btn' + (idx === state.activeCheckpoint ? ' active' : '');
      btn.setAttribute('data-cp', String(idx));
      btn.title = `${cp.name} (${cp.desc || ''}) (Key: ${idx + 1})`;

      const numSpan = document.createElement('span');
      numSpan.className = 'exp9-cp-num';
      numSpan.textContent = String(idx + 1);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'exp9-cp-label';
      labelSpan.textContent = cp.name;

      btn.appendChild(numSpan);
      btn.appendChild(labelSpan);

      btn.addEventListener('click', () => {
        teleportToCheckpoint(idx);
      });

      bar.appendChild(btn);
      cpButtons.push(btn);
    });
  }

  function respawnPlayer() {
    teleportToCheckpoint(0);
  }

  // --- Dust 2 3D Model Loader, Elevation Raycaster & Wall Collision ---
  const dust2Ray = new THREE.Raycaster();
  const dust2DownDir = new THREE.Vector3(0, -1, 0);
  const dust2RayOrigin = new THREE.Vector3();

  const _dust2WallRay = new THREE.Raycaster();
  const _dust2WallRayOrigin = new THREE.Vector3();
  const _dust2WallRayDir = new THREE.Vector3();
  const _dust2NormalMat = new THREE.Matrix3();
  const _dust2WorldNormal = new THREE.Vector3();

  function getHitWorldNormal(hit) {
    if (!hit || !hit.object) return null;
    if (hit.face && hit.face.normal) {
      _dust2NormalMat.getNormalMatrix(hit.object.matrixWorld);
      _dust2WorldNormal.copy(hit.face.normal).applyMatrix3(_dust2NormalMat).normalize();
      return _dust2WorldNormal;
    }
    return null;
  }

  function checkDust2Wall(posX, posY, posZ, dirX, dirZ, testDist) {
    if (!dust2WalkMeshes || dust2WalkMeshes.length === 0) return null;
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.0001) return null;

    const uDirX = dirX / len;
    const uDirZ = dirZ / len;

    // Continuous solid wall blocker across the Mid Doors window recess openings (x = -3.30).
    // Prevents riders from driving or clipping into the decorative wall alcoves on either side of Mid Doors.
    const isMidNicheZ = (posZ >= 7.8 && posZ <= 9.8) || (posZ >= 15.5 && posZ <= 17.5);
    if (isMidNicheZ && uDirX < 0 && posX >= -3.30 - 0.05) {
      const distToNicheWall = (posX - (-3.30)) / Math.abs(uDirX);
      if (distToNicheWall >= 0 && distToNicheWall <= testDist) {
        return {
          distance: distToNicheWall,
          normalX: 1.0,
          normalY: 0,
          normalZ: 0,
          point: new THREE.Vector3(-3.30, posY + 0.22, posZ)
        };
      }
    }

    _dust2WallRayOrigin.set(posX, posY + 0.22, posZ);
    _dust2WallRayDir.set(uDirX, 0, uDirZ);
    _dust2WallRay.set(_dust2WallRayOrigin, _dust2WallRayDir);
    _dust2WallRay.far = testDist;

    const hits = _dust2WallRay.intersectObjects(dust2WalkMeshes, false);
    if (hits && hits.length > 0) {
      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const norm = getHitWorldNormal(hit);
        if (norm && Math.abs(norm.y) < 0.65) {
          // If normal faces with ray (backface of double-sided mesh), invert it
          let nx = norm.x;
          let ny = norm.y;
          let nz = norm.z;
          const rayDotNorm = uDirX * nx + uDirZ * nz;
          if (rayDotNorm > 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          return {
            distance: hit.distance,
            normalX: nx,
            normalY: ny,
            normalZ: nz,
            point: hit.point
          };
        }
      }
    }
    return null;
  }

  function loadDust2Map(onReady) {
    if (dust2Model) {
      if (onReady) onReady();
      return;
    }
    if (isDust2Loading) return;
    isDust2Loading = true;

    if (typeof THREE.GLTFLoader === 'undefined') {
      console.warn('[Dust 2] THREE.GLTFLoader not available!');
      isDust2Loading = false;
      return;
    }

    const loader = new THREE.GLTFLoader();
    loader.load(
      'models/dust2.glb',
      (gltf) => {
        isDust2Loading = false;
        dust2Model = gltf.scene;

        // Model is already exported in meters at scale 1.0
        dust2Model.scale.set(1.0, 1.0, 1.0);
        // Center Dust 2 Mid Doors around the world origin
        dust2Model.position.set(5.5, 0, 19.25);
        dust2Model.updateMatrixWorld(true);

        dust2WalkMeshes = [];
        dust2Model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              child.material.side = THREE.DoubleSide;
              child.material.roughness = 0.82;
            }
            dust2WalkMeshes.push(child);
          }
        });

        dust2Group.add(dust2Model);
        initBombSiteBeacons();
        console.log(`[Dust 2] Map loaded successfully with ${dust2WalkMeshes.length} meshes!`);
        if (onReady) onReady();
      },
      undefined,
      (err) => {
        isDust2Loading = false;
        console.error('[Dust 2] Failed to load models/dust2.glb:', err);
      }
    );
  }

  function setEnvironmentLighting(mapId) {
    if (!renderer || !scene) return;
    if (mapId === 'dust2') {
      // Warm Moroccan / Desert Sun with strong global ambient fill for tunnels
      scene.background.setHex(0xdfcfb2);
      if (scene.fog) {
        scene.fog.color.setHex(0xdfcfb2);
        scene.fog.density = 0.0020;
      }
      if (ambientLight) {
        ambientLight.color.setHex(0xfff7ed);
        ambientLight.intensity = 1.05; // Bright global ambient so tunnels, alcoves & interiors stay clearly illuminated
      }
      if (hemiLight) {
        hemiLight.color.setHex(0xffedd5);
        hemiLight.groundColor.setHex(0xb45309); // Warm desert terracotta floor bounce
        hemiLight.intensity = 0.75;
      }
      if (sunLight) {
        sunLight.color.setHex(0xfffae6);
        sunLight.intensity = 1.30;
        sunLight.position.set(45, 80, 45);
      }
    } else {
      // Classic Skatepark Twilight Slate
      scene.background.setHex(0x0a0f1d);
      if (scene.fog) {
        scene.fog.color.setHex(0x0a0f1d);
        scene.fog.density = 0.0075;
      }
      if (ambientLight) {
        ambientLight.color.setHex(0xdbeafe);
        ambientLight.intensity = 0.65;
      }
      if (hemiLight) {
        hemiLight.color.setHex(0xecfeff);
        hemiLight.groundColor.setHex(0x1e293b);
        hemiLight.intensity = 0.55;
      }
      if (sunLight) {
        sunLight.color.setHex(0xfffbeb);
        sunLight.intensity = 1.35;
        sunLight.position.set(50, 75, 40);
      }
    }
  }

  const BOMB_SITES = {
    A: { name: 'A Bomb Site', x: 20.0, z: -25.0, y: 1.83, radius: 5.5 },
    B: { name: 'B Bomb Site', x: -25.0, z: -15.0, y: 0.18, radius: 5.5 }
  };

  let c4Mesh = null;
  let c4BlinkLight = null;
  const tracerLines = [];
  const _shootRay = new THREE.Raycaster();
  const _shootOrigin = new THREE.Vector3();
  const _shootDir = new THREE.Vector3();

  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playGunshotSound(type) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.18);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = (type === 'silenced') ? 'lowpass' : 'bandpass';
      const startFreq = (type === 'sniper') ? 950 : (type === 'heavy_pistol' ? 1400 : (type === 'silenced' ? 600 : 2000));
      filter.frequency.setValueAtTime(startFreq, t);
      filter.frequency.exponentialRampToValueAtTime(80, t + 0.15);

      const gain = ctx.createGain();
      const vol = (type === 'sniper') ? 1.0 : (type === 'silenced' ? 0.35 : 0.7);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (type === 'sniper' ? 0.22 : 0.12));

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      whiteNoise.start(t);
    } catch (err) {
      console.warn('Audio play error:', err);
    }
  }

  function playBombBeepSound(frequency = 1000) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, t);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (err) {}
  }

  function playExplosionSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;

      // Sub bass thump
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(20, t + 1.2);
      oscGain.gain.setValueAtTime(1.0, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.5);

      // Low rumble noise
      const bufferSize = Math.floor(ctx.sampleRate * 1.5);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(550, t);
      filter.frequency.exponentialRampToValueAtTime(40, t + 1.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.9, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      whiteNoise.start(t);
    } catch (err) {}
  }

  function playCashSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.setValueAtTime(freq, t + i * 0.07);
        gain.gain.setValueAtTime(0.3, t + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.07);
        osc.stop(t + i * 0.07 + 0.35);
      });
    } catch (err) {}
  }

  // ==========================================================================
  // 3D Floating Weapon Models & Procedural Geometry
  // ==========================================================================
  function createPistolModel() {
    const group = new THREE.Group();
    group.name = 'gun_pistol';

    // Slide (gunmetal)
    const slideGeo = new THREE.BoxGeometry(0.04, 0.045, 0.20);
    const slideMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.8 });
    const slide = new THREE.Mesh(slideGeo, slideMat);
    slide.position.set(0, 0.02, 0.02);
    slide.castShadow = true;
    group.add(slide);

    // Barrel tip
    const barrelGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.2 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, 0.13);
    barrel.castShadow = true;
    group.add(barrel);

    // Grip (angled back)
    const gripGeo = new THREE.BoxGeometry(0.035, 0.10, 0.05);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.rotation.x = -0.28;
    grip.position.set(0, -0.04, -0.04);
    grip.castShadow = true;
    group.add(grip);

    // Trigger guard
    const tgGeo = new THREE.BoxGeometry(0.02, 0.03, 0.04);
    const tg = new THREE.Mesh(tgGeo, gripMat);
    tg.position.set(0, -0.015, 0.01);
    group.add(tg);

    return group;
  }

  function createSMGModel() {
    const group = new THREE.Group();
    group.name = 'gun_smg';

    // Body / receiver
    const bodyGeo = new THREE.BoxGeometry(0.048, 0.07, 0.32);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.02, 0);
    body.castShadow = true;
    group.add(body);

    // Short tactical barrel & muzzle
    const barrelGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.09, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.3 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, 0.18);
    barrel.castShadow = true;
    group.add(barrel);

    // Grip
    const gripGeo = new THREE.BoxGeometry(0.038, 0.11, 0.05);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.rotation.x = -0.25;
    grip.position.set(0, -0.05, -0.06);
    grip.castShadow = true;
    group.add(grip);

    // Curved extended magazine
    const magGeo = new THREE.BoxGeometry(0.032, 0.16, 0.045);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.rotation.x = 0.22;
    mag.position.set(0, -0.07, 0.05);
    mag.castShadow = true;
    group.add(mag);

    // Front vertical foregrip
    const fgGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10);
    const fg = new THREE.Mesh(fgGeo, gripMat);
    fg.position.set(0, -0.03, 0.11);
    group.add(fg);

    // Top rail / compact sight
    const railGeo = new THREE.BoxGeometry(0.028, 0.025, 0.07);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.8, roughness: 0.2 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0, 0.068, 0.01);
    group.add(rail);

    return group;
  }

  function createRifleModel(isScoped = false) {
    const group = new THREE.Group();
    group.name = 'gun_rifle';

    // Receiver
    const recGeo = new THREE.BoxGeometry(0.046, 0.075, 0.35);
    const recMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.35 });
    const rec = new THREE.Mesh(recGeo, recMat);
    rec.position.set(0, 0.02, -0.02);
    rec.castShadow = true;
    group.add(rec);

    // Handguard (Tactical polymer or wood)
    const hgGeo = new THREE.BoxGeometry(0.042, 0.055, 0.18);
    const hgMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
    const hg = new THREE.Mesh(hgGeo, hgMat);
    hg.position.set(0, 0.02, 0.18);
    hg.castShadow = true;
    group.add(hg);

    // Long barrel
    const barrelGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.24, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.2 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, 0.36);
    barrel.castShadow = true;
    group.add(barrel);

    // Muzzle brake
    const mbGeo = new THREE.CylinderGeometry(0.017, 0.017, 0.04, 10);
    mbGeo.rotateX(Math.PI / 2);
    const mb = new THREE.Mesh(mbGeo, barrelMat);
    mb.position.set(0, 0.02, 0.48);
    group.add(mb);

    // Curved banana magazine
    const magGeo = new THREE.BoxGeometry(0.034, 0.18, 0.06);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.3 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.rotation.x = 0.26;
    mag.position.set(0, -0.08, 0.04);
    mag.castShadow = true;
    group.add(mag);

    // Grip
    const gripGeo = new THREE.BoxGeometry(0.036, 0.11, 0.05);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.rotation.x = -0.28;
    grip.position.set(0, -0.05, -0.11);
    grip.castShadow = true;
    group.add(grip);

    // Stock
    const stockGeo = new THREE.BoxGeometry(0.038, 0.09, 0.22);
    const stock = new THREE.Mesh(stockGeo, gripMat);
    stock.position.set(0, 0.005, -0.28);
    stock.castShadow = true;
    group.add(stock);

    if (isScoped) {
      // Tactical ACOG / Reflex optic on top
      const scopeTube = new THREE.CylinderGeometry(0.02, 0.023, 0.11, 12);
      scopeTube.rotateX(Math.PI / 2);
      const scopeMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.85, roughness: 0.2 });
      const optic = new THREE.Mesh(scopeTube, scopeMat);
      optic.position.set(0, 0.08, 0.02);
      optic.castShadow = true;
      group.add(optic);
    } else {
      // Front sight post
      const sightGeo = new THREE.BoxGeometry(0.012, 0.035, 0.02);
      const sight = new THREE.Mesh(sightGeo, barrelMat);
      sight.position.set(0, 0.05, 0.44);
      group.add(sight);
    }

    return group;
  }

  function createAWPModel() {
    const group = new THREE.Group();
    group.name = 'gun_awp';

    // Iconic Arctic Warfare green chassis
    const chassisGeo = new THREE.BoxGeometry(0.052, 0.085, 0.48);
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x3f5135, roughness: 0.65, metalness: 0.2 });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.set(0, 0.02, 0.02);
    chassis.castShadow = true;
    group.add(chassis);

    // Thumbhole sniper stock with black cheek riser & recoil pad
    const stockGeo = new THREE.BoxGeometry(0.045, 0.11, 0.28);
    const stock = new THREE.Mesh(stockGeo, chassisMat);
    stock.position.set(0, 0.005, -0.32);
    stock.castShadow = true;
    group.add(stock);

    // Black recoil pad at butt
    const padGeo = new THREE.BoxGeometry(0.048, 0.12, 0.035);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95 });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(0, 0.005, -0.46);
    group.add(pad);

    // Long fluted sniper bull barrel
    const barrelGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.45, 14);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.2 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.03, 0.46);
    barrel.castShadow = true;
    group.add(barrel);

    // Magnum rectangular muzzle brake
    const brakeGeo = new THREE.BoxGeometry(0.036, 0.034, 0.07);
    const brake = new THREE.Mesh(brakeGeo, barrelMat);
    brake.position.set(0, 0.03, 0.70);
    group.add(brake);

    // High-Power Sniper Scope
    const scopeGroup = new THREE.Group();
    const tubeGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.24, 14);
    tubeGeo.rotateX(Math.PI / 2);
    const scopeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 });
    const tube = new THREE.Mesh(tubeGeo, scopeMat);
    tube.castShadow = true;
    scopeGroup.add(tube);

    const objGeo = new THREE.CylinderGeometry(0.028, 0.020, 0.06, 14);
    objGeo.rotateX(Math.PI / 2);
    const objBell = new THREE.Mesh(objGeo, scopeMat);
    objBell.position.set(0, 0, 0.12);
    scopeGroup.add(objBell);

    const ocuGeo = new THREE.CylinderGeometry(0.020, 0.024, 0.05, 14);
    ocuGeo.rotateX(Math.PI / 2);
    const ocuBell = new THREE.Mesh(ocuGeo, scopeMat);
    ocuBell.position.set(0, 0, -0.12);
    scopeGroup.add(ocuBell);

    const turretGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.015, 10);
    const turretTop = new THREE.Mesh(turretGeo, barrelMat);
    turretTop.position.set(0, 0.022, 0);
    scopeGroup.add(turretTop);

    const ringGeo = new THREE.BoxGeometry(0.04, 0.03, 0.025);
    const ringF = new THREE.Mesh(ringGeo, barrelMat);
    ringF.position.set(0, -0.018, 0.06);
    scopeGroup.add(ringF);
    const ringR = new THREE.Mesh(ringGeo, barrelMat);
    ringR.position.set(0, -0.018, -0.06);
    scopeGroup.add(ringR);

    scopeGroup.position.set(0, 0.095, 0.02);
    group.add(scopeGroup);

    // Folded bipod under forend
    const bipodGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8);
    bipodGeo.rotateX(Math.PI / 2);
    const bipodL = new THREE.Mesh(bipodGeo, barrelMat);
    bipodL.position.set(-0.025, -0.025, 0.26);
    group.add(bipodL);
    const bipodR = new THREE.Mesh(bipodGeo, barrelMat);
    bipodR.position.set(0, 0.025, -0.025, 0.26);
    group.add(bipodR);

    // Box magazine
    const magGeo = new THREE.BoxGeometry(0.038, 0.09, 0.08);
    const mag = new THREE.Mesh(magGeo, padMat);
    mag.position.set(0, -0.04, 0.04);
    mag.castShadow = true;
    group.add(mag);

    return group;
  }

  function setupBoardWeapon() {
    if (!boardGroup) return;
    if (boardWeaponGroup && boardGroup.children.includes(boardWeaponGroup)) {
      boardGroup.remove(boardWeaponGroup);
    }
    boardWeaponGroup = new THREE.Group();
    boardWeaponGroup.name = 'boardWeaponMount';
    boardWeaponGroup.position.set(0, 0.38, 0);
    boardGroup.add(boardWeaponGroup);
    updateEquippedWeaponModel();
  }

  function updateEquippedWeaponModel() {
    if (!boardWeaponGroup) return;
    while (boardWeaponGroup.children.length > 0) {
      boardWeaponGroup.remove(boardWeaponGroup.children[0]);
    }
    const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
    if (!wep) return;

    const cat = (wep.category || '').toLowerCase();
    const id = (wep.id || '').toLowerCase();

    let model = null;
    if (id === 'awp' || id === 'scout') {
      model = createAWPModel();
    } else if (cat.includes('rifle') || id === 'aug' || id === 'sg553' || id === 'negev') {
      const isScoped = !!wep.hasScope || id === 'aug' || id === 'sg553';
      model = createRifleModel(isScoped);
    } else if (cat.includes('smg') || cat.includes('shotgun') || cat.includes('heavy')) {
      model = createSMGModel();
    } else {
      model = createPistolModel();
    }

    if (model) {
      boardWeaponGroup.add(model);
    }
  }

  // ==========================================================================
  // Tactical Optic Reticles & Scope Zoom Controls
  // ==========================================================================
  function playScopeSound(isZoomIn = true) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isZoomIn ? 640 : 420, t);
      osc.frequency.exponentialRampToValueAtTime(isZoomIn ? 980 : 260, t + 0.05);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.065);
    } catch (err) {}
  }

  function getOpticSVG(opticType, scopeLevel) {
    const isAWP = opticType === 'awp';
    const isScout = opticType === 'scout';
    const isAUG = opticType === 'aug';
    const isSG553 = opticType === 'sg553';

    if (isAWP) {
      const magText = scopeLevel === 2 ? '8.0X HIGH' : '2.5X WIDE';
      return `
        <svg class="exp9-scope-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <mask id="awpScopeMask">
              <rect width="1000" height="1000" fill="white" />
              <circle cx="500" cy="500" r="390" fill="black" />
            </mask>
            <filter id="redGlow">
              <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ef4444" />
            </filter>
          </defs>
          <rect width="1000" height="1000" fill="#000" mask="url(#awpScopeMask)" />
          <circle cx="500" cy="500" r="390" fill="rgba(15, 23, 42, 0.12)" stroke="#090d16" stroke-width="12" />
          <circle cx="500" cy="500" r="382" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="2" />
          <line x1="110" y1="500" x2="890" y2="500" stroke="#000" stroke-width="1.8" />
          <line x1="500" y1="110" x2="500" y2="890" stroke="#000" stroke-width="1.8" />
          ${[-240, -180, -120, -60, 60, 120, 180, 240].map(d => `
            <circle cx="${500 + d}" cy="500" r="2" fill="#000" />
            <circle cx="500" cy="${500 + d}" r="2" fill="#000" />
            <line x1="${500 + d}" y1="494" x2="${500 + d}" y2="506" stroke="#000" stroke-width="1" />
            <line x1="494" y1="${500 + d}" x2="506" y2="${500 + d}" stroke="#000" stroke-width="1" />
          `).join('')}
          <circle cx="500" cy="500" r="3.5" fill="#ef4444" filter="url(#redGlow)" />
        </svg>
        <div class="exp9-scope-badge">
          <span class="exp9-scope-optic">AWP MAGNUM</span>
          <span class="exp9-scope-mag">${magText} ZOOM</span>
        </div>
      `;
    }

    if (isScout) {
      return `
        <svg class="exp9-scope-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <mask id="scoutScopeMask">
              <rect width="1000" height="1000" fill="white" />
              <circle cx="500" cy="500" r="420" fill="black" />
            </mask>
          </defs>
          <rect width="1000" height="1000" fill="#000" mask="url(#scoutScopeMask)" />
          <circle cx="500" cy="500" r="420" fill="rgba(15, 23, 42, 0.08)" stroke="#090d16" stroke-width="10" />
          <line x1="80" y1="500" x2="360" y2="500" stroke="#000" stroke-width="6" />
          <line x1="640" y1="500" x2="920" y2="500" stroke="#000" stroke-width="6" />
          <line x1="500" y1="640" x2="500" y2="920" stroke="#000" stroke-width="6" />
          <line x1="360" y1="500" x2="640" y2="500" stroke="#000" stroke-width="1.5" />
          <line x1="500" y1="120" x2="500" y2="640" stroke="#000" stroke-width="1.5" />
          <path d="M 485 530 L 500 520 L 515 530" fill="none" stroke="#000" stroke-width="1.5" />
          <path d="M 490 560 L 500 550 L 510 560" fill="none" stroke="#000" stroke-width="1.5" />
          <path d="M 493 590 L 500 582 L 507 590" fill="none" stroke="#000" stroke-width="1.5" />
          <circle cx="500" cy="500" r="2.5" fill="#38bdf8" />
        </svg>
        <div class="exp9-scope-badge">
          <span class="exp9-scope-optic">SSG 08 RECON</span>
          <span class="exp9-scope-mag">3.0X OPTIC</span>
        </div>
      `;
    }

    if (isAUG) {
      return `
        <svg class="exp9-scope-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="greenGlow">
              <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#22c55e" />
            </filter>
          </defs>
          <circle cx="500" cy="500" r="370" fill="rgba(6, 78, 59, 0.08)" stroke="#0f172a" stroke-width="32" />
          <circle cx="500" cy="500" r="352" fill="none" stroke="rgba(34, 197, 94, 0.3)" stroke-width="3" />
          <circle cx="500" cy="500" r="38" fill="none" stroke="#22c55e" stroke-width="3.5" filter="url(#greenGlow)" />
          <circle cx="500" cy="500" r="5" fill="#4ade80" filter="url(#greenGlow)" />
          <line x1="380" y1="500" x2="450" y2="500" stroke="#22c55e" stroke-width="2.5" filter="url(#greenGlow)" />
          <line x1="550" y1="500" x2="620" y2="500" stroke="#22c55e" stroke-width="2.5" filter="url(#greenGlow)" />
          <line x1="500" y1="545" x2="500" y2="640" stroke="#22c55e" stroke-width="2" filter="url(#greenGlow)" />
          <line x1="490" y1="575" x2="510" y2="575" stroke="#22c55e" stroke-width="2" filter="url(#greenGlow)" />
          <line x1="493" y1="605" x2="507" y2="605" stroke="#22c55e" stroke-width="2" filter="url(#greenGlow)" />
        </svg>
        <div class="exp9-scope-badge">
          <span class="exp9-scope-optic" style="color: #4ade80;">AUG ACOG</span>
          <span class="exp9-scope-mag">1.6X REFLEX</span>
        </div>
      `;
    }

    if (isSG553) {
      return `
        <svg class="exp9-scope-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="crimsonGlow">
              <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ef4444" />
            </filter>
          </defs>
          <rect x="160" y="160" width="680" height="680" rx="90" fill="rgba(239, 68, 68, 0.05)" stroke="#0f172a" stroke-width="36" />
          <rect x="180" y="180" width="640" height="640" rx="72" fill="none" stroke="rgba(239, 68, 68, 0.35)" stroke-width="3" />
          <circle cx="500" cy="500" r="46" fill="none" stroke="#ef4444" stroke-width="3" stroke-dasharray="16 8" filter="url(#crimsonGlow)" />
          <circle cx="500" cy="500" r="4.5" fill="#fca5a5" filter="url(#crimsonGlow)" />
          <line x1="500" y1="420" x2="500" y2="450" stroke="#ef4444" stroke-width="3" filter="url(#crimsonGlow)" />
          <line x1="500" y1="550" x2="500" y2="580" stroke="#ef4444" stroke-width="3" filter="url(#crimsonGlow)" />
          <line x1="420" y1="500" x2="450" y2="500" stroke="#ef4444" stroke-width="3" filter="url(#crimsonGlow)" />
          <line x1="550" y1="500" x2="580" y2="500" stroke="#ef4444" stroke-width="3" filter="url(#crimsonGlow)" />
        </svg>
        <div class="exp9-scope-badge">
          <span class="exp9-scope-optic" style="color: #f87171;">SG 553 KRIEG</span>
          <span class="exp9-scope-mag">1.6X HOLOGRAPHIC</span>
        </div>
      `;
    }

    return '';
  }

  function setScopeLevel(level) {
    const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
    const scopeOverlay = document.getElementById('scopeOverlay');
    const tacticalCrosshair = document.getElementById('tacticalCrosshair');
    const btnTouchScope = document.getElementById('btnTouchScope');

    if (level === 0 || !wep || !wep.hasScope) {
      combat.scopeLevel = 0;
      combat.scopedTargetFov = 65;
      if (scopeOverlay) {
        scopeOverlay.classList.add('hidden');
        scopeOverlay.innerHTML = '';
      }
      if (tacticalCrosshair) {
        tacticalCrosshair.style.display = '';
      }
      if (btnTouchScope) {
        btnTouchScope.classList.remove('active');
      }
      return;
    }

    combat.scopeLevel = level;
    if (btnTouchScope) {
      btnTouchScope.classList.add('active');
    }

    // Determine target FOV based on weapon optic
    if (wep.opticType === 'awp') {
      combat.scopedTargetFov = (level === 2) ? 12 : 28;
      if (tacticalCrosshair) tacticalCrosshair.style.display = 'none';
    } else if (wep.opticType === 'scout') {
      combat.scopedTargetFov = 24;
      if (tacticalCrosshair) tacticalCrosshair.style.display = 'none';
    } else if (wep.opticType === 'aug' || wep.opticType === 'sg553') {
      combat.scopedTargetFov = 38;
      if (tacticalCrosshair) tacticalCrosshair.style.display = 'none';
    } else {
      combat.scopedTargetFov = 40;
    }

    playScopeSound(true);

    if (scopeOverlay) {
      scopeOverlay.innerHTML = getOpticSVG(wep.opticType, combat.scopeLevel);
      scopeOverlay.classList.remove('hidden');
    }
  }

  function toggleWeaponScope() {
    const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
    if (!wep || !wep.hasScope) {
      return;
    }
    if (combat.isReloading) return;

    if (wep.opticType === 'awp') {
      const nextLevel = (combat.scopeLevel + 1) % 3;
      setScopeLevel(nextLevel);
      if (nextLevel === 0) playScopeSound(false);
    } else {
      const nextLevel = combat.scopeLevel === 0 ? 1 : 0;
      setScopeLevel(nextLevel);
      if (nextLevel === 0) playScopeSound(false);
    }
  }

  function switchWeaponSlot(slot) {
    if (slot === combat.activeSlot) return;
    if (slot === 1 && !combat.equippedPrimary) {
      showTrickToast('NO PRIMARY WEAPON EQUIPPED! (BUY IN [B])');
      return;
    }
    if (slot === 2 && !combat.equippedSecondary) {
      showTrickToast('NO SECONDARY WEAPON EQUIPPED!');
      return;
    }
    setScopeLevel(0);
    combat.activeSlot = slot;
    const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
    updateWeaponHUD();
    updateEquippedWeaponModel();
    if (wep) {
      showTrickToast(`SWAPPED: ${wep.name.toUpperCase()}`);
    }
  }

  function quickSwitchWeapon() {
    if (combat.activeSlot === 1) {
      if (combat.equippedSecondary) switchWeaponSlot(2);
    } else {
      if (combat.equippedPrimary) switchWeaponSlot(1);
    }
  }

  function isBuyMenuOpen() {
    const modal = document.getElementById('buyMenuModal');
    return modal && !modal.classList.contains('hidden');
  }

  function openBuyMenu() {
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (err) {}
    }
    const modal = document.getElementById('buyMenuModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderBuyMenuGrid(combat.currentCategory);
    updateBuyMenuCash();
  }

  function closeBuyMenu() {
    const modal = document.getElementById('buyMenuModal');
    if (modal) modal.classList.add('hidden');
  }

  function toggleBuyMenu() {
    if (isBuyMenuOpen()) {
      closeBuyMenu();
    } else {
      openBuyMenu();
    }
  }

  function updateBuyMenuCash() {
    const cashEl = document.getElementById('buyMenuCash');
    const hudCash = document.getElementById('hudPlayerCash');
    const txt = `$${combat.cash.toLocaleString()}`;
    if (cashEl) cashEl.textContent = txt;
    if (hudCash) hudCash.textContent = txt;
  }

  function renderBuyMenuGrid(category) {
    combat.currentCategory = category;
    const grid = document.getElementById('buyMenuGrid');
    if (!grid) return;
    grid.innerHTML = '';

    document.querySelectorAll('.exp9-buy-tab').forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-category') === category);
    });

    const items = WEAPON_ARSENAL[category] || [];
    items.forEach((item, index) => {
      const card = document.createElement('div');
      const isEquipped = (combat.equippedPrimary && combat.equippedPrimary.id === item.id) ||
                         (combat.equippedSecondary && combat.equippedSecondary.id === item.id);
      card.className = 'exp9-weapon-item' + (isEquipped ? ' equipped' : '');

      const canAfford = (combat.cash >= item.price);
      card.innerHTML = `
        <div class="exp9-item-top">
          <span class="exp9-item-name">${index + 1}. ${item.name}</span>
          <span class="exp9-item-price">$${item.price.toLocaleString()}</span>
        </div>
        <div class="exp9-item-desc">${item.desc || ''}</div>
        <div class="exp9-item-stats">
          <div class="exp9-stat-row">
            <span>DAMAGE</span>
            <div class="exp9-stat-bar-track">
              <div class="exp9-stat-bar-fill" style="width: ${Math.min(100, (item.damage || 30) * 0.9)}%"></div>
            </div>
          </div>
          <div class="exp9-stat-row">
            <span>FIRE RATE</span>
            <div class="exp9-stat-bar-track">
              <div class="exp9-stat-bar-fill" style="width: ${Math.min(100, (item.rpm || 300) / 9)}%"></div>
            </div>
          </div>
        </div>
        <button type="button" class="exp9-btn-buy" ${!canAfford ? 'disabled' : ''}>
          ${isEquipped ? 'EQUIPPED (RE-BUY)' : (canAfford ? 'BUY' : 'INSUFFICIENT FUNDS')}
        </button>
      `;

      card.querySelector('.exp9-btn-buy').addEventListener('click', () => {
        purchaseWeapon(item);
      });

      grid.appendChild(card);
    });
  }

  function purchaseWeapon(item) {
    if (combat.cash < item.price) return;
    combat.cash -= item.price;
    playCashSound();
    setScopeLevel(0);

    if (item.category === 'Armor') {
      combat.gear.armor = 100;
      combat.gear.helmet = true;
      showTrickToast('KEVLAR + HELMET EQUIPPED! 🛡️');
    } else if (item.slot === 1) {
      combat.equippedPrimary = { ...item, ammoInMag: item.magSize, ammoInReserve: item.maxAmmo };
      combat.activeSlot = 1;
      showTrickToast(`EQUIPPED: ${item.name.toUpperCase()}! 🎯`);
      updateEquippedWeaponModel();
    } else if (item.slot === 2) {
      combat.equippedSecondary = { ...item, ammoInMag: item.magSize, ammoInReserve: item.maxAmmo };
      combat.activeSlot = 2;
      showTrickToast(`EQUIPPED: ${item.name.toUpperCase()}! 🔫`);
      updateEquippedWeaponModel();
    } else {
      showTrickToast(`PURCHASED: ${item.name.toUpperCase()}! ✨`);
    }

    updateWeaponHUD();
    updateBuyMenuCash();
    renderBuyMenuGrid(combat.currentCategory);
  }

  function updateWeaponHUD() {
    const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
    const nameEl = document.getElementById('hudWeaponName');
    const catEl = document.getElementById('hudWeaponCategory');
    const ammoEl = document.getElementById('hudWeaponAmmo');
    if (wep) {
      if (nameEl) nameEl.textContent = wep.name.toUpperCase();
      if (catEl) catEl.textContent = wep.category.toUpperCase();
      if (ammoEl) ammoEl.innerHTML = `${wep.ammoInMag} <small>/ ${wep.ammoInReserve}</small>`;
    }
  }

  function fireCurrentWeapon() {
    const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
    if (!wep) return;
    if (combat.isReloading) return;
    if (wep.ammoInMag <= 0) {
      reloadCurrentWeapon();
      return;
    }

    const now = performance.now();
    const shotInterval = (60 / (wep.rpm || 400)) * 1000;
    if (now - combat.lastFireTime < shotInterval) return;
    combat.lastFireTime = now;

    wep.ammoInMag--;
    updateWeaponHUD();
    playGunshotSound(wep.soundType || 'rifle');

    // Trigger physical weapon recoil impulse on floating 3D gun model
    combat.weaponRecoil = 0.065; // ~6.5cm recoil kick

    // Crosshair recoil kick
    const crosshair = document.getElementById('tacticalCrosshair');
    if (crosshair) {
      crosshair.classList.add('recoil');
      setTimeout(() => crosshair.classList.remove('recoil'), 70);
    }

    // Camera recoil punch
    state.camera.pitch = Math.min(1.25, state.camera.pitch - 0.012);
    state.player.pitch -= 0.015;

    // Raycast tracer directly through center crosshair into 3D world
    _shootRay.setFromCamera(new THREE.Vector2(0, 0), camera);
    _shootRay.far = 120.0;

    let targetPoint = null;
    const meshes = currentMapId === 'dust2' ? dust2WalkMeshes : state.obstacles;
    const playerHitboxes = (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.getPlayerHitboxes)
      ? window.GamerWheelsMultiplayer.getPlayerHitboxes()
      : [];

    const allTargets = [...(meshes || []), ...playerHitboxes];

    if (allTargets.length > 0) {
      const hits = _shootRay.intersectObjects(allTargets, true);
      if (hits && hits.length > 0) {
        const firstHit = hits[0];
        targetPoint = firstHit.point;

        // Check if hit object is a player hitbox
        let hitObj = firstHit.object;
        let isPlayerHit = false;
        let hitPlayerId = null;

        while (hitObj) {
          if (hitObj.userData && hitObj.userData.isPlayerHitbox) {
            isPlayerHit = true;
            hitPlayerId = hitObj.userData.playerId;
            break;
          }
          hitObj = hitObj.parent;
        }

        if (isPlayerHit && hitPlayerId) {
          const hitY = firstHit.point.y;
          const remoteRiders = window.GamerWheelsMultiplayer ? window.GamerWheelsMultiplayer.getRemotePlayers() : null;
          const rp = remoteRiders ? remoteRiders.get(hitPlayerId) : null;
          const baseY = rp ? rp.current.y : (hitY - 0.9);
          const isHeadshot = (hitY - baseY) > 1.25;

          const baseDamage = wep.damage || 30;
          const finalDamage = isHeadshot ? Math.round(baseDamage * 3.5) : baseDamage;

          // Send damage to server
          if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.sendHit) {
            window.GamerWheelsMultiplayer.sendHit(hitPlayerId, finalDamage, isHeadshot, wep.id, firstHit.point);
          }

          // Immediate local hit feedback
          flashCrosshairHitmarker(isHeadshot);
          playHitSound(isHeadshot);
          spawnFloatingDamageText(firstHit.point, finalDamage, isHeadshot);
          emitSparkBurst(firstHit.point.x, firstHit.point.y, firstHit.point.z);
        } else {
          emitSparkBurst(targetPoint.x, targetPoint.y, targetPoint.z);
        }
      }
    }

    if (!targetPoint) {
      targetPoint = new THREE.Vector3();
      _shootRay.ray.at(80.0, targetPoint);
    }

    // Tracer originates at floating gun muzzle in world space
    if (boardWeaponGroup) {
      boardWeaponGroup.getWorldPosition(_shootOrigin);
      const forwardOffset = new THREE.Vector3(0, 0.02, 0.35).applyEuler(boardGroup.rotation);
      _shootOrigin.add(forwardOffset);
    } else {
      _shootOrigin.set(state.player.x, state.player.y + 0.45, state.player.z);
    }
    createBulletTracer(_shootOrigin, targetPoint);

    if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.sendShoot) {
      window.GamerWheelsMultiplayer.sendShoot(_shootOrigin, targetPoint, wep.id, wep.soundType);
    }
  }

  function flashCrosshairHitmarker(isHeadshot) {
    const crosshair = document.getElementById('tacticalCrosshair');
    if (!crosshair) return;
    crosshair.classList.remove('hit', 'headshot');
    void crosshair.offsetWidth;
    crosshair.classList.add('hit');
    if (isHeadshot) crosshair.classList.add('headshot');
    setTimeout(() => {
      crosshair.classList.remove('hit', 'headshot');
    }, 140);
  }

  function playHitSound(isHeadshot) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isHeadshot ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(isHeadshot ? 1200 : 880, t);
      osc.frequency.exponentialRampToValueAtTime(isHeadshot ? 1800 : 660, t + 0.08);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    } catch (e) {}
  }

  function playPainSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.15);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    } catch (e) {}
  }

  const floatingTexts = [];
  function spawnFloatingDamageText(pos, dmg, isHeadshot) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = `bold 30px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHeadshot ? '#f59e0b' : '#ef4444';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    const txt = isHeadshot ? `💥 -${dmg} HEADSHOT` : `-${dmg}`;
    ctx.strokeText(txt, 128, 32);
    ctx.fillText(txt, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.copy(pos);
    sprite.position.y += 0.35;
    scene.add(sprite);
    floatingTexts.push({ sprite, tex, life: 0.85, maxLife: 0.85 });
  }

  function updateVitalsHUD() {
    const hpVal = document.getElementById('hudHpVal');
    const hpBar = document.getElementById('hudHpBar');
    const armorVal = document.getElementById('hudArmorVal');
    const armorBar = document.getElementById('hudArmorBar');

    if (hpVal) hpVal.textContent = Math.max(0, Math.round(combat.hp));
    if (hpBar) {
      const pct = Math.max(0, Math.min(100, combat.hp));
      hpBar.style.width = `${pct}%`;
      hpBar.style.backgroundColor = pct > 50 ? '#22c55e' : (pct > 25 ? '#eab308' : '#ef4444');
    }
    if (armorVal) armorVal.textContent = Math.max(0, Math.round(combat.gear.armor));
    if (armorBar) {
      const pct = Math.max(0, Math.min(100, combat.gear.armor));
      armorBar.style.width = `${pct}%`;
    }
  }

  function updateTeamHUD() {
    const btnJoinT = document.getElementById('btnJoinT');
    const btnJoinCT = document.getElementById('btnJoinCT');
    if (btnJoinT) btnJoinT.classList.toggle('active', combat.team === 'T');
    if (btnJoinCT) btnJoinCT.classList.toggle('active', combat.team === 'CT');
  }

  function reloadCurrentWeapon() {
    const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
    if (!wep || combat.isReloading) return;
    if (wep.ammoInMag >= wep.magSize || wep.ammoInReserve <= 0) return;

    setScopeLevel(0); // Unzoom on reload
    combat.isReloading = true;
    showTrickToast(`RELOADING ${wep.name.toUpperCase()}...`);
    const hudWeaponAmmo = document.getElementById('hudWeaponAmmo');
    if (hudWeaponAmmo) hudWeaponAmmo.innerHTML = `RELOAD...`;

    setTimeout(() => {
      combat.isReloading = false;
      const needed = wep.magSize - wep.ammoInMag;
      const amount = Math.min(needed, wep.ammoInReserve);
      wep.ammoInMag += amount;
      wep.ammoInReserve -= amount;
      updateWeaponHUD();
    }, 1800);
  }

  function createBulletTracer(start, end) {
    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfef08a, linewidth: 2, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    tracerLines.push({ line, time: 0.06 });
  }

  function emitSparkBurst(x, y, z) {
    for (let i = 0; i < 5; i++) {
      emitGrindSparks(x, y, z);
    }
  }

  function initBombSiteBeacons() {
    if (!dust2Group) return;
    Object.keys(BOMB_SITES).forEach((key) => {
      const site = BOMB_SITES[key];
      const ringGeom = new THREE.RingGeometry(site.radius - 0.35, site.radius, 32);
      ringGeom.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: key === 'A' ? 0xef4444 : 0xf59e0b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.set(site.x, site.y + 0.03, site.z);
      dust2Group.add(ring);
    });
  }

  function spawnC4InWorld(x, y, z, site) {
    if (c4Mesh) {
      scene.remove(c4Mesh);
    }
    const c4Group = new THREE.Group();
    const bodyGeom = new THREE.BoxGeometry(0.32, 0.12, 0.18);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.06;
    c4Group.add(body);

    const dynGeom = new THREE.CylinderGeometry(0.025, 0.025, 0.30, 8);
    dynGeom.rotateZ(Math.PI / 2);
    const dynMat = new THREE.MeshStandardMaterial({ color: 0xb45309 });
    const dyn1 = new THREE.Mesh(dynGeom, dynMat);
    dyn1.position.set(0, 0.13, 0.04);
    const dyn2 = new THREE.Mesh(dynGeom, dynMat);
    dyn2.position.set(0, 0.13, -0.04);
    c4Group.add(dyn1, dyn2);

    c4BlinkLight = new THREE.PointLight(0xef4444, 2.5, 3.5);
    c4BlinkLight.position.set(0, 0.20, 0);
    c4Group.add(c4BlinkLight);

    c4Group.position.set(x, y, z);
    scene.add(c4Group);
    c4Mesh = c4Group;
  }

  function updateTacticalCombat(dt) {
    // Update active tracers
    for (let i = tracerLines.length - 1; i >= 0; i--) {
      tracerLines[i].time -= dt;
      if (tracerLines[i].time <= 0) {
        scene.remove(tracerLines[i].line);
        tracerLines[i].line.geometry.dispose();
        tracerLines[i].line.material.dispose();
        tracerLines.splice(i, 1);
      }
    }

    // Automatic weapon continuous spray
    if (combat.isFiring) {
      const wep = combat.activeSlot === 1 ? combat.equippedPrimary : combat.equippedSecondary;
      if (wep && wep.id !== 'nova' && wep.id !== 'scout' && wep.id !== 'awp') {
        fireCurrentWeapon();
      }
    }

    if (currentMapId !== 'dust2') return;

    // Check distance to Bomb Sites
    const p = state.player;
    let nearSite = null;
    for (const key of ['A', 'B']) {
      const site = BOMB_SITES[key];
      const d = Math.hypot(p.x - site.x, p.z - site.z);
      if (d < site.radius && Math.abs(p.y - site.y) < 2.5) {
        nearSite = key;
        break;
      }
    }

    const bombZoneCard = document.getElementById('bombZoneCard');
    const plantBarFill = document.getElementById('plantBarFill');

    if (nearSite && combat.hasBomb && !combat.bombPlanted) {
      if (bombZoneCard) bombZoneCard.classList.remove('hidden');

      if (state.input.plant) {
        combat.isPlanting = true;
        combat.plantProgress = Math.min(3.0, combat.plantProgress + dt);
        if (plantBarFill) plantBarFill.style.width = (combat.plantProgress / 3.0 * 100) + '%';

        if (combat.plantProgress >= 3.0) {
          combat.hasBomb = false;
          combat.bombPlanted = true;
          combat.bombSite = nearSite;
          combat.isPlanting = false;
          combat.plantProgress = 0;
          if (bombZoneCard) bombZoneCard.classList.add('hidden');

          spawnC4InWorld(p.x, p.y, p.z, nearSite);

          if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.plantC4) {
            window.GamerWheelsMultiplayer.plantC4(nearSite, p.x, p.y, p.z);
          }
          showTrickToast(`💣 BOMB PLANTED AT SITE ${nearSite}! 45s TO DETONATION`);
        }
      } else {
        combat.isPlanting = false;
        combat.plantProgress = Math.max(0, combat.plantProgress - dt * 2);
        if (plantBarFill) plantBarFill.style.width = (combat.plantProgress / 3.0 * 100) + '%';
      }
    } else {
      if (bombZoneCard) bombZoneCard.classList.add('hidden');
      combat.isPlanting = false;
      combat.plantProgress = 0;
    }
  }

  function handleTacticalMatchStart(stateData) {
    if (currentMapId !== 'dust2') return;

    // In solo test mode or on Terrorist team: spawn at Terrace / T Spawn (Checkpoint 0)
    if (stateData.isSolo || stateData.team === 'T') {
      teleportToCheckpoint(0); // T Spawn (Terrace): x: -8.0, z: 32.0, y: 2.38
      combat.hasBomb = true;
      combat.bombPlanted = false;
      combat.bombSite = null;
      showTrickToast('TERRORIST MISSION (Terrace Spawn): Plant C4 at Site A or B! 💣');
    } else {
      teleportToCheckpoint(1); // CT Spawn Base: x: -25.0, z: -35.0, y: 4.58
      combat.hasBomb = false;
      showTrickToast('COUNTER-TERRORIST MISSION: Defend Site A and Site B! 🛡️');
    }
    updateWeaponHUD();
    updateBuyMenuCash();
  }

  function isTacticalMatchActive() {
    const banner = document.getElementById('matchBanner');
    return banner && banner.classList.contains('tactical');
  }

  function switchMap(newMapId, isInitial = false) {
    if (newMapId === '2fort') {
      showTrickToast('🔒 2FORT IS LOCKED: COMING SOON');
      return;
    }
    if (newMapId === currentMapId && !isInitial) return;

    currentMapId = newMapId;
    CHECKPOINTS = MAP_CHECKPOINTS[currentMapId] || MAP_CHECKPOINTS.dust2;

    // Update Top Left UI
    const currentMapIcon = document.getElementById('currentMapIcon');
    const currentMapName = document.getElementById('currentMapName');
    const matchBanner = document.getElementById('matchBanner');

    if (currentMapIcon && currentMapName) {
      if (currentMapId === 'dust2') {
        currentMapIcon.textContent = '🏜️';
        currentMapName.textContent = 'Dust 2';
        if (hudTerrainVal) hudTerrainVal.textContent = 'Dust 2';
      } else {
        currentMapIcon.textContent = '🏙️';
        currentMapName.textContent = 'Plaza Skatepark';
        if (hudTerrainVal) hudTerrainVal.textContent = 'Central Plaza';
      }
    }

    // Toggle match banner visibility (Dust 2 has CS match loop)
    if (matchBanner) {
      matchBanner.style.display = currentMapId === 'dust2' ? 'inline-flex' : 'none';
    }

    // Update map dropdown active states
    document.querySelectorAll('.exp9-map-item').forEach((item) => {
      const m = item.getAttribute('data-map');
      item.classList.toggle('active', m === currentMapId);
    });

    // Update 3D visibility & lighting
    setEnvironmentLighting(currentMapId);

    if (currentMapId === 'dust2') {
      if (parkWorldGroup) parkWorldGroup.visible = false;
      if (dust2Group) dust2Group.visible = true;
      loadDust2Map(() => {
        teleportToCheckpoint(0);
      });
    } else {
      if (parkWorldGroup) parkWorldGroup.visible = true;
      if (dust2Group) dust2Group.visible = false;
      teleportToCheckpoint(0);
    }

    updateCheckpointsUI();

    // Inform multiplayer server
    if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.changeMap) {
      window.GamerWheelsMultiplayer.changeMap(currentMapId);
    }
  }

  function getDust2SurfaceElevation(x, z, currentY) {
    if (!dust2WalkMeshes || dust2WalkMeshes.length === 0) {
      return 0.1;
    }

    const isSpawning = (currentY >= 10.0);
    // Ray starts 1.5m above player; never go below y=0.5 to avoid shooting into geometry from underground
    const rayStartY = isSpawning ? 12.0 : Math.max(currentY + 1.5, 0.5);
    dust2RayOrigin.set(x, rayStartY, z);
    dust2Ray.set(dust2RayOrigin, dust2DownDir);
    dust2Ray.far = 25.0;

    const hits = dust2Ray.intersectObjects(dust2WalkMeshes, false);
    if (hits && hits.length > 0) {
      const validWalkHits = [];
      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        // Reject building roofs above maximum playable height (5.5m)
        if (hit.point.y > 5.5) continue;

        // Reject decorative window sill alcoves / non-walkable wall recesses on either side of mid doors
        if (hit.point.y > 1.8 && hit.point.y < 2.6 && hit.point.x < -3.2 &&
            ((hit.point.z >= 7.8 && hit.point.z <= 9.8) || (hit.point.z >= 15.5 && hit.point.z <= 17.5))) {
          continue;
        }

        // Reject any surface more than 1.2m above the player's current position (prevents stair-teleport)
        // Allow more step-up only during airborne to handle landing on ledges
        const maxStepUp = (state.player && state.player.isAirborne) ? 2.0 : 1.2;
        if (!isSpawning && hit.point.y > currentY + maxStepUp) continue;

        const norm = getHitWorldNormal(hit);
        // Only accept surfaces that are flat or drivable slopes (steeper than ~49 deg is a wall)
        if (norm && norm.y >= 0.65) {
          validWalkHits.push(hit.point.y);
        }
      }

      if (validWalkHits.length > 0) {
        // Sort descending by height
        validWalkHits.sort((a, b) => b - a);

        if (isSpawning) {
          // For checkpoint teleport or initial spawn, pick highest floor below roof
          return validWalkHits[0];
        }

        // When grounded, max step-up is 0.38m; when jumping, ground must be below feet
        const isAir = (state.player && state.player.isAirborne);
        const maxAllowedY = isAir ? (currentY + 0.20) : (currentY + 0.38);

        for (let j = 0; j < validWalkHits.length; j++) {
          const hy = validWalkHits[j];
          if (hy <= maxAllowedY) {
            return hy;
          }
        }

        // If no walkable surface was at or below maxAllowedY (e.g. against a wall or roof)
        return currentY;
      }
    }
    return (currentY !== undefined && !isSpawning) ? currentY : 0.1;
  }

  // ==========================================================================
  // Unified Surface Elevation Query (Terrain + All Stunt Obstacles & Ramps)
  // ==========================================================================
  function getSurfaceElevation(x, z) {
    if (currentMapId === 'dust2') {
      return getDust2SurfaceElevation(x, z, state.player.y);
    }

    let surfaceH = getTerrainElevation(x, z);

    for (let i = 0; i < state.obstacles.length; i++) {
      const obs = state.obstacles[i];
      const halfW = obs.width / 2;
      const halfL = (obs.length || 0) / 2;

      // A. Mega Drop Obstacles
      if (obs.type === 'megadrop_platform') {
        if (Math.abs(x - obs.x) <= halfW && Math.abs(z - obs.z) <= halfL) {
          surfaceH = Math.max(surfaceH, obs.height);
        }
      } else if (obs.type === 'megadrop_runway') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const dropY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          surfaceH = Math.max(surfaceH, dropY);
        }
      } else if (obs.type === 'megadrop_kicker') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const rampY = obs.yStart + Math.pow(ratio, 1.35) * (obs.yEnd - obs.yStart);
          surfaceH = Math.max(surfaceH, rampY);
        }
      } else if (obs.type === 'megadrop_landing') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const landY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          surfaceH = Math.max(surfaceH, landY);
        }
      }
      // B. Rotated Kickers
      else if (obs.type === 'kicker') {
        const dx = x - obs.x;
        const dz = z - obs.z;
        const cosR = Math.cos(-obs.rotation);
        const sinR = Math.sin(-obs.rotation);
        const localX = dx * cosR + dz * sinR;
        const localZ = -dx * sinR + dz * cosR;
        if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfL) {
          const ratio = THREE.MathUtils.clamp((halfL - localZ) / obs.length, 0, 1);
          const rampY = obs.baseY + Math.pow(ratio, 1.25) * obs.height;
          surfaceH = Math.max(surfaceH, rampY);
        }
      }
      // C. Banked Ramps
      else if (obs.type === 'bank_z') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const bankY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          surfaceH = Math.max(surfaceH, bankY);
        }
      } else if (obs.type === 'bank_x') {
        const minX = Math.min(obs.xStart, obs.xEnd);
        const maxX = Math.max(obs.xStart, obs.xEnd);
        if (Math.abs(z - obs.z) <= halfL && x >= minX && x <= maxX) {
          const ratio = THREE.MathUtils.clamp((x - obs.xStart) / (obs.xEnd - obs.xStart), 0, 1);
          const bankY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          surfaceH = Math.max(surfaceH, bankY);
        }
      }
      // D. Tabletop (Supports both Northbound and Southbound lines)
      else if (obs.type === 'tabletop') {
        if (Math.abs(x - obs.x) <= halfW) {
          const isSouthbound = obs.dir === -1 || (obs.zStart && obs.zStart > obs.zEnd);
          const startZ = isSouthbound ? (obs.zStart || (obs.z + halfL)) : (obs.z - halfL);
          const relRun = isSouthbound ? (startZ - z) : (z - startZ);
          if (relRun >= 0 && relRun <= obs.length) {
            let deckY = obs.baseY;
            if (relRun < obs.takeoffLen) {
              deckY += (relRun / obs.takeoffLen) * obs.height;
            } else if (relRun <= obs.takeoffLen + obs.deckLen) {
              deckY += obs.height;
            } else {
              const landRatio = (relRun - obs.takeoffLen - obs.deckLen) / obs.landingLen;
              deckY += (1 - landRatio) * obs.height;
            }
            surfaceH = Math.max(surfaceH, deckY);
          }
        }
      }
      // E. Gap Kicker & Landing
      else if (obs.type === 'gap_kicker') {
        if (Math.abs(x - obs.x) <= halfW) {
          const relZ = z - obs.z;
          if (Math.abs(relZ) <= halfL) {
            const ratio = obs.dir === -1
              ? THREE.MathUtils.clamp((halfL - relZ) / obs.length, 0, 1)
              : THREE.MathUtils.clamp((relZ + halfL) / obs.length, 0, 1);
            surfaceH = Math.max(surfaceH, obs.baseY + ratio * obs.height);
          }
        }
      } else if (obs.type === 'gap_landing') {
        if (Math.abs(x - obs.x) <= halfW) {
          const relZ = z - obs.z;
          if (Math.abs(relZ) <= halfL) {
            const ratio = obs.dir === -1
              ? THREE.MathUtils.clamp((halfL - relZ) / obs.length, 0, 1)
              : THREE.MathUtils.clamp((relZ + halfL) / obs.length, 0, 1);
            surfaceH = Math.max(surfaceH, obs.baseY + (1 - ratio) * obs.height);
          }
        }
      }
      // F. Whale Tail (Both natural timber_whaletail and legacy whaletail)
      else if (obs.type === 'timber_whaletail' || obs.type === 'whaletail') {
        if (Math.abs(x - obs.x) <= halfW) {
          const isSouthbound = obs.zStart > obs.zEnd || obs.dir === -1 || obs.type === 'timber_whaletail';
          const startZ = obs.zStart !== undefined ? obs.zStart : (obs.z + halfL);
          const totalLen = obs.length || Math.abs(obs.zStart - obs.zEnd);
          const relRun = isSouthbound ? (startZ - z) : (z - startZ);
          if (relRun >= 0 && relRun <= totalLen) {
            let spineY = obs.baseY;
            if (relRun < 4.5) {
              spineY += Math.pow(relRun / 4.5, 1.25) * obs.height;
            } else if (relRun <= 9.5) {
              const arch = Math.sin(((relRun - 4.5) / 5.0) * Math.PI) * 0.35;
              spineY += obs.height + arch;
            } else {
              const dropRatio = (relRun - 9.5) / (totalLen - 9.5);
              spineY += (1 - dropRatio) * obs.height;
            }
            surfaceH = Math.max(surfaceH, spineY);
          }
        }
      }
      // G. Slopestyle Roll-ins & Step-ups
      else if (obs.type === 'slopestyle_rollin' || obs.type === 'mx_rollin') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const rampY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          surfaceH = Math.max(surfaceH, rampY);
        }
      } else if (obs.type === 'slopestyle_stepup') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const rampY = obs.yStart + Math.pow(ratio, 1.25) * (obs.yEnd - obs.yStart);
          surfaceH = Math.max(surfaceH, rampY);
        }
      }
      // H. Bridges, Wallrides, Whoops, Berm Bowls
      else if (obs.type === 'bridge') {
        if (Math.abs(x - obs.x) <= halfW && Math.abs(z - obs.z) <= halfL) {
          surfaceH = Math.max(surfaceH, obs.height);
        }
      } else if (obs.type === 'wallride') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const bankT = THREE.MathUtils.clamp((x - (obs.x - halfW)) / obs.width, 0, 1);
          const wallY = obs.baseY + Math.pow(bankT, 1.3) * obs.height;
          surfaceH = Math.max(surfaceH, wallY);
        }
      } else if (obs.type === 'whoops') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(x - obs.x) <= halfW && z >= minZ && z <= maxZ) {
          const totalLen = Math.abs(obs.zEnd - obs.zStart);
          const relZ = Math.abs(z - obs.zStart);
          const wavelength = totalLen / obs.count;
          const phase = (relZ / wavelength) * Math.PI * 2;
          const whoopY = obs.baseY + 0.55 + Math.sin(phase) * obs.height;
          surfaceH = Math.max(surfaceH, whoopY);
        }
      } else if (obs.type === 'berm_bowl') {
        const dist = Math.hypot(x - obs.x, z - obs.z);
        if (dist <= obs.radius) {
          const rimT = dist / obs.radius;
          const bermY = obs.baseY + Math.pow(rimT, 2.0) * obs.height;
          surfaceH = Math.max(surfaceH, bermY);
        }
      }
      // I. Flat Decks, Ledges, Curbs, Rails, Boardwalks
      else if (obs.type === 'deck') {
        if (Math.abs(x - obs.x) <= halfW && Math.abs(z - obs.z) <= halfL) {
          surfaceH = Math.max(surfaceH, obs.height);
        }
      } else if (obs.type === 'rail' || obs.type === 'ledge' || obs.type === 'curb' || obs.type === 'boardwalk') {
        const effHalfW = obs.type === 'rail' ? 0.65 : halfW;
        const effHalfL = obs.type === 'rail' ? halfL + 0.35 : halfL;
        if (Math.abs(x - obs.x) <= effHalfW && Math.abs(z - obs.z) <= effHalfL) {
          if (state.player.y >= obs.height - 0.28) {
            surfaceH = Math.max(surfaceH, obs.height);
          }
        }
      }
    }

    return surfaceH;
  }

  // ==========================================================================
  // 10. Physics Simulation & Movement Loop
  // ==========================================================================
  function updatePhysics(dt) {
    const p = state.player;

    // 1. Desired Screen-Space Direction
    let inputX = 0;
    let inputY = 0;

    if (state.input.joystickActive) {
      inputX = state.input.joystickVector.x;
      inputY = state.input.joystickVector.y;
    } else {
      if (state.input.right) inputX += 1;
      if (state.input.left) inputX -= 1;
      if (state.input.up) inputY += 1;
      if (state.input.down) inputY -= 1;

      const len = Math.hypot(inputX, inputY);
      if (len > 0) {
        inputX /= len;
        inputY /= len;
      }
    }

    // Convert Screen Space to 3D Camera-Relative World Coordinates
    const sinCam = Math.sin(state.camera.yaw);
    const cosCam = Math.cos(state.camera.yaw);

    // Forward vector away from camera on ground plane:
    const fwdCamX = -sinCam;
    const fwdCamZ = -cosCam;
    // Right vector to the right of camera view (90 deg clockwise from fwdCam on ground plane):
    const rightCamX = cosCam;
    const rightCamZ = -sinCam;

    const worldDirX = inputY * fwdCamX + inputX * rightCamX;
    const worldDirZ = inputY * fwdCamZ + inputX * rightCamZ;
    const inputMagnitude = Math.min(1.0, Math.hypot(inputX, inputY));

    // Unit forward and lateral vectors based on current board heading
    const fwdX = Math.sin(p.heading);
    const fwdZ = Math.cos(p.heading);
    const rightX = Math.cos(p.heading);
    const rightZ = -Math.sin(p.heading);

    // Decompose current velocity along forward and lateral axes
    let vFwd = p.vx * fwdX + p.vz * fwdZ;
    let vLat = p.vx * rightX + p.vz * rightZ;

    let isBrakingInput = false;

    // 2. Motor Acceleration, Steering, Braking & Coasting
    if (inputMagnitude > 0.05) {
      const desiredHeading = Math.atan2(worldDirX, worldDirZ);

      // Determine if rider is currently rolling fakie (tail forward)
      let isFakie = false;
      if (p.speed > 1.8 && vFwd < -0.8) {
        isFakie = true;
      }

      // If fakie, steer the board's tail towards desired travel direction
      const targetBoardHeading = isFakie ? desiredHeading + Math.PI : desiredHeading;
      let angleDiff = targetBoardHeading - p.heading;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

      // High-speed braking detection:
      // When traveling at speed and pulling the stick backward relative to board heading (> 108 deg)
      isBrakingInput = p.speed > 1.8 && Math.abs(angleDiff) > (Math.PI * 0.60);

      if (isBrakingInput) {
        // --- REGENERATIVE BRAKING AT SPEED ---
        // Decelerates forward speed firmly without 180-spinning the board
        const brakeDecel = 24.0; // m/s^2 firm responsive braking
        if (vFwd > 0) {
          vFwd = Math.max(0, vFwd - brakeDecel * inputMagnitude * dt);
        } else if (vFwd < 0) {
          vFwd = Math.min(0, vFwd + brakeDecel * inputMagnitude * dt);
        }

        // Allow lateral carving during braking if stick has horizontal input (e.g. S + A or S + D)
        if (Math.abs(inputX) > 0.08) {
          const steerDir = isFakie ? -1 : 1;
          p.heading -= steerDir * inputX * 3.5 * dt;
          p.roll = THREE.MathUtils.lerp(p.roll, steerDir * inputX * 0.18, dt * 10);
        } else {
          p.roll = THREE.MathUtils.lerp(p.roll, 0, dt * 8);
        }
      } else {
        // --- NORMAL STEERING & ACCELERATION ---
        p.heading += angleDiff * Math.min(1.0, dt * TURN_SPEED);

        // Carve Roll banking
        const rollTarget = THREE.MathUtils.clamp(-angleDiff * 1.5, -0.18, 0.18);
        p.roll = THREE.MathUtils.lerp(p.roll, rollTarget, dt * 10);

        // Motor thrust accelerates along travel direction
        const mapMaxSpeed = getMapMaxSpeed();
        const targetSpeed = mapMaxSpeed * inputMagnitude;
        if (isFakie) {
          if (vFwd > -targetSpeed) {
            const speedRatio = THREE.MathUtils.clamp(-vFwd / mapMaxSpeed, 0, 1);
            const torqueFactor = 1.0 - speedRatio * 0.52;
            vFwd -= ACCELERATION * torqueFactor * dt;
            if (vFwd < -targetSpeed) vFwd = -targetSpeed;
          } else if (vFwd < -targetSpeed + 0.5) {
            vFwd = THREE.MathUtils.lerp(vFwd, -targetSpeed, dt * 4.5);
          }
        } else {
          if (vFwd < targetSpeed) {
            const speedRatio = THREE.MathUtils.clamp(vFwd / mapMaxSpeed, 0, 1);
            const torqueFactor = 1.0 - speedRatio * 0.52;
            vFwd += ACCELERATION * torqueFactor * dt;
            if (vFwd > targetSpeed) vFwd = targetSpeed;
          } else if (targetSpeed < vFwd - 0.5) {
            vFwd = THREE.MathUtils.lerp(vFwd, targetSpeed, dt * 4.5);
          }
        }
      }
    } else {
      // Natural rolling tire deceleration (responsive halt in ~0.8s when letting go of controls)
      vFwd = THREE.MathUtils.lerp(vFwd, 0, dt * 4.8);
      p.roll = THREE.MathUtils.lerp(p.roll, 0, dt * 10);

      // Low-speed complete stop deadband
      if (Math.abs(vFwd) < 0.28) {
        vFwd = 0;
      }
    }

    // 3. Downhill Slope Gravity & Hill-Hold Auto-Brake
    // Gravity acts continuously across terrain, hills, and elevated stunt ramps!
    if (!p.isAirborne && !state.grind.active) {
      const epsG = 0.45;
      const hE = getSurfaceElevation(p.x + epsG, p.z);
      const hW = getSurfaceElevation(p.x - epsG, p.z);
      const hS = getSurfaceElevation(p.x, p.z + epsG);
      const hN = getSurfaceElevation(p.x, p.z - epsG);

      const gradX = (hE - hW) / (2 * epsG);
      const gradZ = (hS - hN) / (2 * epsG);
      const slopeMagnitude = Math.hypot(gradX, gradZ);

      const downhillX = -gradX;
      const downhillZ = -gradZ;

      const isDriving = (inputMagnitude > 0.05);
      const minSlopeToRoll = isDriving ? 0.075 : 0.22;

      // Static tire friction deadband: micro-slopes and polygon seams will not
      // pull the board downhill when parked or coasting!
      if (slopeMagnitude > minSlopeToRoll || (isDriving && p.speed > 0.35)) {
        const gravFwd = downhillX * fwdX + downhillZ * fwdZ;
        const gravLat = downhillX * rightX + downhillZ * rightZ;

        const SLOPE_GRAV = 16.0;
        vFwd += gravFwd * SLOPE_GRAV * dt;
        vLat += gravLat * SLOPE_GRAV * dt;
      } else if (!isDriving) {
        // Firmly hold stationary position on flat or gentle ground (Hill-hold brake)
        vFwd = THREE.MathUtils.lerp(vFwd, 0, dt * 6.0);
        vLat = THREE.MathUtils.lerp(vLat, 0, dt * 6.0);
        if (Math.abs(vFwd) < 0.22) vFwd = 0;
        if (Math.abs(vLat) < 0.22) vLat = 0;
      }

      // Lateral tire grip: resists sideways drift, but on steep slopes allows realistic sideslip!
      const TIRE_LATERAL_GRIP = 6.0;
      vLat = THREE.MathUtils.lerp(vLat, 0, dt * TIRE_LATERAL_GRIP);
      if (Math.abs(vLat) < 0.08 && !isDriving) vLat = 0;
    } else {
      vLat = THREE.MathUtils.lerp(vLat, 0, dt * 4.0);
    }

    // Reconstruct world velocity from forward and lateral components
    p.vx = vFwd * fwdX + vLat * rightX;
    p.vz = vFwd * fwdZ + vLat * rightZ;

    // Downhill top speed cap allows speed up to 26.8 m/s (~60.0 MPH!) on park,
    // or capped at 30.0 MPH (~13.41 m/s) on dust2
    const maxDownhillCap = getMapDownhillSpeedCap();
    const currentSpeed = Math.hypot(p.vx, p.vz);
    if (currentSpeed > maxDownhillCap) {
      p.vx = (p.vx / currentSpeed) * maxDownhillCap;
      p.vz = (p.vz / currentSpeed) * maxDownhillCap;
    }
    p.speed = Math.hypot(p.vx, p.vz);

    // Taillight / Brake Light Dynamic Lighting (Brightens on brake/reverse, shines rearward)
    if (taillightSpot && taillightLens) {
      const isBraking = isBrakingInput || (vFwd < 0.2 && inputMagnitude > 0.1) || state.input.down;
      const targetIntensity = isBraking ? 4.8 : 2.8;
      const targetEmissive = isBraking ? 2.8 : 1.6;
      taillightSpot.intensity = THREE.MathUtils.lerp(taillightSpot.intensity, targetIntensity, dt * 10);
      taillightLens.material.emissiveIntensity = THREE.MathUtils.lerp(taillightLens.material.emissiveIntensity, targetEmissive, dt * 10);
    }

    // 4. Terrain & Ramp Slope Pitch & Carving Roll Alignment
    if (!p.isAirborne && !state.grind.active) {
      const eps = 0.45;
      const hForward = getSurfaceElevation(p.x + Math.sin(p.heading) * eps, p.z + Math.cos(p.heading) * eps);
      const hBackward = getSurfaceElevation(p.x - Math.sin(p.heading) * eps, p.z - Math.cos(p.heading) * eps);
      const hRight = getSurfaceElevation(p.x + Math.cos(p.heading) * eps, p.z - Math.sin(p.heading) * eps);
      const hLeft = getSurfaceElevation(p.x - Math.cos(p.heading) * eps, p.z + Math.sin(p.heading) * eps);

      // In Three.js with 'YXZ' rotation order, local +Z is forward.
      // Negative rotation around local X elevates the front nose (+Y).
      // When going uphill (hForward > hBackward), pitch must be negative so nose lifts up!
      const slopePitch = THREE.MathUtils.clamp(-Math.atan2(hForward - hBackward, eps * 2), -0.65, 0.65);
      const slopeRoll = THREE.MathUtils.clamp(Math.atan2(hRight - hLeft, eps * 2), -0.45, 0.45);

      // Rider acceleration tilt: On a Onewheel, accelerating requires leaning forward so nose dips DOWN (+pitch).
      // Braking / pushback requires leaning back so nose lifts UP (-pitch).
      let accelPitch = 0;
      const currentMapMax = getMapMaxSpeed();
      if (isBrakingInput || (state.input.down && vFwd > 0.4)) {
        // Braking at speed: lift nose up / dip tail down (-0.13 rad ~ -7.4 deg)
        accelPitch = -0.13 * THREE.MathUtils.clamp(inputMagnitude, 0.5, 1.0);
      } else if (inputMagnitude > 0.05 && vFwd >= -0.3) {
        // Accelerating forward: dip nose down (+0.11 rad ~ 6.3 deg)
        const headroom = THREE.MathUtils.clamp(1.0 - (p.speed / (currentMapMax * 1.1)), 0.25, 1.0);
        accelPitch = inputMagnitude * 0.11 * headroom;
      } else if (vFwd < -0.3 && inputMagnitude > 0.05) {
        // Reversing: tail dips down (nose lifts up, -pitch)
        accelPitch = -0.11 * inputMagnitude;
      }
      // Speed lean: cruising forward lean into wind resistance (+0.035 rad ~ 2.0 deg)
      const speedLean = (vFwd > 0.5) ? (p.speed / currentMapMax) * 0.035 : 0;
      const riderPitch = accelPitch + speedLean;

      // Sample Right Stick / Arrow Inputs on Ground (VESC Remote Tilt & Lean Roll)
      let groundTwistX = 0;
      let groundTwistY = 0;
      if (state.input.rightJoystickActive) {
        groundTwistX = state.input.rightJoystickVector.x;
        groundTwistY = state.input.rightJoystickVector.y;
      } else {
        if (state.input.twistRight) groundTwistX += 1;
        if (state.input.twistLeft) groundTwistX -= 1;
        if (state.input.twistUp) groundTwistY += 1;
        if (state.input.twistDown) groundTwistY -= 1;
      }

      // VESC Remote Tilt: Up tilts nose up (-pitch), Down tilts nose down (+pitch)
      const targetRemoteTilt = -groundTwistY * 0.16;
      p.remoteTilt = THREE.MathUtils.lerp(p.remoteTilt || 0, targetRemoteTilt, dt * 10);

      p.pitch = THREE.MathUtils.lerp(p.pitch, slopePitch + riderPitch + p.remoteTilt, dt * 14);

      if (Math.abs(groundTwistX) > 0.05) {
        p.roll = THREE.MathUtils.lerp(p.roll, groundTwistX * 0.22, dt * 12);
        p.heading += -groundTwistX * 4.2 * dt;
      } else {
        p.roll = THREE.MathUtils.lerp(p.roll, p.roll * 0.75 + THREE.MathUtils.clamp(slopeRoll, -0.15, 0.15), dt * 8);
      }
    }

    // 5. Position Integration, Wall Collision & Boundary Clamping
    if (currentMapId === 'dust2') {
      const COLLISION_RADIUS = 0.36;

      // A. Forward velocity deflection (wall slide)
      const hSpeed = Math.hypot(p.vx, p.vz);
      if (hSpeed > 0.05) {
        const testDist = COLLISION_RADIUS + hSpeed * dt;
        const wallHit = checkDust2Wall(p.x, p.y, p.z, p.vx, p.vz, testDist);
        if (wallHit && wallHit.distance <= testDist) {
          const dot = p.vx * wallHit.normalX + p.vz * wallHit.normalZ;
          if (dot < 0) {
            // Deflect along wall surface
            p.vx -= dot * wallHit.normalX;
            p.vz -= dot * wallHit.normalZ;
            p.speed = Math.hypot(p.vx, p.vz) * 0.85;
          }
          if (wallHit.distance < COLLISION_RADIUS) {
            const push = COLLISION_RADIUS - wallHit.distance;
            p.x += wallHit.normalX * push;
            p.z += wallHit.normalZ * push;
            p.vx *= 0.4;
            p.vz *= 0.4;
            vFwd = 0;
          }
        }
      }

      // B. Independent Axis Collision (X and Z)
      let moveX = p.vx * dt;
      if (Math.abs(moveX) > 0.0001) {
        const dirX = Math.sign(moveX);
        const wallX = checkDust2Wall(p.x, p.y, p.z, dirX, 0, COLLISION_RADIUS + Math.abs(moveX));
        if (wallX && wallX.distance <= COLLISION_RADIUS + Math.abs(moveX)) {
          moveX = 0;
          p.vx = 0;
          vFwd = 0;
          if (wallX.distance < COLLISION_RADIUS) {
            p.x += (wallX.normalX > 0 ? 1 : -1) * (COLLISION_RADIUS - wallX.distance);
          }
        }
      }
      p.x += moveX;

      let moveZ = p.vz * dt;
      if (Math.abs(moveZ) > 0.0001) {
        const dirZ = Math.sign(moveZ);
        const wallZ = checkDust2Wall(p.x, p.y, p.z, 0, dirZ, COLLISION_RADIUS + Math.abs(moveZ));
        if (wallZ && wallZ.distance <= COLLISION_RADIUS + Math.abs(moveZ)) {
          moveZ = 0;
          p.vz = 0;
          vFwd = 0;
          if (wallZ.distance < COLLISION_RADIUS) {
            p.z += (wallZ.normalZ > 0 ? 1 : -1) * (COLLISION_RADIUS - wallZ.distance);
          }
        }
      }
      p.z += moveZ;

      // C. Stationary / turning nose probe to prevent rotating into walls
      const noseDirX = Math.sin(p.heading);
      const noseDirZ = Math.cos(p.heading);
      const noseWall = checkDust2Wall(p.x, p.y, p.z, noseDirX, noseDirZ, 0.38);
      if (noseWall && noseWall.distance < 0.38) {
        const push = 0.38 - noseWall.distance;
        p.x += noseWall.normalX * push * 0.5;
        p.z += noseWall.normalZ * push * 0.5;
      }

      // D. Dust 2 Mid Doors window alcove safety seal & Perimeter Clamping
      if ((p.z >= 7.8 && p.z <= 9.8) || (p.z >= 15.5 && p.z <= 17.5)) {
        if (p.x < -3.30 + COLLISION_RADIUS) {
          p.x = -3.30 + COLLISION_RADIUS;
          if (p.vx < 0) p.vx = 0;
        }
      }

      p.x = THREE.MathUtils.clamp(p.x, -37.5, 37.5);
      p.z = THREE.MathUtils.clamp(p.z, -44.0, 42.0);

      if (p.y < -15.0 || p.y > 60.0) {
        console.warn('[Dust 2] Player breached map boundary (y=' + p.y.toFixed(2) + '). Respawning.');
        respawnPlayer();
      }
    } else {
      // Classic Skatepark boundaries
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.x = THREE.MathUtils.clamp(p.x, -135, 135);
      p.z = THREE.MathUtils.clamp(p.z, -135, 135);
    }

    // 6. Vertical & Jump Physics
    handleObstaclesAndGround(dt);

    // Bunny Hop Jump Input
    if (state.input.jumpPressed && !p.isAirborne && !state.grind.active) {
      p.vy = JUMP_VELOCITY;
      p.isAirborne = true;
      p.airtime = 0;
      state.input.jumpPressed = false;
      state.aerial.airYaw = 0;
      state.aerial.airPitch = 0;
      state.aerial.spin180Done = false;
      state.aerial.spin360Done = false;
      state.aerial.flipDone = false;

      // Pop spin impulse if spin/steer input is active at takeoff
      let launchSpin = 0;
      if (state.input.twistRight) launchSpin += 1;
      if (state.input.twistLeft) launchSpin -= 1;
      if (state.input.rightJoystickActive) launchSpin += state.input.rightJoystickVector.x;
      if (state.input.right) launchSpin += 1;
      if (state.input.left) launchSpin -= 1;
      if (state.input.joystickActive) launchSpin += state.input.joystickVector.x;
      launchSpin = THREE.MathUtils.clamp(launchSpin, -1, 1);

      if (Math.abs(launchSpin) > 0.1) {
        const popImpulse = -launchSpin * 0.45; // ~26 deg initial pop snap
        p.heading += popImpulse;
        state.aerial.airYaw += popImpulse;
      }
    }

    // Airborne Gravity Simulation & Aerial Rigid-Body Rotation
    if (p.isAirborne) {
      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      p.airtime += dt;

      // In-Air Rigid Body+Board Aerial Rotation (Spins & Flips)
      if (!state.grind.active) {
        let twistX = 0;
        let twistY = 0;

        // 1. Horizontal Yaw Spin (180, 360): Controlled by Right Stick, Arrow Left/Right, Left Stick, or A/D
        if (state.input.rightJoystickActive && Math.abs(state.input.rightJoystickVector.x) > 0.05) {
          twistX = state.input.rightJoystickVector.x;
        } else if (state.input.twistRight || state.input.twistLeft) {
          if (state.input.twistRight) twistX += 1;
          if (state.input.twistLeft) twistX -= 1;
        } else if (state.input.joystickActive && Math.abs(state.input.joystickVector.x) > 0.05) {
          twistX = state.input.joystickVector.x;
        } else {
          if (state.input.right) twistX += 1;
          if (state.input.left) twistX -= 1;
        }

        // 2. Vertical Pitch Flips (Backflip / Frontflip):
        // Dedicated stunt controls: ONLY Right Stick Y or Arrow Up/Down.
        // Holding W (drive forward) or Left Stick Y will NEVER cause accidental flips!
        if (state.input.rightJoystickActive && Math.abs(state.input.rightJoystickVector.y) > 0.08) {
          twistY = state.input.rightJoystickVector.y;
        } else {
          if (state.input.twistUp) twistY += 1;
          if (state.input.twistDown) twistY -= 1;
        }

        // Horizontal Twist (Yaw Spin: 180, 360)
        if (Math.abs(twistX) > 0.05) {
          // Inverted so right rotates clockwise (right) and left rotates counter-clockwise (left)
          // Spin rate increased to 14.5 rad/s so full 180/360 spins can easily be executed during hops
          const spinDelta = -twistX * 14.5 * dt;
          p.heading += spinDelta;
          state.aerial.airYaw += spinDelta;

          if (!state.aerial.spin180Done && Math.abs(state.aerial.airYaw) >= Math.PI * 0.88) {
            state.aerial.spin180Done = true;
            showTrickToast('180 SPIN! +250 🔄');
          }
          if (!state.aerial.spin360Done && Math.abs(state.aerial.airYaw) >= Math.PI * 1.88) {
            state.aerial.spin360Done = true;
            showTrickToast('360 SPIN! +500 🌪️');
          }
        }

        // Vertical Twist (Pitch Flips: Backflip / Frontflip)
        if (Math.abs(twistY) > 0.05) {
          // Pulling down / stick back (twistY < 0): Backflip
          // Pushing up / stick forward (twistY > 0): Frontflip
          const flipDelta = -twistY * 7.5 * dt;
          p.pitch += flipDelta;
          state.aerial.airPitch += flipDelta;

          if (!state.aerial.flipDone) {
            if (state.aerial.airPitch >= Math.PI * 1.80) {
              state.aerial.flipDone = true;
              showTrickToast('BACKFLIP! +750 🌀');
            } else if (state.aerial.airPitch <= -Math.PI * 1.80) {
              state.aerial.flipDone = true;
              showTrickToast('FRONTFLIP! +750 🔄');
            }
          }
        }
      }

      // Landing check
      if (p.y <= p.groundY) {
        p.y = p.groundY;
        p.vy = 0;
        p.isAirborne = false;

        // Wrap pitch to [-PI, PI]
        while (p.pitch > Math.PI) p.pitch -= Math.PI * 2;
        while (p.pitch < -Math.PI) p.pitch += Math.PI * 2;

        if (Math.abs(p.pitch) > 1.25) {
          showTrickToast('SKETCHY LANDING! ⚠️');
          p.vx *= 0.55;
          p.vz *= 0.55;
        } else if (p.airtime > 0.45 && !state.aerial.spin180Done && !state.aerial.flipDone) {
          showTrickToast('BIG AIR! +150');
        }
        p.airtime = 0;
        state.aerial.airYaw = 0;
        state.aerial.airPitch = 0;
        state.aerial.spin180Done = false;
        state.aerial.spin360Done = false;
        state.aerial.flipDone = false;
      }
    } else {
      // Ground elevation clamping (NEVER sink below ground or ramps!)
      if (p.y < p.groundY) {
        p.y = p.groundY; // Solid contact: never sink below surface
      } else if (p.y > p.groundY + 0.22 && p.speed > 3.0) {
        // Rode off a drop or crest at speed: smoothly become airborne!
        p.isAirborne = true;
        p.vy = 0;
      } else {
        p.y = p.groundY;
      }
    }

    // 7. Update 3D Board Transforms
    boardGroup.position.set(p.x, p.y, p.z);
    boardGroup.rotation.y = p.heading;
    boardGroup.rotation.x = p.pitch;
    boardGroup.rotation.z = p.roll;

    // Spin tire along axle
    if (wheelMesh) {
      wheelMesh.rotateX((p.speed / TIRE_RADIUS) * dt);
    }

    // Update floating weapon model (idle hover bob + recoil recovery)
    if (boardWeaponGroup) {
      const now = performance.now() * 0.001;
      const hoverY = 0.38 + Math.sin(now * 3.5) * 0.012;
      boardWeaponGroup.position.y = hoverY;
      boardWeaponGroup.rotation.y = Math.sin(now * 2.0) * 0.035;

      if (combat.weaponRecoil > 0.001) {
        boardWeaponGroup.position.z = -combat.weaponRecoil;
        combat.weaponRecoil = THREE.MathUtils.lerp(combat.weaponRecoil, 0, dt * 18);
      } else {
        boardWeaponGroup.position.z = 0;
        combat.weaponRecoil = 0;
      }
    }

    // 8. Update Drop Shadow Decal
    shadowMesh.position.set(p.x, p.groundY + 0.018, p.z);
    shadowMesh.rotation.y = p.heading;
    const jumpHeight = Math.max(0, p.y - p.groundY);
    const shadowScale = THREE.MathUtils.clamp(1 - jumpHeight * 0.35, 0.45, 1.0);
    shadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
    shadowMesh.material.opacity = THREE.MathUtils.clamp(0.65 - jumpHeight * 0.25, 0.18, 0.65);

    // 9. Particles
    if (p.speed > 1.2 && !p.isAirborne) {
      if (Math.random() < 0.45) {
        const dustCol = getTerrainColor(p.x, p.z);
        emitDustParticle(p.x, p.groundY, p.z, dustCol);
      }
    }

    // 10. Check Current Zone
    checkCurrentZone();
  }

  // Handle Ground Elevation & Stunt Obstacle Collisions
  function handleObstaclesAndGround(dt) {
    const p = state.player;
    let targetGround = getSurfaceElevation(p.x, p.z);
    p.isGrinding = false;

    // Only process skatepark obstacles when on the classic park map
    if (currentMapId !== 'dust2') {
      for (const obs of state.obstacles) {
      const halfW = obs.width / 2;
      const halfL = obs.length / 2;

      // 1. KICKER RAMPS (Rotated local coordinate collision)
      if (obs.type === 'kicker') {
        const dx = p.x - obs.x;
        const dz = p.z - obs.z;
        const cosR = Math.cos(-obs.rotation);
        const sinR = Math.sin(-obs.rotation);
        const localX = dx * cosR + dz * sinR;
        const localZ = -dx * sinR + dz * cosR;

        if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfL) {
          // Entrance at localZ = +halfL, Lip at localZ = -halfL
          const ratio = THREE.MathUtils.clamp((halfL - localZ) / obs.length, 0, 1);
          const rampY = obs.baseY + Math.pow(ratio, 1.25) * obs.height;
          targetGround = Math.max(targetGround, rampY);

          if (ratio > 0.82 && p.speed > 2.8 && !p.isAirborne) {
            p.vy = JUMP_VELOCITY * 1.22;
            p.isAirborne = true;
            showTrickToast('KICKER POP! +200');
          }
        }
        continue;
      }
      // 2. BANKED RAMPS (Skate plaza banks & quarter returns)
      if (obs.type === 'bank_z') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((p.z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const bankY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          targetGround = Math.max(targetGround, bankY);
        }
        continue;
      }

      if (obs.type === 'bank_x') {
        const minX = Math.min(obs.xStart, obs.xEnd);
        const maxX = Math.max(obs.xStart, obs.xEnd);
        if (Math.abs(p.z - obs.z) <= obs.length / 2 && p.x >= minX && p.x <= maxX) {
          const ratio = THREE.MathUtils.clamp((p.x - obs.xStart) / (obs.xEnd - obs.xStart), 0, 1);
          const bankY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          targetGround = Math.max(targetGround, bankY);
        }
        continue;
      }

      // 3. FLAT DECKS & STAGING PLATFORMS
      if (obs.type === 'deck' || obs.type === 'megadrop_platform') {
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && Math.abs(p.z - obs.z) <= obs.length / 2) {
          targetGround = Math.max(targetGround, obs.height);
        }
        continue;
      }

      // 4. MEGA DROP STRUCTURE (Runway, Kicker, Landing)
      if (obs.type === 'megadrop_runway') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((p.z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const dropY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          targetGround = Math.max(targetGround, dropY);

          // Steep downhill gravity acceleration (South along +Z)
          if (!p.isAirborne) {
            p.vz += 26.0 * dt;
            p.speed = Math.hypot(p.vx, p.vz);
          }
        }
        continue;
      }

      if (obs.type === 'megadrop_kicker') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((p.z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const rampY = obs.yStart + Math.pow(ratio, 1.35) * (obs.yEnd - obs.yStart);
          targetGround = Math.max(targetGround, rampY);

          if (ratio > 0.82 && p.speed > 4.5 && !p.isAirborne) {
            p.vy = JUMP_VELOCITY * 1.9; // Massive mega launch impulse
            p.isAirborne = true;
            p.airtime = 0;
            state.aerial.airYaw = 0;
            state.aerial.airPitch = 0;
            state.aerial.spin180Done = false;
            state.aerial.spin360Done = false;
            state.aerial.flipDone = false;
            showTrickToast('MEGA DROP SUPER AIR! 🚀 +500');
          }
        }
        continue;
      }

      if (obs.type === 'megadrop_landing') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((p.z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const landY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          targetGround = Math.max(targetGround, landY);

          // Catch landing slope cleanly
          if (p.isAirborne && p.y <= landY + 0.4) {
            p.y = landY;
            p.vy = 0;
            p.isAirborne = false;
            p.vz += 8.0 * dt;
            p.speed = Math.hypot(p.vx, p.vz);
            showTrickToast('MEGA DROP LANDED! 🔥 +500');
          }
        }
        continue;
      }

      // 5. SLOPESTYLE & MOTOCROSS ROLL-IN CHUTES
      if (obs.type === 'slopestyle_rollin' || obs.type === 'mx_rollin') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((p.z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const rampY = obs.yStart + ratio * (obs.yEnd - obs.yStart);
          targetGround = Math.max(targetGround, rampY);

          // Downhill gravity acceleration along runway direction
          if (!p.isAirborne) {
            const dirZ = Math.sign(obs.zEnd - obs.zStart);
            p.vz += dirZ * (obs.accelForce || 24.0) * dt;
            p.speed = Math.hypot(p.vx, p.vz);
          }
        }
        continue;
      }

      // 6. LADDER STEP-UP
      if (obs.type === 'slopestyle_stepup') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const ratio = THREE.MathUtils.clamp((p.z - obs.zStart) / (obs.zEnd - obs.zStart), 0, 1);
          const rampY = obs.yStart + Math.pow(ratio, 1.25) * (obs.yEnd - obs.yStart);
          targetGround = Math.max(targetGround, rampY);

          if (ratio > 0.82 && p.speed > 3.0 && !p.isAirborne) {
            p.vy = JUMP_VELOCITY * 1.25;
            p.isAirborne = true;
            p.airtime = 0;
            state.aerial.airYaw = 0;
            state.aerial.airPitch = 0;
            state.aerial.spin180Done = false;
            state.aerial.spin360Done = false;
            state.aerial.flipDone = false;
            showTrickToast('LADDER STEP-UP POP! 🪵 +200');
          }
        }
        continue;
      }

      // 7. ELEVATED LOG BRIDGE
      if (obs.type === 'bridge') {
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && Math.abs(p.z - obs.z) <= (obs.length || 0) / 2) {
          targetGround = Math.max(targetGround, obs.height);
        }
        continue;
      }

      // 8. TIMBER WHALE TAIL
      if (obs.type === 'timber_whaletail') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const totalLen = Math.abs(obs.zStart - obs.zEnd);
          const run = obs.zStart > obs.zEnd ? (obs.zStart - p.z) : (p.z - obs.zStart);
          let spineY = obs.baseY;
          if (run < 4.5) {
            const t = run / 4.5;
            spineY += Math.pow(t, 1.25) * obs.height;
            if (t > 0.85 && p.speed > 3.5 && !p.isAirborne) {
              p.vy = JUMP_VELOCITY * 1.28;
              p.isAirborne = true;
              p.airtime = 0;
              showTrickToast('WHALE TAIL STEP-UP! 🚀');
            }
          } else if (run <= 9.5) {
            const archT = (run - 4.5) / 5.0;
            const arch = Math.sin(archT * Math.PI) * 0.35;
            spineY += obs.height + arch;
            if (p.speed > 2.5) {
              emitGrindSparks(p.x, spineY, p.z);
              showTrickToast('WHALE TAIL SPINE! +300');
            }
          } else {
            const dropT = (run - 9.5) / (totalLen - 9.5);
            spineY += (1 - dropT) * obs.height;
            if (!p.isAirborne && p.speed > 3.5 && dropT > 0.82) {
              p.vy = JUMP_VELOCITY * 1.35;
              p.isAirborne = true;
              p.airtime = 0;
              state.aerial.airYaw = 0;
              state.aerial.airPitch = 0;
              state.aerial.spin180Done = false;
              state.aerial.spin360Done = false;
              state.aerial.flipDone = false;
              showTrickToast('WHALE TAIL DROP LAUNCH! 🌀 +350');
            }
          }
          targetGround = Math.max(targetGround, spineY);
        }
        continue;
      }

      // 9. BANKED TIMBER WALLRIDE
      if (obs.type === 'wallride') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const bankT = THREE.MathUtils.clamp((p.x - (obs.x - obs.width / 2)) / obs.width, 0, 1);
          const wallY = obs.baseY + Math.pow(bankT, 1.3) * obs.height;
          targetGround = Math.max(targetGround, wallY);
          if (bankT > 0.65 && p.speed > 3.0) {
            emitGrindSparks(p.x, wallY, p.z);
            if (!p.wallToastTime || performance.now() - p.wallToastTime > 1200) {
              p.wallToastTime = performance.now();
              showTrickToast('TIMBER WALLRIDE! 🪵 +350');
            }
          }
        }
        continue;
      }

      // 10. MOTOCROSS RHYTHM WHOOPS
      if (obs.type === 'whoops') {
        const minZ = Math.min(obs.zStart, obs.zEnd);
        const maxZ = Math.max(obs.zStart, obs.zEnd);
        if (Math.abs(p.x - obs.x) <= obs.width / 2 && p.z >= minZ && p.z <= maxZ) {
          const totalLen = Math.abs(obs.zEnd - obs.zStart);
          const relZ = Math.abs(p.z - obs.zStart);
          const wavelength = totalLen / obs.count;
          const phase = (relZ / wavelength) * Math.PI * 2;
          const whoopY = obs.baseY + 0.55 + Math.sin(phase) * obs.height;
          targetGround = Math.max(targetGround, whoopY);

          // Skimming whoops rhythm boost
          if (Math.sin(phase) > 0.7 && p.speed > 7.0) {
            p.vz -= 9.0 * dt; // Forward pump impulse
            p.speed = Math.hypot(p.vx, p.vz);
            if (!p.whoopToastTime || performance.now() - p.whoopToastTime > 650) {
              p.whoopToastTime = performance.now();
              showTrickToast('WHOOP SKIM PUMP! ⚡ +150');
            }
          }
        }
        continue;
      }

      // 11. HIGH-BANKED BERM BOWL
      if (obs.type === 'berm_bowl') {
        const dist = Math.hypot(p.x - obs.x, p.z - obs.z);
        if (dist <= obs.radius) {
          const rimT = dist / obs.radius;
          const bermY = obs.baseY + Math.pow(rimT, 2.0) * obs.height;
          targetGround = Math.max(targetGround, bermY);
        }
        continue;
      }

      // Standard AABB overlap check for non-rotated obstacles
      const effectiveHalfW = obs.type === 'rail' ? 0.65 : halfW;
      const effectiveHalfL = obs.type === 'rail' ? halfL + 0.35 : halfL;
      if (
        p.x >= obs.x - effectiveHalfW &&
        p.x <= obs.x + effectiveHalfW &&
        p.z >= obs.z - effectiveHalfL &&
        p.z <= obs.z + effectiveHalfL
      ) {
        if (obs.type === 'tabletop') {
          const isSouthbound = obs.dir === -1 || (obs.zStart && obs.zStart > obs.zEnd);
          const startZ = isSouthbound ? (obs.zStart || (obs.z + halfL)) : (obs.z - halfL);
          const relRun = isSouthbound ? (startZ - p.z) : (p.z - startZ);
          if (relRun >= 0 && relRun <= obs.length) {
            let deckY = obs.baseY;
            if (relRun < obs.takeoffLen) {
              deckY += (relRun / obs.takeoffLen) * obs.height;
              if (relRun > obs.takeoffLen * 0.85 && p.speed > 3.8 && !p.isAirborne) {
                p.vy = JUMP_VELOCITY * 1.3;
                p.isAirborne = true;
                p.inTabletop = true;
                state.aerial.airYaw = 0;
                state.aerial.airPitch = 0;
                state.aerial.spin180Done = false;
                state.aerial.spin360Done = false;
                state.aerial.flipDone = false;
                showTrickToast('TABLETOP LAUNCH! 🚀');
              }
            } else if (relRun <= obs.takeoffLen + obs.deckLen) {
              deckY += obs.height;
              if (p.inTabletop) {
                showTrickToast('TABLETOP STOMP! +250');
                p.inTabletop = false;
              }
            } else {
              const landRatio = (relRun - obs.takeoffLen - obs.deckLen) / obs.landingLen;
              deckY += (1 - landRatio) * obs.height;
              if (p.inTabletop) {
                showTrickToast('TABLETOP CLEARED! +300');
                p.inTabletop = false;
              }
            }
            targetGround = Math.max(targetGround, deckY);
          }
        } else if (obs.type === 'gap_kicker') {
          const relZ = (p.z - obs.z);
          const ratio = obs.dir === -1
            ? THREE.MathUtils.clamp((halfL - relZ) / obs.length, 0, 1)
            : THREE.MathUtils.clamp((relZ + halfL) / obs.length, 0, 1);
          const rampY = obs.baseY + ratio * obs.height;
          targetGround = Math.max(targetGround, rampY);

          if (ratio > 0.85 && p.speed > 3.5 && !p.isAirborne) {
            p.vy = JUMP_VELOCITY * 1.45;
            p.isAirborne = true;
            p.inGap = true;
            state.aerial.airYaw = 0;
            state.aerial.airPitch = 0;
            state.aerial.spin180Done = false;
            state.aerial.spin360Done = false;
            state.aerial.flipDone = false;
            showTrickToast('GAP LAUNCH! 🚀 +350');
          }
        } else if (obs.type === 'gap_landing') {
          const relZ = (p.z - obs.z);
          const ratio = obs.dir === -1
            ? THREE.MathUtils.clamp((halfL - relZ) / obs.length, 0, 1)
            : THREE.MathUtils.clamp((relZ + halfL) / obs.length, 0, 1);
          const rampY = obs.baseY + (1 - ratio) * obs.height;
          targetGround = Math.max(targetGround, rampY);

          if (p.inGap && p.isAirborne && p.y <= rampY + 0.4) {
            p.inGap = false;
            showTrickToast('CANYON GAP CLEARED! 🔥 +500');
          }
        } else if (obs.type === 'whaletail') {
          const relRun = (obs.z + halfL) - p.z;
          if (relRun >= 0 && relRun <= obs.length) {
            let spineY = obs.baseY;
            if (relRun < 4.5) {
              spineY += (relRun / 4.5) * obs.height;
            } else if (relRun <= 10.5) {
              const arch = Math.sin(((relRun - 4.5) / 6.0) * Math.PI) * 0.35;
              spineY += obs.height + arch;
              if (p.speed > 2.5) {
                emitGrindSparks(p.x, spineY, p.z);
                showTrickToast('WHALE TAIL SPINE! +300');
              }
            } else {
              const dropRatio = (relRun - 10.5) / (obs.length - 10.5);
              spineY += (1 - dropRatio) * obs.height;
              if (!p.isAirborne && p.speed > 3.5 && dropRatio > 0.85) {
                p.vy = JUMP_VELOCITY * 1.25;
                p.isAirborne = true;
                state.aerial.airYaw = 0;
                state.aerial.airPitch = 0;
                state.aerial.spin180Done = false;
                state.aerial.spin360Done = false;
                state.aerial.flipDone = false;
                showTrickToast('WHALE TAIL DROP! +300');
              }
            }
            targetGround = Math.max(targetGround, spineY);
          }
        } else if (obs.type === 'rail') {
          if (p.y >= obs.height - 0.28 && p.y <= obs.height + 0.65) {
            targetGround = Math.max(targetGround, obs.height);

            // If not currently grinding, lock into rail
            if (!state.grind.active) {
              let twistY = 0;
              if (state.input.rightJoystickActive) {
                twistY = state.input.rightJoystickVector.y;
              } else {
                if (state.input.twistUp) twistY += 1;
                if (state.input.twistDown) twistY -= 1;
              }

              // Determine grind trick:
              // twistY > 0.2: Up / Noseslide
              // twistY < -0.2: Down / Tailslide
              // Cross angle: Boardslide
              // Neutral: 50-50
              let grindType = '50-50';
              if (twistY > 0.2) {
                grindType = 'noseslide';
              } else if (twistY < -0.2) {
                grindType = 'tailslide';
              } else if (Math.abs(Math.cos(p.heading)) < 0.65) {
                grindType = 'boardslide';
              }

              state.grind.active = true;
              state.grind.type = grindType;
              state.grind.balance = (Math.random() - 0.5) * 0.16;
              state.grind.balanceVel = (Math.random() - 0.5) * 0.35;
              state.grind.timer = 0;
              state.grind.railX = obs.x;
              state.grind.railMinZ = obs.z - halfL;
              state.grind.railMaxZ = obs.z + halfL;

              if (balanceHud) balanceHud.classList.add('active');
              if (balanceLabel) balanceLabel.textContent = grindType.toUpperCase();
              showTrickToast(`LOCKED: ${grindType.toUpperCase()}! 🔥`);
            }

            // Grind physics loop
            if (state.grind.active) {
              p.isGrinding = true;
              p.isAirborne = false;
              p.vy = 0;
              p.y = obs.height;
              state.grind.timer += dt;

              // Pull board smoothly onto rail line
              p.x = THREE.MathUtils.lerp(p.x, obs.x, dt * 18);

              // Maintain forward glide along the rail (never stall out)
              const grindSign = Math.sign(p.vz) || 1;
              const minGrindSpeed = 4.5;
              if (Math.abs(p.vz) < minGrindSpeed) {
                p.vz = grindSign * minGrindSpeed;
              }
              p.vx = THREE.MathUtils.lerp(p.vx, 0, dt * 10);
              p.speed = Math.hypot(p.vx, p.vz);

              // Trick-specific board pitch & spark emitter
              if (state.grind.type === 'noseslide') {
                // Nose rests down on rail, tail tilted up in air
                p.pitch = -0.26 + state.grind.balance * 0.12;
                emitGrindSparks(p.x, obs.height + 0.02, p.z - 0.36);
              } else if (state.grind.type === 'tailslide') {
                // Tail rests down on rail, nose tilted up in air
                p.pitch = 0.26 + state.grind.balance * 0.12;
                emitGrindSparks(p.x, obs.height + 0.02, p.z + 0.36);
              } else {
                // Boardslide or 50-50
                p.pitch = state.grind.balance * 0.14;
                emitGrindSparks(p.x, obs.height + 0.02, p.z);
              }

              // Balance mini-game drift simulation:
              // Natural instability pushes needle away from center
              state.grind.balanceVel += (state.grind.balance * 2.2 + (Math.random() - 0.5) * 1.4) * dt;
              // Mild damping
              state.grind.balanceVel *= (1.0 - 0.45 * dt);

              // Continuous correction from right joystick (mobile or gamepad)
              if (state.input.rightJoystickActive) {
                state.grind.balanceVel -= state.input.rightJoystickVector.y * 3.8 * dt;
              }

              // Integrate balance position
              state.grind.balance += state.grind.balanceVel * dt;

              // Update HUD Needle
              if (balanceNeedle) {
                const needleOffset = THREE.MathUtils.clamp(state.grind.balance, -1.2, 1.2) * 65;
                balanceNeedle.style.transform = `translateX(${needleOffset}px)`;
                if (Math.abs(state.grind.balance) > 0.6) {
                  balanceNeedle.classList.add('danger');
                } else {
                  balanceNeedle.classList.remove('danger');
                }
              }

              // 1. SLIP OFF RAIL (Bail if balance exceeds limits)
              if (Math.abs(state.grind.balance) > 1.0) {
                showTrickToast('SLIPPED OFF RAIL! 💥');
                state.grind.active = false;
                p.isGrinding = false;
                p.x += (state.grind.balance > 0 ? 0.42 : -0.42);
                p.vx = (state.grind.balance > 0 ? 2.0 : -2.0);
                if (balanceHud) balanceHud.classList.remove('active');
              }

              // 2. HOP OFF RAIL (Space / Hop button)
              if (state.input.jumpPressed) {
                state.input.jumpPressed = false;
                p.vy = JUMP_VELOCITY * 1.15;
                p.isAirborne = true;
                state.grind.active = false;
                p.isGrinding = false;
                if (balanceHud) balanceHud.classList.remove('active');
                const pts = Math.round(state.grind.timer * 160 + 250);
                showTrickToast(`${state.grind.type.toUpperCase()} POP-OFF! +${pts} 🛹`);
              }

              // 3. REACHED END OF RAIL (Dismount)
              if (p.z < obs.z - halfL - 0.25 || p.z > obs.z + halfL + 0.25) {
                state.grind.active = false;
                p.isGrinding = false;
                if (balanceHud) balanceHud.classList.remove('active');
                const pts = Math.round(state.grind.timer * 120 + 200);
                showTrickToast(`${state.grind.type.toUpperCase()} LANDED! +${pts} ✨`);
              }
            }
          }
        } else {
          // Ledges, curbs, boardwalks
          if (p.y >= obs.height - 0.15) {
            targetGround = Math.max(targetGround, obs.height);
          }
        }
      }
    }
    }

    // Clean up grind HUD if no longer grinding on any obstacle
    if (state.grind.active && !p.isGrinding) {
      state.grind.active = false;
      if (balanceHud) balanceHud.classList.remove('active');
    }

    // Multi-point ground clearance check to guarantee nose and tail bumpers never clip:
    const bumperDist = 0.38; // Distance from axle to bumper tip
    const noseX = p.x + Math.sin(p.heading) * bumperDist;
    const noseZ = p.z + Math.cos(p.heading) * bumperDist;
    const tailX = p.x - Math.sin(p.heading) * bumperDist;
    const tailZ = p.z - Math.cos(p.heading) * bumperDist;

    const hNose = getSurfaceElevation(noseX, noseZ);
    const hTail = getSurfaceElevation(tailX, tailZ);

    // Height offset of nose/tail relative to center axle:
    // With rotation order 'YXZ', pitch < 0 is nose up (+Y), tail down (-Y).
    const noseDeltaY = -Math.sin(p.pitch) * bumperDist;
    const tailDeltaY = Math.sin(p.pitch) * bumperDist;

    // Minimum center height so bumpers clear local ground by at least 0.055m
    const minCenterForNose = hNose - noseDeltaY + 0.055;
    const minCenterForTail = hTail - tailDeltaY + 0.055;

    if (currentMapId === 'dust2') {
      // On Dust 2, only adjust bumper height if nose and tail are on a gentle slope
      // (reject walls, curbs, or high ledges which would cause wall climbing)
      if (Math.abs(hNose - targetGround) <= 0.20 && Math.abs(hTail - targetGround) <= 0.20) {
        targetGround = Math.max(targetGround, minCenterForNose, minCenterForTail);
      }
    } else {
      targetGround = Math.max(targetGround, minCenterForNose, minCenterForTail);
    }
    p.groundY = targetGround;
  }

  // Terrain particle tint helper
  function getTerrainColor(x, z) {
    if (Math.abs(x) < 22 && Math.abs(z) < 22) return 0x94a3b8;
    if (z < -25) return 0x64748b;
    if (z > 25) return 0xc2410c;
    if (x > 25) return 0x854d0e;
    if (x < -25) return 0xea580c;
    return 0x94a3b8;
  }

  // Zone & Trailhead Entry Detection
  function checkCurrentZone() {
    const p = state.player;
    let newZone = 'Central Town Square';
    let newType = 'PLAZA';

    if (currentMapId === 'dust2') {
      if (p.z > 25) {
        newZone = 'T Spawn (Terrace)';
        newType = 'ATTACKER BASE';
      } else if (p.z < -30 && p.x < -10) {
        newZone = 'CT Spawn';
        newType = 'DEFENDER BASE';
      } else if (p.x > 20 && p.z < -10) {
        newZone = 'A Bomb Site';
        newType = 'OBJECTIVE A';
      } else if (p.x < -20 && p.z < -10) {
        newZone = 'B Bomb Site';
        newType = 'OBJECTIVE B';
      } else if (p.x > 15 && p.z >= -10 && p.z <= 30) {
        newZone = 'Long A';
        newType = 'TACTICAL LANE';
      } else if (Math.abs(p.x) <= 10 && p.z >= 0 && p.z <= 30) {
        newZone = 'Mid Doors';
        newType = 'MIDDLE CROSS';
      } else if (p.x < -10 && p.z >= -10 && p.z <= 20) {
        newZone = 'B Tunnels';
        newType = 'TUNNELS';
      } else {
        newZone = 'Dust 2 Courtyard';
        newType = 'FREE ROAM';
      }
    } else {
      if (Math.abs(p.x) < 24 && Math.abs(p.z) < 24) {
        newZone = 'Central Town Square';
        newType = 'PLAZA';
      } else if (Math.abs(p.x - 55) < 14 && p.z >= -26 && p.z <= 46) {
        newZone = 'Pine Ridge Slopestyle';
        newType = 'RED BULL SLOPESTYLE';
      } else if (Math.abs(p.x - (-58)) < 14 && p.z >= -26 && p.z <= 46) {
        newZone = 'Slickrock Motocross';
        newType = 'MOTOCROSS MX';
      } else if (p.z < -26 && Math.abs(p.x) < Math.abs(p.z) * 1.5) {
        newZone = 'Thunder Peak';
        newType = 'JUMP LINE';
      } else if (p.z > 26 && Math.abs(p.x) < Math.abs(p.z) * 1.5) {
        newZone = 'Cactus Canyon';
        newType = 'CHILL TRAIL';
      } else if (p.x > 26 && Math.abs(p.z) < Math.abs(p.x) * 1.5) {
        newZone = 'Pine Ridge';
        newType = 'CHILL TRAIL';
      } else if (p.x < -26 && Math.abs(p.z) < Math.abs(p.x) * 1.5) {
        newZone = 'Slickrock Bluff';
        newType = 'JUMP LINE';
      }
    }

    if (newZone !== p.currentZone) {
      p.currentZone = newZone;
      p.zoneType = newType;
      triggerZoneToast(newZone, newType);
      if (hudTerrainVal) hudTerrainVal.textContent = newZone;
    }
  }

  let toastTimeout = null;
  function triggerZoneToast(name, badge) {
    if (!areaToast || !areaBadge || !areaName) return;
    areaName.textContent = name;
    areaBadge.textContent = badge;
    areaBadge.className = 'exp9-area-badge ' + (badge.includes('JUMP') || badge.includes('SLOPESTYLE') || badge.includes('MOTOCROSS') ? 'badge-jump' : 'badge-chill');

    areaToast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      areaToast.classList.remove('visible');
    }, 3200);
  }

  let trickTimeout = null;
  function showTrickToast(text) {
    if (!trickToast || !trickText) return;
    trickText.textContent = text;
    trickToast.classList.add('visible');
    clearTimeout(trickTimeout);
    trickTimeout = setTimeout(() => {
      trickToast.classList.remove('visible');
    }, 1400);

    if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.onTrickLanded) {
      window.GamerWheelsMultiplayer.onTrickLanded(text);
    }
  }

  // Camera Wall Occlusion Raycaster (Spring-Arm Obstacle Collision Zoom)
  const _camOcclusionRay = new THREE.Raycaster();
  const _camRayOrigin = new THREE.Vector3();
  const _camRayDir = new THREE.Vector3();

  // ==========================================================================
  // 11. Camera Tracking & HUD Updates
  // ==========================================================================
  function updateCamera(dt) {
    if (!camera) return;
    const p = state.player;
    const cs = state.camera;
    const delta = dt || 0.016;

    // 1. Intelligent Velocity-Vector Auto-Chase Camera
    // Follows the rider's MOVEMENT VECTOR (travel velocity vx, vz), NEVER the board's rotational heading!
    // When airborne (jumping, 180s, 360s, flips), camera yaw remains completely steady along jump momentum!
    const isLocked = (document.pointerLockElement === container || (canvas && document.pointerLockElement === canvas));

    if (isLocked) {
      // In tactical pointer lock aim mode: camera direction is strictly locked to mouse!
    } else if (cs.manualTimer > 0) {
      cs.manualTimer -= delta;
    } else if (!p.isAirborne && p.speed > 1.2) {
      const travelHeading = Math.atan2(p.vx, p.vz);
      const behindTravel = travelHeading + Math.PI;
      let yawDiff = behindTravel - cs.yaw;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      cs.yaw += yawDiff * Math.min(1.0, delta * 1.8); // Slower chase = less sticky
    }

    // Normalize camera yaw to [-PI, PI]
    while (cs.yaw < -Math.PI) cs.yaw += Math.PI * 2;
    while (cs.yaw > Math.PI) cs.yaw -= Math.PI * 2;

    // 3. Smooth Camera Distance Interpolation
    cs.distance = THREE.MathUtils.lerp(cs.distance, cs.targetDistance, delta * 8);

    // 4. Dynamic Speed FOV Pullback or Tactical Scope Zoom
    const speedRatio = THREE.MathUtils.clamp((p.speed - 8.0) / 18.0, 0, 1.0);
    let targetFov;
    if (combat && combat.scopeLevel > 0) {
      targetFov = combat.scopedTargetFov || 28;
    } else {
      targetFov = 65 + speedRatio * 12; // 65° base up to 77° at top speed
    }
    const fovLerpSpeed = (combat && combat.scopeLevel > 0) ? 22 : 6;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * fovLerpSpeed);
      camera.updateProjectionMatrix();
    }

    // 5. Tactical Third-Person Shooter Camera with Down-Range Aiming
    const targetX = p.x;
    const targetY = p.y + 0.90;
    const targetZ = p.z;

    const isScoped = combat && combat.scopeLevel > 0;

    // Unit aim direction from camera yaw and pitch
    const cosPitch = Math.cos(cs.pitch);
    const fwdX = -Math.sin(cs.yaw) * cosPitch;
    const fwdY = -Math.sin(cs.pitch);
    const fwdZ = -Math.cos(cs.yaw) * cosPitch;

    // Horizontal right vector perpendicular to yaw
    const rightX = Math.cos(cs.yaw);
    const rightZ = -Math.sin(cs.yaw);

    // Over-the-shoulder offset: scales to 0 at close range (enabling first-person view)
    const distFactor = THREE.MathUtils.clamp((cs.distance - 0.3) / 2.5, 0, 1);
    const shoulderRight = isScoped ? 0.08 : (0.44 * distFactor);
    const shoulderUp = isScoped ? 0.06 : (0.22 * distFactor);
    const effDist = isScoped ? 1.3 : (cs.distance + speedRatio * 0.9);

    // Hide boardGroup when nearly first-person to avoid clipping
    if (boardGroup) {
      const fpThreshold = 0.5;
      const boardVisible = cs.distance > fpThreshold;
      boardGroup.visible = boardVisible;
    }

    // Camera desired position behind rider
    const desiredCamX = targetX - fwdX * effDist + rightX * shoulderRight;
    const desiredCamY = targetY - fwdY * effDist + shoulderUp;
    const desiredCamZ = targetZ - fwdZ * effDist + rightZ * shoulderRight;

    // 5b. Smart Wall Occlusion Zoom (Spring-Arm Camera Collision)
    _camRayOrigin.set(targetX, targetY, targetZ);
    _camRayDir.set(desiredCamX - targetX, desiredCamY - targetY, desiredCamZ - targetZ);
    const fullCamDist = _camRayDir.length();
    let actualCamDist = fullCamDist;

    if (fullCamDist > 0.1) {
      _camRayDir.normalize();
      _camOcclusionRay.set(_camRayOrigin, _camRayDir);
      _camOcclusionRay.far = fullCamDist;

      const colliders = (currentMapId === 'dust2' && dust2WalkMeshes && dust2WalkMeshes.length > 0)
        ? dust2WalkMeshes
        : (state.obstacles && state.obstacles.length > 0 ? state.obstacles : []);

      if (colliders.length > 0) {
        const hits = _camOcclusionRay.intersectObjects(colliders, false);
        if (hits && hits.length > 0) {
          for (let i = 0; i < hits.length; i++) {
            if (hits[i].distance > 0.35) {
              const safeClearance = 0.30;
              actualCamDist = Math.max(0.55, hits[i].distance - safeClearance);
              break;
            }
          }
        }
      }
    }

    // Calculate actual camera coordinates along view ray
    const finalCamX = targetX + _camRayDir.x * actualCamDist;
    let finalCamY = targetY + _camRayDir.y * actualCamDist;
    const finalCamZ = targetZ + _camRayDir.z * actualCamDist;

    // Prevent camera from clipping beneath terrain elevation
    const terrainH = getSurfaceElevation(finalCamX, finalCamZ);
    finalCamY = Math.max(finalCamY, terrainH + 0.35);

    const isOccluded = (actualCamDist < fullCamDist - 0.12);
    const lerpRate = isOccluded ? 0.80 : 0.38;

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, finalCamX, lerpRate);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, finalCamY, lerpRate);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, finalCamZ, lerpRate);

    // Aim down-range along forward vector! (Crosshair at screen center aims 60m ahead down range, rider in lower-left)
    const aimDist = 60.0;
    const lookTargetX = targetX + fwdX * aimDist;
    const lookTargetY = targetY + fwdY * aimDist;
    const lookTargetZ = targetZ + fwdZ * aimDist;
    camera.lookAt(lookTargetX, lookTargetY, lookTargetZ);

    // 6. Follow Sun Light Target
    if (sunLight) {
      sunLight.position.set(p.x + 35, p.y + 60, p.z + 25);
      sunLight.target.position.set(p.x, p.y, p.z);
    }
  }

  function updateCameraProjection() {
    if (!container || !camera) return;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function updateHUD() {
    const p = state.player;

    // Speed in MPH
    const mph = (p.speed * 2.23694).toFixed(1);
    if (hudSpeedVal) hudSpeedVal.textContent = mph;

    if (hudSpeedBar) {
      const pct = Math.min(100, (p.speed / getMapMaxSpeed()) * 100);
      hudSpeedBar.style.width = pct + '%';
    }

    // Compass pointing back to town square center (0, 0) relative to 3D camera
    if (compassArrow && compassDist) {
      const dist = Math.hypot(p.x, p.z).toFixed(0);
      compassDist.textContent = dist + 'm';

      const toOriginAngle = Math.atan2(-p.x, -p.z);
      const screenAngle = (toOriginAngle - state.camera.yaw) * (180 / Math.PI);
      compassArrow.style.transform = `rotate(${screenAngle}deg)`;
    }
  }

  // ==========================================================================
  // 12. Resize & Fullscreen
  // ==========================================================================
  function onWindowResize() {
    if (!container || !renderer || !camera) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    updateCameraProjection();
    renderer.setSize(width, height);
  }

  function toggleFullscreen() {
    const doc = document;
    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;

    if (!isFs) {
      const el = container || doc.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch((err) => {
          console.warn('Fullscreen error:', err);
        });
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else if (el.msRequestFullscreen) {
        el.msRequestFullscreen();
      }
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch((err) => {
          console.warn('Exit fullscreen error:', err);
        });
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    }
  }

  // ==========================================================================
  // 13. Main Animation Loop
  // ==========================================================================
  function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(state.clock.getDelta(), 0.05);

    updatePhysics(dt);
    updateTacticalCombat(dt);
    updateParticles(dt);
    updateCamera(dt);
    updateHUD();

    if (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.onGameTick) {
      window.GamerWheelsMultiplayer.onGameTick(dt, state.player);
    }

    // Update Floating Damage Text Popups
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.life -= dt;
      ft.sprite.position.y += dt * 0.8;
      const alpha = Math.max(0, ft.life / ft.maxLife);
      ft.sprite.material.opacity = alpha;
      if (ft.life <= 0) {
        scene.remove(ft.sprite);
        ft.tex.dispose();
        ft.sprite.material.dispose();
        floatingTexts.splice(i, 1);
      }
    }

    renderer.render(scene, camera);
  }


  // Export GamerWheels Engine API for Multiplayer & UI
  window.GamerWheels = {
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get player() { return state.player; },
    get TIRE_RADIUS() { return TIRE_RADIUS; },
    get MAX_SPEED() { return getMapMaxSpeed(); },
    CHECKPOINTS,
    teleportToCheckpoint,
    showTrickToast,
    switchMap,
    handleTacticalMatchStart,
    openBuyMenu,
    closeBuyMenu,
    toggleBuyMenu,
    fireCurrentWeapon,
    getPlayerTeam: () => combat.team,
    onTeamAssigned(data) {
      if (!data) return;
      combat.team = data.team || 'T';
      combat.hasBomb = !!data.hasBomb;
      updateTeamHUD();

      if (combat.team === 'CT') {
        combat.equippedSecondary = { ...WEAPON_ARSENAL.pistols[1], ammoInMag: 12, ammoInReserve: 24 };
        showTrickToast('TEAM ASSIGNED: COUNTER-TERRORISTS (CT) 🛡️');
      } else {
        combat.equippedSecondary = { ...WEAPON_ARSENAL.pistols[0], ammoInMag: 20, ammoInReserve: 120 };
        showTrickToast('TEAM ASSIGNED: TERRORISTS (T) 💣');
      }
      updateWeaponHUD();
      updateEquippedWeaponModel();
    },
    onDamageTaken(data) {
      combat.hp = Math.max(0, Number(data.hp) || 0);
      if (data.armor !== undefined) combat.gear.armor = Math.max(0, Number(data.armor));
      updateVitalsHUD();

      const vignette = document.getElementById('damageVignette');
      if (vignette) {
        vignette.classList.add('flash');
        setTimeout(() => vignette.classList.remove('flash'), 180);
      }

      state.camera.pitch = Math.min(1.25, state.camera.pitch + (Math.random() - 0.5) * 0.04);
      state.camera.yaw += (Math.random() - 0.5) * 0.04;
      playPainSound();
    },
    onDamageDealt(data) {
      flashCrosshairHitmarker(data.isHeadshot);
      playHitSound(data.isHeadshot);
      if (data.hitPoint) {
        spawnFloatingDamageText(data.hitPoint, data.damage, data.isHeadshot);
      }
    },
    onPlayerHealthUpdate(data) {
      const selfId = (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.getSelfId)
        ? window.GamerWheelsMultiplayer.getSelfId()
        : null;
      if (selfId && data.id === selfId) {
        combat.hp = data.hp;
        combat.gear.armor = data.armor;
        updateVitalsHUD();
      }
    },
    onPlayerKilled(data) {
      const killfeed = document.getElementById('killfeed');
      if (killfeed) {
        const entry = document.createElement('div');
        entry.className = 'exp9-kill-entry';
        entry.innerHTML = `
          <span class="exp9-kill-killer">${data.killerName || 'Killer'}</span>
          <span class="exp9-kill-weapon">🔫 ${String(data.weaponId || '').toUpperCase()}</span>
          ${data.isHeadshot ? '<span class="exp9-kill-hs">🎯 HEADSHOT</span>' : ''}
          <span class="exp9-kill-victim">${data.victimName || 'Victim'}</span>
        `;
        killfeed.appendChild(entry);
        setTimeout(() => entry.remove(), 4500);
      }

      const selfId = (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.getSelfId)
        ? window.GamerWheelsMultiplayer.getSelfId()
        : null;

      if (selfId && data.victimId === selfId) {
        combat.isAlive = false;
        combat.hp = 0;
        updateVitalsHUD();

        const deathOverlay = document.getElementById('deathOverlay');
        const deathTitle = document.getElementById('deathTitle');
        const deathTimer = document.getElementById('deathTimer');

        if (deathTitle) deathTitle.textContent = `ELIMINATED BY ${data.killerName ? data.killerName.toUpperCase() : 'ENEMY'}`;
        if (deathOverlay) {
          deathOverlay.style.display = 'flex';
          deathOverlay.classList.remove('hidden');
        }

        let remaining = 3;
        if (deathTimer) deathTimer.textContent = remaining;
        const cd = setInterval(() => {
          remaining--;
          if (deathTimer) deathTimer.textContent = Math.max(0, remaining);
          if (remaining <= 0) clearInterval(cd);
        }, 1000);
      } else if (selfId && data.killerId === selfId) {
        combat.cash += 300;
        updateBuyMenuCash();
        updateWeaponHUD();
        showTrickToast(`🏆 ELIMINATED ${data.victimName.toUpperCase()}! (+$300)`);
        playCashSound();
      }
    },
    onPlayerRespawned(data) {
      const selfId = (window.GamerWheelsMultiplayer && window.GamerWheelsMultiplayer.getSelfId)
        ? window.GamerWheelsMultiplayer.getSelfId()
        : null;

      if (selfId && data.id === selfId) {
        combat.isAlive = true;
        combat.hp = 100;
        combat.gear.armor = 100;
        updateVitalsHUD();

        const deathOverlay = document.getElementById('deathOverlay');
        if (deathOverlay) {
          deathOverlay.style.display = 'none';
          deathOverlay.classList.add('hidden');
        }

        if (combat.team === 'CT') {
          teleportToCheckpoint(1);
        } else {
          teleportToCheckpoint(0);
        }
        showTrickToast('RESPAWNED! READY FOR ACTION ⚡');
      }
    },
    onRemotePlayerFired(data) {
      if (data.origin && data.target) {
        createBulletTracer(
          new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z),
          new THREE.Vector3(data.target.x, data.target.y, data.target.z)
        );
        playGunshotSound(data.soundType || 'rifle');
      }
    },
    onMapStateUpdate(mapState) {
      if (currentMapId !== 'dust2') return;
      const matchBanner = document.getElementById('matchBanner');
      const matchModeText = document.getElementById('matchModeText');
      const matchStatusMsg = document.getElementById('matchStatusMsg');
      const readyCountBadge = document.getElementById('readyCountBadge');
      const btnReadyUp = document.getElementById('btnReadyUp');

      const minReq = mapState.minPlayersToStart || mapState.minRequired || (mapState.isSolo ? 1 : 2);
      const readyNum = mapState.readyCount !== undefined ? mapState.readyCount : 0;
      if (readyCountBadge) readyCountBadge.textContent = `${readyNum}/${minReq}`;
      if (btnReadyUp && mapState.isReady !== undefined) {
        btnReadyUp.classList.toggle('ready', mapState.isReady);
      }

      const btnForceStart = document.getElementById('btnForceStart');
      const btnEndMatch = document.getElementById('btnEndMatch');

      const wasInMatch = (lastTacticalMatchMode === 'match' || lastTacticalMatchMode === 'tactical');
      const isNowInMatch = (mapState.mode === 'match' || mapState.mode === 'tactical');

      if (isNowInMatch) {
        if (matchBanner) matchBanner.classList.add('tactical');
        if (matchModeText) matchModeText.textContent = 'TACTICAL MATCH';
        if (matchStatusMsg) matchStatusMsg.textContent = 'OBJECTIVE: Plant / Defuse C4';
        if (btnForceStart) btnForceStart.classList.add('hidden');
        if (btnReadyUp) btnReadyUp.classList.add('hidden');
        if (btnEndMatch) btnEndMatch.classList.remove('hidden');
        if (!wasInMatch) {
          handleTacticalMatchStart(mapState);
        }
      } else if (mapState.mode === 'countdown') {
        if (matchBanner) matchBanner.classList.remove('tactical');
        if (matchModeText) matchModeText.textContent = 'STARTING...';
        if (matchStatusMsg) matchStatusMsg.textContent = `Match starting in ${mapState.countdown}s...`;
        if (btnForceStart) btnForceStart.classList.remove('hidden');
        if (btnReadyUp) btnReadyUp.classList.remove('hidden');
        if (btnEndMatch) btnEndMatch.classList.add('hidden');
      } else {
        if (matchBanner) matchBanner.classList.remove('tactical');
        if (matchModeText) matchModeText.textContent = 'FREE ROAM';
        if (matchStatusMsg) {
          matchStatusMsg.textContent = 'Ready up or click START MATCH to begin';
        }
        if (btnForceStart) btnForceStart.classList.remove('hidden');
        if (btnReadyUp) btnReadyUp.classList.remove('hidden');
        if (btnEndMatch) btnEndMatch.classList.add('hidden');
      }
      lastTacticalMatchMode = mapState.mode;
    },
    onC4Planted(data) {
      spawnC4InWorld(data.x, data.y, data.z, data.site);
      const bombPill = document.getElementById('bombActivePill');
      const bombTimerLabel = document.getElementById('bombTimerLabel');
      if (bombPill) bombPill.classList.remove('hidden');
      if (bombTimerLabel) bombTimerLabel.textContent = `💣 C4 ARMED AT SITE ${data.site}: ${data.remaining}s`;
      playBombBeepSound(1200);
      showTrickToast(`⚠️ BOMB PLANTED AT SITE ${data.site}! 45s REMAINING`);
    },
    onC4Tick(data) {
      const bombTimerLabel = document.getElementById('bombTimerLabel');
      if (bombTimerLabel) bombTimerLabel.textContent = `💣 C4 ARMED AT SITE ${data.site}: ${data.remaining}s`;
      if (c4BlinkLight) {
        c4BlinkLight.intensity = 4.5;
        setTimeout(() => { if (c4BlinkLight) c4BlinkLight.intensity = 0.5; }, 90);
      }
      playBombBeepSound(data.remaining < 10 ? 1500 : 1000);
    },
    onC4Exploded(data) {
      playExplosionSound();
      state.camera.pitch = Math.min(1.2, state.camera.pitch + 0.08);
      emitSparkBurst(data.x || 0, (data.y || 0) + 1.0, data.z || 0);
      emitSparkBurst(data.x || 0, (data.y || 0) + 2.0, data.z || 0);
      if (c4Mesh) {
        scene.remove(c4Mesh);
        c4Mesh = null;
        c4BlinkLight = null;
      }
      const bombPill = document.getElementById('bombActivePill');
      if (bombPill) bombPill.classList.add('hidden');
      combat.bombPlanted = false;
      combat.cash += 1000;
      updateBuyMenuCash();
      showTrickToast(`💥 C4 DETONATED AT SITE ${data.site}! TERRORISTS WIN! (+1000 PTS)`);
    },
    setPlayerRailColor(hexColor) {
      const colorNum = typeof hexColor === 'string' ? parseInt(hexColor.replace('#', '0x')) : hexColor;
      if (boardGroup) {
        boardGroup.traverse((child) => {
          if (child.isMesh && child.material && child.geometry && child.geometry.type === 'BoxGeometry') {
            // Check if it's the CNC rails
            if (child.position.x !== 0) {
              child.material.color.setHex(colorNum);
            }
          }
        });
      }
    },
    createBoardMesh(railColor = 0xef233c) {
      const colorNum = typeof railColor === 'string' ? parseInt(railColor.replace('#', '0x')) : railColor;
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';

      // Tire
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

      // CNC Rails (Custom Color)
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

      // Headlight LED
      const frontLensGeo = new THREE.BoxGeometry(0.18, 0.02, 0.02);
      const frontLens = new THREE.Mesh(
        frontLensGeo,
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.1 })
      );
      frontLens.position.set(0, TIRE_RADIUS + 0.015, 0.345);
      group.add(frontLens);

      // Taillight LED
      const rearLensGeo = new THREE.BoxGeometry(0.18, 0.02, 0.02);
      const rearLens = new THREE.Mesh(
        rearLensGeo,
        new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff1616, emissiveIntensity: 1.8, roughness: 0.15 })
      );
      rearLens.position.set(0, TIRE_RADIUS + 0.015, -0.345);
      group.add(rearLens);

      // Drop shadow decal
      const shadowGeo = new THREE.PlaneGeometry(0.52, 0.96);
      shadowGeo.rotateX(-Math.PI / 2);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x020617,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);

      return { group, wheel, shadow, railMat };
    }
  };

})();
