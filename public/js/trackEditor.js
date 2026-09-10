/**
 * RFTR Style Spline Studio - Interactive 2D Track Designer for GamerWheels
 * Uses Centripetal Catmull-Rom Splines matching Three.js CatmullRomCurve3
 * Supports both full closed circuits and Separate Start Chutes merging into lap loops
 */
(function() {
  'use strict';

  // State
  const editorState = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    img: null,
    
    // Transform & Navigation
    scale: 3.5,            // pixels per meter
    offsetX: 0,            // screen X origin (center of world 0,0)
    offsetY: 0,            // screen Y origin
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    isSpacePressed: false,
    
    // Tools: 'draw' | 'select' | 'insert'
    currentTool: 'draw',
    
    // Interaction
    isDraggingNode: false,
    dragNodeIndex: -1,
    hoveredNodeIndex: -1,
    selectedNodeIndex: -1,
    selectedNodes: new Set(),
    hoveredSplineInsert: null, // { worldX, worldZ, insertIdx }
    isPickingLoopTarget: false,

    // Feature Dragging & Reference Map
    isDraggingFeature: false,
    dragFeatureIndex: -1,
    hoveredFeatureIndex: -1,
    selectedFeatureIndex: -1,
    refImg: null,
    showReferenceMap: false,
    
    // Track Definition
    trackData: {
      name: 'Hollister Hills RFTR',
      closed: true,
      loopTargetNode: 1, // 1 = full loop back to #1; >1 = start chute merging into node K
      width: 5.0,
      surfaceMaterial: 'dirt',
      nodes: [],
      features: [],
      spawn: { x: 0, y: 1.0, z: 0, heading: 0 },
      checkpoints: []
    },
    
    // History (Undo / Redo)
    undoStack: [],
    redoStack: [],
    
    // Settings
    showRibbon: true,
    showLabels: true,
    
    // Feature dragging
    isDraggingToken: false,
    currentTokenType: null,
  };

  // Initialize on load
  function init() {
    bindUIEvents();
  }

  function bindUIEvents() {
    // Launching & exiting editor
    const btnPlayGame = document.getElementById('btnPlayGame');
    if (btnPlayGame) {
      btnPlayGame.addEventListener('click', () => {
        document.getElementById('devScreenModal').style.display = 'none';
      });
    }

    const btnDesignTrack = document.getElementById('btnDesignTrack');
    if (btnDesignTrack) {
      btnDesignTrack.addEventListener('click', () => {
        document.getElementById('devScreenModal').style.display = 'none';
        document.getElementById('trackEditorContainer').style.display = 'flex';
        initEditor();
      });
    }

    window.openTrackStudio = function () {
      const cont = document.getElementById('trackEditorContainer');
      if (cont) {
        cont.style.display = 'flex';
        initEditor();
      }
    };

    window.closeTrackStudio = function () {
      const cont = document.getElementById('trackEditorContainer');
      if (cont) cont.style.display = 'none';
    };

    window.toggleTrackStudio = function () {
      const cont = document.getElementById('trackEditorContainer');
      if (cont) {
        const isOpen = (cont.style.display === 'flex');
        if (isOpen) {
          window.closeTrackStudio();
        } else {
          window.openTrackStudio();
        }
      }
    };

    const btnOpenTrackStudio = document.getElementById('btnOpenTrackStudio');
    if (btnOpenTrackStudio) {
      btnOpenTrackStudio.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.toggleTrackStudio();
      });
    }

    const btnExitEditor = document.getElementById('btnExitEditor');
    if (btnExitEditor) {
      btnExitEditor.addEventListener('click', () => {
        const cont = document.getElementById('trackEditorContainer');
        if (cont) cont.style.display = 'none';
      });
    }

    // Playtest In-Game
    const btnExportPlaytest = document.getElementById('btnExportPlaytest');
    if (btnExportPlaytest) {
      btnExportPlaytest.addEventListener('click', () => {
        syncToGlobalTrackData();
        const editorCont = document.getElementById('trackEditorContainer');
        if (editorCont) editorCont.style.display = 'none';
        const devModal = document.getElementById('devScreenModal');
        if (devModal) devModal.style.display = 'none';

        if (typeof window.loadTrackMap === 'function') {
          window.loadTrackMap('RFTR_Hollister', window.TRACK_DATA_HOLLISTER);
        } else {
          const btn = document.querySelector('button[data-map="RFTR_Hollister"]');
          if (btn) btn.click();
        }
      });
    }

    // Tool switching
    document.getElementById('btnToolDraw').addEventListener('click', () => setTool('draw'));
    document.getElementById('btnToolSelect').addEventListener('click', () => setTool('select'));
    document.getElementById('btnToolInsert').addEventListener('click', () => setTool('insert'));

    // Loop & Circuit Actions
    document.getElementById('btnToggleLoop').addEventListener('click', toggleLoop);
    
    const btnConnect = document.getElementById('btnConnectLoopNode');
    if (btnConnect) btnConnect.addEventListener('click', togglePickLoopTarget);

    const btnPick = document.getElementById('btnPickLoopNode');
    if (btnPick) btnPick.addEventListener('click', togglePickLoopTarget);

    const selLoop = document.getElementById('selectLoopTargetNode');
    if (selLoop) selLoop.addEventListener('change', (e) => setLoopTargetNode(parseInt(e.target.value, 10)));

    document.getElementById('btnUndo').addEventListener('click', undo);
    document.getElementById('btnRedo').addEventListener('click', redo);
    document.getElementById('btnClearAll').addEventListener('click', clearTrack);
    document.getElementById('btnResetView').addEventListener('click', resetView);

    // Inspector Events
    document.getElementById('btnUpdateElevation').addEventListener('click', updateSelectedElevation);
    document.getElementById('btnUpdateBank').addEventListener('click', updateSelectedBank);
    document.getElementById('btnDeleteSelectedNode').addEventListener('click', deleteSelectedNode);
    document.getElementById('btnApplyElevation').addEventListener('click', applyGradeInterpolation);

    // Track Settings
    const inputWidth = document.getElementById('inputTrackWidth');
    if (inputWidth) {
      inputWidth.addEventListener('input', (e) => {
        editorState.trackData.width = parseFloat(e.target.value);
        document.getElementById('lblTrackWidth').innerText = `${e.target.value}m`;
        draw();
      });
    }

    const chkRibbon = document.getElementById('chkShowRibbon');
    if (chkRibbon) {
      chkRibbon.addEventListener('change', (e) => {
        editorState.showRibbon = e.target.checked;
        draw();
      });
    }

    const chkLabels = document.getElementById('chkShowLabels');
    if (chkLabels) {
      chkLabels.addEventListener('change', (e) => {
        editorState.showLabels = e.target.checked;
        draw();
      });
    }

    // Export Modal Events
    document.getElementById('btnOpenExport').addEventListener('click', openExportModal);
    document.getElementById('btnCloseExportModal').addEventListener('click', closeExportModal);
    document.getElementById('btnCloseExportModal2').addEventListener('click', closeExportModal);
    document.getElementById('btnCopyExportJSON').addEventListener('click', copyExportJSON);
    document.getElementById('btnDownloadExportJSON').addEventListener('click', downloadExportJSON);

    // Import Modal Events
    document.getElementById('btnOpenImport').addEventListener('click', openImportModal);
    document.getElementById('btnCloseImportModal').addEventListener('click', closeImportModal);
    document.getElementById('btnCloseImportModal2').addEventListener('click', closeImportModal);
    document.getElementById('btnChooseFile').addEventListener('click', () => document.getElementById('importFileInput').click());
    document.getElementById('importFileInput').addEventListener('change', handleFileInput);
    document.getElementById('btnConfirmImport').addEventListener('click', confirmImportJSON);

    // Sidebar Token Drag & Drop
    const tokens = document.querySelectorAll('.editor-token');
    tokens.forEach(token => {
      token.addEventListener('dragstart', (e) => {
        editorState.isDraggingToken = true;
        editorState.currentTokenType = e.target.dataset.type;
        e.dataTransfer.setData('text/plain', e.target.dataset.type);
      });
      token.addEventListener('dragend', () => {
        editorState.isDraggingToken = false;
        editorState.currentTokenType = null;
      });
    });

    // Global Keybindings
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
  }

  function setTool(tool) {
    editorState.currentTool = tool;
    editorState.isPickingLoopTarget = false;
    document.getElementById('btnToolDraw').classList.toggle('active', tool === 'draw');
    document.getElementById('btnToolSelect').classList.toggle('active', tool === 'select');
    document.getElementById('btnToolInsert').classList.toggle('active', tool === 'insert');
    
    // Canvas cursor
    if (editorState.canvas) {
      if (tool === 'draw') editorState.canvas.style.cursor = 'crosshair';
      else if (tool === 'select') editorState.canvas.style.cursor = 'default';
      else if (tool === 'insert') editorState.canvas.style.cursor = 'cell';
    }
    draw();
  }

  function initEditor() {
    if (!editorState.canvas) {
      const canvas = document.getElementById('trackEditorCanvas');
      editorState.canvas = canvas;
      editorState.ctx = canvas.getContext('2d');

      const resize = () => {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        editorState.width = rect.width;
        editorState.height = rect.height;
        if (editorState.offsetX === 0 && editorState.offsetY === 0) {
          editorState.offsetX = rect.width / 2;
          editorState.offsetY = rect.height / 2;
        }
        draw();
      };

      window.addEventListener('resize', resize);
      resize();

      // Load Clean Satellite BG Image
      editorState.img = new Image();
      editorState.img.src = 'images/rftr_img.png';
      editorState.img.onload = () => {
        resetView();
        draw();
      };

      // Load Marked Reference Map Image (Pins & Race Path from image.png)
      editorState.refImg = new Image();
      editorState.refImg.src = 'images/rftr_marked_map.png';
      editorState.refImg.onload = () => {
        draw();
      };

      // Setup Reference Map Toggle Button
      const btnToggleRefMap = document.getElementById('btnToggleRefMap');
      const lblRefMap = document.getElementById('lblRefMap');
      if (btnToggleRefMap) {
        btnToggleRefMap.onclick = () => {
          editorState.showReferenceMap = !editorState.showReferenceMap;
          if (lblRefMap) {
            lblRefMap.textContent = editorState.showReferenceMap ? 'Ref Map: ON' : 'Ref Map: Off';
          }
          btnToggleRefMap.classList.toggle('active', editorState.showReferenceMap);
          draw();
        };
      }

      // Check localStorage for saved draft first
      try {
        const saved = localStorage.getItem('gamerwheels_rftr_draft');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.nodes && parsed.nodes.length > 0) {
            const hasElev = parsed.nodes.some(n => n.y && n.y > 2.0);
            if (hasElev || !window.TRACK_DATA_HOLLISTER || !window.TRACK_DATA_HOLLISTER.nodes || window.TRACK_DATA_HOLLISTER.nodes.length === 0) {
              editorState.trackData = parsed;
            }
          }
        }
      } catch (err) {}

      // Fallback to window.TRACK_DATA_HOLLISTER if no saved draft or draft was flat
      if ((!editorState.trackData.nodes || editorState.trackData.nodes.length === 0) &&
          window.TRACK_DATA_HOLLISTER && window.TRACK_DATA_HOLLISTER.nodes && window.TRACK_DATA_HOLLISTER.nodes.length > 0) {
        editorState.trackData = JSON.parse(JSON.stringify(window.TRACK_DATA_HOLLISTER));
      }

      // Ensure numbered RFTR features from TRACK_DATA_HOLLISTER are loaded
      if (window.TRACK_DATA_HOLLISTER && window.TRACK_DATA_HOLLISTER.features) {
        if (!editorState.trackData.features || editorState.trackData.features.length === 0) {
          editorState.trackData.features = JSON.parse(JSON.stringify(window.TRACK_DATA_HOLLISTER.features));
        } else {
          // Merge in any missing numbered features
          window.TRACK_DATA_HOLLISTER.features.forEach(feat => {
            if (feat.number !== undefined) {
              const exists = editorState.trackData.features.some(f => f.number === feat.number);
              if (!exists) {
                editorState.trackData.features.push(JSON.parse(JSON.stringify(feat)));
              }
            }
          });
        }
      }
      updateNumberedFeaturesUI();

      setupCanvasEvents(canvas);

      // Canvas Drag & Drop target for features
      canvas.addEventListener('dragover', (e) => e.preventDefault());
      canvas.addEventListener('drop', handleTokenDrop);
    }
    setTool('draw');
    const lbl = document.getElementById('lblLoopState');
    if (lbl) lbl.innerText = editorState.trackData.closed ? 'Loop: Closed' : 'Loop: Open';
    updateLoopTargetUI();
    updateHUD();
    draw();
  }

  function resetView() {
    if (!editorState.canvas) return;
    editorState.offsetX = editorState.width / 2;
    editorState.offsetY = editorState.height / 2;
    editorState.scale = 3.5;
    updateHUD();
    draw();
  }

  // =========================================================================
  // Canvas Mouse & Gesture Interaction
  // =========================================================================

  function findFeatureAtScreen(screenX, screenY) {
    const features = editorState.trackData.features || [];
    const nodes = editorState.trackData.nodes;
    if (!nodes || nodes.length === 0) return -1;

    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      let wx, wz;
      if (f.x !== undefined && f.z !== undefined) {
        wx = f.x;
        wz = f.z;
      } else if (f.nodeIndex !== undefined && nodes[f.nodeIndex]) {
        wx = nodes[f.nodeIndex].x;
        wz = nodes[f.nodeIndex].z;
      } else if (f.t !== undefined) {
        const idx = Math.floor(f.t * nodes.length) % nodes.length;
        wx = nodes[idx].x;
        wz = nodes[idx].z;
      } else {
        continue;
      }

      const { screenX: sx, screenY: sy } = worldToScreen(wx, wz);
      // Test distance to pin center
      const dist = Math.hypot(screenX - sx, screenY - (sy - 14));
      if (dist <= 22) {
        return i;
      }
    }
    return -1;
  }

  function updateNumberedFeaturesUI() {
    const listEl = document.getElementById('numberedFeaturesList');
    if (!listEl) return;

    const features = editorState.trackData.features || [];
    const numbered = features.filter(f => f.number !== undefined);

    if (numbered.length === 0) {
      listEl.innerHTML = '<div style="font-size: 0.8rem; color: #64748b;">No numbered features on track.</div>';
      return;
    }

    listEl.innerHTML = '';
    numbered.sort((a, b) => a.number - b.number).forEach(f => {
      const idx = features.indexOf(f);
      const isSelected = (editorState.selectedFeatureIndex === idx);

      const card = document.createElement('div');
      card.className = 'numbered-feature-card' + (isSelected ? ' active' : '');

      const badge = document.createElement('div');
      badge.className = 'feature-num-badge';
      badge.textContent = f.number;
      card.appendChild(badge);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'feature-name-edit';
      input.value = f.name || ('Feature ' + f.number);
      input.placeholder = 'Name feature...';
      input.addEventListener('input', (e) => {
        f.name = e.target.value;
        syncToGlobalTrackData();
        draw();
      });
      card.appendChild(input);

      const tag = document.createElement('span');
      tag.className = 'feature-node-tag';
      tag.textContent = 'Node #' + ((f.nodeIndex !== undefined ? f.nodeIndex : 0) + 1);
      card.appendChild(tag);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'feature-del-btn';
      delBtn.title = 'Delete feature';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndoState();
        editorState.trackData.features.splice(idx, 1);
        // Renumber remaining rftr_feature entries sequentially
        let numCounter = 1;
        editorState.trackData.features.forEach(feat => {
          if (feat.number !== undefined || feat.type === 'rftr_feature') {
            const oldDefaultName = 'Feature ' + feat.number;
            feat.number = numCounter;
            if (!feat.name || feat.name.startsWith('Feature ')) {
              feat.name = 'Feature ' + numCounter;
            }
            numCounter++;
          }
        });
        if (editorState.selectedFeatureIndex === idx) {
          editorState.selectedFeatureIndex = -1;
        } else if (editorState.selectedFeatureIndex > idx) {
          editorState.selectedFeatureIndex--;
        }
        syncToGlobalTrackData();
        updateNumberedFeaturesUI();
        draw();
      });
      card.appendChild(delBtn);

      card.addEventListener('click', (e) => {
        if (e.target === input || e.target === delBtn) return;
        editorState.selectedFeatureIndex = idx;
        editorState.selectedNodeIndex = -1;
        updateNumberedFeaturesUI();
        draw();
      });

      listEl.appendChild(card);
    });
  }

  function setupCanvasEvents(canvas) {
    // Wheel Zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.5, Math.min(25, editorState.scale * zoomFactor));

      // Zoom towards mouse cursor
      editorState.offsetX = mouseX - (mouseX - editorState.offsetX) * (newScale / editorState.scale);
      editorState.offsetY = mouseY - (mouseY - editorState.offsetY) * (newScale / editorState.scale);
      editorState.scale = newScale;

      updateHUD();
      draw();
    }, { passive: false });

    // Prevent context menu on canvas for right-click node delete / pan
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mouse Down
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const { worldX, worldZ } = screenToWorld(mouseX, mouseY);

      // Pan with middle click, right click (when not on a node), or Space+left click
      const isRightClick = e.button === 2;
      const isMiddleClick = e.button === 1;
      const hitNode = findNodeAtScreen(mouseX, mouseY);

      if (isMiddleClick || (isRightClick && hitNode === -1) || (editorState.isSpacePressed && e.button === 0)) {
        editorState.isPanning = true;
        editorState.panStartX = mouseX - editorState.offsetX;
        editorState.panStartY = mouseY - editorState.offsetY;
        canvas.style.cursor = 'grabbing';
        return;
      }

      // If in "Pick Loop Target Node" mode
      if (editorState.isPickingLoopTarget && hitNode !== -1 && e.button === 0) {
        setLoopTargetNode(hitNode + 1);
        editorState.isPickingLoopTarget = false;
        const btnHeader = document.getElementById('btnConnectLoopNode');
        const btnSidebar = document.getElementById('btnPickLoopNode');
        if (btnHeader) btnHeader.classList.remove('active');
        if (btnSidebar) btnSidebar.style.background = '';
        setTool(editorState.currentTool);
        return;
      }

      // Right Click on a Node -> Delete Node
      if (isRightClick && hitNode !== -1) {
        pushHistory();
        editorState.trackData.nodes.splice(hitNode, 1);
        if (editorState.selectedNodeIndex === hitNode) {
          editorState.selectedNodeIndex = -1;
        } else if (editorState.selectedNodeIndex > hitNode) {
          editorState.selectedNodeIndex--;
        }
        editorState.selectedNodes.clear();
        updateInspector();
        updateLoopTargetUI();
        updateHUD();
        draw();
        return;
      }

      // Left Click Handling
      if (e.button === 0) {
        // 0. Check if clicked on a Feature Pin (Numbered or Gate) -> Drag Feature
        const hitFeature = findFeatureAtScreen(mouseX, mouseY);
        if (hitFeature !== -1) {
          editorState.isDraggingFeature = true;
          editorState.dragFeatureIndex = hitFeature;
          editorState.selectedFeatureIndex = hitFeature;
          editorState.selectedNodeIndex = -1;
          editorState.selectedNodes.clear();
          pushHistory();
          updateNumberedFeaturesUI();
          draw();
          return;
        }

        // 1. Clicked on an existing node
        if (hitNode !== -1) {
          if (e.shiftKey) {
            // Shift + click for range selection
            if (editorState.selectedNodes.size > 0) {
              const arr = Array.from(editorState.selectedNodes);
              const minIdx = Math.min(...arr, hitNode);
              const maxIdx = Math.max(...arr, hitNode);
              editorState.selectedNodes.clear();
              for (let i = minIdx; i <= maxIdx; i++) {
                editorState.selectedNodes.add(i);
              }
            } else {
              editorState.selectedNodes.add(hitNode);
            }
          } else {
            editorState.selectedNodeIndex = hitNode;
            editorState.selectedNodes.clear();
            editorState.selectedNodes.add(hitNode);
            editorState.isDraggingNode = true;
            editorState.dragNodeIndex = hitNode;
            pushHistory(); // Record state before drag
          }
          updateInspector();
          draw();
          return;
        }

        // 2. Clicked in "Insert Node" mode or on highlighted insert segment
        if (editorState.currentTool === 'insert' || e.altKey) {
          const insertInfo = findSplineInsertPoint(worldX, worldZ);
          if (insertInfo) {
            pushHistory();
            const prevNode = editorState.trackData.nodes[insertInfo.prevIdx];
            const nextNode = editorState.trackData.nodes[(insertInfo.prevIdx + 1) % editorState.trackData.nodes.length];
            const avgY = prevNode && nextNode ? (prevNode.y + nextNode.y) / 2 : 1.0;
            const avgBank = prevNode && nextNode ? (prevNode.bank + nextNode.bank) / 2 : 0;

            const newNode = {
              x: Math.round(insertInfo.x * 10) / 10,
              y: Math.round(avgY * 10) / 10,
              z: Math.round(insertInfo.z * 10) / 10,
              bank: Math.round(avgBank)
            };

            editorState.trackData.nodes.splice(insertInfo.insertIdx, 0, newNode);
            editorState.selectedNodeIndex = insertInfo.insertIdx;
            editorState.selectedNodes.clear();
            editorState.selectedNodes.add(insertInfo.insertIdx);
            updateInspector();
            updateLoopTargetUI();
            updateHUD();
            draw();
            return;
          }
        }

        // 3. Clicked in "Draw Spline" mode -> Append Node
        if (editorState.currentTool === 'draw') {
          pushHistory();
          const nodes = editorState.trackData.nodes;
          // Inherit elevation from previous node or default 1.0
          let elev = 1.0;
          let bank = 0;
          if (nodes.length > 0) {
            elev = nodes[nodes.length - 1].y;
            bank = nodes[nodes.length - 1].bank || 0;
          }

          const newNode = {
            x: Math.round(worldX * 10) / 10,
            y: elev,
            z: Math.round(worldZ * 10) / 10,
            bank: bank
          };

          nodes.push(newNode);
          editorState.selectedNodeIndex = nodes.length - 1;
          editorState.selectedNodes.clear();
          editorState.selectedNodes.add(nodes.length - 1);
          updateInspector();
          updateLoopTargetUI();
          updateHUD();
          draw();
          return;
        }

        // 4. Clicked empty space in Select mode -> Deselect
        editorState.selectedNodeIndex = -1;
        editorState.selectedNodes.clear();
        updateInspector();
        draw();
      }
    });

    // Mouse Move
    window.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Handle Panning
      if (editorState.isPanning) {
        editorState.offsetX = mouseX - editorState.panStartX;
        editorState.offsetY = mouseY - editorState.panStartY;
        draw();
        return;
      }

      // Handle Dragging Feature Pin along track
      if (editorState.isDraggingFeature && editorState.dragFeatureIndex !== -1) {
        const { worldX, worldZ } = screenToWorld(mouseX, mouseY);
        const nodes = editorState.trackData.nodes;
        if (nodes && nodes.length > 0) {
          let minDist = Infinity;
          let minIdx = 0;
          for (let i = 0; i < nodes.length; i++) {
            const d = Math.hypot(nodes[i].x - worldX, nodes[i].z - worldZ);
            if (d < minDist) {
              minDist = d;
              minIdx = i;
            }
          }
          const f = editorState.trackData.features[editorState.dragFeatureIndex];
          if (f) {
            f.nodeIndex = minIdx;
            f.x = nodes[minIdx].x;
            f.z = nodes[minIdx].z;
            f.y = nodes[minIdx].y !== undefined ? nodes[minIdx].y : 1.0;
            f.t = Math.round((minIdx / nodes.length) * 100) / 100;
            updateNumberedFeaturesUI();
            draw();
          }
        }
        return;
      }

      // Handle Dragging Node
      if (editorState.isDraggingNode && editorState.dragNodeIndex !== -1) {
        const { worldX, worldZ } = screenToWorld(mouseX, mouseY);
        const node = editorState.trackData.nodes[editorState.dragNodeIndex];
        if (node) {
          node.x = Math.round(worldX * 10) / 10;
          node.z = Math.round(worldZ * 10) / 10;
          updateInspector();
          updateHUD();
          draw();
        }
        return;
      }

      // Hover Detection
      const hitFeat = findFeatureAtScreen(mouseX, mouseY);
      if (hitFeat !== editorState.hoveredFeatureIndex) {
        editorState.hoveredFeatureIndex = hitFeat;
        draw();
      }

      const hitNode = findNodeAtScreen(mouseX, mouseY);
      if (hitNode !== editorState.hoveredNodeIndex) {
        editorState.hoveredNodeIndex = hitNode;
        draw();
      }

      if (hitFeat !== -1) {
        canvas.style.cursor = 'grab';
      } else if (hitNode !== -1) {
        canvas.style.cursor = 'pointer';
      } else if (editorState.isPickingLoopTarget) {
        canvas.style.cursor = 'crosshair';
      } else if (editorState.currentTool === 'draw') {
        canvas.style.cursor = 'crosshair';
      } else if (editorState.currentTool === 'insert') {
        canvas.style.cursor = 'cell';
      } else {
        canvas.style.cursor = 'default';
      }

      // Insert Mode Spline Hover Projection
      if (editorState.currentTool === 'insert') {
        const { worldX, worldZ } = screenToWorld(mouseX, mouseY);
        editorState.hoveredSplineInsert = findSplineInsertPoint(worldX, worldZ);
        draw();
      }
    });

    // Mouse Up
    window.addEventListener('mouseup', () => {
      if (editorState.isPanning) {
        editorState.isPanning = false;
        canvas.style.cursor = editorState.currentTool === 'draw' ? 'crosshair' : 'default';
      }
      if (editorState.isDraggingFeature) {
        editorState.isDraggingFeature = false;
        editorState.dragFeatureIndex = -1;
        syncToGlobalTrackData();
      }
      editorState.isDraggingNode = false;
      editorState.dragNodeIndex = -1;
    });
  }

  function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.code === 'Space' && !editorState.isSpacePressed) {
      editorState.isSpacePressed = true;
      if (editorState.canvas) editorState.canvas.style.cursor = 'grab';
    } else if (e.key === 'p' || e.key === 'P') {
      setTool('draw');
    } else if (e.key === 'v' || e.key === 'V') {
      setTool('select');
    } else if (e.key === 'i' || e.key === 'I') {
      setTool('insert');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelectedNode();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      redo();
    }
  }

  function handleKeyUp(e) {
    if (e.code === 'Space') {
      editorState.isSpacePressed = false;
      if (editorState.canvas) editorState.canvas.style.cursor = editorState.currentTool === 'draw' ? 'crosshair' : 'default';
    }
  }

  // =========================================================================
  // History & Undo / Redo & LocalStorage
  // =========================================================================

  function pushHistory() {
    editorState.undoStack.push(JSON.stringify(editorState.trackData));
    if (editorState.undoStack.length > 40) editorState.undoStack.shift();
    editorState.redoStack = []; // Clear redo stack on new action
    saveDraft();
  }

  function saveDraft() {
    try {
      localStorage.setItem('gamerwheels_rftr_draft', JSON.stringify(editorState.trackData));
    } catch (err) {}
  }

  function undo() {
    if (editorState.undoStack.length === 0) return;
    editorState.redoStack.push(JSON.stringify(editorState.trackData));
    const previous = JSON.parse(editorState.undoStack.pop());
    editorState.trackData = previous;
    editorState.selectedNodeIndex = -1;
    editorState.selectedNodes.clear();
    updateInspector();
    updateLoopTargetUI();
    updateHUD();
    draw();
    saveDraft();
  }

  function redo() {
    if (editorState.redoStack.length === 0) return;
    editorState.undoStack.push(JSON.stringify(editorState.trackData));
    const next = JSON.parse(editorState.redoStack.pop());
    editorState.trackData = next;
    editorState.selectedNodeIndex = -1;
    editorState.selectedNodes.clear();
    updateInspector();
    updateLoopTargetUI();
    updateHUD();
    draw();
    saveDraft();
  }

  function clearTrack() {
    if (editorState.trackData.nodes.length === 0) return;
    if (confirm('Clear all track nodes and start with a fresh blank canvas?')) {
      pushHistory();
      editorState.trackData.nodes = [];
      editorState.trackData.features = [];
      editorState.trackData.loopTargetNode = 1;
      editorState.selectedNodeIndex = -1;
      editorState.selectedNodes.clear();
      updateInspector();
      updateLoopTargetUI();
      updateHUD();
      draw();
    }
  }

  function toggleLoop() {
    pushHistory();
    editorState.trackData.closed = !editorState.trackData.closed;
    const lbl = document.getElementById('lblLoopState');
    if (lbl) lbl.innerText = editorState.trackData.closed ? 'Loop: Closed' : 'Loop: Open';
    updateLoopTargetUI();
    updateHUD();
    draw();
  }

  function togglePickLoopTarget() {
    editorState.isPickingLoopTarget = !editorState.isPickingLoopTarget;
    const btnHeader = document.getElementById('btnConnectLoopNode');
    const btnSidebar = document.getElementById('btnPickLoopNode');

    if (editorState.isPickingLoopTarget) {
      if (btnHeader) btnHeader.classList.add('active');
      if (btnSidebar) btnSidebar.style.background = '#00ffff';
      if (editorState.canvas) editorState.canvas.style.cursor = 'pointer';
    } else {
      if (btnHeader) btnHeader.classList.remove('active');
      if (btnSidebar) btnSidebar.style.background = '';
      setTool(editorState.currentTool);
    }
  }

  function setLoopTargetNode(nodeNum) {
    pushHistory();
    const maxNode = editorState.trackData.nodes.length;
    nodeNum = Math.max(1, Math.min(maxNode, nodeNum));
    editorState.trackData.loopTargetNode = nodeNum;
    editorState.trackData.closed = true; // Automatically ensure closed loop is active
    
    const lblLoop = document.getElementById('lblLoopState');
    if (lblLoop) lblLoop.innerText = 'Loop: Closed';
    
    updateLoopTargetUI();
    updateHUD();
    draw();
    saveDraft();
  }

  function updateLoopTargetUI() {
    const targetNode = editorState.trackData.loopTargetNode || 1;
    const isClosed = editorState.trackData.closed;
    const nodes = editorState.trackData.nodes;

    const lblHeader = document.getElementById('lblLoopTargetNode');
    if (lblHeader) {
      lblHeader.innerText = isClosed ? (targetNode > 1 ? `Node #${targetNode}` : 'Node #1') : 'Open';
    }

    const selectEl = document.getElementById('selectLoopTargetNode');
    if (selectEl) {
      selectEl.innerHTML = '';
      const opt1 = document.createElement('option');
      opt1.value = '1';
      opt1.innerText = 'Node #1 (Full Closed Circuit)';
      selectEl.appendChild(opt1);

      for (let i = 2; i < nodes.length; i++) {
        const opt = document.createElement('option');
        opt.value = i.toString();
        opt.innerText = `Node #${i} (Start Chute #1..#${i} ➔ Lap #${i}..#${nodes.length})`;
        selectEl.appendChild(opt);
      }
      selectEl.value = targetNode.toString();
    }

    const noticeEl = document.getElementById('mergeNotice');
    if (noticeEl) {
      if (!isClosed) {
        noticeEl.innerText = 'Track is Open (Point-to-Point). End does not loop.';
        noticeEl.style.color = '#94a3b8';
      } else if (targetNode > 1 && nodes.length >= targetNode) {
        noticeEl.innerText = `Start Chute: #1 ➔ #${targetNode} | Lap Loop: #${targetNode} ➔ #${nodes.length} ➔ #${targetNode}`;
        noticeEl.style.color = '#10b981';
      } else {
        noticeEl.innerText = 'Full Closed Circuit: Loops from end back to Node #1.';
        noticeEl.style.color = '#38bdf8';
      }
    }
  }

  // =========================================================================
  // Inspector & Grade Editing
  // =========================================================================

  function updateInspector() {
    const noSelectNotice = document.getElementById('noNodeSelectedNotice');
    const form = document.getElementById('nodeSelectedForm');
    const node = editorState.trackData.nodes[editorState.selectedNodeIndex];

    if (!node) {
      if (noSelectNotice) noSelectNotice.style.display = 'block';
      if (form) form.style.display = 'none';
      return;
    }

    if (noSelectNotice) noSelectNotice.style.display = 'none';
    if (form) form.style.display = 'block';

    document.getElementById('inspectNodeIndex').innerText = `#${editorState.selectedNodeIndex + 1}`;
    document.getElementById('inspectNodeCoords').innerText = `${node.x.toFixed(1)}m, ${node.z.toFixed(1)}m`;
    document.getElementById('inspectNodeElevation').value = node.y !== undefined ? node.y : 0;
    document.getElementById('inspectNodeBank').value = node.bank !== undefined ? node.bank : 0;
  }

  function updateSelectedElevation() {
    const node = editorState.trackData.nodes[editorState.selectedNodeIndex];
    if (!node) return;
    pushHistory();
    const val = parseFloat(document.getElementById('inspectNodeElevation').value);
    node.y = isNaN(val) ? 0 : val;
    draw();
  }

  function updateSelectedBank() {
    const node = editorState.trackData.nodes[editorState.selectedNodeIndex];
    if (!node) return;
    pushHistory();
    const val = parseFloat(document.getElementById('inspectNodeBank').value);
    node.bank = isNaN(val) ? 0 : val;
    draw();
  }

  function deleteSelectedNode() {
    if (editorState.selectedNodeIndex === -1) return;
    pushHistory();
    editorState.trackData.nodes.splice(editorState.selectedNodeIndex, 1);
    editorState.selectedNodeIndex = -1;
    editorState.selectedNodes.clear();
    updateInspector();
    updateLoopTargetUI();
    updateHUD();
    draw();
  }

  function applyGradeInterpolation() {
    if (editorState.selectedNodes.size < 2) {
      alert('Hold Shift and click two nodes to select a section to interpolate grade.');
      return;
    }

    const delta = parseFloat(document.getElementById('elevationDelta').value);
    if (isNaN(delta)) {
      alert('Please enter a valid elevation delta (e.g. +6 or -4)');
      return;
    }

    pushHistory();
    const indices = Array.from(editorState.selectedNodes).sort((a, b) => a - b);
    const startIdx = indices[0];
    const endIdx = indices[indices.length - 1];

    const nodes = editorState.trackData.nodes;
    const startY = nodes[startIdx].y || 0;
    const steps = endIdx - startIdx;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Smooth cosine easing
      const smoothProgress = (1 - Math.cos(t * Math.PI)) / 2;
      nodes[startIdx + i].y = Math.round((startY + delta * smoothProgress) * 10) / 10;
    }

    updateInspector();
    draw();
    document.getElementById('elevationDelta').value = '';
  }

  // =========================================================================
  // Spline Math & Curve Generation (Faithful to Three.js CatmullRomCurve3)
  // =========================================================================

  function getSplineSamples(divisions = 400) {
    const nodes = editorState.trackData.nodes;
    if (!nodes || nodes.length < 2) return { points: [], length: 0 };

    const isClosed = editorState.trackData.closed;
    const targetNode = editorState.trackData.loopTargetNode || 1;
    const isChuteCircuit = isClosed && targetNode > 1 && targetNode < nodes.length;

    if (window.THREE && window.THREE.CatmullRomCurve3 && window.THREE.Vector3) {
      if (isChuteCircuit) {
        const targetIdx = targetNode - 1; // e.g. 5 for Node #6
        const chuteNodes = nodes.slice(0, targetIdx + 1);
        const circuitNodes = nodes.slice(targetIdx);

        const chutePts3D = chuteNodes.map(n => new window.THREE.Vector3(n.x, n.y || 0, n.z));
        const circuitPts3D = circuitNodes.map(n => new window.THREE.Vector3(n.x, n.y || 0, n.z));

        const chuteCurve = new window.THREE.CatmullRomCurve3(chutePts3D, false, 'catmullrom', 0.5);
        const circuitCurve = new window.THREE.CatmullRomCurve3(circuitPts3D, true, 'catmullrom', 0.5);

        const chuteSamples = chuteCurve.getPoints(Math.max(20, chuteNodes.length * 15));
        const circuitSamples = circuitCurve.getPoints(Math.max(40, circuitNodes.length * 20));

        return {
          isChuteCircuit: true,
          chuteCurve: chuteCurve,
          circuitCurve: circuitCurve,
          chutePoints: chuteSamples,
          circuitPoints: circuitSamples,
          points: circuitSamples,
          chuteLength: chuteCurve.getLength(),
          circuitLength: circuitCurve.getLength(),
          length: chuteCurve.getLength() + circuitCurve.getLength(),
          mergeNodeIndex: targetIdx
        };
      }

      // Standard single curve
      const points = nodes.map(n => new window.THREE.Vector3(n.x, n.y || 0, n.z));
      const curve = new window.THREE.CatmullRomCurve3(
        points,
        isClosed,
        'catmullrom',
        0.5
      );
      const curvePoints = curve.getPoints(divisions);
      return {
        isChuteCircuit: false,
        curve: curve,
        points: curvePoints,
        length: curve.getLength()
      };
    }

    return computeCentripetalCatmullRom(nodes, isClosed, divisions);
  }

  function computeCentripetalCatmullRom(nodes, isClosed, divisions) {
    const pts = [];
    const n = nodes.length;
    let totalLen = 0;

    const getP = (idx) => {
      if (isClosed) return nodes[(idx % n + n) % n];
      return nodes[Math.max(0, Math.min(n - 1, idx))];
    };

    const segments = isClosed ? n : n - 1;
    const stepsPerSegment = Math.max(10, Math.floor(divisions / segments));

    for (let i = 0; i < segments; i++) {
      const p0 = getP(i - 1);
      const p1 = getP(i);
      const p2 = getP(i + 1);
      const p3 = getP(i + 2);

      for (let s = 0; s < stepsPerSegment; s++) {
        const t = s / stepsPerSegment;
        const pt = catmullRomPoint(p0, p1, p2, p3, t, 0.5);
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          totalLen += Math.hypot(pt.x - last.x, pt.z - last.z);
        }
        pts.push(pt);
      }
    }
    return { points: pts, length: totalLen, curve: null };
  }

  function catmullRomPoint(p0, p1, p2, p3, t, alpha = 0.5) {
    const getT = (t, pA, pB) => t + Math.pow(Math.hypot(pB.x - pA.x, pB.z - pA.z), alpha);
    const t0 = 0;
    const t1 = getT(t0, p0, p1);
    const t2 = getT(t1, p1, p2);
    const t3 = getT(t2, p2, p3);

    const actualT = t1 + t * (t2 - t1);

    const a1x = ((t1 - actualT) * p0.x + (actualT - t0) * p1.x) / (t1 - t0 || 1);
    const a1z = ((t1 - actualT) * p0.z + (actualT - t0) * p1.z) / (t1 - t0 || 1);

    const a2x = ((t2 - actualT) * p1.x + (actualT - t1) * p2.x) / (t2 - t1 || 1);
    const a2z = ((t2 - actualT) * p1.z + (actualT - t1) * p2.z) / (t2 - t1 || 1);

    const a3x = ((t3 - actualT) * p2.x + (actualT - t2) * p3.x) / (t3 - t2 || 1);
    const a3z = ((t3 - actualT) * p2.z + (actualT - t2) * p3.z) / (t3 - t2 || 1);

    const b1x = ((t2 - actualT) * a1x + (actualT - t0) * a2x) / (t2 - t0 || 1);
    const b1z = ((t2 - actualT) * a1z + (actualT - t0) * a2z) / (t2 - t0 || 1);

    const b2x = ((t3 - actualT) * a2x + (actualT - t1) * a3x) / (t3 - t1 || 1);
    const b2z = ((t3 - actualT) * a2z + (actualT - t1) * a3z) / (t3 - t1 || 1);

    const cx = ((t2 - actualT) * b1x + (actualT - t1) * b2x) / (t2 - t1 || 1);
    const cz = ((t2 - actualT) * b1z + (actualT - t1) * b2z) / (t2 - t1 || 1);

    return { x: cx, y: p1.y + t * (p2.y - p1.y), z: cz };
  }

  function findNodeAtScreen(screenX, screenY) {
    const { worldX, worldZ } = screenToWorld(screenX, screenY);
    const nodes = editorState.trackData.nodes;
    const hitRadiusWorld = 16 / editorState.scale; // 16px screen tolerance

    for (let i = 0; i < nodes.length; i++) {
      const dist = Math.hypot(nodes[i].x - worldX, nodes[i].z - worldZ);
      if (dist <= hitRadiusWorld) return i;
    }
    return -1;
  }

  function findSplineInsertPoint(worldX, worldZ) {
    const nodes = editorState.trackData.nodes;
    if (nodes.length < 2) return null;

    let closestDist = Infinity;
    let bestInsertIdx = -1;
    let projX = 0, projZ = 0;

    const count = editorState.trackData.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const p1 = nodes[i];
      const p2 = nodes[(i + 1) % nodes.length];

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 0.001) continue;

      let t = ((worldX - p1.x) * dx + (worldZ - p1.z) * dz) / lenSq;
      t = Math.max(0.05, Math.min(0.95, t));

      const nearX = p1.x + t * dx;
      const nearZ = p1.z + t * dz;
      const dist = Math.hypot(worldX - nearX, worldZ - nearZ);

      if (dist < closestDist) {
        closestDist = dist;
        bestInsertIdx = i + 1;
        projX = nearX;
        projZ = nearZ;
      }
    }

    if (closestDist < (25 / editorState.scale)) {
      return { x: projX, z: projZ, insertIdx: bestInsertIdx, prevIdx: bestInsertIdx - 1 };
    }
    return null;
  }

  // =========================================================================
  // Canvas Rendering
  // =========================================================================

  function worldToScreen(worldX, worldZ) {
    return {
      screenX: editorState.offsetX + (worldX * editorState.scale),
      screenY: editorState.offsetY + (worldZ * editorState.scale)
    };
  }

  function screenToWorld(screenX, screenY) {
    return {
      worldX: (screenX - editorState.offsetX) / editorState.scale,
      worldZ: (screenY - editorState.offsetY) / editorState.scale
    };
  }

  function drawSplineRibbonAndLine(ctx, pts, strokeColor, shadowColor, isChute) {
    if (!pts || pts.length < 2) return;

    // Draw Ribbon Path
    if (editorState.showRibbon) {
      const halfW = (editorState.trackData.width || 5.0) / 2 * editorState.scale;
      ctx.fillStyle = isChute ? 'rgba(180, 120, 60, 0.35)' : 'rgba(120, 90, 60, 0.35)';
      ctx.strokeStyle = isChute ? 'rgba(255, 200, 100, 0.25)' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const curr = worldToScreen(pts[i].x, pts[i].z);
        const next = worldToScreen(pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].z);
        const dx = next.screenX - curr.screenX;
        const dy = next.screenY - curr.screenY;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        const leftX = curr.screenX + nx * halfW;
        const leftY = curr.screenY + ny * halfW;

        if (i === 0) ctx.moveTo(leftX, leftY);
        else ctx.lineTo(leftX, leftY);
      }

      for (let i = pts.length - 1; i >= 0; i--) {
        const curr = worldToScreen(pts[i].x, pts[i].z);
        const next = worldToScreen(pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].z);
        const dx = next.screenX - curr.screenX;
        const dy = next.screenY - curr.screenY;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        const rightX = curr.screenX - nx * halfW;
        const rightY = curr.screenY - ny * halfW;
        ctx.lineTo(rightX, rightY);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Draw Centerline
    ctx.save();
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = strokeColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < pts.length; i++) {
      const { screenX, screenY } = worldToScreen(pts[i].x, pts[i].z);
      if (i === 0) ctx.moveTo(screenX, screenY);
      else ctx.lineTo(screenX, screenY);
    }
    ctx.stroke();
    ctx.restore();

    // Draw direction chevrons
    ctx.fillStyle = '#ffffff';
    let distAccum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const pA = worldToScreen(pts[i].x, pts[i].z);
      const pB = worldToScreen(pts[i + 1].x, pts[i + 1].z);
      const d = Math.hypot(pB.screenX - pA.screenX, pB.screenY - pA.screenY);
      distAccum += d;

      if (distAccum > 60) {
        distAccum = 0;
        const angle = Math.atan2(pB.screenY - pA.screenY, pB.screenX - pA.screenX);
        ctx.save();
        ctx.translate(pB.screenX, pB.screenY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(-6, -4);
        ctx.lineTo(4, 0);
        ctx.lineTo(-6, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function draw() {
    const ctx = editorState.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, editorState.width, editorState.height);

    // 1. Draw Satellite Map Background (Clean or Marked Reference Map from image.png)
    const activeImg = (editorState.showReferenceMap && editorState.refImg && editorState.refImg.complete)
      ? editorState.refImg
      : editorState.img;

    if (activeImg && activeImg.complete) {
      const imgW = activeImg.width;
      const imgH = activeImg.height;
      const drawW = imgW * 1.5 * (editorState.scale / 4.0);
      const drawH = imgH * 1.5 * (editorState.scale / 4.0);

      ctx.save();
      ctx.globalAlpha = editorState.showReferenceMap ? 0.95 : 0.85;
      ctx.drawImage(
        activeImg,
        editorState.offsetX - drawW / 2,
        editorState.offsetY - drawH / 2,
        drawW,
        drawH
      );
      ctx.restore();
    }

    // 2. Draw World Origin Crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(editorState.offsetX - 20, editorState.offsetY);
    ctx.lineTo(editorState.offsetX + 20, editorState.offsetY);
    ctx.moveTo(editorState.offsetX, editorState.offsetY - 20);
    ctx.lineTo(editorState.offsetX, editorState.offsetY + 20);
    ctx.stroke();

    const nodes = editorState.trackData.nodes;
    if (!nodes || nodes.length === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '16px Space Grotesk, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click anywhere on the satellite image to start drawing your track spline', editorState.width / 2, editorState.height / 2);
      return;
    }

    const splineData = getSplineSamples(nodes.length * 30);

    // 3. Draw Splines & Ribbons
    if (splineData.isChuteCircuit) {
      // Draw Start Chute
      drawSplineRibbonAndLine(ctx, splineData.chutePoints, '#38bdf8', '#0284c7', true);
      // Draw Main Circuit Loop
      drawSplineRibbonAndLine(ctx, splineData.circuitPoints, '#00ffff', '#00ffff', false);

      // Draw Merge Marker on Merge Node
      const mergeNode = nodes[splineData.mergeNodeIndex];
      if (mergeNode) {
        const { screenX, screenY } = worldToScreen(mergeNode.x, mergeNode.z);
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenX, screenY, 15, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.stroke();

        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 10px Space Grotesk, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`MERGE POINT (#${splineData.mergeNodeIndex + 1})`, screenX, screenY - 18);
        ctx.restore();
      }
    } else {
      drawSplineRibbonAndLine(ctx, splineData.points, '#00ffff', '#00ffff', false);
    }

    // 4. Draw Insert Hover Indicator
    if (editorState.currentTool === 'insert' && editorState.hoveredSplineInsert) {
      const ins = editorState.hoveredSplineInsert;
      const { screenX, screenY } = worldToScreen(ins.x, ins.z);
      ctx.beginPath();
      ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    // 5. Draw Control Nodes
    const targetNodeIdx = (editorState.trackData.loopTargetNode || 1) - 1;
    for (let i = 0; i < nodes.length; i++) {
      const { screenX, screenY } = worldToScreen(nodes[i].x, nodes[i].z);
      const isSelected = editorState.selectedNodes.has(i) || editorState.selectedNodeIndex === i;
      const isHovered = editorState.hoveredNodeIndex === i;
      const isMergeNode = splineData.isChuteCircuit && i === targetNodeIdx;

      ctx.beginPath();
      ctx.arc(screenX, screenY, isSelected ? 8 : (isHovered ? 7 : 5.5), 0, Math.PI * 2);

      if (isSelected) {
        ctx.fillStyle = '#facc15'; // Bright yellow selected
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2.5;
      } else if (isMergeNode) {
        ctx.fillStyle = '#f59e0b'; // Amber merge target
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
      } else if (i === 0) {
        ctx.fillStyle = '#10b981'; // Green start chute node
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
      } else if (i === nodes.length - 1 && !editorState.trackData.closed) {
        ctx.fillStyle = '#ef233c'; // Red end node
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
      } else {
        const y = nodes[i].y || 0;
        if (y > 10) ctx.fillStyle = '#34d399';
        else if (y < 4) ctx.fillStyle = '#f87171';
        else ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
      }

      ctx.fill();
      ctx.stroke();

      // Node Index Badge
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`#${i + 1}`, screenX + 9, screenY - 5);

      // Node Elevation Label
      if (editorState.showLabels) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px JetBrains Mono, monospace';
        const yVal = (nodes[i].y !== undefined ? nodes[i].y : 0).toFixed(1);
        ctx.fillText(`${yVal}m`, screenX + 9, screenY + 7);
      }
    }

    // 6. Draw Features & Numbered RFTR Pins
    const features = editorState.trackData.features || [];
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      let wx, wz;
      if (f.x !== undefined && f.z !== undefined) {
        wx = f.x;
        wz = f.z;
      } else if (f.nodeIndex !== undefined && nodes[f.nodeIndex]) {
        wx = nodes[f.nodeIndex].x;
        wz = nodes[f.nodeIndex].z;
      } else if (f.t !== undefined) {
        const idx = Math.floor(f.t * nodes.length) % nodes.length;
        wx = nodes[idx].x;
        wz = nodes[idx].z;
      } else {
        continue;
      }

      const { screenX, screenY } = worldToScreen(wx, wz);
      const isSelected = (editorState.selectedFeatureIndex === i);
      const isHovered = (editorState.hoveredFeatureIndex === i);
      const isDragging = (editorState.isDraggingFeature && editorState.dragFeatureIndex === i);

      if (f.number !== undefined || f.type === 'rftr_feature') {
        // High-vis Numbered Blue Feature Pin matching RFTR image.png
        ctx.save();

        // Glow halo if selected / hovered / dragging
        if (isSelected || isHovered || isDragging) {
          ctx.beginPath();
          ctx.arc(screenX, screenY - 14, 22, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? 'rgba(0, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.3)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = isSelected ? '#00ffff' : '#ffffff';
          ctx.stroke();
        }

        // Pointer triangle extending down to track ribbon
        ctx.beginPath();
        ctx.moveTo(screenX - 7, screenY - 7);
        ctx.lineTo(screenX, screenY + 2);
        ctx.lineTo(screenX + 7, screenY - 7);
        ctx.closePath();
        ctx.fillStyle = '#0284c7';
        ctx.fill();

        // Circular Badge Disc
        ctx.beginPath();
        ctx.arc(screenX, screenY - 14, 15, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = isSelected ? '#00ffff' : '#ffffff';
        ctx.stroke();

        // Bold white number text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.number !== undefined ? String(f.number) : 'F', screenX, screenY - 13);

        // Feature Name Capsule Label (Above Pin)
        const featName = (f.name || ('Feature ' + (f.number || (i + 1)))).toUpperCase();
        ctx.font = 'bold 10px "Space Grotesk", sans-serif';
        const textW = ctx.measureText(featName).width;
        const pillW = textW + 14;
        const pillH = 18;
        const pillX = screenX - pillW / 2;
        const pillY = screenY - 42;

        ctx.fillStyle = isSelected ? 'rgba(2, 132, 199, 0.95)' : 'rgba(15, 23, 42, 0.88)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(pillX, pillY, pillW, pillH, 4);
        } else {
          ctx.rect(pillX, pillY, pillW, pillH);
        }
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = isSelected ? '#00ffff' : 'rgba(255, 255, 255, 0.25)';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(featName, screenX, pillY + 9);

        ctx.restore();
      } else {
        // Other feature gates (start chute, finish line, kickers)
        ctx.beginPath();
        ctx.rect(screenX - 12, screenY - 12, 24, 24);

        if (f.type.includes('start')) {
          ctx.fillStyle = '#10b981';
          ctx.strokeStyle = '#ffffff';
        } else if (f.type.includes('finish')) {
          ctx.fillStyle = '#f59e0b';
          ctx.strokeStyle = '#ffffff';
        } else {
          ctx.fillStyle = '#8b5cf6';
          ctx.strokeStyle = '#ffffff';
        }

        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Space Grotesk, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText((f.name || f.type).toUpperCase(), screenX + 16, screenY + 4);
      }
    }
  }

  function updateHUD() {
    const nodes = editorState.trackData.nodes;
    document.getElementById('hudNodeCount').innerText = nodes.length;

    const targetNode = editorState.trackData.loopTargetNode || 1;
    let loopText = 'Open';
    if (editorState.trackData.closed) {
      if (targetNode > 1 && nodes.length > 0) {
        loopText = `#${nodes.length} ➔ #${targetNode}`;
      } else {
        loopText = 'Closed (#1)';
      }
    }
    document.getElementById('hudLoopStatus').innerText = loopText;
    document.getElementById('hudZoom').innerText = `${Math.round(editorState.scale * 25)}%`;

    const splineData = getSplineSamples(nodes.length * 20);
    if (splineData.isChuteCircuit) {
      document.getElementById('hudLength').innerText = `${splineData.length.toFixed(1)}m (Lap: ${splineData.circuitLength.toFixed(1)}m, Chute: ${splineData.chuteLength.toFixed(1)}m)`;
    } else {
      const len = splineData.length || 0;
      document.getElementById('hudLength').innerText = `${len.toFixed(1)}m`;
    }
  }

  function handleTokenDrop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if (!type || !editorState.trackData.nodes.length) return;

    const rect = editorState.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { worldX, worldZ } = screenToWorld(mouseX, mouseY);

    const nodes = editorState.trackData.nodes;
    let minDist = Infinity;
    let minIdx = 0;

    for (let i = 0; i < nodes.length; i++) {
      const dist = Math.hypot(nodes[i].x - worldX, nodes[i].z - worldZ);
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }

    pushHistory();
    editorState.trackData.features.push({
      type: type,
      t: Math.round((minIdx / nodes.length) * 100) / 100,
      length: type === 'tabletop' ? 6.0 : (type.includes('start') || type.includes('finish') ? 4.0 : 3.0),
      height: type === 'tabletop' ? 1.5 : (type === 'kicker' ? 2.0 : 0)
    });

    draw();
  }

  // =========================================================================
  // Export & Import Handlers
  // =========================================================================

  function generateExportJSON() {
    const nodes = editorState.trackData.nodes;
    const spawnNode = nodes.length > 0 ? nodes[0] : { x: 0, y: 1.0, z: 0 };
    const splineData = getSplineSamples(nodes.length * 20);

    const exportObj = {
      name: editorState.trackData.name || 'Hollister Hills RFTR',
      version: '2.0',
      exportedAt: new Date().toISOString(),
      closed: editorState.trackData.closed,
      loopTargetNode: editorState.trackData.loopTargetNode || 1,
      isChuteCircuit: Boolean(splineData.isChuteCircuit),
      width: editorState.trackData.width || 5.0,
      surfaceMaterial: editorState.trackData.surfaceMaterial || 'dirt',
      totalLengthMeters: splineData.length || 0,
      chuteLengthMeters: splineData.chuteLength || 0,
      circuitLengthMeters: splineData.circuitLength || (splineData.length || 0),
      nodes: nodes.map(n => ({
        x: Math.round(n.x * 100) / 100,
        y: Math.round((n.y !== undefined ? n.y : 1.0) * 100) / 100,
        z: Math.round(n.z * 100) / 100,
        bank: n.bank || 0,
        ...(n.w ? { w: n.w } : {})
      })),
      features: editorState.trackData.features || [],
      spawn: {
        x: spawnNode.x,
        y: (spawnNode.y || 0) + 1.0,
        z: spawnNode.z,
        heading: 0
      },
      checkpoints: [
        { name: 'Start Gate', t: 0.0 }
      ]
    };
    return JSON.stringify(exportObj, null, 2);
  }

  function openExportModal() {
    const jsonStr = generateExportJSON();
    document.getElementById('txtExportJSON').value = jsonStr;
    document.getElementById('editorExportModal').style.display = 'flex';
  }

  function closeExportModal() {
    document.getElementById('editorExportModal').style.display = 'none';
  }

  function copyExportJSON() {
    const txt = document.getElementById('txtExportJSON').value;
    navigator.clipboard.writeText(txt).then(() => {
      const btn = document.getElementById('btnCopyExportJSON');
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copied to Clipboard!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }).catch(err => {
      alert('Failed to copy. Please manually copy from the box.');
    });
  }

  function downloadExportJSON() {
    const jsonStr = document.getElementById('txtExportJSON').value;
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rftr_track_outline.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openImportModal() {
    document.getElementById('txtImportJSON').value = '';
    document.getElementById('editorImportModal').style.display = 'flex';
  }

  function closeImportModal() {
    document.getElementById('editorImportModal').style.display = 'none';
  }

  function handleFileInput(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      document.getElementById('txtImportJSON').value = event.target.result;
    };
    reader.readAsText(file);
  }

  function confirmImportJSON() {
    const text = document.getElementById('txtImportJSON').value.trim();
    if (!text) {
      alert('Please paste or choose a JSON file first.');
      return;
    }

    try {
      const parsed = JSON.parse(text);
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        alert('Invalid format: JSON must contain a "nodes" array.');
        return;
      }

      pushHistory();
      editorState.trackData.nodes = parsed.nodes;
      if (parsed.closed !== undefined) editorState.trackData.closed = parsed.closed;
      if (parsed.loopTargetNode !== undefined) editorState.trackData.loopTargetNode = parsed.loopTargetNode;
      if (parsed.width !== undefined) {
        editorState.trackData.width = parsed.width;
        document.getElementById('inputTrackWidth').value = parsed.width;
        document.getElementById('lblTrackWidth').innerText = `${parsed.width}m`;
      }
      if (parsed.features) editorState.trackData.features = parsed.features;
      if (parsed.name) editorState.trackData.name = parsed.name;

      closeImportModal();
      resetView();
      updateLoopTargetUI();
      updateHUD();
      draw();
      alert(`Loaded track outline with ${parsed.nodes.length} spline nodes!`);
    } catch (err) {
      alert(`Failed to parse JSON: ${err.message}`);
    }
  }

  window.initEditor = initEditor;
  window.updateNumberedFeaturesUI = updateNumberedFeaturesUI;

  function syncToGlobalTrackData() {
    window.TRACK_DATA_HOLLISTER = JSON.parse(JSON.stringify(editorState.trackData));
    console.log('✅ Synchronized editor track data with window.TRACK_DATA_HOLLISTER', window.TRACK_DATA_HOLLISTER);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
