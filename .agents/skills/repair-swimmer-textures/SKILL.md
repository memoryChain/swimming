---
name: repair-swimmer-textures
description: 修复带骨骼泳者或人形 GLB/GLTF 的贴图脏色、颜色毛边、头发与袜子杂色、跨 UV 三角错色，保留原有服装图案和设计；处理已确认的烘焙阴影，并按需实现 Cocos 移动端 UV 遮罩或白色键换色。适用于源模型导入前精修、服装或泳帽换色、遮罩接缝与皮肤串色；普通局部贴图修复默认保持现有 UV。
---

# Repair Swimmer Textures

Windows／macOS 共用此文件。项目路径、Blender 启动和同步方式见 [仓库技能说明](../../README.md)。以下命令从项目根目录运行，macOS 将 `python` 改为 `python3`。

保留源模型与已确认设计，只修复核实的问题区域。源贴图精修、阴影修复、运行时换色与游戏资源替换分别确定范围，不默认连带执行。

处理颜色毛边、服装／灰白头发／袜子杂色、跨 UV 错色或建立精修验收标准时，先完整阅读 [保留设计的精修流程](references/detail-preserving-cleanup.md) 及其链接的项目规范。原则是重画清晰边界，不靠删设计或整体模糊掩盖问题。

Read [references/white-key-recolor.md](references/white-key-recolor.md) when the source garment is white, when generated masks expose triangle folds or jagged edges, or when deciding whether to revise UVs instead of generating a mask.

## Required Workflow

1. Copy the source model to a working location. Never overwrite the only GLB/GLTF or texture.
2. Inspect the model before editing:
   - Confirm forward/up axes, origin, scale, armature, skinned mesh, material count, texture size, UV map, and relevant bone names.
   - Run the bundled audit command and read its full output.
3. 区分底色污染、UV／采样接缝、灯光／法线／AO 与真实低模结构，检查模型和底色贴图。局部精修按上述精修流程执行；仅在确认腋下暗部烘焙于底色时执行下一步。
4. 仅对已确认的烘焙阴影，使用受限 UV 遮罩修复：
   - Select faces using normalized body position plus arm/clavicle bone weights.
   - Expand from the verified underarm seed along mesh topology into upper-torso faces; lower the correction threshold with distance.
   - Estimate replacement skin color from nearby verified skin faces.
   - Correct only pixels below the local luminance threshold.
   - Export a new texture and compare it with the source.
5. 仅在请求换色时选择换色区域方案：
   - Prefer a clean-white key when the target garment is deliberately neutral white and all near-white non-target regions are acceptable members of the same color channel.
   - Otherwise generate a UV mask: swimsuit/trunks in red, cap in green, and untouched regions black.
   - 若碎片化或重叠 UV 无法兼顾内部覆盖与外部清晰边界，先说明并确认 UV／材质调整范围，再转入对应技能流程；不要自动重排，也不要用模糊掩盖问题。
6. Re-export or relink the repaired base texture without changing mesh, skeleton, bone names, origin, or animation compatibility.
7. 仅在任务包含游戏集成时接入共享底图、按需共享遮罩与角色颜色；详见 [Cocos 换色接入](references/cocos-runtime-recolor.md)。确认目标角色／路径与覆盖范围，源精修不自动替换运行资源。
8. 验证原设计、修复区域和结构兼容性；涉及换色、动作或运行交付时，分别验证对应效果与移动端资源成本。未执行的环节标记未验证。

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

所有任务先通过源设计保真、局部色界、结构审计与重新导入检查。下列腋下、遮罩、换色、动作、Cocos 与实机条目按任务范围执行，不把不适用或尚未执行的检查记为通过。

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
