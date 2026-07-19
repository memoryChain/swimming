# Cocos Prefab And Verification

## Import

1. Refresh the parent folder after adding or overwriting an image.
2. Reimport the image when the asset database is stale.
3. Confirm `cc.Texture2D` and `cc.SpriteFrame` children exist.
4. Confirm SpriteFrame `rawWidth` and `rawHeight` match the runtime file.
5. Reopen and save the prefab after changing a referenced asset.

With Cocos Code Mode, inspect references before setters. Typical operations are `assetGetAtPath`, `assetOperate(refresh/reimport/open)`, `assetGetTree`, `nodeGetAtPath`, `inspectorGetInstanceProperties`, `inspectorSetInstanceProperties`, and `editorOperate(save_scene_or_prefab/play_preview/stop)`.

## Prefab Layout

- Match the base design resolution explicitly. A 720x1280 background node should not retain an old 960x1706 size or positional offset.
- Keep full-screen backgrounds centered unless the manifest defines another focal point.
- Use Widgets/anchors for safe-area UI and stable dimensions for buttons, rows, progress tracks, and icon slots.
- Use nine-slice for scalable framed controls when the art supports it.
- Keep touch areas invisible and independent from decorative sprites when necessary.

## Runtime Binding

Search for code that changes `fontFamily`, `fontSize`, `lineHeight`, `color`, outlines, shadows, SpriteFrame, Sprite color, content size, scale, or active state. Runtime state changes must preserve prefab typography and layout.

## Preview Matrix

- 720x1280: exact 9:16 baseline; verify intended full artwork and zero legacy offset.
- 720x1440: 18:9.
- 720x1560: 19.5:9.
- 720x1600: 20:9.

For each size, capture the login/default state and any modal/result state. Verify no accidental crop, overlap, unreadable text, debug overlay, blank sprite, or console error. Distinguish preview-page letterboxing outside the game canvas from content inside the canvas.
