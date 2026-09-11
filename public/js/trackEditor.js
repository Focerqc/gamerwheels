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
    
    // Tools: 'pan' | 'draw' | 'select' | 'insert'
    currentTool: 'pan',
    
    // Interaction
    isDraggingNode: false,
    dragNodeIndex: -1,
    hoveredNodeIndex: -1,
    selectedNodeIndex: -1,
    selectedNodes: new Set(),
    hoveredSplineInsert: null, // { worldX, worldZ, insertIdx }
    isPickingLoopTarget: false,

    // Feature Dragging
    isDraggingFeature: false,
    dragFeatureIndex: -1,
    hoveredFeatureIndex: -1,
    selectedFeatureIndex: -1,

    // Foliage & Tree Tool State
    selectedTreeIndex: -1,
    hoveredTreeIndex: -1,
    isDraggingTree: false,
    treeBrushType: 'mature_oak', // 'mature_oak' | 'mid_oak' | 'bush'
    treeBrushScale: 1.0,
    treeCursorWorld: null,
    
    // Track Definition
    trackData: {
      name: 'Hollister Hills RFTR',
      closed: true,
      loopTargetNode: 1, // 1 = full loop back to #1; >1 = start chute merging into node K
      width: 5.0,
      surfaceMaterial: 'dirt',
      nodes: [],
      features: [],
      scenery: [],
      spawn: { x: 0, y: 1.0, z: 0, heading: 0 },
      checkpoints: []
    },
    
    // History (Undo / Redo)
    undoStack: [],
    redoStack: [],
    
    // Settings
    showRibbon: true,
    showLabels: true,
    showGhostPath: true,
    editGhostMode: false,
    hoveredGhostIndex: -1,
    selectedGhostIndex: -1,
    isDraggingGhostNode: false,
    elevationColorMode: 'off', // 'off' | 'track' | 'ghost' (Default: off)
    elevationLabelMode: 'color', // 'color' | 'plain' | 'off' (Default: color)
    
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

    // 3D Inspection Mode
    function enter3DInspection() {
      syncToGlobalTrackData();
      saveDraft();

      // Compile current track directly into Three.js scene
      if (typeof window.loadTrackMap === 'function') {
        window.loadTrackMap('RFTR_Hollister', window.TRACK_DATA_HOLLISTER);
      }

      // Switch camera to inspect mode
      if (window.GamerWheels && window.GamerWheels.setCameraMode) {
        if (editorState.selectedFeatureIndex !== -1 && editorState.trackData.features && editorState.trackData.features[editorState.selectedFeatureIndex]) {
          const feat = editorState.trackData.features[editorState.selectedFeatureIndex];
          window.GamerWheels.focusFeature(feat);
        } else if (editorState.selectedNodeIndex !== -1 && editorState.trackData.nodes && editorState.trackData.nodes[editorState.selectedNodeIndex]) {
          const n = editorState.trackData.nodes[editorState.selectedNodeIndex];
          window.GamerWheels.setCameraMode('inspect', { x: n.x, y: n.y || 0, z: n.z });
        } else {
          window.GamerWheels.setCameraMode('inspect');
        }
      }

      populate3DFocusSelector();

      const cont = document.getElementById('trackEditorContainer');
      if (cont) cont.classList.add('view-3d-active');

      const bar = document.getElementById('editor3DInspectionBar');
      if (bar) bar.style.display = 'flex';

      const tips = document.getElementById('editor3DInspectionTips');
      if (tips) tips.style.display = 'block';
    }

    function exit3DInspection() {
      const cont = document.getElementById('trackEditorContainer');
      if (cont) cont.classList.remove('view-3d-active');

      const bar = document.getElementById('editor3DInspectionBar');
      if (bar) bar.style.display = 'none';

      const tips = document.getElementById('editor3DInspectionTips');
      if (tips) tips.style.display = 'none';

      draw();
    }

    function toggle3DInspection() {
      const cont = document.getElementById('trackEditorContainer');
      if (cont && cont.classList.contains('view-3d-active')) {
        exit3DInspection();
      } else {
        enter3DInspection();
      }
    }

    function populate3DFocusSelector() {
      const sel = document.getElementById('select3DFocusFeature');
      if (!sel) return;
      sel.innerHTML = '';

      const optSpawn = document.createElement('option');
      optSpawn.value = 'spawn';
      optSpawn.textContent = '🏁 Start Chute / Spawn';
      sel.appendChild(optSpawn);

      const features = editorState.trackData.features || [];
      features.forEach((feat, idx) => {
        const opt = document.createElement('option');
        opt.value = `feat_${idx}`;
        const name = feat.name || (feat.type === 'kicker' ? 'Kicker' : (feat.type === 'tabletop' ? 'Lilypad' : feat.type));
        const numStr = feat.number ? `#${feat.number} ` : '';
        opt.textContent = `🎯 ${numStr}${name} (${feat.type})`;
        if (editorState.selectedFeatureIndex === idx) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      });

      const optFinish = document.createElement('option');
      optFinish.value = 'finish';
      optFinish.textContent = '🏁 Finish Line Gate';
      sel.appendChild(optFinish);
    }

    const btnToggle3DInspect = document.getElementById('btnToggle3DInspect');
    if (btnToggle3DInspect) {
      btnToggle3DInspect.addEventListener('click', toggle3DInspection);
    }

    const btnExit3DInspect = document.getElementById('btnExit3DInspect');
    if (btnExit3DInspect) {
      btnExit3DInspect.addEventListener('click', exit3DInspection);
    }

    const sel3DFocus = document.getElementById('select3DFocusFeature');
    if (sel3DFocus) {
      sel3DFocus.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'spawn') {
          const spawn = editorState.trackData.spawn || { x: 160, y: 1.5, z: -69.1 };
          if (window.GamerWheels && window.GamerWheels.setCameraMode) {
            window.GamerWheels.setCameraMode('inspect', spawn);
          }
        } else if (val.startsWith('feat_')) {
          const fIdx = parseInt(val.replace('feat_', ''), 10);
          const feat = editorState.trackData.features[fIdx];
          if (feat && window.GamerWheels && window.GamerWheels.focusFeature) {
            window.GamerWheels.focusFeature(feat);
          }
        } else if (val === 'finish') {
          const nodes = editorState.trackData.nodes;
          if (nodes && nodes.length > 0) {
            const last = nodes[nodes.length - 1];
            if (window.GamerWheels && window.GamerWheels.setCameraMode) {
              window.GamerWheels.setCameraMode('inspect', { x: last.x, y: last.y || 0, z: last.z });
            }
          }
        }
      });
    }

    const btn3DPresetIso = document.getElementById('btn3DPresetIso');
    if (btn3DPresetIso) {
      btn3DPresetIso.addEventListener('click', () => {
        if (window.GamerWheels && window.GamerWheels.setCameraMode) {
          window.GamerWheels.setCameraMode('isometric');
        }
        btn3DPresetIso.classList.add('active');
        document.getElementById('btn3DPresetTop')?.classList.remove('active');
        document.getElementById('btn3DPresetOrbit')?.classList.remove('active');
      });
    }

    const btn3DPresetTop = document.getElementById('btn3DPresetTop');
    if (btn3DPresetTop) {
      btn3DPresetTop.addEventListener('click', () => {
        if (window.GamerWheels && window.GamerWheels.setCameraMode) {
          window.GamerWheels.setCameraMode('topdown');
        }
        btn3DPresetTop.classList.add('active');
        document.getElementById('btn3DPresetIso')?.classList.remove('active');
        document.getElementById('btn3DPresetOrbit')?.classList.remove('active');
      });
    }

    const btn3DPresetOrbit = document.getElementById('btn3DPresetOrbit');
    if (btn3DPresetOrbit) {
      btn3DPresetOrbit.addEventListener('click', () => {
        if (window.GamerWheels && window.GamerWheels.setCameraMode) {
          window.GamerWheels.setCameraMode('inspect');
        }
        btn3DPresetOrbit.classList.add('active');
        document.getElementById('btn3DPresetIso')?.classList.remove('active');
        document.getElementById('btn3DPresetTop')?.classList.remove('active');
      });
    }

    const btn3DPlaytestRide = document.getElementById('btn3DPlaytestRide');
    if (btn3DPlaytestRide) {
      btn3DPlaytestRide.addEventListener('click', () => {
        exit3DInspection();
        window.closeTrackStudio();
        if (window.GamerWheels && window.GamerWheels.setCameraMode) {
          window.GamerWheels.setCameraMode('follow');
        }
      });
    }

    const btnExitEditor = document.getElementById('btnExitEditor');
    if (btnExitEditor) {
      btnExitEditor.addEventListener('click', () => {
        exit3DInspection();
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
    const btnToolPan = document.getElementById('btnToolPan');
    if (btnToolPan) btnToolPan.addEventListener('click', () => setTool('pan'));
    const btnToolDraw = document.getElementById('btnToolDraw');
    if (btnToolDraw) btnToolDraw.addEventListener('click', () => setTool('draw'));
    const btnToolSelect = document.getElementById('btnToolSelect');
    if (btnToolSelect) btnToolSelect.addEventListener('click', () => setTool('select'));
    const btnToolInsert = document.getElementById('btnToolInsert');
    if (btnToolInsert) btnToolInsert.addEventListener('click', () => setTool('insert'));
    const btnToolTree = document.getElementById('btnToolTree');
    if (btnToolTree) btnToolTree.addEventListener('click', () => setTool('tree'));

    // Foliage Brush & Inspector Events
    const selectFoliageType = document.getElementById('selectFoliageType');
    if (selectFoliageType) {
      selectFoliageType.addEventListener('change', (e) => {
        editorState.treeBrushType = e.target.value;
      });
    }

    const inputFoliageScale = document.getElementById('inputFoliageScale');
    if (inputFoliageScale) {
      inputFoliageScale.addEventListener('input', (e) => {
        editorState.treeBrushScale = parseFloat(e.target.value);
        const lbl = document.getElementById('lblFoliageScale');
        if (lbl) lbl.innerText = `${editorState.treeBrushScale.toFixed(1)}x`;
        draw();
      });
    }

    setupStepper('btnScaleDown', 'btnScaleUp', 'inputFoliageScale', 0.1, () => {
      editorState.treeBrushScale = parseFloat(document.getElementById('inputFoliageScale').value);
      const lbl = document.getElementById('lblFoliageScale');
      if (lbl) lbl.innerText = `${editorState.treeBrushScale.toFixed(1)}x`;
      draw();
    });

    const selectInspectTreeType = document.getElementById('selectInspectTreeType');
    if (selectInspectTreeType) {
      selectInspectTreeType.addEventListener('change', (e) => {
        if (editorState.selectedTreeIndex !== -1 && editorState.trackData.scenery) {
          const t = editorState.trackData.scenery[editorState.selectedTreeIndex];
          if (t) {
            pushHistory();
            t.type = e.target.value;
            syncToGlobalTrackData();
            saveDraft();
            updateFoliageUI();
            draw();
          }
        }
      });
    }

    const inputInspectTreeScale = document.getElementById('inputInspectTreeScale');
    if (inputInspectTreeScale) {
      inputInspectTreeScale.addEventListener('input', (e) => {
        if (editorState.selectedTreeIndex !== -1 && editorState.trackData.scenery) {
          const t = editorState.trackData.scenery[editorState.selectedTreeIndex];
          if (t) {
            t.scale = parseFloat(e.target.value);
            const lbl = document.getElementById('lblInspectTreeScale');
            if (lbl) lbl.innerText = `${t.scale.toFixed(1)}x`;
            syncToGlobalTrackData();
            saveDraft();
            draw();
          }
        }
      });
    }

    const btnDeleteTree = document.getElementById('btnDeleteSelectedTree');
    if (btnDeleteTree) {
      btnDeleteTree.addEventListener('click', () => {
        if (editorState.selectedTreeIndex !== -1) {
          deleteTreeAtIndex(editorState.selectedTreeIndex);
        }
      });
    }

    const btnResetFoliage = document.getElementById('btnResetPhotoFoliage');
    if (btnResetFoliage) {
      btnResetFoliage.addEventListener('click', resetToPhotoAccurateFoliage);
    }

    const btnAutoClean = document.getElementById('btnAutoCleanTrackTrees');
    if (btnAutoClean) {
      btnAutoClean.addEventListener('click', autoCleanTrackTrees);
    }

    const btnClearTrees = document.getElementById('btnClearAllTrees');
    if (btnClearTrees) {
      btnClearTrees.addEventListener('click', () => {
        if (!editorState.trackData.scenery || editorState.trackData.scenery.length === 0) return;
        if (confirm('Clear all trees and bushes from the map?')) {
          pushHistory();
          editorState.trackData.scenery = [];
          editorState.selectedTreeIndex = -1;
          syncToGlobalTrackData();
          saveDraft();
          updateFoliageUI();
          draw();
        }
      });
    }

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
    const inputElev = document.getElementById('inspectNodeElevation');
    if (inputElev) {
      inputElev.addEventListener('input', () => updateSelectedElevation(false));
      inputElev.addEventListener('change', () => updateSelectedElevation(true));
      inputElev.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          updateSelectedElevation(true);
          inputElev.blur();
        }
      });
    }

    const inputBank = document.getElementById('inspectNodeBank');
    if (inputBank) {
      inputBank.addEventListener('input', () => updateSelectedBank(false));
      inputBank.addEventListener('change', () => updateSelectedBank(true));
      inputBank.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          updateSelectedBank(true);
          inputBank.blur();
        }
      });
    }

    const inputDelta = document.getElementById('elevationDelta');
    if (inputDelta) {
      inputDelta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          applyGradeInterpolation();
        }
      });
    }

    document.getElementById('btnUpdateElevation').addEventListener('click', () => updateSelectedElevation(true));
    document.getElementById('btnUpdateBank').addEventListener('click', () => updateSelectedBank(true));
    document.getElementById('btnDeleteSelectedNode').addEventListener('click', deleteSelectedNode);
    document.getElementById('btnApplyElevation').addEventListener('click', applyGradeInterpolation);

    setupStepper('btnElevationDown', 'btnElevationUp', 'inspectNodeElevation', 0.5, updateSelectedElevation);
    setupStepper('btnBankDown', 'btnBankUp', 'inspectNodeBank', 1, updateSelectedBank);
    setupStepper('btnDeltaDown', 'btnDeltaUp', 'elevationDelta', 0.5, null);

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

    // Sidebar Numbered Feature Add Button
    const btnAddNum = document.getElementById('btnAddNumberedFeature');
    if (btnAddNum) {
      btnAddNum.addEventListener('click', () => addNumberedFeature());
    }

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
    const btnPan = document.getElementById('btnToolPan');
    if (btnPan) btnPan.classList.toggle('active', tool === 'pan');
    const btnDraw = document.getElementById('btnToolDraw');
    if (btnDraw) btnDraw.classList.toggle('active', tool === 'draw');
    const btnSelect = document.getElementById('btnToolSelect');
    if (btnSelect) btnSelect.classList.toggle('active', tool === 'select');
    const btnInsert = document.getElementById('btnToolInsert');
    if (btnInsert) btnInsert.classList.toggle('active', tool === 'insert');
    const btnTree = document.getElementById('btnToolTree');
    if (btnTree) btnTree.classList.toggle('active', tool === 'tree');
    
    // Toggle Foliage Panel visibility in sidebar based on active tool
    const foliagePanel = document.getElementById('foliagePanel');
    if (foliagePanel) {
      foliagePanel.style.display = (tool === 'tree') ? 'block' : 'none';
    }

    // Canvas cursor
    if (editorState.canvas) {
      if (tool === 'pan') editorState.canvas.style.cursor = 'grab';
      else if (tool === 'draw') editorState.canvas.style.cursor = 'crosshair';
      else if (tool === 'select') editorState.canvas.style.cursor = 'default';
      else if (tool === 'insert') editorState.canvas.style.cursor = 'cell';
      else if (tool === 'tree') editorState.canvas.style.cursor = 'crosshair';
    }
    draw();
  }

  function initEditor() {
    // Always refresh ghostData & trackData from window.TRACK_DATA_HOLLISTER
    if (window.TRACK_DATA_HOLLISTER) {
      if (window.TRACK_DATA_HOLLISTER.ghostData) {
        editorState.trackData.ghostData = JSON.parse(JSON.stringify(window.TRACK_DATA_HOLLISTER.ghostData));
      }
      if (!editorState.trackData.nodes || editorState.trackData.nodes.length === 0) {
        editorState.trackData = JSON.parse(JSON.stringify(window.TRACK_DATA_HOLLISTER));
      }
    }

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
      // Load Satellite BG Image
      editorState.img = new Image();
      editorState.img.src = 'images/rftr_img.png';
      editorState.img.onload = () => {
        resetView();
        draw();
      };

      // Only initialize trackData if not already loaded in this active session
      if (!editorState.trackData) {
        try {
          const saved = localStorage.getItem('gamerwheels_rftr_draft');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.nodes && parsed.nodes.length > 0) {
              editorState.trackData = parsed;
            } else if (window.TRACK_DATA_HOLLISTER) {
              editorState.trackData = JSON.parse(JSON.stringify(window.TRACK_DATA_HOLLISTER));
            }
          } else if (window.TRACK_DATA_HOLLISTER) {
            editorState.trackData = JSON.parse(JSON.stringify(window.TRACK_DATA_HOLLISTER));
          }
        } catch (err) {
          if (window.TRACK_DATA_HOLLISTER) {
            editorState.trackData = JSON.parse(JSON.stringify(window.TRACK_DATA_HOLLISTER));
          }
        }
      }

      saveDraft();
      updateNumberedFeaturesUI();

      setupCanvasEvents(canvas);

      // Canvas Drag & Drop target for features
      canvas.addEventListener('dragover', (e) => e.preventDefault());
      canvas.addEventListener('drop', handleTokenDrop);
      
      updateLoopTargetUI();
      updateHUD();
      draw();
    } else {
      draw();
    }

    setTool('pan');
    updateInspector();
    const lbl = document.getElementById('lblLoopState');
    if (lbl) lbl.innerText = editorState.trackData.closed ? 'Closed' : 'Open';
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
      const distBox = Math.hypot(screenX - sx, screenY - sy);
      const inPill = (screenX >= sx + 8 && screenX <= sx + 180 && screenY >= sy - 16 && screenY <= sy + 16);
      if (distBox <= 22 || inPill) {
        return i;
      }
    }
    return -1;
  }

  function deleteFeatureAtIndex(idx) {
    if (!editorState.trackData.features || idx < 0 || idx >= editorState.trackData.features.length) return;
    pushHistory();
    editorState.trackData.features.splice(idx, 1);
    // Renumber remaining numbered features sequentially
    let numCounter = 1;
    editorState.trackData.features.forEach(feat => {
      if (feat.number !== undefined) {
        feat.number = numCounter;
        numCounter++;
      }
    });
    if (editorState.selectedFeatureIndex === idx) {
      editorState.selectedFeatureIndex = -1;
    } else if (editorState.selectedFeatureIndex > idx) {
      editorState.selectedFeatureIndex--;
    }
    syncToGlobalTrackData();
    saveDraft();
    updateNumberedFeaturesUI();
    draw();
  }

  function addNumberedFeature(targetNodeIdx, type = 'kicker', customName = null) {
    const nodes = editorState.trackData.nodes;
    if (!nodes || nodes.length === 0) return;
    pushHistory();
    const numbered = editorState.trackData.features.filter(f => f.number !== undefined);
    const nextNum = numbered.length + 1;
    let nodeIdx = 0;
    if (targetNodeIdx !== undefined) {
      nodeIdx = targetNodeIdx;
    } else if (editorState.selectedNodeIndex !== -1) {
      nodeIdx = editorState.selectedNodeIndex;
    } else {
      nodeIdx = Math.min(nodes.length - 1, Math.floor((nextNum * nodes.length) / 5));
    }
    const targetNode = nodes[nodeIdx];
    const defaultName = type === 'kicker' ? 'Kicker' : (type === 'tabletop' || type === 'lilypad' ? 'Lilypad' : (type === 'roller' ? 'Pipe Dreams' : ('Feature ' + nextNum)));
    const newFeat = {
      type: type,
      number: nextNum,
      name: customName || defaultName,
      nodeIndex: nodeIdx,
      x: targetNode.x,
      y: targetNode.y !== undefined ? targetNode.y : 1.0,
      z: targetNode.z,
      t: Math.round((nodeIdx / nodes.length) * 100) / 100
    };
    editorState.trackData.features.push(newFeat);
    editorState.selectedFeatureIndex = editorState.trackData.features.length - 1;
    editorState.selectedNodeIndex = -1;
    editorState.selectedNodes.clear();
    syncToGlobalTrackData();
    saveDraft();
    updateNumberedFeaturesUI();
    draw();
  }

  function updateNumberedFeaturesUI() {
    const listEl = document.getElementById('numberedFeaturesList');
    if (!listEl) return;

    const features = editorState.trackData.features || [];

    if (features.length === 0) {
      listEl.innerHTML = '<div style="font-size: 0.8rem; color: #64748b; padding: 6px 0;">No features on track. Click "+ Add Numbered Feature" below.</div>';
      return;
    }

    listEl.innerHTML = '';
    features.forEach((f, idx) => {
      const isSelected = (editorState.selectedFeatureIndex === idx);

      const card = document.createElement('div');
      card.className = 'numbered-feature-card' + (isSelected ? ' active' : '');

      const badge = document.createElement('div');
      badge.className = 'feature-num-badge';
      if (f.number !== undefined) {
        badge.textContent = f.number;
        badge.style.background = '#0284c7';
      } else if (f.type && f.type.includes('start')) {
        badge.textContent = '🏁';
        badge.style.background = '#10b981';
      } else if (f.type && f.type.includes('finish')) {
        badge.textContent = '🏁';
        badge.style.background = '#f59e0b';
      } else {
        badge.textContent = '★';
        badge.style.background = '#8b5cf6';
      }
      card.appendChild(badge);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'feature-name-edit';
      input.value = f.name || (f.type || '').toUpperCase();
      input.placeholder = 'Name feature...';
      input.addEventListener('input', (e) => {
        f.name = e.target.value;
        syncToGlobalTrackData();
        draw();
      });
      card.appendChild(input);

      const tag = document.createElement('span');
      tag.className = 'feature-node-tag';
      const nodeIdx = (f.nodeIndex !== undefined ? f.nodeIndex : 0);
      tag.textContent = 'Node #' + (nodeIdx + 1);
      tag.title = 'Click to inspect & edit Node #' + (nodeIdx + 1) + ' elevation';
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        editorState.selectedNodeIndex = nodeIdx;
        editorState.selectedNodes.clear();
        editorState.selectedNodes.add(nodeIdx);
        editorState.selectedFeatureIndex = -1;
        updateNumberedFeaturesUI();
        updateInspector();
        draw();
      });
      card.appendChild(tag);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'feature-del-btn';
      delBtn.title = 'Delete feature';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentIdx = editorState.trackData.features.indexOf(f);
        if (currentIdx !== -1) {
          deleteFeatureAtIndex(currentIdx);
        }
      });
      card.appendChild(delBtn);

      card.addEventListener('click', (e) => {
        if (e.target === input || e.target === delBtn) return;
        editorState.selectedFeatureIndex = idx;
        editorState.selectedNodeIndex = -1;
        editorState.selectedNodes.clear();
        updateNumberedFeaturesUI();
        draw();
      });

      listEl.appendChild(card);
    });
  }

  // =========================================================================
  // Foliage / Tree Management
  // =========================================================================

  function findTreeAtScreen(screenX, screenY) {
    const scenery = editorState.trackData.scenery || [];
    if (scenery.length === 0) return -1;

    for (let i = 0; i < scenery.length; i++) {
      const t = scenery[i];
      const { screenX: sx, screenY: sy } = worldToScreen(t.x, t.z);
      const visualRadiusMeters = t.type === 'mature_oak' ? 3.8 : (t.type === 'mid_oak' ? 2.6 : 1.4);
      const hitRadius = Math.max(14, visualRadiusMeters * (t.scale || 1.0) * editorState.scale);

      const dist = Math.hypot(screenX - sx, screenY - sy);
      if (dist <= hitRadius) {
        return i;
      }
    }
    return -1;
  }

  function deleteTreeAtIndex(idx) {
    const scenery = editorState.trackData.scenery || [];
    if (idx < 0 || idx >= scenery.length) return;
    pushHistory();
    scenery.splice(idx, 1);
    if (editorState.selectedTreeIndex === idx) {
      editorState.selectedTreeIndex = -1;
    } else if (editorState.selectedTreeIndex > idx) {
      editorState.selectedTreeIndex--;
    }
    syncToGlobalTrackData();
    saveDraft();
    updateFoliageUI();
    draw();
  }

  function updateFoliageUI() {
    const scenery = editorState.trackData.scenery || [];
    const countSummaryEl = document.getElementById('treeCountSummary');
    const hudTreeCountEl = document.getElementById('hudTreeCount');

    let matureCount = 0;
    let midCount = 0;
    let bushCount = 0;
    scenery.forEach(t => {
      if (t.type === 'mature_oak') matureCount++;
      else if (t.type === 'mid_oak') midCount++;
      else if (t.type === 'bush') bushCount++;
    });

    if (countSummaryEl) {
      countSummaryEl.innerText = `Total Foliage: ${scenery.length} (🌳 ${matureCount}, 🌲 ${midCount}, 🌿 ${bushCount})`;
    }
    if (hudTreeCountEl) {
      hudTreeCountEl.innerText = scenery.length.toString();
    }

    const form = document.getElementById('selectedTreeForm');
    const selIdx = editorState.selectedTreeIndex;
    const tree = (selIdx !== -1 && scenery[selIdx]) ? scenery[selIdx] : null;

    if (!tree) {
      if (form) form.style.display = 'none';
      return;
    }

    if (form) {
      form.style.display = 'block';
      const coordsEl = document.getElementById('inspectTreeCoords');
      if (coordsEl) coordsEl.innerText = `${tree.x.toFixed(1)}m, ${tree.z.toFixed(1)}m`;

      const typeSel = document.getElementById('selectInspectTreeType');
      if (typeSel) typeSel.value = tree.type || 'mature_oak';

      const scaleInput = document.getElementById('inputInspectTreeScale');
      if (scaleInput) {
        scaleInput.value = tree.scale !== undefined ? tree.scale : 1.0;
        const lbl = document.getElementById('lblInspectTreeScale');
        if (lbl) lbl.innerText = `${(tree.scale || 1.0).toFixed(1)}x`;
      }
    }
  }

  function resetToPhotoAccurateFoliage() {
    const photoPreset = [
      { type: "mature_oak", x: 62.0, z: -44.0, scale: 1.30, variant: 1 },
      { type: "mature_oak", x: 68.0, z: -38.0, scale: 1.20, variant: 2 },
      { type: "mid_oak",    x: 75.0, z: -42.0, scale: 1.10, variant: 0 },
      { type: "bush",       x: 60.0, z: -36.0, scale: 1.10, variant: 3 },
      { type: "bush",       x: 72.0, z: -32.0, scale: 0.95, variant: 1 },
      { type: "mid_oak",    x: 82.0, z: -36.0, scale: 1.05, variant: 2 },
      { type: "bush",       x: 92.0, z: -34.0, scale: 0.90, variant: 0 },
      { type: "mature_oak", x: 86.0, z: -46.0, scale: 1.25, variant: 3 },
      { type: "mid_oak",    x: 98.0, z: -40.0, scale: 1.15, variant: 1 },
      { type: "mature_oak", x: -38.0, z: -128.0, scale: 1.30, variant: 0 },
      { type: "mature_oak", x: -8.0,  z: -138.0, scale: 1.40, variant: 1 },
      { type: "mature_oak", x: 18.0,  z: -142.0, scale: 1.35, variant: 2 },
      { type: "mature_oak", x: 50.0,  z: -134.0, scale: 1.30, variant: 3 },
      { type: "mature_oak", x: 82.0,  z: -126.0, scale: 1.40, variant: 0 },
      { type: "mature_oak", x: 120.0, z: -126.0, scale: 1.30, variant: 1 },
      { type: "mature_oak", x: 148.0, z: -130.0, scale: 1.40, variant: 2 },
      { type: "mature_oak", x: -65.0, z: 8.0,   scale: 1.30, variant: 2 },
      { type: "mature_oak", x: -75.0, z: -15.0, scale: 1.25, variant: 1 },
      { type: "mature_oak", x: -85.0, z: -40.0, scale: 1.40, variant: 3 },
      { type: "mid_oak",    x: -68.0, z: 26.0,  scale: 1.15, variant: 0 },
      { type: "bush",       x: -58.0, z: 16.0,  scale: 1.05, variant: 2 },
      { type: "bush",       x: -78.0, z: -28.0, scale: 1.10, variant: 1 },
      { type: "mature_oak", x: -85.0, z: -145.0, scale: 1.25, variant: 1 },
      { type: "mid_oak",    x: -68.0, z: -140.0, scale: 1.10, variant: 2 },
      { type: "mature_oak", x: -50.0, z: -152.0, scale: 1.35, variant: 0 },
      { type: "mid_oak",    x: -30.0, z: -148.0, scale: 1.15, variant: 3 },
      { type: "mature_oak", x: -15.0, z: -160.0, scale: 1.40, variant: 1 },
      { type: "mature_oak", x: 5.0,   z: -155.0, scale: 1.30, variant: 2 },
      { type: "mid_oak",    x: 25.0,  z: -150.0, scale: 1.20, variant: 0 },
      { type: "mature_oak", x: 42.0,  z: -162.0, scale: 1.35, variant: 3 },
      { type: "mid_oak",    x: 65.0,  z: -145.0, scale: 1.15, variant: 1 },
      { type: "mature_oak", x: 85.0,  z: -152.0, scale: 1.40, variant: 2 },
      { type: "mid_oak",    x: 105.0, z: -142.0, scale: 1.10, variant: 0 },
      { type: "mature_oak", x: 128.0, z: -148.0, scale: 1.30, variant: 3 },
      { type: "mid_oak",    x: 145.0, z: -140.0, scale: 1.15, variant: 1 },
      { type: "mature_oak", x: 165.0, z: -145.0, scale: 1.35, variant: 2 },
      { type: "mature_oak", x: -70.0, z: -170.0, scale: 1.40, variant: 0 },
      { type: "mature_oak", x: -25.0, z: -175.0, scale: 1.45, variant: 1 },
      { type: "mature_oak", x: 20.0,  z: -172.0, scale: 1.35, variant: 2 },
      { type: "mature_oak", x: 70.0,  z: -178.0, scale: 1.40, variant: 3 },
      { type: "mature_oak", x: 115.0, z: -168.0, scale: 1.35, variant: 0 },
      { type: "mature_oak", x: 155.0, z: -165.0, scale: 1.40, variant: 1 },
      { type: "mature_oak", x: -45.0, z: 45.0,  scale: 1.25, variant: 0 },
      { type: "mid_oak",    x: -10.0, z: 52.0,  scale: 1.10, variant: 1 },
      { type: "mature_oak", x: 28.0,  z: 48.0,  scale: 1.30, variant: 2 },
      { type: "mid_oak",    x: 65.0,  z: 55.0,  scale: 1.15, variant: 3 },
      { type: "mature_oak", x: 105.0, z: 42.0,  scale: 1.25, variant: 0 },
      { type: "mature_oak", x: 140.0, z: 30.0,  scale: 1.30, variant: 1 },
      { type: "mature_oak", x: 170.0, z: -10.0, scale: 1.35, variant: 2 },
      { type: "mid_oak",    x: 175.0, z: -45.0, scale: 1.15, variant: 3 },
      { type: "mature_oak", x: 168.0, z: -85.0, scale: 1.30, variant: 0 }
    ];
    pushHistory();
    editorState.trackData.scenery = JSON.parse(JSON.stringify(photoPreset));
    editorState.selectedTreeIndex = -1;
    syncToGlobalTrackData();
    saveDraft();
    updateFoliageUI();
    draw();
    alert(`Loaded ${photoPreset.length} photo-accurate trees & bushes matching aerial satellite image!`);
  }

  function autoCleanTrackTrees() {
    const scenery = editorState.trackData.scenery || [];
    if (scenery.length === 0) {
      alert('No foliage on the map to clean.');
      return;
    }

    if (!window.TrackBuilder || typeof window.TrackBuilder.isPointClearOfTrack !== 'function') {
      alert('Track builder clearance engine not initialized.');
      return;
    }

    pushHistory();
    const origCount = scenery.length;
    editorState.trackData.scenery = scenery.filter(t => {
      const visualRadiusMeters = t.type === 'mature_oak' ? 3.5 : (t.type === 'mid_oak' ? 2.4 : 1.4);
      return window.TrackBuilder.isPointClearOfTrack(t.x, t.z, visualRadiusMeters * (t.scale || 1.0), 1.2);
    });

    const removed = origCount - editorState.trackData.scenery.length;
    editorState.selectedTreeIndex = -1;
    syncToGlobalTrackData();
    saveDraft();
    updateFoliageUI();
    draw();

    if (removed > 0) {
      alert(`🚫 Auto-cleaned ${removed} foliage item(s) that were clipping or too close to the track ribbon!`);
    } else {
      alert(`✅ All trees and bushes are already completely clear of the track!`);
    }
  }

  function findGhostNodeAtScreen(screenX, screenY) {
    if (!editorState.showGhostPath || !window.TRACK_DATA_HOLLISTER || !window.TRACK_DATA_HOLLISTER.ghostData) return -1;
    const samples = window.TRACK_DATA_HOLLISTER.ghostData.samples;
    if (!samples) return -1;
    const { worldX, worldZ } = screenToWorld(screenX, screenY);
    const hitRadiusWorld = 18 / editorState.scale;

    for (let i = 0; i < samples.length; i++) {
      const dist = Math.hypot(samples[i].x - worldX, samples[i].z - worldZ);
      if (dist <= hitRadiusWorld) return i;
    }
    return -1;
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

    // Prevent context menu on window for right-click node delete / pan
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (editorState.isPanning) {
        editorState.isPanning = false;
        if (canvas) canvas.style.cursor = editorState.currentTool === 'pan' ? 'grab' : (editorState.currentTool === 'draw' ? 'crosshair' : 'default');
      }
      if (editorState.isDraggingFeature) {
        editorState.isDraggingFeature = false;
        editorState.dragFeatureIndex = -1;
        syncToGlobalTrackData();
      }
      editorState.isDraggingGhostNode = false;
      editorState.isDraggingNode = false;
      editorState.dragNodeIndex = -1;
    });

    // Reset mouse and key state if window loses focus
    window.addEventListener('blur', () => {
      if (editorState.isPanning) {
        editorState.isPanning = false;
        if (canvas) canvas.style.cursor = editorState.currentTool === 'pan' ? 'grab' : (editorState.currentTool === 'draw' ? 'crosshair' : 'default');
      }
      if (editorState.isDraggingFeature) {
        editorState.isDraggingFeature = false;
        editorState.dragFeatureIndex = -1;
        syncToGlobalTrackData();
      }
      editorState.isDraggingGhostNode = false;
      editorState.isDraggingNode = false;
      editorState.dragNodeIndex = -1;
      editorState.isSpacePressed = false;
    });

    // Mouse Down
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const { worldX, worldZ } = screenToWorld(mouseX, mouseY);

      // Pan with middle click, right click (when not on a node, feature, or tree), Space+left click, or when Look Around mode is active with left click
      const isRightClick = e.button === 2;
      const isMiddleClick = e.button === 1;
      const hitBadge = findNodeBadgeAtScreen(mouseX, mouseY);
      const hitNode = hitBadge !== -1 ? hitBadge : findNodeAtScreen(mouseX, mouseY);
      const hitFeature = (hitBadge === -1) ? findFeatureAtScreen(mouseX, mouseY) : -1;
      const hitTree = (hitBadge === -1 && hitNode === -1 && hitFeature === -1) ? findTreeAtScreen(mouseX, mouseY) : -1;
      const hitGhost = findGhostNodeAtScreen(mouseX, mouseY);

      if ((editorState.currentTool === 'pan' && e.button === 0) || isMiddleClick || (isRightClick && hitNode === -1 && hitFeature === -1 && hitGhost === -1 && hitTree === -1) || (editorState.isSpacePressed && e.button === 0)) {
        editorState.isPanning = true;
        editorState.panStartX = mouseX - editorState.offsetX;
        editorState.panStartY = mouseY - editorState.offsetY;
        canvas.style.cursor = 'grabbing';
        return;
      }

      // Left Click on Ghost Node when Ghost Edit mode or Shift is active
      if (e.button === 0 && hitGhost !== -1 && (editorState.editGhostMode || e.shiftKey)) {
        editorState.selectedGhostIndex = hitGhost;
        editorState.isDraggingGhostNode = true;
        draw();
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

      // Right Click on a Tree -> Delete Tree
      if (isRightClick && hitTree !== -1) {
        deleteTreeAtIndex(hitTree);
        return;
      }

      // Right Click on a Feature -> Delete Feature
      if (isRightClick && hitFeature !== -1) {
        deleteFeatureAtIndex(hitFeature);
        return;
      }

      // Right Click on a Node -> Delete Node (Disabled in Edit Ghost Mode)
      if (!editorState.editGhostMode && isRightClick && hitNode !== -1) {
        pushHistory();
        const delIdx = hitNode;
        editorState.trackData.nodes.splice(delIdx, 1);
        if (editorState.selectedNodeIndex === delIdx) {
          editorState.selectedNodeIndex = -1;
        } else if (editorState.selectedNodeIndex > delIdx) {
          editorState.selectedNodeIndex--;
        }
        editorState.selectedNodes.clear();

        // Keep all track features synchronized with remaining nodes so jumps never move
        if (editorState.trackData.features) {
          editorState.trackData.features.forEach(feat => {
            if (feat.nodeIndex !== undefined) {
              if (feat.nodeIndex === delIdx) {
                feat.nodeIndex = Math.max(0, Math.min(editorState.trackData.nodes.length - 1, delIdx));
              } else if (feat.nodeIndex > delIdx) {
                feat.nodeIndex--;
              }
            }
          });
        }

        // Keep loopTargetNode synchronized
        if (editorState.trackData.loopTargetNode && delIdx < editorState.trackData.loopTargetNode - 1) {
          editorState.trackData.loopTargetNode = Math.max(1, editorState.trackData.loopTargetNode - 1);
        }

        updateNumberedFeaturesUI();
        updateInspector();
        updateLoopTargetUI();
        updateHUD();
        draw();
        return;
      }

      // Left Click Handling
      if (e.button === 0) {
        // If in Edit Ghost Mode, do not interact with track features, trees, or track nodes
        if (editorState.editGhostMode) {
          if (hitGhost === -1) {
            editorState.selectedGhostIndex = -1;
            draw();
          }
          return;
        }

        // 0. Clicked directly on a Tree -> Select & Drag Tree
        if (hitTree !== -1) {
          editorState.selectedTreeIndex = hitTree;
          editorState.isDraggingTree = true;
          editorState.selectedNodeIndex = -1;
          editorState.selectedNodes.clear();
          editorState.selectedFeatureIndex = -1;
          pushHistory();
          updateFoliageUI();
          draw();
          return;
        }

        // 0.5 If in Tree Tool and clicked empty space -> Plant new tree/bush
        if (editorState.currentTool === 'tree') {
          pushHistory();
          if (!editorState.trackData.scenery) editorState.trackData.scenery = [];
          const newTree = {
            type: editorState.treeBrushType || 'mature_oak',
            x: Math.round(worldX * 10) / 10,
            z: Math.round(worldZ * 10) / 10,
            scale: editorState.treeBrushScale || 1.0,
            variant: Math.floor(Math.random() * 4)
          };
          editorState.trackData.scenery.push(newTree);
          editorState.selectedTreeIndex = editorState.trackData.scenery.length - 1;
          syncToGlobalTrackData();
          saveDraft();
          updateFoliageUI();
          draw();
          return;
        }

        // 1. Clicked directly on an Elevation Tag / Badge -> Activate that Node!
        if (hitBadge !== -1) {
          editorState.selectedFeatureIndex = -1;
          editorState.selectedTreeIndex = -1;
          updateNumberedFeaturesUI();
          updateFoliageUI();
          if (e.shiftKey) {
            if (editorState.selectedNodes.size > 0) {
              const arr = Array.from(editorState.selectedNodes);
              const minIdx = Math.min(...arr, hitBadge);
              const maxIdx = Math.max(...arr, hitBadge);
              editorState.selectedNodes.clear();
              for (let i = minIdx; i <= maxIdx; i++) {
                editorState.selectedNodes.add(i);
              }
            } else {
              editorState.selectedNodes.add(hitBadge);
            }
          } else {
            editorState.selectedNodeIndex = hitBadge;
            editorState.selectedNodes.clear();
            editorState.selectedNodes.add(hitBadge);
          }
          updateInspector();
          draw();
          return;
        }

        // 2. Check if clicked on a Feature Pin (Numbered or Gate) -> Drag Feature
        if (hitFeature !== -1) {
          editorState.isDraggingFeature = true;
          editorState.dragFeatureIndex = hitFeature;
          editorState.selectedFeatureIndex = hitFeature;
          editorState.selectedTreeIndex = -1;
          editorState.selectedNodeIndex = -1;
          editorState.selectedNodes.clear();
          pushHistory();
          updateNumberedFeaturesUI();
          updateFoliageUI();
          draw();
          return;
        }

        // 3. Clicked on an existing node
        if (hitNode !== -1) {
          editorState.selectedFeatureIndex = -1;
          editorState.selectedTreeIndex = -1;
          updateNumberedFeaturesUI();
          updateFoliageUI();
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

        // 4. Clicked in "Insert Node" mode or on highlighted insert segment
        if (editorState.currentTool === 'insert' || e.altKey) {
          const insertInfo = findSplineInsertPoint(worldX, worldZ);
          if (insertInfo) {
            pushHistory();

            const newNode = {
              x: insertInfo.x,
              y: insertInfo.y,
              z: insertInfo.z,
              bank: insertInfo.bank
            };

            const insIdx = insertInfo.insertIdx;
            editorState.trackData.nodes.splice(insIdx, 0, newNode);

            // Shift downstream features so their physical track position does not change
            if (editorState.trackData.features) {
              editorState.trackData.features.forEach(feat => {
                if (feat.nodeIndex !== undefined && feat.nodeIndex >= insIdx) {
                  feat.nodeIndex++;
                }
              });
            }

            // Shift loopTargetNode if inserted before it
            if (editorState.trackData.loopTargetNode && insIdx < editorState.trackData.loopTargetNode) {
              editorState.trackData.loopTargetNode++;
            }

            editorState.selectedNodeIndex = insIdx;
            editorState.selectedNodes.clear();
            editorState.selectedNodes.add(insIdx);
            editorState.selectedTreeIndex = -1;
            updateNumberedFeaturesUI();
            updateInspector();
            updateLoopTargetUI();
            updateHUD();
            draw();
            return;
          }
        }

        // 5. Clicked in "Draw Spline" mode -> Append Node
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
          editorState.selectedTreeIndex = -1;
          updateInspector();
          updateLoopTargetUI();
          updateHUD();
          draw();
          return;
        }

        // 6. Clicked empty space in Select mode -> Deselect
        editorState.selectedNodeIndex = -1;
        editorState.selectedNodes.clear();
        editorState.selectedFeatureIndex = -1;
        editorState.selectedTreeIndex = -1;
        updateNumberedFeaturesUI();
        updateFoliageUI();
        updateInspector();
        draw();
      }
    });

    window.addEventListener('mouseup', () => {
      if (editorState.isDraggingGhostNode) {
        editorState.isDraggingGhostNode = false;
        if (window.TRACK_DATA_HOLLISTER && window.TRACK_DATA_HOLLISTER.ghostData) {
          editorState.trackData.ghostData = window.TRACK_DATA_HOLLISTER.ghostData;
        }
        syncToGlobalTrackData();
        saveDraft();
        draw();
      }
      if (editorState.isDraggingTree) {
        editorState.isDraggingTree = false;
        syncToGlobalTrackData();
        saveDraft();
        draw();
      }
    });

    // Mouse Move
    window.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const { worldX, worldZ } = screenToWorld(mouseX, mouseY);
      editorState.treeCursorWorld = { x: worldX, z: worldZ };

      // Handle Panning
      if (editorState.isPanning) {
        editorState.offsetX = mouseX - editorState.panStartX;
        editorState.offsetY = mouseY - editorState.panStartY;
        draw();
        return;
      }

      // Handle Dragging Tree
      if (editorState.isDraggingTree && editorState.selectedTreeIndex !== -1 && editorState.trackData.scenery) {
        const tree = editorState.trackData.scenery[editorState.selectedTreeIndex];
        if (tree) {
          tree.x = Math.round(worldX * 10) / 10;
          tree.z = Math.round(worldZ * 10) / 10;
          updateFoliageUI();
          draw();
        }
        return;
      }

      // Handle Dragging Feature Pin along track
      if (editorState.isDraggingFeature && editorState.dragFeatureIndex !== -1) {
        const nodes = editorState.trackData.nodes;
        if (nodes && nodes.length > 0) {
          const f = editorState.trackData.features[editorState.dragFeatureIndex];
          if (f) {
            // Find closest projection along the actual curved track spline
            const splineInsert = findSplineInsertPoint(worldX, worldZ);
            if (splineInsert) {
              f.x = splineInsert.x;
              f.z = splineInsert.z;
              f.y = splineInsert.y;
              f.nodeIndex = splineInsert.prevIdx;
              f.t = Math.round((splineInsert.prevIdx / nodes.length) * 100) / 100;
            } else {
              // Fallback to nearest node if dragged far away
              let minDist = Infinity;
              let minIdx = 0;
              for (let i = 0; i < nodes.length; i++) {
                const d = Math.hypot(nodes[i].x - worldX, nodes[i].z - worldZ);
                if (d < minDist) {
                  minDist = d;
                  minIdx = i;
                }
              }
              f.nodeIndex = minIdx;
              f.x = nodes[minIdx].x;
              f.z = nodes[minIdx].z;
              f.y = nodes[minIdx].y !== undefined ? nodes[minIdx].y : 1.0;
              f.t = Math.round((minIdx / nodes.length) * 100) / 100;
            }
            updateNumberedFeaturesUI();
            draw();
          }
        }
        return;
      }

      // Handle Dragging Ghost Node
      if (editorState.isDraggingGhostNode && editorState.selectedGhostIndex !== -1) {
        const samples = window.TRACK_DATA_HOLLISTER.ghostData.samples;
        if (samples && samples[editorState.selectedGhostIndex]) {
          const g = samples[editorState.selectedGhostIndex];
          g.x = Math.round(worldX * 100) / 100;
          g.z = Math.round(worldZ * 100) / 100;

          // Re-calculate heading to next sample point
          const next = samples[Math.min(samples.length - 1, editorState.selectedGhostIndex + 1)];
          if (next && next !== g) {
            g.heading = Math.atan2(next.x - g.x, next.z - g.z);
          }
          draw();
        }
        return;
      }

      // Handle Dragging Node
      if (editorState.isDraggingNode && editorState.dragNodeIndex !== -1) {
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

      // Ghost Node Hover Detection
      const hitGhost = findGhostNodeAtScreen(mouseX, mouseY);
      if (hitGhost !== editorState.hoveredGhostIndex) {
        editorState.hoveredGhostIndex = hitGhost;
        draw();
      }

      // Tree Hover Detection
      const hitTree = findTreeAtScreen(mouseX, mouseY);
      if (hitTree !== editorState.hoveredTreeIndex) {
        editorState.hoveredTreeIndex = hitTree;
        draw();
      }

      // Hover Detection
      const hitBadge = findNodeBadgeAtScreen(mouseX, mouseY);
      const hitNode = hitBadge !== -1 ? hitBadge : findNodeAtScreen(mouseX, mouseY);
      const hitFeat = (hitBadge === -1) ? findFeatureAtScreen(mouseX, mouseY) : -1;

      if (hitFeat !== editorState.hoveredFeatureIndex) {
        editorState.hoveredFeatureIndex = hitFeat;
        draw();
      }

      if (hitNode !== editorState.hoveredNodeIndex) {
        editorState.hoveredNodeIndex = hitNode;
        draw();
      }

      if (editorState.currentTool === 'pan') {
        canvas.style.cursor = editorState.isPanning ? 'grabbing' : 'grab';
      } else if (hitTree !== -1) {
        canvas.style.cursor = 'grab';
      } else if (hitBadge !== -1 || hitNode !== -1) {
        canvas.style.cursor = 'pointer';
      } else if (hitFeat !== -1) {
        canvas.style.cursor = 'grab';
      } else if (editorState.isPickingLoopTarget) {
        canvas.style.cursor = 'crosshair';
      } else if (editorState.currentTool === 'draw' || editorState.currentTool === 'tree') {
        canvas.style.cursor = 'crosshair';
      } else if (editorState.currentTool === 'insert') {
        canvas.style.cursor = 'cell';
      } else {
        canvas.style.cursor = 'default';
      }

      // Insert Mode Spline Hover Projection
      if (editorState.currentTool === 'insert') {
        editorState.hoveredSplineInsert = findSplineInsertPoint(worldX, worldZ);
        draw();
      }

      // In Tree Mode, redraw cursor brush preview
      if (editorState.currentTool === 'tree') {
        draw();
      }
    });

    // Mouse Up
    window.addEventListener('mouseup', () => {
      if (editorState.isPanning) {
        editorState.isPanning = false;
        canvas.style.cursor = editorState.currentTool === 'pan' ? 'grab' : (editorState.currentTool === 'draw' ? 'crosshair' : (editorState.currentTool === 'tree' ? 'crosshair' : (editorState.currentTool === 'insert' ? 'cell' : 'default')));
      }
      if (editorState.isDraggingTree) {
        editorState.isDraggingTree = false;
        syncToGlobalTrackData();
        saveDraft();
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

    if (e.key === '3') {
      toggle3DInspection();
      return;
    } else if (e.key === 'Escape') {
      const cont = document.getElementById('trackEditorContainer');
      if (cont && cont.classList.contains('view-3d-active')) {
        exit3DInspection();
        return;
      }
    } else if (e.code === 'Tab') {
      e.preventDefault();
      exit3DInspection();
      window.toggleTrackStudio();
      return;
    }

    if (e.code === 'Space' && !editorState.isSpacePressed) {
      editorState.isSpacePressed = true;
      if (editorState.canvas) editorState.canvas.style.cursor = 'grab';
    } else if (e.key === 'h' || e.key === 'H' || e.key === 'q' || e.key === 'Q') {
      setTool('pan');
    } else if (e.key === 'p' || e.key === 'P') {
      setTool('draw');
    } else if (e.key === 'v' || e.key === 'V') {
      setTool('select');
    } else if (e.key === 'i' || e.key === 'I') {
      setTool('insert');
    } else if (e.key === 't' || e.key === 'T') {
      setTool('tree');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editorState.selectedTreeIndex !== -1) {
        deleteTreeAtIndex(editorState.selectedTreeIndex);
      } else if (editorState.selectedFeatureIndex !== -1) {
        deleteFeatureAtIndex(editorState.selectedFeatureIndex);
      } else if (editorState.selectedNodeIndex !== -1) {
        deleteSelectedNode();
      }
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
      if (editorState.canvas) editorState.canvas.style.cursor = editorState.currentTool === 'pan' ? 'grab' : (editorState.currentTool === 'draw' ? 'crosshair' : (editorState.currentTool === 'tree' ? 'crosshair' : (editorState.currentTool === 'insert' ? 'cell' : 'default')));
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
    if (lbl) lbl.innerText = editorState.trackData.closed ? 'Closed' : 'Open';
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
    if (lblLoop) lblLoop.innerText = 'Closed';
    
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
      lblHeader.innerText = isClosed ? (targetNode > 1 ? `#${targetNode}` : '#1') : 'Off';
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
    const nodeInspectorPanel = document.getElementById('nodeInspectorPanel');
    const elevationTool = document.getElementById('elevationTool');

    const nodes = editorState.trackData.nodes;
    const nodeIdx = editorState.selectedNodeIndex;
    const hasSelectedNode = (nodeIdx !== -1 && nodes[nodeIdx]) || (editorState.selectedNodes && editorState.selectedNodes.size > 0);
    const node = (nodeIdx !== -1) ? nodes[nodeIdx] : null;

    if (!hasSelectedNode) {
      if (nodeInspectorPanel) nodeInspectorPanel.style.display = 'none';
      if (elevationTool) elevationTool.style.display = 'none';
      if (noSelectNotice) noSelectNotice.style.display = 'block';
      if (form) form.style.display = 'none';
      return;
    }

    if (nodeInspectorPanel) nodeInspectorPanel.style.display = 'block';
    if (elevationTool) elevationTool.style.display = 'block';

    if (!node) {
      if (noSelectNotice) noSelectNotice.style.display = 'block';
      if (form) form.style.display = 'none';
      return;
    }

    if (noSelectNotice) noSelectNotice.style.display = 'none';
    if (form) form.style.display = 'block';

    // Calculate slope / gradient to next node
    let slopeText = '0.0%';
    if (nodes.length > 1) {
      const nextIdx = (nodeIdx + 1) % nodes.length;
      const nextNode = nodes[nextIdx];
      const dist2D = Math.hypot(nextNode.x - node.x, nextNode.z - node.z);
      const dy = (nextNode.y || 0) - (node.y || 0);
      if (dist2D > 0.1) {
        const gradePercent = (dy / dist2D) * 100;
        const arrow = dy > 0.05 ? '📈' : (dy < -0.05 ? '📉' : '➡️');
        slopeText = `${arrow} ${gradePercent > 0 ? '+' : ''}${gradePercent.toFixed(1)}% grade`;
      }
    }

    document.getElementById('inspectNodeIndex').innerText = `#${nodeIdx + 1}`;
    document.getElementById('inspectNodeCoords').innerText = `${node.x.toFixed(1)}m, ${node.z.toFixed(1)}m (${slopeText})`;
    document.getElementById('inspectNodeElevation').value = node.y !== undefined ? node.y : 0;
    document.getElementById('inspectNodeBank').value = node.bank !== undefined ? node.bank : 0;
  }

  function setupStepper(btnDownId, btnUpId, inputId, stepVal, onChange) {
    const btnDown = document.getElementById(btnDownId);
    const btnUp = document.getElementById(btnUpId);
    const input = document.getElementById(inputId);
    if (!btnDown || !btnUp || !input) return;

    let holdTimer = null;
    let repeatInterval = null;

    const stepAction = (dir, isShift) => {
      let cur = parseFloat(input.value);
      if (isNaN(cur)) cur = 0;
      const mult = isShift ? 2 : 1;
      const step = stepVal * mult;
      let next = dir > 0 ? cur + step : cur - step;
      next = Math.round(next * 100) / 100;
      input.value = next;
      if (onChange) onChange(true);
    };

    const startHold = (dir, e) => {
      e.preventDefault();
      const isShift = e.shiftKey;
      stepAction(dir, isShift);
      clearTimeout(holdTimer);
      clearInterval(repeatInterval);
      holdTimer = setTimeout(() => {
        repeatInterval = setInterval(() => {
          stepAction(dir, isShift);
        }, 80);
      }, 350);
    };

    const stopHold = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatInterval);
    };

    btnDown.addEventListener('mousedown', (e) => startHold(-1, e));
    btnDown.addEventListener('mouseup', stopHold);
    btnDown.addEventListener('mouseleave', stopHold);
    btnDown.addEventListener('touchstart', (e) => startHold(-1, e), { passive: false });
    btnDown.addEventListener('touchend', stopHold);

    btnUp.addEventListener('mousedown', (e) => startHold(1, e));
    btnUp.addEventListener('mouseup', stopHold);
    btnUp.addEventListener('mouseleave', stopHold);
    btnUp.addEventListener('touchstart', (e) => startHold(1, e), { passive: false });
    btnUp.addEventListener('touchend', stopHold);
  }

  function updateSelectedElevation(recordHistory = true) {
    const node = editorState.trackData.nodes[editorState.selectedNodeIndex];
    if (!node) return;
    if (recordHistory) pushHistory();
    const val = parseFloat(document.getElementById('inspectNodeElevation').value);
    node.y = isNaN(val) ? 0 : val;
    saveDraft();
    syncToGlobalTrackData();

    // Update dynamic slope text in coords label
    const nodes = editorState.trackData.nodes;
    const nodeIdx = editorState.selectedNodeIndex;
    let slopeText = '0.0%';
    if (nodes.length > 1) {
      const nextIdx = (nodeIdx + 1) % nodes.length;
      const nextNode = nodes[nextIdx];
      const dist2D = Math.hypot(nextNode.x - node.x, nextNode.z - node.z);
      const dy = (nextNode.y || 0) - (node.y || 0);
      if (dist2D > 0.1) {
        const gradePercent = (dy / dist2D) * 100;
        const arrow = dy > 0.05 ? '📈' : (dy < -0.05 ? '📉' : '➡️');
        slopeText = `${arrow} ${gradePercent > 0 ? '+' : ''}${gradePercent.toFixed(1)}% grade`;
      }
    }
    const coordsEl = document.getElementById('inspectNodeCoords');
    if (coordsEl) coordsEl.innerText = `${node.x.toFixed(1)}m, ${node.z.toFixed(1)}m (${slopeText})`;

    draw();
  }

  function updateSelectedBank(recordHistory = true) {
    const node = editorState.trackData.nodes[editorState.selectedNodeIndex];
    if (!node) return;
    if (recordHistory) pushHistory();
    const val = parseFloat(document.getElementById('inspectNodeBank').value);
    node.bank = isNaN(val) ? 0 : val;
    saveDraft();
    syncToGlobalTrackData();
    draw();
  }

  function deleteSelectedNode() {
    const delIdx = editorState.selectedNodeIndex;
    if (delIdx === -1) return;
    pushHistory();
    editorState.trackData.nodes.splice(delIdx, 1);
    editorState.selectedNodeIndex = -1;
    editorState.selectedNodes.clear();

    // Keep all track features synchronized with remaining nodes so jumps never move
    if (editorState.trackData.features) {
      editorState.trackData.features.forEach(feat => {
        if (feat.nodeIndex !== undefined) {
          if (feat.nodeIndex === delIdx) {
            feat.nodeIndex = Math.max(0, Math.min(editorState.trackData.nodes.length - 1, delIdx));
          } else if (feat.nodeIndex > delIdx) {
            feat.nodeIndex--;
          }
        }
      });
    }

    // Keep loopTargetNode synchronized
    if (editorState.trackData.loopTargetNode && delIdx < editorState.trackData.loopTargetNode - 1) {
      editorState.trackData.loopTargetNode = Math.max(1, editorState.trackData.loopTargetNode - 1);
    }

    saveDraft();
    syncToGlobalTrackData();
    updateNumberedFeaturesUI();
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

    saveDraft();
    syncToGlobalTrackData();
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

  function getNodeBadgeRect(i) {
    const nodes = editorState.trackData.nodes;
    if (!nodes || !nodes[i]) return null;
    if (editorState.elevationLabelMode === 'off') return null;

    const halfW = (editorState.trackData.width || 5.0) / 2 * editorState.scale;
    const { screenX, screenY } = worldToScreen(nodes[i].x, nodes[i].z);

    let prevIdx = (i - 1 + nodes.length) % nodes.length;
    let nextIdx = (i + 1) % nodes.length;
    if (!editorState.trackData.closed) {
      if (i === 0) prevIdx = 0;
      if (i === nodes.length - 1) nextIdx = nodes.length - 1;
    }
    const pPrev = nodes[prevIdx];
    const pNext = nodes[nextIdx];
    const pPrevScr = worldToScreen(pPrev.x, pPrev.z);
    const pNextScr = worldToScreen(pNext.x, pNext.z);
    let sdx = pNextScr.screenX - pPrevScr.screenX;
    let sdy = pNextScr.screenY - pPrevScr.screenY;
    let sLen = Math.hypot(sdx, sdy);
    if (sLen < 0.0001) {
      sdx = 1;
      sdy = 0;
      sLen = 1;
    }

    let nx = -sdy / sLen;
    let ny = sdx / sLen;

    const offsetDist = Math.max(26, halfW + 20);
    const badgeCenterX = screenX + nx * offsetDist;
    const badgeCenterY = screenY + ny * offsetDist;

    const nodeNumText = `${i + 1}`;
    const elevVal = nodes[i].y !== undefined ? nodes[i].y : 1.0;
    const elevText = `${elevVal.toFixed(1)}m`;

    let numW = nodeNumText.length * 8 + 4;
    let elevW = elevText.length * 9 + 4;
    if (editorState.ctx) {
      editorState.ctx.save();
      editorState.ctx.font = 'bold 11px "Space Grotesk", sans-serif';
      numW = editorState.ctx.measureText(nodeNumText).width;
      editorState.ctx.font = 'bold 13px "Space Grotesk", sans-serif';
      elevW = editorState.ctx.measureText(elevText).width;
      editorState.ctx.restore();
    }

    const padX = 8;
    const gap = 6;
    const badgeW = numW + 10 + gap + elevW + padX * 2;
    const badgeH = 26;
    const badgeX = badgeCenterX - badgeW / 2;
    const badgeY = badgeCenterY - badgeH / 2;

    const numPillW = Math.max(18, numW + 8);
    const numPillH = 18;
    const numPillX = badgeX + 4;
    const numPillY = badgeY + (badgeH - numPillH) / 2;
    const textX = numPillX + numPillW + 6;
    const textY = badgeY + badgeH / 2;

    return {
      x: badgeX,
      y: badgeY,
      w: badgeW,
      h: badgeH,
      badgeCenterX,
      badgeCenterY,
      screenX,
      screenY,
      nodeNumText,
      elevVal,
      elevText,
      numPillW,
      numPillH,
      numPillX,
      numPillY,
      textX,
      textY,
      nodeIndex: i
    };
  }

  function findNodeBadgeAtScreen(screenX, screenY) {
    const nodes = editorState.trackData.nodes;
    if (!nodes || nodes.length === 0 || editorState.elevationLabelMode === 'off') return -1;
    for (let i = 0; i < nodes.length; i++) {
      const rect = getNodeBadgeRect(i);
      if (rect) {
        if (screenX >= rect.x - 5 && screenX <= rect.x + rect.w + 5 &&
            screenY >= rect.y - 5 && screenY <= rect.y + rect.h + 5) {
          return i;
        }
      }
    }
    return -1;
  }

  function findNodeAtScreen(screenX, screenY) {
    // 1. Check if clicked directly on an Elevation Tag / Badge
    const hitBadge = findNodeBadgeAtScreen(screenX, screenY);
    if (hitBadge !== -1) return hitBadge;

    // 2. Check node center circle
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

    const splineData = getSplineSamples(Math.max(500, nodes.length * 30));
    if (!splineData) return null;

    let closestDistSq = Infinity;
    let bestX = 0, bestY = 1.0, bestZ = 0;
    let bestInsertIdx = -1;
    let bestPrevIdx = -1;
    let bestBank = 0;

    // Search through all spline curve points to find the closest point on the actual curved spline
    const testSegments = [];
    if (splineData.isChuteCircuit && splineData.chuteCurve && splineData.circuitCurve) {
      const targetIdx = (editorState.trackData.loopTargetNode || 1) - 1;
      testSegments.push({
        curve: splineData.chuteCurve,
        isClosed: false,
        nodes: nodes.slice(0, targetIdx + 1),
        nodeOffset: 0
      });
      testSegments.push({
        curve: splineData.circuitCurve,
        isClosed: true,
        nodes: nodes.slice(targetIdx),
        nodeOffset: targetIdx
      });
    } else if (splineData.curve) {
      testSegments.push({
        curve: splineData.curve,
        isClosed: editorState.trackData.closed,
        nodes: nodes,
        nodeOffset: 0
      });
    }

    testSegments.forEach(seg => {
      const segCurve = seg.curve;
      const numCurveSamples = Math.max(120, seg.nodes.length * 30);
      const curvePts = segCurve.getPoints(numCurveSamples);

      for (let i = 0; i < curvePts.length - 1; i++) {
        const p1 = curvePts[i];
        const p2 = curvePts[i + 1];

        const abx = p2.x - p1.x;
        const abz = p2.z - p1.z;
        const lenSq = abx * abx + abz * abz;
        if (lenSq < 0.00001) continue;

        let u = ((worldX - p1.x) * abx + (worldZ - p1.z) * abz) / lenSq;
        u = Math.max(0, Math.min(1, u));

        const nearX = p1.x + u * abx;
        const nearZ = p1.z + u * abz;
        const nearY = p1.y + u * (p2.y - p1.y);

        const dx = worldX - nearX;
        const dz = worldZ - nearZ;
        const d2 = dx * dx + dz * dz;

        if (d2 < closestDistSq) {
          closestDistSq = d2;
          bestX = nearX;
          bestY = nearY;
          bestZ = nearZ;

          // Global parametric t along this curve
          const globalT = (i + u) / (curvePts.length - 1);
          const numSegs = seg.isClosed ? seg.nodes.length : (seg.nodes.length - 1);
          const localSegT = globalT * numSegs;
          const localIdx = Math.min(numSegs - 1, Math.floor(localSegT));
          const frac = localSegT - localIdx;

          bestPrevIdx = seg.nodeOffset + localIdx;
          bestInsertIdx = bestPrevIdx + 1;

          const nA = seg.nodes[localIdx];
          const nextLocal = (localIdx + 1) % seg.nodes.length;
          const nB = seg.nodes[nextLocal];
          const bankA = nA ? (nA.bank || 0) : 0;
          const bankB = nB ? (nB.bank || 0) : 0;
          bestBank = bankA + frac * (bankB - bankA);
        }
      }
    });

    const hitThresholdWorld = 28 / editorState.scale;
    if (closestDistSq <= hitThresholdWorld * hitThresholdWorld && bestInsertIdx !== -1) {
      return {
        x: Math.round(bestX * 10) / 10,
        y: Math.round(bestY * 10) / 10,
        z: Math.round(bestZ * 10) / 10,
        bank: Math.round(bestBank),
        insertIdx: bestInsertIdx,
        prevIdx: bestPrevIdx
      };
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

  function getElevationColor(y, alpha = 1.0) {
    const minY = 1.0;
    const maxY = 7.7;
    const val = y !== undefined ? y : 1.0;
    const t = Math.max(0, Math.min(1, (val - minY) / (maxY - minY)));

    let r, g, b;
    if (t < 0.25) {
      const u = t / 0.25;
      r = Math.round(0 + u * (0 - 0));
      g = Math.round(136 + u * (230 - 136));
      b = Math.round(255 + u * (230 - 255));
    } else if (t < 0.50) {
      const u = (t - 0.25) / 0.25;
      r = Math.round(0 + u * (16 - 0));
      g = Math.round(230 + u * (185 - 230));
      b = Math.round(230 + u * (129 - 230));
    } else if (t < 0.75) {
      const u = (t - 0.50) / 0.25;
      r = Math.round(16 + u * (245 - 16));
      g = Math.round(185 + u * (158 - 185));
      b = Math.round(129 + u * (11 - 129));
    } else {
      const u = (t - 0.75) / 0.25;
      r = Math.round(245 + u * (239 - 245));
      g = Math.round(158 + u * (68 - 158));
      b = Math.round(11 + u * (68 - 11));
    }

    if (alpha < 1.0) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
  }

  function getNicoElevationAtPoint(worldX, worldZ) {
    const ghostData = (editorState.trackData && editorState.trackData.ghostData) ||
      (window.TRACK_DATA_HOLLISTER && window.TRACK_DATA_HOLLISTER.ghostData);
    const samples = ghostData?.samples;
    if (!samples || !samples.length) return null;

    let bestDistSq = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < samples.length; i++) {
      const dx = samples[i].x - worldX;
      const dz = samples[i].z - worldZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = i;
      }
    }
    const s = samples[bestIdx];
    return s.y !== undefined ? s.y : 1.0;
  }

  function drawSplineRibbonAndLine(ctx, pts, strokeColor, shadowColor, isChute) {
    if (!pts || pts.length < 2) return;

    const isElevMode = (editorState.elevationColorMode === 'track' || editorState.elevationColorMode === 'track_nico');
    const isCompareMode = (editorState.elevationColorMode === 'track_nico');
    const halfW = (editorState.trackData.width || 5.0) / 2 * editorState.scale;

    // Draw Ribbon Path
    if (editorState.showRibbon) {
      if (isElevMode) {
        // Draw individual colored ribbon segments according to elevation Y
        for (let i = 0; i < pts.length - 1; i++) {
          const curr = worldToScreen(pts[i].x, pts[i].z);
          const next = worldToScreen(pts[i + 1].x, pts[i + 1].z);
          const dx = next.screenX - curr.screenX;
          const dy = next.screenY - curr.screenY;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;

          const l1x = curr.screenX + nx * halfW;
          const l1y = curr.screenY + ny * halfW;
          const r1x = curr.screenX - nx * halfW;
          const r1y = curr.screenY - ny * halfW;

          const l2x = next.screenX + nx * halfW;
          const l2y = next.screenY + ny * halfW;
          const r2x = next.screenX - nx * halfW;
          const r2y = next.screenY - ny * halfW;

          const avgY = ((pts[i].y || 1.0) + (pts[i + 1].y || 1.0)) / 2;
          ctx.fillStyle = getElevationColor(avgY, 0.45);
          ctx.strokeStyle = getElevationColor(avgY, 0.75);
          ctx.lineWidth = 1.0;

          ctx.beginPath();
          ctx.moveTo(l1x, l1y);
          ctx.lineTo(l2x, l2y);
          ctx.lineTo(r2x, r2y);
          ctx.lineTo(r1x, r1y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // In Compare Mode (Track + Nico), render the outer borders colored by Nico's GPS elevation
          if (isCompareMode) {
            const midWorldX = (pts[i].x + pts[i + 1].x) / 2;
            const midWorldZ = (pts[i].z + pts[i + 1].z) / 2;
            const nicoY = getNicoElevationAtPoint(midWorldX, midWorldZ);
            const borderCol = getElevationColor(nicoY !== null ? nicoY : avgY, 1.0);

            ctx.save();
            ctx.strokeStyle = borderCol;
            ctx.shadowColor = borderCol;
            ctx.shadowBlur = 8;
            ctx.lineWidth = 3.5;

            // Left Border Rail
            ctx.beginPath();
            ctx.moveTo(l1x, l1y);
            ctx.lineTo(l2x, l2y);
            ctx.stroke();

            // Right Border Rail
            ctx.beginPath();
            ctx.moveTo(r1x, r1y);
            ctx.lineTo(r2x, r2y);
            ctx.stroke();
            ctx.restore();
          }
        }
      } else {
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
    }

    // Draw Centerline
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isElevMode) {
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = worldToScreen(pts[i].x, pts[i].z);
        const p2 = worldToScreen(pts[i + 1].x, pts[i + 1].z);
        const avgY = ((pts[i].y || 1.0) + (pts[i + 1].y || 1.0)) / 2;
        const segColor = getElevationColor(avgY, 1.0);

        ctx.shadowColor = segColor;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = segColor;
        ctx.lineWidth = 4.5;

        ctx.beginPath();
        ctx.moveTo(p1.screenX, p1.screenY);
        ctx.lineTo(p2.screenX, p2.screenY);
        ctx.stroke();
      }
    } else {
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.lineWidth = 4;
      ctx.strokeStyle = strokeColor;

      for (let i = 0; i < pts.length; i++) {
        const { screenX, screenY } = worldToScreen(pts[i].x, pts[i].z);
        if (i === 0) ctx.moveTo(screenX, screenY);
        else ctx.lineTo(screenX, screenY);
      }
      ctx.stroke();
    }
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

  function sampleGhostAtTime(samples, t) {
    if (!samples || samples.length === 0) return null;
    if (t <= samples[0].t) return samples[0];
    if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];

    let low = 0, high = samples.length - 1;
    let idx = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (samples[mid].t <= t) {
        if (mid === samples.length - 1 || samples[mid + 1].t > t) {
          idx = mid;
          break;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const s1 = samples[idx];
    const s2 = samples[Math.min(samples.length - 1, idx + 1)];
    const s0 = samples[Math.max(0, idx - 1)];
    const s3 = samples[Math.min(samples.length - 1, idx + 2)];

    const frac = (t - s1.t) / (s2.t - s1.t || 1);
    const catmull = (p0, p1, p2, p3, u) => {
      const u2 = u * u;
      const u3 = u2 * u;
      return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * u +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * u3
      );
    };

    const x = catmull(s0.x, s1.x, s2.x, s3.x, frac);
    const z = catmull(s0.z, s1.z, s2.z, s3.z, frac);
    const y = catmull(s0.y || 1, s1.y || 1, s2.y || 1, s3.y || 1, frac);

    return { x, y, z };
  }

  function draw() {
    const ctx = editorState.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, editorState.width, editorState.height);

    // 1. Draw Satellite Map Background
    if (editorState.img && editorState.img.complete) {
      const imgW = editorState.img.width;
      const imgH = editorState.img.height;
      const drawW = imgW * 1.5 * (editorState.scale / 4.0);
      const drawH = imgH * 1.5 * (editorState.scale / 4.0);

      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.drawImage(
        editorState.img,
        editorState.offsetX - drawW / 2,
        editorState.offsetY - drawH / 2,
        drawW,
        drawH
      );
      ctx.restore();
    }

    // 1.5 Draw Nico's Recorded Floaty GPS Path Overlay & Draggable Ghost Handles
    if (editorState.showGhostPath && window.TRACK_DATA_HOLLISTER && window.TRACK_DATA_HOLLISTER.ghostData) {
      const samples = window.TRACK_DATA_HOLLISTER.ghostData.samples;
      if (samples && samples.length > 1) {
        ctx.save();
        const isGhostElevMode = (editorState.elevationColorMode === 'ghost' || editorState.elevationColorMode === 'track_nico');

        if (isGhostElevMode) {
          // Render ghost line segments colored with elevation heatmap
          const divisions = samples.length * 8;
          let prevPt = null;
          let prevPos = null;

          for (let i = 0; i <= divisions; i++) {
            const tNorm = (i / divisions) * samples[samples.length - 1].t;
            const pos = sampleGhostAtTime(samples, tNorm);
            if (pos) {
              const pt = worldToScreen(pos.x, pos.z);
              if (prevPt && prevPos) {
                const avgY = (prevPos.y + pos.y) / 2;
                const segColor = getElevationColor(avgY, 1.0);
                ctx.shadowColor = segColor;
                ctx.shadowBlur = editorState.elevationColorMode === 'track_nico' ? 4 : 10;
                ctx.strokeStyle = segColor;
                ctx.lineWidth = editorState.elevationColorMode === 'track_nico' ? 2.5 : 3.5;
                ctx.beginPath();
                ctx.moveTo(prevPt.screenX, prevPt.screenY);
                ctx.lineTo(pt.screenX, pt.screenY);
                ctx.stroke();
              }
              prevPt = pt;
              prevPos = pos;
            }
          }
        } else {
          ctx.shadowColor = '#00ffff';
          ctx.shadowBlur = 10;
          ctx.strokeStyle = '#00ffff';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 4]);

          ctx.beginPath();
          const divisions = samples.length * 8;
          for (let i = 0; i <= divisions; i++) {
            const tNorm = (i / divisions) * samples[samples.length - 1].t;
            const pos = sampleGhostAtTime(samples, tNorm);
            if (pos) {
              const pt = worldToScreen(pos.x, pos.z);
              if (i === 0) ctx.moveTo(pt.screenX, pt.screenY);
              else ctx.lineTo(pt.screenX, pt.screenY);
            }
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Render Ghost Node Handles / GPS Dots
        if (editorState.editGhostMode || isGhostElevMode) {
          for (let i = 0; i < samples.length; i++) {
            const pt = worldToScreen(samples[i].x, samples[i].z);
            const isSel = editorState.selectedGhostIndex === i;
            const isHov = editorState.hoveredGhostIndex === i;
            const dotCol = getElevationColor(samples[i].y || 1.0);

            ctx.save();
            ctx.beginPath();
            ctx.arc(pt.screenX, pt.screenY, isSel ? 7 : (isHov ? 6 : (editorState.elevationColorMode === 'track_nico' ? 4 : 4.5)), 0, Math.PI * 2);
            if (isSel) {
              ctx.fillStyle = '#ff00ff';
              ctx.shadowColor = '#ff00ff';
            } else if (isHov) {
              ctx.fillStyle = '#ffffff';
              ctx.shadowColor = '#ffffff';
            } else if (isGhostElevMode) {
              ctx.fillStyle = dotCol;
              ctx.shadowColor = dotCol;
            } else {
              ctx.fillStyle = '#00ffff';
              ctx.shadowColor = '#00ffff';
            }

            ctx.shadowBlur = 6;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#020617';
            ctx.stroke();
            ctx.restore();
          }
        }

        // Label Start & Ghost Tag
        const startPt = worldToScreen(samples[0].x, samples[0].z);
        ctx.fillStyle = isGhostElevMode ? '#f59e0b' : '#00ffff';
        ctx.font = 'bold 11px sans-serif';
        let ghostLabel = `👻 Nico Floaty Path (${samples.length} pts)`;
        if (editorState.elevationColorMode === 'track_nico') {
          ghostLabel = `👻 Nico GPS Telemetry (${samples.length} points)`;
        } else if (isGhostElevMode) {
          ghostLabel = `👻 Nico Floaty Path (Elevation Mode: ${samples.length} pts)`;
        }
        ctx.fillText(ghostLabel, startPt.screenX + 10, startPt.screenY - 8);
        ctx.restore();
      }
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
      drawSplineRibbonAndLine(ctx, splineData.chutePoints, '#38bdf8', '#0284c7', true);
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

    // 5. Draw Control Nodes (Hidden when in Edit Ghost Mode so user only interacts with Ghost line)
    if (!editorState.editGhostMode) {
      const targetNodeIdx = (editorState.trackData.loopTargetNode || 1) - 1;
      const isElevMode = (editorState.elevationColorMode === 'track' || editorState.elevationColorMode === 'track_nico');
      const labelMode = editorState.elevationLabelMode || 'color';
      const halfW = (editorState.trackData.width || 5.0) / 2 * editorState.scale;

      for (let i = 0; i < nodes.length; i++) {
        const { screenX, screenY } = worldToScreen(nodes[i].x, nodes[i].z);
        const isSelected = editorState.selectedNodes.has(i) || editorState.selectedNodeIndex === i;
        const isHovered = editorState.hoveredNodeIndex === i;
        const isMergeNode = splineData.isChuteCircuit && i === targetNodeIdx;

        // Draw Node Center Circle
        ctx.beginPath();
        ctx.arc(screenX, screenY, isSelected ? 8.5 : (isHovered ? 7.5 : 5.5), 0, Math.PI * 2);

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
        } else if (isElevMode) {
          ctx.fillStyle = getElevationColor(nodes[i].y);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
        } else {
          const y = nodes[i].y || 0;
          if (y > 6.0) ctx.fillStyle = '#ef4444';
          else if (y > 4.0) ctx.fillStyle = '#34d399';
          else ctx.fillStyle = '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
        }

        ctx.fill();
        ctx.stroke();

        // Node Elevation Label & Index Badge (Interactive high-vis offset capsule badge)
        if (labelMode !== 'off') {
          const badge = getNodeBadgeRect(i);
          if (badge) {
            ctx.save();

            // 1. Connector line from node center to badge edge
            ctx.beginPath();
            ctx.moveTo(badge.screenX, badge.screenY);
            ctx.lineTo(badge.badgeCenterX, badge.badgeCenterY);
            ctx.strokeStyle = isSelected ? '#facc15' : (isHovered ? '#00ffff' : 'rgba(255, 255, 255, 0.35)');
            ctx.lineWidth = (isSelected || isHovered) ? 1.8 : 1.2;
            ctx.stroke();

            // 2. High-contrast Dark Capsule Background
            ctx.fillStyle = isSelected ? 'rgba(15, 23, 42, 0.98)' : (isHovered ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.92)');
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(badge.x, badge.y, badge.w, badge.h, 6);
            else ctx.rect(badge.x, badge.y, badge.w, badge.h);
            ctx.fill();

            // Badge Border (Glows cyan on hover, gold on select)
            ctx.lineWidth = isSelected ? 2.2 : (isHovered ? 2.0 : 1.2);
            if (isSelected) {
              ctx.strokeStyle = '#facc15';
            } else if (isHovered) {
              ctx.strokeStyle = '#00ffff';
            } else if (labelMode === 'color') {
              ctx.strokeStyle = getElevationColor(badge.elevVal, 0.85);
            } else {
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            }
            ctx.stroke();

            // 3. Left pill for Node Index (#21)
            ctx.fillStyle = isSelected ? '#ca8a04' : (isHovered ? '#0284c7' : '#334155');
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(badge.numPillX, badge.numPillY, badge.numPillW, badge.numPillH, 4);
            else ctx.rect(badge.numPillX, badge.numPillY, badge.numPillW, badge.numPillH);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px "Space Grotesk", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badge.nodeNumText, badge.numPillX + badge.numPillW / 2, badge.numPillY + badge.numPillH / 2);

            // 4. Right side: WAY BIGGER Elevation gain text (e.g. 6.8m)
            ctx.font = 'bold 13px "Space Grotesk", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            if (labelMode === 'color') {
              ctx.fillStyle = getElevationColor(badge.elevVal, 1.0);
            } else {
              ctx.fillStyle = '#ffffff';
            }
            ctx.fillText(badge.elevText, badge.textX, badge.textY);

            ctx.restore();
          }
        } else {
          // Minimal Node Index Badge when elevation text is off
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px "Space Grotesk", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${i + 1}`, screenX + 8, screenY - 2);
        }
      }
    }

    // 6. Draw Features & Free-Floating Numbered Indicators
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

      ctx.save();

      // Feature marker color on track
      let baseColor = '#8b5cf6';
      const typeLower = (f.type || '').toLowerCase();
      if (typeLower.includes('start')) {
        baseColor = '#10b981';
      } else if (typeLower.includes('finish')) {
        baseColor = '#f59e0b';
      } else {
        baseColor = '#8b5cf6';
      }

      // Halo when active / hovered
      if (isSelected || isHovered || isDragging) {
        ctx.beginPath();
        ctx.arc(screenX, screenY, 18, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? 'rgba(0, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.25)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isSelected ? '#00ffff' : '#ffffff';
        ctx.stroke();
      }

      // Obstacle square marker directly on track
      const boxSize = 20;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(screenX - boxSize / 2, screenY - boxSize / 2, boxSize, boxSize, 4);
      } else {
        ctx.rect(screenX - boxSize / 2, screenY - boxSize / 2, boxSize, boxSize);
      }
      ctx.fillStyle = baseColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isSelected ? '#00ffff' : '#ffffff';
      ctx.stroke();

      // Floating Indicator Pill + Number Badge sitting next to the feature marker
      const hasNumber = (f.number !== undefined);
      const displayName = (f.name || f.type || '').toUpperCase();

      ctx.font = 'bold 10px "Space Grotesk", sans-serif';
      const nameW = ctx.measureText(displayName).width;

      const badgeR = 9;
      const badgeSpacing = hasNumber ? (badgeR * 2 + 6) : 0;
      const pillW = nameW + 16 + badgeSpacing;
      const pillH = 22;
      const pillX = screenX + 16;
      const pillY = screenY - 11;

      // Pointer connector line from track box to label pill
      ctx.beginPath();
      ctx.moveTo(screenX + boxSize / 2, screenY);
      ctx.lineTo(pillX, screenY);
      ctx.strokeStyle = isSelected ? '#00ffff' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Capsule Background
      ctx.fillStyle = isSelected ? 'rgba(2, 132, 199, 0.95)' : 'rgba(15, 23, 42, 0.92)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(pillX, pillY, pillW, pillH, 5);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = isSelected ? '#00ffff' : 'rgba(255, 255, 255, 0.3)';
      ctx.stroke();

      // Free-Floating Circular Number Badge sitting inside/next to the label
      let textStartX = pillX + 8;
      if (hasNumber) {
        const badgeCenterX = pillX + 11;
        const badgeCenterY = pillY + pillH / 2;

        ctx.beginPath();
        ctx.arc(badgeCenterX, badgeCenterY, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(f.number), badgeCenterX, badgeCenterY);

        textStartX += badgeR * 2 + 4;
      }

      // Feature Name text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayName, textStartX, pillY + pillH / 2);

      ctx.restore();
    }

    // 6.5 Draw Foliage & Trees (Only drawn on map when Trees & Bushes tool is toggled ON)
    if (editorState.currentTool === 'tree') {
      const scenery = editorState.trackData.scenery || [];
      for (let i = 0; i < scenery.length; i++) {
        const tree = scenery[i];
        const { screenX, screenY } = worldToScreen(tree.x, tree.z);
        const isSelected = (editorState.selectedTreeIndex === i);
        const isHovered = (editorState.hoveredTreeIndex === i);
        const isDragging = (editorState.isDraggingTree && editorState.selectedTreeIndex === i);
        const scale = (tree.scale || 1.0) * (editorState.scale / 3.5);

        ctx.save();

        // Selection / Hover Halo Ring
        if (isSelected || isHovered || isDragging) {
          ctx.beginPath();
          const haloR = (tree.type === 'mature_oak' ? 24 : (tree.type === 'mid_oak' ? 18 : 12)) * scale;
          ctx.arc(screenX, screenY, Math.max(14, haloR), 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? 'rgba(0, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.25)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = isSelected ? '#00ffff' : '#ffffff';
          ctx.stroke();
        }

        // 2D Realistic Canopy
        if (tree.type === 'mature_oak') {
          const r = 16 * scale;
          // Shadow underneath
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.beginPath();
          ctx.ellipse(screenX + 3 * scale, screenY + 4 * scale, r * 1.05, r * 0.75, 0, 0, Math.PI * 2);
          ctx.fill();

          // Multi-lobe Live Oak Canopy
          const lobes = [
            { ox: 0, oy: 0, rad: r * 0.95, col: '#1b4332' },
            { ox: -6 * scale, oy: -3 * scale, rad: r * 0.7, col: '#2d6a4f' },
            { ox: 6 * scale, oy: -4 * scale, rad: r * 0.72, col: '#2d6a4f' },
            { ox: -4 * scale, oy: 4 * scale, rad: r * 0.65, col: '#40916c' },
            { ox: 5 * scale, oy: 3 * scale, rad: r * 0.68, col: '#40916c' },
            { ox: 0, oy: -2 * scale, rad: r * 0.55, col: '#52b788' }
          ];
          lobes.forEach(l => {
            ctx.beginPath();
            ctx.arc(screenX + l.ox, screenY + l.oy, l.rad, 0, Math.PI * 2);
            ctx.fillStyle = l.col;
            ctx.fill();
          });

          // Center trunk dot
          ctx.beginPath();
          ctx.arc(screenX, screenY, Math.max(2, 2.5 * scale), 0, Math.PI * 2);
          ctx.fillStyle = '#2e2017';
          ctx.fill();
        } else if (tree.type === 'mid_oak') {
          const r = 11 * scale;
          // Shadow underneath
          ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
          ctx.beginPath();
          ctx.ellipse(screenX + 2 * scale, screenY + 3 * scale, r * 1.05, r * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();

          // 3-Lobe Oak Canopy
          const lobes = [
            { ox: 0, oy: 0, rad: r * 0.9, col: '#2d6a4f' },
            { ox: -4 * scale, oy: -2 * scale, rad: r * 0.65, col: '#40916c' },
            { ox: 4 * scale, oy: -1 * scale, rad: r * 0.65, col: '#52b788' }
          ];
          lobes.forEach(l => {
            ctx.beginPath();
            ctx.arc(screenX + l.ox, screenY + l.oy, l.rad, 0, Math.PI * 2);
            ctx.fillStyle = l.col;
            ctx.fill();
          });

          // Center trunk dot
          ctx.beginPath();
          ctx.arc(screenX, screenY, Math.max(1.8, 2.0 * scale), 0, Math.PI * 2);
          ctx.fillStyle = '#2e2017';
          ctx.fill();
        } else {
          // Bush / Chaparral Scrub
          const r = 7.5 * scale;
          // Shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
          ctx.beginPath();
          ctx.ellipse(screenX + 1.5 * scale, screenY + 2 * scale, r * 1.0, r * 0.65, 0, 0, Math.PI * 2);
          ctx.fill();

          // Bush Cluster
          const lobes = [
            { ox: 0, oy: 0, rad: r * 0.85, col: '#3d502a' },
            { ox: -2.5 * scale, oy: 1 * scale, rad: r * 0.6, col: '#4a5d33' },
            { ox: 2.5 * scale, oy: -1 * scale, rad: r * 0.6, col: '#56673a' }
          ];
          lobes.forEach(l => {
            ctx.beginPath();
            ctx.arc(screenX + l.ox, screenY + l.oy, l.rad, 0, Math.PI * 2);
            ctx.fillStyle = l.col;
            ctx.fill();
          });
        }

        ctx.restore();
      }
    }

    // 6.6 Tree Brush Preview Ring
    if (editorState.currentTool === 'tree' && editorState.treeCursorWorld) {
      const { screenX, screenY } = worldToScreen(editorState.treeCursorWorld.x, editorState.treeCursorWorld.z);
      const brushScale = editorState.treeBrushScale || 1.0;
      const brushRadiusMeters = editorState.treeBrushType === 'mature_oak' ? 3.8 : (editorState.treeBrushType === 'mid_oak' ? 2.6 : 1.4);
      const radiusPx = brushRadiusMeters * brushScale * editorState.scale;

      ctx.save();
      ctx.beginPath();
      ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();

      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fill();

      // Brush icon text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const icon = editorState.treeBrushType === 'mature_oak' ? '🌳' : (editorState.treeBrushType === 'mid_oak' ? '🌲' : '🌿');
      ctx.fillText(icon, screenX, screenY);
      ctx.restore();
    }

    // 7. Draw Elevation Heatmap Scale Legend when elevation view is active
    if (editorState.elevationColorMode === 'track' || editorState.elevationColorMode === 'track_nico' || editorState.elevationColorMode === 'ghost') {
      ctx.save();
      const isCompare = (editorState.elevationColorMode === 'track_nico');
      const legendW = isCompare ? 320 : 260;
      const legendH = isCompare ? 64 : 50;
      const legendX = editorState.width - legendW - 20;
      const legendY = editorState.height - legendH - 45;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(legendX, legendY, legendW, legendH, 8);
      else ctx.rect(legendX, legendY, legendW, legendH);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isCompare ? '#f59e0b' : '#00ffff';
      ctx.stroke();

      // Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let modeTitle = '🏔️ Track Elevation Heatmap';
      if (editorState.elevationColorMode === 'track_nico') {
        modeTitle = '🏔️ Track Surface  vs  👻 Nico GPS Borders';
      } else if (editorState.elevationColorMode === 'ghost') {
        modeTitle = '👻 Nico GPS Elevation Heatmap';
      }
      ctx.fillText(modeTitle, legendX + 10, legendY + 8);

      // Color Gradient Bar
      const gradX = legendX + 10;
      const gradY = legendY + 24;
      const gradW = legendW - 20;
      const gradH = 8;

      const grad = ctx.createLinearGradient(gradX, gradY, gradX + gradW, gradY);
      grad.addColorStop(0.00, getElevationColor(1.0));
      grad.addColorStop(0.25, getElevationColor(2.7));
      grad.addColorStop(0.50, getElevationColor(4.35));
      grad.addColorStop(0.75, getElevationColor(6.0));
      grad.addColorStop(1.00, getElevationColor(7.7));

      ctx.fillStyle = grad;
      ctx.fillRect(gradX, gradY, gradW, gradH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.strokeRect(gradX, gradY, gradW, gradH);

      // Labels below gradient
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText('1.0m (Low)', gradX, gradY + gradH + 4);
      ctx.textAlign = 'center';
      ctx.fillText('4.3m', gradX + gradW / 2, gradY + gradH + 4);
      ctx.textAlign = 'right';
      ctx.fillText('7.7m (Peak)', gradX + gradW, gradY + gradH + 4);

      if (isCompare) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 8.5px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Surface: Track Y  •  Borders & Dots: Nico GPS Y', gradX + gradW / 2, gradY + gradH + 16);
      }

      ctx.restore();
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
    const targetNode = nodes[minIdx];
    if (type === 'start_chute' || type === 'start_chute_gate') {
      let existing = editorState.trackData.features.find(f => f.type && f.type.includes('start'));
      if (existing) {
        existing.nodeIndex = minIdx;
        existing.x = targetNode.x;
        existing.y = targetNode.y !== undefined ? targetNode.y : 1.0;
        existing.z = targetNode.z;
        existing.heading = -1.716;
        existing.width = 20;
      } else {
        editorState.trackData.features.push({
          type: 'start_chute_gate',
          name: 'Start Chute Staging Gate',
          nodeIndex: minIdx,
          x: targetNode.x,
          y: targetNode.y !== undefined ? targetNode.y : 1.0,
          z: targetNode.z,
          heading: -1.716,
          width: 20
        });
      }
    } else if (type === 'finish_line' || type === 'finish_timing_gate') {
      let existing = editorState.trackData.features.find(f => f.type && f.type.includes('finish'));
      if (existing) {
        existing.nodeIndex = minIdx;
        existing.x = targetNode.x;
        existing.y = targetNode.y !== undefined ? targetNode.y : 3.0;
        existing.z = targetNode.z;
        existing.heading = 1.406;
        existing.width = 6.5;
        existing.t = Math.round((minIdx / nodes.length) * 100) / 100;
      } else {
        editorState.trackData.features.push({
          type: 'finish_timing_gate',
          name: 'Lap Finish & Timing Gate',
          nodeIndex: minIdx,
          x: targetNode.x,
          y: targetNode.y !== undefined ? targetNode.y : 3.0,
          z: targetNode.z,
          heading: 1.406,
          width: 6.5,
          t: Math.round((minIdx / nodes.length) * 100) / 100
        });
      }
    }
    syncToGlobalTrackData();
    saveDraft();
    updateNumberedFeaturesUI();
    draw();
  }

  // =========================================================================
  // Export & Import Handlers
  // =========================================================================

  function generateExportJSON() {
    const nodes = editorState.trackData.nodes;
    const spawnNode = nodes.length > 0 ? nodes[0] : { x: 0, y: 1.0, z: 0 };
    const splineData = getSplineSamples(nodes.length * 20);

    const ghostData = (editorState.trackData && editorState.trackData.ghostData) ||
      (window.TRACK_DATA_HOLLISTER && window.TRACK_DATA_HOLLISTER.ghostData);

    const elevValues = nodes.map(n => n.y !== undefined ? n.y : 1.0);
    const minElev = elevValues.length ? Math.min(...elevValues) : 0;
    const maxElev = elevValues.length ? Math.max(...elevValues) : 0;

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
      minElevationMeters: Math.round(minElev * 100) / 100,
      maxElevationMeters: Math.round(maxElev * 100) / 100,
      nodes: nodes.map(n => ({
        x: Math.round(n.x * 100) / 100,
        y: Math.round((n.y !== undefined ? n.y : 1.0) * 100) / 100,
        z: Math.round(n.z * 100) / 100,
        bank: n.bank || 0,
        ...(n.w ? { w: n.w } : {})
      })),
      features: editorState.trackData.features || [],
      scenery: (editorState.trackData.scenery || []).map(t => ({
        type: t.type || 'mature_oak',
        x: Math.round(t.x * 10) / 10,
        z: Math.round(t.z * 10) / 10,
        scale: Math.round((t.scale || 1.0) * 100) / 100,
        variant: t.variant !== undefined ? t.variant : 0
      })),
      ...(ghostData ? { ghostData: ghostData } : {}),
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
      if (parsed.scenery) editorState.trackData.scenery = parsed.scenery;
      if (parsed.name) editorState.trackData.name = parsed.name;
      if (parsed.ghostData) {
        editorState.trackData.ghostData = parsed.ghostData;
        if (window.TRACK_DATA_HOLLISTER) {
          window.TRACK_DATA_HOLLISTER.ghostData = parsed.ghostData;
        }
      }

      closeImportModal();
      resetView();
      updateLoopTargetUI();
      updateFoliageUI();
      updateHUD();
      draw();
      alert(`Loaded track outline with ${parsed.nodes.length} spline nodes!`);
    } catch (err) {
      alert(`Failed to parse JSON: ${err.message}`);
    }
  }

  // Ghost Toggle Event Handler
  const btnGhost = document.getElementById('btnToggleGhostPath');
  if (btnGhost) {
    btnGhost.addEventListener('click', () => {
      editorState.showGhostPath = !editorState.showGhostPath;
      const lbl = document.getElementById('lblGhostPath');
      if (lbl) lbl.innerText = `Nico Path: ${editorState.showGhostPath ? 'On' : 'Off'}`;
      btnGhost.classList.toggle('active', editorState.showGhostPath);
      draw();
    });
  }

  // Edit Ghost Nodes Mode Handler
  const btnEditGhost = document.getElementById('btnToggleEditGhost');
  if (btnEditGhost) {
    btnEditGhost.addEventListener('click', () => {
      editorState.editGhostMode = !editorState.editGhostMode;
      if (editorState.editGhostMode) {
        editorState.showGhostPath = true;
        setTool('select'); // Automatically switch to Move Nodes tool
        editorState.selectedNodeIndex = -1;
        editorState.selectedNodes.clear();
        editorState.selectedFeatureIndex = -1;
      }
      const lbl = document.getElementById('lblEditGhost');
      if (lbl) lbl.innerText = `Edit Ghost: ${editorState.editGhostMode ? 'On' : 'Off'}`;
      const lblG = document.getElementById('lblGhostPath');
      if (lblG) lblG.innerText = `Nico Path: ${editorState.showGhostPath ? 'On' : 'Off'}`;
      btnEditGhost.classList.toggle('active', editorState.editGhostMode);
      draw();
    });
  }

  // Elevation Heatmap Toggle Event Handler (Off ➔ Track ➔ Track + Nico ➔ Nico GPS ➔ Off)
  const btnElevColor = document.getElementById('btnToggleElevationColor');
  if (btnElevColor) {
    btnElevColor.addEventListener('click', () => {
      if (editorState.elevationColorMode === 'off') {
        editorState.elevationColorMode = 'track';
      } else if (editorState.elevationColorMode === 'track') {
        editorState.elevationColorMode = 'track_nico';
        editorState.showGhostPath = true;
        const lblG = document.getElementById('lblGhostPath');
        if (lblG) lblG.innerText = 'Nico Path: On';
        const btnG = document.getElementById('btnToggleGhostPath');
        if (btnG) btnG.classList.add('active');
      } else if (editorState.elevationColorMode === 'track_nico') {
        editorState.elevationColorMode = 'ghost';
        editorState.showGhostPath = true;
        const lblG = document.getElementById('lblGhostPath');
        if (lblG) lblG.innerText = 'Nico Path: On';
        const btnG = document.getElementById('btnToggleGhostPath');
        if (btnG) btnG.classList.add('active');
      } else {
        editorState.elevationColorMode = 'off';
      }

      const lblElev = document.getElementById('lblElevationColor');
      if (lblElev) {
        if (editorState.elevationColorMode === 'off') {
          lblElev.innerText = 'Elevation: Off';
          btnElevColor.classList.remove('active');
        } else if (editorState.elevationColorMode === 'track') {
          lblElev.innerText = 'Elevation: Track';
          btnElevColor.classList.add('active');
        } else if (editorState.elevationColorMode === 'track_nico') {
          lblElev.innerText = 'Elevation: Track + Nico';
          btnElevColor.classList.add('active');
        } else if (editorState.elevationColorMode === 'ghost') {
          lblElev.innerText = 'Elevation: Nico GPS';
          btnElevColor.classList.add('active');
        }
      }

      draw();
    });
  }

  // Node Elevation Gain Label Mode (Color-Coded ➔ Plain White ➔ Off)
  function setElevLabelMode(mode) {
    editorState.elevationLabelMode = mode;
    const btn = document.getElementById('btnToggleElevLabels');
    const lbl = document.getElementById('lblElevLabels');
    const sel = document.getElementById('selectElevLabels');
    if (sel && sel.value !== mode) sel.value = mode;
    if (lbl) {
      if (mode === 'color') lbl.innerText = 'Labels: Color';
      else if (mode === 'plain') lbl.innerText = 'Labels: Plain';
      else lbl.innerText = 'Labels: Off';
    }
    if (btn) {
      btn.classList.toggle('active', mode !== 'off');
    }
    draw();
  }

  const btnToggleElevLabels = document.getElementById('btnToggleElevLabels');
  if (btnToggleElevLabels) {
    btnToggleElevLabels.addEventListener('click', () => {
      const current = editorState.elevationLabelMode || 'color';
      const next = (current === 'color') ? 'plain' : (current === 'plain' ? 'off' : 'color');
      setElevLabelMode(next);
    });
  }

  const selectElevLabels = document.getElementById('selectElevLabels');
  if (selectElevLabels) {
    selectElevLabels.addEventListener('change', (e) => {
      setElevLabelMode(e.target.value);
    });
  }

  // Snap Ghost Telemetry onto Track Spline (Chronological & Direction-Aware)
  function snapGhostToTrackSpline() {
    if (!window.TRACK_DATA_HOLLISTER || !window.TRACK_DATA_HOLLISTER.ghostData) {
      alert('No ghost telemetry data available to snap.');
      return;
    }

    const ghostData = window.TRACK_DATA_HOLLISTER.ghostData;
    const samples = ghostData.samples;
    if (!samples || samples.length === 0) return;

    // Get high-density track spline points (800 divisions)
    const trackSamples = getSplineSamples(800);
    const trackPts = trackSamples.points;
    if (!trackPts || trackPts.length < 2) {
      alert('Please add track nodes before snapping ghost.');
      return;
    }

    pushHistory();
    let snappedCount = 0;
    let lastTrackIdx = 0;
    const maxSearchWindow = Math.floor(trackPts.length * 0.25); // Search within forward progress window

    for (let i = 0; i < samples.length; i++) {
      const g = samples[i];
      let bestDistSq = Infinity;
      let bestPt = trackPts[lastTrackIdx];
      let bestIdx = lastTrackIdx;

      // Search sequentially forward along the track spline from last projected position
      for (let offset = -15; offset < maxSearchWindow; offset++) {
        let j = (lastTrackIdx + offset + trackPts.length) % trackPts.length;
        const tp = trackPts[j];
        const dx = g.x - tp.x;
        const dz = g.z - tp.z;
        const d2 = dx * dx + dz * dz;

        // Check heading compatibility if ghost heading is defined
        const nextPt = trackPts[(j + 1) % trackPts.length];
        const trackHeading = Math.atan2(nextPt.x - tp.x, nextPt.z - tp.z);
        let headingDiff = Math.abs(g.heading - trackHeading);
        while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
        headingDiff = Math.abs(headingDiff);

        // Penalty for opposing directions
        const dirPenalty = headingDiff > 1.2 ? 1000 : (headingDiff > 0.8 ? 50 : 1);
        const score = d2 * dirPenalty;

        if (score < bestDistSq) {
          bestDistSq = score;
          bestPt = tp;
          bestIdx = j;
        }
      }

      lastTrackIdx = bestIdx;
      const nextPt = trackPts[(bestIdx + 1) % trackPts.length];
      const heading = Math.atan2(nextPt.x - bestPt.x, nextPt.z - bestPt.z);

      g.x = Math.round(bestPt.x * 100) / 100;
      g.z = Math.round(bestPt.z * 100) / 100;
      g.y = Math.round((bestPt.y !== undefined ? bestPt.y : g.y) * 100) / 100;
      g.heading = heading;
      snappedCount++;
    }

    editorState.showGhostPath = true;
    const lbl = document.getElementById('lblGhostPath');
    if (lbl) lbl.innerText = 'Nico Path: On';

    syncToGlobalTrackData();
    saveDraft();
    draw();
    alert(`⚡ Successfully projected ${snappedCount} telemetry points sequentially along track spline!`);
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

