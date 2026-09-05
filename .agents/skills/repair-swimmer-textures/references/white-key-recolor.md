# Clean-White Outfit Recoloring

Use clean-white keying when a swimmer's recolorable cap, swimsuit, or trunks are intentionally authored as neutral white. This route can avoid the internal triangle lines and outer-edge artifacts of a generated UV mask while preserving one mesh, one material instance, and one draw call.

## Why a Generated Mask Can Fail

A geometry-derived texture mask rasterizes selected mesh faces into UV space. On fragmented, tightly packed, or overlapping UVs, two undesirable results can alternate:

- a tight face mask exposes triangle or fold boundaries inside the garment;
- dilation, blur, or a looser classifier hides internal boundaries but creates jagged edges, skin bleed, or halos along the garment boundary.

This is not always a threshold bug. If garment membership is not represented by a clean texture-color region, UV island, material slot, or vertex attribute, the selector lacks reliable boundary information.

Use this decision order:

1. Clean neutral-white source garment with separable non-target colors: use a white key.
2. Clean UV islands and non-overlapping target regions: use a supersampled UV mask.
3. Stable material or vertex-color separation already present: use that authored selector if it does not increase draw calls.
4. Fragmented or overlapping UVs with ambiguous source colors: repair UVs or source materials before runtime integration.

Do not keep expanding and blurring a fundamentally ambiguous mask.

## Source Audit

Before enabling white-key mode:

1. Extract the embedded base-color texture and inspect it in sRGB space.
2. Count and visualize pixels by minimum RGB channel, maximum channel range, saturation, and luminance.
3. Inspect UV islands, overlaps, padding, and texel density.
4. Render front, back, side, and animated poses with a diagnostic key overlay.
5. List all near-white surfaces:
   - cap;
   - trunks or swimsuit;
   - goggles and straps;
   - eyes and teeth;
   - logos;
   - skin highlights;
   - any white background texels sampled by UV padding.
6. Decide which near-white regions may share the same runtime color.

The MuscleMan2 source intentionally made the cap and trunks white. Its goggles were also white, so the accepted behavior recolored cap, trunks, and goggles together. The texture audit found 44 geometry components or UV islands, no tiny islands below 64 square pixels, and clean high-luminance white pixels. This made white-key selection more reliable than a regenerated garment mask.

If the product requires cap and trunks to use different colors, one white key is insufficient. Author separate selectors in the source, such as two mask channels, distinct stable source colors, vertex colors, or a deliberately revised material/UV layout.

## Shader Coverage

Derive the key from the original sRGB texture sample before converting it for lighting. A useful starting classifier is:

```glsl
vec3 source = texture(mainTexture, uv).rgb;
float whiteMin = min(source.r, min(source.g, source.b));
float whiteMax = max(source.r, max(source.g, source.b));
float neutralRange = whiteMax - whiteMin;
float brightWeight = smoothstep(0.70, 0.91, whiteMin);
float neutralWeight = 1.0 - smoothstep(0.08, 0.24, neutralRange);
float whiteKey = clamp(brightWeight * neutralWeight, 0.0, 1.0);
```

Treat these thresholds as project-specific starting values. Tune them against diagnostic renders, not one still image.

Preserve garment shading by applying the target hue while retaining a controlled luminance from the white source. Do not replace every keyed pixel with a flat color. Keep alpha and any required original texture channels intact.

If skin recoloring uses the inverse white key, first prove that every non-white painted region is skin. Hair, dark goggles, eyebrows, logos, and accessories would otherwise be tinted as skin. Prefer an explicit skin selector when the texture contains mixed non-white materials.

## Runtime Contract

- Keep one original base texture.
- Keep an explicit original appearance; alpha zero or an explicit mode may bypass recoloring.
- Use one effect and one material instance per skinned renderer.
- Do not generate a new 512x512 RGBA texture per character.
- Do not split the skinned mesh only to recolor garments.
- Disable or omit the UV mask texture sample in white-key mode.
- Remove unused mask files, resource-path entries, and configuration references only after confirming no other character shares them.
- Keep recolor uniforms small and stable so palette changes do not allocate textures at runtime.

For the MuscleMan2 replacement, white-key mode intentionally used one suit color for the cap, trunks, and white goggles. The separate cap channel was disabled. This removed the extra mask lookup and avoided UV-mask seams.

## Validation

Test at least:

- original appearance;
- black or very dark garment color;
- saturated red, green, and blue;
- a bright color near skin luminance;
- front, back, side, overhead-arm, crouched, and swimming poses;
- minified character rendering in the preparation screen and debug-model scene.

Inspect:

- garment outer edges and UV seams;
- triangle or fold lines inside flat-colored cloth;
- white skin highlights accidentally recolored;
- eyes, teeth, goggles, straps, and logos;
- texture filtering and mip behavior at small screen sizes;
- repeated palette switching;
- package size, texture count, draw calls, and material count.

Do not approve the recolor merely because the source GLB was replaced. Confirm that Cocos Asset Database reimported the embedded image and material. A stale imported GLB can display the old outfit even when runtime shader code and logs are current.

## Failure Routing

- **Internal triangle lines remain:** verify that runtime is truly using white-key mode rather than the old mask; inspect source white continuity and normal/shading contribution.
- **Skin or teeth recolor:** tighten neutral/brightness thresholds or author an explicit selector. Do not erase legitimate highlights from the source texture.
- **Garment edges shimmer:** inspect source texture padding, mipmaps, UV borders, and alpha handling.
- **Cap and trunks need independent colors:** author two selectors; one neutral-white class cannot infer semantic regions.
- **Only browser refresh was performed:** reimport the GLB and embedded texture in Cocos Creator, then verify imported subasset metadata.
- **White source still has colored shadows:** make the authored garment genuinely neutral or use an explicit mask/material selector.
