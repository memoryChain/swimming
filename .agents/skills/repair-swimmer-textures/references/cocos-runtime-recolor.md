# Cocos Runtime Recolor

## Asset Layout

Keep runtime files under `assets/resources` when loading through `resources.load`:

```text
assets/resources/models/Swimmer.glb
assets/resources/models/SwimmerColorMask.png
assets/resources/effects/SwimmerDynamicColor.effect
```

Centralize resource paths. Do not scatter string literals through character code.

## Mask Contract

- `R`: swimsuit or trunks weight.
- `G`: swim-cap weight.
- `B`: unused and reserved.
- Background and untouched model areas: zero.
- Edge pixels: fractional coverage from supersampling, not binary stair steps.
- Import as a non-color data texture when the engine pipeline supports that distinction.
- Use linear filtering only after inspecting edge bleed. Disable mipmaps for small characters if mip bleeding becomes visible.

## Material Application

Load the effect and mask once through the resource bundle. Cocos caches the assets, but the game should still avoid duplicate application work.

For each character:

1. Find the original base-color texture from the imported material.
2. Create one material instance with the dynamic-color effect.
3. Bind `mainTexture`, `colorMask`, `suitColor`, and `capColor`.
4. Set a neutral white `mainColor`; do not boost the previously generated material repeatedly.
5. Preserve the original imported appearance by omitting the dynamic effect and using the original base texture.

Conceptual TypeScript:

```ts
const material = new Material();
material.initialize({ effectAsset: dynamicColorEffect });
material.setProperty('mainTexture', originalBaseTexture);
material.setProperty('colorMask', sharedMask);
material.setProperty('mainColor', Color.WHITE);
material.setProperty('suitColor', suitColor);
material.setProperty('capColor', capColor);
renderer.setMaterial(material, 0);
```

Keep an explicit `original` appearance variant with no recolor colors. AI palettes should exclude `original` when the player must retain the source outfit.

## Shader Logic

Sample the base and mask once each. Convert the base sample to the project's working color space, preserve its luminance as garment shading, then blend only the masked pixels:

```glsl
vec3 base = SRGBToLinear(texture(mainTexture, uv).rgb);
vec2 mask = clamp(texture(colorMask, uv).rg, 0.0, 1.0);
float garmentWeight = max(mask.r, mask.g);
vec3 target = mix(suitColor.rgb, capColor.rgb, mask.g);
vec3 result = mix(base, target * preservedBrightness(base), garmentWeight);
```

Use the bundled effect as a tested Cocos 3.8-style starting point. Reimport it and confirm the compiled shader retains skinning attributes.

## Mobile Checks

- One base texture and one mask are shared by all swimmers.
- One extra mask sample per visible character fragment is expected.
- Material instances do not add draw calls when each skinned character was already a separate draw.
- Avoid full-resolution masks when 256x256 is visually sufficient, but verify UV boundaries first.
- Compare GPU texture memory, renderer time, draw calls, and package size before and after.
