# Design Decomposition And Imagegen

## Decomposition

Create the manifest before generating anything. Classify each visible element:

| Element | Runtime form | Text policy |
| --- | --- | --- |
| Full-screen illustration | JPG background | No UI text |
| Decorative title/logo | Transparent PNG | Fixed text may be baked |
| Button/panel/row | Blank transparent PNG | Cocos Label |
| Icon/avatar/badge | Transparent PNG | No text |
| Timer/score/rank/progress | Cocos components | Cocos Label |

Split an element when it needs independent state, tint, animation, layout, localization, or reuse. Keep it whole when it is a fixed decorative composition that always moves and scales together.

## Generation Rules

- Issue one imagegen call per asset id.
- Preserve the design's outline weight, lighting direction, material, palette, and camera angle.
- For transparent sprites, request one centered object on flat `#00ff00` or another non-conflicting key color.
- Request no text, number, icon, logo, watermark, neighboring element, cast shadow on the key, or cropped outline unless the manifest explicitly marks a fixed decorative logo.
- Use at least 8-16 px of final transparent padding. More is acceptable during generation.
- Do not use a multi-element source sheet as a runtime asset. A contact sheet is validation output only.

## Edit Preservation

When the user asks to remove or repair a small region, do not accept a whole-image regeneration as a faithful edit. Keep the original as the base, generate only replacement content, composite only the permitted region, and compare outside-region pixels or composition before shipping.

## Quality Gate

Reject and regenerate an asset when it has a neighboring fragment, clipped outline, key-color fringe, unintended text, inconsistent perspective, wrong state, or insufficient padding. Do not attempt to hide these defects in the prefab.
