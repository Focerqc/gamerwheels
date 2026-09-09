"""
convert_thps.py — Blender headless THPS .prk → .glb converter

Usage: blender -b -P convert_thps.py -- <addonDir> <input.prk> [output.glb]

Loads the legacy io_thps_scene Blender 2.79 addon modules DIRECTLY (skipping
__init__.py's ui_draw/scene_props auto-imports) via a custom import hook that
applies source-transform compatibility patches, bridging removed APIs:
  - bgl module (stub)
  - bpy.context.user_preferences → fake _THUG_PREFS
  - scene.objects.link/unlink → scene.collection.objects.link/unlink
  - scene.objects.active = → bpy.context.view_layer.objects.active =
  - object.to_mesh(scene, apply, prev) → object.to_mesh(depsgraph)
  - material.texture_slots.add() → _compat_tex_slot_add()
  - matrix_world * vec → matrix_world @ vec
  - removed material props (use_transparency, diffuse_intensity, alpha)
  - removed uv_textures[].active → no-op
Also registers the minimal set of custom properties (thug_export_scene,
thug_path_type, etc.) that the importer assigns at runtime.
"""
import bpy
import sys
import os
import re
import types
import importlib
import importlib.abc
import importlib.machinery
import traceback

# ---------------------------------------------------------------------------
# 1. Parse CLI args
# ---------------------------------------------------------------------------
_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(_args) < 2:
    print("Usage: blender -b -P convert_thps.py -- <addonDir> <input.prk> [output.glb]")
    sys.exit(1)

ADDON_DIR = os.path.abspath(_args[0])
INPUT_FILE = os.path.abspath(_args[1])
OUTPUT_FILE = os.path.abspath(_args[2]) if len(_args) > 2 else ""

_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# ---------------------------------------------------------------------------
# 2. Stub removed modules
# ---------------------------------------------------------------------------
class _BGLStub(types.ModuleType):
    """Minimal stub for bgl (removed in Blender 4.0)."""
    def __getattr__(self, name):
        return lambda *a, **kw: None

sys.modules["bgl"] = _BGLStub("bgl")

# ---------------------------------------------------------------------------
# 3. Fake addon preferences (replaces bpy.context.user_preferences…)
# ---------------------------------------------------------------------------
class _FakeAddonPrefs:
    base_files_dir = os.path.join(
        os.path.dirname(ADDON_DIR), "thug_tools") + os.sep

_THUG_PREFS = _FakeAddonPrefs()


def _compat_tex_slot_add(mat):
    """Shim for material.texture_slots.add() (removed 2.80+)."""
    class _FakeSlot:
        texture = None
        uv_layer = "0"
        blend_type = "MIX"
        use_map_alpha = False
    slot = _FakeSlot()
    if not hasattr(mat, "_compat_tex_slots"):
        mat._compat_tex_slots = []
    mat._compat_tex_slots.append(slot)
    return slot


# ---------------------------------------------------------------------------
# 4. Register the custom properties the importer assigns at runtime
# ---------------------------------------------------------------------------
from bpy.props import (
    BoolProperty, StringProperty, CollectionProperty, PointerProperty
)

if not hasattr(bpy.types.Object, "thug_export_scene"):
    bpy.types.Object.thug_export_scene = BoolProperty(name="Export to Scene", default=True)
if not hasattr(bpy.types.Object, "thug_export_collision"):
    bpy.types.Object.thug_export_collision = BoolProperty(name="Export to Collisions", default=True)
if not hasattr(bpy.types.Object, "thug_path_type"):
    bpy.types.Object.thug_path_type = StringProperty(name="Path Type", default="None")
if not hasattr(bpy.types.Object, "thug_rail_terrain_type"):
    bpy.types.Object.thug_rail_terrain_type = StringProperty(name="Rail Terrain Type", default="Auto")
if not hasattr(bpy.types.Object, "thug_rail_connects_to"):
    bpy.types.Object.thug_rail_connects_to = StringProperty(name="Linked To", default="")
if not hasattr(bpy.types.Curve, "thug_pathnode_triggers"):
    bpy.types.Curve.thug_pathnode_triggers = CollectionProperty(type=bpy.types.PropertyGroup)

print(f"  ✓ Custom THUG properties registered")
print(f"  ✓ Base files dir: {_THUG_PREFS.base_files_dir}")

# ---------------------------------------------------------------------------
# 5. Source-transform compatibility patches
# ---------------------------------------------------------------------------
# Global transforms applied to every loaded addon module.
_GLOBAL_TRANSFORMS = [
    # user_preferences.addons[ADDON_NAME].preferences → _THUG_PREFS
    (re.compile(r'bpy\.context\.user_preferences\.addons\[[^\]]+\]\.preferences'),
     '_THUG_PREFS'),

    # scene.objects.link( / .unlink( → scene.collection.objects.*  (2.80+)
    (re.compile(r'((?:bpy\.context\.scene|context\.scene|scene|scn))\.objects\.(link|unlink)\('),
     lambda m: f'{m.group(1)}.collection.objects.{m.group(2)}('),

    # .objects.active = → bpy.context.view_layer.objects.active =
    (re.compile(r'((?:bpy\.context\.scene|context\.scene|scene|scn))\.objects\.active\s*='),
     'bpy.context.view_layer.objects.active ='),

    # presets.py: robust parent detection (fallback to any mesh if thug_export_scene unset)
    (re.compile(
        r'    parent_ob = None\n'
        r'    for ob_name in linked_obs:\n'
        r'        if bpy\.data\.objects\.get\(ob_name\)\.type == \'MESH\' and bpy\.data\.objects\.get\(ob_name\)\.thug_export_scene:\n'
        r'            parent_ob = bpy\.data\.objects\.get\(ob_name\)\n'),
     (
         '    parent_ob = None\n'
         '    for ob_name in linked_obs:\n'
         '        ob = bpy.data.objects.get(ob_name)\n'
         '        if ob and ob.type == \'MESH\' and getattr(ob, \'thug_export_scene\', True):\n'
         '            parent_ob = ob\n'
         '            break\n'
         '    if parent_ob is None:\n'
         '        for ob_name in linked_obs:\n'
         '            ob = bpy.data.objects.get(ob_name)\n'
         '            if ob and ob.type == \'MESH\':\n'
         '                parent_ob = ob\n'
         '                break\n'
     )),

    # material.texture_slots.add() → compat shim
    (re.compile(r'(\w+)\.texture_slots\.add\(\)'),
     lambda m: f'_compat_tex_slot_add({m.group(1)})'),

    # Blender 5.2 probe results:
    #   .hide is READ-ONLY  → use .hide_set()
    #   .hide_render is a settable property → leave it alone!
    #   .select is READ-ONLY → use .select_set()
    # Only map the .hide (viewport) and .select patterns. Do NOT map .hide_render.
    (re.compile(r'(?<!render)\.hide\s*=\s*(True|False)'),
     lambda m: f'.hide_set({m.group(1)})'),
    (re.compile(r'\.select\s*=\s*(True|False)'),
     lambda m: f'.select_set({m.group(1)})'),

    # Removed material props
    (re.compile(r'blender_mat\.use_transparency\s*=\s*True'),
     'None  # compat: use_transparency removed'),
    (re.compile(r'blender_mat\.diffuse_color\s*=\s*\([^)]*\)'),
     'None  # compat: diffuse_color is node-based'),
    (re.compile(r'blender_mat\.diffuse_intensity\s*=\s*[^\n]*'),
     'None  # compat: diffuse_intensity removed'),
    (re.compile(r'blender_mat\.specular_intensity\s*=\s*[^\n]*'),
     'None  # compat: specular_intensity removed'),
    (re.compile(r'blender_mat\.alpha\s*=\s*[^\n]*'),
     'None  # compat: alpha is node-based'),

    # object.to_mesh(scene, apply, preview) → keyword depsgraph form (4.1+)
    (re.compile(r'\.to_mesh\(bpy\.context\.scene,\s*(?:True|False),\s*\'[A-Z_]+\'\)'),
     '.to_mesh(depsgraph=bpy.context.evaluated_depsgraph_get())'),

    # removed uv_textures[].active / .active_render
    (re.compile(r'\.uv_textures\[\'Rail\'\]\.active_render\s*=\s*True'),
     'None  # compat: uv_textures.active_render removed'),
    (re.compile(r'\.uv_textures\[\'Rail\'\]\.active\s*=\s*True'),
     'None  # compat: uv_textures.active removed'),

    # removed bpy.ops.mesh.uv_texture_add({"object": ob}) → create UV layer directly
    # (operator removed in Blender 3.0; returns int index in 2.79)
    (re.compile(r'bpy\.ops\.mesh\.uv_texture_add\(\{"object": (\w+)\}\)'),
     lambda m: f'{m.group(1)}.data.uv_layers.new(name="Rail")'),

    # matrix multiplication:  matrix_world * vec  →  matrix_world @ vec
    (re.compile(r'\.matrix_world\s*\*\s*'),
     '.matrix_world @ '),
]

# Autorail-specific: replace get_autorail_material with a node-based version
_AUTORAIL_MATERIAL_REPLACEMENT = (
    'def get_autorail_material():\n'
    '    name = "Autorail_Metal"\n'
    '    mat = bpy.data.materials.get(name)\n'
    '    if mat is None:\n'
    '        mat = bpy.data.materials.new(name)\n'
    '    mat.use_nodes = True\n'
    '    bsdf = mat.node_tree.nodes.get("Principled BSDF")\n'
    '    if bsdf:\n'
    '        bsdf.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1.0)\n'
    '        bsdf.inputs["Metallic"].default_value = 0.85\n'
    '        bsdf.inputs["Roughness"].default_value = 0.35\n'
    '    return mat\n'
)

_AUTORAIL_TRANSFORMS = [
    (re.compile(r'def get_autorail_material\(\):.*?(?=\n\n#|\n\nclass |\Z)', re.DOTALL),
     _AUTORAIL_MATERIAL_REPLACEMENT),
]


def _apply_transforms(source: str, module_name: str) -> str:
    transforms = list(_GLOBAL_TRANSFORMS)
    if module_name == "io_thps_scene.autorail":
        transforms += _AUTORAIL_TRANSFORMS

    result = source
    for i, (pattern, repl) in enumerate(transforms):
        try:
            result = pattern.sub(repl, result)
        except Exception as e:
            print(f"  [transform {i}] warning in {module_name}: {e}")
    return result


# ---------------------------------------------------------------------------
# 6. Custom import hook (Python 3.12+: find_spec / exec_module)
# ---------------------------------------------------------------------------
class _AddonTransformFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "io_thps_scene" or fullname.startswith("io_thps_scene."):
            loader = _AddonTransformLoader(fullname)
            spec = importlib.machinery.ModuleSpec(fullname, loader)
            if fullname == "io_thps_scene":
                spec.submodule_search_locations = [ADDON_DIR]
            return spec
        return None


class _AddonTransformLoader(importlib.abc.Loader):
    def __init__(self, fullname):
        self.fullname = fullname

    def create_module(self, spec):
        return None  # default module creation

    def exec_module(self, module):
        module.__loader__ = self

        if self.fullname == "io_thps_scene":
            # Package root: we do NOT execute __init__.py (it would auto-import
            # ui_draw/scene_props/exporters via developer_utils). Just set __path__.
            module.__path__ = [ADDON_DIR]
            module.__file__ = os.path.join(ADDON_DIR, "__init__.py")
            module.__package__ = "io_thps_scene"
            sys.modules[self.fullname] = module
            return

        rel = self.fullname.split(".", 1)[1]
        module.__file__ = os.path.join(ADDON_DIR, rel.replace(".", "/") + ".py")
        module.__package__ = "io_thps_scene"

        with open(module.__file__, "r", encoding="utf-8", errors="replace") as f:
            source = f.read()

        source = _apply_transforms(source, self.fullname)
        code = compile(source, module.__file__, "exec")

        # Inject compat globals available to transformed code
        module.__dict__["_THUG_PREFS"] = _THUG_PREFS
        module.__dict__["_compat_tex_slot_add"] = _compat_tex_slot_add

        print(f"  · loading {self.fullname}")
        exec(code, module.__dict__)
        sys.modules[self.fullname] = module


sys.meta_path.insert(0, _AddonTransformFinder())

# ---------------------------------------------------------------------------
# 7. Load the addon modules (PRK import path only)
# ---------------------------------------------------------------------------
print("▸ Loading io_thps_scene addon (compat-shimmed for Blender 5.2+)…")

try:
    import io_thps_scene
    from io_thps_scene.constants import ADDON_NAME
    from io_thps_scene.helpers import Reader, Printer
    from io_thps_scene.import_park import import_prk
    print("  ✓ Core import functions available")
except Exception:
    print("  ✗ Failed to load addon modules")
    traceback.print_exc()
    sys.exit(1)

# ---------------------------------------------------------------------------
# 8. Run the .prk import
# ---------------------------------------------------------------------------
print(f"\n▸ Importing: {INPUT_FILE}")

bpy.ops.wm.read_factory_settings(use_empty=True)

class _DummyOperator:
    import_floors = True
    import_pieces = True
    import_rails = True

try:
    import_prk(
        os.path.basename(INPUT_FILE),
        os.path.dirname(INPUT_FILE),
        bpy.context,
        _DummyOperator(),
    )
    print(f"  ✓ PRK imported — {len(bpy.data.objects)} objects in scene")
except Exception:
    print("  ✗ PRK import failed")
    traceback.print_exc()
    sys.exit(1)

# ---------------------------------------------------------------------------
# 9. Post-process: tag objects for the web pipeline
# ---------------------------------------------------------------------------
print("\n▸ Post-processing scene for web…")

for obj in bpy.data.objects:
    if obj.type == 'MESH':
        name_lower = obj.name.lower()
        if 'rail' in name_lower or 'grind' in name_lower:
            obj['isGrindable'] = True
            obj['collisionType'] = 'rail'
        elif 'ramp' in name_lower or 'kicker' in name_lower:
            obj['collisionType'] = 'ramp'
        elif 'gap' in name_lower:
            obj['collisionType'] = 'gap'
        else:
            obj['collisionType'] = 'static'

# ---------------------------------------------------------------------------
# 10. Export as GLB
# ---------------------------------------------------------------------------
if not OUTPUT_FILE:
    OUTPUT_FILE = os.path.splitext(INPUT_FILE)[0] + ".glb"

os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
print(f"\n▸ Exporting GLB: {OUTPUT_FILE}")

# glTF exporter parameter names vary across Blender versions — probe several sets.
_EXPORT_KWARGS_CANDIDATES = [
    dict(
        filepath=OUTPUT_FILE,
        export_format='GLB',
        export_materials='EXPORT',
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_extras=True,
        export_tangents=True,
        export_colors=True,
    ),
    dict(
        filepath=OUTPUT_FILE,
        export_format='GLB',
        export_materials='EXPORT',
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_extras=True,
    ),
    dict(
        filepath=OUTPUT_FILE,
        export_format='GLB',
    ),
]

exported = False
for kwargs in _EXPORT_KWARGS_CANDIDATES:
    try:
        bpy.ops.export_scene.gltf(**kwargs)
        exported = True
        break
    except TypeError as e:
        print(f"  · retrying export (param-set mismatch): {e}")
    except Exception as e:
        print(f"  ✗ GLB export failed: {e}")
        traceback.print_exc()
        sys.exit(1)

if not exported:
    print("  ✗ Could not export GLB (all parameter sets failed)")
    sys.exit(1)

size_kb = os.path.getsize(OUTPUT_FILE) / 1024
print(f"  ✓ Exported: {OUTPUT_FILE} ({size_kb:.1f} KB)")

print("\n✅ Conversion complete!")
