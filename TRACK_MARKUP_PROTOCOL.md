# GamerWheels — Track Markup Protocol

A dead-simple visual convention for marking up overhead satellite or layout images so they can be rapidly interpreted and converted into rideable Three.js track data.

Use **Figma**, **Photoshop**, **Illustrator**, or any SVG/canvas tool. Draw these layers **on top of** the satellite image.

---

## Layer 1 — Track Centerline & Direction

| Element | How to Draw | Color / Style |
|---------|------------|---------------|
| **Centerline** | Single polyline/path following the exact center of the rideable surface | **Cyan `#00FFFF`**, 3–5px solid stroke |
| **Direction Arrows** | Small filled chevron triangles every ~50px along the centerline | **Cyan `#00FFFF`**, pointing in travel direction |
| **Start/Finish** | Checkered rectangle across the centerline | **Black `#000000` & White `#FFFFFF`** checkerboard pattern |

> **Rule**: The draw order of the centerline polyline IS the direction of travel. First point = start, last point = before the loop closes back to start.

---

## Layer 2 — Elevation Markers

| Element | How to Draw | Color | Meaning |
|---------|------------|-------|---------|
| **Peak / Crest** | Filled circle dot on centerline | **Green `#00FF00`** | Highest local point. Label with height: `+8m` |
| **Valley / Low** | Filled circle dot on centerline | **Red `#FF0000`** | Lowest local point. Label with height: `-2m` or `0m` |
| **Grade Arrow** | Thick dashed arrow between two elevation markers | **Yellow `#FFFF00`** | Points in the uphill direction. Label with `15%` grade if known |

> **Rule**: I interpolate elevation smoothly between markers using the spline. You only need to mark the **peaks** and **valleys** — I fill in everything between.

---

## Layer 3 — Discrete Track Features

| Feature | Shape to Draw | Color / Fill | Label Format |
|---------|--------------|-------------|--------------|
| **Tabletop Jump** | Rectangle overlaid on centerline | **Orange `#FF8800`**, 50% opacity | `TT 1.5m` (height) |
| **Kicker / Launch Ramp** | Upward-pointing triangle on centerline | **Magenta `#FF00FF`**, filled | `K 2.0m` (lip height) |
| **Roller / Whoops** | Zigzag/wavy line segment across centerline | **White `#FFFFFF`**, zigzag stroke | `R 5×0.4m` (count × height) |
| **Drop** | Rectangle with downward arrow inside | **Red `#FF0000`**, 50% opacity | `D 3.0m` (drop height) |
| **Banked Berm** | Arc/crescent on the outside of a turn | **Blue `#0088FF`**, 50% opacity | `B 25°` (bank angle) or `B 2.0m` (wall height) |
| **Gap Jump** | Dashed rectangle spanning a gap | **Purple `#AA00FF`**, dashed outline | `G 8.0m` (gap length) |

---

## Layer 4 — Track Width Overrides (Optional)

If sections of the track are wider or narrower than the default:

| Element | How to Draw | Color |
|---------|------------|-------|
| **Width Override** | Parallel lines flanking the centerline at the true track edges | **Gray `#888888`**, 1px dotted stroke |
| **Width Label** | Text label near the width lines | `W=8m` |

---

## Quick Reference Card

```
COLORS AT A GLANCE:
  Cyan    #00FFFF  = Centerline & direction
  Green   #00FF00  = Elevation peak
  Red     #FF0000  = Elevation valley / Drop feature
  Yellow  #FFFF00  = Grade direction arrow
  Orange  #FF8800  = Tabletop jump
  Magenta #FF00FF  = Kicker ramp
  White   #FFFFFF  = Roller/whoops
  Blue    #0088FF  = Banked berm
  Purple  #AA00FF  = Gap jump
  Gray    #888888  = Width override
  B&W     checker  = Start/Finish line
```

---

## Example Workflow

1. Open satellite image in Figma
2. Create a new layer called **"Track Markup"**
3. Draw the **cyan centerline** polyline following the race path
4. Add **green/red dots** at every major elevation change
5. Draw **feature shapes** (orange tabletops, magenta kickers, etc.) where features exist
6. Export the marked image as PNG
7. Send to Antigravity — I read the markup and generate `trackData_*.js`

---

## Tips

- **Be approximate** — I only need the general layout. Exact pixel coordinates aren't critical; I normalize and scale.
- **Label everything** — Heights, lengths, angles. The more numbers you write on the image, the more accurate the first pass.
- **One feature per marker** — Don't stack multiple features at the same point.
- **Use clear contrast** — The bright neon colors are chosen to stand out against both satellite green/brown and dark asphalt.
