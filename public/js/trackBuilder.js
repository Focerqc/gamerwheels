/**
 * TrackBuilder — Procedural Track Mesh & Collision Generator for GamerWheels
 * Author: Quinn Foster
 * Version: 1.0
 *
 * Takes a track data definition (nodes[], features[], etc.) and generates:
 *   1. A visible THREE.Mesh ribbon following a CatmullRomCurve3
 *   2. Registered obstacle colliders for the existing game collision system
 *   3. A fast getSurfaceAt(x,z) lookup for the physics loop
 *
 * Compatible with Three.js r128 (global THREE, IIFE pattern).
 */

(function (global) {
  'use strict';

  const THREE = global.THREE;

  // =========================================================================
  // Configuration
  // =========================================================================
  const SPLINE_DIVISIONS = 800;       // Samples along the curve for the ribbon
  const COLLISION_SEGMENT_LEN = 2.0;  // Approximate meters per collision segment
  const RIBBON_Y_OFFSET = -0.02;      // Slight offset so the ribbon doesn't z-fight

  // =========================================================================
  // TrackBuilder Singleton
  // =========================================================================
  const TrackBuilder = {
    // Internal state
    _curve: null,
    _trackData: null,
    _ribbonMesh: null,
    _featureMeshes: [],
    _collisionSegments: [],    // Array of { x, z, halfW, halfL, y, rotation, type }
    _splinePoints: [],         // Pre-sampled spline points for fast lookup
    _splineTangents: [],       // Tangent at each sample
    _built: false,
    _scene: null,
    _trackGroup: null,
    _gates: null,
    _circuitStartIndex: 0,
    _dropGate: null,
    _audioCtx: null,

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Build the track from data and add it to the scene.
     * @param {object} trackData - Track definition (TRACK_DATA_HOLLISTER format)
     * @param {THREE.Scene} scene - Three.js scene
     * @param {Function} registerObstacleFn - Game's obstacle registration callback
     * @returns {object} { curve, group, spawnPoint }
     */
    build: function (trackData, scene, registerObstacleFn) {
      this.dispose(); // Clean up any previous track

      this._trackData = trackData;
      this._scene = scene;

      // Check if track has sufficient nodes
      if (!trackData || !trackData.nodes || trackData.nodes.length < 2) {
        console.warn(`⚠️ TrackBuilder: "${trackData ? trackData.name : 'Unknown'}" has less than 2 nodes. Track ribbon skipped.`);
        return {
          curve: null,
          group: new THREE.Group(),
          spawnPoint: this.getSpawnPoint(),
        };
      }

      // 1. Build the spline curve from nodes
      this._buildCurve(trackData);

      // 2. Pre-sample the curve for fast lookups
      this._presampleCurve();

      // 3. Create the visual ribbon mesh
      this._buildRibbonMesh(trackData);

      // 4. Register collision segments along the ribbon
      this._registerCollisionSegments(registerObstacleFn, trackData);

      // 5. Build and register features (tabletops, kickers, etc.)
      this._buildFeatures(trackData, registerObstacleFn);

      // Add track group to scene
      scene.add(this._trackGroup);

      this._built = true;

      console.log(`🏁 TrackBuilder: "${trackData.name}" built!`);
      console.log(`   ${trackData.nodes.length} nodes, ${this._splinePoints.length} samples, ${this._collisionSegments.length} collision segments`);
      console.log(`   ${trackData.features.length} features, total length: ${this._totalLength.toFixed(1)}m`);

      return {
        curve: this._curve,
        group: this._trackGroup,
        spawnPoint: this.getSpawnPoint(),
      };
    },

    /**
     * Get the surface elevation at a world (x, z) position by projecting onto
     * the nearest spline point. Returns the track surface Y or null if not on track.
     */
    getSurfaceAt: function (worldX, worldZ) {
      if (!this._built || this._splinePoints.length === 0) return null;

      // Find the nearest pre-sampled spline point
      let bestDist = Infinity;
      let bestIdx = 0;

      for (let i = 0; i < this._splinePoints.length; i++) {
        const sp = this._splinePoints[i];
        const dx = worldX - sp.x;
        const dz = worldZ - sp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist) {
          bestDist = d2;
          bestIdx = i;
        }
      }

      const nearest = this._splinePoints[bestIdx];
      const dist = Math.sqrt(bestDist);
      const halfW = (nearest.w || this._trackData.width) / 2;

      // Outside the track ribbon — return null
      if (dist > halfW + 2.0) return null;

      // On the track — return the elevation at that point
      // Apply banking: offset the Y based on lateral position from centerline
      const tangent = this._splineTangents[bestIdx];
      if (tangent) {
        // Right vector (perpendicular to tangent on XZ plane)
        const rightX = -tangent.z;
        const rightZ = tangent.x;
        const rightLen = Math.hypot(rightX, rightZ);
        if (rightLen > 0.001) {
          const nrx = rightX / rightLen;
          const nrz = rightZ / rightLen;
          // Lateral offset from centerline
          const lateralDist = (worldX - nearest.x) * nrx + (worldZ - nearest.z) * nrz;

          // Banking tilt: raise outer edge, lower inner edge
          const bankRad = (nearest.bank || 0) * Math.PI / 180;
          const bankOffset = Math.sin(bankRad) * lateralDist;

          // Smooth surface falloff beyond track edge
          if (dist > halfW) {
            const falloff = 1.0 - THREE.MathUtils.clamp((dist - halfW) / 2.0, 0, 1);
            return nearest.y + bankOffset * falloff;
          }

          return nearest.y + bankOffset;
        }
      }

      return nearest.y;
    },

    /**
     * Get the spawn point from the track data.
     * @returns {{ x, y, z, heading }}
     */
    getSpawnPoint: function () {
      if (!this._trackData) return { x: 0, y: 0.2, z: 0, heading: 0 };
      return { ...this._trackData.spawn };
    },

    /**
     * Get the curve for external use (e.g. camera rail, AI pathing).
     */
    getCurve: function () {
      return this._curve;
    },

    /**
     * Get active gate positions and trigger zones.
     */
    getGates: function () {
      return this._gates || {};
    },

    /**
     * Trigger the start drop gate to snap down flat to the ground.
     */
    triggerDropGate: function () {
      if (!this._dropGate) return;
      this._dropGate.triggerDrop();
    },

    /**
     * Reset the start drop gate to upright locked position.
     */
    resetDropGate: function () {
      if (!this._dropGate) return;
      this._dropGate.resetGate();
    },

    /**
     * Get drop gate state ('up' | 'dropping' | 'down' | 'resetting').
     */
    getDropGateState: function () {
      return this._dropGate ? this._dropGate.state : 'up';
    },

    /**
     * Update drop gate animation and auto-trigger proximity check.
     * Drops automatically when whoever drives through, and resets itself in 10 seconds.
     */
    updateDropGate: function (dt, player) {
      if (!this._dropGate) return;
      this._dropGate.update(dt, player);
    },

    /**
     * Dispose all track geometry and references.
     */
    dispose: function () {
      if (this._trackGroup && this._scene) {
        this._scene.remove(this._trackGroup);
      }

      if (this._trackGroup) {
        this._trackGroup.traverse(function (child) {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(function (m) { m.dispose(); });
              } else {
                child.material.dispose();
              }
            }
          }
        });
      }

      this._curve = null;
      this._trackData = null;
      this._ribbonMesh = null;
      this._featureMeshes = [];
      this._collisionSegments = [];
      this._splinePoints = [];
      this._splineTangents = [];
      this._totalLength = 0;
      this._built = false;
      this._trackGroup = null;
      this._gates = null;
      this._circuitStartIndex = 0;
      this._dropGate = null;
    },

    // -----------------------------------------------------------------------
    // Internal: Curve Construction
    // -----------------------------------------------------------------------

    _buildCurve: function (trackData) {
      var points = [];
      for (var i = 0; i < trackData.nodes.length; i++) {
        var n = trackData.nodes[i];
        points.push(new THREE.Vector3(n.x, n.y, n.z));
      }

      var targetNode = trackData.loopTargetNode || 1;
      var isChuteCircuit = trackData.closed && targetNode > 1 && targetNode < trackData.nodes.length;

      if (isChuteCircuit) {
        var targetIdx = targetNode - 1;
        var chutePoints = points.slice(0, targetIdx + 1);
        var circuitPoints = points.slice(targetIdx);

        this._chuteCurve = new THREE.CatmullRomCurve3(chutePoints, false, 'catmullrom', 0.5);
        this._circuitCurve = new THREE.CatmullRomCurve3(circuitPoints, true, 'catmullrom', 0.5);
        this._curve = this._circuitCurve; // Main lap circuit
        this._isChuteCircuit = true;
        this._totalLength = this._chuteCurve.getLength() + this._circuitCurve.getLength();
      } else {
        this._isChuteCircuit = false;
        this._curve = new THREE.CatmullRomCurve3(points, trackData.closed, 'catmullrom', 0.5);
        this._totalLength = this._curve.getLength();
      }
    },

    // -----------------------------------------------------------------------
    // Internal: Pre-sample Curve
    // -----------------------------------------------------------------------

    _presampleCurve: function () {
      this._splinePoints = [];
      this._splineTangents = [];

      var trackData = this._trackData;

      if (this._isChuteCircuit && this._chuteCurve && this._circuitCurve) {
        var targetIdx = (trackData.loopTargetNode || 1) - 1;
        var chuteRatio = this._chuteCurve.getLength() / this._totalLength;
        var numChuteSamples = Math.max(40, Math.floor(SPLINE_DIVISIONS * chuteRatio));
        var numCircuitSamples = SPLINE_DIVISIONS - numChuteSamples;
        this._circuitStartIndex = numChuteSamples;

        // Sample start chute
        var chuteNodes = trackData.nodes.slice(0, targetIdx + 1);
        for (var i = 0; i < numChuteSamples; i++) {
          var t = i / numChuteSamples;
          var pt = this._chuteCurve.getPointAt(t);
          var tangent = this._chuteCurve.getTangentAt(t);
          var nodeProps = this._interpolateNodePropsSimple(t, chuteNodes, false, trackData.width);
          this._splinePoints.push({
            x: pt.x, y: pt.y, z: pt.z, t: t, w: nodeProps.w, bank: nodeProps.bank
          });
          this._splineTangents.push(tangent);
        }

        // Sample main circuit loop
        var circuitNodes = trackData.nodes.slice(targetIdx);
        for (var j = 0; j < numCircuitSamples; j++) {
          var tCirc = j / numCircuitSamples;
          var ptCirc = this._circuitCurve.getPointAt(tCirc);
          var tangentCirc = this._circuitCurve.getTangentAt(tCirc);
          var nodePropsCirc = this._interpolateNodePropsSimple(tCirc, circuitNodes, true, trackData.width);
          this._splinePoints.push({
            x: ptCirc.x, y: ptCirc.y, z: ptCirc.z, t: tCirc, w: nodePropsCirc.w, bank: nodePropsCirc.bank
          });
          this._splineTangents.push(tangentCirc);
        }
        return;
      }

      this._circuitStartIndex = 0;

      // Standard single curve sampling
      var numSamples = SPLINE_DIVISIONS;
      for (var k = 0; k <= numSamples; k++) {
        var tK = k / numSamples;
        var ptK = this._curve.getPointAt(tK);
        var tangentK = this._curve.getTangentAt(tK);

        var props = this._interpolateNodeProps(tK, trackData);
        this._splinePoints.push({
          x: ptK.x, y: ptK.y, z: ptK.z, t: tK, w: props.w, bank: props.bank
        });
        this._splineTangents.push(tangentK);
      }
    },

    _interpolateNodePropsSimple: function (t, nodes, isClosed, defaultWidth) {
      var n = nodes.length;
      if (n <= 1) return { w: defaultWidth, bank: 0 };
      var segT = t * (isClosed ? n : n - 1);
      var idx = Math.floor(segT);
      var frac = segT - idx;
      if (isClosed) {
        idx = ((idx % n) + n) % n;
      } else {
        idx = THREE.MathUtils.clamp(idx, 0, n - 1);
      }
      var nextIdx = isClosed ? (idx + 1) % n : Math.min(idx + 1, n - 1);
      var a = nodes[idx] || nodes[0];
      var b = nodes[nextIdx] || nodes[n - 1];
      return {
        w: THREE.MathUtils.lerp(a.w || defaultWidth, b.w || defaultWidth, frac),
        bank: THREE.MathUtils.lerp(a.bank || 0, b.bank || 0, frac)
      };
    },

    /**
     * Interpolate node properties (width, bank) at a given t along the curve.
     * Uses linear interpolation between the two nearest nodes.
     */
    _interpolateNodeProps: function (t, trackData) {
      var nodes = trackData.nodes;
      var n = nodes.length;
      var segT = t * n;
      var idx = Math.floor(segT);
      var frac = segT - idx;

      if (trackData.closed) {
        idx = ((idx % n) + n) % n;
      } else {
        idx = THREE.MathUtils.clamp(idx, 0, n - 1);
      }

      var nextIdx = trackData.closed ? (idx + 1) % n : Math.min(idx + 1, n - 1);
      var a = nodes[idx];
      var b = nodes[nextIdx];

      return {
        w: THREE.MathUtils.lerp(a.w || trackData.width, b.w || trackData.width, frac),
        bank: THREE.MathUtils.lerp(a.bank || 0, b.bank || 0, frac),
      };
    },

    // -----------------------------------------------------------------------
    // Internal: Ribbon Mesh
    // -----------------------------------------------------------------------

    _buildRibbonMesh: function (trackData) {
      this._trackGroup = new THREE.Group();
      this._trackGroup.name = 'TrackBuilder_' + trackData.name;

      var numSamples = this._splinePoints.length;

      // Build a custom ribbon geometry by sweeping a cross-section along the spline
      var positions = [];
      var normals = [];
      var uvs = [];
      var indices = [];
      var colors = [];

      var accLen = 0;

      for (var i = 0; i < numSamples; i++) {
        var sp = this._splinePoints[i];
        var tan = this._splineTangents[i];
        var halfW = (sp.w || trackData.width) / 2;
        var bankRad = (sp.bank || 0) * Math.PI / 180;

        // Right vector (perpendicular to tangent on XZ plane, normalized)
        var rightX = -tan.z;
        var rightZ = tan.x;
        var rLen = Math.hypot(rightX, rightZ);
        if (rLen > 0.001) {
          rightX /= rLen;
          rightZ /= rLen;
        }

        // Up vector (considering banking)
        var upY = Math.cos(bankRad);
        var bankLateral = Math.sin(bankRad);

        // Left edge
        var lx = sp.x - rightX * halfW;
        var lz = sp.z - rightZ * halfW;
        var ly = sp.y - bankLateral * halfW + RIBBON_Y_OFFSET;

        // Right edge
        var rx = sp.x + rightX * halfW;
        var rz = sp.z + rightZ * halfW;
        var ry = sp.y + bankLateral * halfW + RIBBON_Y_OFFSET;

        positions.push(lx, ly, lz);
        positions.push(rx, ry, rz);

        // Normal — approximate as up
        normals.push(0, 1, 0);
        normals.push(0, 1, 0);

        // UV — u = 0..1 across width, v = accumulated length for tiling
        if (i > 0) {
          var prev = this._splinePoints[i - 1];
          accLen += Math.hypot(sp.x - prev.x, sp.y - prev.y, sp.z - prev.z);
        }
        uvs.push(0, accLen * 0.2);
        uvs.push(1, accLen * 0.2);

        // Vertex colors — dirt track brown with variation
        var trackHue = 0.08 + Math.sin(accLen * 0.3) * 0.015;
        var col = new THREE.Color().setHSL(trackHue, 0.55, 0.30);
        colors.push(col.r, col.g, col.b);
        colors.push(col.r, col.g, col.b);
      }

      // Build triangle indices (quad strip)
      for (var i = 0; i < numSamples - 1; i++) {
        var a = i * 2;
        var b = a + 1;
        var c = a + 2;
        var d = a + 3;

        indices.push(a, c, b);
        indices.push(b, c, d);
      }

      // Close the loop if track is closed
      if (trackData.closed && numSamples > 2) {
        var startLoopIdx = (this._isChuteCircuit && this._circuitStartIndex) ? this._circuitStartIndex : 0;
        var last = (numSamples - 1) * 2;
        var first = startLoopIdx * 2;
        indices.push(last, first, last + 1);
        indices.push(last + 1, first, first + 1);
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      // Create the dirt track texture procedurally
      var trackTexture = this._createTrackTexture(trackData.surfaceMaterial || 'dirt');

      var mat = new THREE.MeshStandardMaterial({
        map: trackTexture,
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.02,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });

      this._ribbonMesh = new THREE.Mesh(geo, mat);
      this._ribbonMesh.receiveShadow = true;
      this._ribbonMesh.castShadow = false;
      this._ribbonMesh.name = 'TrackRibbon';

      this._trackGroup.add(this._ribbonMesh);
    },

    /**
     * Create a procedural track surface texture.
     */
    _createTrackTexture: function (surfaceType) {
      var canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      var ctx = canvas.getContext('2d');

      if (surfaceType === 'asphalt') {
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, 256, 256);
        // Noise
        for (var i = 0; i < 3000; i++) {
          var px = Math.random() * 256;
          var py = Math.random() * 256;
          var g = 30 + Math.random() * 25;
          ctx.fillStyle = 'rgba(' + g + ',' + g + ',' + g + ', 0.3)';
          ctx.fillRect(px, py, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
      } else {
        // Dirt
        ctx.fillStyle = '#6b4423';
        ctx.fillRect(0, 0, 256, 256);
        // Dirt grain
        for (var i = 0; i < 4000; i++) {
          var px = Math.random() * 256;
          var py = Math.random() * 256;
          var r = 80 + Math.random() * 40;
          var g = 50 + Math.random() * 30;
          var b = 20 + Math.random() * 15;
          ctx.fillStyle = 'rgba(' + Math.floor(r) + ',' + Math.floor(g) + ',' + Math.floor(b) + ', 0.35)';
          ctx.fillRect(px, py, 1 + Math.random() * 3, 1);
        }
        // Tire ruts (darker lines along the track)
        ctx.strokeStyle = 'rgba(40, 25, 10, 0.25)';
        ctx.lineWidth = 3;
        for (var i = 0; i < 5; i++) {
          var y = 50 + i * 35;
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (var x = 0; x < 256; x += 8) {
            ctx.lineTo(x, y + (Math.random() - 0.5) * 4);
          }
          ctx.stroke();
        }
      }

      var texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
      return texture;
    },

    // -----------------------------------------------------------------------
    // Internal: Collision Segments
    // -----------------------------------------------------------------------

    _registerCollisionSegments: function (registerFn, trackData) {
      if (!registerFn) return;

      this._collisionSegments = [];

      // Walk along the spline in COLLISION_SEGMENT_LEN steps
      var segLen = COLLISION_SEGMENT_LEN;
      var numSegs = Math.max(1, Math.floor(this._totalLength / segLen));

      for (var i = 0; i < numSegs; i++) {
        var t0 = i / numSegs;
        var t1 = (i + 1) / numSegs;
        var tMid = (t0 + t1) / 2;

        var p0 = this._curve.getPointAt(t0);
        var p1 = this._curve.getPointAt(t1);
        var pMid = this._curve.getPointAt(tMid);
        var tangent = this._curve.getTangentAt(tMid);

        var props = this._interpolateNodeProps(tMid, trackData);
        var segWidth = props.w || trackData.width;
        var segLength = p0.distanceTo(p1);

        // Calculate rotation from tangent
        var rotation = Math.atan2(tangent.x, tangent.z);

        var seg = {
          type: 'track_segment',
          x: pMid.x,
          z: pMid.z,
          y: pMid.y,
          width: segWidth,
          length: segLength + 0.5, // Slight overlap to prevent gaps
          height: pMid.y,
          rotation: rotation,
          bank: props.bank,
          baseY: pMid.y,
          t: tMid,
        };

        this._collisionSegments.push(seg);

        // Register with the game's obstacle system
        registerFn({
          type: 'track_segment',
          x: pMid.x,
          z: pMid.z,
          width: segWidth,
          length: segLength + 0.5,
          height: pMid.y,
          baseY: pMid.y,
          rotation: rotation,
          bank: props.bank,
          communityMap: true, // Uses the community obstacle pipeline
        });
      }
    },

    // -----------------------------------------------------------------------
    // Internal: Feature Placement
    // -----------------------------------------------------------------------

    _buildFeatures: function (trackData, registerFn) {
      this._gates = {};

      var hasStartChuteGate = false;
      var hasFinishTimingGate = false;

      for (var i = 0; i < trackData.features.length; i++) {
        var feat = trackData.features[i];
        var pos, tangent, rotation;

        if (feat.nodeIndex !== undefined && trackData.nodes[feat.nodeIndex]) {
          var nCurr = trackData.nodes[feat.nodeIndex];
          pos = new THREE.Vector3(nCurr.x, nCurr.y, nCurr.z);
          var nextIdx = (feat.nodeIndex + 1) % trackData.nodes.length;
          var nNext = trackData.nodes[nextIdx];
          tangent = new THREE.Vector3(nNext.x - nCurr.x, 0, nNext.z - nCurr.z).normalize();
          rotation = feat.heading !== undefined ? feat.heading : Math.atan2(tangent.x, tangent.z);
        } else {
          var t = THREE.MathUtils.clamp(feat.t || 0, 0, 0.9999);
          pos = this._curve.getPointAt(t);
          tangent = this._curve.getTangentAt(t);
          rotation = Math.atan2(tangent.x, tangent.z);
        }

        switch (feat.type) {
          case 'rftr_feature':
            this._buildRFTRFeatureMarker(feat, pos, tangent, rotation);
            break;
          case 'tabletop':
            this._buildTabletop(feat, pos, tangent, rotation, registerFn);
            break;
          case 'kicker':
            this._buildKicker(feat, pos, tangent, rotation, registerFn);
            break;
          case 'roller':
            this._buildRollers(feat, pos, tangent, rotation, registerFn);
            break;
          case 'drop':
            this._buildDrop(feat, pos, tangent, rotation, registerFn);
            break;
          case 'berm':
            this._buildBerm(feat, pos, tangent, rotation, registerFn);
            break;
          case 'start_finish':
            this._buildStartFinish(feat, pos, tangent, rotation);
            break;
          case 'start_chute_gate':
            this._buildStartChuteGate(feat, pos, tangent, rotation);
            hasStartChuteGate = true;
            break;
          case 'finish_timing_gate':
          case 'finish_line':
            this._buildFinishLineGate(feat, pos, tangent, rotation);
            hasFinishTimingGate = true;
            break;
        }
      }

      // Auto-build gates if chute circuit and not explicitly placed in features
      if (trackData.isChuteCircuit) {
        var nodes = trackData.nodes;
        var targetIdx = (trackData.loopTargetNode || 1) - 1;

        if (!hasStartChuteGate && nodes.length > 1) {
          var p0 = new THREE.Vector3(nodes[0].x, nodes[0].y, nodes[0].z);
          var t0 = new THREE.Vector3(nodes[1].x - nodes[0].x, 0, nodes[1].z - nodes[0].z).normalize();
          var rot0 = Math.atan2(t0.x, t0.z);
          this._buildStartChuteGate({ width: trackData.width + 1.6 }, p0, t0, rot0);
        }

        if (!hasFinishTimingGate && nodes.length > targetIdx) {
          var pM = new THREE.Vector3(nodes[targetIdx].x, nodes[targetIdx].y, nodes[targetIdx].z);
          var nextI = Math.min(targetIdx + 1, nodes.length - 1);
          var tM = new THREE.Vector3(nodes[nextI].x - nodes[targetIdx].x, 0, nodes[nextI].z - nodes[targetIdx].z).normalize();
          var rotM = Math.atan2(tM.x, tM.z);
          this._buildFinishLineGate({ width: trackData.width + 1.8 }, pM, tM, rotM);
        }
      }
    },

    _buildTabletop: function (feat, pos, tangent, rotation, registerFn) {
      var halfLen = feat.length / 2;
      var props = feat.t !== undefined ? this._interpolateNodeProps(feat.t, this._trackData) : {};
      var width = props.w || this._trackData.width;

      // Visual mesh — a simple box-like shape
      var shape = new THREE.Shape();
      var takeoff = feat.takeoffLen || feat.length * 0.25;
      var deck = feat.deckLen || feat.length * 0.5;
      var landing = feat.landingLen || feat.length * 0.25;
      var h = feat.height;

      shape.moveTo(0, 0);
      shape.lineTo(takeoff, h);
      shape.lineTo(takeoff + deck, h);
      shape.lineTo(takeoff + deck + landing, 0);
      shape.lineTo(0, 0);

      var extrudeSettings = { depth: width, bevelEnabled: false };
      var geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

      // Rotate and position the geometry
      geo.rotateX(-Math.PI / 2);
      geo.translate(-halfLen, 0, -width / 2);

      var mat = new THREE.MeshStandardMaterial({
        color: 0x8B6914,
        roughness: 0.9,
        metalness: 0.05,
      });

      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Feature_Tabletop_' + (feat.t !== undefined ? feat.t.toFixed(2) : (feat.nodeIndex || '0'));

      this._trackGroup.add(mesh);
      this._featureMeshes.push(mesh);

      // Register obstacle — using the game's existing tabletop collision type
      // We need to compute the world-space position along the tangent direction
      var fwdX = Math.sin(rotation);
      var fwdZ = Math.cos(rotation);
      var centerZ = pos.z + fwdX * 0; // Already at center

      registerFn({
        type: 'tabletop',
        x: pos.x,
        z: pos.z,
        width: width,
        length: feat.length,
        height: feat.height,
        baseY: pos.y,
        takeoffLen: takeoff,
        deckLen: deck,
        landingLen: landing,
        rotation: rotation,
        dir: 1,
        // The game's tabletop collision uses z-axis alignment with optional dir
        // We provide zStart/zEnd for the existing collision code
        zStart: pos.z - fwdZ * halfLen,
        zEnd: pos.z + fwdZ * halfLen,
        communityMap: true,
      });
    },

    _buildKicker: function (feat, pos, tangent, rotation, registerFn) {
      var props = feat.t !== undefined ? this._interpolateNodeProps(feat.t, this._trackData) : {};
      var width = props.w || this._trackData.width;
      var halfLen = feat.length / 2;

      // Visual wedge mesh
      var shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(feat.length, feat.height);
      shape.lineTo(feat.length, 0);
      shape.lineTo(0, 0);

      var extrudeSettings = { depth: width, bevelEnabled: false };
      var geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-halfLen, 0, -width / 2);

      var mat = new THREE.MeshStandardMaterial({
        color: 0x9B7B2C,
        roughness: 0.85,
        metalness: 0.05,
      });

      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Feature_Kicker_' + (feat.t !== undefined ? feat.t.toFixed(2) : (feat.nodeIndex || '0'));

      this._trackGroup.add(mesh);
      this._featureMeshes.push(mesh);

      // Register as a kicker obstacle (game's existing type)
      registerFn({
        type: 'kicker',
        x: pos.x,
        z: pos.z,
        width: width,
        length: feat.length,
        height: feat.height,
        baseY: pos.y,
        rotation: rotation,
        communityMap: true,
      });
    },

    _buildRollers: function (feat, pos, tangent, rotation, registerFn) {
      var props = feat.t !== undefined ? this._interpolateNodeProps(feat.t, this._trackData) : {};
      var width = props.w || this._trackData.width;
      var count = feat.count || 4;

      var fwdX = Math.sin(rotation);
      var fwdZ = Math.cos(rotation);
      var startX = pos.x - fwdX * feat.length / 2;
      var startZ = pos.z - fwdZ * feat.length / 2;
      var endX = pos.x + fwdX * feat.length / 2;
      var endZ = pos.z + fwdZ * feat.length / 2;

      // Register as whoops obstacle (game's existing type)
      registerFn({
        type: 'whoops',
        x: pos.x,
        z: pos.z,
        width: width,
        length: feat.length,
        height: feat.height,
        baseY: pos.y,
        zStart: startZ,
        zEnd: endZ,
        count: count,
        communityMap: true,
      });

      // Visual — individual roller humps
      var spacing = feat.length / count;
      for (var i = 0; i < count; i++) {
        var t2 = (i + 0.5) / count;
        var rx = startX + (endX - startX) * t2;
        var rz = startZ + (endZ - startZ) * t2;

        var rollerGeo = new THREE.CylinderGeometry(feat.height, feat.height * 1.5, width, 8, 1, false, 0, Math.PI);
        rollerGeo.rotateZ(Math.PI / 2);
        rollerGeo.rotateY(rotation);

        var rollerMat = new THREE.MeshStandardMaterial({
          color: 0x7B6424,
          roughness: 0.9,
          metalness: 0.05,
        });

        var rollerMesh = new THREE.Mesh(rollerGeo, rollerMat);
        rollerMesh.position.set(rx, pos.y, rz);
        rollerMesh.castShadow = true;
        rollerMesh.receiveShadow = true;
        rollerMesh.name = 'Feature_Roller_' + i;

        this._trackGroup.add(rollerMesh);
        this._featureMeshes.push(rollerMesh);
      }
    },

    _buildDrop: function (feat, pos, tangent, rotation, registerFn) {
      var props = feat.t !== undefined ? this._interpolateNodeProps(feat.t, this._trackData) : {};
      var width = props.w || this._trackData.width;
      var halfLen = feat.length / 2;

      var fwdX = Math.sin(rotation);
      var fwdZ = Math.cos(rotation);

      // Register as a bank_z (downhill slope) — using existing collision type
      registerFn({
        type: 'bank_z',
        x: pos.x,
        z: pos.z,
        width: width,
        length: feat.length,
        height: feat.height,
        yStart: pos.y,
        yEnd: pos.y - feat.height,
        zStart: pos.z - fwdZ * halfLen,
        zEnd: pos.z + fwdZ * halfLen,
        communityMap: true,
      });

      // Visual — a sloped surface
      var shape = new THREE.Shape();
      shape.moveTo(0, feat.height);
      shape.lineTo(feat.length, 0);
      shape.lineTo(feat.length, -0.3);
      shape.lineTo(0, feat.height - 0.3);
      shape.lineTo(0, feat.height);

      var extrudeSettings = { depth: width, bevelEnabled: false };
      var geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-halfLen, 0, -width / 2);

      var mat = new THREE.MeshStandardMaterial({
        color: 0x6B4423,
        roughness: 0.92,
        metalness: 0.03,
      });

      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, pos.y - feat.height, pos.z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Feature_Drop_' + (feat.t !== undefined ? feat.t.toFixed(2) : (feat.nodeIndex || '0'));

      this._trackGroup.add(mesh);
      this._featureMeshes.push(mesh);
    },

    _buildBerm: function (feat, pos, tangent, rotation, registerFn) {
      var props = feat.t !== undefined ? this._interpolateNodeProps(feat.t, this._trackData) : {};
      var width = props.w || this._trackData.width;
      var bankAngle = feat.bankAngle || 20;
      var radius = feat.length / (2 * Math.sin(Math.PI / 6)); // Approximate

      // Register as a berm_bowl obstacle
      registerFn({
        type: 'berm_bowl',
        x: pos.x,
        z: pos.z,
        radius: feat.length / 2,
        height: feat.height,
        baseY: pos.y,
        width: width,
        length: feat.length,
        communityMap: true,
      });

      // Visual — curved berm wall on the outside of the turn
      var outerGeo = new THREE.TorusGeometry(feat.length / 3, feat.height / 2, 8, 16, Math.PI * 0.6);
      outerGeo.rotateX(Math.PI / 2);

      var bermMat = new THREE.MeshStandardMaterial({
        color: 0x8B6914,
        roughness: 0.88,
        metalness: 0.04,
        side: THREE.DoubleSide,
      });

      var bermMesh = new THREE.Mesh(outerGeo, bermMat);
      bermMesh.position.set(pos.x, pos.y + feat.height * 0.3, pos.z);
      bermMesh.rotation.y = rotation;
      bermMesh.castShadow = true;
      bermMesh.receiveShadow = true;
      bermMesh.name = 'Feature_Berm_' + feat.t.toFixed(2);

      this._trackGroup.add(bermMesh);
      this._featureMeshes.push(bermMesh);
    },

    _buildStartFinish: function (feat, pos, tangent, rotation) {
      var props = this._interpolateNodeProps(feat.t, this._trackData);
      var width = (props.w || this._trackData.width) + 1.0;

      // Checkered start/finish line decal
      var canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      var ctx = canvas.getContext('2d');
      var checkSize = 16;
      for (var row = 0; row < 4; row++) {
        for (var col = 0; col < 8; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#111111';
          ctx.fillRect(col * checkSize, row * checkSize, checkSize, checkSize);
        }
      }

      var tex = new THREE.CanvasTexture(canvas);
      var geo = new THREE.PlaneGeometry(width, feat.length || 3.0);
      geo.rotateX(-Math.PI / 2);

      var mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });

      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, pos.y + 0.03, pos.z);
      mesh.rotation.y = rotation;
      mesh.name = 'Feature_StartFinish';

      this._trackGroup.add(mesh);
      this._featureMeshes.push(mesh);
    },

    _buildRFTRFeatureMarker: function (feat, pos, tangent, rotation) {
      var markerGroup = new THREE.Group();
      markerGroup.position.set(pos.x, pos.y, pos.z);
      markerGroup.rotation.y = rotation;

      // Track verge lateral offset: place marker on the side of track
      var sideOffset = 4.0;
      var postGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8);
      var postMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.8 });
      var post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sideOffset, 1.6, 0);
      markerGroup.add(post);

      // Blue numbered badge disc
      var discGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.06, 24);
      discGeo.rotateX(Math.PI / 2);
      var discMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.3,
        metalness: 0.6,
        emissive: 0x0369a1,
        emissiveIntensity: 0.4
      });
      var disc = new THREE.Mesh(discGeo, discMat);
      disc.position.set(sideOffset, 3.0, 0);
      markerGroup.add(disc);

      // Canvas for feature number & label
      var canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.arc(128, 128, 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 120px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(feat.number !== undefined ? String(feat.number) : 'F', 128, 128);

      var numTex = new THREE.CanvasTexture(canvas);
      var numGeo = new THREE.PlaneGeometry(0.8, 0.8);
      var numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
      var numMesh1 = new THREE.Mesh(numGeo, numMat);
      numMesh1.position.set(sideOffset, 3.0, 0.035);
      markerGroup.add(numMesh1);

      var numMesh2 = new THREE.Mesh(numGeo, numMat);
      numMesh2.position.set(sideOffset, 3.0, -0.035);
      numMesh2.rotation.y = Math.PI;
      markerGroup.add(numMesh2);

      // Right-side post & disc (mirrored)
      var postR = new THREE.Mesh(postGeo, postMat);
      postR.position.set(-sideOffset, 1.6, 0);
      markerGroup.add(postR);

      var discR = new THREE.Mesh(discGeo, discMat);
      discR.position.set(-sideOffset, 3.0, 0);
      markerGroup.add(discR);

      var numMesh3 = new THREE.Mesh(numGeo, numMat);
      numMesh3.position.set(-sideOffset, 3.0, 0.035);
      markerGroup.add(numMesh3);

      var numMesh4 = new THREE.Mesh(numGeo, numMat);
      numMesh4.position.set(-sideOffset, 3.0, -0.035);
      numMesh4.rotation.y = Math.PI;
      markerGroup.add(numMesh4);

      this._trackGroup.add(markerGroup);
      this._featureMeshes.push(markerGroup);
    },

    _buildStartChuteGate: function (feat, pos, tangent, rotation) {
      var self = this;
      var width = (feat.width || this._trackData.width || 5.0) + 1.2;
      var gateHeight = 4.4;
      var halfW = width / 2;

      var gateGroup = new THREE.Group();
      gateGroup.position.set(pos.x, pos.y, pos.z);
      gateGroup.rotation.y = rotation;

      var postMat = new THREE.MeshStandardMaterial({
        color: 0x24272c,
        roughness: 0.45,
        metalness: 0.8,
      });

      var orangeAccentMat = new THREE.MeshStandardMaterial({
        color: 0xff6600,
        emissive: 0xff3300,
        emissiveIntensity: 0.5,
        roughness: 0.35,
        metalness: 0.5,
      });

      // Left tower post
      var postGeo = new THREE.BoxGeometry(0.4, gateHeight, 0.4);
      var leftPost = new THREE.Mesh(postGeo, postMat);
      leftPost.position.set(-halfW, gateHeight / 2, 0);
      leftPost.castShadow = true;
      gateGroup.add(leftPost);

      // Right tower post
      var rightPost = new THREE.Mesh(postGeo, postMat);
      rightPost.position.set(halfW, gateHeight / 2, 0);
      rightPost.castShadow = true;
      gateGroup.add(rightPost);

      // Concrete footing pads
      var padGeo = new THREE.BoxGeometry(0.8, 0.25, 0.8);
      var padMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
      var leftPad = new THREE.Mesh(padGeo, padMat);
      leftPad.position.set(-halfW, 0.125, 0);
      gateGroup.add(leftPad);

      var rightPad = new THREE.Mesh(padGeo, padMat);
      rightPad.position.set(halfW, 0.125, 0);
      gateGroup.add(rightPad);

      // Crossbar truss
      var crossGeo = new THREE.BoxGeometry(width + 0.6, 0.45, 0.45);
      var crossBar = new THREE.Mesh(crossGeo, postMat);
      crossBar.position.set(0, gateHeight - 0.25, 0);
      crossBar.castShadow = true;
      gateGroup.add(crossBar);

      // Overhead Signboard Canvas Texture (High-res 1024x128)
      var canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 128;
      var ctx = canvas.getContext('2d');

      // Dark carbon background
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(0, 0, 1024, 128);

      // Border glow
      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 1008, 112);

      // Chevrons on sides
      ctx.fillStyle = '#ff8800';
      for (var ci = 0; ci < 4; ci++) {
        var cx1 = 30 + ci * 28;
        ctx.beginPath();
        ctx.moveTo(cx1, 24);
        ctx.lineTo(cx1 + 18, 64);
        ctx.lineTo(cx1, 104);
        ctx.lineTo(cx1 + 10, 104);
        ctx.lineTo(cx1 + 28, 64);
        ctx.lineTo(cx1 + 10, 24);
        ctx.fill();

        var cx2 = 994 - ci * 28;
        ctx.beginPath();
        ctx.moveTo(cx2, 24);
        ctx.lineTo(cx2 - 18, 64);
        ctx.lineTo(cx2, 104);
        ctx.lineTo(cx2 - 10, 104);
        ctx.lineTo(cx2 - 28, 64);
        ctx.lineTo(cx2 - 10, 24);
        ctx.fill();
      }

      // Title & Subtext
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HOLLISTER HILLS RFTR — MASS START', 512, 48);

      ctx.fillStyle = '#00ff66';
      ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
      ctx.fillText('AUTOMATIC DROP GATE • DRIVE THROUGH TO DROP (10s RESET)', 512, 92);

      var signTex = new THREE.CanvasTexture(canvas);
      var signGeo = new THREE.PlaneGeometry(Math.min(width * 0.8, 16.0), 1.05);
      // Front side facing approaching staged riders (-Z)
      var signMatFront = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.FrontSide });
      var signMeshFront = new THREE.Mesh(signGeo, signMatFront);
      signMeshFront.position.set(0, gateHeight - 0.78, -0.02);
      signMeshFront.rotation.y = Math.PI; // Face staged riders without mirroring!
      gateGroup.add(signMeshFront);

      // Back side facing track chute exit (+Z)
      var signTexBack = new THREE.CanvasTexture(canvas);
      var signMatBack = new THREE.MeshBasicMaterial({ map: signTexBack, side: THREE.FrontSide });
      var signMeshBack = new THREE.Mesh(signGeo, signMatBack);
      signMeshBack.position.set(0, gateHeight - 0.78, 0.02);
      gateGroup.add(signMeshBack);

      // Staging lights on crossbar (Red, Amber, Green)
      var stagingLights = { red: [], amber: [], green: [] };
      var lightConfigs = [
        { type: 'red', x: -1.8, color: 0xff1111 },
        { type: 'red', x: -1.2, color: 0xff1111 },
        { type: 'amber', x: -0.6, color: 0xffaa00 },
        { type: 'amber', x: 0.6, color: 0xffaa00 },
        { type: 'green', x: 1.2, color: 0x00ff44 },
        { type: 'green', x: 1.8, color: 0x00ff44 },
      ];

      lightConfigs.forEach(function (cfg) {
        var lightGeo = new THREE.SphereGeometry(0.14, 12, 12);
        var lightMat = new THREE.MeshStandardMaterial({
          color: cfg.color,
          emissive: (cfg.type === 'red') ? 0xff0000 : 0x111111,
          emissiveIntensity: (cfg.type === 'red') ? 1.2 : 0.1,
          roughness: 0.2,
          metalness: 0.5,
        });
        var lightMesh = new THREE.Mesh(lightGeo, lightMat);
        lightMesh.position.set(cfg.x, gateHeight + 0.12, 0);
        gateGroup.add(lightMesh);
        stagingLights[cfg.type].push(lightMesh);
      });

      // Ground staging line decal (Behind gate line at z = -0.8)
      var groundCanvas = document.createElement('canvas');
      groundCanvas.width = 512;
      groundCanvas.height = 64;
      var gCtx = groundCanvas.getContext('2d');
      gCtx.fillStyle = '#ff6600';
      gCtx.fillRect(0, 0, 512, 64);
      gCtx.fillStyle = '#111111';
      for (var s = 0; s < 16; s++) {
        gCtx.fillRect(s * 32, 0, 16, 64);
      }
      var groundTex = new THREE.CanvasTexture(groundCanvas);
      var groundGeo = new THREE.PlaneGeometry(width, 1.6);
      groundGeo.rotateX(-Math.PI / 2);
      var groundMat = new THREE.MeshBasicMaterial({
        map: groundTex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      var groundDecal = new THREE.Mesh(groundGeo, groundMat);
      groundDecal.position.set(0, 0.04, -0.8);
      gateGroup.add(groundDecal);

      // ======================================================================
      // Motocross / RFTR Mechanical Drop Gate Mechanism
      // ======================================================================
      // 1. Continuous ground pivot shaft across the start line
      var shaftGeo = new THREE.CylinderGeometry(0.045, 0.045, width - 0.6, 12);
      shaftGeo.rotateZ(Math.PI / 2);
      var shaftMat = new THREE.MeshStandardMaterial({
        color: 0x1f2024,
        roughness: 0.6,
        metalness: 0.8,
      });
      var shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
      shaftMesh.position.set(0, 0.08, 0);
      gateGroup.add(shaftMesh);

      // Ground mounting brackets every 1.4m
      var baseGeo = new THREE.BoxGeometry(0.12, 0.08, 0.45);
      for (var bi = -halfW + 0.8; bi <= halfW - 0.8; bi += 1.4) {
        var bMesh = new THREE.Mesh(baseGeo, shaftMat);
        bMesh.position.set(bi, 0.04, 0);
        gateGroup.add(bMesh);
      }

      // Hydraulic release actuator cylinders on both side posts
      var actuatorGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.85, 12);
      var actuatorMat = new THREE.MeshStandardMaterial({
        color: 0xdd6611, // Industrial safety orange
        roughness: 0.35,
        metalness: 0.7,
      });
      var rodGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 12);
      var rodMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.95, roughness: 0.1 });

      [-halfW + 0.28, halfW - 0.28].forEach(function (actuatorX) {
        var actMesh = new THREE.Mesh(actuatorGeo, actuatorMat);
        actMesh.position.set(actuatorX, 0.52, -0.15);
        actMesh.rotation.x = Math.PI / 5;
        gateGroup.add(actMesh);

        var rodMesh = new THREE.Mesh(rodGeo, rodMat);
        rodMesh.position.set(actuatorX, 0.25, -0.05);
        rodMesh.rotation.x = Math.PI / 5;
        gateGroup.add(rodMesh);
      });

      // 2. Rotating Drop Gate Paddle Group (hinged at y = 0.08, z = 0)
      var dropPivotGroup = new THREE.Group();
      dropPivotGroup.position.set(0, 0.08, 0);

      // Track green powdercoat tubular steel matching reference photos
      var paddleMat = new THREE.MeshStandardMaterial({
        color: 0x3d6635, // Motocross track green
        roughness: 0.45,
        metalness: 0.65,
      });

      var numBays = 14; // 14 side-by-side rider gate slots across the 20m start line
      var bayWidth = (width - 1.8) / numBays;
      var paddleW = bayWidth * 0.75;
      var armLen = 0.52;

      // Geometries shared across bays for efficiency
      var armGeo = new THREE.CylinderGeometry(0.024, 0.024, armLen, 8);
      armGeo.rotateX(Math.PI / 2); // extend along Z when rotation.x = 0

      var crossGeo = new THREE.CylinderGeometry(0.026, 0.026, paddleW + 0.04, 8);
      crossGeo.rotateZ(Math.PI / 2); // extend along X

      var cornerGeo = new THREE.SphereGeometry(0.03, 8, 8);

      for (var i = 0; i < numBays; i++) {
        var centerX = -halfW + 0.9 + (i + 0.5) * bayWidth;

        // Left arm of paddle
        var leftArm = new THREE.Mesh(armGeo, paddleMat);
        leftArm.position.set(centerX - paddleW / 2, 0.025, armLen / 2);
        leftArm.castShadow = true;
        dropPivotGroup.add(leftArm);

        // Right arm of paddle
        var rightArm = new THREE.Mesh(armGeo, paddleMat);
        rightArm.position.set(centerX + paddleW / 2, 0.025, armLen / 2);
        rightArm.castShadow = true;
        dropPivotGroup.add(rightArm);

        // Top barrier crossbar (where board rests)
        var topBar = new THREE.Mesh(crossGeo, paddleMat);
        topBar.position.set(centerX, 0.03, armLen);
        topBar.castShadow = true;
        dropPivotGroup.add(topBar);

        // Corner curved joints
        var cornerL = new THREE.Mesh(cornerGeo, paddleMat);
        cornerL.position.set(centerX - paddleW / 2, 0.03, armLen);
        dropPivotGroup.add(cornerL);

        var cornerR = new THREE.Mesh(cornerGeo, paddleMat);
        cornerR.position.set(centerX + paddleW / 2, 0.03, armLen);
        dropPivotGroup.add(cornerR);

        // Lower reinforcement cross-brace
        var braceGeo = new THREE.CylinderGeometry(0.016, 0.016, paddleW, 8);
        braceGeo.rotateZ(Math.PI / 2);
        var lowerBrace = new THREE.Mesh(braceGeo, paddleMat);
        lowerBrace.position.set(centerX, 0.02, armLen * 0.4);
        dropPivotGroup.add(lowerBrace);
      }

      // Initial state: Upright / Locked (~ -48 degrees tilted towards staged riders)
      var UPRIGHT_ANGLE = -Math.PI * 0.27;
      var DROPPED_ANGLE = 0.01;
      dropPivotGroup.rotation.x = UPRIGHT_ANGLE;
      gateGroup.add(dropPivotGroup);

      gateGroup.name = 'Gate_StartChute';
      this._trackGroup.add(gateGroup);
      this._featureMeshes.push(gateGroup);

      if (!this._gates) this._gates = {};
      this._gates.startChute = {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: rotation,
        width: width,
        radius: width * 0.9,
      };

      // 3. Drop Gate Controller
      this._dropGate = {
        gateGroup: gateGroup,
        pivotGroup: dropPivotGroup,
        lights: stagingLights,
        state: 'up', // 'up' | 'dropping' | 'down' | 'resetting'
        angle: UPRIGHT_ANGLE,
        upAngle: UPRIGHT_ANGLE,
        downAngle: DROPPED_ANGLE,
        timer: 0,
        gatePos: { x: pos.x, y: pos.y, z: pos.z, heading: rotation, width: width },

        triggerDrop: function () {
          if (this.state === 'down' || this.state === 'dropping') return;
          this.state = 'dropping';
          self._playDropSound();
          self._setGateLights('green');
        },

        resetGate: function () {
          if (this.state === 'up' || this.state === 'resetting') return;
          this.state = 'resetting';
          self._setGateLights('amber');
        },

        update: function (dt, player) {
          // Automatic drive-through detection
          if (player && this.state === 'up') {
            var dx = player.x - this.gatePos.x;
            var dz = player.z - this.gatePos.z;
            var dist = Math.hypot(dx, dz);

            if (dist < this.gatePos.width * 0.7) {
              var h = this.gatePos.heading;
              var sinH = Math.sin(h);
              var cosH = Math.cos(h);
              // Local X is lateral across gate, local Z is forward through gate
              var localX = dx * cosH - dz * sinH;
              var localZ = dx * sinH + dz * cosH;

              // Only trigger if moving forward through the gate line
              // localZ: -1.2m (at gate threshold) to +2.5m (passed gate), with forward speed (> 0.7 m/s)
              var isDrivingThrough = (player.speed > 0.7) && (localZ >= -1.2 && localZ <= 2.5);

              if (Math.abs(localX) <= this.gatePos.width * 0.52 && isDrivingThrough) {
                this.triggerDrop();
                if (window.GamerWheels && window.GamerWheels.showTrickToast) {
                  window.GamerWheels.showTrickToast('🟢 START GATE DROPPED! (10s RESET)');
                }
              }
            }
          }

          // State Machine
          if (this.state === 'dropping') {
            this.angle = THREE.MathUtils.lerp(this.angle, this.downAngle, Math.min(1.0, dt * 26.0));
            if (Math.abs(this.angle - this.downAngle) < 0.015) {
              this.angle = this.downAngle;
              this.state = 'down';
              this.timer = 10.0; // Auto-resets in 10 seconds!
              self._setGateLights('green');
            }
          } else if (this.state === 'down') {
            this.timer -= dt;
            if (this.timer <= 0) {
              this.resetGate();
            }
          } else if (this.state === 'resetting') {
            this.angle = THREE.MathUtils.lerp(this.angle, this.upAngle, Math.min(1.0, dt * 3.8));
            self._setGateLights('amber');
            if (Math.abs(this.angle - this.upAngle) < 0.015) {
              this.angle = this.upAngle;
              this.state = 'up';
              self._setGateLights('red');
              self._playResetLatchSound();
              if (window.GamerWheels && window.GamerWheels.showTrickToast) {
                window.GamerWheels.showTrickToast('🔒 START GATE LOCKED & READY');
              }
            }
          }

          this.pivotGroup.rotation.x = this.angle;
        }
      };
    },

    _setGateLights: function (mode) {
      if (!this._dropGate || !this._dropGate.lights) return;
      var lights = this._dropGate.lights;
      var redOn = (mode === 'red');
      var greenOn = (mode === 'green');
      var amberOn = (mode === 'amber');

      if (lights.red) {
        lights.red.forEach(function (m) {
          m.material.emissive.setHex(redOn ? 0xff0000 : 0x220000);
          m.material.emissiveIntensity = redOn ? 1.2 : 0.1;
        });
      }
      if (lights.amber) {
        lights.amber.forEach(function (m) {
          m.material.emissive.setHex(amberOn ? 0xffaa00 : 0x221500);
          m.material.emissiveIntensity = amberOn ? 1.2 : 0.1;
        });
      }
      if (lights.green) {
        lights.green.forEach(function (m) {
          m.material.emissive.setHex(greenOn ? 0x00ff44 : 0x002208);
          m.material.emissiveIntensity = greenOn ? 1.4 : 0.1;
        });
      }
    },

    _playDropSound: function () {
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!this._audioCtx) this._audioCtx = new AudioCtx();
        if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
        var ctx = this._audioCtx;
        var now = ctx.currentTime;

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(850, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.07);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);

        setTimeout(function () {
          try {
            if (!ctx) return;
            var t2 = ctx.currentTime;
            var osc2 = ctx.createOscillator();
            var gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(120, t2);
            osc2.frequency.exponentialRampToValueAtTime(36, t2 + 0.2);
            gain2.gain.setValueAtTime(0.55, t2);
            gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.2);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(t2);
            osc2.stop(t2 + 0.2);

            var bufferSize = Math.floor(ctx.sampleRate * 0.12);
            var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            var data = buffer.getChannelData(0);
            for (var i = 0; i < bufferSize; i++) {
              data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
            }
            var noise = ctx.createBufferSource();
            noise.buffer = buffer;
            var noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.35, t2);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, t2 + 0.12);
            noise.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(t2);
          } catch (e) {}
        }, 100);
      } catch (e) {}
    },

    _playResetLatchSound: function () {
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!this._audioCtx) this._audioCtx = new AudioCtx();
        if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
        var ctx = this._audioCtx;
        var now = ctx.currentTime;

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.setValueAtTime(600, now + 0.04);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } catch (e) {}
    },

    _buildFinishLineGate: function (feat, pos, tangent, rotation) {
      var width = (feat.width || this._trackData.width || 5.0) + 1.4;
      var gateHeight = 4.8;
      var halfW = width / 2;

      var gateGroup = new THREE.Group();
      gateGroup.position.set(pos.x, pos.y, pos.z);
      gateGroup.rotation.y = rotation + Math.PI / 2;

      var trussMat = new THREE.MeshStandardMaterial({
        color: 0x181a1f,
        roughness: 0.35,
        metalness: 0.85,
      });

      // Uprights with checkered motif
      var postGeo = new THREE.BoxGeometry(0.42, gateHeight, 0.42);
      var leftPost = new THREE.Mesh(postGeo, trussMat);
      leftPost.position.set(-halfW, gateHeight / 2, 0);
      leftPost.castShadow = true;
      gateGroup.add(leftPost);

      var rightPost = new THREE.Mesh(postGeo, trussMat);
      rightPost.position.set(halfW, gateHeight / 2, 0);
      rightPost.castShadow = true;
      gateGroup.add(rightPost);

      // Heavy overhead gantry
      var gantryGeo = new THREE.BoxGeometry(width + 0.6, 0.65, 0.6);
      var gantry = new THREE.Mesh(gantryGeo, trussMat);
      gantry.position.set(0, gateHeight - 0.2, 0);
      gantry.castShadow = true;
      gateGroup.add(gantry);

      // Signboard
      var canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      var ctx = canvas.getContext('2d');

      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, 512, 128);

      // Checkered side tabs
      var cSize = 16;
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 4; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#000000';
          ctx.fillRect(c * cSize, r * cSize, cSize, cSize);
          ctx.fillRect(512 - (4 - c) * cSize, r * cSize, cSize, cSize);
        }
      }

      // Neon Cyan and White Header
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 6;
      ctx.strokeRect(68, 6, 376, 116);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 38px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FINISH / TIMING', 256, 50);

      ctx.fillStyle = '#00e5ff';
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.fillText('🏁 RFTR HOLLISTER HILLS 🏁', 256, 92);

      var signTex = new THREE.CanvasTexture(canvas);
      var signGeo = new THREE.PlaneGeometry(width * 0.88, 1.15);
      var signMat = new THREE.MeshBasicMaterial({
        map: signTex,
        side: THREE.DoubleSide,
      });
      var signMesh = new THREE.Mesh(signGeo, signMat);
      signMesh.position.set(0, gateHeight - 0.9, 0);
      gateGroup.add(signMesh);

      // High-contrast checkered finish line across track
      var groundCanvas = document.createElement('canvas');
      groundCanvas.width = 256;
      groundCanvas.height = 64;
      var gCtx = groundCanvas.getContext('2d');
      var checkW = 16;
      for (var gr = 0; gr < 4; gr++) {
        for (var gc = 0; gc < 16; gc++) {
          gCtx.fillStyle = (gr + gc) % 2 === 0 ? '#ffffff' : '#111111';
          gCtx.fillRect(gc * checkW, gr * 16, checkW, 16);
        }
      }
      var groundTex = new THREE.CanvasTexture(groundCanvas);
      var groundGeo = new THREE.PlaneGeometry(width, 2.4);
      groundGeo.rotateX(-Math.PI / 2);
      var groundMat = new THREE.MeshBasicMaterial({
        map: groundTex,
        side: THREE.DoubleSide,
      });
      var groundDecal = new THREE.Mesh(groundGeo, groundMat);
      groundDecal.position.set(0, 0.04, 0);
      gateGroup.add(groundDecal);

      gateGroup.name = 'Gate_FinishLine';
      this._trackGroup.add(gateGroup);
      this._featureMeshes.push(gateGroup);

      if (!this._gates) this._gates = {};
      this._gates.lapFinish = {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: rotation,
        width: width,
        radius: width * 0.95,
      };
    },

    /**
     * Get seamless ground elevation anywhere in the world, anchored to the nearest track segment.
     * Continuously interpolates elevation, tangents, and banking between spline points to eliminate
     * discrete stepping, bumpiness, and camera/nose jitter.
     */
    getGroundElevationAt: function (worldX, worldZ) {
      if (!this._built || !this._splinePoints || this._splinePoints.length === 0) {
        return 1.0;
      }

      const pts = this._splinePoints;
      const numPts = pts.length;
      if (numPts === 1) return pts[0].y;

      let bestDistSq = Infinity;
      let bestIdxA = 0;
      let bestIdxB = 1;
      let bestU = 0;
      let bestQX = pts[0].x;
      let bestQZ = pts[0].z;

      const numSegments = this._isChuteCircuit ? (numPts - 1) : (this._trackData && this._trackData.closed ? numPts : numPts - 1);

      for (let i = 0; i < numSegments; i++) {
        const nextIdx = (i + 1) % numPts;
        const ax = pts[i].x, az = pts[i].z;
        const bx = pts[nextIdx].x, bz = pts[nextIdx].z;
        const abx = bx - ax, abz = bz - az;
        const lenSq = abx * abx + abz * abz;

        let u = 0;
        let qx = ax, qz = az;
        if (lenSq > 0.0001) {
          u = ((worldX - ax) * abx + (worldZ - az) * abz) / lenSq;
          if (u < 0) u = 0;
          else if (u > 1) u = 1;
          qx = ax + u * abx;
          qz = az + u * abz;
        }

        const dx = worldX - qx;
        const dz = worldZ - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdxA = i;
          bestIdxB = nextIdx;
          bestU = u;
          bestQX = qx;
          bestQZ = qz;
        }
      }

      const pA = pts[bestIdxA];
      const pB = pts[bestIdxB];
      const u = bestU;

      // Continuously interpolated centerline properties
      const centerY = pA.y + u * (pB.y - pA.y);
      const defaultW = (this._trackData && this._trackData.width) || 5.0;
      const wA = pA.w || defaultW;
      const wB = pB.w || defaultW;
      const halfW = (wA + u * (wB - wA)) / 2.0;

      const bankA = pA.bank || 0;
      const bankB = pB.bank || 0;
      const bankDeg = bankA + u * (bankB - bankA);

      const dist = Math.sqrt(bestDistSq);

      // 1. If on the track ribbon, return smooth track height with continuous banking tilt
      if (dist <= halfW) {
        let y = centerY;
        const tA = this._splineTangents[bestIdxA];
        const tB = this._splineTangents[bestIdxB];
        if (tA && tB) {
          const tx = tA.x + u * (tB.x - tA.x);
          const tz = tA.z + u * (tB.z - tA.z);
          const rightX = -tz;
          const rightZ = tx;
          const rightLen = Math.hypot(rightX, rightZ);
          if (rightLen > 0.001) {
            const nrx = rightX / rightLen;
            const nrz = rightZ / rightLen;
            const lateralDist = (worldX - bestQX) * nrx + (worldZ - bestQZ) * nrz;
            const bankRad = bankDeg * Math.PI / 180;
            y += Math.sin(bankRad) * lateralDist;
          }
        }
        return y;
      }

      // 2. Seamless dirt shoulder and rolling open terrain smoothly blended
      const offset = dist - halfW;
      const shoulderDrop = Math.min(0.28, offset * 0.04);
      const distantDrop = Math.max(0, offset - 4.0) * 0.025;
      const rollingHills = (Math.sin(worldX * 0.035 + worldZ * 0.028) + Math.cos(worldX * 0.018 - worldZ * 0.022)) * 0.45;

      const groundY = centerY - shoulderDrop - Math.min(2.5, distantDrop) + (offset > 8 ? rollingHills : 0);
      return Math.max(0.2, groundY);
    },
  };

  // Expose globally
  global.TrackBuilder = TrackBuilder;

})(window);
