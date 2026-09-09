/**
 * CommunityMapLoader - Loads converted THPS .glb maps into the GamerWheels Three.js scene.
 * Author: Quinn Foster
 * Version: 1.0
 *
 * Integrates with the existing game's obstacle/physics system:
 * - Automatically registers obstacle colliders with the game's getSurfaceElevation system
 * - Detects grind rails via mesh names/custom properties
 * - Handles platform/ramp/gap classification
 * - Provides raycast-based precise surface elevation for imported geometry
 */

(function (global) {
  'use strict';

  const THREE = global.THREE;

  class CommunityMapLoader {
    /**
     * @param {THREE.Scene} scene - The Three.js scene to add maps to
     * @param {Function} registerObstacleFn - The game's registerObstacle function
     * @param {Function} getTerrainElevationFn - The game's getTerrainElevation function
     */
    constructor(scene, registerObstacleFn, getTerrainElevationFn) {
      this.scene = scene;
      this.registerObstacle = registerObstacleFn || (() => {});
      this.getTerrainElevation = getTerrainElevationFn || (() => 0);
      this.loadedMaps = new Map();
      this.raycaster = new THREE.Raycaster();
      this._rayDebugOrigin = new THREE.Vector3();
      this._rayDebugDir = new THREE.Vector3(0, -1, 0);
    }

    /**
     * Load a community map .glb file
     * @param {string} mapName - Name of the map (without .glb extension)
     * @param {object} options - { position, rotation, scale, onProgress }
     * @returns {Promise<object>} Map data containing root scene and metadata
     */
    async loadMap(mapName, options = {}) {
      const url = `assets/maps/${mapName}.glb`;

      if (this.loadedMaps.has(mapName)) {
        console.log(`🗺️ Map ${mapName} already loaded`);
        return this.loadedMaps.get(mapName);
      }

      const loader = global.GLTFLoader || this.getGLTFLoader();

      return new Promise((resolve, reject) => {
        loader.load(
          url,
          (gltf) => {
            try {
              const mapData = this.onMapLoaded(gltf, mapName, options);
              resolve(mapData);
            } catch (e) {
              reject(e);
            }
          },
          (progress) => {
            if (options.onProgress) {
              options.onProgress(progress.loaded / progress.total);
            }
          },
          (error) => {
            console.error(`❌ Failed to load map ${mapName}:`, error);
            reject(error);
          }
        );
      });
    }

    /**
     * Get GLTFLoader instance (falls back to global or creates one)
     */
    getGLTFLoader() {
      if (global.THREE && global.THREE.GLTFLoader) {
        return new global.THREE.GLTFLoader();
      }
      // If not available, throw informative error
      throw new Error('GLTFLoader not available. Import it from three/examples/jsm/loaders/GLTFLoader.js');
    }

    onMapLoaded(gltf, mapName, options) {
      const mapRoot = gltf.scene;
      mapRoot.name = `CommunityMap_${mapName}`;

      // Apply global transform if needed
      if (options.position) mapRoot.position.copy(options.position);
      if (options.rotation) mapRoot.rotation.set(...options.rotation);
      if (options.scale) mapRoot.scale.setScalar(options.scale);

      // Apply extra data from GLTF (if present)
      if (gltf.parser && gltf.parser.json && gltf.parser.json.asset) {
        console.log(`   Map generator: ${gltf.parser.json.asset.generator || 'unknown'}`);
      }

      // Process all meshes
      const processed = {
        rails: 0,
        ramps: 0,
        gaps: 0,
        statics: 0,
        totalMeshes: 0,
      };

      // First pass: compute world bounds for proper orientation/scaling
      const bbox = new THREE.Box3().setFromObject(mapRoot);
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());

      console.log(`   Map bounds: ${size.x.toFixed(1)}m x ${size.y.toFixed(1)}m x ${size.z.toFixed(1)}m`);

      // Optionally auto-center the map on scene origin
      if (options.autoCenter !== false) {
        mapRoot.position.sub(center);
        mapRoot.position.y = 0;
      }

      // Second pass: process meshes
      mapRoot.traverse((child) => {
        if (child.isMesh) {
          processed.totalMeshes++;
          const classification = this.processMesh(child, mapName);
          if (classification === 'rail') processed.rails++;
          else if (classification === 'ramp') processed.ramps++;
          else if (classification === 'gap') processed.gaps++;
          else processed.statics++;
        }
      });

      // Add to scene
      this.scene.add(mapRoot);

      // Store reference
      const mapData = {
        root: mapRoot,
        gltf,
        name: mapName,
        bounds: { center, size },
        stats: processed,
        loadedAt: Date.now(),
      };
      this.loadedMaps.set(mapName, mapData);

      console.log(`🗺️ Community map "${mapName}" loaded!`);
      console.log(`   ${processed.totalMeshes} meshes (${processed.rails} rails, ${processed.ramps} ramps, ${processed.gaps} gaps, ${processed.statics} static)`);

      return mapData;
    }

    /**
     * Process an individual mesh for game integration
     * @returns {string} Classification: 'rail', 'ramp', 'gap', or 'static'
     */
    processMesh(mesh, mapName) {
      // 1. Enable shadows
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // 2. Ensure materials are web-optimized
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => this.optimizeMaterial(m));
      } else if (mesh.material) {
        this.optimizeMaterial(mesh.material);
      }

      // 3. Detect special objects via name or custom properties
      const name = (mesh.name || '').toLowerCase();
      const userData = mesh.userData || {};

      // Embedded map metadata (from Blender custom properties through GLTF extras)
      const collisionType = userData.collisionType ||
        (userData.customData && userData.customData.collisionType);

      // Grind rails
      if (name.includes('rail') || name.includes('grind') || collisionType === 'rail') {
        this.registerGrindRail(mesh);
        return 'rail';
      }

      // Ramps/kickers/transitions
      if (
        name.includes('ramp') || name.includes('kicker') ||
        name.includes('quarter') || name.includes('bank') ||
        name.includes('wedge') || name.includes('tabletop') ||
        collisionType === 'ramp'
      ) {
        this.registerRampCollider(mesh);
        return 'ramp';
      }

      // Gaps
      if (name.includes('gap') || collisionType === 'gap') {
        this.registerGapTrigger(mesh);
        return 'gap';
      }

      // Decks/platforms
      if (
        name.includes('deck') || name.includes('platform') ||
        name.includes('pad') || name.includes('box') ||
        collisionType === 'deck'
      ) {
        this.registerDeckCollider(mesh);
        return 'deck';
      }

      // Generic static collision
      this.registerStaticCollider(mesh);
      return 'static';
    }

    optimizeMaterial(material) {
      if (!material) return;
      // Ensure proper settings for web
      material.side = THREE.DoubleSide;

      // Optimize texture settings
      if (material.map) {
        try {
          material.map.colorSpace = THREE.SRGBColorSpace;
        } catch (e) {
          // Older Three.js versions may not support colorSpace
        }
      }

      // Reduce overly metallic surfaces for better performance
      if (material.metalness !== undefined) {
        material.metalness = Math.min(material.metalness, 0.5);
      }
      if (material.roughness !== undefined) {
        material.roughness = Math.max(material.roughness, 0.25);
      }
    }

    /**
     * Register a grind rail. Determine the rail's axis, length, and position
     * and register it with the game's obstacle system for grind detection.
     */
    registerGrindRail(mesh) {
      const geometry = mesh.geometry;
      if (!geometry || !geometry.attributes || !geometry.attributes.position) return;

      const positions = geometry.attributes.position;

      // Determine the dominant axis of the rail
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        if (y > maxY) maxY = y;
      }

      const lengthX = maxX - minX;
      const lengthZ = maxZ - minZ;

      // Determine if rail is along X or Z axis
      const alongZ = lengthZ >= lengthX;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const length = alongZ ? lengthZ : lengthX;
      const width = alongZ ? lengthX : lengthZ;

      // Apply world transform to center
      const worldPos = new THREE.Vector3(centerX, maxY, centerZ);
      mesh.localToWorld(worldPos);

      // Register as grind rail obstacle
      this.registerObstacle({
        type: 'rail',
        x: worldPos.x,
        z: worldPos.z,
        width: Math.max(0.4, width),
        length: Math.max(0.5, length),
        height: worldPos.y,
        alongZ: alongZ,
        meshRef: mesh,          // For precise collision
        userData: {
          grindType: '50-50',
          communityMap: true,
        },
      });

      // Store grind metadata for the game's grind system
      mesh.userData.grindData = {
        type: 'rail',
        alongZ: alongZ,
        length: length,
        width: width,
        height: worldPos.y,
        startLocalZ: alongZ ? minZ : centerZ,
        endLocalZ: alongZ ? maxZ : centerZ,
        startLocalX: alongZ ? centerX : minX,
        endLocalX: alongZ ? centerX : maxX,
      };
    }

    /**
     * Register a ramp. Uses bounding box + stores mesh for precise raycast collision.
     */
    registerRampCollider(mesh) {
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());

      this.registerObstacle({
        type: 'ramp',
        x: center.x,
        z: center.z,
        width: Math.max(size.x, size.z * 0.5),
        length: Math.max(size.z, size.x * 0.5),
        height: size.y,
        baseY: bbox.min.y,
        meshRef: mesh,  // Reference for raycast-based precise collision
        communityMap: true,
      });
    }

    /**
     * Register a deck/platform (flat surface).
     */
    registerDeckCollider(mesh) {
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());

      this.registerObstacle({
        type: 'deck',
        x: center.x,
        z: center.z,
        width: size.x,
        length: size.z,
        height: bbox.max.y,
        meshRef: mesh,
        communityMap: true,
      });
    }

    /**
     * Register a gap trigger zone.
     */
    registerGapTrigger(mesh) {
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());

      this.registerObstacle({
        type: 'gap_trigger',
        x: center.x,
        z: center.z,
        width: size.x,
        length: size.z,
        height: size.y,
        meshRef: mesh,
        communityMap: true,
      });
    }

    /**
     * Register a static collider. Most terrain/ground pieces.
     */
    registerStaticCollider(mesh) {
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = bbox.getSize(new THREE.Vector3());

      // Only register colliders for meaningful-sized geometry
      // (skip tiny decorative meshes)
      if (size.x < 0.1 && size.y < 0.1 && size.z < 0.1) {
        return;
      }

      const center = bbox.getCenter(new THREE.Vector3());

      // For large ground/terrain meshes, register as static terrain
      // For smaller objects, register as blockers
      if (size.x > 20 || size.z > 20) {
        this.registerObstacle({
          type: 'static_terrain',
          x: center.x,
          z: center.z,
          width: size.x,
          length: size.z,
          height: size.y,
          baseY: bbox.min.y,
          meshRef: mesh,
          communityMap: true,
        });
      } else {
        this.registerObstacle({
          type: 'static',
          x: center.x,
          z: center.z,
          width: size.x,
          length: size.z,
          height: size.y,
          baseY: bbox.min.y,
          meshRef: mesh,
          communityMap: true,
        });
      }
    }

    /**
     * Get precise surface elevation at world coordinates by raycasting
     * against the map's meshes.
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {string} [mapName] - Optional specific map to query
     * @returns {number|null} Elevation in world Y, or null if no intersection
     */
    getSurfaceElevationAt(worldX, worldZ, mapName) {
      const mapsToCheck = mapName
        ? [this.loadedMaps.get(mapName)]
        : Array.from(this.loadedMaps.values());

      let highestY = null;

      for (const mapData of mapsToCheck) {
        if (!mapData) continue;

        // Raycast down from high above
        this._rayDebugOrigin.set(worldX, 500, worldZ);

        this.raycaster.set(this._rayDebugOrigin, this._rayDebugDir);
        this.raycaster.far = 600;

        const intersects = this.raycaster.intersectObject(mapData.root, true);

        if (intersects.length > 0) {
          const point = intersects[0].point;
          if (highestY === null || point.y > highestY) {
            highestY = point.y;
          }
        }
      }

      return highestY;
    }

    /**
     * Re-register all obstacle colliders for an already-loaded map.
     * The game clears its community obstacle array on exit; this lets us
     * recreate the obstacle list from the cached map meshes when re-entering.
     * @param {string} mapName - Loaded map to (re-)register
     * @param {Function} registerFn - Obstacle registration callback
     * @returns {number} Number of colliders registered
     */
    registerLoadedMap(mapName, registerFn) {
      const mapData = this.loadedMaps.get(mapName);
      if (!mapData) {
        console.warn(`[CommunityMapLoader] registerLoadedMap: "${mapName}" is not loaded`);
        return 0;
      }

      // Temporarily swap the register callback so processMesh routes obstacles
      // into the game's community obstacle array.
      const originalRegister = this.registerObstacle;
      this.registerObstacle = registerFn || originalRegister;

      let count = 0;
      mapData.root.traverse((child) => {
        if (child.isMesh) {
          const classification = this.processMesh(child, mapName);
          if (classification) count++;
        }
      });

      this.registerObstacle = originalRegister;
      return count;
    }

    /**
     * Unload a map and dispose its resources.
     * @param {string} mapName - Map to unload
     */
    unloadMap(mapName) {
      const mapData = this.loadedMaps.get(mapName);
      if (mapData) {
        this.scene.remove(mapData.root);

        // Traverse and dispose geometries/materials
        mapData.root.traverse((child) => {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => this.disposeMaterial(m));
            } else if (child.material) {
              this.disposeMaterial(child.material);
            }
          }
        });

        this.loadedMaps.delete(mapName);
        console.log(`🗑️ Map ${mapName} unloaded`);
      }
    }

    disposeMaterial(material) {
      if (!material) return;
      if (material.map) material.map.dispose();
      if (material.normalMap) material.normalMap.dispose();
      if (material.roughnessMap) material.roughnessMap.dispose();
      if (material.metalnessMap) material.metalnessMap.dispose();
      if (material.emissiveMap) material.emissiveMap.dispose();
      if (material.aoMap) material.aoMap.dispose();
      material.dispose();
    }

    /**
     * Check if a map is loaded.
     */
    isLoaded(mapName) {
      return this.loadedMaps.has(mapName);
    }

    /**
     * Get loaded map info.
     */
    getLoadedMaps() {
      const maps = {};
      this.loadedMaps.forEach((data, name) => {
        maps[name] = data.stats;
      });
      return maps;
    }
  }

  // Expose globally so game.js can use it
  global.CommunityMapLoader = CommunityMapLoader;
})(window);