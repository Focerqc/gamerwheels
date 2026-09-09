# THPS .prk to Three.js .glb Conversion Pipeline

## Overview
This document outlines the complete implementation plan for converting Tony Hawk's Pro Skater community park files (.prk) to web-ready .glb assets and integrating them into the GamerWheels Three.js game.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    THPS MAP CONVERSION PIPELINE                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌─────────────────────┐    ┌──────────────┐   │
│  │  Braille.PRK │───▶│  Blender +          │───▶│ BrailleHouse2│   │
│  │  (Source)    │    │  io_thps_scene      │    │ .glb (Asset) │   │
│  └──────────────┘    │  convert_thps.py    │    └──────┬───────┘   │
│                      └─────────────────────┘           │           │
│                                │                       │           │
│                                ▼                       ▼           │
│                      ┌─────────────────────┐    ┌──────────────┐   │
│                      │  pipeline.js        │    │  Three.js    │   │
│                      │  (Node Orchestrator)│───▶│  Game Load   │   │
│                      └─────────────────────┘    └──────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Phase 1: Blender Python Script (`convert_thps.py`)

### Location
`./convert_thps.py` (project root)

### Purpose
Headless Blender script that:
1. Loads the `io_thps_scene` addon for native .prk parsing
2. Imports the .prk file
3. Cleans/optimizes the scene for web delivery
4. Exports as compressed binary .glb

### Implementation Details

```python
import bpy
import sys
import os
import traceback

def run_conversion():
    # 1. Clear default scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    
    # 2. Enable THPS addon
    try:
        bpy.ops.preferences.addon_enable(module="io_thps_scene")
        print("✓ io_thps_scene addon enabled")
    except Exception as e:
        print(f"⚠ Addon not found: {e}")
        print("  Attempting fallback: custom .prk parser")
        # Fallback: custom binary parsing logic here
        return run_custom_parser()
    
    # 3. Parse CLI arguments
    # Usage: blender -b -P convert_thps.py -- input.prk output.glb
    args = sys.argv[sys.argv.index("--") + 1:]
    if len(args) < 2:
        print("Usage: blender -b -P convert_thps.py -- [input.prk] [output.glb]")
        sys.exit(1)
    
    input_path = args[0]
    output_path = args[1]
    
    if not os.path.exists(input_path):
        print(f"✗ Input file not found: {input_path}")
        sys.exit(1)
    
    print(f"Processing: {input_path}")
    
    # 4. Import .prk via addon
    try:
        # The io_thps_scene addon should register an import operator
        bpy.ops.import_scene.thps_prk(filepath=input_path)
        print("✓ .prk imported successfully")
    except Exception as e:
        print(f"✗ Import failed: {e}")
        traceback.print_exc()
        sys.exit(1)
    
    # 5. Post-process scene for web optimization
    optimize_scene_for_web()
    
    # 6. Export as GLB
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_tangents=True,
        export_colors=True,
        export_materials='EXPORT',
        export_apply=True,           # Apply modifiers
        export_yup=True,             # Three.js uses Y-up
        export_keep_originals=False, # Don't duplicate data
        export_animations=False,     # Static map geometry
        export_extras=True,          # Preserve custom properties
    )
    
    print(f"✓ Successfully exported: {output_path}")
    print(f"  File size: {os.path.getsize(output_path) / 1024:.1f} KB")

def optimize_scene_for_web():
    """Clean up scene for optimal web performance"""
    # Merge duplicate materials
    # Remove unused data blocks
    # Apply scale/rotation to meshes
    # Ensure proper naming for grind detection
    
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            # Apply transforms
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            
            # Ensure custom properties for game logic
            if 'rail' in obj.name.lower() or 'grind' in obj.name.lower():
                obj['isGrindable'] = True
                obj['collisionType'] = 'rail'
            elif 'ramp' in obj.name.lower() or 'kicker' in obj.name.lower():
                obj['collisionType'] = 'ramp'
            elif 'gap' in obj.name.lower():
                obj['collisionType'] = 'gap'
            else:
                obj['collisionType'] = 'static'
    
    # Clean up orphaned data
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

def run_custom_parser():
    """Fallback: Custom .prk binary parser"""
    # Implement if io_thps_scene is unavailable
    # Parse .prk binary format:
    # - Header (magic, version, counts)
    # - Geometry chunks (vertices, faces, UVs)
    # - Object placement (position, rotation, scale)
    # - Texture references
    # - Special objects (rails, gaps, triggers)
    pass

if __name__ == "__main__":
    run_conversion()
```

### Dependencies
- Blender 5.2.1 LTS (installed and in PATH)
- `io_thps_scene` Blender addon (install via Blender preferences or bundle with project)

### Installation of io_thps_scene Addon
```bash
# Option 1: Install via Blender UI
# Edit > Preferences > Add-ons > Install > select io_thps_scene.zip

# Option 2: Bundle with project (recommended for CI/CD)
# Place in: ./blender_addons/io_thps_scene/
# Then in script: bpy.utils.refresh_scripts() and enable
```

---

## Phase 2: Node.js Pipeline Orchestrator (`pipeline.js`)

### Location
`./pipeline.js` (project root)

### Purpose
One-click conversion tool that:
1. Manages file paths
2. Executes Blender headless
3. Handles errors gracefully
4. Provides progress feedback
5. Supports batch conversion

### Implementation

```javascript
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    blenderExecutable: 'blender',  // Assumes in PATH
    scriptPath: path.join(__dirname, 'convert_thps.py'),
    inputDir: path.join(__dirname, 'maps to import'),
    outputDir: path.join(__dirname, 'public', 'assets', 'maps'),
    supportedExtensions: ['.prk', '.PRK'],
};

async function convertMap(inputFile, outputFile) {
    const inputPath = path.join(CONFIG.inputDir, inputFile);
    const outputPath = outputFile 
        ? path.join(CONFIG.outputDir, outputFile)
        : path.join(CONFIG.outputDir, path.parse(inputFile).name + '.glb');
    
    // Ensure output directory exists
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    
    // Verify input exists
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
    }
    
    // Verify Blender script exists
    if (!fs.existsSync(CONFIG.scriptPath)) {
        throw new Error(`Blender script not found: ${CONFIG.scriptPath}`);
    }
    
    // Build command
    // Note: Blender requires -b for background, -P for python script
    // Arguments after -- are passed to sys.argv in the script
    const command = [
        CONFIG.blenderExecutable,
        '-b',                    // Background mode (no UI)
        '-P', `"${CONFIG.scriptPath}"`,  // Python script
        '--',                    // Argument separator
        `"${inputPath}"`,        // Input .prk
        `"${outputPath}"`        // Output .glb
    ].join(' ');
    
    console.log(`🔄 Converting: ${inputFile} → ${path.basename(outputPath)}`);
    console.log(`   Command: ${command}`);
    
    try {
        const { stdout, stderr } = await execAsync(command, {
            timeout: 120000,  // 2 minute timeout
            maxBuffer: 1024 * 1024 * 10  // 10MB buffer
        });
        
        if (stderr && !stderr.includes('Warning:')) {
            console.warn(`⚠ Stderr: ${stderr}`);
        }
        
        console.log(stdout);
        
        // Verify output
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log(`✅ Success! ${path.basename(outputPath)} (${(stats.size / 1024).toFixed(1)} KB)`);
            return { success: true, outputPath, size: stats.size };
        } else {
            throw new Error('Output file was not created');
        }
        
    } catch (error) {
        console.error(`❌ Conversion failed: ${error.message}`);
        if (error.stdout) console.log(`Stdout: ${error.stdout}`);
        if (error.stderr) console.error(`Stderr: ${error.stderr}`);
        return { success: false, error: error.message };
    }
}

async function batchConvert() {
    const files = fs.readdirSync(CONFIG.inputDir)
        .filter(f => CONFIG.supportedExtensions.includes(path.extname(f)));
    
    if (files.length === 0) {
        console.log('No .prk files found in input directory');
        return;
    }
    
    console.log(`📦 Found ${files.length} map(s) to convert\n`);
    
    const results = [];
    for (const file of files) {
        const result = await convertMap(file);
        results.push({ file, ...result });
        console.log(''); // spacing
    }
    
    // Summary
    console.log('━'.repeat(50));
    console.log('📊 CONVERSION SUMMARY');
    console.log('━'.repeat(50));
    results.forEach(r => {
        const status = r.success ? '✅' : '❌';
        console.log(`${status} ${r.file} → ${r.success ? 'OK' : r.error}`);
    });
}

// CLI interface
const args = process.argv.slice(2);
if (args.length === 0) {
    // Batch convert all
    batchConvert();
} else if (args.length === 1) {
    // Single file
    convertMap(args[0]);
} else if (args.length === 2) {
    // Input + custom output name
    convertMap(args[0], args[1]);
} else {
    console.log('Usage:');
    console.log('  node pipeline.js                    # Convert all .prk files');
    console.log('  node pipeline.js Braille.PRK        # Convert single file');
    console.log('  node pipeline.js Braille.PRK custom.glb  # Custom output name');
}
```

### Package.json Scripts Addition
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "convert:maps": "node pipeline.js",
    "convert:map": "node pipeline.js"
  }
}
```

Usage:
```bash
npm run convert:maps           # Convert all maps
npm run convert:map Braille.PRK # Convert single map
```

---

## Phase 3: Three.js Integration (`game.js`)

### Map Loading Module
Create a new module or extend `game.js` with:

```javascript
// public/js/mapLoader.js (new module)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class CommunityMapLoader {
    constructor(scene, physicsWorld, registerObstacleFn) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.registerObstacle = registerObstacleFn;
        this.loader = new GLTFLoader();
        this.loadedMaps = new Map();
    }
    
    async loadMap(mapName, options = {}) {
        const url = `assets/maps/${mapName}.glb`;
        
        if (this.loadedMaps.has(mapName)) {
            console.log(`Map ${mapName} already loaded`);
            return this.loadedMaps.get(mapName);
        }
        
        return new Promise((resolve, reject) => {
            this.loader.load(
                url,
                (gltf) => this.onMapLoaded(gltf, mapName, options, resolve),
                (progress) => {
                    if (options.onProgress) {
                        options.onProgress(progress.loaded / progress.total);
                    }
                },
                (error) => {
                    console.error(`Failed to load map ${mapName}:`, error);
                    reject(error);
                }
            );
        });
    }
    
    onMapLoaded(gltf, mapName, options, resolve) {
        const mapRoot = gltf.scene;
        mapRoot.name = `CommunityMap_${mapName}`;
        
        // Apply global transform if needed
        if (options.position) mapRoot.position.copy(options.position);
        if (options.rotation) mapRoot.rotation.set(...options.rotation);
        if (options.scale) mapRoot.scale.setScalar(options.scale);
        
        // Process all meshes
        mapRoot.traverse((child) => {
            if (child.isMesh) {
                this.processMesh(child, mapName);
            }
        });
        
        // Add to scene
        this.scene.add(mapRoot);
        
        // Store reference
        const mapData = { root: mapRoot, gltf };
        this.loadedMaps.set(mapName, mapData);
        
        console.log(`🗺️ Community map "${mapName}" loaded successfully!`);
        resolve(mapData);
    }
    
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
        const name = mesh.name.toLowerCase();
        const userData = mesh.userData || {};
        
        // Grind rails
        if (name.includes('rail') || name.includes('grind') || userData.isGrindable) {
            this.setupGrindRail(mesh);
        }
        
        // Ramps/kickers
        if (name.includes('ramp') || name.includes('kicker') || name.includes('quarter') || userData.collisionType === 'ramp') {
            this.registerRampCollider(mesh);
        }
        
        // Gaps
        if (name.includes('gap') || userData.collisionType === 'gap') {
            this.registerGapTrigger(mesh);
        }
        
        // Generic static collision
        if (userData.collisionType === 'static' || (!userData.collisionType && !name.includes('rail'))) {
            this.registerStaticCollider(mesh);
        }
    }
    
    optimizeMaterial(material) {
        // Ensure proper settings for web
        material.side = THREE.DoubleSide;
        
        // Optimize for performance
        if (material.map) {
            material.map.colorSpace = THREE.SRGBColorSpace;
            material.map.mipmaps = []; // Let Three.js generate
        }
        
        // Reduce complexity for mobile
        if (material.metalness !== undefined) material.metalness = Math.min(material.metalness, 0.5);
        if (material.roughness !== undefined) material.roughness = Math.max(material.roughness, 0.3);
    }
    
    setupGrindRail(mesh) {
        // Extract spline/centerline from mesh geometry
        const geometry = mesh.geometry;
        const positions = geometry.attributes.position;
        
        // Calculate rail bounds and direction
        let minZ = Infinity, maxZ = -Infinity;
        let minX = Infinity, maxX = -Infinity;
        
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }
        
        // Store grind data on mesh
        mesh.userData.grindData = {
            type: 'rail',
            length: maxZ - minZ,
            width: maxX - minX,
            centerY: mesh.position.y,
            startZ: minZ,
            endZ: maxZ,
        };
        
        // Register with game's grind system
        if (window.setupGrindSystem) {
            window.setupGrindSystem(mesh);
        }
        
        console.log(`🛤️ Grind rail detected: ${mesh.name}`);
    }
    
    registerRampCollider(mesh) {
        // Register as ramp obstacle for physics
        const bbox = new THREE.Box3().setFromObject(mesh);
        const size = bbox.getSize(new THREE.Vector3());
        const center = bbox.getCenter(new THREE.Vector3());
        
        this.registerObstacle({
            type: 'ramp',
            x: center.x,
            z: center.z,
            width: size.x,
            length: size.z,
            height: size.y,
            baseY: bbox.min.y,
            meshRef: mesh,  // Reference for precise collision
        });
    }
    
    registerGapTrigger(mesh) {
        const bbox = new THREE.Box3().setFromObject(mesh);
        const center = bbox.getCenter(new THREE.Vector3());
        
        this.registerObstacle({
            type: 'gap_trigger',
            x: center.x,
            z: center.z,
            width: bbox.max.x - bbox.min.x,
            length: bbox.max.z - bbox.min.z,
            meshRef: mesh,
        });
    }
    
    registerStaticCollider(mesh) {
        const bbox = new THREE.Box3().setFromObject(mesh);
        const size = bbox.getSize(new THREE.Vector3());
        const center = bbox.getCenter(new THREE.Vector3());
        
        this.registerObstacle({
            type: 'static',
            x: center.x,
            z: center.z,
            width: size.x,
            length: size.z,
            height: size.y,
            baseY: bbox.min.y,
            meshRef: mesh,
        });
    }
    
    unloadMap(mapName) {
        const mapData = this.loadedMaps.get(mapName);
        if (mapData) {
            this.scene.remove(mapData.root);
            // Dispose geometries/materials
            mapData.root.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            this.loadedMaps.delete(mapName);
            console.log(`🗑️ Map ${mapName} unloaded`);
        }
    }
}
```

### Integration in game.js

Add to the initialization section:

```javascript
// In game.js, add after Three.js init
import { CommunityMapLoader } from './mapLoader.js';

// Global map loader instance
let communityMapLoader = null;

// In initThreeScene() or buildWorld()
communityMapLoader = new CommunityMapLoader(scene, null, registerObstacle);

// Load community map on demand (e.g., via checkpoint or menu)
async function loadCommunityMap(mapName) {
    try {
        // Show loading indicator
        showTrickToast(`Loading ${mapName}...`);
        
        await communityMapLoader.loadMap(mapName, {
            position: new THREE.Vector3(0, 0, 0),  // Adjust as needed
            onProgress: (p) => console.log(`Loading: ${(p * 100).toFixed(0)}%`)
        });
        
        showTrickToast(`${mapName} loaded! 🛹`);
    } catch (e) {
        showTrickToast(`Failed to load ${mapName}`);
    }
}

// Add to checkpoint system for map selection
const COMMUNITY_MAPS = [
    { id: 5, name: 'BrailleHouse2', zone: 'Community Map', desc: 'Braille Skateboarding community park' },
    // Add more as converted
];

// Extend teleportToCheckpoint or add new function
function loadCommunityMapByIndex(index) {
    if (index >= 0 && index < COMMUNITY_MAPS.length) {
        const map = COMMUNITY_MAPS[index];
        loadCommunityMap(map.name);
    }
}
```

---

## Phase 4: Physics Integration

### Enhanced Obstacle Registration
The existing `registerObstacle` and `getSurfaceElevation` functions need to handle imported mesh geometry precisely.

```javascript
// Add to game.js - Enhanced collision for imported meshes
function getMeshSurfaceElevation(mesh, worldX, worldZ) {
    // Raycast down from above to find precise surface height
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3(worldX, 100, worldZ);  // Start high
    const direction = new THREE.Vector3(0, -1, 0);
    
    raycaster.set(origin, direction);
    raycaster.far = 200;
    
    const intersects = raycaster.intersectObject(mesh, true);
    
    if (intersects.length > 0) {
        return intersects[0].point.y;
    }
    
    return null;  // No intersection
}

// Update getSurfaceElevation to check imported meshes
function getSurfaceElevation(x, z) {
    let surfaceH = getTerrainElevation(x, z);
    
    // Check procedural obstacles
    for (const obs of state.obstacles) {
        // ... existing obstacle checks ...
        
        // NEW: Check imported mesh colliders
        if (obs.meshRef && obs.meshRef.isMesh) {
            const meshY = getMeshSurfaceElevation(obs.meshRef, x, z);
            if (meshY !== null) {
                surfaceH = Math.max(surfaceH, meshY);
            }
        }
    }
    
    return surfaceH;
}
```

---

## Phase 5: Directory Structure

```
gamerwheels/
├── convert_thps.py              # Blender conversion script
├── pipeline.js                  # Node.js orchestrator
├── package.json                 # Updated with conversion scripts
├── blender_addons/              # Optional: bundled addons
│   └── io_thps_scene/
├── maps to import/
│   └── Braille.PRK              # Source community maps
├── public/
│   ├── index.html
│   ├── css/
│   ├── js/
│   │   ├── game.js              # Main game (updated)
│   │   ├── mapLoader.js         # NEW: Community map loader
│   │   └── multiplayer.js
│   ├── models/
│   │   └── x7_board.glb
│   └── assets/
│       └── maps/                # OUTPUT: Converted .glb files
│           └── BrailleHouse2.glb
├── server.js
└── plans/
    └── thps-conversion-pipeline.md
```

---

## Phase 6: UI Integration - Map Selection

Add community maps to the checkpoint/area selection UI:

```html
<!-- In index.html, extend checkpoints bar -->
<div class="exp9-checkpoints-bar">
    <!-- Existing checkpoint buttons -->
    <button class="exp9-cp-btn" data-cp="0">Plaza Park</button>
    <button class="exp9-cp-btn" data-cp="1">Mega Drop</button>
    <!-- ... -->
    
    <!-- NEW: Community maps section -->
    <div class="exp9-cp-divider">Community Maps</div>
    <button class="exp9-cp-btn community-map-btn" data-map="BrailleHouse2">
        Braille House 2
    </button>
    <!-- More community maps added dynamically -->
</div>
```

```javascript
// In game.js - Handle community map buttons
document.querySelectorAll('.community-map-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mapName = btn.getAttribute('data-map');
        loadCommunityMap(mapName);
    });
});

// Dynamically add buttons as maps are converted
function refreshCommunityMapButtons() {
    const container = document.querySelector('.exp9-checkpoints-bar');
    const mapsDir = 'public/assets/maps/';
    
    // This would need server-side directory listing or manifest file
    // For now, manually maintain COMMUNITY_MAPS array
}
```

---

## Testing Checklist

### Conversion Testing
- [ ] Blender 5.2.1 LTS installed and in PATH
- [ ] `io_thps_scene` addon installed and working
- [ ] `convert_thps.py` runs without errors
- [ ] Braille.PRK → BrailleHouse2.glb conversion succeeds
- [ ] Output .glb loads in Three.js GLTFLoader
- [ ] File size is reasonable (< 10MB for web)
- [ ] Materials and textures appear correctly

### Game Integration Testing
- [ ] Map loads without console errors
- [ ] Shadows render correctly on imported geometry
- [ ] Player collides with ground/ramps properly
- [ ] Grind rails detected and functional
- [ ] Gap triggers work
- [ ] No memory leaks on map unload
- [ ] Performance acceptable (60fps on target devices)

### Pipeline Testing
- [ ] `npm run convert:maps` converts all .prk files
- [ ] `npm run convert:map Braille.PRK` converts single file
- [ ] Custom output naming works
- [ ] Error handling for missing files/addons
- [ ] Batch conversion summary displays correctly

---

## Future Enhancements

1. **Manifest System**: Auto-generate `maps-manifest.json` listing all converted maps with metadata
2. **LOD Generation**: Auto-generate level-of-detail meshes for distant viewing
3. **Texture Compression**: Integrate Basis Universal/KTX2 for compressed textures
4. **Physics Baking**: Pre-compute collision shapes (convex hulls) for Rapier/Cannon.js
5. **Map Validation**: Verify converted maps have required elements (spawns, rails, etc.)
6. **CI/CD Integration**: GitHub Action to auto-convert on push to maps folder

---

## Quick Start Commands

```bash
# 1. Install io_thps_scene addon in Blender
# 2. Run conversion
npm run convert:maps

# 3. Start dev server
npm run dev

# 4. In browser, use checkpoint buttons or console:
# loadCommunityMap('BrailleHouse2')