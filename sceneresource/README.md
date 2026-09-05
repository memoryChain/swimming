# 游泳馆场景修改、同步、合批与导出

本目录只保存游泳馆的 Blender 源文件、生产脚本和源纹理。运行时资产位于 `assets/race/pool/`。

## 当前权威文件

| 文件 | 用途 | 是否直接编辑 |
| --- | --- | --- |
| `SwimmingVenue_Rebuild_FlatColor_editable.blend` | 权威编辑源，保留可拆分对象和便于修改的结构 | 是 |
| `SwimmingVenue_Rebuild_FlatColor.blend` | 同步、几何合并、材质合批后的导出目标 | 仅做同步与合批，不直接创作 |
| `batch-flatcolor-venue.py` | 将 17 个看台批次压成单材质 atlas，并校验 primitive 数 | 生产脚本 |
| `export-flatcolor-venue-glb.py` | 校验运行时节点和合批状态，导出最终 GLB | 生产脚本 |
| `refine-stand-structure.py` | 按墙体和楼板接触面生成看台柱梁，合为一个运行时批次 | 生产脚本 |
| `refine-pool-tiles.py` | 烘焙池内方砖贴图并同步池底、池壁 UV | 生产脚本 |
| `refine-lane-floats.py` | 生成八边连续绳体，以重复贴图表现密集盘片，全池不超过 4,000 面 | 生产脚本 |
| `build-venue-ad-atlas.py` | 使用项目字体轮廓生成广告 SVG 与 512×512 图集 | 美术源生成脚本 |
| `refine-venue-ad-boards.py` | 替换 T1/T3 挡板 UV 和原图片，定向同步广告批次 | 生产脚本 |
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
primitiveDrawsBefore: 38
primitiveDrawsAfter: 38
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

- GLB 当前基线为 56 个节点、33 个 Mesh、38 primitive、20,414 triangles、868,164 bytes，约 0.83 MiB。浮漂替换时相对六边短柱减少 19,992 triangles、10,542 个导出顶点、330,844 bytes；浮漂三角面减少约 84%。领奖台第 3 版保持 60 triangles、原一张 256×256 图集及批次，比第 2 版减少 372 bytes。此处为源 GLB 大小，不是微信最终包体增量。
- 准备阶段 draw calls 不应回到旧版约 64；当前场馆基线应比旧 59-primitive GLB 少约 22 次提交。
- 当前无座椅版本只保留蓝色台阶；顶面、正面、侧/底面应使用同一组场馆蓝的三档明暗，不能因无光照糊成同一色块。
- 蓝色台阶不参与连续的逐像素高度/距离渐暗；T1-T4 的四档稳定亮度已在 Blender 和 atlas 中烘焙，运行时乘色必须保持 1。越靠上越暗，但同一层、同一面向必须保持同色。
- 低位跟拍使用 T1-T4 亮度 `(1.0, 0.55, 0.28, 0.12)`，墙体烘焙为 `(1.0, 0.42, 0.24, 0.10)`；运行时观众的四档亮度与看台同步，避免中上层整片压黑。看台 atlas 版本为 7。
- 池底和池壁共用原名 `PoolWallNarrowTilesWhite` 的内嵌 `256x256` 不透明方砖图，保持图片和材质身份，UV 对应约 0.5m 方砖。不得把 Blender 的水面占位材质当作游戏水面效果；水面与水下吸收仍由原运行时 shader 负责。
- 运行时观众仍是 15 个动作/颜色分组，每人 8 triangles；新的头部和身体为 12 vertices，移除了无用法线和 UV，材质由 5 份合为 1 份。头发、肤色和衣服烘焙为顶点色，无透明贴图和新增逐帧逻辑。几何变动须复查台阶落点、头部遮挡以及远距离可辨度。
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
