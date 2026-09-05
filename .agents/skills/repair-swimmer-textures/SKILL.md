---
name: repair-swimmer-textures
description: Inspect and repair textured rigged swimmer or humanoid GLB/GLTF models, remove unwanted baked shadows, and implement efficient runtime outfit recoloring in Cocos Creator using either a UV mask or a clean-white color key. Use when imported characters need swimsuit or swim-cap color variants, generated masks show triangle folds, seams, jagged edges, or skin bleed, UVs are fragmented, or the original detailed skin must remain intact on mobile or WeChat Mini Games.
---

# Repair Swimmer Textures

Windows／macOS 共用此文件。项目路径、Blender 启动和同步方式见 [仓库技能说明](../../README.md)。以下命令从项目根目录运行，macOS 将 `python` 改为 `python3`。

Preserve the source model, repair only verified UV regions, and choose the simplest recolor method that keeps garment boundaries clean on mobile.

Read [references/white-key-recolor.md](references/white-key-recolor.md) when the source garment is white, when generated masks expose triangle folds or jagged edges, or when deciding whether to revise UVs instead of generating a mask.

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
5. Choose the recolor selector:
   - Prefer a clean-white key when the target garment is deliberately neutral white and all near-white non-target regions are acceptable members of the same color channel.
   - Otherwise generate a UV mask: swimsuit/trunks in red, cap in green, and untouched regions black.
   - If fragmented or overlapping UVs prevent both clean internal coverage and clean external edges, repair the UV/material layout instead of hiding the problem with blur.
6. Re-export or relink the repaired base texture without changing mesh, skeleton, bone names, origin, or animation compatibility.
7. Integrate the shared base texture, shared mask, and per-character colors. Read [references/cocos-runtime-recolor.md](references/cocos-runtime-recolor.md) for Cocos details.
8. Validate the original appearance, several recolors, animation poses, and mobile resource cost.

## Blender Commands

Run scripts through Blender, not regular Python:

```powershell
python scripts/run-blender.py -- --python .agents/skills/repair-swimmer-textures/scripts/swimmer_texture_tools.py -- audit --input model.glb
```

Repair a baked shadow after confirming the audit defaults select the correct region:

```powershell
python scripts/run-blender.py -- --python .agents/skills/repair-swimmer-textures/scripts/swimmer_texture_tools.py -- repair-shadow --input model.glb --output-texture repaired-basecolor.png
```

Generate the runtime mask:

```powershell
python scripts/run-blender.py -- --python .agents/skills/repair-swimmer-textures/scripts/swimmer_texture_tools.py -- make-mask --input model.glb --output-mask swimmer-color-mask.png --supersample 4
```

Use `--help` for axis, normalized range, and bone-group overrides. Rerun `audit` with the same overrides before writing outputs.

If the verified source garments are black with cyan accents, add `--refine-mode dark-cyan` to intersect the UV selection with the real painted garment boundary. Keep `geometry` for other palettes until their color classifier is defined.

## Selection Rules

- Treat bundled thresholds as starting points for a normalized, upright humanoid, not universal truth.
- Prefer bone weights plus normalized spatial bounds over texture-color selection alone.
- Require non-empty target and reference regions. Stop if either is implausibly small or large.
- If garment and skin share overlapping UV pixels, do not use a texture mask until the UVs or material layout are repaired.
- Do not force a geometry-derived UV mask when its triangle boundaries become visible inside the garment. Tight selection can expose internal folds; expansion and blur can trade those folds for jagged or bleeding outer edges.
- Prefer white-key recoloring for an intentionally authored neutral-white garment when non-target whites have been audited. Record whether goggles, straps, logos, teeth, eyes, or skin highlights will also match the key.
- Preserve shading variation by blending toward a nearby median skin color rather than filling a flat sampled color.
- Repair shadow spill with topology rings, not a larger rectangular UV crop. Keep distant rings conservative so normal muscle shading survives.
- Generate masks with at least 4x supersampling and downsample to fractional edge coverage. Do not ship a binary triangle raster with staircase edges.
- Compare the mask against the source base color. Use source-color refinement only when the garment palette is known and separable from skin.
- Keep the original appearance as a selectable variant; dynamic recoloring should affect only masked pixels.

## Runtime Design

- Share one detailed base texture and, only when needed, one mask across all instances.
- Give each skinned renderer a small material instance containing only swimsuit and cap colors.
- Do not generate 512x512 RGBA textures per character at runtime.
- Do not split one skinned mesh into skin, cap, and trunks solely for recoloring; that normally increases draw calls.
- Use an unlit or deliberately simple effect for lightweight games unless the existing art direction requires PBR.
- Copy [assets/SwimmerDynamicColor.effect](assets/SwimmerDynamicColor.effect) as a starting template and adapt property names to the project.
- In white-key mode, derive coverage from the untinted sRGB base sample, preserve luminance as shading, and avoid the extra mask texture lookup.

## Validation Gates

- Original skin detail, face, hands, torso, and legs remain unchanged outside the repair area.
- Both armpits match nearby skin without flat patches or UV seams.
- Red mask covers only swimsuit/trunks; green covers only cap.
- White-key mode covers every intended white garment region and no unintended skin highlight, eye, tooth, logo, or accessory.
- Original outfit remains available and visually matches the source artwork.
- At least five high-contrast color pairs render without color bleeding.
- Standing, streamline, recovery, and overhead arm poses show no newly exposed defects.
- Mesh count, skeleton, bone names, triangle count, and draw calls do not increase unexpectedly.
- Cocos imports the texture and effect successfully; run the project type check and a real device preview.

## Failure Modes

- If the dark region changes with lighting, fix lighting, normals, AO, or material settings instead of the texture.
- If the script selects the chest, back, or face, correct axes, normalized ranges, or bone aliases before continuing.
- If mask colors bleed into skin, inspect bilinear filtering, padding, UV islands, and overlapping UVs.
- If a tight mask reveals internal triangle lines while a soft mask damages garment edges, stop tuning thresholds and choose clean-white source art or repaired UV/material boundaries.
- If repeated color switching brightens skin, avoid recursively deriving a new material from the previous tinted material; retain the original base texture and neutral base color.
