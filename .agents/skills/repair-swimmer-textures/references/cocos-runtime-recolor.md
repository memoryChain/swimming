# Cocos Runtime Recolor

## Asset Layout

本项目角色运行资源使用 `assets/race` 分包，按现有 `ResourcePaths.ts` 与加载器定位，不因下面的通用示例迁回主包。仅在确实通过 `resources.load` 加载的项目中使用这种布局：

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
- 用实际运行过滤方式检查边界。压缩与mip遵循项目策略；本项目压缩GLB内嵌图的ASTC产物没有mip链，不得恢复mip采样。保留目标遮罩已有设置，由策略脚本检查，不凭离线效果手改压缩元数据。

## 本项目的默认换肤交付

新增／替换人形角色到游戏默认包含肤色切换。依据现行 `assets/race/effects/SwimmerDynamicColor.effect`、`PlayerCharacterConfig.ts` 与角色原UV核对通道，不能以旧模板的“B保留”说明或旧角色 `supportsSkinTone: false` 为不实现换肤的理由。

- 一起完成并验证 `supportsSkinTone`、B通道皮肤覆盖以及 `skinColor` 的实际传递；遮罩模式实际混合权重是 `mask.b * skinColor.a`。只开放界面、B全零或有效肤色透明度为零，都不能算换肤生效。
- 依据模型空间、拓扑、权重与原色确定真实露肤区域；原／暖肤色和深肤色分别检查脸耳颈、手臂手部等区域，并交叉检查服装换色，保护头发、眼镜、装备和图案。保持原肤色可选与正常明暗，不用平涂或全身染色替代。
- 检查选角预览与比赛使用一致肤色，切换不重建模型／重启动作，确认并重新进入后保留选择。不能以离线效果代替未做的运行验证。
- 机甲等确无皮肤区域，或UV／材质无法安全分离时，先说明并确认例外／调整范围，不自行关闭功能或改变结构。仅源精修不自动安装；仅要求记录规则也不等于要求补改现有全部角色。

## 已接入角色补换肤

适用于模型已确认、只缺肤色功能的任务，不重新执行一次完整角色替换。

1. 核对稳定角色ID、显示名、运行GLB／遮罩路径及UUID，备份并记录当前哈希。先查能力开关、遮罩B、材质参数、预览／比赛和存档链路，判断缺的是资源、开关还是运行逻辑；已有链路可用时不另写一套。
2. 以实际运行GLB副本为几何依据重新审计轴向与UV；运行版可能已做朝向／骨轴规范化，不能套源模型旧坐标。源高分辨率贴图只作为判断参考，最终验收使用实际交付分辨率的底图和落盘遮罩。
3. 若确认只缺B和开关，仅补这两项。遮罩解码后逐像素核对R／G／A不变，GLB／底图哈希不变，保留UV、骨架、动作、缩放和UUID；其他角色与共享shader不顺带修改。PNG重新编码后的整体哈希会改变，不能用文件哈希代替通道比较。
4. 直接读取现行effect的计算：本项目B为线性覆盖率，使用 `mask.b * skinColor.a` 混合，不能照搬服装R的阈值编码。读取实际肤色配置与颜色空间；原／暖肤色若为 `preserveOriginal`，应关闭肤色覆盖，而不是用配置中的暖色RGB平涂原皮肤。原服装＋深肤色也必须正确启用动态材质。
5. 补与缺口相对应的回归：各服装色与肤色独立、恢复原肤色、草稿按草稿角色能力选肤色（即使当前已选角色不支持）、确认后的完整外观配置序列化／恢复。逻辑测试不能冒充预览／比赛显示验证。联机另查实际外观来源，不把本地选肤色自动当作已跨端同步；不为补遮罩擅自扩协议。

### 按真实部位判断皮肤，不只按颜色

- 偏灰耳内、接触暗部或低饱和皮肤仍可能是露肤。对肤色候选结合空间、骨权、拓扑和多点原色采样，再区分“已确认皮肤内部”与“待核实边界”。灰色／黑色保护过滤不能在已确认皮肤内部挖洞，也不能为填洞整体放开头发或装备保护。
- 深肤色能暴露暖肤色下不明显的漏涂。遇到耳后白斑、颈侧浅楔等，比较同机位原肤色／深肤色／B灰度图，必要时将屏幕位置射线定位到网格面及UV；确认是皮肤才补连续覆盖，是真发束就保护。仅补换肤时不顺便重绘底图。
- 先看正脸、头侧、后脑、耳、袖口与双手的少量近景，修掉已定位问题，再完成正背侧与高对比衣色交叉检查；检查普通显示尺寸与近景。不要每改一小块就重复无关的全部动作采样。
- `grayMaxB`／`blackMaxB` 这类按颜色分组的极值不等于“头发／衣服被染色”，也不能忽略：保留异常样点的面、UV、底色与B值，核对真实部位。皮肤覆盖均值高或遮罩非空不能证明耳内无孔洞、边界无漏涂；分部位统计须结合回贴目检。
- 区分原有底图杂线、采样细缝、退化UV与真正跨语义UV共享。候选分类不同不一定就是实际语义冲突；确认真实冲突且无法同时满足两部位时，停止自动交付并确认UV／材质调整范围。残留问题要记录，不能把一次近景容忍或很小的像素数量写成普遍豁免标准。

## 版本锁定与引擎导入验收

- 多人／多代理制作时，先冻结候选及哈希，再由一个集成者复核目标基线并覆盖；不要验收一版、安装仍在变化的另一版。候选、项目资源、Creator导入产物应能追溯到同一版本。
- 分开记录：①文件与修改范围，②实际交付贴图的离线回贴，③逻辑／存档及类型检查，④Creator实际导入与运行显示，⑤ASTC构建及iOS／Android真机。某层通过不替代其他层；此前模型导入通过不代表后来更新的遮罩已导入。
- 保留 `.meta`，通过UUID定位实际导入产物并检查当前贴图内容及绑定。原样复制的PNG可比SHA；发生格式转换时核对尺寸、解码内容或对应内嵌图。源文件已复制、旧 `.meta` 显示 `imported`、浏览器刷新或压缩策略通过，都不足以证明Creator已使用新遮罩；不要手改 `library` 来制造一致。
- 导入产物仍旧时只作有限核对。有已验证且获准的资源刷新入口才使用；否则及时请用户切回现有Creator触发刷新，明确“文件已安装、引擎导入待确认”，不要反复轮询冒充进展。遵守项目不自动启动／重启或截图Creator的约束；需要用户动作时停止在清楚的待办状态，不生成最终通过报告。
- Creator生成／更新元数据后执行项目 `textures:fix` 与 `textures:check`，再核对UUID、过滤、ASTC预设及回退格式。只有导入前的只读策略检查时，标明其范围；它不代表新图已导入或实机压缩画质通过。仅更新本技能不触发任何资源覆盖或编辑器操作。

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

技能内effect仅是基础R/G示意，不含本项目完整B换肤及运行光照逻辑。复用现行effect；只有确实修改shader时，才另验编译、蒙皮属性与相关运行效果。

## Mobile Checks

- One base texture and one mask are shared by all swimmers.
- One extra mask sample per visible character fragment is expected.
- Material instances do not add draw calls when each skinned character was already a separate draw.
- Avoid full-resolution masks when 256x256 is visually sufficient, but verify UV boundaries first.
- Compare GPU texture memory, renderer time, draw calls, and package size before and after.
