# 游泳馆场景修改、同步、合批与导出

本目录只保存游泳馆的 Blender 源文件、生产脚本和源纹理。运行时资产位于 `assets/race/pool/`。

## 当前权威文件

| 文件 | 用途 | 是否直接编辑 |
| --- | --- | --- |
| `SwimmingVenue_Rebuild_FlatColor_editable.blend` | 权威编辑源，保留可拆分对象和便于修改的结构 | 是 |
| `SwimmingVenue_Rebuild_FlatColor.blend` | 同步、几何合并、材质合批后的导出目标 | 仅做同步与合批，不直接创作 |
| `batch-flatcolor-venue.py` | 将 13 个看台批次压成单材质 atlas，并校验 primitive 数 | 生产脚本 |
| `export-flatcolor-venue-glb.py` | 校验运行时节点和合批状态，导出最终 GLB | 生产脚本 |
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
   - `start_block_anchor_root`
   - `start_block_anchor_near_01` 至 `start_block_anchor_near_08`
   - `start_block_top_near_marker`
6. 俯视相机会按名称隐藏天花板；新增顶部构件时，节点名必须包含 `ceiling`。
7. 普通看台必须保留 12 个独立节点 `BleacherBatch_T{1..4}_{N/S/E}`。观众生成依赖每个节点的包围盒和层号，不能把它们合成一个总 Mesh。
8. `CornerStands_Merged` 也必须保留。看台 atlas 脚本预期共 13 个看台批次。
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

该模式会把 T1-T4 的顶面、正面、侧/底面写成 12 个最终 unlit 材质，并将背墙、上层平台和入口建筑墙面写成银灰色。不得只在 Cocos 运行时 shader 中补偿错误的 Blender 源材质。

不要在 `SwimmingVenue_Rebuild_FlatColor.blend` 里直接做创作性修改。否则下一次从 editable 同步时无法判断哪一份才是权威。

### 2. 同步到导出目标

打开 `SwimmingVenue_Rebuild_FlatColor.blend`，只同步本次受影响的对象或逻辑批次：

1. 从 editable 文件 Append 本次修改涉及的对象到临时 Collection。
2. 对同名独立运行时节点，替换 Mesh 数据但保留目标文件中的节点名、父子关系和变换。
3. 对合并节点，删除目标文件中对应的旧批次，再从新 Append 的源对象重新合并。
4. 合并时按运行时边界分组，不能为了少一个 draw call 跨边界 join。
5. 检查新旧对象的 world transform、包围盒、面数和材质，再删除临时 Collection。
6. 保存 `SwimmingVenue_Rebuild_FlatColor.blend`。

当前合并边界包括：

- `BleacherBatch_T{1..4}_{N/S/E}`：每层、每侧各自一个节点。
- `CornerStands_Merged`：角看台。
- `StandStructure_Merged`：墙体、平台和天花板主体。
- `BleacherAccess_Architecture_Merged`：入口楼梯及建筑结构。
- `BleacherAccess_Rails_Merged`：入口扶手。
- `OlympicPanels_Merged`：奥运装饰板。
- 泳池、水面、泳道线、浮标、领奖台和锚点保持各自运行时节点，不跨组 join。

只修改某个合并批次中的一个源对象时，也必须重建整个受影响批次，不能把新对象额外留成一个 renderer。

### 3. 执行材质合批

几何同步完成后，在 `SwimmingVenue_Rebuild_FlatColor.blend` 上运行：

```powershell
<BLENDER> -b sceneresource/SwimmingVenue_Rebuild_FlatColor.blend `
  --python sceneresource/batch-flatcolor-venue.py --
```

该脚本会：

- 保留 13 个看台节点及全部几何；
- 按 T1-T4 层号和固定看台方位把无座椅台阶写成 12 档最终蓝色，共用一个内嵌 `192x16` atlas；N/S/E 看台的正面分别固定为朝泳池的 `-Y/+Y/-X` 面，不能按面中心到泳池中心的斜向量分类；
- 12 条色带只包含 `T1-T4 × 顶/正/侧`，色带中心为 `U=(index+0.5)/12`；不保留座椅备用色带、座椅材质或运行时座椅 overlay；
- 将 `StandStructure_Merged` 和 `BleacherAccess_Architecture_Merged` 中对应墙面同步为 editable 使用的银灰色；
- 将每个看台从 3 个材质 primitive 收敛为 1 个；
- 保存合批目标；
- 清理生成过程中的临时 PNG。

随后执行 dry-run 验证幂等状态：

```powershell
<BLENDER> -b sceneresource/SwimmingVenue_Rebuild_FlatColor.blend `
  --python sceneresource/batch-flatcolor-venue.py -- --dry-run
```

正常结果应包含：

```text
targets: 13
pending: 0
completed: 13
primitiveDrawsBefore: 33
primitiveDrawsAfter: 33
```

合法新增结构可能改变总数，但导出目标必须保持 `<= 35` primitive；超过上限时先审计材质槽和新增 renderer，不要直接放宽限制。

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
- 看台批次数不是 13；
- 总 primitive 超过 35。

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

- GLB 仍为 44 个节点、27 个 Mesh 左右，当前基线为 33 primitive。
- 准备阶段 draw calls 不应回到旧版约 64；当前场馆基线应比旧 59-primitive GLB 少约 26 次提交。
- 当前无座椅版本只保留蓝色台阶；顶面、正面、侧/底面应使用同一组场馆蓝的三档明暗，不能因无光照糊成同一色块。
- 蓝色台阶不参与连续的逐像素高度/距离渐暗；T1-T4 的四档稳定亮度已在 Blender 和 atlas 中烘焙，运行时乘色必须保持 1。越靠上越暗，但同一层、同一面向必须保持同色。
- `StandStructure_Merged`、入口楼梯、平台和其他墙面在 Blender 源与运行时都必须为同一银灰色，不得继承看台蓝色。
- 东侧、南侧、北侧看台没有缺面，楼梯、扶手、天花板和墙顶交界正常。
- 观众仍落在 12 个分层看台及角看台上，拍照闪光位置正常。
- 水面、水下、起跳台、泳道线、颁奖台和场馆描边正常。
- 顶视镜头仍能隐藏名称包含 `ceiling` 的顶部构件。
- 真机重要改动需同时检查 iOS 和 Android 微信小游戏。

## 禁止事项

- 不从 editable 文件直接导出。
- 不把 editable 整体覆盖到导出目标后跳过合并。
- 不把 12 个分层看台 join 成一个节点。
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
  venue-textures/
```

旧 `LowPolyPool`、`SwimmingVenue_Rebuild`、`Atlas`、模块样板、一次性修复脚本和 Blender 自动备份已被移除。需要追溯时使用 Git 历史，不要重新放回生产目录。