# 游泳馆场景修改、同步、合批与导出

本目录只保存游泳馆的 Blender 源文件、生产脚本和源纹理。运行时资产位于 `assets/race/pool/`。

## 当前权威文件

| 文件 | 用途 | 是否直接编辑 |
| --- | --- | --- |
| `SwimmingVenue_Rebuild_FlatColor_editable.blend` | 权威编辑源，保留可拆分对象和便于修改的结构 | 是 |
| `SwimmingVenue_Rebuild_FlatColor.blend` | 同步、几何合并、材质合批后的导出目标 | 仅做同步与合批，不直接创作 |
| `batch-flatcolor-venue.py` | 将 17 个看台批次压成单材质 atlas，并校验 primitive 数 | 生产脚本 |
| `export-flatcolor-venue-glb.py` | 校验运行时节点和合批状态，导出最终 GLB | 生产脚本 |
| `refine-ceiling-lighting.py` | 重制浅拱屋盖、支架和双槽线性灯，合为一个顶点色批次 | 生产脚本 |
| `refine-stand-structure.py` | 按墙体和楼板接触面生成看台柱梁，合为一个运行时批次 | 生产脚本 |
| `refine-pool-tiles.py` | 烘焙池内方砖贴图并同步池底、池壁 UV | 生产脚本 |
| `refine-lane-floats.py` | 生成八边连续绳体，以重复贴图表现密集盘片，全池不超过 4,000 面 | 生产脚本 |
| `build-venue-ad-atlas.py` | 使用项目字体轮廓生成广告 SVG 与 512×512 图集 | 美术源生成脚本 |
| `refine-venue-ad-boards.py` | 替换 T1/T3 挡板 UV 和原图片，定向同步广告批次 | 生产脚本 |
| `simplify-venue-first-pass.py` | 简化广告挡板和方块道具，原生 Join 定向重建两个批次 | 生产脚本 |
| `build-podium-atlas.py` | 生成名次数字、饰条与踏面共用的 256×256 图集 | 美术源生成脚本 |
| `refine-podium-and-flags.py` | 重制低面数领奖台、修改源旗片配色并定向同步 | 生产脚本 |
| `venue-textures/` | Blender 源纹理 | 按需编辑 |

最终运行时文件为 `assets/race/pool/LowPolyPool.glb`。必须保留其现有 `.meta`，否则 `PoolScene.prefab` 的子资源引用会失效。

## 修改前必须确认

1. 先阅读本文，确认当前 Blender 没有未保存改动。
2. 创作只在 `SwimmingVenue_Rebuild_FlatColor_editable.blend` 进行，绝不能从 editable 直接导出 GLB。
3. 大改前先提交当前工作或复制一份临时备份到仓库外；不要把 `.blend1`、`.blendbak` 或预览图提交到本目录。
4. 优先使用 Blender MCP 检查和修改场景。打开其他 `.blend` 前先确认当前文件已保存且 `bpy.data.is_dirty == false`。
5. 不修改运行时代码依赖的节点名。尤其必须保留：
   - `PoolWaterSurface`
   - `pool_floor`
   - `Venue_Rectangular_Ground`
   - `pool_edge_batch`
   - `pool_inner_wall_batch`
   - `lane_float_rope_batch`
   - `lane_floor_line_batch`
   - `PoolsideProps_Merged`
   - `start_block_anchor_root`
   - `start_block_anchor_near_01` 至 `start_block_anchor_near_08`
   - `start_block_top_near_marker`
6. 俯视相机会按名称隐藏天花板；新增顶部构件时，节点名必须包含 `ceiling`。
7. 普通看台必须保留 16 个独立节点 `BleacherBatch_T{1..4}_{N/S/E/W}`。观众生成依赖每个节点的包围盒和层号，不能把它们合成一个总 Mesh。
8. `CornerStands_Merged` 也必须保留。看台 atlas 脚本预期共 17 个看台批次。
9. 新增或修改场馆几何时控制面数、材质槽、透明层和贴图尺寸。微信小游戏优先减少 draw call 和透明 overdraw。
10. 场馆是纯视觉资产，不参与联机结果；不要在场馆脚本中加入比赛帧更新、网络状态或结果随机逻辑。

## 标准生产流程

### 1. 编辑权威源

打开 `SwimmingVenue_Rebuild_FlatColor_editable.blend` 修改几何、材质或锚点，完成后保存。

无座椅看台的最终颜色必须在 editable 中可见。修改看台或墙面配色后执行：

```powershell
<BLENDER> -b sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend `
  --python sceneresource/batch-flatcolor-venue.py -- --author-editable
```

该模式会把 T1-T4 的顶面、正面、侧/底面写成 12 个最终 unlit 材质，并将背墙、上层平台和入口建筑墙面写成浅蓝灰色；当前线性色值为 `(0.20, 0.38, 0.58)`，Cocos 最终显示约为 sRGB `RGB(124,166,200)`。不得只在 Cocos 运行时 shader 中补偿错误的 Blender 源材质。

不要在 `SwimmingVenue_Rebuild_FlatColor.blend` 里直接做创作性修改。否则下一次从 editable 同步时无法判断哪一份才是权威。

### 2. 同步到导出目标

打开 `SwimmingVenue_Rebuild_FlatColor.blend`，只同步本次受影响的对象或逻辑批次：

1. 从 editable 文件 Append 本次修改涉及的对象到临时 Collection。
2. 对同名独立运行时节点，替换 Mesh 数据但保留目标文件中的节点名、父子关系和变换。
3. 对合并节点，删除目标文件中对应的旧批次，再从新 Append 的源对象重新合并。
   `PoolsideProps_Merged` 必须使用 Blender 原生 Join 保留各对象 world transform，随后应用合并对象变换；不要用未经逐对象验证的一次性 bmesh 变换脚本烘焙整个批次。
4. 合并时按运行时边界分组，不能为了少一个 draw call 跨边界 join。
5. 检查新旧对象的 world transform、包围盒、面数和材质，再删除临时 Collection。
6. 保存 `SwimmingVenue_Rebuild_FlatColor.blend`。

当前合并边界包括：

- `BleacherBatch_T{1..4}_{N/S/E/W}`：每层、每侧各自一个节点。
- `CornerStands_Merged`：角看台。
- `StandStructure_Merged`：墙体、平台和天花板主体。
- `StandArchitectureArt_Merged`：新增看台柱梁，48 个源构件合并为一个 Mesh、一个材质。柱底接地、柱顶接梁底、梁顶接 T3 楼板底，避开四侧出入口。
- `BleacherAccess_Architecture_Merged`：入口楼梯及建筑结构。
- `BleacherAccess_Rails_Merged`：入口扶手。
- `OlympicPanels_Merged`：第 1、3 层广告挡板；保留旧节点名以兼容运行时。
- `PoolsideProps_Merged`：救生站、泳具车、仰泳旗线、泳池梯、裁判席和长凳，共用一个池岸纯色 atlas。
- 泳池、水面、泳道线、浮标、领奖台和锚点保持各自运行时节点，不跨组 join。

只修改某个合并批次中的一个源对象时，也必须重建整个受影响批次，不能把新对象额外留成一个 renderer。

### 3. 执行材质合批

几何同步完成后，在 `SwimmingVenue_Rebuild_FlatColor.blend` 上运行：

```powershell
<BLENDER> -b sceneresource/SwimmingVenue_Rebuild_FlatColor.blend `
  --python sceneresource/batch-flatcolor-venue.py --
```

该脚本会：

- 保留 17 个看台节点及全部几何；
- 按 T1-T4 层号和固定看台方位把无座椅台阶写成 12 档最终蓝色，共用一个内嵌 `192x16` atlas；N/S/E/W 看台的正面分别固定为朝泳池的 `-Y/+Y/-X/+X` 面，不能按面中心到泳池中心的斜向量分类；
- 12 条色带只包含 `T1-T4 × 顶/正/侧`，色带中心为 `U=(index+0.5)/12`；不保留座椅备用色带、座椅材质或运行时座椅 overlay；
- 将 `StandStructure_Merged` 和 `BleacherAccess_Architecture_Merged` 中对应墙面同步为 editable 使用的浅蓝灰色；
- 将每个看台从 3 个材质 primitive 收敛为 1 个；
- 将 `PoolsideProps_Merged` 的七种源材质按固定顶光方向烘焙为亮、中亮、中暗、暗四档，共 28 条色带，收敛为一个内嵌 `112x16` 纯色 atlas 和一个 primitive；白色管架使用偏蓝银灰白，不以纯白自发光输出；第 8 版仰泳旗使用珍珠白与薄荷青交替配色，两面固定使用高亮档，保证从泳池两端及蓝色看台背景前观看都清晰；
- `PoolsideProps_Merged` 导出前必须删除源模型遗留 UV，只保留 `PoolsidePropsFlatColorAtlasUV` 作为 `TEXCOORD_0`；Cocos Creator 3.8 不能正确绑定第三套 UV，atlas 落到 `TEXCOORD_2` 会导致整批运行时显示黑色。
- 保存合批目标；
- 清理生成过程中的临时 PNG。

随后执行 dry-run 验证幂等状态：

```powershell
<BLENDER> -b sceneresource/SwimmingVenue_Rebuild_FlatColor.blend `
  --python sceneresource/batch-flatcolor-venue.py -- --dry-run
```

正常结果应包含：

```text
targets: 17
pending: 0
completed: 17
primitiveDrawsBefore: 39
primitiveDrawsAfter: 39
```

合法新增结构可能改变总数，但导出目标必须保持 `<= 39` primitive；超过上限时先审计材质槽和新增 renderer，不要直接放宽限制。

### 4. 导出 GLB

仅从合批目标导出：

```powershell
<BLENDER> -b sceneresource/SwimmingVenue_Rebuild_FlatColor.blend `
  --python sceneresource/export-flatcolor-venue-glb.py -- `
  assets/race/pool/LowPolyPool.glb
```

导出脚本会拒绝以下状态：

- 缺少关键运行时节点；
- 看台未使用 `BleacherFlatColorAtlas_Material`；
- `PoolsideProps_Merged` 未使用 `PoolsidePropsFlatColorAtlas_Material`；
- `PoolsideProps_Merged` 未升级到当前四档卡通明暗 atlas 版本；
- 看台批次数不是 17；
- 总 primitive 超过 39。

禁止手动从 Blender 的 Export 菜单绕过该脚本，也禁止导出到 `assets/resources/pool/`。

### 5. Cocos 重新导入与纹理策略

1. 保持 Cocos Creator 3.8.8 打开项目，等待 `LowPolyPool.glb.meta` 完成更新。
2. 不删除、不替换现有 `.meta`。
3. 执行：

```powershell
npm run textures:fix
npm run textures:check
```

4. `textures:check` 必须通过后才能构建微信小游戏。

### 6. 验收

至少检查以下内容：

- GLB 当前基线为 57 个节点、34 个 Mesh、39 primitive、20,618 triangles、781,340 bytes，约 0.75 MiB。浮漂替换时相对六边短柱减少 19,992 triangles、10,542 个导出顶点、330,844 bytes；浮漂三角面减少约 84%。领奖台第 3 版保持 60 triangles、原一张 256×256 图集及批次，比第 2 版减少 372 bytes。此处为源 GLB 大小，不是微信最终包体增量。
- 准备阶段 draw calls 不应回到旧版约 64；当前场馆基线应比旧 59-primitive GLB 少约 22 次提交。
- 当前无座椅版本只保留蓝色台阶；顶面、正面、侧/底面应使用同一组场馆蓝的三档明暗，不能因无光照糊成同一色块。
- 蓝色台阶不参与连续的逐像素高度/距离渐暗；T1-T4 的四档稳定亮度已在 Blender 和 atlas 中烘焙，运行时乘色必须保持 1。越靠上越暗，但同一层、同一面向必须保持同色。
- 低位跟拍使用 T1-T4 亮度 `(1.0, 0.55, 0.28, 0.12)`，墙体烘焙为 `(1.0, 0.42, 0.24, 0.10)`；运行时观众的四档亮度与看台同步，避免中上层整片压黑。看台 atlas 版本为 7。
- 池底和池壁共用原名 `PoolWallNarrowTilesWhite` 的内嵌 `256x256` 不透明方砖图，保持图片和材质身份，UV 对应约 0.5m 方砖。不得把 Blender 的水面占位材质当作游戏水面效果；水面与水下吸收仍由原运行时 shader 负责。
- 运行时观众按六个空间区域、三种动作使用 18 个合并组、1 个双面无光照顶点色材质。T1 每人 32 triangles：头身有厚度，双臂为轮廓面片，不生成小眼睛；T2 每人 14 triangles；T3 每人 4 triangles，仅头身两个色块；T4 每人 2 triangles／4 vertices，仅衣服色矩形。T3/T4 不应用顶部变形并固定进入静态组，普通看台与转角规则一致。按当前 GLB 离线统计共 1,171 人，T1/T2/T3/T4 分别 295/293/286/297 人，共 15,280 triangles、29,974 vertices，最大单组 5,192 vertices，使用 16 位索引；相对第一层仍为 64 面的上一版减少 9,440 triangles（38.2%）与 17,700 vertices（37.1%）。按 POSITION float3、COLOR float4 和 uint16 索引估算原始数据为 930,952 bytes，减少 552,240 bytes，不含引擎开销，不能据此推断真机帧率。无新增材质、贴图、单人节点或骨骼。T1/T2 约 72% 静止、20% 单手举起、8% 双手欢呼，后两类改由两个共用动作父节点最多 24Hz 微幅位移，同类动作共用相位，子网格独立参与引擎视锥剔除，隐藏或时间暂停时不写变换。南北朝向根据世界包围盒确定，不根据 N/S 名称推断；保持全体观众落位、尺寸、亮度、姿势分配和第二至第四层实际几何。观众仅为视觉内容，不改变单机或联机比赛状态。几何变动须复查台阶落点、头部遮挡以及远距离可辨度。
- 观众几何权威源码为 `assets/scripts/venue/SpectatorGeometry.ts` 与 `SpectatorCrowdBuilder.ts`，不属于 Blender 场馆源网格。离线预览先运行 `npx --yes --package typescript@5.4.5 -c "node scripts/preview-spectator-crowd.cjs"`（默认与 HEAD 比较，可给脚本传旧提交，或传同时保存两个观众源码文件的基线目录），再运行 `python scripts/run-blender.py -- --python scripts/render-spectator-preview.py`。输出仅进入被忽略的 `temp/spectator-preview`；该流程执行真实观众生成函数，审计索引、退化面、包围盒、朝向及动画节流，并渲染六面、低位正反视角与看台局部。预览不是 Cocos/微信截图，不含实际水面着色、游戏后处理或真机性能验证。
- `StandStructure_Merged`、入口楼梯、平台和其他墙面在 Blender 源与运行时都必须为同一浅蓝灰色，不得继承看台深蓝色。
- 东、西直看台不得保留整面 `StandSoffit_E` / `StandSoffit_W`；这两块约 35.87m × 4.57m 的连续底板会在泳池低视角遮住二层观众。西侧角区也不得保留 `CornerSoffit_NW` / `CornerSoffit_SW`，它们会与整体大 O 重叠并露出蓝灰色块；editable 中这四个对象都应不存在。
- T3 地板是覆盖 N/E/S/W 四边的一个整体大 O，不是东、西各自闭合。editable 必须保留独立源对象 `T3RingFloor_O`：内孔与外框同轴，东西两臂等宽、南北两臂等宽，外边界从 `StandSupport_N/S/E/W` 的朝池接触平面推导并贴合四面墙，中央孔保持场馆内区开放，底面使用浅蓝灰 ceiling 材质；不得固定为 3m 后再手调单边宽度。同步 master 时将它并入 `StandStructure_Merged`，不能只给 E/W 半模块补离散小面，也不能在西侧单独造一个局部 O。
- 东侧、南侧、北侧、西侧看台没有缺面，楼梯、扶手、天花板和墙顶交界正常；墙顶交界描边基线为 N/S/E/W 直墙加 NE/SE/NW/SW 斜角共 8 条物理接触线。西侧必须按角看台与南北长看台的接缝关系定位，不得以泳池中心镜像回填空地。
- 观众仍落在 16 个分层看台及 NE/SE/NW/SW 角看台上，拍照闪光位置正常。
- 水面、水下、起跳台、泳道线、颁奖台和场馆描边正常；观众席正面描边基线为 17 个源节点、144 条连续线、288 triangles，NW/SW 必须按各自角区提取，不能被更靠近泳池的 NE/SE 候选淘汰。
- 浮漂为 `lane_float_rope_batch` 内的 7 条闭合八边连续绳体，共 3,892 triangles、1,960 个源顶点、3,808 个导出顶点、4 个材质 primitive。每条只在 34 个色段边界保留共享截面环，整条绳体两端封盖，移除逐颗端面及不可见的内部细绳。外接直径 0.14m，顶部为平边。每色段用 UV 重复 12 次表现盘片，纹理盘节约 0.12132m，全池表现 2,856 节但不存在对应独立几何。盘心按真实水面上方 0.02m 定位，约 0.045m 浸在水下。读取 `PoolWaterSurface` 的世界几何高度，不能套用默认水位 0.055。节点变换、泳道中心和颜色分段不变，生成脚本强制全池不超过 4,000 triangles。
- 浮漂复用原 `LaneFloatBeads.png` 的 128×16 纹理及原着色器；轴向每色段 U 从 0 到 12，纹理采样器必须保持 REPEAT，暗缝和固定顶光提供盘片观感，无新增贴图或采样。几何及 U→12-U 的 UV 映射镜像一致。`LaneFloatCutout.effect` 在顶点阶段按圆周 V 计算固定顶光，顶部 V=0.5；V 在底部跨缝不拆点，因为原纹理各行相同，圆周顶光在顶点阶段计算。闭合绳体保持背面剔除，Effect 及 `WaterSurfaceBinder` 的三条初始化路径均为 BACK。无新增透明层、实时灯光、物理模拟或逐帧逻辑；水下染色与运动员遮挡裁切保持原流程。此方案只模拟盘片明暗，近景外轮廓无真实凹槽，不得声称与逐颗建模完全一致；远处纹理闪烁、实际跟拍效果及帧率仍须微信真机验证。
- 两组仰泳旗线、四组泳池梯、两组救生站与泳具车、裁判席和低矮长凳位置正常；领奖台西端的自由环绕镜头区域必须保持无高物体遮挡。
- `PoolsideProps_Merged` 的 Blender world bounds 基线约为 X `4.965..45.035`、Y `-14.710..15.657`、Z `-0.920..2.485`；独立设施及四组池沿扶梯的甲板侧支脚都必须落在外侧地面 `Z=0.2`，每组扶梯当前有 16 个顶点命中该接地平面；导出脚本会分别检查四组扶梯，并拦截换轴、漏应用变换、整体移位或抬高 0.2m 的损坏状态。
- 顶视镜头仍能隐藏名称包含 `ceiling` 的顶部构件。
- 真机重要改动需同时检查 iOS 和 Android 微信小游戏。

## 禁止事项

- 不从 editable 文件直接导出。
- 不把 editable 整体覆盖到导出目标后跳过合并。
- 不把 16 个分层看台 join 成一个节点。
- 不直接修改 `library/` 或 `temp/` 中的 Cocos 导入缓存。
- 不用脚本在导出后的 GLB 上追加或修补几何；修复必须回到 editable 源。
- 不手工编辑 GLB `.meta` 的压缩配置；使用纹理策略脚本。
- 不提交 `.blend1`、`.blendbak`、`.venuebak`、`__pycache__` 或临时 PNG。

## 本目录应保持的结构

```text
sceneresource/
  README.md
  SwimmingVenue_Rebuild_FlatColor_editable.blend
  SwimmingVenue_Rebuild_FlatColor.blend
  batch-flatcolor-venue.py
  export-flatcolor-venue-glb.py
  refine-stand-structure.py
  refine-pool-tiles.py
  venue-textures/
```

## 跟拍视角细化的再生成

先备份源文件，按顺序执行以下创作和定向同步，再运行上文的合批、dry-run、正式导出及纹理策略流程：

```powershell
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/refine-pool-tiles.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/refine-stand-structure.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/batch-flatcolor-venue.py -- --author-editable
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor.blend --python sceneresource/refine-pool-tiles.py -- --sync
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor.blend --python sceneresource/refine-stand-structure.py -- --sync
```

柱梁必须检查真实楼板的表面接触，不仅检查包围盒高度。新增 GLB 纹理会移动 Cocos 的 `UnnamedTexture-N` 索引；重导入后按图片身份检查旧 wrap/filter 设置，压缩 preset 和 mipfilter 仍交给 `textures:fix`。源模型预览可用于检查几何/色板，最终水面、观众遮挡与帧率须在实际游戏跟拍视角验收。

旧 `LowPolyPool`、`SwimmingVenue_Rebuild`、`Atlas`、模块样板、一次性修复脚本和 Blender 自动备份已被移除。需要追溯时使用 Git 历史，不要重新放回生产目录。

## 池岸扶手与泳池梯的运行时水线

- 扶手和泳池梯保留在 `PoolsideProps_Merged` 的单图集合批内，不另拆网格。`PoolsideWaterline.ts` 由 `WaterRefractionController` 持有，在相机初始化时加载并绑定一次材质。
- 水上视角使用人物的 `SWIMMER_LAYER`，在水面之后绘制，同时保留池壁、池沿深度遮挡。水下视角恢复原主相机层，与浮漂一致，避免救生站、旗线等岸上道具穿过不透明水面镜像。
- 复用 `VenueHeightShade` 的 `USE_POOLSIDE_WATERLINE` 变体，保留原 `emissiveMap`、白色自发光乘色、UV 和双面显示。该 GLB 批次没有法线和顶点色；变体不能要求这些属性，也不能使用黑色 `albedoScale` 代替自发光色。水线采用世界 Y，仅水下部分叠加与浮漂一致的水色；普通看台不启用此变体。
- 不新增相机、RenderTexture、贴图或网格，不增加正常水上视角的批次提交数；材质加载后和视角状态切换时更新分层，比赛帧不遍历这批道具。退出时恢复原材质及层，释放自建材质，废弃迟到加载回调。此变更只影响视觉，不修改单机或联机状态。
- 非 GUI 检查：固定版本类型检查，以及 `npx --yes --package typescript@5.4.5 -c "node --test tests/poolside-waterline.test.cjs"`。最终仍需在游戏内确认水上扶手水下段、池沿遮挡和水下镜像；离线检查不代表真机渲染验收。

## 圆盘浮漂再生成

备份 editable、master、运行时 GLB 和 `.meta` 后执行以下步骤，再按标准流程合批、导出、重导入与纹理审计：

```powershell
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/refine-lane-floats.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor.blend --python sceneresource/refine-lane-floats.py -- --sync
```

脚本从原绳体提取七条泳道的位置和 34 段颜色布局，缓存于对象自定义属性以供幂等重建；`--prototype` 仅在内存生成中间泳道的两段样板，不保存源文件。版本 6 的每条绳体必须闭合，每条边恰好连接两个面；相邻色段必须共用截面，生成时检查所有色段及端面法线、几何和 UV 对称性。`disc_float_count` 从该版本起表示纹理盘节数量，不是独立几何颗数。导出 Mesh 名 `lane_float_rope_batch_Mesh.002` 必须保持不变。同步后对比其他 32 个 Mesh 的几何、所有节点变换和所有子资源 UUID，并以相同高度、距离和视场检查正向及折返跟拍，同时检查侧视纹理分节与远处混叠。

## 第 1、3 层广告挡板

- 第 1 层 32 块、第 3 层 44 块，共 76 块源挡板。保留所有位置、几何、材质、Mesh 和运行时节点名称；导出为原 `OlympicPanels_Merged` 的一个 primitive。
- `venue-textures/VenueAdBoards.svg` 是转曲矢量源，`VenueAdBoards.png` 是 512×512 RGB 不透明源图集。六款虚构运动广告交错排布，入口半板使用紧凑字标；转角及相邻挡板使用深蓝连接底色和居中字标，避开原几何重叠造成的文字截断。
- 图集取代原 512×512 图片，Blender 图片名仍为 `blue_bleachers_3d_model_basecolor.003`，GLB 图片名仍为 `blue_bleachers_3d_model_basecolor`。图集每行 64px，普通广告使用中间 48px，上下留同色隔离区；最后一行底部为边框纯色采样点。
- 不新增文字 Mesh、透明覆盖层、动态广告轮换、实时灯光或运行时代码。正反面按观看者方向单独计算 UV，不能靠双面材质修复镜像文字。
- 同步时从 editable Append 对象，仅向已有合批写入 UV 并替换原图片。定位使用源面的世界重心，逐板检查完整面数；不能按整块中心分配端面，否则入口半板、转角容易串图。所有几何和节点变换须保持不变。
- 已完成正反跟拍、两侧和转角离线预览，几何/图片身份对比、子 UUID 检查、Cocos 重导入与纹理策略审计。预览不含运行时观众及游戏水面；实际远处文字混叠和微信真机效果需在游戏中验收。

修改矢量设计时，可直接编辑 SVG 后用 resvg 栅格化；从配方再生成需要 `fonttools`、`resvg-py`、`Pillow`，只在制作阶段使用。先备份源文件，再依次运行，最后执行标准合批、正式导出、重导入及纹理审计：

```powershell
python sceneresource/build-venue-ad-atlas.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/refine-venue-ad-boards.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor.blend --python sceneresource/refine-venue-ad-boards.py -- --sync
```

## 薄荷青旗色与领奖台再生成

- 两组仰泳旗共 24 片，原三角片几何、悬挂位置和双向显示保持。奇数片珍珠白，偶数片薄荷青；源材质为 `PoolsideProp_Flag_Pearl` / `PoolsideProp_Flag_Mint`。旗片区域按真实世界高度 `1.53..1.965` 识别，不能把上方细绳也当作旗布锁定亮度。
- `PoolsidePropsFlatColorAtlas` 升至第 8 版，仍为 112×16 / 28 色带：旧橙色条带改为薄荷青，仅旗片上的黄色映射到原银白条带；泳具上的黄色及泳道浮漂不改。源旗片配色由 editable 保存，master 由批处理解码旧 UV 条带迁移，无需重建未改变的几何。
- `award_podium_1/2/3` 共用原名 `LPVenue_cartoon_podium_red.001` 的一个材质；保留三个 Mesh 的原名。第 3 版每台 12 个源顶点、20 triangles，合计 60 triangles，比第 1 版减少 72。台身满宽相接，前后立面齐平，仅踏面边缘保留 2cm 倒角，无独立底脚和外挑顶盖。每台宽 1.2m，总宽 3.6m，深 1.1m；地面以上高度分别 0.78/0.56/0.44m。比例和配色集中于 `podium-design.json`，供模型与图集生成脚本共同读取。
- 原颁奖相机从 -X 侧观看，当前按视觉左至右排成 2—1—3。冠亚季军顶部 Z 分别为 0.98/0.76/0.64，Blender Y 中心分别为 -1.5/-0.3/-2.7。底部均与地面 Z=0.2 接触。运行时按同名节点包围盒放置获奖者，相机目标随冠军台高度调整；无需修改比赛结果、联机或站位代码。
- `venue-textures/PodiumFinish.svg` 与 `.png` 为可编辑矢量源及 256×256 RGB 图集。内嵌图片名 `PodiumRankLabelAtlas`，由文字类命名自动采用 ASTC 6×6 + JPG 回退；线性采样、clamp-to-edge、无 mip。采用亮蓝正面、深蓝端面、浅蓝白踏面、统一25cm高的粗体矢量号码和冠军金色冠标；底部6.5cm深蓝带与其上5cm青色带连贯。三块128²名次区加一块纯色区，提高号码纵向分辨率，未增加图集尺寸。去掉上一版粗踏面条纹，靠固定面向色差表现体积。
- Blender 材质以自发光图集表达；`PoolEdgeToonOutline.ts` 初始化领奖台时把原贴图传给一个共享 `builtin-unlit` 材质，不再覆盖为纯红色。保留原静态描边流程，不增加逐帧更新、实时光照或自定义 Effect。
- 添加图片会移动 `UnnamedTexture-N` 的序号。重导入后按所引用的图片 UUID 恢复旧 sampler，特别是广告的两份纹理都须线性采样，池岸纯色 atlas 仍为 nearest。不得仅按 Texture2D 序号继承设置；压缩与 mip 交给 `textures:fix`。
- 已检查闭合性、朝外法线、接地、顶部高度、六侧正交、正反材质预览及泳池两端旗色。其余 29 个 Mesh 的几何和数据保持，旗线批次几何保持；旧 Mesh/材质/图片 UUID 保留，新增图片按正常导入生成 UUID。游戏内获奖者脚底接触、环绕描边与微信真机最终表现仍需验收。

备份后按顺序运行，再执行标准合批、导出、Cocos 重导入、sampler 身份复核与纹理策略检查：

```powershell
python sceneresource/build-podium-atlas.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/refine-podium-and-flags.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor.blend --python sceneresource/refine-podium-and-flags.py -- --sync
```

仅重制领奖台时在 editable 命令末尾追加 `-- --podium-only`，避免重新处理旗片。第 3 版导出保持原 38 primitives、7 张内嵌图片及所有节点变换；其余 30 个 Mesh 和非领奖台图片不变。检查所有子资源 UUID、按新版尺寸推导的包围盒及正反预览；游戏内角色脚底、环绕描边和真机效果仍需验收。


## 线性灯阵与屋盖（第 1 版）

- 新灯具由 `refine-ceiling-lighting.py` 在 editable 中创作，源码集合 `CeilingPremiumLighting` 包含 7 个浅拱肋、1 个屋盖、4 组线性灯，共 12 个独立编辑对象；合批目标为 `ceiling_lighting_rig`，Mesh 名为 `ceiling_lighting_rig_Mesh`。
- 横向支架落在现有 `StandBackWall_N/S` 的实际墙顶 `Z≈9.276m`；四条双槽灯沿泳池纵向延展，位于 Blender Y `-9/-3/3/9m`，灯壳底面 `Z=11.36m`。双吊杆连接拱肋与灯壳，扩散面内嵌槽口 0.03m，并与槽底相交 0.01m。屋盖两端按东西后墙与场馆切角收口。
- 运行时 2,320 triangles、2,600 导出顶点、1 个不透明材质 primitive，只有 POSITION/COLOR_0；无新增纹理、法线、UV、实时光源或透明光晕。GLB 比旧场馆增加 66,824 bytes。全馆 primitive 上限仍为 39，不能放宽。
- `CeilingLightArray.ts` 现在只绑定一次 `builtin-unlit` 顶点色材质，节点销毁时释放自建材质；不生成灯具网格。旧 76 个逐灯眩光节点和控制器已移除，比赛帧不做灯具计算。`TopViewCeilingController` 按节点名整体隐藏和恢复，包括屋盖；不要把灯具并入不带 ceiling 名称的其他场馆批次。
- 灯具与屋盖为纯视觉内容，不影响单机或联机结果；水面仍使用原本的近似反光，不增加反射相机。
- 修改时先备份 editable、master、GLB 和 meta，运行下列作者/同步步骤，再按本文标准流程执行 batch、dry-run、正式 export、Creator 重新导入、`textures:fix` 与 `textures:check`。保留原有 67 个子资源 UUID，新增灯具 Mesh 与 Material 子资源；原有 33 个网格和 7 张图片的数据应保持不变。

```powershell
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/refine-ceiling-lighting.py
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor.blend --python sceneresource/refine-ceiling-lighting.py -- --sync
```

`--prototype` 只生成一个灯具跨距并另存至 `temp/ceiling-preview/prototype.blend`，不保存 editable。后台几何预览使用 `scripts/render-ceiling-preview.py`（打开 prototype 时追加 `--prototype`；整馆则打开合批目标）。预览只写入被忽略的 temp 目录，不截图或启动 Creator；图片不含运行时水面与后处理，不能充当微信真机效果或性能验证。

生命周期检查：`npx --yes --package typescript@5.4.5 -c "node --test tests/ceiling-lighting.test.cjs"`。重复绑定、俯视往返和资源释放必须保持单一材质实例与稳定节点数。


## 泳池与角色 mipmap（2026-09-09）

- 已由统一策略开启 33 个 Texture2D 的 `mipfilter: linear`，保持原 min/mag 过滤、wrap、UUID 和压缩预设。范围包括泳池 GLB 的瓷砖、地面、广告、领奖台，起跳台 GLB，泳池独立常规贴图，以及 11 个角色 GLB 与各自换色遮罩。
- `BleacherFlatColorAtlas`、`StandArchitectureArtAtlas`、`PoolsidePropsFlatColorAtlas` 是小型纯色色板，保持单级采样以免混色。粒子、UI 和动态水面 RenderTexture 不纳入本次调整。上文旧版本的“无 mip”描述由本节覆盖。
- `settings/v2/packages/builder.json` 中已有 `textureCompressConfig.genMipmaps=true`，现在作为必检项。Creator 构建负责离线生成压缩 mip；ASTC 回退 PNG/JPG 仍保留，未修改压缩质量档位。非压缩图像由引擎在上传时生成 mip，不在比赛帧重建。
- `texture-mipmap-policy.js` 是采样规则与 ASTC 输出校验源码。`textures:fix` 同步采样配置；微信 `onAfterBuild` 在搬移分包之前通过 Creator 公开资源路径 API 检查实际输出，兼容 MD5 文件名。压缩图必须同时存在 ASTC 和 PNG/JPG；ASTC 必须具有 Cocos CMIP 包装、逐级正确尺寸及块字节数，完整覆盖到 1×1。裸 ASTC、缺层、截断或无回退输出会拒绝构建。
- 检查：`npm run textures:fix`、`npm run textures:check`、`node --test tests/texture-mipmap-policy.test.cjs`。已用本机 Cocos 3.8.8 原始 `mergeCompressedTextureMips` / `parseCompressedTextures` 方法验证一份真实编码的 32×32 至 1×1 六层 ASTC，验证结果与项目检查器一致。
- 本次未启动 Creator、未生成微信发布包、未做真机验收。需等待既有编辑器重新导入后构建；若缓存仍输出单层 ASTC，清理构建缓存后重建。真机须检查泳池斜视纹理、角色及换色遮罩 UV 接缝、远处串色、内存和帧耗时。不能以配置检查或编码样本替代最终资产构建/真机验证。此改动只影响视觉纹理采样，不改变单机或联机比赛状态。


## 第一轮场馆与第一层观众减面（2026-09-09）

第一轮已接入：76 块广告挡板使用有厚度的 12 面盒体，2,260 → 912 triangles；24 件方块道具去倒角，1,056 → 288 triangles，池岸整批 5,872 → 5,104。关闭浮漂和顶棚后的场馆几何为 14,406 triangles。保留原广告图集、正反文字、入口半板与转角位置；不动泳池梯、细杆和看台内部面。场馆与观众合计减少 11,556 triangles（单次绘制几何口径）。

源编辑与定向同步（先按上文备份）：

```powershell
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor_editable.blend --python sceneresource/simplify-venue-first-pass.py -- --apply
python scripts/run-blender.py -- sceneresource/SwimmingVenue_Rebuild_FlatColor.blend --python sceneresource/simplify-venue-first-pass.py -- --sync --apply
```

省略 `--apply` 为内存试算，不保存；创作步骤可重复执行。同步后仍必须执行本文标准 atlas 合批、dry-run 和 GLB 导出步骤。源板局部 X/Y 保留原长度/厚度及原对象旋转；入口半板最长边可能是斜向三角化边，禁止据此重定向盒体。所有方块局部支承平面和对象变换保持，去倒角新增的角点会使旋转道具世界包围盒最多扩约 2mm；角挡板的批次世界包围盒最多扩约 2.5cm。

`python scripts/check-venue-first-pass.py <优化前GLB路径>` 对比节点变换、批次数、其余 32 个网格的逐属性/索引字节及 7 张内嵌图片。`scripts/render-venue-first-pass-preview.py -- --before <优化前GLB路径>` 通过 `scripts/run-blender.py` 执行，输出 GLB 材质下的正反低机位、道具正反面、广告、入口和转角离线对照。完整结果见 `docs/场馆几何优化审计.zh.md`；不以离线预览代替游戏/真机验收。


## 观众空间分区剔除（2026-09-09）

`SpectatorCrowdBuilder.ts` 保留初始化时的颜色/动作桶，用于稳定的观众落位和闪光候选顺序；创建 renderer 前按空间重分区。两侧长看台各分两段，两端短看台各一段，转角按归一化位置归入相邻区域。每区按静止/单手/双手三组渲染，同组内衣服颜色由顶点色保留。总计 18 个 MeshRenderer，共用原单一材质，无新增贴图和 Shader。

每个分区网格具有独立的 minPos/maxPos；Cocos 按各相机自己的视锥和模型世界包围盒剔除，不增加每帧逐人判断，不按主相机改 Node.active，因此不干扰其他相机的可见性。两类欢呼共用两个父节点动画，幅度、频率及最多 24Hz 节流不变；同类欢呼相位统一。隐藏 crowdRoot 或暂停时仍不写动画变换。

水下视角不显示观众：观众与拍照闪光使用独立 bit 13，主相机入水时移除该可见位、出水恢复；水面折射和水下反射相机始终不包含此层。不改变预览手动开关或其他相机。水下闪光跳过位置筛选和发射，观众的两个轻量动作组件维持原节流。不要把新观众重新放回 DEFAULT，否则水下会继续提交这些网格。

1,171 人、15,280 triangles、29,974 vertices、原始几何缓冲 930,952 bytes 不变。`scripts/preview-spectator-crowd.cjs` 调用 `spectator-culling-audit.cjs` 比较旧颜色桶、4/6/8 区方案，并调用 `spectator-runtime-audit.cjs` 执行实际 build 生命周期检查。当前六区在代表性正向镜头的保守 AABB 预测为 9 次提交、7,666 triangles；中段反向为 9 次、7,614 triangles。全馆俯视最坏为 18 次，相对旧版 15 次多 3 次；不是所有镜头都能同时减少提交和面数。详细相机参数、结果及验证范围见 `docs/观众空间合批与剔除.zh.md`。真机 FPS 和耗时尚未测量。
