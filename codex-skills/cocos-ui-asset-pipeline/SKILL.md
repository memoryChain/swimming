---
name: cocos-ui-asset-pipeline
description: Convert game UI references or concept art into production-ready bitmap UI for Cocos Creator, especially WeChat Mini Games. Use when Codex must decompose a UI design, generate isolated elements with imagegen, remove chroma backgrounds, crop and optimize PNG/JPG assets, enforce mobile texture budgets, create contact sheets, import SpriteFrames, assemble prefabs, replace code-drawn UI, audit resources, or verify Cocos UI across portrait aspect ratios.
---

# Cocos UI Asset Pipeline

Build runtime UI as assets and prefabs, not as a screenshot cut into fragments or as runtime drawing code.

## Non-Negotiable Rules

- Analyze the reference first and create `temp/ui-pipeline/<job>/ui-assets.json` from `assets/ui-assets.template.json`.
- Generate every complex runtime element as one isolated imagegen request. Never ask imagegen for a crowded runtime sheet.
- Never algorithmically cut runtime sprites from a flattened concept screenshot. Regenerate isolated elements, then remove the background and crop them.
- Keep dynamic, localized, selectable, timed, or data-driven text as Cocos `Label`. Bake text only into a fixed decorative logo or title.
- Keep source images, prompts, raw generations, masks, and contact sheets under `temp/ui-pipeline/<job>`. Put only referenced final assets under `assets/resources`.
- Treat the prefab as the visual source of truth. Runtime code may bind state and data but must not redraw or restyle the prefab unexpectedly.
- Enforce the WeChat budgets in the manifest. Do not silently accept an oversized asset.

## Workflow

1. **Decompose the design**
   - Read `references/imagegen-decomposition.md`.
   - Inventory backgrounds, reusable panels, button skins, badges, icons, fixed logos, and dynamic labels.
   - Record dimensions, format, text policy, reuse policy, fit mode, and budget in the manifest.

2. **Generate isolated art**
   - Use the system `imagegen` skill.
   - Generate one element per call with generous padding and no neighboring elements.
   - Use a flat chroma key for transparent elements; generate opaque backgrounds without UI overlays.
   - Preserve reference geometry aggressively when editing existing art. Use generated patches plus deterministic compositing when only a small region may change.

3. **Prepare runtime files**
   - Remove chroma using the imagegen helper.
   - Crop with 8-16 transparent pixels after the visible outline.
   - Run `scripts/optimize-ui-asset.ps1` for deterministic resizing and JPG encoding.
   - Run `scripts/validate-ui-assets.ps1 -FailOnError` before importing.
   - Run `scripts/new-ui-contact-sheet.ps1` and visually inspect every edge, outline, neighbor fragment, and text decision.

4. **Import and assemble in Cocos**
   - Read `references/cocos-prefab-notes.md`.
   - Refresh or reimport assets and confirm both `cc.Texture2D` and `cc.SpriteFrame` exist.
   - Build or update the prefab hierarchy, anchors, widgets, nine-slice borders, labels, and touch areas.
   - Search runtime code for style overrides after changing prefab typography or sprite tint.

5. **Audit and verify**
   - Run `scripts/audit-cocos-ui-resources.ps1 -ProjectRoot <project> -FailOnError`.
   - Run the project's TypeScript check from `AGENTS.md`.
   - Preview at 720x1280, 720x1440, 720x1560, and 720x1600.
   - At 720x1280, full-screen art must match its intended fit without legacy size or position offsets. At taller ratios, verify the manifest fit mode and safe area.
   - Capture screenshots, inspect Cocos/browser error logs, and compare against the reference before reporting completion.

## Default Hard Budgets

- Transparent sprite: <= 128 KiB and maximum edge <= 1024 px.
- Icon/avatar: <= 32 KiB and maximum edge <= 256 px.
- Portrait background: 720x1280 JPG and <= 256 KiB.
- One UI feature set: <= 1.5 MiB total runtime image bytes.

Read `references/manifest-and-budgets.md` before changing a budget or granting an override.

## Completion Gate

- Manifest is complete and all output paths exist.
- Contact sheet contains one clean element per tile.
- Transparent sprites have alpha and zero opaque edge pixels unless explicitly allowed.
- No source sheet, raw generation, preview, or unused image remains under `assets/resources`.
- Cocos metadata exposes SpriteFrames and prefabs reference current UUIDs.
- Base 9:16 and tall-screen previews have no accidental crop, overlap, unreadable text, or visible debug UI.
- TypeScript and preview logs contain no new errors.
