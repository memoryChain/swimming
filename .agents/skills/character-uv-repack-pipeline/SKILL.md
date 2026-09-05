---
name: character-uv-repack-pipeline
description: Inspect and reorganize severely fragmented UVs on textured rigged characters, then rebake base textures and color masks while preserving appearance, skinning, animation compatibility, and mobile runtime budgets. Use for triangle-atlas UVs, excessive exported vertices, blurry rebakes, mask seams, or Cocos/GLB character texture cleanup; do not use for ordinary hand-painted texture edits that keep the existing UV layout.
---

# Character UV Repack Pipeline

Windows／macOS 共用此文件。项目路径、Blender 启动和同步方式见 [仓库技能说明](../../README.md)。本技能的 `scripts/` 路径相对此技能目录；Python 审计工具须在 Blender 内执行。

Rebuild a character's UV layout without treating “fewer islands” as the only success metric. Preserve the rendered identity, skeleton, weights, material count, recolor masks, and target-platform budget.

## Before editing

- Identify the exact model and confirm it is not being modified by another task.
- Prefer Blender MCP for initial scene inspection when available. If the active Blender file belongs to other work, do not switch or save it; use a separate background Blender process.
- Preserve the authoring source. Create a clearly named working `.blend` beside source-only tooling, never inside runtime asset folders.
- Capture a baseline: front/side/back renders, mesh/material/joint counts, bounds, UV island count, geometry component count, texture sizes, exported vertex count, and total model-plus-mask bytes.
- Run `scripts/audit_character_uv.py` in Blender before and after the operation.

Read [references/workflow.md](references/workflow.md) before performing a repack. It contains the decision gates, acceptance criteria, and failure modes learned from real fragmented character assets.

For Cocos Creator, WeChat Mini Game, ASTC, or runtime asset replacement, also read [references/cocos-mobile.md](references/cocos-mobile.md).

## Non-negotiable invariants

- Do not weld coincident vertices until bone weights and normals have been compared. A position match alone is insufficient.
- Keep a source UV layer and a target UV layer until every texture has been rebaked and validated.
- Rebake every UV-dependent image together: base color, RGB recolor masks, normal maps, ORM maps, decals, and any other authored channels.
- Reject layouts with degenerate faces, unintended overlaps, or UVs outside the intended tile.
- Validate visual fidelity in multiple views and at least two strongly deformed poses. A clean atlas image is not proof that the model renders correctly.
- Preserve the original number of meshes, materials, triangles, armature joints, vertex groups, and animation-facing node names unless the user explicitly authorizes a structural change.
- Treat a project-wide texture-size standard as a hard invariant. Never increase one model's resolution to compensate for a weak UV layout unless the user explicitly changes that project policy.
- Do not replace runtime assets until the candidate passes visual, rig, mask, and size checks.

## Outcome

Deliver:

- a reversible working `.blend` with source and repacked UV layers;
- a finalized `.blend` with normalized runtime names;
- rebaked texture set and optional masks;
- an exported GLB/GLTF candidate;
- baseline and candidate audit reports;
- original-color and high-contrast recolor renders in neutral and deformed poses;
- a concise comparison of UV islands, exported vertices, visual differences, and combined runtime bytes.

If fidelity and island reduction conflict, keep the visually faithful candidate and report the remaining fragmentation. Do not silently accept blurred logos, seams, face details, accessories, or color-mask bleed.
