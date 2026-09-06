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
- `B`：本项目现行运行时的露肤区域覆盖率，并非保留不用。
- Background and untouched model areas: zero.
- Edge pixels: fractional coverage from supersampling, not binary stair steps.
- Import as a non-color data texture when the engine pipeline supports that distinction.
- Use linear filtering only after inspecting edge bleed. Disable mipmaps for small characters if mip bleeding becomes visible.

## 本项目的默认换肤交付

新增／替换人形角色到游戏默认包含肤色切换。依据现行 `assets/race/effects/SwimmerDynamicColor.effect`、`PlayerCharacterConfig.ts` 与角色原UV核对通道，不能以旧模板的“B保留”说明或旧角色 `supportsSkinTone: false` 为不实现换肤的理由。

- 一起完成并验证 `supportsSkinTone`、B通道皮肤覆盖以及 `skinColor` 的实际传递；遮罩模式实际混合权重是 `mask.b * skinColor.a`。只开放界面、B全零或有效肤色透明度为零，都不能算换肤生效。
- 依据模型空间、拓扑、权重与原色确定真实露肤区域；原／暖肤色和深肤色分别检查脸耳颈、手臂手部等区域，并交叉检查服装换色，保护头发、眼镜、装备和图案。保持原肤色可选与正常明暗，不用平涂或全身染色替代。
- 检查选角预览与比赛使用一致肤色，切换不重建模型／重启动作，确认并重新进入后保留选择。不能以离线效果代替未做的运行验证。
- 机甲等确无皮肤区域，或UV／材质无法安全分离时，先说明并确认例外／调整范围，不自行关闭功能或改变结构。仅源精修不自动安装；仅要求记录规则也不等于要求补改现有全部角色。

## Material Application

Load the effect and mask once through the resource bundle. Cocos caches the assets, but the game should still avoid duplicate application work.

For each character:

1. Find the original base-color texture from the imported material.
2. Create one material instance with the dynamic-color effect.
3. 绑定 `mainTexture`、`colorMask`、`suitColor`、`capColor`，支持换肤时同时绑定 `skinColor`。
4. Set a neutral white `mainColor`; do not boost the previously generated material repeatedly.
5. 所有外观通道均为原色时保留原始导入外观；若仅服装保持原色而肤色切换，仍须使用动态effect，关闭服装覆盖、启用肤色覆盖。

Conceptual TypeScript:

```ts
const material = new Material();
material.initialize({ effectAsset: dynamicColorEffect });
material.setProperty('mainTexture', originalBaseTexture);
material.setProperty('colorMask', sharedMask);
material.setProperty('mainColor', Color.WHITE);
material.setProperty('suitColor', suitColor);
material.setProperty('capColor', capColor);
material.setProperty('skinColor', skinColor);
renderer.setMaterial(material, 0);
```

Keep an explicit `original` appearance variant with no recolor colors. AI palettes should exclude `original` when the player must retain the source outfit.

## Shader Logic

Sample the base and mask once each. Convert the base sample to the project's working color space, preserve its luminance as garment shading, then blend only the masked pixels:

以下只是服装混合示意，不是完整运行效果；项目现行换肤应复用实际effect的B通道与肤色亮度处理，不能用此简化片段覆盖运行shader。

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
