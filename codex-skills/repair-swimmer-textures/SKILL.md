---
name: repair-swimmer-textures
description: Inspect and repair textured rigged swimmer or humanoid GLB/GLTF models by removing unwanted baked armpit shadows, generating UV masks for runtime swimsuit and swim-cap recoloring, and integrating a shared-mask shader into Cocos Creator. Use when imported character models contain painted armpit darkness, need multiple outfit colors without duplicate full textures, or must preserve an original detailed skin while recoloring AI competitors efficiently for mobile or WeChat Mini Games.
---

# Repair Swimmer Textures

Preserve the source model, repair only verified UV regions, and produce a shared recolor mask suitable for mobile rendering.

## Required Workflow

1. Copy the source model to a working location. Never overwrite the only GLB/GLTF or texture.
2. Inspect the model before editing:
   - Confirm forward/up axes, origin, scale, armature, skinned mesh, material count, texture size, UV map, and relevant bone names.
   - Run the bundled audit command and read its full output.
3. Identify the defect:
   - Confirm the dark armpit area is baked into base color, not lighting, normals, ambient occlusion, or a shader.
   - Inspect both the model and base-color texture. Do not paint over legitimate anatomical shading blindly.
4. Repair the shadow with a constrained UV mask:
   - Select faces using normalized body position plus arm/clavicle bone weights.
   - Expand from the verified underarm seed along mesh topology into upper-torso faces; lower the correction threshold with distance.
   - Estimate replacement skin color from nearby verified skin faces.
   - Correct only pixels below the local luminance threshold.
   - Export a new texture and compare it with the source.
5. Generate the recolor mask:
   - Store swimsuit/trunks coverage in red.
   - Store swim-cap coverage in green.
   - Keep skin, face, goggles, hair, and background black.
   - Inspect mask edges and UV overlaps before integrating it.
6. Re-export or relink the repaired base texture without changing mesh, skeleton, bone names, origin, or animation compatibility.
7. Integrate the shared base texture, shared mask, and per-character colors. Read [references/cocos-runtime-recolor.md](references/cocos-runtime-recolor.md) for Cocos details.
8. Validate the original appearance, several recolors, animation poses, and mobile resource cost.

## Blender Commands

Run scripts through Blender, not regular Python:

```powershell
blender --background --python scripts/swimmer_texture_tools.py -- audit --input model.glb
```

Repair a baked shadow after confirming the audit defaults select the correct region:

```powershell
blender --background --python scripts/swimmer_texture_tools.py -- repair-shadow `
  --input model.glb --output-texture repaired-basecolor.png
```

Generate the runtime mask:

```powershell
blender --background --python scripts/swimmer_texture_tools.py -- make-mask `
  --input model.glb --output-mask swimmer-color-mask.png --supersample 4
```

Use `--help` for axis, normalized range, and bone-group overrides. Rerun `audit` with the same overrides before writing outputs.

If the verified source garments are black with cyan accents, add `--refine-mode dark-cyan` to intersect the UV selection with the real painted garment boundary. Keep `geometry` for other palettes until their color classifier is defined.

## Selection Rules

- Treat bundled thresholds as starting points for a normalized, upright humanoid, not universal truth.
- Prefer bone weights plus normalized spatial bounds over texture-color selection alone.
- Require non-empty target and reference regions. Stop if either is implausibly small or large.
- If garment and skin share overlapping UV pixels, do not use a texture mask until the UVs or material layout are repaired.
- Preserve shading variation by blending toward a nearby median skin color rather than filling a flat sampled color.
- Repair shadow spill with topology rings, not a larger rectangular UV crop. Keep distant rings conservative so normal muscle shading survives.
- Generate masks with at least 4x supersampling and downsample to fractional edge coverage. Do not ship a binary triangle raster with staircase edges.
- Compare the mask against the source base color. Use source-color refinement only when the garment palette is known and separable from skin.
- Keep the original appearance as a selectable variant; dynamic recoloring should affect only masked pixels.

## Runtime Design

- Share one detailed base texture and one mask across all instances.
- Give each skinned renderer a small material instance containing only swimsuit and cap colors.
- Do not generate 512x512 RGBA textures per character at runtime.
- Do not split one skinned mesh into skin, cap, and trunks solely for recoloring; that normally increases draw calls.
- Use an unlit or deliberately simple effect for lightweight games unless the existing art direction requires PBR.
- Copy [assets/SwimmerDynamicColor.effect](assets/SwimmerDynamicColor.effect) as a starting template and adapt property names to the project.

## Validation Gates

- Original skin detail, face, hands, torso, and legs remain unchanged outside the repair area.
- Both armpits match nearby skin without flat patches or UV seams.
- Red mask covers only swimsuit/trunks; green covers only cap.
- Original outfit remains available and visually matches the source artwork.
- At least five high-contrast color pairs render without color bleeding.
- Standing, streamline, recovery, and overhead arm poses show no newly exposed defects.
- Mesh count, skeleton, bone names, triangle count, and draw calls do not increase unexpectedly.
- Cocos imports the texture and effect successfully; run the project type check and a real device preview.

## Failure Modes

- If the dark region changes with lighting, fix lighting, normals, AO, or material settings instead of the texture.
- If the script selects the chest, back, or face, correct axes, normalized ranges, or bone aliases before continuing.
- If mask colors bleed into skin, inspect bilinear filtering, padding, UV islands, and overlapping UVs.
- If repeated color switching brightens skin, avoid recursively deriving a new material from the previous tinted material; retain the original base texture and neutral base color.
